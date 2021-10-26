import React, { useState, useEffect } from 'react'
import { observer } from 'mobx-react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Typography,
} from '@material-ui/core'
import { getSession } from '@jbrowse/core/util'
import { readConfObject } from '@jbrowse/core/configuration'

/**
 * Fetches and returns a list features for a given list of regions
 */
async function fetchSequence(model: any, regions: any[], signal?: AbortSignal) {
  const session = getSession(model)
  const { leftOffset, rightOffset } = model

  if (!leftOffset || !rightOffset) {
    throw new Error('no offsets on model to use for range')
  }

  if (leftOffset.assemblyName !== rightOffset.assemblyName) {
    throw new Error('not able to fetch sequences from multiple assemblies')
  }
  const { rpcManager, assemblyManager } = session
  const assemblyName = leftOffset.assemblyName || rightOffset.assemblyName || ''
  const assembly = assemblyManager.get(assemblyName)
  if (!assembly) {
    throw new Error(`assembly ${assemblyName} not found`)
  }
  const adapterConfig = readConfObject(assembly.configuration, [
    'sequence',
    'adapter',
  ])

  const sessionId = 'getSequence'
  const chunks = (await Promise.all(
    regions.map(region =>
      rpcManager.call(sessionId, 'CoreGetFeatures', {
        adapterConfig,
        region,
        sessionId,
        signal,
      }),
    ),
  )) as any[][]

  // assumes that we get whole sequence in a single getFeatures call
  return chunks.map(chunk => chunk[0])
}

const MyDialog = ({ model, selectedRegions, handleClose }: any) => {
  const [sequence, setSequence] = useState()
  useEffect(() => {
    ;(async () => {
      const results = await fetchSequence(model, selectedRegions)
      const data = results.map(result => result.get('seq'))
      setSequence(data.join(','))
      console.log({ data })
    })()
  }, [model, selectedRegions])
  return (
    <Dialog open onClose={handleClose}>
      <DialogTitle>Hello</DialogTitle>
      <DialogContent>
        <Typography>Fetched sequence:</Typography>
        <pre>{sequence}</pre>
        {selectedRegions.map(r => `${r.refName}:${r.start}-${r.end}`).join(',')}
      </DialogContent>
    </Dialog>
  )
}

export default observer(MyDialog)
