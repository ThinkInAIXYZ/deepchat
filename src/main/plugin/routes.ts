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
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { PluginActionResult } from '@shared/types/plugin'
import type { PluginServicePort } from './index'
import type { PluginCatalogService } from './catalog'
import type { PluginRemoteInstaller } from './remoteInstaller'

export type PluginDistributionDeps = {
  catalog: Pick<
    PluginCatalogService,
    'listVisibleArtifacts' | 'resolveArtifact' | 'describeAvailability'
  >
  installer: Pick<PluginRemoteInstaller, 'install' | 'cancel' | 'getInstallState'>
}

export function createPluginRoutes(
  pluginService: PluginServicePort,
  distribution?: PluginDistributionDeps
): DeepchatRouteMap {
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
      async (rawInput) => {
        const input = pluginsEnableRoute.input.parse(rawInput)
        return pluginsEnableRoute.output.parse({
          result: await enablePluginWithRemoteInstall(pluginService, distribution, input.pluginId)
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
    ],
    ...(distribution ? createDistributionRoutes(pluginService, distribution) : [])
  ])
}

function createDistributionRoutes(
  pluginService: PluginServicePort,
  distribution: PluginDistributionDeps
): DeepchatRouteMap {
  return createRouteMap([
    [
      pluginsCatalogListRoute.name,
      async (rawInput) => {
        pluginsCatalogListRoute.input.parse(rawInput)
        const installedPlugins = await pluginService.listPlugins()
        const installedById = new Map(installedPlugins.map((plugin) => [plugin.id, plugin]))
        const entries = distribution.catalog.listVisibleArtifacts().map((artifact) => {
          const installed = installedById.get(artifact.pluginId)
          const { availability, target } = distribution.catalog.describeAvailability(artifact)
          return {
            pluginId: artifact.pluginId,
            version: artifact.version,
            channel: artifact.channel,
            displayName: artifact.displayName,
            description: artifact.description,
            availability,
            sizeBytes: target?.size ?? null,
            installed: Boolean(installed),
            installedVersion: installed?.version ?? null,
            installState: distribution.installer.getInstallState(artifact.pluginId)
          }
        })
        return pluginsCatalogListRoute.output.parse({ entries })
      }
    ],
    [
      pluginsCatalogInstallRoute.name,
      async (rawInput) => {
        const input = pluginsCatalogInstallRoute.input.parse(rawInput)
        const resolution = distribution.catalog.resolveArtifact(input.pluginId)
        if (!resolution) {
          return pluginsCatalogInstallRoute.output.parse({
            result: {
              ok: false,
              error: 'Plugin artifact is not available for this platform or app version'
            }
          })
        }
        const result = await distribution.installer.install(resolution.artifact, resolution.target)
        return pluginsCatalogInstallRoute.output.parse({
          result: { ok: result.ok, error: result.error ?? undefined }
        })
      }
    ],
    [
      pluginsCatalogCancelRoute.name,
      async (rawInput) => {
        const input = pluginsCatalogCancelRoute.input.parse(rawInput)
        return pluginsCatalogCancelRoute.output.parse({
          cancelled: distribution.installer.cancel(input.pluginId)
        })
      }
    ]
  ])
}

/**
 * Enables a plugin, transparently downloading and installing it first when it
 * is declared by the distribution catalog but not present locally. The enable
 * action is the user's opt-in moment; the artifact download needs no second
 * confirmation.
 */
async function enablePluginWithRemoteInstall(
  pluginService: PluginServicePort,
  distribution: PluginDistributionDeps | undefined,
  pluginId: string
): Promise<PluginActionResult> {
  try {
    return await pluginService.enablePlugin(pluginId)
  } catch (firstError) {
    if (!distribution) throw firstError
    const resolution = distribution.catalog.resolveArtifact(pluginId)
    if (!resolution) throw firstError
    const installResult = await distribution.installer.install(
      resolution.artifact,
      resolution.target
    )
    if (!installResult.ok) {
      return {
        ok: false,
        error: installResult.error ?? 'Plugin artifact download failed'
      }
    }
    try {
      return await pluginService.enablePlugin(pluginId)
    } catch (secondError) {
      return {
        ok: false,
        error:
          secondError instanceof Error
            ? secondError.message
            : 'Plugin activation failed after install'
      }
    }
  }
}
