import React from 'react'
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
import { getSession } from '@jbrowse/core/util'
import DisplayType from '@jbrowse/core/pluggableElementTypes/DisplayType'
import ViewType from '@jbrowse/core/pluggableElementTypes/ViewType'
import { PluggableElementType } from '@jbrowse/core/pluggableElementTypes'
import {
  LinearGenomeViewModel,
  BaseLinearDisplayModel,
} from '@jbrowse/plugin-linear-genome-view'

import ZoomInIcon from '@material-ui/icons/ZoomIn'

import BigsiDialog from './components/BigsiDialog'
import SequenceSearchButton from './components/SequenceSearchButton'
import MyDialog from './components/MyDialog'
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

    pluginManager.addToExtensionPoint(
      'Core-extendPluggableElement',
      (pluggableElement: PluggableElementType) => {
        if (pluggableElement.name === 'LinearGenomeView') {
          const { stateModel } = pluggableElement as ViewType
          const newStateModel = stateModel.extend(
            (self: LinearGenomeViewModel) => {
              const superRubberBandMenuItems = self.rubberBandMenuItems
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
                  rubberBandMenuItems() {
                    const newRubberBandMenuItems = [
                      ...superRubberBandMenuItems(),
                      {
                        label: 'Sequence Search',
                        icon: ZoomInIcon,
                        onClick: () => {
                          const { leftOffset, rightOffset } = self
                          const selectedRegions = self.getSelectedRegions(
                            leftOffset,
                            rightOffset,
                          )

                          getSession(self).queueDialog(doneCallback => [
                            BigsiDialog,
                            {
                              model: self,
                              handleClose: doneCallback,
                            },
                          ])
                        },
                      },
                    ]

                    return newRubberBandMenuItems
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

    pluginManager.addToExtensionPoint(
      'Core-extendPluggableElement',
      (pluggableElement: PluggableElementType) => {
        console.log(pluggableElement.name)
        if (pluggableElement.name === 'LinearGenomeView') {
          console.log('baselinerdisplay', pluggableElement.name)
          const { stateModel } = pluggableElement as ViewType
          const newStateModel = stateModel.extend(
            (self: BaseLinearDisplayModel) => {
              const superContextMenuItems = self.contextMenuItems
              console.log('contextMenuItem', superContextMenuItems)
              return {
                views: {
                  contextMenuItems() {
                    const newContextMenuItems = [
                      ...superContextMenuItems(),
                      {
                        label: 'Refined sequence search',
                        icon: ZoomInIcon,
                        onClick: () => {
                          console.log('mashmap dummy result')
                        },
                      },
                    ]

                    return newContextMenuItems
                  },
                },
              }
            },
          )
          ;(pluggableElement as DisplayType).stateModel = newStateModel
        }

        return pluggableElement
      },
    )

    pluginManager.addRpcMethod(() => new BigsiQueryRPC(pluginManager))
    pluginManager.addRpcMethod(() => new MashmapQueryRPC(pluginManager))
  }
}
