import { describe, expect, it, vi } from 'vitest'
import { performanceRecordRendererRoute } from '@shared/contracts/routes'
import { createAppRoutes } from '@/app/routes'

const validRecord = {
  schemaVersion: 1 as const,
  source: 'chat-main' as const,
  scope: 'startup' as const,
  phase: 'interactive' as const,
  outcome: 'completed' as const,
  elapsedMs: 42,
  startupRunId: 'main:run-1'
}

function createRoutes(overrides: Partial<Parameters<typeof createAppRoutes>[0]> = {}) {
  return createAppRoutes({
    logging: { openFolder: vi.fn() },
    rendererPerformance: { record: vi.fn().mockResolvedValue(true) },
    isMainWindowContext: vi.fn(() => true),
    agentSettings: {
      listAgents: vi.fn(),
      getAcpEnabled: vi.fn()
    },
    projects: { getDefaultProjectPath: vi.fn() },
    databaseSecurity: { getStatus: vi.fn() },
    database: { repairSchema: vi.fn(), getDatabase: vi.fn() },
    startupSession: { getLightweightByIds: vi.fn() },
    desktopSession: { getActiveId: vi.fn() },
    startup: {
      scheduleTask: vi.fn(),
      getRunId: vi.fn(),
      replayTarget: vi.fn()
    },
    ensureDefaultWorkspace: vi.fn(),
    enableDatabaseEncryption: vi.fn(),
    changeDatabasePassword: vi.fn(),
    disableDatabaseEncryption: vi.fn(),
    recordActivity: vi.fn(),
    publishSessionsUpdated: vi.fn(),
    ...overrides
  })
}

describe('app performance diagnostics route', () => {
  it('records an allowlisted main-renderer performance record', async () => {
    const rendererPerformance = { record: vi.fn().mockResolvedValue(true) }
    const routes = createRoutes({ rendererPerformance })
    const handler = routes.get(performanceRecordRendererRoute.name)

    await expect(handler?.(validRecord, { webContentsId: 1, windowId: 1 })).resolves.toEqual({
      accepted: true
    })
    expect(rendererPerformance.record).toHaveBeenCalledWith(validRecord)
  })

  it('does not persist records sent by another renderer', async () => {
    const rendererPerformance = { record: vi.fn().mockResolvedValue(true) }
    const routes = createRoutes({
      rendererPerformance,
      isMainWindowContext: vi.fn(() => false)
    })
    const handler = routes.get(performanceRecordRendererRoute.name)

    await expect(handler?.(validRecord, { webContentsId: 2, windowId: 2 })).resolves.toEqual({
      accepted: false
    })
    expect(rendererPerformance.record).not.toHaveBeenCalled()
  })

  it('rejects arbitrary record metadata at the route boundary', async () => {
    const routes = createRoutes()
    const handler = routes.get(performanceRecordRendererRoute.name)

    await expect(
      handler?.(
        { ...validRecord, metadata: { sessionId: 'sensitive' } },
        { webContentsId: 1, windowId: 1 }
      )
    ).rejects.toThrow()
  })
})
