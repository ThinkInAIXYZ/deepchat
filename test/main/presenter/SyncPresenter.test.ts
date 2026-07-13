import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import Database from 'better-sqlite3-multiple-ciphers'
import { unzipSync, zipSync } from 'fflate'
import * as fsMock from 'fs'

const configImportMocks = vi.hoisted(() => ({
  importLegacyConfig: vi.fn(),
  ensureConfigMigrationMarker: vi.fn(),
  readManifest: vi.fn()
}))

const cloudStorageMocks = vi.hoisted(() => ({
  testConnection: vi.fn(),
  uploadBackup: vi.fn(),
  listRemoteBackups: vi.fn(),
  downloadLatest: vi.fn()
}))

const mainPresenterMocks = vi.hoisted(() => ({
  broadcastConversationThreadListUpdate: vi.fn()
}))

vi.mock('better-sqlite3-multiple-ciphers', async () => {
  const fs = await vi.importActual<typeof import('fs')>('fs')
  const path = await vi.importActual<typeof import('path')>('path')

  type MockRow = Record<string, unknown>
  type MockState = {
    tables: Record<string, MockRow[]>
  }

  const readState = (dbPath: string): MockState => {
    if (!fs.existsSync(dbPath)) {
      return { tables: {} }
    }

    try {
      const raw = fs.readFileSync(dbPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<MockState>
      return {
        tables: parsed.tables ?? {}
      }
    } catch {
      return { tables: {} }
    }
  }

  const writeState = (dbPath: string, state: MockState) => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    fs.writeFileSync(dbPath, JSON.stringify(state, null, 2), 'utf-8')
  }

  class MockDatabase {
    private state: MockState

    constructor(
      private readonly dbPath: string,
      _options?: Record<string, unknown>
    ) {
      this.state = readState(dbPath)
    }

    exec(sql: string) {
      for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z_][\w]*)/gi)) {
        this.ensureTable(match[1])
      }
      this.flush()
      return this
    }

    prepare(sql: string) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim()

      if (normalizedSql.startsWith('INSERT OR REPLACE INTO conversations')) {
        return {
          run: (...args: unknown[]) => {
            if (normalizedSql.includes('conv_id')) {
              this.upsertRow('conversations', {
                conv_id: String(args[0] ?? ''),
                title: String(args[1] ?? '')
              })
              return
            }

            this.upsertRow('conversations', {
              id: String(args[0] ?? ''),
              title: String(args[1] ?? '')
            })
          }
        }
      }

      if (normalizedSql === 'SELECT id, title FROM conversations ORDER BY id') {
        return {
          all: () =>
            this.getTable('conversations')
              .map((row) => ({
                id: String(row.id ?? row.conv_id ?? ''),
                title: String(row.title ?? '')
              }))
              .sort((left, right) => left.id.localeCompare(right.id))
        }
      }

      if (normalizedSql === "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?") {
        return {
          get: (tableName: string) => (this.state.tables[tableName] ? { exists: 1 } : undefined)
        }
      }

      const countMatch = normalizedSql.match(/^SELECT COUNT\(\*\) as count FROM "?([\w]+)"?$/i)
      if (countMatch) {
        return {
          get: () => ({
            count: this.getTable(countMatch[1]).length
          })
        }
      }

      throw new Error(`Unsupported mock SQL: ${normalizedSql}`)
    }

    transaction<TArgs extends unknown[]>(fn: (...args: TArgs) => void) {
      return (...args: TArgs) => {
        fn(...args)
        this.flush()
      }
    }

    close() {
      this.flush()
    }

    private ensureTable(tableName: string) {
      if (!this.state.tables[tableName]) {
        this.state.tables[tableName] = []
      }
    }

    private getTable(tableName: string): MockRow[] {
      this.ensureTable(tableName)
      return this.state.tables[tableName]
    }

    private upsertRow(tableName: string, row: MockRow) {
      const table = this.getTable(tableName)
      const rowId = String(row.id ?? row.conv_id ?? '')
      const existingIndex = table.findIndex(
        (entry) => String(entry.id ?? entry.conv_id ?? '') === rowId
      )
      if (existingIndex >= 0) {
        table[existingIndex] = row
      } else {
        table.push(row)
      }
      this.flush()
    }

    private flush() {
      writeState(this.dbPath, this.state)
    }
  }

  return {
    default: MockDatabase,
    Database: MockDatabase
  }
})

vi.mock('../../../src/main/presenter/sqlitePresenter/importData', async () => {
  const fs = await vi.importActual<typeof import('fs')>('fs')
  const path = await vi.importActual<typeof import('path')>('path')

  type MockRow = Record<string, unknown>
  type MockState = {
    tables: Record<string, MockRow[]>
  }

  const readState = (dbPath: string): MockState => {
    if (!fs.existsSync(dbPath)) {
      return { tables: {} }
    }

    try {
      const raw = fs.readFileSync(dbPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<MockState>
      return {
        tables: parsed.tables ?? {}
      }
    } catch {
      return { tables: {} }
    }
  }

  const writeState = (dbPath: string, state: MockState) => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    fs.writeFileSync(dbPath, JSON.stringify(state, null, 2), 'utf-8')
  }

  class MockDataImporter {
    constructor(
      private readonly sourcePath: string,
      private readonly targetPath: string
    ) {}

    async importData() {
      const sourceState = readState(this.sourcePath)
      const targetState = readState(this.targetPath)
      const tableCounts: Record<string, number> = {}

      for (const [tableName, sourceRows] of Object.entries(sourceState.tables)) {
        const targetRows = targetState.tables[tableName] ?? []
        const targetKeys = new Set(targetRows.map((row) => this.getRowKey(tableName, row)))
        let added = 0

        for (const row of sourceRows) {
          const rowKey = this.getRowKey(tableName, row)
          if (!rowKey || targetKeys.has(rowKey)) {
            continue
          }
          targetRows.push({ ...row })
          targetKeys.add(rowKey)
          added += 1
        }

        if (added > 0) {
          targetState.tables[tableName] = targetRows
          tableCounts[tableName] = added
        }
      }

      writeState(this.targetPath, targetState)

      return { tableCounts }
    }

    close() {}

    private getRowKey(tableName: string, row: MockRow): string {
      if (tableName === 'provider_models') {
        return `${row.provider_id}:${row.model_id}:${row.source}`
      }
      if (tableName === 'agent_mcp_selections') {
        return `${row.agent_id}:${row.is_builtin}:${row.mcp_id}`
      }
      return String(
        row.id ?? row.conv_id ?? row.status_key ?? row.cache_key ?? row.name ?? row.key ?? ''
      )
    }
  }

  return {
    DataImporter: MockDataImporter
  }
})

vi.mock('../../../src/main/presenter/syncPresenter/configImportService', async () => {
  const fs = await vi.importActual<typeof import('fs')>('fs')
  const path = await vi.importActual<typeof import('path')>('path')

  class MockSyncConfigImportService {
    readManifest(extractionDir: string) {
      configImportMocks.readManifest(extractionDir)
      const manifestPath = path.join(extractionDir, 'manifest.json')
      if (!fs.existsSync(manifestPath)) {
        return null
      }
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    }

    importLegacyConfig(extractionDir: string, mode: string) {
      configImportMocks.importLegacyConfig(extractionDir, mode)
    }

    ensureConfigMigrationMarker() {
      configImportMocks.ensureConfigMigrationMarker()
    }
  }

  return {
    CURRENT_SYNC_BACKUP_VERSION: 2,
    CURRENT_SYNC_CONFIG_SCHEMA_VERSION: 1,
    SyncConfigImportService: MockSyncConfigImportService
  }
})

vi.mock('../../../src/main/presenter/syncPresenter/cloudStorageService', () => ({
  CloudStorageService: vi.fn(() => cloudStorageMocks)
}))

vi.mock('../../../src/main/presenter/index', () => ({
  presenter: mainPresenterMocks
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

const realFs = await vi.importActual<typeof import('fs')>('fs')
Object.assign(fsMock, realFs)
;(fsMock as any).promises = realFs.promises
const fs = realFs

const path = await vi.importActual<typeof import('path')>('path')
const { app } = await import('electron')
const { SyncPresenter } = await import('../../../src/main/presenter/syncPresenter')
const { ImportMode } = await import('../../../src/main/presenter/sqlitePresenter')
const { publishDeepchatEvent } = await import('@/routes/publishDeepchatEvent')

const ZIP_PATHS = {
  agentDb: 'database/agent.db',
  chatDb: 'database/chat.db',
  appSettings: 'configs/app-settings.json',
  customPrompts: 'configs/custom_prompts.json',
  systemPrompts: 'configs/system_prompts.json',
  mcpSettings: 'configs/mcp-settings.json',
  manifest: 'manifest.json'
}

function getPublishedEventPayloads(eventName: string) {
  return vi
    .mocked(publishDeepchatEvent)
    .mock.calls.filter(([name]) => name === eventName)
    .map(([, payload]) => payload)
}

describe('SyncPresenter backup import', () => {
  let userDataDir: string
  let tempDir: string
  let syncDir: string
  let presenter: InstanceType<typeof SyncPresenter>
  let configPresenter: any
  let sqlitePresenter: any
  let dbPragma: ReturnType<typeof vi.fn>
  let getPathSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    configImportMocks.importLegacyConfig.mockClear()
    configImportMocks.ensureConfigMigrationMarker.mockClear()
    configImportMocks.readManifest.mockClear()
    cloudStorageMocks.testConnection.mockReset()
    cloudStorageMocks.uploadBackup.mockReset()
    cloudStorageMocks.listRemoteBackups.mockReset()
    cloudStorageMocks.downloadLatest.mockReset()
    mainPresenterMocks.broadcastConversationThreadListUpdate.mockReset()
    vi.mocked(publishDeepchatEvent).mockClear()

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-user-'))
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-temp-'))
    syncDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sync-'))

    getPathSpy = vi.spyOn(app, 'getPath').mockImplementation((type: string) => {
      if (type === 'userData') {
        return userDataDir
      }
      if (type === 'temp') {
        return tempDir
      }
      return os.tmpdir()
    })

    dbPragma = vi.fn()
    sqlitePresenter = {
      close: vi.fn(),
      reopen: vi.fn(),
      getDatabase: vi.fn(() => ({
        open: true,
        pragma: dbPragma
      })),
      configTables: {
        hasConfigMigration: vi.fn(() => true)
      },
      getDatabasePassword: vi.fn(() => undefined),
      clearNewAgentData: vi.fn(),
      importLegacyChatDb: vi.fn(async () => ({
        importedSessions: 0,
        importedMessages: 0,
        importedSearchResults: 0
      }))
    }

    configPresenter = {
      getSyncFolderPath: vi.fn(() => syncDir),
      getSyncEnabled: vi.fn(() => true),
      getLastSyncTime: vi.fn(() => 0),
      setLastSyncTime: vi.fn(),
      getResolvedCloudSyncConfig: vi.fn(() => ({
        endpoint: 'https://r2.example.com',
        bucket: 'deepchat',
        region: 'auto',
        prefix: 'deepchat-backups',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key'
      }))
    }

    presenter = new SyncPresenter(configPresenter, sqlitePresenter)
  })

  afterEach(() => {
    presenter.destroy()
    getPathSpy.mockRestore()
    removeDir(syncDir)
    removeDir(tempDir)
    removeDir(userDataDir)
  })

  it('backs up migrated config through agent.db and keeps app-settings lightweight', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: {
        theme: 'light',
        locale: 'en',
        providers: [{ id: 'openai', name: 'OpenAI' }],
        providerOrder: ['openai'],
        providerTimestamps: { openai: 123 },
        model_status_openai_gpt4: true,
        openai_models: [{ id: 'gpt-4' }],
        custom_models_openai: [{ id: 'custom-gpt' }],
        recent_models: ['local-history']
      },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {
        mcpServers: {
          local: { command: 'bunx local', type: 'stdio', enabled: true }
        }
      }
    })

    const backup = await presenter.startBackup()
    expect(backup).not.toBeNull()
    expect(getPublishedEventPayloads('sync.backup.started')).toHaveLength(1)
    expect(getPublishedEventPayloads('sync.backup.completed')).toContainEqual(
      expect.objectContaining({
        timestamp: backup!.createdAt,
        version: expect.any(Number)
      })
    )
    expect(getPublishedEventPayloads('sync.backup.status.changed')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'preparing', previousStatus: 'idle' }),
        expect.objectContaining({ status: 'idle', lastSuccessfulBackupTime: backup!.createdAt })
      ])
    )

    const archivePath = path.join(syncDir, backup!.fileName)
    const files = unzipSync(new Uint8Array(fs.readFileSync(archivePath)))
    expect(files[ZIP_PATHS.agentDb]).toBeDefined()
    expect(files[ZIP_PATHS.mcpSettings]).toBeUndefined()
    expect(dbPragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)')
    const manifest = JSON.parse(Buffer.from(files[ZIP_PATHS.manifest]).toString('utf-8'))
    expect(manifest).toMatchObject({
      version: 2,
      configStorage: 'sqlite',
      configSchemaVersion: 1
    })

    const appSettings = JSON.parse(
      Buffer.from(files[ZIP_PATHS.appSettings]).toString('utf-8')
    ) as Record<string, unknown>
    expect(appSettings.theme).toBe('light')
    expect(appSettings.locale).toBe('en')
    expect(appSettings.providers).toBeUndefined()
    expect(appSettings.providerOrder).toBeUndefined()
    expect(appSettings.providerTimestamps).toBeUndefined()
    expect(appSettings.model_status_openai_gpt4).toBeUndefined()
    expect(appSettings.openai_models).toBeUndefined()
    expect(appSettings.custom_models_openai).toBeUndefined()
    expect(appSettings.recent_models).toEqual(['local-history'])
  })

  it('imports backup incrementally without overwriting existing data', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: {
        prompts: [{ id: 'prompt-local', title: 'Local prompt' }]
      },
      systemPrompts: {
        prompts: [{ id: 'system-local', title: 'Local system prompt' }]
      },
      mcpSettings: {
        mcpServers: {
          local: { command: 'bunx local', type: 'stdio', enabled: true }
        },
        defaultServers: ['local'],
        extra: true
      }
    })

    const backupFile = createBackupArchive(syncDir, Date.now(), {
      conversations: [
        { id: 'conv-1', title: 'Local conversation' },
        { id: 'conv-2', title: 'Imported conversation' }
      ],
      appSettings: { theme: 'dark', locale: 'zh' },
      customPrompts: {
        prompts: [
          { id: 'prompt-local', title: 'Local prompt (ignored)' },
          { id: 'prompt-imported', title: 'Imported prompt' }
        ]
      },
      systemPrompts: {
        prompts: [
          { id: 'system-local', title: 'Local system prompt (ignored)' },
          { id: 'system-imported', title: 'Imported system prompt' }
        ]
      },
      mcpSettings: {
        mcpServers: {
          imported: { command: 'bunx imported', type: 'stdio', enabled: false },
          knowledge: { command: 'bunx knowledge', type: 'stdio', enabled: true }
        },
        defaultServers: ['imported'],
        additional: true
      }
    })

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)

    expect(result.success).toBe(true)
    expect(getPublishedEventPayloads('sync.import.started')).toHaveLength(1)
    expect(getPublishedEventPayloads('sync.import.completed')).toHaveLength(1)
    expect(result.count).toBe(1)
    expect(result.sourceDbType).toBe('agent')
    expect(result.importedSessions).toBe(1)
    expect(sqlitePresenter.close).toHaveBeenCalled()
    expect(sqlitePresenter.reopen).toHaveBeenCalled()
    expect(configImportMocks.importLegacyConfig).toHaveBeenCalledWith(
      expect.stringContaining('deepchat-backup-'),
      'increment'
    )

    const dbPath = path.join(userDataDir, 'app_db', 'agent.db')
    const db = new Database(dbPath)
    const rows = db.prepare('SELECT id, title FROM conversations ORDER BY id').all()
    db.close()

    expect(rows).toEqual([
      { id: 'conv-1', title: 'Local conversation' },
      { id: 'conv-2', title: 'Imported conversation' }
    ])

    const appSettings = JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'app-settings.json'), 'utf-8')
    )
    expect(appSettings).toEqual({
      theme: 'dark',
      locale: 'zh',
      syncEnabled: true,
      syncFolderPath: syncDir,
      lastSyncTime: 0
    })

    const customPrompts = JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'custom_prompts.json'), 'utf-8')
    )
    expect(customPrompts.prompts).toEqual([
      { id: 'prompt-local', title: 'Local prompt' },
      { id: 'prompt-imported', title: 'Imported prompt' }
    ])

    const systemPrompts = JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'system_prompts.json'), 'utf-8')
    )
    expect(systemPrompts.prompts).toEqual([
      { id: 'system-local', title: 'Local system prompt' },
      { id: 'system-imported', title: 'Imported system prompt' }
    ])

    const mcpSettings = JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'mcp-settings.json'), 'utf-8')
    )
    expect(mcpSettings.mcpServers.local).toEqual({
      command: 'bunx local',
      type: 'stdio',
      enabled: true
    })
    expect(mcpSettings.mcpServers.imported).toBeUndefined()
    expect(mcpSettings.extra).toBe(true)
    expect(mcpSettings.additional).toBeUndefined()
  })

  it('rejects backup file names containing directory traversal', async () => {
    const result = await presenter.importFromSync('../backup-1.zip', ImportMode.INCREMENT)

    expect(result.success).toBe(false)
    expect(result.message).toBe('sync.error.noValidBackup')
    expect(sqlitePresenter.close).not.toHaveBeenCalled()
  })

  it('skips invalid backup-looking zip files during cloud upload', async () => {
    const validTimestamp = 1000
    const invalidTimestamp = 2000
    const validBackupFile = createBackupArchive(syncDir, validTimestamp, {
      conversations: [{ id: 'conv-1', title: 'Valid backup' }],
      appSettings: { theme: 'dark' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })
    fs.writeFileSync(path.join(syncDir, `backup-${invalidTimestamp}.zip`), 'not a zip')
    cloudStorageMocks.uploadBackup.mockResolvedValue(undefined)

    const result = await presenter.uploadLatestBackupToCloud()

    expect(result).toEqual({
      success: true,
      message: 'sync.success.cloudUploaded',
      fileName: validBackupFile
    })
    expect(cloudStorageMocks.uploadBackup).toHaveBeenCalledWith(
      path.join(syncDir, validBackupFile),
      validBackupFile
    )
  })

  it('normalizes R2 unauthorized cloud errors to a user-facing error key', async () => {
    cloudStorageMocks.testConnection.mockRejectedValue(
      new Error(
        'Unexpected (permanent) at list, context: { response: Parts { status: 401 } } => S3Error { code: "Unauthorized", message: "Unauthorized" }'
      )
    )

    await expect(presenter.testCloudConnection()).resolves.toEqual({
      success: false,
      message: 'sync.error.cloudUnauthorized'
    })
  })

  it('normalizes invalid access key / signature errors to the unauthorized key', async () => {
    cloudStorageMocks.testConnection.mockRejectedValue(
      new Error(
        'Unexpected (permanent) at list => S3Error { code: "InvalidAccessKeyId", message: "The Access Key Id you provided does not exist in our records." }'
      )
    )

    await expect(presenter.testCloudConnection()).resolves.toEqual({
      success: false,
      message: 'sync.error.cloudUnauthorized'
    })
  })

  it('keeps unknown cloud errors available for diagnostics', async () => {
    cloudStorageMocks.testConnection.mockRejectedValue(new Error('network down'))

    await expect(presenter.testCloudConnection()).resolves.toEqual({
      success: false,
      message: 'network down'
    })
  })

  it('imports v2 sqlite config rows incrementally without overwriting local rows', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {},
      extraAgentTables: {
        providers: [{ id: 'local', name: 'Local Provider' }],
        mcp_servers: [{ name: 'local-server', config_json: '{"enabled":true}' }]
      }
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [
          { id: 'conv-1', title: 'Local conversation' },
          { id: 'conv-2', title: 'Imported conversation' }
        ],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      {
        manifest: {
          version: 2,
          createdAt: Date.now(),
          configStorage: 'sqlite',
          configSchemaVersion: 1,
          files: [ZIP_PATHS.agentDb, ZIP_PATHS.appSettings]
        },
        extraAgentTables: {
          providers: [
            { id: 'local', name: 'Backup Provider' },
            { id: 'imported', name: 'Imported Provider' }
          ],
          mcp_servers: [
            { name: 'local-server', config_json: '{"enabled":false}' },
            { name: 'imported-server', config_json: '{"enabled":true}' }
          ]
        }
      }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)
    expect(result.success).toBe(true)
    expect(configImportMocks.ensureConfigMigrationMarker).toHaveBeenCalledTimes(1)
    expect(configImportMocks.importLegacyConfig).not.toHaveBeenCalled()

    const state = readMockDbState(path.join(userDataDir, 'app_db', 'agent.db'))
    expect(state.tables.providers).toEqual([
      { id: 'local', name: 'Local Provider' },
      { id: 'imported', name: 'Imported Provider' }
    ])
    expect(state.tables.mcp_servers).toEqual([
      { name: 'local-server', config_json: '{"enabled":true}' },
      { name: 'imported-server', config_json: '{"enabled":true}' }
    ])
  })

  it('rolls back import when local settings cannot be preserved', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: {
        theme: 'light',
        cloudSyncConfig: { endpoint: 'https://r2.example.com' },
        cloudSyncSecret: 'wrapped-secret'
      },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })
    const appSettingsPath = path.join(userDataDir, 'app-settings.json')
    fs.writeFileSync(appSettingsPath, '{not-json', 'utf-8')

    const backupFile = createBackupArchive(syncDir, Date.now(), {
      conversations: [{ id: 'conv-2', title: 'Imported conversation' }],
      appSettings: { theme: 'dark' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)

    expect(result.success).toBe(false)
    expect(result.message).toBe('sync.error.importFailed')
    expect(getPublishedEventPayloads('sync.import.error')).toContainEqual(
      expect.objectContaining({
        error: expect.any(String),
        version: expect.any(Number)
      })
    )
    expect(fs.readFileSync(appSettingsPath, 'utf-8')).toBe('{not-json')

    const db = new Database(path.join(userDataDir, 'app_db', 'agent.db'))
    const rows = db.prepare('SELECT id, title FROM conversations ORDER BY id').all()
    db.close()
    expect(rows).toEqual([{ id: 'conv-1', title: 'Local conversation' }])
  })

  it('rejects v2 sqlite backups without agent.db before touching local data', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [{ id: 'conv-2', title: 'Imported conversation' }],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      {
        dbType: 'chat',
        manifest: {
          version: 2,
          createdAt: Date.now(),
          configStorage: 'sqlite',
          configSchemaVersion: 1,
          files: [ZIP_PATHS.chatDb, ZIP_PATHS.appSettings]
        }
      }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)
    expect(result.success).toBe(false)
    expect(result.message).toBe('sync.error.noValidBackup')
    expect(sqlitePresenter.close).not.toHaveBeenCalled()
    expect(sqlitePresenter.importLegacyChatDb).not.toHaveBeenCalled()
    expect(configImportMocks.importLegacyConfig).not.toHaveBeenCalled()
    expect(configImportMocks.ensureConfigMigrationMarker).not.toHaveBeenCalled()
  })

  it('rejects unsupported future backup versions before touching local data', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [{ id: 'conv-2', title: 'Imported conversation' }],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      {
        manifest: {
          version: 99,
          createdAt: Date.now(),
          files: [ZIP_PATHS.agentDb]
        }
      }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)
    expect(result.success).toBe(false)
    expect(result.message).toBe('sync.error.unsupportedBackupVersion')
    expect(sqlitePresenter.close).not.toHaveBeenCalled()
    expect(configImportMocks.importLegacyConfig).not.toHaveBeenCalled()
    expect(configImportMocks.ensureConfigMigrationMarker).not.toHaveBeenCalled()
  })

  it('rejects unsupported future config schema versions before touching local data', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [{ id: 'conv-2', title: 'Imported conversation' }],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      {
        manifest: {
          version: 2,
          createdAt: Date.now(),
          configStorage: 'sqlite',
          configSchemaVersion: 99,
          files: [ZIP_PATHS.agentDb]
        }
      }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)
    expect(result.success).toBe(false)
    expect(result.message).toBe('sync.error.unsupportedBackupVersion')
    expect(sqlitePresenter.close).not.toHaveBeenCalled()
    expect(configImportMocks.importLegacyConfig).not.toHaveBeenCalled()
    expect(configImportMocks.ensureConfigMigrationMarker).not.toHaveBeenCalled()
  })

  it('rejects v2 backups without sqlite config metadata before touching local data', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [{ id: 'conv-2', title: 'Imported conversation' }],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      {
        manifest: {
          version: 2,
          createdAt: Date.now(),
          files: [ZIP_PATHS.agentDb]
        }
      }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)
    expect(result.success).toBe(false)
    expect(result.message).toBe('sync.error.noValidBackup')
    expect(sqlitePresenter.close).not.toHaveBeenCalled()
    expect(configImportMocks.importLegacyConfig).not.toHaveBeenCalled()
    expect(configImportMocks.ensureConfigMigrationMarker).not.toHaveBeenCalled()
  })

  it('returns a specific error when an encrypted backup has no local database key', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [{ id: 'conv-2', title: 'Imported conversation' }],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      {
        manifest: {
          version: 2,
          createdAt: Date.now(),
          configStorage: 'sqlite',
          configSchemaVersion: 1,
          databaseEncrypted: true,
          files: [ZIP_PATHS.agentDb, ZIP_PATHS.appSettings]
        }
      }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)
    expect(result.success).toBe(false)
    expect(result.message).toBe('sync.error.encryptedBackupPasswordMissing')
    expect(sqlitePresenter.close).not.toHaveBeenCalled()
  })

  it('rejects overwrite import when backup and local encryption states differ', async () => {
    sqlitePresenter.getDatabasePassword.mockReturnValue('local-pass')
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [{ id: 'conv-2', title: 'Imported conversation' }],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      {
        manifest: {
          version: 2,
          createdAt: Date.now(),
          configStorage: 'sqlite',
          configSchemaVersion: 1,
          databaseEncrypted: false,
          files: [ZIP_PATHS.agentDb, ZIP_PATHS.appSettings]
        }
      }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.OVERWRITE)
    expect(result.success).toBe(false)
    expect(result.message).toBe('sync.error.overwriteEncryptionMismatch')
    expect(sqlitePresenter.close).not.toHaveBeenCalled()
  })

  it('treats missing manifest backups as legacy backups', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [{ id: 'conv-2', title: 'Imported conversation' }],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      { manifest: null }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)
    expect(result.success).toBe(true)
    expect(configImportMocks.importLegacyConfig).toHaveBeenCalledWith(
      expect.stringContaining('deepchat-backup-'),
      'increment'
    )
  })

  it('overwrites existing data when import mode is OVERWRITE', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: {
        prompts: [{ id: 'prompt-local', title: 'Local prompt' }]
      },
      systemPrompts: {
        prompts: [{ id: 'system-local', title: 'Local system prompt' }]
      },
      mcpSettings: {
        mcpServers: {
          local: { command: 'bunx local', type: 'stdio', enabled: true }
        },
        defaultServers: ['local']
      }
    })

    const backupFile = createBackupArchive(syncDir, Date.now(), {
      conversations: [{ id: 'conv-2', title: 'Imported conversation only' }],
      appSettings: { theme: 'dark', locale: 'zh' },
      customPrompts: {
        prompts: [{ id: 'prompt-imported', title: 'Imported prompt only' }]
      },
      systemPrompts: {
        prompts: [{ id: 'system-imported', title: 'Imported system prompt only' }]
      },
      mcpSettings: {
        mcpServers: {
          imported: { command: 'bunx imported', type: 'stdio', enabled: true }
        },
        defaultServers: ['imported']
      }
    })

    const result = await presenter.importFromSync(backupFile, ImportMode.OVERWRITE)

    expect(result.success).toBe(true)
    expect(result.count).toBe(1)
    expect(result.sourceDbType).toBe('agent')
    expect(result.importedSessions).toBe(1)
    expect(sqlitePresenter.reopen).toHaveBeenCalled()
    expect(configImportMocks.importLegacyConfig).toHaveBeenCalledWith(
      expect.stringContaining('deepchat-backup-'),
      'overwrite'
    )

    const dbPath = path.join(userDataDir, 'app_db', 'agent.db')
    const db = new Database(dbPath)
    const rows = db.prepare('SELECT id, title FROM conversations ORDER BY id').all()
    db.close()

    expect(rows).toEqual([{ id: 'conv-2', title: 'Imported conversation only' }])

    const customPrompts = JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'custom_prompts.json'), 'utf-8')
    )
    expect(customPrompts.prompts).toEqual([
      { id: 'prompt-imported', title: 'Imported prompt only' }
    ])

    const mcpSettings = JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'mcp-settings.json'), 'utf-8')
    )
    expect(mcpSettings.mcpServers).toEqual({
      local: { command: 'bunx local', type: 'stdio', enabled: true }
    })
    expect(mcpSettings.defaultServers).toEqual(['local'])
  })

  it('imports backup from chat.db through legacy migration in increment mode', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    sqlitePresenter.importLegacyChatDb.mockResolvedValue({
      importedSessions: 2,
      importedMessages: 5,
      importedSearchResults: 1
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [{ id: 'legacy-conv-1', title: 'Legacy conversation' }],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      { dbType: 'chat' }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)

    expect(result.success).toBe(true)
    expect(result.count).toBe(2)
    expect(result.sourceDbType).toBe('chat')
    expect(result.importedSessions).toBe(2)
    expect(sqlitePresenter.importLegacyChatDb).toHaveBeenCalledTimes(1)
    const [sourcePathArg, modeArg] = sqlitePresenter.importLegacyChatDb.mock.calls[0]
    expect(typeof sourcePathArg).toBe('string')
    expect(sourcePathArg.endsWith(path.join('database', 'chat.db'))).toBe(true)
    expect(modeArg).toBe('increment')
  })

  it('imports backup from chat.db through legacy migration in overwrite mode', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    sqlitePresenter.importLegacyChatDb.mockResolvedValue({
      importedSessions: 3,
      importedMessages: 7,
      importedSearchResults: 2
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [{ id: 'legacy-conv-1', title: 'Legacy conversation' }],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      { dbType: 'chat' }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.OVERWRITE)

    expect(result.success).toBe(true)
    expect(result.count).toBe(3)
    expect(result.sourceDbType).toBe('chat')
    expect(result.importedSessions).toBe(3)
    expect(sqlitePresenter.importLegacyChatDb).toHaveBeenCalledTimes(1)
    const [sourcePathArg, modeArg] = sqlitePresenter.importLegacyChatDb.mock.calls[0]
    expect(typeof sourcePathArg).toBe('string')
    expect(sourcePathArg.endsWith(path.join('database', 'chat.db'))).toBe(true)
    expect(modeArg).toBe('overwrite')
  })

  it('prefers agent.db when both agent.db and chat.db exist in backup', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [{ id: 'conv-2', title: 'Imported conversation' }],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      { dbType: 'both' }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)
    expect(result.success).toBe(true)
    expect(result.sourceDbType).toBe('agent')
    expect(sqlitePresenter.importLegacyChatDb).not.toHaveBeenCalled()
  })

  it('returns noValidBackup when neither agent.db nor chat.db exists', async () => {
    createLocalState(userDataDir, {
      conversations: [{ id: 'conv-1', title: 'Local conversation' }],
      appSettings: { theme: 'light', locale: 'en' },
      customPrompts: { prompts: [] },
      systemPrompts: { prompts: [] },
      mcpSettings: {}
    })

    const backupFile = createBackupArchive(
      syncDir,
      Date.now(),
      {
        conversations: [{ id: 'conv-2', title: 'Imported conversation' }],
        appSettings: { theme: 'dark', locale: 'zh' },
        customPrompts: { prompts: [] },
        systemPrompts: { prompts: [] },
        mcpSettings: {}
      },
      { dbType: 'none' }
    )

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)
    expect(result.success).toBe(false)
    expect(result.message).toBe('sync.error.noValidBackup')
  })
})

function createLocalState(
  userDataDir: string,
  data: {
    conversations: Array<{ id: string; title: string }>
    appSettings: Record<string, unknown>
    customPrompts: { prompts: Array<Record<string, unknown>> }
    systemPrompts: { prompts: Array<Record<string, unknown>> }
    mcpSettings: Record<string, any>
    extraAgentTables?: Record<string, Array<Record<string, unknown>>>
  }
) {
  const dbDir = path.join(userDataDir, 'app_db')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'agent.db')
  writeConversationDb(dbPath, data.conversations)
  if (data.extraAgentTables) {
    setMockDbTables(dbPath, data.extraAgentTables)
  }

  fs.writeFileSync(
    path.join(userDataDir, 'app-settings.json'),
    JSON.stringify(data.appSettings, null, 2)
  )
  fs.writeFileSync(
    path.join(userDataDir, 'custom_prompts.json'),
    JSON.stringify(data.customPrompts, null, 2)
  )
  fs.writeFileSync(
    path.join(userDataDir, 'system_prompts.json'),
    JSON.stringify(data.systemPrompts, null, 2)
  )
  fs.writeFileSync(
    path.join(userDataDir, 'mcp-settings.json'),
    JSON.stringify(data.mcpSettings, null, 2)
  )
}

function writeConversationDb(dbPath: string, conversations: Array<{ id: string; title: string }>) {
  const db = new Database(dbPath)
  db.exec(`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL)`)
  const insert = db.prepare('INSERT OR REPLACE INTO conversations (id, title) VALUES (?, ?)')
  const insertMany = db.transaction((rows: Array<{ id: string; title: string }>) => {
    for (const row of rows) {
      insert.run(row.id, row.title)
    }
  })
  insertMany(conversations)
  db.close()
}

function createBackupArchive(
  backupsDir: string,
  timestamp: number,
  data: {
    conversations: Array<{ id: string; title: string }>
    appSettings: Record<string, unknown>
    customPrompts: { prompts: Array<Record<string, unknown>> }
    systemPrompts: { prompts: Array<Record<string, unknown>> }
    mcpSettings: Record<string, any>
  },
  options: {
    dbType?: 'agent' | 'chat' | 'both' | 'none'
    manifest?: Record<string, unknown> | null
    extraAgentTables?: Record<string, Array<Record<string, unknown>>>
  } = {}
): string {
  const dbType = options.dbType ?? 'agent'
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-backup-src-'))
  const databaseDir = path.join(tempDir, 'database')
  const configsDir = path.join(tempDir, 'configs')
  fs.mkdirSync(databaseDir, { recursive: true })
  fs.mkdirSync(configsDir, { recursive: true })

  const agentDbPath = path.join(databaseDir, 'agent.db')
  if (dbType === 'agent' || dbType === 'both') {
    writeConversationDb(agentDbPath, data.conversations)
    if (options.extraAgentTables) {
      setMockDbTables(agentDbPath, options.extraAgentTables)
    }
  }

  const chatDbPath = path.join(databaseDir, 'chat.db')
  if (dbType === 'chat' || dbType === 'both') {
    writeLegacyChatDb(chatDbPath, data.conversations)
  }

  fs.writeFileSync(
    path.join(configsDir, 'app-settings.json'),
    JSON.stringify(data.appSettings, null, 2)
  )
  fs.writeFileSync(
    path.join(configsDir, 'custom_prompts.json'),
    JSON.stringify(data.customPrompts, null, 2)
  )
  fs.writeFileSync(
    path.join(configsDir, 'system_prompts.json'),
    JSON.stringify(data.systemPrompts, null, 2)
  )
  fs.writeFileSync(
    path.join(configsDir, 'mcp-settings.json'),
    JSON.stringify(data.mcpSettings, null, 2)
  )

  const files: Record<string, Uint8Array> = {}
  if (dbType === 'agent' || dbType === 'both') {
    files[ZIP_PATHS.agentDb] = new Uint8Array(fs.readFileSync(agentDbPath))
  }
  if (dbType === 'chat' || dbType === 'both') {
    files[ZIP_PATHS.chatDb] = new Uint8Array(fs.readFileSync(chatDbPath))
  }
  files[ZIP_PATHS.appSettings] = new Uint8Array(
    Buffer.from(JSON.stringify(data.appSettings, null, 2), 'utf-8')
  )
  files[ZIP_PATHS.customPrompts] = new Uint8Array(
    Buffer.from(JSON.stringify(data.customPrompts, null, 2), 'utf-8')
  )
  files[ZIP_PATHS.systemPrompts] = new Uint8Array(
    Buffer.from(JSON.stringify(data.systemPrompts, null, 2), 'utf-8')
  )
  files[ZIP_PATHS.mcpSettings] = new Uint8Array(
    Buffer.from(JSON.stringify(data.mcpSettings, null, 2), 'utf-8')
  )

  if (options.manifest !== null) {
    const manifest = options.manifest ?? {
      version: 1,
      createdAt: timestamp,
      files: Object.keys(files)
    }
    files[ZIP_PATHS.manifest] = new Uint8Array(
      Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8')
    )
  }

  const zipData = zipSync(files, { level: 6 })
  const backupFileName = `backup-${timestamp}.zip`
  const backupPath = path.join(backupsDir, backupFileName)
  fs.writeFileSync(backupPath, Buffer.from(zipData))

  removeDir(tempDir)
  return backupFileName
}

function setMockDbTables(dbPath: string, tables: Record<string, Array<Record<string, unknown>>>) {
  const raw = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf-8') : '{"tables":{}}'
  const state = JSON.parse(raw) as { tables: Record<string, Array<Record<string, unknown>>> }
  state.tables = {
    ...state.tables,
    ...tables
  }
  fs.writeFileSync(dbPath, JSON.stringify(state, null, 2), 'utf-8')
}

function readMockDbState(dbPath: string): {
  tables: Record<string, Array<Record<string, unknown>>>
} {
  return JSON.parse(fs.readFileSync(dbPath, 'utf-8')) as {
    tables: Record<string, Array<Record<string, unknown>>>
  }
}

function writeLegacyChatDb(dbPath: string, conversations: Array<{ id: string; title: string }>) {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      conv_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      provider_id TEXT,
      model_id TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      msg_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'sent',
      is_variant INTEGER DEFAULT 0,
      parent_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER,
      order_seq INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS acp_sessions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workdir TEXT
    );
  `)

  const now = Date.now()
  const insertConv = db.prepare(
    `INSERT OR REPLACE INTO conversations (
      conv_id,
      title,
      provider_id,
      model_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  )

  const insertMany = db.transaction((rows: Array<{ id: string; title: string }>) => {
    for (const row of rows) {
      insertConv.run(row.id, row.title, 'openai', 'gpt-4', now, now)
    }
  })

  insertMany(conversations)
  db.close()
}

function removeDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    return
  }
  for (const entry of fs.readdirSync(dirPath)) {
    const entryPath = path.join(dirPath, entry)
    const stat = fs.lstatSync(entryPath)
    if (stat.isDirectory()) {
      removeDir(entryPath)
    } else {
      fs.unlinkSync(entryPath)
    }
  }
  fs.rmdirSync(dirPath)
}
