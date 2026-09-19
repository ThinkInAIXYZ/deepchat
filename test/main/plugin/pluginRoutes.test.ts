import { describe, expect, it, vi } from 'vitest'
import {
  pluginsDisableRoute,
  pluginsEnableRoute,
  pluginsGetRoute,
  pluginsInvokeActionRoute
} from '@shared/contracts/routes'
import type { PluginServicePort, PluginSettingsWindowPort } from '@/plugin'
import { createPluginRoutes } from '@/plugin/routes'
import { createRendererRouteContext, type RouteContext } from '@/routes/routeRegistry'

const actionResult = { ok: true }

function setup(ownerPluginId: string | null) {
  const pluginService = {
    enablePlugin: vi.fn().mockResolvedValue(actionResult),
    disablePlugin: vi.fn().mockResolvedValue(actionResult),
    invokeAction: vi.fn().mockResolvedValue(actionResult),
    getPlugin: vi.fn().mockResolvedValue({ id: 'plugin-a' })
  }
  const settingsWindow: PluginSettingsWindowPort = {
    open: async () => {},
    close: () => {},
    closeAll: () => {},
    getPluginIdForWebContents: () => ownerPluginId
  }
  const routes = createPluginRoutes(pluginService as unknown as PluginServicePort, settingsWindow)
  return { pluginService, routes }
}

const pluginWindowContext = (): RouteContext => createRendererRouteContext(42, 7)

describe('createPluginRoutes settings-window ownership', () => {
  it('rejects disable for another plugin from a plugin settings window', async () => {
    const { pluginService, routes } = setup('plugin-a')
    const handler = routes.get(pluginsDisableRoute.name)

    await expect(handler?.({ pluginId: 'plugin-b' }, pluginWindowContext())).rejects.toThrow(
      /cannot control plugin/
    )
    expect(pluginService.disablePlugin).not.toHaveBeenCalled()
  })

  it('rejects enable for another plugin from a plugin settings window', async () => {
    const { pluginService, routes } = setup('plugin-a')
    const handler = routes.get(pluginsEnableRoute.name)

    await expect(handler?.({ pluginId: 'plugin-b' }, pluginWindowContext())).rejects.toThrow(
      /cannot control plugin/
    )
    expect(pluginService.enablePlugin).not.toHaveBeenCalled()
  })

  it('rejects invokeAction for another plugin from a plugin settings window', async () => {
    const { pluginService, routes } = setup('plugin-a')
    const handler = routes.get(pluginsInvokeActionRoute.name)

    await expect(
      handler?.({ pluginId: 'plugin-b', actionId: 'act' }, pluginWindowContext())
    ).rejects.toThrow(/cannot control plugin/)
    expect(pluginService.invokeAction).not.toHaveBeenCalled()
  })

  it('rejects get for another plugin from a plugin settings window', async () => {
    const { pluginService, routes } = setup('plugin-a')
    const handler = routes.get(pluginsGetRoute.name)

    await expect(handler?.({ pluginId: 'plugin-b' }, pluginWindowContext())).rejects.toThrow(
      /cannot control plugin/
    )
    expect(pluginService.getPlugin).not.toHaveBeenCalled()
  })

  it('allows a plugin settings window to control its own plugin', async () => {
    const { pluginService, routes } = setup('plugin-a')
    const handler = routes.get(pluginsDisableRoute.name)

    await handler?.({ pluginId: 'plugin-a' }, pluginWindowContext())

    expect(pluginService.disablePlugin).toHaveBeenCalledWith('plugin-a')
  })

  it('allows renderer callers that are not plugin settings windows', async () => {
    const { pluginService, routes } = setup(null)
    const handler = routes.get(pluginsDisableRoute.name)

    await handler?.({ pluginId: 'plugin-b' }, pluginWindowContext())

    expect(pluginService.disablePlugin).toHaveBeenCalledWith('plugin-b')
  })

  it('allows non-renderer callers', async () => {
    const { pluginService, routes } = setup('plugin-a')
    const handler = routes.get(pluginsEnableRoute.name)
    const context: RouteContext = { caller: { kind: 'internal', component: 'scheduler' } }

    await handler?.({ pluginId: 'plugin-b' }, context)

    expect(pluginService.enablePlugin).toHaveBeenCalledWith('plugin-b')
  })
})
