import React from 'react'
import WidgetType from '@jbrowse/core/pluggableElementTypes/WidgetType'
import Plugin from '@jbrowse/core/Plugin'
import AdapterType from '@jbrowse/core/pluggableElementTypes/AdapterType'
import PluginManager from '@jbrowse/core/PluginManager'
import {
  BigsiHitsAdapterClass,
  BigsiHitsSchema,
  MashmapHitsConfigAdapterClass,
  MashmapHitsConfigSchema,
  MashmapOutputAdapterClass,
  MashmapOutputSchema,
} from './FlashmapAdapter'

import { Region } from '@jbrowse/core/util/types'
import { Feature } from '@jbrowse/core/util/simpleFeature'
import { readConfObject } from '@jbrowse/core/configuration'
import { getSession } from '@jbrowse/core/util'
import { ConfigurationModel } from '@jbrowse/core/configuration/configurationSchema'

import DisplayType from '@jbrowse/core/pluggableElementTypes/DisplayType'
import ViewType from '@jbrowse/core/pluggableElementTypes/ViewType'
import { PluggableElementType } from '@jbrowse/core/pluggableElementTypes'
import {
  LinearGenomeViewModel,
  BaseLinearDisplayModel,
} from '@jbrowse/plugin-linear-genome-view'

import ZoomInIcon from '@material-ui/icons/ZoomIn'

import BigsiDialog from './components/BigsiDialog'
import MashmapDialog from './components/MashmapDialog'
import SequenceSearchButton from './components/SequenceSearchButton'
import {
  stateModelFactory as FlashmapResultsStateModelFactory,
  configSchema as FlashmapResultsConfigSchema,
} from './FlashmapResultsWidget'
import { BigsiQueryRPC } from './BigsiRPC/rpcMethods'
import { MashmapQueryRPC } from './MashmapRPC/rpcMethods'

async function getBucketSequence(
  model: any,
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

async function runMashmap(
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

export default class extends Plugin {
  name = 'FlashmapPlugin'

  install(pluginManager: PluginManager) {
    pluginManager.addAdapterType(
      () =>
        new AdapterType({
          name: 'BigsiHitsAdapter',
          configSchema: BigsiHitsSchema,
          AdapterClass: BigsiHitsAdapterClass,
        }),
    )

    pluginManager.addAdapterType(
      () =>
        new AdapterType({
          name: 'MashmapHitsConfigAdapter',
          configSchema: MashmapHitsConfigSchema,
          AdapterClass: MashmapHitsConfigAdapterClass,
        }),
    )

    pluginManager.addAdapterType(
      () =>
        new AdapterType({
          name: 'MashmapOutputAdapterClass',
          configSchema: MashmapOutputSchema,
          AdapterClass: MashmapOutputAdapterClass,
        }),
    )

    pluginManager.addWidgetType(() => {
      return new WidgetType({
        name: 'FlashmapResultsWidget',
        heading: 'Flashmap results',
        configSchema: FlashmapResultsConfigSchema,
        stateModel: FlashmapResultsStateModelFactory(pluginManager),
        ReactComponent: React.lazy(
          () =>
            import('./FlashmapResultsWidget/components/FlashmapResultsWidget'),
        ),
      })
    })

    let lgv: LinearGenomeViewModel | null
    pluginManager.addToExtensionPoint(
      'Core-extendPluggableElement',
      (pluggableElement: PluggableElementType) => {
        if (pluggableElement.name === 'LinearGenomeView') {
          const { stateModel } = pluggableElement as ViewType
          const newStateModel = stateModel.extend(
            (self: LinearGenomeViewModel) => {
              lgv = self
              const superHeaderButtons = self.extraHeaderButtons
              return {
                views: {
                  extraHeaderButtons() {
                    const newHeaderButtons = [
                      ...superHeaderButtons(),
                      {
                        label: 'Sequence Search',
                        component: SequenceSearchButton,
                      },
                    ]

                    return newHeaderButtons
                  },
                },
              }
            },
          )

          ;(pluggableElement as ViewType).stateModel = newStateModel
        }

        return pluggableElement
      },
    )

    pluginManager.addRpcMethod(() => new BigsiQueryRPC(pluginManager))
    pluginManager.addRpcMethod(() => new MashmapQueryRPC(pluginManager))
  }
}
