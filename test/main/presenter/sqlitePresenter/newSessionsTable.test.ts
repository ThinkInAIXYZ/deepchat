import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/newSessions').catch(() => null)
  : null
const Database = sqliteModule?.default
const NewSessionsTable = tableModule?.NewSessionsTable
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
const NewSessionsTableCtor = NewSessionsTable!
const describeIfSqlite = sqliteAvailable && NewSessionsTable ? describe : describe.skip

describeIfSqlite('NewSessionsTable clearProjectDir', () => {
  let db: InstanceType<typeof DatabaseCtor> | null
  let table: InstanceType<typeof NewSessionsTableCtor>

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    table = new NewSessionsTableCtor(db)
    table.createTable()
  })

  afterEach(() => {
    db?.close()
    db = null
  })

  it('clears regular project_dir without changing recency or subagent rows', () => {
    db!
      .prepare(
        `INSERT INTO new_sessions (
        id,
        agent_id,
        title,
        project_dir,
        session_kind,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('regular-1', 'agent', 'Regular', '/work/app', 'regular', 100, 200)
    db!
      .prepare(
        `INSERT INTO new_sessions (
        id,
        agent_id,
        title,
        project_dir,
        session_kind,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('subagent-1', 'agent', 'Subagent', '/work/app', 'subagent', 300, 400)

    expect(table.clearProjectDir('/work/app')).toEqual(['regular-1'])

    expect(
      db!.prepare('SELECT project_dir, updated_at FROM new_sessions WHERE id = ?').get('regular-1')
    ).toEqual({
      project_dir: null,
      updated_at: 200
    })
    expect(
      db!.prepare('SELECT project_dir, updated_at FROM new_sessions WHERE id = ?').get('subagent-1')
    ).toEqual({
      project_dir: '/work/app',
      updated_at: 400
    })
  })
})
