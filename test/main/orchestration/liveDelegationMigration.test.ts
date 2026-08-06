import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const mainDatabaseModule = Database ? await import('@/data/mainDatabase').catch(() => null) : null
const liveDelegationsModule = Database
  ? await import('@/orchestration/data/tables/liveDelegations').catch(() => null)
  : null
const MainDatabaseCtor = mainDatabaseModule?.MainDatabase!
const ORCHESTRATION_DATABASE_SCHEMA_VERSION =
  liveDelegationsModule?.ORCHESTRATION_DATABASE_SCHEMA_VERSION
const DatabaseCtor = Database!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(MainDatabaseCtor && ORCHESTRATION_DATABASE_SCHEMA_VERSION),
  'Live delegation migration modules are unavailable'
)

describeIfSqlite('live delegation schema migration', () => {
  const tempDirectories: string[] = []

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('adds durable delegation, turn, and event tables from v59', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-live-delegation-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      DROP TABLE live_delegation_events;
      DROP TABLE live_delegation_turns;
      DROP TABLE live_delegations;
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (59, 100);
    `)
    bootstrap.close()

    const migrated = new MainDatabaseCtor(databasePath)
    expect(migrated.getLatestSchemaVersion()).toBe(ORCHESTRATION_DATABASE_SCHEMA_VERSION)
    migrated.close()

    const verification = new DatabaseCtor(databasePath)
    const tables = verification
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN (
             'live_delegations', 'live_delegation_turns', 'live_delegation_events'
           )
         ORDER BY name`
      )
      .all()
    expect(tables).toEqual([
      { name: 'live_delegation_events' },
      { name: 'live_delegation_turns' },
      { name: 'live_delegations' }
    ])
    expect(
      verification.prepare('SELECT MAX(version) AS version FROM schema_versions').get()
    ).toEqual({
      version: ORCHESTRATION_DATABASE_SCHEMA_VERSION
    })
    verification.close()
  })

  it('adds effect evidence to existing v60 turns without losing rows', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-live-effect-migration-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      ALTER TABLE live_delegation_turns DROP COLUMN effect_evidence_json;
      ALTER TABLE live_delegation_turns DROP COLUMN effect_state;
      INSERT INTO new_sessions (id, agent_id, title, created_at, updated_at)
      VALUES ('parent', 'agent-1', 'Parent', 100, 100);
      INSERT INTO live_delegations (
        delegation_id, parent_session_id, slot_id, target_agent_id, title, status,
        last_turn_seq, created_at, updated_at
      ) VALUES (
        'delegation-1', 'parent', 'reviewer', 'agent-1', 'Review', 'running', 1, 100, 100
      );
      INSERT INTO live_delegation_turns (
        turn_id, delegation_id, seq, kind, prompt, status, created_at, started_at, updated_at
      ) VALUES ('turn-1', 'delegation-1', 1, 'initial', 'Review it.', 'running', 100, 110, 110);
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (60, 100);
    `)
    bootstrap.close()

    const migrated = new MainDatabaseCtor(databasePath)
    expect(migrated.getLatestSchemaVersion()).toBe(ORCHESTRATION_DATABASE_SCHEMA_VERSION)
    migrated.close()

    const verification = new DatabaseCtor(databasePath)
    expect(
      verification
        .prepare(
          `SELECT effect_state, effect_evidence_json
           FROM live_delegation_turns
           WHERE turn_id = 'turn-1'`
        )
        .get()
    ).toEqual({ effect_state: 'none', effect_evidence_json: null })
    expect(
      verification.prepare('SELECT MAX(version) AS version FROM schema_versions').get()
    ).toEqual({ version: ORCHESTRATION_DATABASE_SCHEMA_VERSION })
    verification.close()
  })

  it('adds durable result references to existing v61 turns without losing rows', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-live-result-migration-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      ALTER TABLE live_delegation_turns DROP COLUMN result_ref_json;
      INSERT INTO new_sessions (id, agent_id, title, created_at, updated_at)
      VALUES ('parent', 'agent-1', 'Parent', 100, 100);
      INSERT INTO live_delegations (
        delegation_id, parent_session_id, slot_id, target_agent_id, title, status,
        last_turn_seq, created_at, updated_at
      ) VALUES (
        'delegation-1', 'parent', 'reviewer', 'agent-1', 'Review', 'idle', 1, 100, 120
      );
      INSERT INTO live_delegation_turns (
        turn_id, delegation_id, seq, kind, prompt, status, result_summary,
        effect_state, created_at, started_at, updated_at, completed_at
      ) VALUES (
        'turn-1', 'delegation-1', 1, 'initial', 'Review it.', 'completed', 'Done.',
        'none', 100, 110, 120, 120
      );
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (61, 100);
    `)
    bootstrap.close()

    const migrated = new MainDatabaseCtor(databasePath)
    expect(migrated.getLatestSchemaVersion()).toBe(ORCHESTRATION_DATABASE_SCHEMA_VERSION)
    migrated.close()

    const verification = new DatabaseCtor(databasePath)
    expect(
      verification
        .prepare(
          `SELECT result_summary, result_ref_json
           FROM live_delegation_turns
           WHERE turn_id = 'turn-1'`
        )
        .get()
    ).toEqual({ result_summary: 'Done.', result_ref_json: null })
    expect(
      verification.prepare('SELECT MAX(version) AS version FROM schema_versions').get()
    ).toEqual({ version: ORCHESTRATION_DATABASE_SCHEMA_VERSION })
    verification.close()
  })

  it('repairs a missing result-reference column at the current schema version', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-live-result-repair-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec('ALTER TABLE live_delegation_turns DROP COLUMN result_ref_json;')
    bootstrap.close()

    const repaired = new MainDatabaseCtor(databasePath)
    const diagnosis = await repaired.diagnoseSchema()
    expect(diagnosis.issues).toContainEqual(
      expect.objectContaining({
        kind: 'missing_column',
        table: 'live_delegation_turns',
        name: 'result_ref_json',
        repairable: true
      })
    )
    expect((await repaired.repairSchema()).status).toBe('repaired')
    repaired.close()

    const verification = new DatabaseCtor(databasePath)
    const columns = verification
      .prepare('PRAGMA table_info(live_delegation_turns)')
      .all() as Array<{
      name: string
    }>
    expect(columns.some((column) => column.name === 'result_ref_json')).toBe(true)
    expect(
      verification.prepare('SELECT MAX(version) AS version FROM schema_versions').get()
    ).toEqual({ version: ORCHESTRATION_DATABASE_SCHEMA_VERSION })
    verification.close()
  })

  it('retires Workflow tables and triggers from a v63 feature database', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-workflow-retirement-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      CREATE TABLE workflow_runs (id TEXT PRIMARY KEY);
      CREATE TABLE workflow_invocations (id TEXT PRIMARY KEY);
      CREATE TRIGGER trg_workflow_runs_parent_insert
      AFTER INSERT ON workflow_runs BEGIN SELECT 1; END;
      CREATE TRIGGER trg_workflow_invocations_run_insert
      AFTER INSERT ON workflow_invocations BEGIN SELECT 1; END;
      CREATE TRIGGER trg_workflow_sessions_delete_references
      AFTER DELETE ON new_sessions BEGIN SELECT 1; END;
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (63, 100);
    `)
    bootstrap.close()

    const migrated = new MainDatabaseCtor(databasePath)
    expect(migrated.getLatestSchemaVersion()).toBe(ORCHESTRATION_DATABASE_SCHEMA_VERSION)
    migrated.close()

    const verification = new DatabaseCtor(databasePath)
    expect(
      verification
        .prepare(
          `SELECT type, name
           FROM sqlite_master
           WHERE name LIKE 'workflow_%' OR name LIKE 'trg_workflow_%'
           ORDER BY type, name`
        )
        .all()
    ).toEqual([])
    expect(
      verification.prepare('SELECT MAX(version) AS version FROM schema_versions').get()
    ).toEqual({ version: ORCHESTRATION_DATABASE_SCHEMA_VERSION })
    verification.close()
  })
})
