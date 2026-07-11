import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/newSessions').catch(() => null)
  : null
const activeSkillsTableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/newSessionActiveSkills').catch(() => null)
  : null
const disabledToolsTableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/newSessionDisabledAgentTools').catch(
      () => null
    )
  : null
const Database = sqliteModule?.default
const NewSessionsTable = tableModule?.NewSessionsTable
const NewSessionActiveSkillsTable = activeSkillsTableModule?.NewSessionActiveSkillsTable
const NewSessionDisabledAgentToolsTable =
  disabledToolsTableModule?.NewSessionDisabledAgentToolsTable
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
const NewSessionActiveSkillsTableCtor = NewSessionActiveSkillsTable!
const NewSessionDisabledAgentToolsTableCtor = NewSessionDisabledAgentToolsTable!
const requireNativeSqlite = process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1'
const sqliteHarnessAvailable =
  sqliteAvailable &&
  NewSessionsTable &&
  NewSessionActiveSkillsTable &&
  NewSessionDisabledAgentToolsTable
const describeIfSqlite = sqliteHarnessAvailable
  ? describe
  : requireNativeSqlite
    ? (name: string, _suite: () => void) =>
        describe(name, () => {
          it('requires native SQLite support', () => {
            throw new Error('Native SQLite NewSessionsTable harness is unavailable')
          })
        })
    : describe.skip

describeIfSqlite('NewSessionsTable', () => {
  let db: InstanceType<typeof DatabaseCtor> | null
  let table: InstanceType<typeof NewSessionsTableCtor>

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    new NewSessionActiveSkillsTableCtor(db).createTable()
    new NewSessionDisabledAgentToolsTableCtor(db).createTable()
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

  it('prefers normalized active skill rows over corrupt legacy JSON', () => {
    table.create('session-normalized', 'agent', 'Normalized', null, {
      activeSkills: ['review']
    })
    db!
      .prepare('UPDATE new_sessions SET active_skills = ? WHERE id = ?')
      .run('{not-json', 'session-normalized')

    expect(table.getPersistedActiveSkillPins('session-normalized')).toEqual(['review'])
  })

  it('reads valid legacy active skill JSON when normalized rows are absent', () => {
    table.create('session-legacy', 'agent', 'Legacy', null)
    db!
      .prepare('UPDATE new_sessions SET active_skills = ? WHERE id = ?')
      .run('["review","debug"]', 'session-legacy')

    expect(table.getPersistedActiveSkillPins('session-legacy')).toEqual(['review', 'debug'])
  })

  it('returns no persisted pins for fresh, missing, and empty sessions', () => {
    table.create('session-fresh', 'agent', 'Fresh', null)
    table.create('session-empty', 'agent', 'Empty', null)
    db!.prepare('UPDATE new_sessions SET active_skills = ? WHERE id = ?').run('', 'session-empty')

    expect(table.getPersistedActiveSkillPins('session-fresh')).toEqual([])
    expect(table.getPersistedActiveSkillPins('session-missing')).toEqual([])
    expect(table.getPersistedActiveSkillPins('session-empty')).toEqual([])
  })

  it('rejects non-array and corrupt legacy active skill JSON with typed errors', () => {
    table.create('session-non-array', 'agent', 'Non-array', null)
    db!
      .prepare('UPDATE new_sessions SET active_skills = ? WHERE id = ?')
      .run('{"skill":"review"}', 'session-non-array')

    table.create('session-corrupt', 'agent', 'Corrupt', null)
    db!
      .prepare('UPDATE new_sessions SET active_skills = ? WHERE id = ?')
      .run('{not-json', 'session-corrupt')

    expect(() => table.getPersistedActiveSkillPins('session-non-array')).toThrow(TypeError)
    expect(() => table.getPersistedActiveSkillPins('session-corrupt')).toThrow(SyntaxError)
  })
})
