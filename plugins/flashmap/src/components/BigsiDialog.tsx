import React, { useEffect, useMemo, useState } from 'react'
import { observer } from 'mobx-react'
import { Region } from '@jbrowse/core/util/types'
import { readConfObject } from '@jbrowse/core/configuration'
import { makeStyles } from '@material-ui/core/styles'
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Container,
  Typography,
  Divider,
  IconButton,
} from '@material-ui/core'
import CloseIcon from '@material-ui/icons/Close'
import { getSession } from '@jbrowse/core/util'
import { Feature } from '@jbrowse/core/util/simpleFeature'
//import bigsi from './bigsi/bigsis/hg38_chr1and2.json'
//import hexBigsi from './bigsi/bigsis/hg38_hex.json'
//import bucketmap from './bigsi/bigsis/hg38_bucket_map.json'
import bucketmap from '../BigsiRPC/bigsis/hg38_16int_bucket_map.json'

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

function makeBigsiHitsFeatures(
  offsets: any,
  response: any,
) {

  console.log('raw response', response)
  const refName =
    offsets.leftOffset?.refName || offsets.rightOffset?.refName || ''

  const numBuckets = 16
  const featureLength = (offsets.rightOffset.coord - offsets.leftOffset.coord)/numBuckets

  let uniqueId = 0
  const allFeatures = []
  for (let bucket in response) {
    const bigsiFeatures = response[bucket]
    bigsiFeatures.uniqueId = uniqueId
    bigsiFeatures.bucketStart = bucketmap[bucket].bucketStart
    bigsiFeatures.bucketEnd = bucketmap[bucket].bucketEnd
    bigsiFeatures.name = `${bucketmap[bucket].refName}:${bucketmap[bucket].bucketStart}-${bucketmap[bucket].bucketEnd}`
    bigsiFeatures.start = offsets.leftOffset.coord + (parseInt(bucket%10) * featureLength)
    bigsiFeatures.end = bigsiFeatures.start + featureLength - 1
    bigsiFeatures.refName = refName
    allFeatures.push(bigsiFeatures)
    uniqueId++
    }

  return allFeatures
}

async function getBigsiHitsFeatures(
  model: any,
  querySequence: string,
) {
  const session = getSession(model)
  const { rpcManager } = session

  const sessionId = 'bigsiQuery'

  const params = {
    sessionId,
    querySequence
  }
  const response = await rpcManager.call(
        sessionId,
        "BigsiQueryRPC",
        params
  )


  const { leftOffset, rightOffset } = model
  const offsets = { leftOffset, rightOffset }
  const allFeatures = makeBigsiHitsFeatures(offsets, response)

    return allFeatures

  };
       

function constructBigsiTrack(
    self: any,
    allFeatures: object[],
){
    const refName =
      self.leftOffset?.refName || self.rightOffset?.refName || ''

    const assemblyName = 
      self.leftOffset?.assemblyName || self.rightOffset?.assemblyName

    const bigsiQueryTrack = {
            trackId: `track-${Date.now()}`,
            name: `Sequence Search ${assemblyName}:Chr${refName}:${self.leftOffset.coord}-${self.rightOffset.coord}`,
            assemblyNames: ['hg38'],
            type: 'FeatureTrack',
            adapter: {
                type: 'FromConfigAdapter',
                features: allFeatures,
                //features: [ { "refName": "1", "start":1, "end":200000, "uniqueId": "id1" }],
                },
            }

    const session = getSession(self)
    session.addTrackConf(bigsiQueryTrack)

    self.showTrack(bigsiQueryTrack.trackId)
    //console.log(response)
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

function BigsiDialog({
  model,
  handleClose,
}: {
  model: any
  handleClose: () => void
}) {
  const classes = useStyles()
  const session = getSession(model)
  const [error, setError] = useState<Error>()
  const [sequence, setSequence] = useState('')
  const loading = Boolean(!sequence) || Boolean(error)
  const { leftOffset, rightOffset } = model

  // avoid infinite looping of useEffect
  // random note: the current selected region can't be a computed because it
  // uses action on base1dview even though it's on the ephemeral base1dview
  const queryRegion = useMemo(
    () => model.getSelectedRegions(leftOffset, rightOffset),
    [model, leftOffset, rightOffset],
  )

  console.log('queryRegion', queryRegion)

  useEffect(() => {
    let active = true

    ;(async () => {
      try {
        if (queryRegion.length > 0) {
          const results = await fetchSequence(model, queryRegion)
          const data = results.map(result => result.get('seq'))
          const querySequence = (data.join(''))
          console.log('data', data)
          if (active) {
            console.log('querySequence', querySequence.length)
            const allFeatures = await getBigsiHitsFeatures(model, querySequence)
            console.log('allFeatures ', allFeatures)
            constructBigsiTrack(model, allFeatures)
            setSequence(querySequence)
          }
        } else {
          throw new Error('Selected region is out of bounds')
        }
      } catch (e) {
        console.error(e)
        if (active) {
          setError(e)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [model, session, queryRegion, setSequence])

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
        ) : <Container> Query complete! </Container> }
      </DialogContent>
      <DialogActions>
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
