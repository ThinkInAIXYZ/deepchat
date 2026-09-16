import { describe, expect, it, vi } from 'vitest'

import { createRendererRouteContext } from '@/routes/routeRegistry'
import { createPluginRoutes } from '@/plugin/routes'
import type { PluginServicePort } from '@/plugin'
import type { PluginCatalogService } from '@/plugin/catalog'
import type { PluginRemoteInstaller } from '@/plugin/remoteInstaller'
import type { PluginActionResult, PluginListItem } from '@shared/types/plugin'
import type { PluginCatalogArtifact, PluginCatalogTarget } from '@shared/types/pluginCatalog'

/**
 * `installedIds` are the plugins whose payload is present. `discoveredIds`
 * defaults to the same set, but the two diverge for a bundled or
 * development-tree manifest whose runtime binary was never downloaded.
 */
function createPluginServiceWithInstalled(
  installedIds: Set<string>,
  discoveredIds: Set<string> = installedIds
) {
  const enableCalls: string[] = []
  return {
    enableCalls,
    service: {
      listPlugins: vi.fn(
        async (): Promise<PluginListItem[]> =>
          [...discoveredIds].map(
            (id) =>
              ({
                id,
                name: id,
                version: '1.0.0',
                publisher: 'DeepChat',
                installed: installedIds.has(id),
                enabled: false,
                trusted: true,
                trustState: 'trusted',
                official: true,
                capabilities: []
              }) as PluginListItem
          )
      ),
      isRuntimePayloadInstalled: vi.fn((pluginId: string) => installedIds.has(pluginId)),
      getPlugin: vi.fn(async () => undefined),
      enablePlugin: vi.fn(async (pluginId: string): Promise<PluginActionResult> => {
        enableCalls.push(pluginId)
        if (!installedIds.has(pluginId)) {
          // Mirrors PluginService.enablePlugin, which reports failures
          // through the returned result instead of throwing.
          return {
            ok: false,
            error: `Official plugin ${pluginId} is not available`
          }
        }
        return { ok: true }
      }),
      disablePlugin: vi.fn(async (): Promise<PluginActionResult> => ({ ok: true })),
      invokeAction: vi.fn(async (): Promise<PluginActionResult> => ({ ok: true }))
    } as unknown as PluginServicePort
  }
}

function createDistribution(options: { pluginId?: string } = {}) {
  const pluginId = options.pluginId ?? 'com.deepchat.plugins.cua'
  const target: PluginCatalogTarget = {
    platform: 'darwin',
    arch: 'arm64',
    url: 'https://example.com/plugin.dcplugin',
    sha256: 'a'.repeat(64),
    size: 100,
    mirrors: []
  }
  const artifact: PluginCatalogArtifact = {
    pluginId,
    version: '1.0.0',
    channel: 'stable',
    targets: [target]
  }
  const install = vi.fn(async () => ({
    ok: true,
    pluginId,
    version: '1.0.0',
    reason: null,
    error: null
  }))
  const catalog: Pick<
    PluginCatalogService,
    'listVisibleArtifacts' | 'resolveArtifact' | 'describeAvailability'
  > = {
    listVisibleArtifacts: vi.fn(() => [artifact]),
    resolveArtifact: vi.fn((id: string) => (id === pluginId ? { artifact, target } : null)),
    describeAvailability: vi.fn(() => ({ availability: 'available' as const, target }))
  }
  const installer: Pick<PluginRemoteInstaller, 'install' | 'cancel' | 'getInstallState'> = {
    install,
    cancel: vi.fn(() => false),
    getInstallState: vi.fn(() => null)
  }
  return { catalog, installer, install, pluginId, target, artifact }
}

function invokeEnable(
  routes: ReturnType<typeof createPluginRoutes>,
  pluginId: string
): Promise<{ result: PluginActionResult }> {
  const handler = routes.get('plugins.enable')
  if (!handler) throw new Error('plugins.enable handler is missing')
  return handler({ pluginId }, createRendererRouteContext(1, null)) as Promise<{
    result: PluginActionResult
  }>
}

describe('plugin routes with remote distribution', () => {
  it('installs a catalog-declared plugin before enabling it when missing locally', async () => {
    const installed = new Set<string>(['com.deepchat.plugins.feishu'])
    const { service, enableCalls } = createPluginServiceWithInstalled(installed)
    const distribution = createDistribution()
    const routes = createPluginRoutes(service, {
      catalog: distribution.catalog,
      installer: distribution.installer
    })

    // The remote install registers the plugin, so the second enable succeeds.
    distribution.install.mockImplementation(async () => {
      installed.add(distribution.pluginId)
      return {
        ok: true,
        pluginId: distribution.pluginId,
        version: '1.0.0',
        reason: null,
        error: null
      }
    })

    const response = await invokeEnable(routes, distribution.pluginId)

    expect(response.result.ok).toBe(true)
    expect(distribution.install).toHaveBeenCalledOnce()
    expect(enableCalls).toEqual([distribution.pluginId, distribution.pluginId])
  })

  it('installs the payload of a discovered plugin whose runtime is missing', async () => {
    const installed = new Set<string>()
    const discovered = new Set<string>(['com.deepchat.plugins.cua'])
    const { service } = createPluginServiceWithInstalled(installed, discovered)
    const distribution = createDistribution()
    // Enablement fails because the declared runtime has no binary on disk.
    const enablePlugin = service.enablePlugin as unknown as ReturnType<typeof vi.fn>
    enablePlugin.mockResolvedValueOnce({
      ok: false,
      error: 'Runtime "CUA Driver" is not installed'
    })
    enablePlugin.mockResolvedValueOnce({ ok: true })
    const routes = createPluginRoutes(service, {
      catalog: distribution.catalog,
      installer: distribution.installer
    })

    const response = await invokeEnable(routes, distribution.pluginId)

    expect(response.result.ok).toBe(true)
    expect(distribution.install).toHaveBeenCalledOnce()
  })

  it('returns the original failure when the plugin is not in the catalog', async () => {
    const { service } = createPluginServiceWithInstalled(new Set())
    const distribution = createDistribution({ pluginId: 'com.deepchat.plugins.other' })
    const routes = createPluginRoutes(service, {
      catalog: distribution.catalog,
      installer: distribution.installer
    })

    const response = await invokeEnable(routes, 'com.deepchat.plugins.unknown')

    expect(response.result.ok).toBe(false)
    expect(response.result.error).toContain('not available')
    expect(distribution.install).not.toHaveBeenCalled()
  })

  it('surfaces enablement failures unchanged for already-installed plugins', async () => {
    const installed = new Set<string>(['com.deepchat.plugins.cua'])
    const { service } = createPluginServiceWithInstalled(installed)
    const distribution = createDistribution()
    // The plugin is installed; enablement fails for an unrelated reason.
    // This is not a missing-plugin case, so no remote install may start.
    const enablePlugin = service.enablePlugin as unknown as ReturnType<typeof vi.fn>
    enablePlugin.mockResolvedValue({ ok: false, error: 'activation failed' })
    const routes = createPluginRoutes(service, {
      catalog: distribution.catalog,
      installer: distribution.installer
    })

    const response = await invokeEnable(routes, distribution.pluginId)

    expect(response.result.ok).toBe(false)
    expect(response.result.error).toContain('activation failed')
    expect(enablePlugin).toHaveBeenCalledOnce()
    expect(distribution.install).not.toHaveBeenCalled()
  })

  it('reports a failed artifact download as a non-ok action result', async () => {
    const { service } = createPluginServiceWithInstalled(new Set())
    const distribution = createDistribution()
    distribution.install.mockResolvedValue({
      ok: false,
      pluginId: distribution.pluginId,
      version: '1.0.0',
      reason: 'checksum_mismatch',
      error: 'sha256 mismatch'
    })
    const routes = createPluginRoutes(service, {
      catalog: distribution.catalog,
      installer: distribution.installer
    })

    const response = await invokeEnable(routes, distribution.pluginId)

    expect(response.result.ok).toBe(false)
    expect(response.result.error).toContain('sha256 mismatch')
  })

  it('lists catalog entries merged with installed state', async () => {
    const installed = new Set<string>(['com.deepchat.plugins.cua'])
    const { service } = createPluginServiceWithInstalled(installed)
    const distribution = createDistribution()
    const routes = createPluginRoutes(service, {
      catalog: distribution.catalog,
      installer: distribution.installer
    })
    const handler = routes.get('plugins.catalog.list')
    if (!handler) throw new Error('plugins.catalog.list handler is missing')

    const response = (await handler({}, createRendererRouteContext(1, null))) as unknown as {
      entries: Array<{
        pluginId: string
        installed: boolean
        installedVersion: string | null
        availability: string
        sizeBytes: number | null
      }>
    }

    expect(response.entries).toHaveLength(1)
    expect(response.entries[0]).toMatchObject({
      pluginId: distribution.pluginId,
      installed: true,
      installedVersion: '1.0.0',
      availability: 'available',
      sizeBytes: 100
    })
  })
})
