import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldExcludeFromSqliteCopy } from '@/data/sqliteCopyExclusions'
import type { DatabaseSecurityMetadata } from '@/app/databaseSecurity'

const mocks = vi.hoisted(() => {
  const stores = new Map<string, Record<string, unknown>>()
  const safeStorage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`wrapped:${value}`, 'utf8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^wrapped:/, '')),
    getSelectedStorageBackend: vi.fn(() => 'basic_text')
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
    openSQLiteDatabase
  }
})

vi.mock('../../../src/main/data/databaseConnection', () => ({
  openSQLiteDatabase: mocks.openSQLiteDatabase
}))

function fixtureOptions() {
  return {
    dbPath: '/tmp/deepchat-test/agent.db',
    metadata: {
      get: () =>
        mocks.stores.get('database-security')?.metadata as DatabaseSecurityMetadata | undefined,
      set: (_key: 'metadata', metadata: DatabaseSecurityMetadata) => {
        mocks.stores.set('database-security', { metadata })
      }
    },
    crypto: {
      isAvailable: async () => mocks.safeStorage.isEncryptionAvailable(),
      encrypt: async (value: string) => mocks.safeStorage.encryptString(value).toString('base64'),
      decrypt: async (wrapped: string) =>
        mocks.safeStorage.decryptString(Buffer.from(wrapped, 'base64')),
      getBackend: async () =>
        process.platform === 'linux' ? mocks.safeStorage.getSelectedStorageBackend() : undefined
    }
  }
}

const enabledMetadata = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  enabled: true,
  cipher: 'sqlcipher',
  passwordStorage: 'safeStorage',
  wrappedPassword: Buffer.from('wrapped:secret', 'utf8').toString('base64'),
  ...overrides
})

async function listMigratableTableNames(
  rows: Array<{ type: string; name: string; sql: string }>,
  foreignKeys: Record<string, string[]> = {}
): Promise<string[]> {
  const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
  const presenter = new DatabaseSecurityService(fixtureOptions())
  const db = {
    prepare: vi.fn((sql: string) => {
      const tableName = sql.match(/foreign_key_list\("([^"]+)"\)/u)?.[1]
      return {
        all: vi.fn(() =>
          tableName ? (foreignKeys[tableName] ?? []).map((table) => ({ table })) : rows
        )
      }
    })
  }
  const tables = (
    presenter as unknown as {
      listMigratableTables: (database: typeof db) => Array<{ name: string }>
    }
  ).listMigratableTables(db)
  return tables.map((table) => table.name)
}

describe('DatabaseSecurityService', () => {
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
    mocks.openSQLiteDatabase.mockReset()
    mocks.openSQLiteDatabase.mockImplementation(() => ({
      prepare: vi.fn(() => ({
        get: vi.fn(() => ({ name: 'schema_versions' }))
      })),
      close: vi.fn()
    }))
  })

  it('reports manual unlock when safeStorage is unavailable', async () => {
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(false)
    mocks.stores.set('database-security', {
      metadata: enabledMetadata({
        passwordStorage: 'manual',
        wrappedPassword: undefined
      })
    })

    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const presenter = new DatabaseSecurityService(fixtureOptions())

    expect(await presenter.getStatus()).toMatchObject({
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

    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const presenter = new DatabaseSecurityService(fixtureOptions())
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

    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const presenter = new DatabaseSecurityService(fixtureOptions())
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

  it('persists recovered encryption metadata without forging a migration', async () => {
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(false)
    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const presenter = new DatabaseSecurityService(fixtureOptions())

    await presenter.persistRecoveredEncryptionMetadata('recovered-secret')

    expect(mocks.stores.get('database-security')?.metadata).toMatchObject({
      version: 1,
      enabled: true,
      cipher: 'sqlcipher',
      passwordStorage: 'manual',
      lastMigrationAt: undefined,
      lastMigrationDirection: undefined
    })
  })

  it('returns a proven password when unlock hits decrypted corruption', async () => {
    mocks.stores.set('database-security', {
      metadata: enabledMetadata()
    })
    mocks.openSQLiteDatabase.mockImplementation(() => {
      throw new Error('database disk image is malformed')
    })

    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const presenter = new DatabaseSecurityService(fixtureOptions())

    await expect(presenter.resolveStartupPassword(async () => 'secret')).resolves.toBe('secret')
  })

  it('keeps SQLCipher not-a-database failures in the invalid-password loop', async () => {
    mocks.stores.set('database-security', {
      metadata: enabledMetadata({
        passwordStorage: 'manual',
        wrappedPassword: undefined
      })
    })
    mocks.openSQLiteDatabase.mockImplementation(() => {
      throw new Error('file is not a database')
    })

    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const presenter = new DatabaseSecurityService(fixtureOptions())
    const requests: unknown[] = []

    await expect(
      presenter.resolveStartupPassword(async (request) => {
        requests.push(request.reason)
        if (requests.length === 1) {
          return 'wrong'
        }
        return null
      })
    ).rejects.toThrow('Database unlock canceled')
    expect(requests).toEqual(['manual-required', 'invalid'])
  })

  it('rethrows leftover WAL errors instead of treating them as a wrong password', async () => {
    const { OrphanWalDatabaseError } = await import('@/data/databaseStartupRecovery')
    mocks.stores.set('database-security', {
      metadata: enabledMetadata({
        passwordStorage: 'manual',
        wrappedPassword: undefined
      })
    })
    mocks.openSQLiteDatabase.mockImplementation(() => {
      throw new OrphanWalDatabaseError('/tmp/deepchat-test/agent.db')
    })

    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const presenter = new DatabaseSecurityService(fixtureOptions())

    await expect(presenter.resolveStartupPassword(async () => 'secret')).rejects.toBeInstanceOf(
      OrphanWalDatabaseError
    )
  })

  it('rejects when startup unlock is canceled', async () => {
    mocks.stores.set('database-security', {
      metadata: enabledMetadata({
        passwordStorage: 'manual',
        wrappedPassword: undefined
      })
    })

    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const presenter = new DatabaseSecurityService(fixtureOptions())

    await expect(presenter.resolveStartupPassword(async () => null)).rejects.toThrow(
      'Database unlock canceled'
    )
  })

  it('discards a password decrypted after the owner stops', async () => {
    mocks.stores.set('database-security', { metadata: enabledMetadata() })
    const options = fixtureOptions()
    let finish!: (password: string) => void
    options.crypto.decrypt = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        })
    )
    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const service = new DatabaseSecurityService(options)
    const unlock = vi.fn()
    const result = service.resolveStartupPassword(unlock)
    const rejected = expect(result).rejects.toThrow('Database security operation interrupted')
    await vi.waitFor(() => expect(options.crypto.decrypt).toHaveBeenCalled())
    service.stop()
    finish('secret')
    await rejected
    expect(mocks.openSQLiteDatabase).not.toHaveBeenCalled()
    expect(unlock).not.toHaveBeenCalled()
  })

  it('discards a manual password wrapped after the owner stops', async () => {
    const original = enabledMetadata({ passwordStorage: 'manual', wrappedPassword: undefined })
    mocks.stores.set('database-security', { metadata: original })
    const options = fixtureOptions()
    let finish!: (wrapped: string) => void
    options.crypto.encrypt = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        })
    )
    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const service = new DatabaseSecurityService(options)
    const result = service.resolveStartupPassword(async () => 'secret')
    const rejected = expect(result).rejects.toThrow('Database security operation interrupted')
    await vi.waitFor(() => expect(options.crypto.encrypt).toHaveBeenCalled())
    service.stop()
    finish('late-wrapped-secret')
    await rejected
    expect(mocks.stores.get('database-security')?.metadata).toEqual(original)
  })

  it('propagates native wrapping failure without retrying a valid manual password', async () => {
    const original = enabledMetadata({ passwordStorage: 'manual', wrappedPassword: undefined })
    mocks.stores.set('database-security', { metadata: original })
    mocks.safeStorage.encryptString.mockImplementationOnce(() => {
      throw new Error('vault locked')
    })
    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const service = new DatabaseSecurityService(fixtureOptions())
    const unlock = vi.fn(async () => 'secret')
    await expect(service.resolveStartupPassword(unlock)).rejects.toThrow('vault locked')
    expect(unlock).toHaveBeenCalledTimes(1)
    expect(mocks.stores.get('database-security')?.metadata).toEqual(original)
  })

  it('cleans legacy provider JSON before enabling encryption', async () => {
    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const presenter = new DatabaseSecurityService(fixtureOptions())
    const migrateDatabase = vi
      .spyOn(presenter as unknown as { migrateDatabase: () => void }, 'migrateDatabase')
      .mockReturnValue(undefined)
    const cleanupLegacyProviderJsonForDatabaseEncryption = vi.fn(() => 1)

    await presenter.enableEncryption({
      password: 'secret',
      database: {} as never,
      providerSettings: {
        cleanupLegacyProviderJsonForDatabaseEncryption
      } as never
    })

    expect(cleanupLegacyProviderJsonForDatabaseEncryption).toHaveBeenCalledTimes(1)
    expect(migrateDatabase).toHaveBeenCalledTimes(1)
  })

  it('qualifies CREATE TABLE IF NOT EXISTS for the migration target schema', async () => {
    const { DatabaseSecurityService } = await import('@/app/databaseSecurity')
    const presenter = new DatabaseSecurityService(fixtureOptions())

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

  it('preserves replica cursors and change history during encryption migration', async () => {
    const names = await listMigratableTableNames(
      ['_sync_state', '_sync_changes', '_sync_receipts'].map((name) => ({
        type: 'table',
        name,
        sql: `CREATE TABLE ${name} (id TEXT)`
      }))
    )
    expect(names).toEqual(['_sync_changes', '_sync_receipts', '_sync_state'])
  })

  it('uses dependency order for encryption database copies', async () => {
    const table = (name: string) => ({
      type: 'table',
      name,
      sql: `CREATE TABLE ${name} (id TEXT)`
    })
    const names = await listMigratableTableNames(
      [
        table('live_delegation_events'),
        table('live_delegation_turns'),
        table('live_delegations'),
        table('new_sessions')
      ],
      {
        live_delegation_turns: ['live_delegations'],
        live_delegation_events: ['live_delegations', 'live_delegation_turns']
      }
    )

    expect(names).toEqual([
      'new_sessions',
      'live_delegations',
      'live_delegation_turns',
      'live_delegation_events'
    ])
  })

  it('rebuilds memory dirty work while preserving durable lineage during database copies', () => {
    expect(shouldExcludeFromSqliteCopy('agent_memory_dirty')).toBe(true)
    expect(shouldExcludeFromSqliteCopy('agent_memory_dirty_ai')).toBe(true)
    expect(shouldExcludeFromSqliteCopy('agent_memory_dirty_au')).toBe(true)
    expect(shouldExcludeFromSqliteCopy('agent_memory_dirty_ad')).toBe(true)
    expect(shouldExcludeFromSqliteCopy('agent_memory_derivation')).toBe(false)
  })
})
