import React, { useState } from 'react'
import { getSession } from '@jbrowse/core/util'
import { observer } from 'mobx-react'
import Button from '@material-ui/core/Button'
import CloseIcon from '@material-ui/icons/Close'
import Search from '@material-ui/icons/Search'
import { makeStyles } from '@material-ui/core/styles'
import { fade } from '@material-ui/core/styles/colorManipulator'
import { getRoot } from 'mobx-state-tree'
import { FileSelector } from '@jbrowse/core/ui'
import bucketmap from '../BigsiRPC/bigsi-maps/hg38_chr1_bucket_map.json'

/* eslint-disable no-nested-ternary */
import {
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
  for (let bucket of response) {
    const bigsiFeatures = response[bucket]
    bigsiFeatures.uniqueId = uniqueId
    bigsiFeatures.bucketStart = bucketmap[bucket].bucketStart
    bigsiFeatures.bucketEnd = bucketmap[bucket].bucketEnd
    bigsiFeatures.name = `${bucketmap[bucket].refName}:${bucketmap[bucket].bucketStart}-${bucketmap[bucket].bucketEnd}`
    bigsiFeatures.refName = refName
    allFeatures.push(bigsiFeatures)
    uniqueId++
    }

  return allFeatures
}

function cleanSequence(sequence: string){
  const seqNoHeader = sequence.replace(/^>.*/,'');
  const cleanSeq = seqNoHeader.replace(/\r?\n|\r/g, '')

  return cleanSeq
}


function SequenceSearchButton({ model }: { model: any }) {
  const classes = useStyles()
  const session = getSession(model)
  const { rpcManager, assemblyManager } = session

  const [trigger, setTrigger] = useState(false);
  const [sequence, setSequence] = useState("");
  const [results, setResults] = useState();

  async function runBigsiQuery(){
    const sessionId = 'bigsiQuery'
    const querySequence = cleanSequence(sequence)
    const params = {
        sessionId,
        querySequence
    }
    const results = await rpcManager.call(
    sessionId,
    "BigsiQueryRPC",
    params
    );
    console.log(results);
    setResults(results);
    const allFeatures = makeBigsiHitsFeatures(model, results)
    console.log('bucket map', allFeatures)
    setTrigger(false) // closes the dialog if you want, or skip this and display the results in the dialog
  }
  
  function handleFileChange(event){
      const file = event.target.files[0]
      const reader = new FileReader()
      reader.readAsText(file)
      reader.onload = () => {
        setSequence(reader.result)
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

            <input type="file" accept=".fna,.fa,.fasta,.FASTA" onChange={handleFileChange}></input>
            <TextField
                label="Query Sequence"
                variant="outlined"
                value={sequence}
                multiline
                rows={3}
                rowsMax={5}
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
            </DialogContent>
        </>
        <DialogActions>
            <Button
            onClick={runBigsiQuery}
            >
            Submit
            </Button>

            <Button onClick={() => setTrigger(false)} color="primary" autoFocus>
              Close
            </Button>
          </DialogActions>
      </Dialog>

      </>
      )
  }
  

export default observer(SequenceSearchButton)
