import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_MAIN_LOG_DURATION_MS } from '../../../src/main/logging/mainLogEvents'

const startupSchemaCatalog = [
  {
    name: 'new_sessions'
  },
  {
    name: 'deepchat_sessions'
  }
]

const healthyDiagnosis = {
  checkedAt: 1,
  isHealthy: true,
  issues: [],
  repairableIssues: [],
  manualIssues: []
}

const missingDraftIssue = {
  kind: 'missing_column',
  table: 'new_sessions',
  name: 'is_draft',
  repairable: true,
  message: 'Missing column "new_sessions.is_draft".',
  expectedType: 'INTEGER',
  actualType: null
}

async function createInitializerWithMocks(input: {
  MainDatabase: ReturnType<typeof vi.fn>
  repairSQLiteDatabaseFile?: ReturnType<typeof vi.fn>
  isDestructiveDatabaseError?: ReturnType<typeof vi.fn>
  classifySchemaError?: ReturnType<typeof vi.fn>
  getStartupSchemaCatalog?: ReturnType<typeof vi.fn>
  observe?: ReturnType<typeof vi.fn>
  now?: () => number
}) {
  const repairSQLiteDatabaseFile = input.repairSQLiteDatabaseFile ?? vi.fn()
  const isDestructiveDatabaseError =
    input.isDestructiveDatabaseError ?? vi.fn().mockReturnValue(false)
  const classifySchemaError = input.classifySchemaError ?? vi.fn().mockReturnValue(null)
  const getStartupSchemaCatalog =
    input.getStartupSchemaCatalog ?? vi.fn().mockReturnValue(startupSchemaCatalog)
  const observe = input.observe ?? vi.fn()

  vi.doMock('electron', () => ({
    app: {
      getPath: vi.fn().mockReturnValue('C:/Users/test/AppData/Roaming/DeepChat')
    }
  }))
  vi.doMock('@/data/mainDatabase', () => ({
    MainDatabase: input.MainDatabase,
    repairSQLiteDatabaseFile,
    isDestructiveDatabaseError
  }))
  vi.doMock('@/data/schemaCatalog', () => ({
    getStartupSchemaCatalog
  }))
  vi.doMock('@/data/schemaErrorClassifier', () => ({
    classifySchemaError
  }))

  const { DatabaseInitializer } = await import('../../../src/main/app/databaseInitializer')

  return {
    initializer: new DatabaseInitializer({
      dbPath: 'C:/tmp/deepchat-agent.db',
      observe,
      now: input.now ?? (() => 100)
    }),
    repairSQLiteDatabaseFile,
    isDestructiveDatabaseError,
    classifySchemaError,
    getStartupSchemaCatalog,
    observe
  }
}

describe('DatabaseInitializer', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('attempts one schema repair and retries initialization for repairable schema errors', async () => {
    const presenterInstance = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue(healthyDiagnosis),
      close: vi.fn()
    }

    const MainDatabase = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('table deepchat_sessions has no column named reasoning_visibility')
      })
      .mockImplementationOnce(() => presenterInstance)
    const classifySchemaError = vi.fn().mockReturnValue({
      reason: 'missing-column',
      dedupeKey: 'missing-column:reasoning_visibility'
    })

    const { initializer, repairSQLiteDatabaseFile, observe } = await createInitializerWithMocks({
      MainDatabase,
      classifySchemaError
    })
    const result = await initializer.initialize()

    expect(MainDatabase).toHaveBeenCalledTimes(2)
    expect(repairSQLiteDatabaseFile).toHaveBeenCalledTimes(1)
    expect(repairSQLiteDatabaseFile).toHaveBeenCalledWith('C:/tmp/deepchat-agent.db', undefined, {
      catalog: startupSchemaCatalog
    })
    expect(presenterInstance.diagnoseSchema).toHaveBeenCalledTimes(1)
    expect(presenterInstance.diagnoseSchema).toHaveBeenCalledWith(startupSchemaCatalog)
    expect(result).toBe(presenterInstance)
    expect(observe).toHaveBeenCalledWith({
      outcome: 'completed',
      durationMs: 0,
      repairAttempted: true,
      schemaDiagnosis: 'completed',
      repairableIssueCount: 0,
      manualIssueCount: 0
    })
  })

  it('does not repair healthy schema after successful initialization', async () => {
    const presenterInstance = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue(healthyDiagnosis),
      close: vi.fn()
    }

    const MainDatabase = vi.fn().mockImplementation(() => presenterInstance)
    const { initializer, repairSQLiteDatabaseFile } = await createInitializerWithMocks({
      MainDatabase
    })
    const result = await initializer.initialize()

    expect(MainDatabase).toHaveBeenCalledTimes(1)
    expect(presenterInstance.diagnoseSchema).toHaveBeenCalledTimes(1)
    expect(presenterInstance.diagnoseSchema).toHaveBeenCalledWith(startupSchemaCatalog)
    expect(repairSQLiteDatabaseFile).not.toHaveBeenCalled()
    expect(result).toBe(presenterInstance)
  })

  it('continues startup when schema diagnosis fails', async () => {
    const presenterInstance = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockRejectedValue(new Error('database is locked')),
      close: vi.fn()
    }

    const MainDatabase = vi.fn().mockImplementation(() => presenterInstance)
    const { initializer, repairSQLiteDatabaseFile, observe } = await createInitializerWithMocks({
      MainDatabase
    })
    const result = await initializer.initialize()

    expect(MainDatabase).toHaveBeenCalledTimes(1)
    expect(repairSQLiteDatabaseFile).not.toHaveBeenCalled()
    expect(presenterInstance.close).not.toHaveBeenCalled()
    expect(result).toBe(presenterInstance)
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'completed',
        schemaDiagnosis: 'unavailable',
        repairAttempted: false
      })
    )
  })

  it('repairs diagnosed schema drift and retries initialization', async () => {
    const driftedPresenter = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue({
        checkedAt: 1,
        isHealthy: false,
        issues: [missingDraftIssue],
        repairableIssues: [missingDraftIssue],
        manualIssues: []
      }),
      close: vi.fn()
    }
    const repairedPresenter = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue(healthyDiagnosis),
      close: vi.fn()
    }

    const MainDatabase = vi
      .fn()
      .mockImplementationOnce(() => driftedPresenter)
      .mockImplementationOnce(() => repairedPresenter)

    const { initializer, repairSQLiteDatabaseFile } = await createInitializerWithMocks({
      MainDatabase
    })
    const result = await initializer.initialize()

    expect(MainDatabase).toHaveBeenCalledTimes(2)
    expect(driftedPresenter.diagnoseSchema).toHaveBeenCalledWith(startupSchemaCatalog)
    expect(driftedPresenter.close).toHaveBeenCalledTimes(1)
    expect(repairSQLiteDatabaseFile).toHaveBeenCalledTimes(1)
    expect(repairSQLiteDatabaseFile).toHaveBeenCalledWith('C:/tmp/deepchat-agent.db', undefined, {
      catalog: startupSchemaCatalog
    })
    expect(result).toBe(repairedPresenter)
  })

  it('continues startup if repairable schema drift remains after one repair attempt', async () => {
    const driftDiagnosis = {
      checkedAt: 1,
      isHealthy: false,
      issues: [missingDraftIssue],
      repairableIssues: [missingDraftIssue],
      manualIssues: []
    }
    const driftedPresenter = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue(driftDiagnosis),
      close: vi.fn()
    }
    const stillDriftedPresenter = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue(driftDiagnosis),
      close: vi.fn()
    }

    const MainDatabase = vi
      .fn()
      .mockImplementationOnce(() => driftedPresenter)
      .mockImplementationOnce(() => stillDriftedPresenter)

    const { initializer, repairSQLiteDatabaseFile, observe } = await createInitializerWithMocks({
      MainDatabase
    })
    const result = await initializer.initialize()

    expect(MainDatabase).toHaveBeenCalledTimes(2)
    expect(repairSQLiteDatabaseFile).toHaveBeenCalledTimes(1)
    expect(stillDriftedPresenter.close).not.toHaveBeenCalled()
    expect(result).toBe(stillDriftedPresenter)
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'completed',
        repairAttempted: true,
        schemaDiagnosis: 'completed',
        repairableIssueCount: 1,
        manualIssueCount: 0
      })
    )
  })

  it('allows manual schema issues without automatic repair', async () => {
    const manualIssue = {
      kind: 'column_type_mismatch',
      table: 'new_sessions',
      name: 'session_kind',
      repairable: false,
      message: 'Column "new_sessions.session_kind" has unexpected type.',
      expectedType: 'TEXT',
      actualType: 'INTEGER'
    }
    const presenterInstance = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue({
        checkedAt: 1,
        isHealthy: false,
        issues: [manualIssue],
        repairableIssues: [],
        manualIssues: [manualIssue]
      }),
      close: vi.fn()
    }

    const MainDatabase = vi.fn().mockImplementation(() => presenterInstance)
    const { initializer, repairSQLiteDatabaseFile } = await createInitializerWithMocks({
      MainDatabase
    })
    const result = await initializer.initialize()

    expect(MainDatabase).toHaveBeenCalledTimes(1)
    expect(repairSQLiteDatabaseFile).not.toHaveBeenCalled()
    expect(result).toBe(presenterInstance)
  })

  it('does not attempt schema repair for destructive database errors', async () => {
    const MainDatabase = vi.fn().mockImplementation(() => {
      throw new Error('database disk image is malformed')
    })
    const isDestructiveDatabaseError = vi.fn().mockReturnValue(true)
    const classifySchemaError = vi.fn().mockReturnValue({
      reason: 'missing-table',
      dedupeKey: 'missing-table:deepchat_sessions'
    })

    const { initializer, repairSQLiteDatabaseFile, observe } = await createInitializerWithMocks({
      MainDatabase,
      isDestructiveDatabaseError,
      classifySchemaError
    })

    await expect(initializer.initialize()).rejects.toThrow('database disk image is malformed')
    expect(MainDatabase).toHaveBeenCalledTimes(1)
    expect(repairSQLiteDatabaseFile).not.toHaveBeenCalled()
    expect(observe).toHaveBeenCalledWith({
      outcome: 'failed',
      durationMs: 0,
      repairAttempted: false,
      schemaDiagnosis: 'not_completed',
      repairableIssueCount: 0,
      manualIssueCount: 0,
      error: { category: 'integrity' }
    })
  })

  it('classifies schema failures without persisting schema object names', async () => {
    const MainDatabase = vi.fn().mockImplementation(() => {
      throw new Error('no such column: private_column_name')
    })
    const classifySchemaError = vi.fn().mockReturnValue({
      reason: 'missing-column',
      dedupeKey: 'missing-column:private_column_name'
    })

    const { initializer, observe } = await createInitializerWithMocks({
      MainDatabase,
      classifySchemaError
    })

    await expect(initializer.initialize()).rejects.toThrow('no such column')
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        error: { category: 'schema', reason: 'missing-column' }
      })
    )
    expect(JSON.stringify(observe.mock.calls)).not.toContain('private_column_name')
  })

  it('reports only the terminal attempt schema diagnosis after a repair retry', async () => {
    const driftedPresenter = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue({
        checkedAt: 1,
        isHealthy: false,
        issues: [missingDraftIssue],
        repairableIssues: [missingDraftIssue],
        manualIssues: []
      }),
      close: vi.fn()
    }
    const MainDatabase = vi
      .fn()
      .mockImplementationOnce(() => driftedPresenter)
      .mockImplementationOnce(() => {
        throw new Error('database is locked')
      })
    const { initializer, observe } = await createInitializerWithMocks({ MainDatabase })

    await expect(initializer.initialize()).rejects.toThrow('database is locked')
    expect(observe).toHaveBeenCalledWith({
      outcome: 'failed',
      durationMs: 0,
      repairAttempted: true,
      schemaDiagnosis: 'not_completed',
      repairableIssueCount: 0,
      manualIssueCount: 0,
      error: { category: 'persistence' }
    })
  })

  it('keeps observer failures outside database initialization behavior', async () => {
    const presenterInstance = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue(healthyDiagnosis),
      close: vi.fn()
    }
    const MainDatabase = vi.fn().mockImplementation(() => presenterInstance)
    const observe = vi.fn(() => {
      throw new Error('diagnostic sink failed')
    })
    const { initializer } = await createInitializerWithMocks({ MainDatabase, observe })

    await expect(initializer.initialize()).resolves.toBe(presenterInstance)
    expect(observe).toHaveBeenCalledOnce()
  })

  it('keeps asynchronous observer failures outside database initialization behavior', async () => {
    const presenterInstance = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue(healthyDiagnosis),
      close: vi.fn()
    }
    const MainDatabase = vi.fn().mockImplementation(() => presenterInstance)
    const observe = vi.fn().mockRejectedValue(new Error('diagnostic sink failed'))
    const { initializer } = await createInitializerWithMocks({ MainDatabase, observe })
    const unhandledRejection = vi.fn()
    process.on('unhandledRejection', unhandledRejection)

    try {
      await expect(initializer.initialize()).resolves.toBe(presenterInstance)
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(observe).toHaveBeenCalledOnce()
      expect(unhandledRejection).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandledRejection)
    }
  })

  it('omits duration when the monotonic clock moves backwards', async () => {
    const presenterInstance = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue(healthyDiagnosis),
      close: vi.fn()
    }
    const MainDatabase = vi.fn().mockImplementation(() => presenterInstance)
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(99)
    const { initializer, observe } = await createInitializerWithMocks({ MainDatabase, now })

    await initializer.initialize()

    expect(observe).toHaveBeenCalledOnce()
    expect(observe.mock.calls[0][0]).not.toHaveProperty('durationMs')
  })

  it('keeps database initialization running when the diagnostic clock throws', async () => {
    const presenterInstance = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue(healthyDiagnosis),
      close: vi.fn()
    }
    const MainDatabase = vi.fn().mockImplementation(() => presenterInstance)
    const now = vi.fn(() => {
      throw new Error('clock unavailable')
    })
    const { initializer, observe } = await createInitializerWithMocks({ MainDatabase, now })

    await expect(initializer.initialize()).resolves.toBe(presenterInstance)

    expect(observe).toHaveBeenCalledOnce()
    expect(observe.mock.calls[0][0]).not.toHaveProperty('durationMs')
  })

  it('bounds duration before notifying the initialization observer', async () => {
    const presenterInstance = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue(healthyDiagnosis),
      close: vi.fn()
    }
    const MainDatabase = vi.fn().mockImplementation(() => presenterInstance)
    const now = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(MAX_MAIN_LOG_DURATION_MS + 1)
    const { initializer, observe } = await createInitializerWithMocks({ MainDatabase, now })

    await initializer.initialize()

    expect(observe).toHaveBeenCalledOnce()
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: MAX_MAIN_LOG_DURATION_MS })
    )
  })
})
