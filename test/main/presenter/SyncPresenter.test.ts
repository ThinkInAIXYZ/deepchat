import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import Database from 'better-sqlite3-multiple-ciphers'
import { zipSync } from 'fflate'
import * as fsMock from 'fs'

const realFs = await vi.importActual<typeof import('fs')>('fs')
Object.assign(fsMock, realFs)
;(fsMock as any).promises = realFs.promises
const fs = realFs

const path = await vi.importActual<typeof import('path')>('path')
const { app } = await import('electron')
const { SyncPresenter } = await import('../../../src/main/presenter/syncPresenter')
const { ImportMode } = await import('../../../src/main/presenter/sqlitePresenter')

const ZIP_PATHS = {
  agentDb: 'database/agent.db',
  chatDb: 'database/chat.db',
  appSettings: 'configs/app-settings.json',
  customPrompts: 'configs/custom_prompts.json',
  systemPrompts: 'configs/system_prompts.json',
  mcpSettings: 'configs/mcp-settings.json',
  manifest: 'manifest.json'
}

describe('SyncPresenter backup import', () => {
  let userDataDir: string
  let tempDir: string
  let syncDir: string
  let presenter: InstanceType<typeof SyncPresenter>
  let configPresenter: any
  let sqlitePresenter: any
  let getPathSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
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

    sqlitePresenter = {
      close: vi.fn(),
      reopen: vi.fn(),
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
      setLastSyncTime: vi.fn()
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
    expect(result.count).toBe(1)
    expect(result.sourceDbType).toBe('agent')
    expect(result.importedSessions).toBe(1)
    expect(sqlitePresenter.close).toHaveBeenCalled()
    expect(sqlitePresenter.reopen).toHaveBeenCalled()

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
    expect(appSettings).toEqual({ theme: 'dark', locale: 'zh' })

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
    expect(mcpSettings.mcpServers.imported).toEqual({
      command: 'bunx imported',
      type: 'stdio',
      enabled: true
    })
    expect(mcpSettings.mcpServers.knowledge).toBeUndefined()
    expect(mcpSettings.defaultServers).toBeUndefined()
    expect(mcpSettings.extra).toBe(true)
    expect(mcpSettings.additional).toBe(true)
  })

  it('rejects backup file names containing directory traversal', async () => {
    const result = await presenter.importFromSync('../backup-1.zip', ImportMode.INCREMENT)

    expect(result.success).toBe(false)
    expect(result.message).toBe('sync.error.noValidBackup')
    expect(sqlitePresenter.close).not.toHaveBeenCalled()
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
      imported: { command: 'bunx imported', type: 'stdio', enabled: true }
    })
    expect(mcpSettings.defaultServers).toBeUndefined()
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
  }
) {
  const dbDir = path.join(userDataDir, 'app_db')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'agent.db')
  writeConversationDb(dbPath, data.conversations)

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
  options: { dbType?: 'agent' | 'chat' | 'both' | 'none' } = {}
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

  const manifest = {
    version: 1,
    createdAt: timestamp,
    files: Object.keys(files)
  }
  files[ZIP_PATHS.manifest] = new Uint8Array(
    Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8')
  )

  const zipData = zipSync(files, { level: 6 })
  const backupFileName = `backup-${timestamp}.zip`
  const backupPath = path.join(backupsDir, backupFileName)
  fs.writeFileSync(backupPath, Buffer.from(zipData))

  removeDir(tempDir)
  return backupFileName
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
