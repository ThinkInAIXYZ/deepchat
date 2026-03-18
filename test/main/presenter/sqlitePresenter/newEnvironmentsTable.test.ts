import { afterEach, beforeEach, describe, expect, it } from 'vitest'
const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/newEnvironments').catch(() => null)
  : null
const Database = sqliteModule?.default
const NewEnvironmentsTable = tableModule?.NewEnvironmentsTable
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
const NewEnvironmentsTableCtor = NewEnvironmentsTable!
const describeIfSqlite = sqliteAvailable && NewEnvironmentsTable ? describe : describe.skip

describeIfSqlite('NewEnvironmentsTable', () => {
  let db: InstanceType<typeof DatabaseCtor> | null
  let table: InstanceType<typeof NewEnvironmentsTableCtor>

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    db.exec(`
      CREATE TABLE new_sessions (
        id TEXT PRIMARY KEY,
        project_dir TEXT,
        is_draft INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE acp_sessions (
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
    `)

    table = new NewEnvironmentsTableCtor(db)
    table.createTable()
  })

  afterEach(() => {
    db?.close()
    db = null
  })

  it('syncPath aggregates only non-draft sessions for a single directory', () => {
    db.prepare(
      'INSERT INTO new_sessions (id, project_dir, is_draft, updated_at) VALUES (?, ?, ?, ?)'
    ).run('s1', '/work/app', 0, 100)
    db.prepare(
      'INSERT INTO new_sessions (id, project_dir, is_draft, updated_at) VALUES (?, ?, ?, ?)'
    ).run('s2', '/work/app', 0, 200)
    db.prepare(
      'INSERT INTO new_sessions (id, project_dir, is_draft, updated_at) VALUES (?, ?, ?, ?)'
    ).run('s3', '/work/app', 1, 999)

    table.syncPath('/work/app')

    expect(table.list()).toEqual([
      {
        path: '/work/app',
        session_count: 2,
        last_used_at: 200
      }
    ])
  })

  it('removes an environment row when no non-draft sessions remain', () => {
    db.prepare(
      'INSERT INTO new_sessions (id, project_dir, is_draft, updated_at) VALUES (?, ?, ?, ?)'
    ).run('s1', '/work/app', 0, 100)

    table.syncPath('/work/app')
    expect(table.list()).toHaveLength(1)

    db.prepare('DELETE FROM new_sessions WHERE id = ?').run('s1')
    table.syncPath('/work/app')

    expect(table.list()).toEqual([])
  })

  it('rebuildFromSessions recreates the full derived table from session history', () => {
    db.prepare(
      'INSERT INTO new_sessions (id, project_dir, is_draft, updated_at) VALUES (?, ?, ?, ?)'
    ).run('s1', '/work/a', 0, 100)
    db.prepare(
      'INSERT INTO new_sessions (id, project_dir, is_draft, updated_at) VALUES (?, ?, ?, ?)'
    ).run('s2', '/work/b', 0, 300)
    db.prepare(
      'INSERT INTO new_sessions (id, project_dir, is_draft, updated_at) VALUES (?, ?, ?, ?)'
    ).run('s3', '/work/b', 0, 200)
    db.prepare(
      'INSERT INTO new_sessions (id, project_dir, is_draft, updated_at) VALUES (?, ?, ?, ?)'
    ).run('s4', '/work/draft', 1, 400)

    table.rebuildFromSessions()

    expect(table.list()).toEqual([
      {
        path: '/work/b',
        session_count: 2,
        last_used_at: 300
      },
      {
        path: '/work/a',
        session_count: 1,
        last_used_at: 100
      }
    ])
  })

  it('imports ACP workdir when a session has no project_dir', () => {
    db.prepare(
      'INSERT INTO new_sessions (id, project_dir, is_draft, updated_at) VALUES (?, ?, ?, ?)'
    ).run('s1', null, 0, 100)
    db.prepare(
      'INSERT INTO acp_sessions (conversation_id, agent_id, session_id, workdir, status, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('s1', 'agent-1', null, '/work/from-acp', 'idle', 100, 200, null)

    table.rebuildFromSessions()

    expect(table.list()).toEqual([
      {
        path: '/work/from-acp',
        session_count: 1,
        last_used_at: 200
      }
    ])
  })

  it('prefers project_dir over ACP workdir when both exist for the same session', () => {
    db.prepare(
      'INSERT INTO new_sessions (id, project_dir, is_draft, updated_at) VALUES (?, ?, ?, ?)'
    ).run('s1', '/work/project-dir', 0, 300)
    db.prepare(
      'INSERT INTO acp_sessions (conversation_id, agent_id, session_id, workdir, status, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('s1', 'agent-1', null, '/work/from-acp', 'idle', 100, 200, null)

    table.rebuildFromSessions()

    expect(table.list()).toEqual([
      {
        path: '/work/project-dir',
        session_count: 1,
        last_used_at: 300
      }
    ])
  })
})
