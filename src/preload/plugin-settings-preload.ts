import { contextBridge, ipcRenderer } from 'electron'
import { createBridge } from './createBridge'
import type { JsonValue } from '@shared/contracts/common'
import {
  pluginsDisableRoute,
  pluginsEnableRoute,
  pluginsGetRoute,
  pluginsInvokeActionRoute
} from '@shared/contracts/routes'
import type { PluginSettingsApiStatus } from '@shared/types/plugin'

function readPluginId(): string {
  const pluginId = new URL(window.location.href).searchParams.get('pluginId')?.trim()
  if (!pluginId) {
    throw new Error('Plugin settings renderer is missing pluginId')
  }
  return pluginId
}

const bridge = createBridge(ipcRenderer)

const deepchatPluginApi = Object.freeze({
  getPluginId(): string {
    return readPluginId()
  },
  async getStatus(): Promise<PluginSettingsApiStatus> {
    const pluginId = readPluginId()
    const result = await bridge.invoke(pluginsGetRoute.name, { pluginId })
    return {
      pluginId,
      enabled: Boolean(result.plugin?.enabled),
      runtime: result.plugin?.runtime
    }
  },
  async enable() {
    const result = await bridge.invoke(pluginsEnableRoute.name, {
      pluginId: readPluginId()
    })
    return result.result
  },
  async disable() {
    const result = await bridge.invoke(pluginsDisableRoute.name, {
      pluginId: readPluginId()
    })
    return result.result
  },
  async invokeAction(actionId: string, payload?: JsonValue) {
    const result = await bridge.invoke(pluginsInvokeActionRoute.name, {
      pluginId: readPluginId(),
      actionId,
      payload
    })
    return result.result
  }
})

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('deepchatPlugin', deepchatPluginApi)
} else {
  ;(
    window as Window & typeof globalThis & { deepchatPlugin: typeof deepchatPluginApi }
  ).deepchatPlugin = deepchatPluginApi
}
