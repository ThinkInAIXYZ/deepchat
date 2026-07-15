import {
  pluginsDisableRoute,
  pluginsEnableRoute,
  pluginsGetRoute,
  pluginsInvokeActionRoute,
  pluginsListRoute
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { PluginServicePort } from './index'

export function createPluginRoutes(pluginService: PluginServicePort): DeepchatRouteMap {
  return createRouteMap([
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
      async (rawInput) => {
        const input = pluginsEnableRoute.input.parse(rawInput)
        return pluginsEnableRoute.output.parse({
          result: await pluginService.enablePlugin(input.pluginId)
        })
      }
    ],
    [
      pluginsDisableRoute.name,
      async (rawInput) => {
        const input = pluginsDisableRoute.input.parse(rawInput)
        return pluginsDisableRoute.output.parse({
          result: await pluginService.disablePlugin(input.pluginId)
        })
      }
    ],
    [
      pluginsInvokeActionRoute.name,
      async (rawInput) => {
        const input = pluginsInvokeActionRoute.input.parse(rawInput)
        return pluginsInvokeActionRoute.output.parse({
          result: await pluginService.invokeAction(input.pluginId, input.actionId, input.payload)
        })
      }
    ]
  ])
}
