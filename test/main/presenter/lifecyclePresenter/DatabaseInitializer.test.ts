import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  SQLitePresenter: ReturnType<typeof vi.fn>
  repairSQLiteDatabaseFile?: ReturnType<typeof vi.fn>
  isDestructiveDatabaseError?: ReturnType<typeof vi.fn>
  classifySchemaError?: ReturnType<typeof vi.fn>
  getStartupSchemaCatalog?: ReturnType<typeof vi.fn>
}) {
  const repairSQLiteDatabaseFile = input.repairSQLiteDatabaseFile ?? vi.fn()
  const isDestructiveDatabaseError =
    input.isDestructiveDatabaseError ?? vi.fn().mockReturnValue(false)
  const classifySchemaError = input.classifySchemaError ?? vi.fn().mockReturnValue(null)
  const getStartupSchemaCatalog =
    input.getStartupSchemaCatalog ?? vi.fn().mockReturnValue(startupSchemaCatalog)

  vi.doMock('electron', () => ({
    app: {
      getPath: vi.fn().mockReturnValue('C:/Users/test/AppData/Roaming/DeepChat')
    }
  }))
  vi.doMock('@/presenter/sqlitePresenter', () => ({
    SQLitePresenter: input.SQLitePresenter,
    repairSQLiteDatabaseFile,
    isDestructiveDatabaseError
  }))
  vi.doMock('@/presenter/sqlitePresenter/schemaCatalog', () => ({
    getStartupSchemaCatalog
  }))
  vi.doMock('@/presenter/sqlitePresenter/schemaErrorClassifier', () => ({
    classifySchemaError
  }))

  const { DatabaseInitializer } =
    await import('../../../../src/main/presenter/lifecyclePresenter/DatabaseInitializer')

  return {
    initializer: new DatabaseInitializer({
      dbPath: 'C:/tmp/deepchat-agent.db'
    }),
    repairSQLiteDatabaseFile,
    isDestructiveDatabaseError,
    classifySchemaError,
    getStartupSchemaCatalog
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

    const SQLitePresenter = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('table deepchat_sessions has no column named reasoning_visibility')
      })
      .mockImplementationOnce(() => presenterInstance)
    const classifySchemaError = vi.fn().mockReturnValue({
      reason: 'missing-column',
      dedupeKey: 'missing-column:reasoning_visibility'
    })

    const { initializer, repairSQLiteDatabaseFile } = await createInitializerWithMocks({
      SQLitePresenter,
      classifySchemaError
    })
    const result = await initializer.initialize()

    expect(SQLitePresenter).toHaveBeenCalledTimes(2)
    expect(repairSQLiteDatabaseFile).toHaveBeenCalledTimes(1)
    expect(repairSQLiteDatabaseFile).toHaveBeenCalledWith('C:/tmp/deepchat-agent.db', undefined, {
      catalog: startupSchemaCatalog
    })
    expect(presenterInstance.diagnoseSchema).toHaveBeenCalledWith(startupSchemaCatalog)
    expect(result).toBe(presenterInstance)
  })

  it('does not repair healthy schema after successful initialization', async () => {
    const presenterInstance = {
      runTransaction: vi.fn().mockResolvedValue(undefined),
      diagnoseSchema: vi.fn().mockResolvedValue(healthyDiagnosis),
      close: vi.fn()
    }

    const SQLitePresenter = vi.fn().mockImplementation(() => presenterInstance)
    const { initializer, repairSQLiteDatabaseFile } = await createInitializerWithMocks({
      SQLitePresenter
    })
    const result = await initializer.initialize()

    expect(SQLitePresenter).toHaveBeenCalledTimes(1)
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

    const SQLitePresenter = vi.fn().mockImplementation(() => presenterInstance)
    const { initializer, repairSQLiteDatabaseFile } = await createInitializerWithMocks({
      SQLitePresenter
    })
    const result = await initializer.initialize()

    expect(SQLitePresenter).toHaveBeenCalledTimes(1)
    expect(repairSQLiteDatabaseFile).not.toHaveBeenCalled()
    expect(presenterInstance.close).not.toHaveBeenCalled()
    expect(result).toBe(presenterInstance)
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

    const SQLitePresenter = vi
      .fn()
      .mockImplementationOnce(() => driftedPresenter)
      .mockImplementationOnce(() => repairedPresenter)

    const { initializer, repairSQLiteDatabaseFile } = await createInitializerWithMocks({
      SQLitePresenter
    })
    const result = await initializer.initialize()

    expect(SQLitePresenter).toHaveBeenCalledTimes(2)
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

    const SQLitePresenter = vi
      .fn()
      .mockImplementationOnce(() => driftedPresenter)
      .mockImplementationOnce(() => stillDriftedPresenter)

    const { initializer, repairSQLiteDatabaseFile } = await createInitializerWithMocks({
      SQLitePresenter
    })
    const result = await initializer.initialize()

    expect(SQLitePresenter).toHaveBeenCalledTimes(2)
    expect(repairSQLiteDatabaseFile).toHaveBeenCalledTimes(1)
    expect(stillDriftedPresenter.close).not.toHaveBeenCalled()
    expect(result).toBe(stillDriftedPresenter)
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

    const SQLitePresenter = vi.fn().mockImplementation(() => presenterInstance)
    const { initializer, repairSQLiteDatabaseFile } = await createInitializerWithMocks({
      SQLitePresenter
    })
    const result = await initializer.initialize()

    expect(SQLitePresenter).toHaveBeenCalledTimes(1)
    expect(repairSQLiteDatabaseFile).not.toHaveBeenCalled()
    expect(result).toBe(presenterInstance)
  })

  it('does not attempt schema repair for destructive database errors', async () => {
    const SQLitePresenter = vi.fn().mockImplementation(() => {
      throw new Error('database disk image is malformed')
    })
    const isDestructiveDatabaseError = vi.fn().mockReturnValue(true)
    const classifySchemaError = vi.fn().mockReturnValue({
      reason: 'missing-table',
      dedupeKey: 'missing-table:deepchat_sessions'
    })

    const { initializer, repairSQLiteDatabaseFile } = await createInitializerWithMocks({
      SQLitePresenter,
      isDestructiveDatabaseError,
      classifySchemaError
    })

    await expect(initializer.initialize()).rejects.toThrow('database disk image is malformed')
    expect(SQLitePresenter).toHaveBeenCalledTimes(1)
    expect(repairSQLiteDatabaseFile).not.toHaveBeenCalled()
  })
})
