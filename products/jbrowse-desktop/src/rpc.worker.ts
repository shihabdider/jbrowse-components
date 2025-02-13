/* eslint-disable no-restricted-globals, no-console, react-hooks/rules-of-hooks */
import './workerPolyfill'

import RpcServer from 'librpc-web-mod'
import { useStaticRendering } from 'mobx-react'

import PluginManager from '@jbrowse/core/PluginManager'
import { remoteAbortRpcHandler } from '@jbrowse/core/rpc/remoteAbortSignals'
import { isAbortException } from '@jbrowse/core/util'
import RpcMethodType from '@jbrowse/core/pluggableElementTypes/RpcMethodType'
import PluginLoader, { PluginDefinition } from '@jbrowse/core/PluginLoader'
import corePlugins from './corePlugins'

// prevent mobx-react from doing funny things when we render in the worker.
// but only if we are running in the browser.  in node tests, leave it alone.
if (typeof __webpack_require__ === 'function') {
  useStaticRendering(true)
}

interface WorkerConfiguration {
  plugins: PluginDefinition[]
}

let jbPluginManager: PluginManager | undefined

// waits for a message from the main thread containing our configuration,
// which must be sent on boot
function receiveConfiguration(): Promise<WorkerConfiguration> {
  return new Promise(resolve => {
    // listen for the configuration
    self.onmessage = (event: MessageEvent) => {
      resolve(event.data as WorkerConfiguration)
      self.onmessage = () => {}
    }
  })
}

async function getPluginManager() {
  if (jbPluginManager) {
    return jbPluginManager
  }
  // Load runtime plugins
  const config = await receiveConfiguration()
  const pluginLoader = new PluginLoader(config.plugins)
  pluginLoader.installGlobalReExports(self)
  const runtimePlugins = await pluginLoader.load()
  const plugins = [...corePlugins.map(p => ({ plugin: p })), ...runtimePlugins]
  const pluginManager = new PluginManager(
    plugins.map(({ plugin: P }) => new P()),
  )
  pluginManager.createPluggableElements()
  pluginManager.configure()
  jbPluginManager = pluginManager
  return pluginManager
}

const logBuffer: [string, ...unknown[]][] = []
function flushLog() {
  if (logBuffer.length) {
    for (const l of logBuffer) {
      const [head, ...rest] = l
      if (head === 'rpc-error') {
        console.error(head, ...rest)
      } else {
        console.log(head, ...rest)
      }
    }
    logBuffer.length = 0
  }
}
setInterval(flushLog, 1000)

interface WrappedFuncArgs {
  rpcDriverClassName: string
  channel: string
  [key: string]: unknown
}

let callCounter = 0
function wrapForRpc(
  func: (args: unknown, rpcDriverClassName: string) => unknown,
  funcName: string = func.name,
) {
  return (args: WrappedFuncArgs) => {
    callCounter += 1
    const myId = callCounter
    // logBuffer.push(['rpc-call', myId, funcName, args])
    const retP = Promise.resolve()
      .then(() => getPluginManager())
      .then(() =>
        func(
          {
            ...args,
            statusCallback: (message: string) => {
              // @ts-ignore
              self.rpcServer.emit(args.channel, message)
            },
          },
          args.rpcDriverClassName,
        ),
      )
      .catch(error => {
        if (isAbortException(error)) {
          // logBuffer.push(['rpc-abort', myId, funcName, args])
        } else {
          logBuffer.push(['rpc-error', myId, funcName, error])
          flushLog()
        }
        throw error
      })

    // uncomment below to log returns
    // retP.then(
    //   result => logBuffer.push(['rpc-return', myId, funcName, result]),
    //   err => {},
    // )

    return retP
  }
}

getPluginManager()
  .then(pluginManager => {
    const rpcConfig: { [methodName: string]: Function } = {}
    const rpcMethods = pluginManager.getElementTypesInGroup('rpc method')
    rpcMethods.forEach(rpcMethod => {
      if (!(rpcMethod instanceof RpcMethodType)) {
        throw new Error('invalid rpc method??')
      }

      rpcConfig[rpcMethod.name] = wrapForRpc(
        rpcMethod.execute.bind(rpcMethod),
        rpcMethod.name,
      )
    })

    // @ts-ignore
    self.rpcServer = new RpcServer.Server({
      ...rpcConfig,
      ...remoteAbortRpcHandler(),
      ping: () => {}, // < the ping method is required by the worker driver for checking the health of the worker
    })
  })
  .catch(error => {
    // @ts-ignore
    self.rpcServer = new RpcServer.Server({
      ping: () => {
        throw error
      },
    })
  })
