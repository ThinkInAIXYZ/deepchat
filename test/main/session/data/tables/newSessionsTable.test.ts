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

  it('clears regular project_dir, advances revision, and leaves subagent rows untouched', () => {
    db!
      .prepare(
        `INSERT INTO new_sessions (
        id,
        agent_id,
        title,
        project_dir,
        session_kind,
        revision,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('regular-1', 'agent', 'Regular', '/work/app', 'regular', 4, 100, 200)
    db!
      .prepare(
        `INSERT INTO new_sessions (
        id,
        agent_id,
        title,
        project_dir,
        session_kind,
        revision,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('subagent-1', 'agent', 'Subagent', '/work/app', 'subagent', 8, 300, 400)

    expect(table.clearProjectDir('/work/app')).toEqual(['regular-1'])

    expect(
      db!
        .prepare('SELECT project_dir, updated_at, revision FROM new_sessions WHERE id = ?')
        .get('regular-1')
    ).toMatchObject({
      project_dir: null,
      revision: 5
    })
    expect(
      db!
        .prepare('SELECT project_dir, updated_at, revision FROM new_sessions WHERE id = ?')
        .get('subagent-1')
    ).toEqual({
      project_dir: '/work/app',
      updated_at: 400,
      revision: 8
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

  it('increments durable revision for session updates without relying on timestamps', () => {
    table.create('session-1', 'deepchat', 'Session', null)
    const created = table.get('session-1')
    table.update('session-1', { title: 'Renamed' })
    table.updateAgentId('session-1', 'acp')

    expect(table.get('session-1')).toMatchObject({
      title: 'Renamed',
      agent_id: 'acp',
      revision: (created?.revision ?? 0) + 2
    })
  })

  it('defaults orchestration to explicit and persists proactive policy updates', () => {
    table.create('explicit', 'deepchat', 'Explicit', null)
    table.create('proactive', 'deepchat', 'Proactive', null, {
      orchestrationPolicy: 'proactive'
    })
    const revision = table.get('explicit')?.revision ?? 0

    expect(table.getOrchestrationPolicy('explicit')).toBe('explicit')
    expect(table.getOrchestrationPolicy('proactive')).toBe('proactive')

    table.updateOrchestrationPolicy('explicit', 'proactive')
    expect(table.get('explicit')).toMatchObject({
      orchestration_policy: 'proactive',
      revision: revision + 1
    })
  })

  it('persists and clears the nullable Tool Mode override', () => {
    table.create('session-1', 'deepchat', 'Session', null, { toolModeOverride: 'code' })
    const createdRevision = table.get('session-1')?.revision ?? 0

    expect(table.get('session-1')?.tool_mode_override).toBe('code')

    table.updateToolModeOverride('session-1', 'minimal')
    expect(table.get('session-1')).toMatchObject({
      tool_mode_override: 'minimal',
      revision: createdRevision + 1
    })

    table.updateToolModeOverride('session-1', null)
    expect(table.get('session-1')).toMatchObject({
      tool_mode_override: null,
      revision: createdRevision + 2
    })
    expect(() =>
      db!
        .prepare('UPDATE new_sessions SET tool_mode_override = ? WHERE id = ?')
        .run('automatic', 'session-1')
    ).toThrow()
  })

  it('reassigns matching agent sessions and advances only their revisions', () => {
    table.create('matching-1', 'legacy-agent', 'First matching session', null)
    table.create('matching-2', 'legacy-agent', 'Second matching session', null)
    table.create('unmatched', 'other-agent', 'Unmatched session', null)

    const matchingBefore = [table.get('matching-1'), table.get('matching-2')]
    const unmatchedBefore = table.get('unmatched')

    table.reassignAgentId('legacy-agent', 'replacement-agent')

    expect(table.get('matching-1')).toMatchObject({
      agent_id: 'replacement-agent',
      revision: (matchingBefore[0]?.revision ?? 0) + 1
    })
    expect(table.get('matching-2')).toMatchObject({
      agent_id: 'replacement-agent',
      revision: (matchingBefore[1]?.revision ?? 0) + 1
    })
    expect(table.get('unmatched')).toMatchObject({
      agent_id: 'other-agent',
      revision: unmatchedBefore?.revision
    })
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
