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
import { getSession } from '@jbrowse/core/util'
import { Feature } from '@jbrowse/core/util/simpleFeature'

import {
  LinearGenomeViewModel,
  BaseLinearDisplayModel,
} from '@jbrowse/plugin-linear-genome-view'

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
) {
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

  return response
}

function constructMashmapTrack(
    model: LinearGenomeViewModel,
    rawHits: string,
    refSeq: string,
){
    const mashmapQueryTrack = {
            trackId: `track-${Date.now()}`,
            name: `Mashmap Sequence Search`,
            assemblyNames: ['hg38'],
            type: 'FeatureTrack',
            adapter: {
                type: 'MashmapHitsAdapter',
                rawHits: rawHits,
                assemblyNames: ['hg38', 'hg38'],
            },
        }

    const session = getSession(model)
    session.addAssembly?.({
        name: 'Search reference sequence',
        sequence: {
          type: 'ReferenceSequenceTrack',
          trackId: `track-${Date.now()}`,
          assemblyNames: ['hg38'],
          adapter: {
            type: 'FromConfigSequenceAdapter',
            noAssemblyManager: true,
            features: [
              {
                start: 0,
                end: refSeq.length,
                seq: refSeq,
                refName: 1,
                uniqueId: `${Math.random()}`,
              },
            ],
          },
        },
      })
    console.log(mashmapQueryTrack)
    //session.addTrackConf(mashmapQueryTrack)

    //model.showTrack(mashmapQueryTrack.trackId)
}


function MashmapDialog({
  model,
  handleClose,
  feature,
}: {
  model: LinearGenomeViewModel
  handleClose: () => void
  feature: Feature
}) {
  const classes = useStyles()
  const session = getSession(model)
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState('')
  const [output, setOutput] = useState('')
  const [bucketStart, bucketEnd] = [feature.get('bucketStart'), feature.get('bucketEnd')]
  const querySequence = feature.get('querySequence')

  async function handleMashmapQuery(){
    setLoading('Extracting bucket sequence and query sequence...')
    // get reference sequence
    const bucketCoords = {
        leftOffset: feature.get('bucketStart'),
        rightOffset: feature.get('bucketEnd'),
    }
    const refSeq = await getBucketSequence(model, bucketCoords)
    // pass ref and query to mashmap rpc
    const sequences = {
        ref: refSeq[0].get('seq'),
        query: querySequence
    }
    setLoading('Running MashMap for refined sequence search...')
    const mashmapHits = await getMashmapRawHits(model, sequences)
    setLoading('')
    setOutput(mashmapHits)
    // clean up mashmap output via data adapter
    constructMashmapTrack(model, mashmapHits, sequences.query)
    // summon synteny view with mashmap results
    // close dialog
    //handleClose()
  }

  useEffect(() => {
    handleMashmapQuery()
  }, [])

  return (
    <Dialog
      data-testid="mashmap-dialog"
      maxWidth="xl"
      open
      onClose={handleClose}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
    >
      <DialogTitle id="alert-dialog-title">
        Refined Sequence Search
        {handleClose ? (
          <IconButton
            data-testid="close-BigsiDialog"
            className={classes.closeButton}
            onClick={() => {
              handleClose()
            }}
          >
            <CloseIcon />
          </IconButton>
        ) : null}
      </DialogTitle>
      <Divider />

      <DialogContent>
        {error ? <Typography color="error">{`${error}`}</Typography> : null}
        {loading && !error ? (
          <Container> 
            {loading}
            <CircularProgress
              style={{
                marginLeft: 10,
              }}
              size={20}
              disableShrink
            />
          </Container>
        ) : null }
        {output ? (<DialogContentText>{output}</DialogContentText>) : null}
      </DialogContent>
    </Dialog>
  )
}

export default observer(MashmapDialog)
