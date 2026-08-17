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
  ? await import('../../../src/main/data/mainDatabase').catch(() => null)
  : null
const schemaCatalogModule = sqliteModule
  ? await import('../../../src/main/data/schemaCatalog').catch(() => null)
  : null
const Database = sqliteModule?.default
const MainDatabase = sqlitePresenterModule?.MainDatabase
const getStartupSchemaCatalog = schemaCatalogModule?.getStartupSchemaCatalog
const sqliteSkipReason = 'skipped: better-sqlite3-multiple-ciphers is unavailable'
const requireNativeSqlite = process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1'
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
const MainDatabaseCtor = MainDatabase!
const sqliteHarnessAvailable = sqliteAvailable && MainDatabase && getStartupSchemaCatalog
const sqliteHarnessSkipReason = sqliteAvailable
  ? 'skipped: MainDatabase startup schema catalog is unavailable'
  : sqliteSkipReason
const describeIfSqlite = sqliteHarnessAvailable
  ? describe
  : requireNativeSqlite
    ? (name: string, _suite: () => void) =>
        describe(name, () => {
          it('requires native SQLite support', () => {
            throw new Error(sqliteHarnessSkipReason)
          })
        })
    : describe.skip

describeIfSqlite('MainDatabase legacy schema bootstrap', () => {
  const tempDirs: string[] = []

  function createSessionDatabaseWithoutRevision(dbPath: string, schemaVersion: number) {
    const db = new DatabaseCtor(dbPath)
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS new_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        project_dir TEXT,
        is_pinned INTEGER DEFAULT 0,
        is_draft INTEGER NOT NULL DEFAULT 0,
        active_skills TEXT NOT NULL DEFAULT '[]',
        disabled_agent_tools TEXT NOT NULL DEFAULT '[]',
        subagent_enabled INTEGER NOT NULL DEFAULT 0,
        session_kind TEXT NOT NULL DEFAULT 'regular',
        parent_session_id TEXT,
        subagent_meta_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    db.prepare('INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)').run(
      schemaVersion,
      Date.now()
    )
    return db
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('repairs missing legacy conversation tables when schema version is already advanced', async () => {
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

    const presenter = new MainDatabaseCtor(dbPath)
    const diagnosis = await presenter.diagnoseSchema()
    expect(diagnosis.issues.some((issue) => issue.kind === 'missing_table')).toBe(true)

    const repairReport = await presenter.repairSchema()
    expect(repairReport.status).toBe('repaired')

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

    const presenter = new MainDatabaseCtor(dbPath)
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

  it('recovers new_sessions revision when the database already passed its original migration', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = createSessionDatabaseWithoutRevision(dbPath, 43)
    bootstrapDb.exec(`
      INSERT INTO new_sessions (
        id,
        agent_id,
        title,
        project_dir,
        is_pinned,
        is_draft,
        active_skills,
        disabled_agent_tools,
        subagent_enabled,
        session_kind,
        parent_session_id,
        subagent_meta_json,
        created_at,
        updated_at
      ) VALUES (
        'session-1',
        'deepchat',
        'Existing session',
        '/work/app',
        1,
        0,
        '["skill-a"]',
        '["tool-a"]',
        0,
        'regular',
        NULL,
        NULL,
        1000,
        2000
      );
    `)
    bootstrapDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    expect(presenter.getLatestSchemaVersion()).toBeGreaterThanOrEqual(44)
    expect(presenter.newSessionsTable.get('session-1')).toMatchObject({
      title: 'Existing session',
      project_dir: '/work/app',
      is_pinned: 1,
      active_skills: '["skill-a"]',
      disabled_agent_tools: '["tool-a"]',
      revision: 0
    })

    presenter.newSessionsTable.update('session-1', { title: 'Generated title' })
    expect(presenter.newSessionsTable.get('session-1')).toMatchObject({
      title: 'Generated title',
      revision: 1
    })
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>
    expect(versions.map((row) => row.version)).toContain(44)
    checkDb.close()
  })

  it('diagnoses and repairs revision when the recovery migration was already marked applied', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = createSessionDatabaseWithoutRevision(dbPath, 44)
    bootstrapDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    const diagnosis = await presenter.diagnoseSchema()
    expect(diagnosis.issues).toContainEqual(
      expect.objectContaining({
        kind: 'missing_column',
        table: 'new_sessions',
        name: 'revision',
        repairable: true
      })
    )

    const repairReport = await presenter.repairSchema()
    expect(repairReport.repairedIssues).toContainEqual(
      expect.objectContaining({
        kind: 'missing_column',
        table: 'new_sessions',
        name: 'revision'
      })
    )
    expect(repairReport.remainingIssues).not.toContainEqual(
      expect.objectContaining({
        table: 'new_sessions',
        name: 'revision'
      })
    )
    presenter.close()
  })

  it('creates fresh session tables with latest schema columns', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const presenter = new MainDatabaseCtor(dbPath)
    const diagnosis = await presenter.diagnoseSchema(getStartupSchemaCatalog!())
    const latestSchemaVersion = presenter.getLatestSchemaVersion()
    presenter.close()

    expect(diagnosis.issues).toEqual([])

    const checkDb = new DatabaseCtor(dbPath)
    const newSessionColumns = checkDb.prepare('PRAGMA table_info(new_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(newSessionColumns.map((column) => column.name))
    const deepchatSessionColumns = checkDb
      .prepare('PRAGMA table_info(deepchat_sessions)')
      .all() as Array<{
      name: string
    }>
    const deepchatColumnNames = new Set(deepchatSessionColumns.map((column) => column.name))
    const environmentColumns = checkDb
      .prepare('PRAGMA table_info(new_environments)')
      .all() as Array<{
      name: string
    }>
    const environmentColumnNames = new Set(environmentColumns.map((column) => column.name))

    expect(columnNames.has('is_draft')).toBe(true)
    expect(columnNames.has('active_skills')).toBe(true)
    expect(columnNames.has('disabled_agent_tools')).toBe(true)
    expect(columnNames.has('subagent_enabled')).toBe(true)
    expect(columnNames.has('session_kind')).toBe(true)
    expect(columnNames.has('parent_session_id')).toBe(true)
    expect(columnNames.has('subagent_meta_json')).toBe(true)
    expect(deepchatColumnNames.has('system_prompt')).toBe(true)
    expect(deepchatColumnNames.has('summary_text')).toBe(true)
    expect(deepchatColumnNames.has('summary_cursor_order_seq')).toBe(true)
    expect(deepchatColumnNames.has('force_interleaved_thinking_compat')).toBe(true)
    expect(deepchatColumnNames.has('reasoning_visibility')).toBe(true)
    expect(deepchatColumnNames.has('timeout_ms')).toBe(true)
    expect(deepchatColumnNames.has('image_generation_options_json')).toBe(true)
    expect(deepchatColumnNames.has('video_generation_options_json')).toBe(true)
    expect(deepchatColumnNames.has('top_p')).toBe(true)
    expect(deepchatColumnNames.has('memory_cursor_order_seq')).toBe(true)
    expect(environmentColumnNames).toEqual(new Set(['path', 'session_count', 'last_used_at']))

    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>
    expect(versions).toEqual([{ version: latestSchemaVersion }])
    checkDb.close()
  })

  it('migrates ACP agent aliases without requiring legacy conversations tables', async () => {
    vi.useFakeTimers()
    try {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
      tempDirs.push(tempDir)

      const dbPath = path.join(tempDir, 'agent.db')
      const presenter = new MainDatabaseCtor(dbPath)

      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      presenter.newSessionsTable.create('session-1', 'kimi-cli', 'Recovered session', null)
      presenter.deepchatSessionsTable.create('session-1', 'acp', 'kimi-cli', 'full_access')
      await presenter.upsertAcpSession('conversation-1', 'kimi-cli', {
        sessionId: 'acp-session-1',
        status: 'active'
      })

      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
      await expect(
        presenter.migrateAcpAgentReferences({
          'kimi-cli': 'kimi'
        })
      ).resolves.toBeUndefined()

      expect(presenter.newSessionsTable.get('session-1')).toMatchObject({
        agent_id: 'kimi',
        revision: 1,
        updated_at: Date.parse('2026-01-01T00:00:01.000Z')
      })
      expect(presenter.deepchatSessionsTable.get('session-1')?.model_id).toBe('kimi')
      expect(await presenter.getAcpSession('conversation-1', 'kimi-cli')).toBeNull()
      expect(await presenter.getAcpSession('conversation-1', 'kimi')).toMatchObject({
        conversationId: 'conversation-1',
        agentId: 'kimi',
        sessionId: 'acp-session-1'
      })

      presenter.close()
    } finally {
      vi.useRealTimers()
    }
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

    const presenter = new MainDatabaseCtor(dbPath)
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

  it('repairs missing subagent columns when schema version is already 20', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (20, ${Date.now()});
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
      INSERT INTO new_sessions (
        id,
        agent_id,
        title,
        project_dir,
        is_pinned,
        is_draft,
        active_skills,
        disabled_agent_tools,
        created_at,
        updated_at
      ) VALUES (
        'session-1',
        'deepchat',
        'Recovered session',
        NULL,
        0,
        0,
        '[]',
        '[]',
        1000,
        2000
      );
    `)
    bootstrapDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    const diagnosis = await presenter.diagnoseSchema()
    expect(diagnosis.issues.some((issue) => issue.name === 'subagent_enabled')).toBe(true)

    const repairReport = await presenter.repairSchema()
    expect(repairReport.status).toBe('repaired')
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const newSessionColumns = checkDb.prepare('PRAGMA table_info(new_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(newSessionColumns.map((column) => column.name))

    expect(columnNames.has('subagent_enabled')).toBe(true)
    expect(columnNames.has('session_kind')).toBe(true)
    expect(columnNames.has('parent_session_id')).toBe(true)
    expect(columnNames.has('subagent_meta_json')).toBe(true)

    const row = checkDb
      .prepare(
        `SELECT subagent_enabled, session_kind, parent_session_id, subagent_meta_json
         FROM new_sessions
         WHERE id = ?`
      )
      .get('session-1') as
      | {
          subagent_enabled: number
          session_kind: string
          parent_session_id: string | null
          subagent_meta_json: string | null
        }
      | undefined

    expect(row).toEqual({
      subagent_enabled: 0,
      session_kind: 'regular',
      parent_session_id: null,
      subagent_meta_json: null
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

    const presenter = new MainDatabaseCtor(dbPath)
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

    const firstPresenter = new MainDatabaseCtor(dbPath)
    firstPresenter.close()

    const secondPresenter = new MainDatabaseCtor(dbPath)
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

    const presenter = new MainDatabaseCtor(dbPath)
    presenter.deepchatSessionsTable.create('session-1', 'openai', 'gpt-4o', 'full_access')
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const deepchatColumns = checkDb.prepare('PRAGMA table_info(deepchat_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(deepchatColumns.map((column) => column.name))

    expect(columnNames.has('system_prompt')).toBe(true)
    expect(columnNames.has('summary_text')).toBe(true)
    expect(columnNames.has('summary_cursor_order_seq')).toBe(true)
    expect(columnNames.has('force_interleaved_thinking_compat')).toBe(true)
    expect(columnNames.has('reasoning_visibility')).toBe(true)
    expect(columnNames.has('timeout_ms')).toBe(true)
    expect(columnNames.has('image_generation_options_json')).toBe(true)

    const row = checkDb
      .prepare(
        'SELECT system_prompt, summary_text, summary_cursor_order_seq, force_interleaved_thinking_compat, reasoning_visibility, timeout_ms, image_generation_options_json FROM deepchat_sessions WHERE id = ?'
      )
      .get('session-1') as
      | {
          system_prompt: string | null
          summary_text: string | null
          summary_cursor_order_seq: number
          force_interleaved_thinking_compat: number | null
          reasoning_visibility: string | null
          timeout_ms: number | null
          image_generation_options_json: string | null
        }
      | undefined

    expect(row).toEqual({
      system_prompt: null,
      summary_text: null,
      summary_cursor_order_seq: 1,
      force_interleaved_thinking_compat: null,
      reasoning_visibility: null,
      timeout_ms: null,
      image_generation_options_json: null
    })
    checkDb.close()
  })

  it('migrates force_interleaved_thinking_compat when schema version is already 18', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (18, ${Date.now()});
      CREATE TABLE IF NOT EXISTS deepchat_sessions (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        permission_mode TEXT NOT NULL DEFAULT 'full_access',
        system_prompt TEXT,
        temperature REAL,
        context_length INTEGER,
        max_tokens INTEGER,
        thinking_budget INTEGER,
        reasoning_effort TEXT,
        verbosity TEXT,
        summary_text TEXT,
        summary_cursor_order_seq INTEGER NOT NULL DEFAULT 1,
        summary_updated_at INTEGER
      );
      INSERT INTO deepchat_sessions (
        id,
        provider_id,
        model_id,
        permission_mode,
        system_prompt,
        summary_text,
        summary_cursor_order_seq
      ) VALUES (
        'session-1',
        'openai',
        'gpt-4o',
        'full_access',
        NULL,
        NULL,
        1
      );
    `)
    bootstrapDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    presenter.deepchatSessionsTable.updateGenerationSettings('session-1', {
      forceInterleavedThinkingCompat: true
    })
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const deepchatColumns = checkDb.prepare('PRAGMA table_info(deepchat_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(deepchatColumns.map((column) => column.name))

    expect(columnNames.has('force_interleaved_thinking_compat')).toBe(true)
    expect(columnNames.has('timeout_ms')).toBe(true)

    const row = checkDb
      .prepare('SELECT force_interleaved_thinking_compat FROM deepchat_sessions WHERE id = ?')
      .get('session-1') as
      | {
          force_interleaved_thinking_compat: number | null
        }
      | undefined

    expect(row).toEqual({
      force_interleaved_thinking_compat: 1
    })

    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>
    expect(versions.map((entry) => entry.version)).toContain(20)
    expect(versions.map((entry) => entry.version)).toContain(24)
    checkDb.close()
  })

  it('repairs missing deepchat_sessions columns when schema version is already 23', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (23, ${Date.now()});
      CREATE TABLE IF NOT EXISTS deepchat_sessions (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        permission_mode TEXT NOT NULL DEFAULT 'full_access',
        system_prompt TEXT,
        temperature REAL,
        context_length INTEGER,
        max_tokens INTEGER,
        thinking_budget INTEGER,
        reasoning_effort TEXT,
        verbosity TEXT,
        summary_text TEXT,
        summary_cursor_order_seq INTEGER NOT NULL DEFAULT 1,
        summary_updated_at INTEGER
      );
      INSERT INTO deepchat_sessions (
        id,
        provider_id,
        model_id,
        permission_mode,
        system_prompt,
        summary_text,
        summary_cursor_order_seq
      ) VALUES (
        'session-1',
        'anthropic',
        'claude-sonnet-4',
        'full_access',
        NULL,
        NULL,
        1
      );
    `)
    bootstrapDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    const diagnosis = await presenter.diagnoseSchema()
    expect(
      diagnosis.issues.some((issue) => issue.name === 'force_interleaved_thinking_compat')
    ).toBe(true)

    const repairReport = await presenter.repairSchema()
    expect(repairReport.status).toBe('repaired')
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const deepchatColumns = checkDb.prepare('PRAGMA table_info(deepchat_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(deepchatColumns.map((column) => column.name))

    expect(columnNames.has('force_interleaved_thinking_compat')).toBe(true)
    expect(columnNames.has('reasoning_visibility')).toBe(true)
    expect(columnNames.has('timeout_ms')).toBe(true)
    expect(columnNames.has('image_generation_options_json')).toBe(true)

    const row = checkDb
      .prepare(
        'SELECT force_interleaved_thinking_compat, reasoning_visibility, timeout_ms, image_generation_options_json FROM deepchat_sessions WHERE id = ?'
      )
      .get('session-1') as
      | {
          force_interleaved_thinking_compat: number | null
          reasoning_visibility: string | null
          timeout_ms: number | null
          image_generation_options_json: string | null
        }
      | undefined

    expect(row).toEqual({
      force_interleaved_thinking_compat: null,
      reasoning_visibility: null,
      timeout_ms: null,
      image_generation_options_json: null
    })
    checkDb.close()
  })

  it('repairs missing timeout_ms and image settings in deepchat_sessions when schema version is already 24', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (24, ${Date.now()});
      CREATE TABLE IF NOT EXISTS deepchat_sessions (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        permission_mode TEXT NOT NULL DEFAULT 'full_access',
        system_prompt TEXT,
        temperature REAL,
        context_length INTEGER,
        max_tokens INTEGER,
        thinking_budget INTEGER,
        reasoning_effort TEXT,
        verbosity TEXT,
        summary_text TEXT,
        summary_cursor_order_seq INTEGER NOT NULL DEFAULT 1,
        summary_updated_at INTEGER,
        force_interleaved_thinking_compat INTEGER,
        reasoning_visibility TEXT
      );
      INSERT INTO deepchat_sessions (
        id,
        provider_id,
        model_id,
        permission_mode,
        reasoning_visibility
      ) VALUES (
        'session-1',
        'anthropic',
        'claude-sonnet-4',
        'full_access',
        'auto'
      );
    `)
    bootstrapDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    const diagnosis = await presenter.diagnoseSchema()
    expect(diagnosis.issues.some((issue) => issue.name === 'timeout_ms')).toBe(true)

    const repairReport = await presenter.repairSchema()
    expect(repairReport.status).toBe('repaired')
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const deepchatColumns = checkDb.prepare('PRAGMA table_info(deepchat_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(deepchatColumns.map((column) => column.name))

    expect(columnNames.has('timeout_ms')).toBe(true)
    expect(columnNames.has('image_generation_options_json')).toBe(true)

    const row = checkDb
      .prepare(
        'SELECT reasoning_visibility, timeout_ms, image_generation_options_json FROM deepchat_sessions WHERE id = ?'
      )
      .get('session-1') as
      | {
          reasoning_visibility: string | null
          timeout_ms: number | null
          image_generation_options_json: string | null
        }
      | undefined

    expect(row).toEqual({
      reasoning_visibility: 'auto',
      timeout_ms: null,
      image_generation_options_json: null
    })
    checkDb.close()
  })

  it('runs the v23, v24, and v27 recovery migrations for deepchat_sessions when schema version is 22', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (22, ${Date.now()});
      CREATE TABLE IF NOT EXISTS deepchat_sessions (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        permission_mode TEXT NOT NULL DEFAULT 'full_access',
        system_prompt TEXT,
        temperature REAL,
        context_length INTEGER,
        max_tokens INTEGER,
        thinking_budget INTEGER,
        reasoning_effort TEXT,
        verbosity TEXT,
        summary_text TEXT,
        summary_cursor_order_seq INTEGER NOT NULL DEFAULT 1,
        summary_updated_at INTEGER
      );
    `)
    bootstrapDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const deepchatColumns = checkDb.prepare('PRAGMA table_info(deepchat_sessions)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(deepchatColumns.map((column) => column.name))
    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>

    expect(columnNames.has('force_interleaved_thinking_compat')).toBe(true)
    expect(columnNames.has('reasoning_visibility')).toBe(true)
    expect(columnNames.has('timeout_ms')).toBe(true)
    expect(columnNames.has('image_generation_options_json')).toBe(true)
    expect(versions.map((entry) => entry.version)).toContain(23)
    expect(versions.map((entry) => entry.version)).toContain(24)
    expect(versions.map((entry) => entry.version)).toContain(27)
    checkDb.close()
  })

  it('returns child sessions when filtering by parentSessionId without includeSubagents', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const presenter = new MainDatabaseCtor(dbPath)

    presenter.newSessionsTable.create(
      'parent-session',
      'deepchat',
      'Parent session',
      '/workspace',
      {
        sessionKind: 'regular'
      }
    )
    presenter.newSessionsTable.create('child-session', 'deepchat', 'Child session', '/workspace', {
      sessionKind: 'subagent',
      parentSessionId: 'parent-session'
    })

    const childRows = presenter.newSessionsTable.list({
      parentSessionId: 'parent-session'
    })
    const defaultRows = presenter.newSessionsTable.list()

    expect(childRows.map((row) => row.id)).toEqual(['child-session'])
    expect(defaultRows.map((row) => row.id)).toEqual(['parent-session'])

    presenter.close()
  })

  it('removes estimated_cost_usd while preserving usage rows', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (31, ${Date.now()});
      CREATE TABLE IF NOT EXISTS deepchat_usage_stats (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        usage_date TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_input_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL,
        source TEXT NOT NULL DEFAULT 'live',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO deepchat_usage_stats (
        message_id, session_id, usage_date, provider_id, model_id, input_tokens, output_tokens,
        total_tokens, cached_input_tokens, cache_write_input_tokens, estimated_cost_usd, source,
        created_at, updated_at
      ) VALUES (
        'message-1', 'session-1', '2026-03-10', 'openai', 'gpt-4o', 120, 30, 150, 20, 0, 0.01,
        'live', 1000, 2000
      );
    `)
    bootstrapDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const columnNames = new Set(
      (
        checkDb.prepare('PRAGMA table_info(deepchat_usage_stats)').all() as Array<{ name: string }>
      ).map((column) => column.name)
    )
    const indexNames = new Set(
      (
        checkDb.prepare('PRAGMA index_list(deepchat_usage_stats)').all() as Array<{ name: string }>
      ).map((index) => index.name)
    )
    const row = checkDb
      .prepare(
        `SELECT usage_id, message_id, usage_category, cached_input_tokens,
           cache_write_input_tokens
         FROM deepchat_usage_stats
         WHERE message_id = ?`
      )
      .get('message-1')
    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>

    expect(columnNames.has('estimated_cost_usd')).toBe(false)
    expect(indexNames.has('idx_deepchat_usage_stats_date')).toBe(true)
    expect(indexNames.has('idx_deepchat_usage_stats_provider_date')).toBe(true)
    expect(indexNames.has('idx_deepchat_usage_stats_model_date')).toBe(true)
    expect(indexNames.has('idx_deepchat_usage_stats_category_date')).toBe(true)
    expect(indexNames.has('idx_deepchat_usage_stats_compaction_call')).toBe(true)
    expect(row).toEqual({
      usage_id: 'message-1',
      message_id: 'message-1',
      usage_category: 'chat',
      cached_input_tokens: 20,
      cache_write_input_tokens: 0
    })
    expect(versions.map((entry) => entry.version)).toContain(32)
    expect(versions.map((entry) => entry.version)).toContain(68)
    checkDb.close()
  })

  it('upgrades the current usage schema to category-aware records', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_versions (version, applied_at) VALUES (67, ${Date.now()});
      CREATE TABLE deepchat_usage_stats (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        usage_date TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_input_tokens INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'live',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO deepchat_usage_stats (
        message_id, session_id, usage_date, provider_id, model_id, input_tokens, output_tokens,
        total_tokens, cached_input_tokens, cache_write_input_tokens, source, created_at, updated_at
      ) VALUES (
        'message-current', 'session-1', '2026-08-15', 'openai', 'gpt-5', 120, 30, 150,
        20, 5, 'live', 1000, 2000
      );
    `)
    bootstrapDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const row = checkDb
      .prepare(
        `SELECT usage_id, message_id, usage_category, input_tokens, cached_input_tokens
         FROM deepchat_usage_stats
         WHERE usage_id = ?`
      )
      .get('message-current')
    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>

    expect(row).toEqual({
      usage_id: 'message-current',
      message_id: 'message-current',
      usage_category: 'chat',
      input_tokens: 120,
      cached_input_tokens: 20
    })
    expect(versions.map((entry) => entry.version)).toContain(68)
    checkDb.close()
  })

  it('recovers a legacy usage table after schema version 68 was already recorded', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const initialDatabase = new MainDatabaseCtor(dbPath)
    initialDatabase.close()
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (68, ${Date.now()});
      DROP TABLE deepchat_usage_stats;
      CREATE TABLE deepchat_usage_stats (
        message_id TEXT PRIMARY KEY,
        usage_category TEXT NOT NULL DEFAULT 'chat',
        compaction_attempt_id TEXT,
        provider_call_id TEXT,
        provider_call_seq INTEGER,
        session_id TEXT NOT NULL,
        usage_date TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        cached_input_tokens INTEGER,
        cache_write_input_tokens INTEGER,
        source TEXT NOT NULL DEFAULT 'live',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO deepchat_usage_stats (
        message_id, session_id, usage_date, provider_id, model_id, input_tokens, output_tokens,
        total_tokens, cached_input_tokens, cache_write_input_tokens, source, created_at, updated_at
      ) VALUES (
        'message-v68', 'session-1', '2026-08-17', 'minimax', 'MiniMax-M3', 120, 30, 150,
        20, 5, 'live', 1000, 2000
      );
    `)
    bootstrapDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const columns = checkDb.prepare('PRAGMA table_info(deepchat_usage_stats)').all() as Array<{
      name: string
      pk: number
    }>
    const row = checkDb
      .prepare(
        `SELECT usage_id, message_id, usage_category, input_tokens, total_tokens
         FROM deepchat_usage_stats
         WHERE usage_id = ?`
      )
      .get('message-v68')
    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>

    expect(columns.find((column) => column.name === 'usage_id')?.pk).toBe(1)
    expect(columns.find((column) => column.name === 'message_id')?.pk).toBe(0)
    expect(row).toEqual({
      usage_id: 'message-v68',
      message_id: 'message-v68',
      usage_category: 'chat',
      input_tokens: 120,
      total_tokens: 150
    })
    expect(versions.map((entry) => entry.version)).toContain(69)
    checkDb.close()
  })

  it('leaves an already-correct version 68 usage table unchanged', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const initialDatabase = new MainDatabaseCtor(dbPath)
    initialDatabase.close()
    const bootstrapDb = new DatabaseCtor(dbPath)
    bootstrapDb.exec(`
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (68, ${Date.now()});
      INSERT INTO deepchat_usage_stats (
        usage_id, message_id, usage_category, compaction_attempt_id, provider_call_id,
        provider_call_seq, session_id, usage_date, provider_id, model_id, input_tokens,
        output_tokens, total_tokens, cached_input_tokens, cache_write_input_tokens, source,
        created_at, updated_at
      ) VALUES (
        'compaction-1', NULL, 'compaction', 'attempt-1', 'call-1', 1, 'session-1',
        '2026-08-17', 'minimax', 'MiniMax-M3', 1000, 40, 1040, 900, 0, 'live', 1000, 2000
      );
    `)
    bootstrapDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const row = checkDb
      .prepare(
        `SELECT usage_id, message_id, usage_category, compaction_attempt_id, provider_call_id
         FROM deepchat_usage_stats
         WHERE usage_id = ?`
      )
      .get('compaction-1')
    const versions = checkDb
      .prepare('SELECT version FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number }>

    expect(row).toEqual({
      usage_id: 'compaction-1',
      message_id: null,
      usage_category: 'compaction',
      compaction_attempt_id: 'attempt-1',
      provider_call_id: 'call-1'
    })
    expect(versions.map((entry) => entry.version)).toContain(69)
    checkDb.close()
  })

  it('repairs a missing agent_memory category column', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sqlite-presenter-'))
    tempDirs.push(tempDir)

    const dbPath = path.join(tempDir, 'agent.db')
    const bootstrap = new MainDatabaseCtor(dbPath)
    bootstrap.close()

    const corruptDb = new DatabaseCtor(dbPath)
    corruptDb.exec('ALTER TABLE agent_memory DROP COLUMN category;')
    corruptDb.close()

    const presenter = new MainDatabaseCtor(dbPath)
    const diagnosis = await presenter.diagnoseSchema()
    expect(
      diagnosis.issues.some((issue) => issue.kind === 'missing_column' && issue.name === 'category')
    ).toBe(true)

    const repairReport = await presenter.repairSchema()
    expect(repairReport.status).toBe('repaired')
    presenter.close()

    const checkDb = new DatabaseCtor(dbPath)
    const columns = checkDb.prepare('PRAGMA table_info(agent_memory)').all() as Array<{
      name: string
    }>
    expect(new Set(columns.map((column) => column.name)).has('category')).toBe(true)
    checkDb.close()
  })
})
