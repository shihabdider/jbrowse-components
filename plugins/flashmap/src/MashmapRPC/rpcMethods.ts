import RpcMethodType from '@jbrowse/core/pluggableElementTypes/RpcMethodType'
import SerializableFilterChain from '@jbrowse/core/pluggableElementTypes/renderers/util/serializableFilterChain'

import main from './mashmap_glue'

export class MashmapQueryRPC extends RpcMethodType {
  name = 'MashmapQueryRPC'

  async deserializeArguments(args: any, rpcDriverClassName: string) {
    const l = await super.deserializeArguments(args, rpcDriverClassName)
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
      refSketchName: string
      query: string
      percIdentity: string
      sessionId: string
    },
    rpcDriverClassName: string,
  ): Promise<string> {
    const deserializedArgs = await this.deserializeArguments(
      args,
      rpcDriverClassName,
    )
    const { refSketchName, query, percIdentity, sessionId } = deserializedArgs
    const querySequence = '>query\n' + query
    const results = await main(refSketchName, querySequence, percIdentity)
    return results
  }
}
