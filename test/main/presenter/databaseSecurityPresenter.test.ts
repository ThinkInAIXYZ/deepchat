import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const stores = new Map<string, Record<string, unknown>>()
  const safeStorage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`wrapped:${value}`, 'utf8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^wrapped:/, '')),
    getSelectedStorageBackend: vi.fn(() => 'basic_text')
  }
  const app = {
    getPath: vi.fn(() => '/tmp/deepchat-test'),
    quit: vi.fn()
  }
  const openSQLiteDatabase = vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ name: 'schema_versions' }))
    })),
    close: vi.fn()
  }))

  return {
    stores,
    safeStorage,
    app,
    openSQLiteDatabase
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  safeStorage: mocks.safeStorage
}))

vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    private readonly name: string

    constructor(options: { name: string; defaults?: Record<string, unknown> }) {
      this.name = options.name
      if (!mocks.stores.has(this.name)) {
        mocks.stores.set(this.name, structuredClone(options.defaults ?? {}))
      }
    }

    get(key: string) {
      return mocks.stores.get(this.name)?.[key]
    }

    set(key: string, value: unknown) {
      const store = mocks.stores.get(this.name) ?? {}
      store[key] = value
      mocks.stores.set(this.name, store)
    }
  }
}))

vi.mock('../../../src/main/presenter/sqlitePresenter', () => ({
  openSQLiteDatabase: mocks.openSQLiteDatabase
}))

const enabledMetadata = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  enabled: true,
  cipher: 'sqlcipher',
  passwordStorage: 'safeStorage',
  wrappedPassword: Buffer.from('wrapped:secret', 'utf8').toString('base64'),
  ...overrides
})

async function listMigratableTableNames(
  rows: Array<{ type: string; name: string; sql: string }>
): Promise<string[]> {
  const { DatabaseSecurityPresenter } =
    await import('../../../src/main/presenter/databaseSecurityPresenter')
  const presenter = new DatabaseSecurityPresenter({ dbPath: '/tmp/deepchat-test/agent.db' })
  const db = {
    prepare: vi.fn(() => ({
      all: vi.fn(() => rows)
    }))
  }
  const tables = (
    presenter as unknown as {
      listMigratableTables: (database: typeof db) => Array<{ name: string }>
    }
  ).listMigratableTables(db)
  return tables.map((table) => table.name)
}

describe('DatabaseSecurityPresenter', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.stores.clear()
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(true)
    mocks.safeStorage.encryptString.mockImplementation((value: string) =>
      Buffer.from(`wrapped:${value}`, 'utf8')
    )
    mocks.safeStorage.decryptString.mockImplementation((value: Buffer) =>
      value.toString('utf8').replace(/^wrapped:/, '')
    )
    mocks.safeStorage.getSelectedStorageBackend.mockReturnValue('basic_text')
    mocks.app.getPath.mockReturnValue('/tmp/deepchat-test')
    mocks.app.quit.mockReset()
    mocks.openSQLiteDatabase.mockClear()
  })

  it('reports manual unlock when safeStorage is unavailable', async () => {
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(false)
    mocks.stores.set('database-security', {
      metadata: enabledMetadata({
        passwordStorage: 'manual',
        wrappedPassword: undefined
      })
    })

    const { DatabaseSecurityPresenter } =
      await import('../../../src/main/presenter/databaseSecurityPresenter')
    const presenter = new DatabaseSecurityPresenter({ dbPath: '/tmp/deepchat-test/agent.db' })

    expect(presenter.getStatus()).toMatchObject({
      enabled: true,
      safeStorageAvailable: false,
      passwordStorage: 'manual',
      manualUnlockRequired: true
    })
  })

  it('uses safeStorage wrapped password during startup unlock', async () => {
    mocks.stores.set('database-security', {
      metadata: enabledMetadata()
    })

    const { DatabaseSecurityPresenter } =
      await import('../../../src/main/presenter/databaseSecurityPresenter')
    const presenter = new DatabaseSecurityPresenter({ dbPath: '/tmp/deepchat-test/agent.db' })
    const unlockProvider = vi.fn()

    await expect(presenter.resolveStartupPassword(unlockProvider)).resolves.toBe('secret')
    expect(unlockProvider).not.toHaveBeenCalled()
    expect(mocks.openSQLiteDatabase).toHaveBeenCalledWith('/tmp/deepchat-test/agent.db', 'secret')
  })

  it('falls back to manual unlock and rewraps after safeStorage decrypt failure', async () => {
    mocks.safeStorage.decryptString.mockImplementationOnce(() => {
      throw new Error('decrypt failed')
    })
    mocks.stores.set('database-security', {
      metadata: enabledMetadata()
    })

    const { DatabaseSecurityPresenter } =
      await import('../../../src/main/presenter/databaseSecurityPresenter')
    const presenter = new DatabaseSecurityPresenter({ dbPath: '/tmp/deepchat-test/agent.db' })
    const requests: unknown[] = []

    const password = await presenter.resolveStartupPassword(async (request) => {
      requests.push(request)
      return 'manual-secret'
    })

    expect(password).toBe('manual-secret')
    expect(requests).toEqual([{ reason: 'system-key-missing', safeStorageAvailable: true }])
    expect(mocks.safeStorage.encryptString).toHaveBeenCalledWith('manual-secret')
    expect(mocks.stores.get('database-security')?.metadata).toMatchObject({
      passwordStorage: 'safeStorage',
      wrappedPassword: Buffer.from('wrapped:manual-secret', 'utf8').toString('base64')
    })
  })

  it('quits when startup unlock is canceled', async () => {
    mocks.stores.set('database-security', {
      metadata: enabledMetadata({
        passwordStorage: 'manual',
        wrappedPassword: undefined
      })
    })

    const { DatabaseSecurityPresenter } =
      await import('../../../src/main/presenter/databaseSecurityPresenter')
    const presenter = new DatabaseSecurityPresenter({ dbPath: '/tmp/deepchat-test/agent.db' })

    await expect(presenter.resolveStartupPassword(async () => null)).rejects.toThrow(
      'Database unlock canceled'
    )
    expect(mocks.app.quit).toHaveBeenCalled()
  })

  it('cleans legacy provider JSON before enabling encryption', async () => {
    const { DatabaseSecurityPresenter } =
      await import('../../../src/main/presenter/databaseSecurityPresenter')
    const presenter = new DatabaseSecurityPresenter({ dbPath: '/tmp/deepchat-test/agent.db' })
    const migrateDatabase = vi
      .spyOn(presenter as unknown as { migrateDatabase: () => Promise<void> }, 'migrateDatabase')
      .mockResolvedValue(undefined)
    const cleanupLegacyProviderJsonForDatabaseEncryption = vi.fn(() => 1)

    await presenter.enableEncryption({
      password: 'secret',
      sqlitePresenter: {} as never,
      configPresenter: {
        cleanupLegacyProviderJsonForDatabaseEncryption
      } as never
    })

    expect(cleanupLegacyProviderJsonForDatabaseEncryption).toHaveBeenCalledTimes(1)
    expect(migrateDatabase).toHaveBeenCalledTimes(1)
  })

  it('qualifies CREATE TABLE IF NOT EXISTS for the migration target schema', async () => {
    const { DatabaseSecurityPresenter } =
      await import('../../../src/main/presenter/databaseSecurityPresenter')
    const presenter = new DatabaseSecurityPresenter({ dbPath: '/tmp/deepchat-test/agent.db' })

    expect(
      (
        presenter as unknown as {
          qualifyCreateTableSql: (sql: string) => string
        }
      ).qualifyCreateTableSql('CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY)')
    ).toBe('CREATE TABLE IF NOT EXISTS migration_target.providers (id TEXT PRIMARY KEY)')
  })

  it('excludes FTS virtual and shadow tables from database migration copies', async () => {
    const names = await listMigratableTableNames([
      {
        type: 'table',
        name: 'deepchat_tape_search_projection',
        sql: 'CREATE TABLE deepchat_tape_search_projection (id TEXT)'
      },
      {
        type: 'table',
        name: 'deepchat_tape_search_projection_meta',
        sql: 'CREATE TABLE deepchat_tape_search_projection_meta (id TEXT)'
      },
      {
        type: 'table',
        name: 'deepchat_tape_search_fts',
        sql: 'CREATE VIRTUAL TABLE deepchat_tape_search_fts USING fts5(search_text)'
      },
      {
        type: 'table',
        name: 'deepchat_tape_search_fts_data',
        sql: 'CREATE TABLE deepchat_tape_search_fts_data (id INTEGER)'
      },
      {
        type: 'table',
        name: 'messages',
        sql: 'CREATE TABLE messages (id TEXT)'
      }
    ])

    expect(names).toContain('messages')
    expect(names).toContain('deepchat_tape_search_projection')
    expect(names).toContain('deepchat_tape_search_projection_meta')
    expect(names).not.toContain('deepchat_tape_search_fts')
    expect(names).not.toContain('deepchat_tape_search_fts_data')
  })

  it('excludes tape FTS freshness metadata even when no FTS virtual table exists', async () => {
    const names = await listMigratableTableNames([
      {
        type: 'table',
        name: 'deepchat_tape_search_projection',
        sql: 'CREATE TABLE deepchat_tape_search_projection (id TEXT)'
      },
      {
        type: 'table',
        name: 'deepchat_tape_search_projection_meta',
        sql: 'CREATE TABLE deepchat_tape_search_projection_meta (id TEXT)'
      },
      {
        type: 'table',
        name: 'deepchat_tape_search_fts_meta',
        sql: 'CREATE TABLE deepchat_tape_search_fts_meta (id TEXT)'
      },
      {
        type: 'table',
        name: 'messages',
        sql: 'CREATE TABLE messages (id TEXT)'
      }
    ])

    expect(names).toContain('messages')
    expect(names).toContain('deepchat_tape_search_projection')
    expect(names).toContain('deepchat_tape_search_projection_meta')
    expect(names).not.toContain('deepchat_tape_search_fts_meta')
  })
})
