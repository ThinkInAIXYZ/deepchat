import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  pluginsDisableRoute,
  pluginsEnableRoute,
  pluginsGetRoute,
  pluginsInvokeActionRoute,
  pluginsListRoute
} from '@shared/contracts/routes'
import type { PluginInvokeActionRequest } from '@shared/types/plugin'
import { getDeepchatBridge } from './core'

export function createPluginClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function listPlugins() {
    const result = await bridge.invoke(pluginsListRoute.name, {})
    return result.plugins
  }

  async function getPlugin(pluginId: string) {
    const result = await bridge.invoke(pluginsGetRoute.name, { pluginId })
    return result.plugin
  }

  async function enablePlugin(pluginId: string) {
    const result = await bridge.invoke(pluginsEnableRoute.name, { pluginId })
    return result.result
  }

  async function disablePlugin(pluginId: string) {
    const result = await bridge.invoke(pluginsDisableRoute.name, { pluginId })
    return result.result
  }

  async function invokeAction(input: PluginInvokeActionRequest) {
    const result = await bridge.invoke(pluginsInvokeActionRoute.name, input)
    return result.result
  }

  return {
    listPlugins,
    getPlugin,
    enablePlugin,
    disablePlugin,
    invokeAction
  }
}

export type PluginClient = ReturnType<typeof createPluginClient>
