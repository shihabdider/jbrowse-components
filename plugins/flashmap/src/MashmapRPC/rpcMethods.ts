import RpcMethodType from '@jbrowse/core/pluggableElementTypes/RpcMethodType'
import SerializableFilterChain from '@jbrowse/core/pluggableElementTypes/renderers/util/serializableFilterChain'
 
// just make sure to add your extra dependencies to plugins/linear-genome-view/package.json
import main from './mashmap_glue'
 
export class MashmapQueryRPC extends RpcMethodType {
  name = 'MashmapQueryRPC'
 
  async deserializeArguments(args: any) {
    const l = await super.deserializeArguments(args)
    return {
      ...l,
      filters: args.filters
        ? new SerializableFilterChain({
            filters: args.filters,
          })
        : undefined,
    }
  }
 
  async execute(
    args: {
      refSequence: string,
      querySequence: string,
      sessionId: string
    },
  ) {
    const deserializedArgs = await this.deserializeArguments(args)
    const { refSequence, querySequence, sessionId } = deserializedArgs
    const results = await main(refSequence, querySequence)
    return results
  }
}
