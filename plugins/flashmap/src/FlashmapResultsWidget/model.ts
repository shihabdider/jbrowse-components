import { types, cast, Instance } from 'mobx-state-tree'
import PluginManager from '@jbrowse/core/PluginManager'
import { Region } from '@jbrowse/core/util/types'
import { Region as RegionModel, ElementId } from '@jbrowse/core/util/types/mst'

const LabeledRegionModel = types
  .compose(
    RegionModel,
    types.model({
      id: types.number,
      queryName: types.string,
      queryStart: types.number,
      queryEnd: types.number,
      strand: types.string,
      score: types.number,
    }),
  )
  .actions(self => ({
    setScore(score: number) {
      self.score = score
    },
  }))

export default function f(pluginManager: PluginManager) {
  return types
    .model('FlashmapResultsModel', {
      id: ElementId,
      type: types.literal('FlashmapResultsWidget'),
      view: types.safeReference(
        pluginManager.pluggableMstType('view', 'stateModel'),
      ),
      mappedRegions: types.array(LabeledRegionModel),
      isLoading: false,
      numBinsHit: 0,
      currentBin: 0,
      modelSelectedAssembly: '',
    })
    .actions(self => ({
      addMappedRegion(region: Region) {
        self.mappedRegions.push(region)
      },
      toggleIsLoading() {
        self.isLoading = !self.isLoading
      },
      setNumBinsHit(bins: number) {
        self.numBinsHit = bins
      },
      setCurrentBin(binNumber: number) {
        self.currentBin = binNumber
      },
    }))
    .views(self => ({
      get selectedAssembly() {
        return (
          self.modelSelectedAssembly ||
          (self.mappedRegions.length ? self.mappedRegions[0].assemblyName : '')
        )
      },
      get assemblies() {
        return [
          ...new Set(self.mappedRegions.map(region => region.assemblyName)),
        ]
      },
    }))
}

export type FlashmapResultsStateModel = ReturnType<typeof f>
export type FlashmapResultsModel = Instance<FlashmapResultsStateModel>
