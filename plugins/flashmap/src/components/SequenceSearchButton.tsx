import React, { useState } from 'react'
import { Region } from '@jbrowse/core/util/types'
import { readConfObject } from '@jbrowse/core/configuration'
import { getSession } from '@jbrowse/core/util'
import { Feature } from '@jbrowse/core/util/simpleFeature'
import { observer } from 'mobx-react'
import Button from '@material-ui/core/Button'
import CloseIcon from '@material-ui/icons/Close'
import Search from '@material-ui/icons/Search'
import { makeStyles } from '@material-ui/core/styles'
import { fade } from '@material-ui/core/styles/colorManipulator'
import { getRoot } from 'mobx-state-tree'
import { FileSelector } from '@jbrowse/core/ui'
import { isSessionModelWithWidgets } from '@jbrowse/core/util'
import { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'
import hg38BigsiConfig from '../BigsiRPC/bigsi-maps/hg38_whole_genome_bucket_map.json'

/* eslint-disable no-nested-ternary */
import {
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
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
}))


function makeBigsiHitsFeatures(
  model: any,
  response: any,
) {

  const refName =
    model.leftOffset?.refName || model.rightOffset?.refName || ''

  let uniqueId = 0
  const allFeatures = []
  const bucketmap = hg38BigsiConfig.bucketMap
  for (const bucket in response) {
    const bucketNum = parseInt(bucket)
    const bigsiFeatures = response[bucketNum]
    bigsiFeatures.uniqueId = uniqueId
    bigsiFeatures.bucketStart = bucketmap[bucketNum].bucketStart
    bigsiFeatures.bucketEnd = bucketmap[bucketNum].bucketEnd
    bigsiFeatures.name = `${bucketmap[bucketNum].refName}:${bucketmap[bucketNum].bucketStart}-${bucketmap[bucketNum].bucketEnd}`
    bigsiFeatures.refName = bucketmap[bucketNum].refName
    allFeatures.push(bigsiFeatures)
    uniqueId++
    }

  return allFeatures
}

async function getBucketSequence(
  model: LinearGenomeViewModel,
  bucketRegion: { leftOffset: number; rightOffset: number },
) {
  console.log('bucketRegion', bucketRegion)
  const session = getSession(model)
  const { rpcManager, assemblyManager } = session
  const leftOffset = { offset: bucketRegion.leftOffset, index: 0 }
  const rightOffset = { offset: bucketRegion.rightOffset, index: 0 }
  const selectedRegions: Region[] = model.getSelectedRegions(
    leftOffset,
    rightOffset,
  )
  console.log('regions', selectedRegions)
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
        console.log('row, columns', row, columns)
        results.push(row)
    }
  }
  return results
}

async function activateFlashmapResultsWidget(
  model: LinearGenomeViewModel, 
  allFeatures: any[], 
  querySeq: string
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

        let id = 1
        for (const bin of allFeatures){
            const binCoords = { 
              leftOffset: bin.bucketStart,
              rightOffset: bin.bucketEnd,
            }
            const mashmapRawHits = await handleMashmapQuery(model, querySeq, binCoords)
            const mashmapHits = parseMashmapResults(mashmapRawHits)
            for (const hit of mashmapHits) {
                const region = {
                id: id,
                assemblyName: 'hg38',
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
            id++
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


function SequenceSearchButton({ model }: { model: any }) {
  const classes = useStyles()
  const session = getSession(model)
  const { rpcManager, assemblyNames } = session
  const bigsiName = 'hg38'

  const [trigger, setTrigger] = useState(false);
  const [sequence, setSequence] = useState('');
  const [results, setResults] = useState();
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error>()

  function handleClose() {
    setLoading(false)
    setError(undefined)
    setSequence('')
    setResults(undefined)
    setTrigger(false)
  }

  async function runBigsiQuery(){
    const sessionId = 'bigsiQuery'
    const querySequence = cleanSequence(sequence)
    const params = {
        sessionId,
        querySequence,
        bigsiName 
    }
    const results = await rpcManager.call(
    sessionId,
    "BigsiQueryRPC",
    params
    );
    const allFeatures = makeBigsiHitsFeatures(model, results)
    return allFeatures
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
              <DialogContentText>
                Paste your sequence below to search against the reference or upload a FASTA file.
              </DialogContentText>
              {error ? (<DialogContentText> {error.message} </DialogContentText>) : null }

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
            </DialogContent>
        </>
        <DialogActions>
            <Button
              onClick={
                async () => {
                  setLoading(true)
                  const allFeatures = await runBigsiQuery(); 
                  await activateFlashmapResultsWidget(model, allFeatures, sequence)
                  handleClose() 
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
