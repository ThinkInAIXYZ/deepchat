import { describe, expect, it, vi } from 'vitest'
import { createMcpRoutes } from '@/mcp/routes'
import { createRendererRouteContext } from '@/routes/routeRegistry'

describe('MCP native window authority', () => {
  it.each([true, false])(
    'awaits settings authority before authentication (%s)',
    async (allowed) => {
      const authority = Promise.withResolvers<boolean>()
      const status = { serverName: 'fixture', state: 'authenticating', authenticated: false }
      const startMcpServerAuth = vi.fn().mockResolvedValue(status)
      const isSettingsWindow = vi.fn(() => authority.promise)
      const routes = createMcpRoutes({
        mcpService: { startMcpServerAuth } as never,
        mcpAppHost: {} as never,
        isSettingsWindow,
        recordSettingsActivity: vi.fn()
      })
      const serverId = '264552d7-7744-4092-afde-b8d690e1899c'
      const pending = routes.get('mcp.startServerAuth')!(
        { serverId },
        createRendererRouteContext(42, 7)
      )
      const outcome = allowed
        ? expect(pending).resolves.toEqual({ status })
        : expect(pending).rejects.toThrow('restricted to the settings window')
      expect(isSettingsWindow).toHaveBeenCalledExactlyOnceWith(7)
      expect(startMcpServerAuth).not.toHaveBeenCalled()
      authority.resolve(allowed)
      await outcome
      expect(startMcpServerAuth).toHaveBeenCalledTimes(allowed ? 1 : 0)
      if (allowed) expect(startMcpServerAuth).toHaveBeenCalledWith(serverId)
    }
  )

  it.each([true, false])(
    'awaits conversation authority before app access (%s)',
    async (settings) => {
      const authority = Promise.withResolvers<boolean>()
      const releaseView = vi.fn().mockResolvedValue(undefined)
      const routes = createMcpRoutes({
        mcpService: {} as never,
        mcpAppHost: { releaseView } as never,
        isSettingsWindow: () => authority.promise,
        recordSettingsActivity: vi.fn()
      })
      const instanceId = 'fixture-instance-identity'
      const pending = routes.get('mcp.apps.releaseView')!(
        { instanceId },
        createRendererRouteContext(42, 7)
      )
      const outcome = settings
        ? expect(pending).rejects.toThrow('restricted to conversation windows')
        : expect(pending).resolves.toEqual({ released: true })
      expect(releaseView).not.toHaveBeenCalled()
      authority.resolve(settings)
      await outcome
      expect(releaseView).toHaveBeenCalledTimes(settings ? 0 : 1)
      if (!settings)
        expect(releaseView).toHaveBeenCalledWith(instanceId, { webContentsId: 42, windowId: 7 })
    }
  )
})
