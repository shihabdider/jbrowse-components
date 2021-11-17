import RpcMethodType from '@jbrowse/core/pluggableElementTypes/RpcMethodType'
import SerializableFilterChain from '@jbrowse/core/pluggableElementTypes/renderers/util/serializableFilterChain'

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

  async execute(args: { ref: string; query: string; sessionId: string }) {
    const deserializedArgs = await this.deserializeArguments(args)
    const { ref, query, sessionId } = deserializedArgs
    const refSequence = '>ref\n' + ref
    const querySequence = '>query\n' + query
    console.log(
      'refseq length',
      refSequence.length,
      'query seq length: ',
      querySequence.length,
    )
    const results = await main(refSequence, querySequence)
    console.log(results.split(' '))
    return results
  }
}
