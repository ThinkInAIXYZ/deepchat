import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'os'

const fsMock = await import('fs')
const realFs = await vi.importActual<typeof import('fs')>('fs')
Object.assign(fsMock, realFs)
;(fsMock as any).promises = realFs.promises
const fs = realFs

const path = await vi.importActual<typeof import('path')>('path')
const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const sqlitePresenterModule = sqliteModule
  ? await import('../../../src/main/presenter/sqlitePresenter').catch(() => null)
  : null
const Database = sqliteModule?.default
const SQLitePresenter = sqlitePresenterModule?.SQLitePresenter
let sqliteAvailable = false
if (Database) {
  try {
    const smokeDb = new Database(':memory:')
    smokeDb.close()
    sqliteAvailable = true
  } catch {
    sqliteAvailable = false
  }
}
const DatabaseCtor = Database!
const SQLitePresenterCtor = SQLitePresenter!
const describeIfSqlite = sqliteAvailable && SQLitePresenter ? describe : describe.skip

describeIfSqlite('SQLitePresenter legacy schema bootstrap', () => {
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
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (13, ${Date.now()});
    `)
    bootstrapDb.close()

    const presenter = new SQLitePresenterCtor(dbPath)
    const conversationList = await presenter.getConversationList(1, 20)
    expect(conversationList.total).toBe(0)
    expect(conversationList.list).toEqual([])
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
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
    const bootstrapDb = new DatabaseCtor(dbPath)
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

    const presenter = new SQLitePresenterCtor(dbPath)
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
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
    const presenter = new SQLitePresenterCtor(dbPath)
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const newSessionColumns = checkDb.prepare('PRAGMA table_info(new_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(newSessionColumns.map((column) => column.name))
    const environmentColumns = checkDb
      .prepare('PRAGMA table_info(new_environments)')
      .all() as Array<{
      name: string
    }>
    const environmentColumnNames = new Set(environmentColumns.map((column) => column.name))

    expect(columnNames.has('is_draft')).toBe(true)
    expect(columnNames.has('active_skills')).toBe(true)
    expect(columnNames.has('disabled_agent_tools')).toBe(true)
    expect(environmentColumnNames).toEqual(new Set(['path', 'session_count', 'last_used_at']))

    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>
    expect(versions.map((row) => row.version)).toEqual(expect.arrayContaining([11, 15, 16, 17]))
    checkDb.close()
  })

  it('recreates new_sessions with applied columns when schema version is already 16', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (16, ${Date.now()});
    `)
    bootstrapDb.close()

    const presenter = new SQLitePresenterCtor(dbPath)
    presenter.newSessionsTable.create('session-1', 'agent-1', 'Recovered session', null)
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const newSessionColumns = checkDb.prepare('PRAGMA table_info(new_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(newSessionColumns.map((column) => column.name))

    expect(columnNames.has('is_draft')).toBe(true)
    expect(columnNames.has('active_skills')).toBe(true)
    expect(columnNames.has('disabled_agent_tools')).toBe(true)

    const row = checkDb
      .prepare(
        'SELECT is_draft, active_skills, disabled_agent_tools FROM new_sessions WHERE id = ?'
      )
      .get('session-1') as
      | {
          is_draft: number
          active_skills: string
          disabled_agent_tools: string
        }
      | undefined

    expect(row).toEqual({
      is_draft: 0,
      active_skills: '[]',
      disabled_agent_tools: '[]'
    })
    checkDb.close()
  })

  it('migrates new_environments from existing session history when schema version is 16', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (16, ${Date.now()});
      CREATE TABLE IF NOT EXISTS new_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        project_dir TEXT,
        is_pinned INTEGER DEFAULT 0,
        is_draft INTEGER NOT NULL DEFAULT 0,
        active_skills TEXT NOT NULL DEFAULT '[]',
        disabled_agent_tools TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS acp_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT UNIQUE,
        workdir TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        UNIQUE(conversation_id, agent_id)
      );
      INSERT INTO new_sessions
        (id, agent_id, title, project_dir, is_pinned, is_draft, active_skills, disabled_agent_tools, created_at, updated_at)
      VALUES
        ('s1', 'deepchat', 'One', '/work/app-a', 0, 0, '[]', '[]', 100, 200),
        ('s2', 'deepchat', 'Two', '/work/app-a', 0, 0, '[]', '[]', 150, 300),
        ('s3', 'agent-1', 'Temp', NULL, 0, 0, '[]', '[]', 200, 250),
        ('s4', 'deepchat', 'Draft', '/work/draft', 0, 1, '[]', '[]', 300, 400),
        ('s5', 'deepchat', 'Empty', '', 0, 0, '[]', '[]', 500, 600);
      INSERT INTO acp_sessions
        (conversation_id, agent_id, session_id, workdir, status, created_at, updated_at, metadata)
      VALUES
        ('s3', 'agent-1', NULL, '/work/app-b', 'idle', 200, 275, NULL);
    `)
    bootstrapDb.close()

    const presenter = new SQLitePresenterCtor(dbPath)
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const rows = checkDb
      .prepare('SELECT path, session_count, last_used_at FROM new_environments ORDER BY path ASC')
      .all() as Array<{
      path: string
      session_count: number
      last_used_at: number
    }>
    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>

    expect(rows).toEqual([
      {
        path: '/work/app-a',
        session_count: 2,
        last_used_at: 300
      },
      {
        path: '/work/app-b',
        session_count: 1,
        last_used_at: 275
      }
    ])
    expect(versions.map((row) => row.version)).toContain(18)
    checkDb.close()
  })

  it('does not duplicate environment rows when reopening an already migrated database', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (16, ${Date.now()});
      CREATE TABLE IF NOT EXISTS new_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        project_dir TEXT,
        is_pinned INTEGER DEFAULT 0,
        is_draft INTEGER NOT NULL DEFAULT 0,
        active_skills TEXT NOT NULL DEFAULT '[]',
        disabled_agent_tools TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS acp_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT UNIQUE,
        workdir TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        UNIQUE(conversation_id, agent_id)
      );
      INSERT INTO new_sessions
        (id, agent_id, title, project_dir, is_pinned, is_draft, active_skills, disabled_agent_tools, created_at, updated_at)
      VALUES
        ('s1', 'deepchat', 'One', '/work/app-a', 0, 0, '[]', '[]', 100, 200),
        ('s2', 'deepchat', 'Two', '/work/app-a', 0, 0, '[]', '[]', 150, 300);
    `)
    bootstrapDb.close()

    const firstPresenter = new SQLitePresenterCtor(dbPath)
    firstPresenter.close()

    const secondPresenter = new SQLitePresenterCtor(dbPath)
    secondPresenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const rows = checkDb
      .prepare('SELECT path, session_count, last_used_at FROM new_environments')
      .all() as Array<{
      path: string
      session_count: number
      last_used_at: number
    }>

    expect(rows).toEqual([
      {
        path: '/work/app-a',
        session_count: 2,
        last_used_at: 300
      }
    ])
    checkDb.close()
  })

  it('recreates deepchat_sessions with applied columns when schema version is already 14', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (14, ${Date.now()});
    `)
    bootstrapDb.close()

    const presenter = new SQLitePresenterCtor(dbPath)
    presenter.deepchatSessionsTable.create('session-1', 'openai', 'gpt-4o')
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const deepchatColumns = checkDb.prepare('PRAGMA table_info(deepchat_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(deepchatColumns.map((column) => column.name))

    expect(columnNames.has('system_prompt')).toBe(true)
    expect(columnNames.has('summary_text')).toBe(true)
    expect(columnNames.has('summary_cursor_order_seq')).toBe(true)

    const row = checkDb
      .prepare(
        'SELECT system_prompt, summary_text, summary_cursor_order_seq FROM deepchat_sessions WHERE id = ?'
      )
      .get('session-1') as
      | {
          system_prompt: string | null
          summary_text: string | null
          summary_cursor_order_seq: number
        }
      | undefined

    expect(row).toEqual({
      system_prompt: null,
      summary_text: null,
      summary_cursor_order_seq: 1
    })
    checkDb.close()
  })
})
