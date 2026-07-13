import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const taskContext = {
    reportProgress: vi.fn(),
    yield: vi.fn(async () => undefined)
  }
  const scheduledTasks: Array<Record<string, any>> = []
  const scheduleTask = vi.fn(async (task: Record<string, any>) => {
    scheduledTasks.push(task)
    await task.run(taskContext)
  })
  return {
    taskContext,
    scheduledTasks,
    scheduleTask,
    legacyStart: vi.fn(async () => undefined),
    usageStart: vi.fn(async () => undefined),
    runMainline: vi.fn(async () => undefined),
    runDisabledCleanup: vi.fn(async () => undefined),
    rtkStart: vi.fn(async () => undefined),
    sessionDataMigrationSQLite: {},
    configPresenter: {},
    appSessionService: {}
  }
})

vi.mock('@/presenter', () => ({
  presenter: {
    startupWorkloadCoordinator: { scheduleTask: mocks.scheduleTask },
    legacyChatImportService: { start: mocks.legacyStart },
    usageStatsService: { startBackfill: mocks.usageStart },
    sessionDataMigrationSQLite: mocks.sessionDataMigrationSQLite,
    configPresenter: mocks.configPresenter,
    appSessionService: mocks.appSessionService
  }
}))

vi.mock('@/presenter/startupMigrations/sessionDataMigrations', () => ({
  runMainlineNormalizationMigration: mocks.runMainline,
  runDisabledSearchToolCleanupMigration: mocks.runDisabledCleanup
}))

vi.mock('@/agent/shared/process/rtkRuntimeService', () => ({
  rtkRuntimeService: { startHealthCheck: mocks.rtkStart }
}))

import { legacyImportHook } from '@/presenter/lifecyclePresenter/hooks/after-start/legacyImportHook'
import { usageStatsBackfillHook } from '@/presenter/lifecyclePresenter/hooks/after-start/usageStatsBackfillHook'
import { sqliteMainlineNormalizationHook } from '@/presenter/lifecyclePresenter/hooks/after-start/sqliteMainlineNormalizationHook'
import { disabledSearchToolCleanupHook } from '@/presenter/lifecyclePresenter/hooks/after-start/disabledSearchToolCleanupHook'
import { rtkHealthCheckHook } from '@/presenter/lifecyclePresenter/hooks/after-start/rtkHealthCheckHook'

describe('startup maintenance hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scheduledTasks.length = 0
  })

  const cases = [
    {
      hook: legacyImportHook,
      name: 'legacy-import',
      priority: 20,
      id: 'main:legacy-import',
      labelKey: 'startup.main.legacyImport'
    },
    {
      hook: usageStatsBackfillHook,
      name: 'usage-stats-backfill',
      priority: 21,
      id: 'main:usage-stats-backfill',
      labelKey: 'startup.main.usageStatsBackfill'
    },
    {
      hook: sqliteMainlineNormalizationHook,
      name: 'sqlite-mainline-normalization',
      priority: 22,
      id: 'main:sqlite-mainline-normalization',
      labelKey: 'startup.main.sqliteMainlineNormalization'
    },
    {
      hook: disabledSearchToolCleanupHook,
      name: 'disabled-search-tool-cleanup',
      priority: 23,
      id: 'main:disabled-search-tool-cleanup',
      labelKey: 'startup.main.disabledSearchToolCleanup'
    },
    {
      hook: rtkHealthCheckHook,
      name: 'rtk-health-check',
      priority: 20,
      id: 'main:rtk-health-check',
      labelKey: 'startup.main.rtkHealthCheck'
    }
  ] as const

  for (const testCase of cases) {
    it(`preserves ${testCase.name} scheduling metadata`, async () => {
      expect(testCase.hook).toMatchObject({
        name: testCase.name,
        priority: testCase.priority,
        critical: false
      })

      await testCase.hook.execute({} as never)
      await vi.waitFor(() => expect(mocks.scheduleTask).toHaveBeenCalledTimes(1))

      expect(mocks.scheduledTasks[0]).toMatchObject({
        id: testCase.id,
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: testCase.labelKey
      })
    })
  }

  it('invokes each explicit owner with the scheduled task context', async () => {
    for (const hook of cases.map((item) => item.hook)) {
      await hook.execute({} as never)
    }
    await vi.waitFor(() => expect(mocks.scheduleTask).toHaveBeenCalledTimes(5))

    expect(mocks.legacyStart).toHaveBeenCalledWith(false)
    expect(mocks.usageStart).toHaveBeenCalledWith(mocks.taskContext)
    expect(mocks.runMainline).toHaveBeenCalledWith(
      {
        sqlitePresenter: mocks.sessionDataMigrationSQLite,
        configPresenter: mocks.configPresenter,
        appSessionService: mocks.appSessionService
      },
      mocks.taskContext
    )
    expect(mocks.runDisabledCleanup).toHaveBeenCalledWith(
      {
        sqlitePresenter: mocks.sessionDataMigrationSQLite,
        configPresenter: mocks.configPresenter,
        appSessionService: mocks.appSessionService
      },
      mocks.taskContext
    )
    expect(mocks.taskContext.reportProgress).toHaveBeenNthCalledWith(1, 0)
    expect(mocks.taskContext.reportProgress).toHaveBeenNthCalledWith(2, 1)
    expect(mocks.taskContext.yield).toHaveBeenCalled()
    expect(mocks.rtkStart).toHaveBeenCalled()
  })
})
