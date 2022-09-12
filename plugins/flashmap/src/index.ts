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
