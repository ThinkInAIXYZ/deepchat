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
  pluginsListRoute
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap, type RouteContext } from '@/routes/routeRegistry'
import type { PluginServicePort, PluginSettingsWindowPort } from './index'

export function createPluginRoutes(
  pluginService: PluginServicePort,
  settingsWindow: PluginSettingsWindowPort
): DeepchatRouteMap {
  const assertPluginSettingsCallerOwns = (context: RouteContext, pluginId: string): void => {
    if (context.caller.kind !== 'renderer') {
      return
    }
    const ownerPluginId = settingsWindow.getPluginIdForWebContents(context.caller.webContentsId)
    if (ownerPluginId != null && ownerPluginId !== pluginId) {
      throw new Error(
        `Plugin settings window for "${ownerPluginId}" cannot control plugin "${pluginId}"`
      )
    }
  }

  return createRouteMap([
    [
      pluginsInspectSourceRoute.name,
      async (rawInput) => {
        const input = pluginsInspectSourceRoute.input.parse(rawInput)
        return { prepared: await pluginService.inspectSource(input.source, input.requestId) }
      }
    ],
    [
      pluginsInstallUserRoute.name,
      async (rawInput) => {
        const input = pluginsInstallUserRoute.input.parse(rawInput)
        return { result: await pluginService.installUserPlugin(input) }
      }
    ],
    [
      pluginsUninstallUserRoute.name,
      async (rawInput) => {
        const input = pluginsUninstallUserRoute.input.parse(rawInput)
        return { result: await pluginService.uninstallUserPlugin(input.pluginId) }
      }
    ],
    [
      pluginsDiscardPreparedRoute.name,
      async (rawInput) => {
        const input = pluginsDiscardPreparedRoute.input.parse(rawInput)
        await pluginService.discardPrepared(input.operationId)
        return {}
      }
    ],
    [
      pluginsConfigureMcpRoute.name,
      async (rawInput) => {
        const input = pluginsConfigureMcpRoute.input.parse(rawInput)
        return {
          result: await pluginService.configurePluginMcp(
            input.pluginId,
            input.serverName,
            input.values
          )
        }
      }
    ],
    [
      pluginsRetryHookRoute.name,
      async (rawInput) => {
        const input = pluginsRetryHookRoute.input.parse(rawInput)
        await pluginService.retryPluginHook(input.pluginId, input.invocationId)
        return {}
      }
    ],

    [
      pluginsListRoute.name,
      async (rawInput) => {
        pluginsListRoute.input.parse(rawInput)
        return pluginsListRoute.output.parse({
          plugins: await pluginService.listPlugins()
        })
      }
    ],
    [
      pluginsGetRoute.name,
      async (rawInput) => {
        const input = pluginsGetRoute.input.parse(rawInput)
        return pluginsGetRoute.output.parse({
          plugin: await pluginService.getPlugin(input.pluginId)
        })
      }
    ],
    [
      pluginsEnableRoute.name,
      async (rawInput, context) => {
        const input = pluginsEnableRoute.input.parse(rawInput)
        assertPluginSettingsCallerOwns(context, input.pluginId)
        return pluginsEnableRoute.output.parse({
          result: await pluginService.enablePlugin(input.pluginId)
        })
      }
    ],
    [
      pluginsDisableRoute.name,
      async (rawInput, context) => {
        const input = pluginsDisableRoute.input.parse(rawInput)
        assertPluginSettingsCallerOwns(context, input.pluginId)
        return pluginsDisableRoute.output.parse({
          result: await pluginService.disablePlugin(input.pluginId)
        })
      }
    ],
    [
      pluginsInvokeActionRoute.name,
      async (rawInput, context) => {
        const input = pluginsInvokeActionRoute.input.parse(rawInput)
        assertPluginSettingsCallerOwns(context, input.pluginId)
        return pluginsInvokeActionRoute.output.parse({
          result: await pluginService.invokeAction(input.pluginId, input.actionId, input.payload)
        })
      }
    ]
  ])
}
