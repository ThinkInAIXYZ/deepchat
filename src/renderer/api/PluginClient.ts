import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  pluginsDeleteRoute,
  pluginsDisableRoute,
  pluginsEnableRoute,
  pluginsGetRoute,
  pluginsInstallFromFileRoute,
  pluginsInstallRoute,
  pluginsInvokeActionRoute,
  pluginsListRoute,
  pluginsOpenOfficialReleaseRoute
} from '@shared/contracts/routes'
import { OFFICIAL_PLUGIN_SOURCE } from '@shared/types/plugin'
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

  async function installOfficialPlugin(pluginId: string) {
    const result = await bridge.invoke(pluginsInstallRoute.name, {
      pluginId,
      source: OFFICIAL_PLUGIN_SOURCE
    })
    return result.result
  }

  async function installPluginFromFile(filePath?: string) {
    const result = await bridge.invoke(pluginsInstallFromFileRoute.name, {
      filePath
    })
    return result.result
  }

  async function openOfficialRelease(pluginId?: string) {
    const result = await bridge.invoke(pluginsOpenOfficialReleaseRoute.name, {
      pluginId
    })
    return result.result
  }

  async function enablePlugin(pluginId: string) {
    const result = await bridge.invoke(pluginsEnableRoute.name, { pluginId })
    return result.result
  }

  async function disablePlugin(pluginId: string) {
    const result = await bridge.invoke(pluginsDisableRoute.name, { pluginId })
    return result.result
  }

  async function deletePlugin(pluginId: string) {
    const result = await bridge.invoke(pluginsDeleteRoute.name, { pluginId })
    return result.result
  }

  async function invokeAction(input: PluginInvokeActionRequest) {
    const result = await bridge.invoke(pluginsInvokeActionRoute.name, input)
    return result.result
  }

  return {
    listPlugins,
    getPlugin,
    installOfficialPlugin,
    installPluginFromFile,
    openOfficialRelease,
    enablePlugin,
    disablePlugin,
    deletePlugin,
    invokeAction
  }
}

export type PluginClient = ReturnType<typeof createPluginClient>
