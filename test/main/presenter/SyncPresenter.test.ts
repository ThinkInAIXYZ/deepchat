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
  db: 'database/chat.db',
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
      close: vi.fn()
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
          local: { command: 'bunx local', type: 'stdio' }
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
          imported: { command: 'bunx imported', type: 'stdio' },
          knowledge: { command: 'bunx knowledge', type: 'stdio' }
        },
        defaultServers: ['imported'],
        additional: true
      }
    })

    const result = await presenter.importFromSync(backupFile, ImportMode.INCREMENT)

    expect(result.success).toBe(true)
    expect(result.count).toBe(1)
    expect(sqlitePresenter.close).toHaveBeenCalled()

    const dbPath = path.join(userDataDir, 'app_db', 'chat.db')
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
    expect(mcpSettings.mcpServers.local).toEqual({ command: 'bunx local', type: 'stdio' })
    expect(mcpSettings.mcpServers.imported).toEqual({ command: 'bunx imported', type: 'stdio' })
    expect(mcpSettings.mcpServers.knowledge).toBeUndefined()
    expect(new Set(mcpSettings.defaultServers)).toEqual(new Set(['local', 'imported']))
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
          local: { command: 'bunx local', type: 'stdio' }
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
          imported: { command: 'bunx imported', type: 'stdio' }
        },
        defaultServers: ['imported']
      }
    })

    const result = await presenter.importFromSync(backupFile, ImportMode.OVERWRITE)

    expect(result.success).toBe(true)
    expect(result.count).toBe(1)

    const dbPath = path.join(userDataDir, 'app_db', 'chat.db')
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
      imported: { command: 'bunx imported', type: 'stdio' }
    })
    expect(mcpSettings.defaultServers).toEqual(['imported'])
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
  const dbPath = path.join(dbDir, 'chat.db')
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
  }
): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-backup-src-'))
  const databaseDir = path.join(tempDir, 'database')
  const configsDir = path.join(tempDir, 'configs')
  fs.mkdirSync(databaseDir, { recursive: true })
  fs.mkdirSync(configsDir, { recursive: true })

  const dbPath = path.join(databaseDir, 'chat.db')
  writeConversationDb(dbPath, data.conversations)

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
  files[ZIP_PATHS.db] = new Uint8Array(fs.readFileSync(dbPath))
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
