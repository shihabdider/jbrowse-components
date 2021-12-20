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
) {
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
    session.addTrackConf(bigsiQueryTrack)

    self.showTrack(bigsiQueryTrack.trackId)
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


function CheckboxContainer({checkboxes, updateSelectedBigsis, ...props}){
    const initCheckedItems = Object.keys(checkboxes).reduce((acc, curr) => (acc[curr] = false, acc), {})
    const [checkedItems, setCheckedItems] = useState(initCheckedItems)

    const handleChange = (event) => { 
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
  const [error, setError] = useState<Error>()
  const [sequence, setSequence] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedBigsis, setSelectedBigsis] = useState([])
  const { leftOffset, rightOffset } = model

  // avoid infinite looping of useEffect
  // random note: the current selected region can't be a computed because it
  // uses action on base1dview even though it's on the ephemeral base1dview
  const queryRegion = useMemo(
    () => model.getSelectedRegions(leftOffset, rightOffset),
    [model, leftOffset, rightOffset],
  )

  const checkboxes = {
      hg38: { 
          name: 'hg38',
          key: 1,
          label: 'hg38 - whole genome assembly',
      },
  }

  const runSearch = async () => {
    let active = true
    for (const bigsiName of selectedBigsis) {
        try {
            if (queryRegion.length > 0) {
            const results = await fetchSequence(model, queryRegion)
            const data = results.map(result => result.get('seq'))
            const querySequence = (data.join(''))
            if (active) {
                const rawHits = await getBigsiRawHits(model, querySequence, bigsiName)
                constructBigsiTrack(model, rawHits, querySequence)
                setLoading(false)
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
      }
    return () => {
      active = false
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
        {!error ? (
          <>
          <DialogContentText>Select target reference to search against</DialogContentText>
          <CheckboxContainer checkboxes={checkboxes} updateSelectedBigsis={setSelectedBigsis}/>
          </>
        ) : null}
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
                model.setOffsets(undefined, undefined)
                handleClose()
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
