import React, { useEffect, useMemo, useState } from 'react'
import { observer } from 'mobx-react'
import { Region } from '@jbrowse/core/util/types'
import { readConfObject } from '@jbrowse/core/configuration'
import { makeStyles } from '@material-ui/core/styles'
import {
  Button,
  Checkbox,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  FormControlLabel,
  FormGroup,
  Typography,
} from '@material-ui/core'
import CloseIcon from '@material-ui/icons/Close'
import { getSession, isSessionModelWithWidgets } from '@jbrowse/core/util'
import { Feature } from '@jbrowse/core/util/simpleFeature'
import { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'

import hg38BigsiConfig from '../BigsiRPC/bigsi-maps/hg38_whole_genome_bucket_map.json'

const useStyles = makeStyles(theme => ({
  loadingMessage: {
    padding: theme.spacing(5),
  },
  closeButton: {
    position: 'absolute',
    right: theme.spacing(1),
    top: theme.spacing(1),
    color: theme.palette.grey[500],
  },
  dialogContent: {
    width: '80em',
  },
  textAreaFont: {
    fontFamily: 'Courier New',
  },
}))


async function getBigsiRawHits(
  model: any,
  querySequence: string,
  bigsiName: string,
) : Promise<any> {
  const session = getSession(model)
  const { rpcManager } = session

  const sessionId = 'bigsiQuery'

  const params = {
    sessionId,
    querySequence,
    bigsiName,
  }

  const response = await rpcManager.call(
        sessionId,
        "BigsiQueryRPC",
        params
  ) 

  return response
};
       

function makeBigsiHitsFeatures(
  model: any,
  rawHits: any,
) {

  let uniqueId = 0
  const allFeatures = []
  const bucketmap = hg38BigsiConfig.bucketMap
  for (const bucket in rawHits) {
    const bucketNum = parseInt(bucket)
    const bigsiFeatures = {
        id: uniqueId,
        name: `${bucketmap[bucketNum].refName}:${bucketmap[bucketNum].bucketStart}-${bucketmap[bucketNum].bucketEnd}`,
        assemblyName: hg38BigsiConfig.assembly,
        refName: bucketmap[bucketNum].refName,
        bucketStart: bucketmap[bucketNum].bucketStart,
        bucketEnd: bucketmap[bucketNum].bucketEnd,
    }
    allFeatures.push(bigsiFeatures)
    uniqueId++
    }

  return allFeatures
}

async function getMashmapRawHits(
  model: any,
  sequences: { ref: string; query: string },
) : Promise<string> {
  const session = getSession(model)
  const { rpcManager } = session

  const sessionId = 'mashmapQuery'
  const { ref, query } = sequences

  const params = {
    sessionId,
    ref,
    query,
  }

  const response = await rpcManager.call(sessionId, 'MashmapQueryRPC', params)

  return response as string
}

async function getBucketSequence(
  model: LinearGenomeViewModel,
  bucketRegion: { leftOffset: number; rightOffset: number },
) {
  const session = getSession(model)
  const { rpcManager, assemblyManager } = session
  const leftOffset = { offset: bucketRegion.leftOffset, index: 0 }
  const rightOffset = { offset: bucketRegion.rightOffset, index: 0 }
  const selectedRegions: Region[] = model.getSelectedRegions(
    leftOffset,
    rightOffset,
  )

  const sessionId = 'getBucketSequence'
  const assemblyName = 'hg38'
  const assemblyConfig = assemblyManager.get(assemblyName)?.configuration
  const adapterConfig = readConfObject(assemblyConfig, ['sequence', 'adapter'])
  const chunks = (await Promise.all(
    selectedRegions.map(region =>
      rpcManager.call(sessionId, 'CoreGetFeatures', {
        adapterConfig,
        region,
        sessionId,
      }),
    ),
  )) as Feature[][]

  // assumes that we get whole sequence in a single getFeatures call
  return chunks.map(chunk => chunk[0])
}
async function handleMashmapQuery(
  model: LinearGenomeViewModel,
  querySequence: string, 
  bucketCoords: { leftOffset: number, rightOffset: number }
  ) : Promise<string> {

    const refSeq = await getBucketSequence(model, bucketCoords)
    // pass ref and query to mashmap rpc
    const sequences = {
        ref: refSeq[0].get('seq'),
        query: querySequence
    }
    const mashmapHits = await getMashmapRawHits(model, sequences)
    return mashmapHits
}

function parseMashmapResults(rawHits: string) {
  const entries = rawHits.split('\n')
  const results = []
  for (const entry of entries) {
    if (entry) {
        const columns = entry.split(' ')
        const row = {
            queryName: columns[0],
            queryLen: parseInt(columns[1]),
            queryStart: parseInt(columns[2]),
            queryEnd: parseInt(columns[3]),
            strand: columns[4],
            refName: columns[5],
            refLen: parseInt(columns[6]),
            refStart: parseInt(columns[7]),
            refEnd: parseInt(columns[8]),
            score: Number.parseFloat(columns[9]),
        }
        results.push(row)
    }
  }
  return results
}
async function runMashmapOnBins(
  model: LinearGenomeViewModel, 
  flashmapResultsWidget: any, 
  allFeatures: any[],
  queryId: number,
  querySeq: string,
  ) {
    flashmapResultsWidget.setNumBinsHit(allFeatures.length)
    flashmapResultsWidget.toggleIsLoading()

    let currentBinNumber = 1
    for (const bin of allFeatures){
        flashmapResultsWidget.setCurrentBin(currentBinNumber)
        const binCoords = { 
            leftOffset: bin.bucketStart,
            rightOffset: bin.bucketEnd,
        }
        const mashmapRawHits = await handleMashmapQuery(model, querySeq, binCoords)
        const mashmapHits = parseMashmapResults(mashmapRawHits)
        for (const hit of mashmapHits) {
            const region = {
                id: queryId,
                assemblyName: 'hg38',
                queryName: hit.queryName,
                queryStart: hit.queryStart,
                queryEnd: hit.queryEnd,
                strand: hit.strand,
                refName: bin.refName,
                start: bin.bucketStart + hit.refStart,
                end: bin.bucketStart + hit.refEnd,
                score: hit.score,
            }
            flashmapResultsWidget.addMappedRegion(region)
        }
        currentBinNumber++
    }
    flashmapResultsWidget.toggleIsLoading()
}

function activateFlashmapResultsWidget(
  model: LinearGenomeViewModel, 
  ) {
    const session = getSession(model)
    if (isSessionModelWithWidgets(session)) {
        let flashmapResultsWidget = session.widgets.get('FlashmapResults')
        if (!flashmapResultsWidget) {
            flashmapResultsWidget = session.addWidget(
                'FlashmapResultsWidget',
                'FlashmapResults',
                { view: model },
            )
        }

        session.showWidget(flashmapResultsWidget)
        return flashmapResultsWidget
    } 
    throw new Error('Could not open Flashmap results')
}

function constructBigsiTrack(
    self: any,
    rawHits: object[],
    querySequence: string,
){
    const refName =
      self.leftOffset?.refName || self.rightOffset?.refName || ''

    const assemblyName = 
      self.leftOffset?.assemblyName || self.rightOffset?.assemblyName

    const bigsiBucketMapPath = '../BigsiRPC/bigsi-maps/hg38_whole_genome_bucket_map.json'

    const bigsiQueryTrack = {
            trackId: `track-${Date.now()}`,
            name: `Sequence Search ${assemblyName}:Chr${refName}:${self.leftOffset.coord}-${self.rightOffset.coord}`,
            assemblyNames: [assemblyName],
            type: 'FeatureTrack',
            adapter: {
                type: 'BigsiHitsAdapter',
                rawHits: rawHits,
                bigsiBucketMapPath: bigsiBucketMapPath,
                viewWindow: {refName: refName, start: self.leftOffset.coord, end: self.rightOffset.coord},
                querySeq: querySequence,
                },
            }

    const session = getSession(self)
    if (session.addTrackConf) {
      session.addTrackConf(bigsiQueryTrack)
      self.showTrack(bigsiQueryTrack.trackId)
    } else {
      console.error('Session does not allow adding track configurations.')
    }

}

/**
 * Fetches and returns a list features for a given list of regions
 * @param selectedRegions - Region[]
 * @returns Features[]
 */
async function fetchSequence(
  self: any,
  selectedRegions: Region[],
) {
  const session = getSession(self)
  const assemblyName =
    self.leftOffset?.assemblyName || self.rightOffset?.assemblyName || ''
  const { rpcManager, assemblyManager } = session
  const assemblyConfig = assemblyManager.get(assemblyName)?.configuration

  // assembly configuration
  const adapterConfig = readConfObject(assemblyConfig, ['sequence', 'adapter'])

  const sessionId = 'getSequence'
  const chunks = (await Promise.all(
    selectedRegions.map(region =>
      rpcManager.call(sessionId, 'CoreGetFeatures', {
        adapterConfig,
        region,
        sessionId,
      }),
    ),
  )) as Feature[][]


  // assumes that we get whole sequence in a single getFeatures call
  return chunks.map(chunk => chunk[0])
}

interface Checkboxes {
  [key: string]: { 
    name: string, 
    key: number, 
    label: string 
  } 
}

function CheckboxContainer({
  checkboxes, 
  updateSelectedBigsis, 
  ...props
  } : {
  checkboxes: Checkboxes,
  updateSelectedBigsis: React.Dispatch<React.SetStateAction<string[]>>  
}){
    const initCheckedItems = Object.fromEntries(Object.keys(checkboxes).map(key => [key, false]))
    const [checkedItems, setCheckedItems] = useState(initCheckedItems)

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => { 
      const { name, checked } = event.target
      setCheckedItems({...checkedItems, [name]:checked})

    }

    useEffect(() => {
      const selectedBigsis = []
      for (const item of Object.keys(checkedItems)){
        if (checkedItems[item]){
          selectedBigsis.push(checkboxes[item].name)
        }
      }
      console.log('selectedBigsi', selectedBigsis)

      updateSelectedBigsis(selectedBigsis)
    }, [checkedItems])

    useEffect(() => console.log(checkedItems), [checkedItems])
    

    return (
      <FormGroup>
        { Object.values(checkboxes).map((checkbox) => 
          <FormControlLabel
            key={checkbox.key}
            label={checkbox.label}
            control={
              <Checkbox
                key={checkbox.key}
                name={checkbox.name}
                checked={checkedItems[checkbox.name]}
                onChange={handleChange}
                inputProps={{ 'aria-label': 'controlled' }}
              />
            }
        />
        )}
      </FormGroup>
    )
}


function BigsiDialog({
  model,
  handleClose,
}: {
  model: any
  handleClose: () => void
}) {
  const classes = useStyles()
  const session = getSession(model)
  const [error, setError] = useState<unknown>()
  const [queryId, setQueryId] = useState(1)
  const [sequence, setSequence] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedBigsis, setSelectedBigsis] = useState<Array<string>>([])
  const { leftOffset, rightOffset } = model

  // avoid infinite looping of useEffect
  // random note: the current selected region can't be a computed because it
  // uses action on base1dview even though it's on the ephemeral base1dview
  const queryRegion = useMemo(
    () => model.getSelectedRegions(leftOffset, rightOffset),
    [model, leftOffset, rightOffset],
  )

  const checkboxes: Checkboxes = {
      hg38: { 
          name: 'hg38',
          key: 1,
          label: 'hg38 - whole genome assembly',
      },
  }

  async function runSearch() {
    for (const bigsiName of selectedBigsis) {
        try {
            if (queryRegion.length > 0) {
                const results = await fetchSequence(model, queryRegion)
                const data = results.map(result => result.get('seq'))
                const querySequence = (data.join(''))
                const rawHits = await getBigsiRawHits(model, querySequence, bigsiName)
                //constructBigsiTrack(model, rawHits, querySequence)
                setLoading(false)
                const allFeatures = makeBigsiHitsFeatures(model, rawHits)
                if (Object.keys(allFeatures).length) {
                    const flashmapResultsWidget = activateFlashmapResultsWidget(model)
                    runMashmapOnBins(model, flashmapResultsWidget, allFeatures, queryId, querySequence)
                    setQueryId(() => queryId + 1)
                } else {
                    setError(new Error('Sequence not found!'))
                }
            }
        } catch(e) {
            setError(e)
        }
    }
  }

  const sequenceTooLarge = sequence.length > 300_000

  return (
    <Dialog
      data-testid="bigsi-dialog"
      maxWidth="xl"
      open
      onClose={handleClose}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
    >
      <DialogTitle id="alert-dialog-title">
        Sequence Search
        {handleClose ? (
          <IconButton
            data-testid="close-BigsiDialog"
            className={classes.closeButton}
            onClick={() => {
              handleClose()
              model.setOffsets(undefined, undefined)
            }}
          >
            <CloseIcon />
          </IconButton>
        ) : null}
      </DialogTitle>
      <Divider />

      <DialogContent>
        {error ? <Typography color="error">{`${error}`}</Typography> : null}
          <>
          <DialogContentText>Select target reference to search against</DialogContentText>
          <CheckboxContainer checkboxes={checkboxes} updateSelectedBigsis={setSelectedBigsis}/>
          </>
        {loading && !error ? (
          <Container> 
            Retrieving search hits...

            <CircularProgress
              style={{
                marginLeft: 10,
              }}
              size={20}
              disableShrink
            />
          </Container>
        ) : null }
      </DialogContent>
      <DialogActions>
        <Button
          onClick={async () => {
            if (selectedBigsis.length){
                setLoading(true)
                await runSearch()
                if (!loading) {
                    model.setOffsets(undefined, undefined)
                    handleClose()
                } else {
                    setError(new Error('Please select a reference to search against.'))
                }

            }
          }}
          color="primary"
          autoFocus
        >
          Run Search
        </Button>

        <Button
          onClick={() => {
            handleClose()
            model.setOffsets(undefined, undefined)
          }}
          color="primary"
          autoFocus
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default observer(BigsiDialog)
