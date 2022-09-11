import RpcMethodType from '@jbrowse/core/pluggableElementTypes/RpcMethodType'
import SerializableFilterChain from '@jbrowse/core/pluggableElementTypes/renderers/util/serializableFilterChain'

import { main } from './query_bigsi'

export class BigsiQueryRPC extends RpcMethodType {
  name = 'BigsiQueryRPC'

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
      sessionId: string
      querySequence: string
      bigsiName: string
      subrate: number
    },
    rpcDriverClassName: string,
  ) {
    const deserializedArgs = await this.deserializeArguments(
      args,
      rpcDriverClassName,
    )
    const { sessionId, querySequence, bigsiName, subrate } = deserializedArgs

    const results = await main(querySequence, bigsiName, subrate)
    return results
  }
}
