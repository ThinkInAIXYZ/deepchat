import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const mainDatabaseModule = Database ? await import('@/data/mainDatabase').catch(() => null) : null
const pendingInputsModule = Database
  ? await import('@/session/data/tables/deepchatPendingInputs').catch(() => null)
  : null
const messageTracesModule = Database
  ? await import('@/session/data/tables/deepchatMessageTraces').catch(() => null)
  : null
const liveDelegationsModule = Database
  ? await import('@/orchestration/data/tables/liveDelegations').catch(() => null)
  : null
const MainDatabaseCtor = mainDatabaseModule?.MainDatabase!
const LATEST_DATABASE_SCHEMA_VERSION =
  liveDelegationsModule?.LIVE_DELEGATION_EVALUATION_DATABASE_SCHEMA_VERSION
const CONTRACT_DATABASE_SCHEMA_VERSION =
  liveDelegationsModule?.LIVE_DELEGATION_CONTRACT_DATABASE_SCHEMA_VERSION
const CURRENT_DATABASE_SCHEMA_VERSION = Math.max(
  LATEST_DATABASE_SCHEMA_VERSION ?? 0,
  pendingInputsModule?.PENDING_INPUT_RETRY_SCHEMA_VERSION ?? 0,
  messageTracesModule?.TRACE_EVIDENCE_APPEND_INDEX_SCHEMA_VERSION ?? 0
)
const DatabaseCtor = Database!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(MainDatabaseCtor && CURRENT_DATABASE_SCHEMA_VERSION && CONTRACT_DATABASE_SCHEMA_VERSION),
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
    expect(migrated.getLatestSchemaVersion()).toBe(CURRENT_DATABASE_SCHEMA_VERSION)
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
      version: CURRENT_DATABASE_SCHEMA_VERSION
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
    expect(migrated.getLatestSchemaVersion()).toBe(CURRENT_DATABASE_SCHEMA_VERSION)
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
    ).toEqual({ version: CURRENT_DATABASE_SCHEMA_VERSION })
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
    expect(migrated.getLatestSchemaVersion()).toBe(CURRENT_DATABASE_SCHEMA_VERSION)
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
    ).toEqual({ version: CURRENT_DATABASE_SCHEMA_VERSION })
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
    ).toEqual({ version: CURRENT_DATABASE_SCHEMA_VERSION })
    verification.close()
  })

  it('repairs missing contract projections at the current schema version without losing rows', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-live-contract-repair-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      INSERT INTO new_sessions (id, agent_id, title, created_at, updated_at)
      VALUES ('parent', 'agent-1', 'Parent', 100, 100);
      INSERT INTO live_delegations (
        delegation_id, parent_session_id, slot_id, target_agent_id, title, status,
        last_turn_seq, created_at, updated_at
      ) VALUES (
        'delegation-1', 'parent', 'reviewer', 'agent-1', 'Review', 'running', 1, 100, 110
      );
      INSERT INTO live_delegation_turns (
        turn_id, delegation_id, seq, kind, prompt, status, effect_state,
        created_at, started_at, updated_at
      ) VALUES (
        'turn-1', 'delegation-1', 1, 'initial', 'Review it.', 'running', 'none',
        100, 110, 110
      );
      INSERT INTO live_delegation_events (
        delegation_id, parent_session_id, direction, kind, content, created_at
      ) VALUES (
        'delegation-1', 'parent', 'parent_to_child', 'message', 'Continue.', 110
      );
      ALTER TABLE live_delegation_turns DROP COLUMN evaluation_ref_json;
      ALTER TABLE live_delegation_turns DROP COLUMN evaluation_json;
      ALTER TABLE live_delegation_turns DROP COLUMN inherited_task_contract_ref_json;
      ALTER TABLE live_delegation_turns DROP COLUMN task_contract_ref_json;
      ALTER TABLE live_delegation_turns DROP COLUMN task_contract_json;
      ALTER TABLE live_delegation_events DROP COLUMN evaluation_ref_json;
      ALTER TABLE live_delegation_events DROP COLUMN evaluation_json;
    `)
    bootstrap.close()

    const repaired = new MainDatabaseCtor(databasePath)
    const missingColumns = [
      ['live_delegation_turns', 'task_contract_json'],
      ['live_delegation_turns', 'task_contract_ref_json'],
      ['live_delegation_turns', 'inherited_task_contract_ref_json'],
      ['live_delegation_turns', 'evaluation_json'],
      ['live_delegation_turns', 'evaluation_ref_json'],
      ['live_delegation_events', 'evaluation_json'],
      ['live_delegation_events', 'evaluation_ref_json']
    ] as const
    const diagnosis = await repaired.diagnoseSchema()

    for (const [table, name] of missingColumns) {
      expect(diagnosis.issues).toContainEqual(
        expect.objectContaining({ kind: 'missing_column', table, name, repairable: true })
      )
    }

    const repairReport = await repaired.repairSchema()
    expect(repairReport.status).toBe('repaired')
    expect(repairReport.remainingIssues).toEqual([])

    const repeatedRepair = await repaired.repairSchema()
    expect(repeatedRepair.status).toBe('healthy')
    expect(repeatedRepair.repairedIssues).toEqual([])
    repaired.close()

    const verification = new DatabaseCtor(databasePath)
    const turnColumns = new Set(
      (
        verification.prepare('PRAGMA table_info(live_delegation_turns)').all() as Array<{
          name: string
        }>
      ).map((column) => column.name)
    )
    const eventColumns = new Set(
      (
        verification.prepare('PRAGMA table_info(live_delegation_events)').all() as Array<{
          name: string
        }>
      ).map((column) => column.name)
    )

    for (const [table, name] of missingColumns) {
      expect(table === 'live_delegation_turns' ? turnColumns : eventColumns).toContain(name)
    }
    expect(
      verification
        .prepare(
          `SELECT prompt, task_contract_json, task_contract_ref_json,
                  inherited_task_contract_ref_json, evaluation_json, evaluation_ref_json
           FROM live_delegation_turns
           WHERE turn_id = 'turn-1'`
        )
        .get()
    ).toEqual({
      prompt: 'Review it.',
      task_contract_json: null,
      task_contract_ref_json: null,
      inherited_task_contract_ref_json: null,
      evaluation_json: null,
      evaluation_ref_json: null
    })
    expect(
      verification
        .prepare(
          `SELECT content, evaluation_json, evaluation_ref_json
           FROM live_delegation_events
           WHERE delegation_id = 'delegation-1'`
        )
        .get()
    ).toEqual({ content: 'Continue.', evaluation_json: null, evaluation_ref_json: null })
    expect(
      verification.prepare('SELECT MAX(version) AS version FROM schema_versions').get()
    ).toEqual({ version: CURRENT_DATABASE_SCHEMA_VERSION })
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
    expect(migrated.getLatestSchemaVersion()).toBe(CURRENT_DATABASE_SCHEMA_VERSION)
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
    ).toEqual({ version: CURRENT_DATABASE_SCHEMA_VERSION })
    verification.close()
  })

  it('adds nullable mailbox evaluation projections to the v65 schema without losing events', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-live-evaluation-migration-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      ALTER TABLE live_delegation_events DROP COLUMN evaluation_ref_json;
      ALTER TABLE live_delegation_events DROP COLUMN evaluation_json;
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
      INSERT INTO live_delegation_events (
        delegation_id, parent_session_id, direction, kind, content, related_turn_id, created_at
      ) VALUES (
        'delegation-1', 'parent', 'child_to_parent', 'turn_completed', 'Done.', 'turn-1', 120
      );
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at)
      VALUES (${CONTRACT_DATABASE_SCHEMA_VERSION}, 100);
    `)
    bootstrap.close()

    const migrated = new MainDatabaseCtor(databasePath)
    expect(migrated.getLatestSchemaVersion()).toBe(CURRENT_DATABASE_SCHEMA_VERSION)
    migrated.close()

    const verification = new DatabaseCtor(databasePath)
    expect(
      verification
        .prepare(
          `SELECT content, evaluation_json, evaluation_ref_json
           FROM live_delegation_events
           WHERE related_turn_id = 'turn-1'`
        )
        .get()
    ).toEqual({ content: 'Done.', evaluation_json: null, evaluation_ref_json: null })
    expect(
      verification.prepare('SELECT MAX(version) AS version FROM schema_versions').get()
    ).toEqual({ version: CURRENT_DATABASE_SCHEMA_VERSION })
    verification.close()
  })
})
