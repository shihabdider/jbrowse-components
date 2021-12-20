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
  console.log(response)
  for (const bucket in response) {
    const bucketNum = parseInt(bucket)
    const bigsiFeatures = response[bucketNum]
    bigsiFeatures.uniqueId = uniqueId
    bigsiFeatures.bucketStart = bucketmap[bucketNum].bucketStart
    bigsiFeatures.bucketEnd = bucketmap[bucketNum].bucketEnd
    bigsiFeatures.name = `${bucketmap[bucketNum].refName}:${bucketmap[bucketNum].bucketStart}-${bucketmap[bucketNum].bucketEnd}`
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
    console.log(allFeatures)
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
                  await runBigsiQuery(); 
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
