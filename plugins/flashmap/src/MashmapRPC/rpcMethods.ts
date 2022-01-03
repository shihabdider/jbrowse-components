import RpcMethodType from '@jbrowse/core/pluggableElementTypes/RpcMethodType'
import SerializableFilterChain from '@jbrowse/core/pluggableElementTypes/renderers/util/serializableFilterChain'

import main from './mashmap_glue'

export class MashmapQueryRPC extends RpcMethodType {
  name = 'MashmapQueryRPC'

  async deserializeArguments(args: any) {
    const l = await super.deserializeArguments(args, 'MashmapQueryRPC')
    return {
      ...l,
      filters: args.filters
        ? new SerializableFilterChain({
            filters: args.filters,
          })
        : undefined,
    }
  }

  async execute(args: {
    ref: string
    query: string
    percIdentity: string
    sessionId: string
  }): Promise<string> {
    const deserializedArgs = await this.deserializeArguments(args)
    const { ref, query, percIdentity, sessionId } = deserializedArgs
    const refSequence = '>ref\n' + ref
    const querySequence = '>query\n' + query
    const results = await main(refSequence, querySequence, percIdentity)
    return results
  }
}
