import { afterEach, beforeEach, expect, it } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../../../nativeSqliteHarness'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/session/data/tables/newSessions').catch(() => null)
  : null
const activeSkillsTableModule = Database
  ? await import('@/session/data/tables/newSessionActiveSkills').catch(() => null)
  : null
const disabledToolsTableModule = Database
  ? await import('@/session/data/tables/newSessionDisabledAgentTools').catch(() => null)
  : null
const NewSessionsTable = tableModule?.NewSessionsTable
const NewSessionActiveSkillsTable = activeSkillsTableModule?.NewSessionActiveSkillsTable
const NewSessionDisabledAgentToolsTable =
  disabledToolsTableModule?.NewSessionDisabledAgentToolsTable
const DatabaseCtor = Database!
const NewSessionsTableCtor = NewSessionsTable!
const NewSessionActiveSkillsTableCtor = NewSessionActiveSkillsTable!
const NewSessionDisabledAgentToolsTableCtor = NewSessionDisabledAgentToolsTable!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(NewSessionsTable && NewSessionActiveSkillsTable && NewSessionDisabledAgentToolsTable),
  'New Session native table modules are unavailable'
)

describeIfSqlite('NewSessionsTable', () => {
  let db: InstanceType<typeof DatabaseCtor> | null
  let table: InstanceType<typeof NewSessionsTableCtor>

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    table = new NewSessionsTableCtor(db)
    new NewSessionActiveSkillsTableCtor(db).createTable()
    new NewSessionDisabledAgentToolsTableCtor(db).createTable()
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

  it('reads large ID sets without one SQLite bind variable per session', () => {
    const insert = db!.prepare(
      `INSERT INTO new_sessions (
         id,
         agent_id,
         title,
         project_dir,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    insert.run('first', 'agent', 'First', null, 100, 100)
    insert.run('last', 'agent', 'Last', null, 200, 200)
    const ids = Array.from({ length: 40000 }, (_, index) => `missing-${index}`)
    ids[0] = 'first'
    ids[ids.length - 1] = 'last'

    expect(
      table
        .getMany(ids)
        .map((row) => row.id)
        .sort()
    ).toEqual(['first', 'last'])
  })

  it('leaves the legacy Subagent policy column at its database-owned value', () => {
    table.create('session-1', 'deepchat', 'Session', null)
    expect(table.get('session-1')?.subagent_enabled).toBe(0)

    db!.prepare('UPDATE new_sessions SET subagent_enabled = 1 WHERE id = ?').run('session-1')
    table.update('session-1', { title: 'Renamed' })

    expect(table.get('session-1')).toMatchObject({
      title: 'Renamed',
      subagent_enabled: 1
    })
  })
})
