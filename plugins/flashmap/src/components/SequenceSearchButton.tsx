import React, { useState, useEffect } from 'react'
import { observer } from 'mobx-react'
import { getRoot } from 'mobx-state-tree'
import { Region } from '@jbrowse/core/util/types'
import { getSession, isSessionModelWithWidgets } from '@jbrowse/core/util'
import { Feature } from '@jbrowse/core/util/simpleFeature'
import { readConfObject } from '@jbrowse/core/configuration'
import { makeStyles } from '@material-ui/core/styles'
import { fade } from '@material-ui/core/styles/colorManipulator'
import { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'
import CloseIcon from '@material-ui/icons/Close'
import Search from '@material-ui/icons/Search'

import hg38BigsiConfig from '../BigsiRPC/bigsi-maps/hg38_whole_genome_bucket_map.json'

/* eslint-disable no-nested-ternary */
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
  FormControlLabel,
  FormGroup,
  IconButton,
  TextField,
} from '@material-ui/core'


const WIDGET_HEIGHT = 32
const SPACING = 7

const useStyles = makeStyles(theme => ({
  sequenceSearchButton: {
    background: fade(theme.palette.background.paper, 0.8),
    height: WIDGET_HEIGHT,
    margin: SPACING,
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
  errorContent: {
    color: 'red'
  }
}))


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

function cleanSequence(sequence: string){
  const seqNoHeader = sequence.replace(/^>.*/,'');
  const cleanSeq = seqNoHeader.replace(/\r?\n|\r/g, '')

  return cleanSeq
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
  
function SequenceSearchButton({ model }: { model: any }) {
  const classes = useStyles()
  const session = getSession(model)
  const { rpcManager, assemblyNames } = session
  const bigsiName = 'hg38'

  const [trigger, setTrigger] = useState(false);
  const [queryId, setQueryId] = useState(1)
  const [sequence, setSequence] = useState('');
  const [results, setResults] = useState();
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error>()
  const [selectedBigsis, setSelectedBigsis] = useState<Array<string>>([])

  const checkboxes: Checkboxes = {
      hg38: { 
          name: 'hg38',
          key: 1,
          label: 'hg38 - whole genome assembly',
      },
  }

  async function runSearch() {
    for (const bigsiName of selectedBigsis) {
        const rawHits = await getBigsiRawHits(model, sequence, bigsiName)
        setLoading(false)
        const allFeatures = makeBigsiHitsFeatures(model, rawHits)
        if (Object.keys(allFeatures).length) {
            const flashmapResultsWidget = activateFlashmapResultsWidget(model)
            runMashmapOnBins(model, flashmapResultsWidget, allFeatures, queryId, sequence)
            setQueryId(() => queryId + 1)
        } else {
            setError(new Error('Sequence not found!'))
        }
    }
  }

  function handleClose() {
    setLoading(false)
    setError(undefined)
    setSequence('')
    setResults(undefined)
    setTrigger(false)
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
      if (event.target.files) {
        const file = event.target.files[0]
        
        if (file.size >= 500 && file.size <= 300*1024) {
            const reader = new FileReader()
            reader.readAsText(file)
            reader.onload = () => {
              if (typeof reader.result === 'string') {
                const uploadedSeq: string = reader.result
                setSequence(uploadedSeq)
              } else {
                setError(new Error('Sequence must be a valid FASTA file'))
              }
            }
        } else {
            setError(new Error('Sequence must be between 500bp and 300Kbp.'))
        }
      }
  }

  return (
    <>
      <Button
        variant="outlined"
        className={classes.sequenceSearchButton}
        onClick={() => setTrigger(true)}
      >
        <Search />
      </Button>

      <Dialog 
        maxWidth="xl"
        open={trigger} 
        onClose={() => setTrigger(false)}>

          <DialogTitle>
            Sequence Search
            {trigger ? (
              <IconButton className={classes.closeButton} onClick={() => setTrigger(false)}>
                <CloseIcon />
              </IconButton>
            ) : null}
          </DialogTitle>
          <Divider />
        <>
            <DialogContent>
                <>
                <DialogContentText>Select target reference to search against</DialogContentText>
                <CheckboxContainer checkboxes={checkboxes} updateSelectedBigsis={setSelectedBigsis}/>
                </>
              <DialogContentText>
                Paste your sequence below to search against the reference or upload a FASTA file.
              </DialogContentText>

            <input type="file" accept=".fna,.fa,.fasta,.FASTA" onChange={handleFileChange}></input>
            <TextField
                label="Query Sequence"
                variant="outlined"
                value={sequence}
                multiline
                minRows={3}
                maxRows={5}
                fullWidth
                className={classes.dialogContent}
                onChange={() => { 
                    if (event) {
                        const target = event.target as HTMLTextAreaElement
                        setSequence(target.value)
                        }
                    }
                }
            />

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

            {error ? (<DialogContentText className={classes.errorContent}> {error.message} </DialogContentText>) : null }
            </DialogContent>
        </>
        <DialogActions>
            <Button
              onClick={
                async () => {
                  if (selectedBigsis.length) {
                        setLoading(true)
                        await runSearch(); 
                        if (!loading) {
                          handleClose()
                        }
                   } else {
                        setError(new Error('Please select a reference to search against.'))
                   }
                }
              }
            >
            Submit
            </Button>

            <Button onClick={handleClose} color="primary" autoFocus>
              Close
            </Button>
          </DialogActions>
      </Dialog>

      </>
      )
  }
  

export default observer(SequenceSearchButton)
