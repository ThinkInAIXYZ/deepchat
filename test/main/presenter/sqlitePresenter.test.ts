import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'os'
import Database from 'better-sqlite3-multiple-ciphers'
import { SQLitePresenter } from '../../../src/main/presenter/sqlitePresenter'

const fsMock = await import('fs')
const realFs = await vi.importActual<typeof import('fs')>('fs')
Object.assign(fsMock, realFs)
;(fsMock as any).promises = realFs.promises
const fs = realFs

const path = await vi.importActual<typeof import('path')>('path')

describe('SQLitePresenter legacy schema bootstrap', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('recreates legacy conversation tables when schema version is already advanced', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new Database(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (13, ${Date.now()});
    `)
    bootstrapDb.close()

    const presenter = new SQLitePresenter(dbPath)
    const conversationList = await presenter.getConversationList(1, 20)
    expect(conversationList.total).toBe(0)
    expect(conversationList.list).toEqual([])
    presenter.close()

    const checkDb = new Database(dbPath)
    const tables = checkDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('conversations', 'messages', 'message_attachments') ORDER BY name"
      )
      .all() as Array<{ name: string }>

    expect(tables).toEqual([
      { name: 'conversations' },
      { name: 'message_attachments' },
      { name: 'messages' }
    ])

    const conversationColumns = checkDb.prepare('PRAGMA table_info(conversations)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(conversationColumns.map((column) => column.name))

    expect(columnNames.has('is_new')).toBe(true)
    expect(columnNames.has('active_skills')).toBe(true)
    expect(columnNames.has('parent_conversation_id')).toBe(true)
    checkDb.close()
  })

  it('migrates new_sessions active_skills when schema version is already at 14', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new Database(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (14, ${Date.now()});
      CREATE TABLE IF NOT EXISTS new_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        project_dir TEXT,
        is_pinned INTEGER DEFAULT 0,
        is_draft INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    bootstrapDb.close()

    const presenter = new SQLitePresenter(dbPath)
    presenter.close()

    const checkDb = new Database(dbPath)
    const newSessionColumns = checkDb.prepare('PRAGMA table_info(new_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(newSessionColumns.map((column) => column.name))
    expect(columnNames.has('active_skills')).toBe(true)
    expect(columnNames.has('disabled_agent_tools')).toBe(true)

    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>
    expect(versions.map((row) => row.version)).toContain(16)
    checkDb.close()
  })

  it('creates fresh new_sessions tables with disabled_agent_tools column', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const presenter = new SQLitePresenter(dbPath)
    presenter.close()

    const checkDb = new Database(dbPath)
    const newSessionColumns = checkDb.prepare('PRAGMA table_info(new_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(newSessionColumns.map((column) => column.name))

    expect(columnNames.has('is_draft')).toBe(true)
    expect(columnNames.has('active_skills')).toBe(true)
    expect(columnNames.has('disabled_agent_tools')).toBe(true)

    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>
    expect(versions.map((row) => row.version)).toEqual(expect.arrayContaining([11, 15, 16]))
    checkDb.close()
  })
})
