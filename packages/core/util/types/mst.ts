import shortid from 'shortid'
import { types } from 'mobx-state-tree'
import propTypes from 'prop-types'
import { PropTypes as MxPropTypes } from 'mobx-react'

export const ElementId = types.optional(types.identifier, shortid.generate)

// PropTypes that are useful when working with instances of these in react components
export const PropTypes = {
  Region: propTypes.shape({
    refName: propTypes.string.isRequired,
    start: propTypes.number.isRequired,
    end: propTypes.number.isRequired,
  }),
  ConfigSchema: MxPropTypes.objectOrObservableObject,
  Feature: propTypes.shape({
    get: propTypes.func.isRequired,
    id: propTypes.func.isRequired,
  }),
}

export const NoAssemblyRegion = types
  .model('NoAssemblyRegion', {
    refName: types.string,
    start: types.number,
    end: types.number,
    reversed: types.optional(types.boolean, false),
  })
  .actions(self => ({
    setRefName(newRefName: string): void {
      self.refName = newRefName
    },
  }))

export const Region = types.compose(
  'Region',
  NoAssemblyRegion,
  types.model({
    assemblyName: types.string,
  }),
)

export const LocalPathLocation = types.model('LocalPathLocation', {
  locationType: types.literal('LocalPathLocation'),
  localPath: types.string,
})

// like how blobId is used to get a blob map
export const BlobLocation = types.model('BlobLocation', {
  locationType: types.literal('BlobLocation'),
  name: types.string,
  blobId: types.string,
})

export const UriLocationRaw = types.model('UriLocation', {
  locationType: types.literal('UriLocation'),
  uri: types.string,
  baseUri: types.maybe(types.string),

  internetAccountId: types.maybe(types.string),

  // auths information (such as tokens) needed for using this resource.
  // if provided, these must be completely sufficient for using it
  internetAccountPreAuthorization: types.maybe(
    types.model('InternetAccountPreAuthorization', {
      internetAccountType: types.string,
      authInfo: types.frozen(),
    }),
  ),
})

export const UriLocation = types.snapshotProcessor(UriLocationRaw, {
  postProcessor: snap => {
    const { baseUri, ...rest } = snap
    if (!baseUri) {
      return rest
    }
    return snap
  },
})

export const FileLocation = types.snapshotProcessor(
  types.union(LocalPathLocation, UriLocation, BlobLocation),
  {
    // @ts-ignore
    preProcessor(snapshot) {
      if (!snapshot) {
        return undefined
      }

      // @ts-ignore
      const { locationType, ...rest } = snapshot
      if (!locationType) {
        // @ts-ignore
        const { uri, localPath, blob } = rest
        let locationType = ''
        if (uri) {
          locationType = 'UriLocation'
        } else if (localPath) {
          locationType = 'LocalPathLocation'
        } else if (blob) {
          locationType = 'BlobLocation'
        }

        return { ...rest, locationType }
      }
      return snapshot
    },
  },
)
