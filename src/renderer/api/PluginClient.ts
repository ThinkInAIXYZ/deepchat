import type { UserPluginSource, UserPluginInstallInput } from '@shared/types/userPlugin'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  pluginsInspectSourceRoute,
  pluginsInstallUserRoute,
  pluginsUninstallUserRoute,
  pluginsDiscardPreparedRoute,
  pluginsConfigureMcpRoute,
  pluginsRetryHookRoute,
  pluginsDisableRoute,
  pluginsEnableRoute,
  pluginsGetRoute,
  pluginsInvokeActionRoute,
  pluginsListRoute,
  pluginsCatalogListRoute,
  pluginsCatalogInstallRoute,
  pluginsCatalogCancelRoute
} from '@shared/contracts/routes'
import { pluginInstallProgressEvent, type DeepchatEventPayload } from '@shared/contracts/events'
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
    inspectSource: async (source: UserPluginSource, requestId: string) =>
      (await bridge.invoke(pluginsInspectSourceRoute.name, { source, requestId })).prepared,
    installUserPlugin: async (input: UserPluginInstallInput) =>
      (await bridge.invoke(pluginsInstallUserRoute.name, input)).result,
    uninstallUserPlugin: async (pluginId: string) =>
      (await bridge.invoke(pluginsUninstallUserRoute.name, { pluginId })).result,
    discardPrepared: async (operationId: string) => {
      await bridge.invoke(pluginsDiscardPreparedRoute.name, { operationId })
    },
    configureMcp: async (pluginId: string, serverName: string, values: Record<string, string>) =>
      (await bridge.invoke(pluginsConfigureMcpRoute.name, { pluginId, serverName, values })).result,
    retryHook: async (pluginId: string, invocationId: string) => {
      await bridge.invoke(pluginsRetryHookRoute.name, { pluginId, invocationId })
    },
    listCatalogEntries: async () => (await bridge.invoke(pluginsCatalogListRoute.name, {})).entries,
    installCatalogPlugin: async (pluginId: string) =>
      (await bridge.invoke(pluginsCatalogInstallRoute.name, { pluginId })).result,
    cancelCatalogInstall: async (pluginId: string) =>
      (await bridge.invoke(pluginsCatalogCancelRoute.name, { pluginId })).cancelled,
    onInstallProgress: (
      listener: (payload: DeepchatEventPayload<typeof pluginInstallProgressEvent.name>) => void
    ) => bridge.on(pluginInstallProgressEvent.name, listener),
    listPlugins,
    getPlugin,
    enablePlugin,
    disablePlugin,
    invokeAction
  }
}

export type PluginClient = ReturnType<typeof createPluginClient>
