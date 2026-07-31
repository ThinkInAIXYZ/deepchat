import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WORKFLOW_RUNTIME_DEFAULT_LIMITS } from '@shared/workflow/runtimeProtocol'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const mainDatabaseModule = Database ? await import('@/data/mainDatabase').catch(() => null) : null
const workflowRunsModule = Database
  ? await import('@/workflow/data/tables/workflowRuns').catch(() => null)
  : null
const newSessionsModule = Database
  ? await import('@/session/data/tables/newSessions').catch(() => null)
  : null
const MainDatabase = mainDatabaseModule?.MainDatabase
const WORKFLOW_SCHEMA_VERSION = workflowRunsModule?.WORKFLOW_SCHEMA_VERSION
const LATEST_SCHEMA_VERSION = newSessionsModule?.SESSION_WORKFLOW_TOOL_DEFAULT_SCHEMA_VERSION
const DatabaseCtor = Database!
const MainDatabaseCtor = MainDatabase!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(MainDatabase && WORKFLOW_SCHEMA_VERSION && LATEST_SCHEMA_VERSION),
  'Workflow migration modules are unavailable'
)

describeIfSqlite('workflow schema migration', () => {
  const tempDirectories: string[] = []

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('migrates a v52 database to the workflow schema atomically', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-workflow-migration-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      DROP TRIGGER IF EXISTS trg_workflow_sessions_delete_references;
      DROP TABLE IF EXISTS workflow_invocations;
      DROP TABLE IF EXISTS workflow_runs;
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (52, 100);
    `)
    bootstrap.close()

    const database = new MainDatabaseCtor(databasePath)
    expect(database.getLatestSchemaVersion()).toBe(LATEST_SCHEMA_VERSION)
    database.close()

    const migrated = new DatabaseCtor(databasePath)
    const tables = migrated
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('workflow_runs', 'workflow_invocations')
         ORDER BY name`
      )
      .all()
    expect(tables).toEqual([{ name: 'workflow_invocations' }, { name: 'workflow_runs' }])
    expect(migrated.prepare('SELECT MAX(version) AS version FROM schema_versions').get()).toEqual({
      version: LATEST_SCHEMA_VERSION
    })

    const triggers = migrated
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'trigger'
           AND name LIKE 'trg_workflow_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>
    expect(triggers.map((row) => row.name)).toEqual([
      'trg_workflow_invocations_child_insert',
      'trg_workflow_invocations_child_update',
      'trg_workflow_invocations_immutable_identity',
      'trg_workflow_invocations_run_insert',
      'trg_workflow_invocations_timeout_arm',
      'trg_workflow_invocations_timeout_required',
      'trg_workflow_runs_delete_invocations',
      'trg_workflow_runs_immutable_snapshot',
      'trg_workflow_runs_parent_insert',
      'trg_workflow_sessions_delete_references'
    ])
    migrated.close()
  })

  it('adds durable capability scope columns when upgrading an existing v53 workflow table', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-workflow-scope-migration-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      DROP TRIGGER IF EXISTS trg_workflow_runs_immutable_snapshot;
      ALTER TABLE workflow_runs DROP COLUMN workspace_path;
      ALTER TABLE workflow_runs DROP COLUMN capability_scope_hash;
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (53, 100);
    `)
    bootstrap.close()

    const database = new MainDatabaseCtor(databasePath)
    database.close()

    const migrated = new DatabaseCtor(databasePath)
    const columns = migrated.prepare('PRAGMA table_info(workflow_runs)').all() as Array<{
      name: string
      notnull: number
      dflt_value: string | null
    }>
    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'workspace_path', notnull: 0 }),
        expect.objectContaining({
          name: 'capability_scope_hash',
          notnull: 1,
          dflt_value: "'0000000000000000000000000000000000000000000000000000000000000000'"
        })
      ])
    )
    const trigger = migrated
      .prepare(
        `SELECT sql
         FROM sqlite_master
         WHERE type = 'trigger'
           AND name = 'trg_workflow_runs_immutable_snapshot'`
      )
      .get() as { sql: string }
    expect(trigger.sql).toContain('workspace_path')
    expect(trigger.sql).toContain('capability_scope_hash')
    migrated.close()
  })

  it('re-arms queued invocation deadlines only after admission when upgrading v54', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-workflow-timeout-migration-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec('PRAGMA foreign_keys = OFF;')
    bootstrap.exec(`
      DROP TRIGGER IF EXISTS trg_workflow_runs_parent_insert;
      DROP TRIGGER IF EXISTS trg_workflow_invocations_immutable_identity;
      DROP TRIGGER IF EXISTS trg_workflow_invocations_timeout_arm;
      DROP TRIGGER IF EXISTS trg_workflow_invocations_timeout_required;
      CREATE TRIGGER trg_workflow_invocations_immutable_identity
      BEFORE UPDATE OF
        invocation_id,
        run_id,
        seq,
        call_path,
        attempt,
        execution_epoch,
        request_json,
        input_hash,
        policy_hash,
        child_correlation_slot,
        timeout_deadline_at
      ON workflow_invocations
      BEGIN
        SELECT RAISE(ABORT, 'workflow invocation identity is immutable');
      END;
    `)
    const source = 'return null'
    const scriptHash = createHash('sha256').update(source).digest('hex')
    const policyHash = 'a'.repeat(64)
    bootstrap
      .prepare(
        `INSERT INTO workflow_runs (
           run_id,
           parent_session_id,
           workspace_path,
           capability_scope_hash,
           script_source,
           script_hash,
           input_json,
           runtime_api_version,
           limits_json,
           allowed_agent_ids_json,
           policy_hash,
           status,
           created_at,
           updated_at,
           revision
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, 0)`
      )
      .run(
        'run-timeout',
        'missing-parent',
        '/repo',
        'b'.repeat(64),
        source,
        scriptHash,
        'null',
        1,
        JSON.stringify(WORKFLOW_RUNTIME_DEFAULT_LIMITS),
        '["deepchat"]',
        policyHash,
        100,
        100
      )
    bootstrap
      .prepare(
        `INSERT INTO workflow_invocations (
           invocation_id,
           run_id,
           seq,
           call_path,
           attempt,
           execution_epoch,
           request_json,
           input_hash,
           policy_hash,
           child_correlation_slot,
           status,
           timeout_deadline_at,
           created_at,
           updated_at
         ) VALUES (?, ?, 1, ?, 1, 1, ?, ?, ?, ?, 'queued', ?, ?, ?)`
      )
      .run(
        'invocation-timeout',
        'run-timeout',
        'root/agent/work',
        JSON.stringify({
          callPath: 'root/agent/work',
          prompt: 'work',
          options: { key: 'work', timeoutMs: 1_000 }
        }),
        'c'.repeat(64),
        policyHash,
        'workflow:timeout',
        1_100,
        100,
        100
      )
    bootstrap.exec(`
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (54, 100);
    `)
    bootstrap.close()

    const database = new MainDatabaseCtor(databasePath)
    database.close()

    const migrated = new DatabaseCtor(databasePath)
    expect(
      migrated
        .prepare(
          `SELECT status, timeout_deadline_at
           FROM workflow_invocations
           WHERE invocation_id = ?`
        )
        .get('invocation-timeout')
    ).toEqual({
      status: 'queued',
      timeout_deadline_at: null
    })
    expect(() =>
      migrated
        .prepare(
          `UPDATE workflow_invocations
           SET timeout_deadline_at = 2000
           WHERE invocation_id = 'invocation-timeout'`
        )
        .run()
    ).toThrow('timeout may only be armed at admission')
    migrated.close()
  })

  it('disables workflow for existing sessions when upgrading v55', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-workflow-tool-migration-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
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
        updated_at,
        revision
      ) VALUES
        (
          'session-existing-tools',
          'deepchat',
          'Existing tools',
          NULL,
          0,
          0,
          '[]',
          '["stale-json"]',
          0,
          'regular',
          NULL,
          NULL,
          100,
          200,
          3
        ),
        (
          'session-already-disabled',
          'deepchat',
          'Already disabled',
          NULL,
          0,
          0,
          '[]',
          '["workflow","cronjob"]',
          0,
          'regular',
          NULL,
          NULL,
          300,
          400,
          5
        ),
        (
          'session-fallback-json',
          'deepchat',
          'Fallback JSON',
          NULL,
          0,
          0,
          '[]',
          '["custom-tool"]',
          0,
          'regular',
          NULL,
          NULL,
          500,
          600,
          7
        ),
        (
          'session-malformed-json',
          'deepchat',
          'Malformed JSON',
          NULL,
          0,
          0,
          '[]',
          'not-json',
          0,
          'regular',
          NULL,
          NULL,
          700,
          800,
          9
        );

      INSERT INTO new_session_disabled_agent_tools (session_id, ordinal, tool_name) VALUES
        ('session-existing-tools', 0, 'cronjob'),
        ('session-existing-tools', 1, 'custom-tool'),
        ('session-already-disabled', 0, 'workflow'),
        ('session-already-disabled', 1, 'cronjob');

      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (55, 100);
    `)
    bootstrap.close()

    const database = new MainDatabaseCtor(databasePath)
    database.close()

    const migrated = new DatabaseCtor(databasePath)
    const sessions = migrated
      .prepare(
        `SELECT id, disabled_agent_tools, updated_at, revision
         FROM new_sessions
         WHERE id LIKE 'session-%'
         ORDER BY id`
      )
      .all()
    expect(sessions).toEqual([
      {
        id: 'session-already-disabled',
        disabled_agent_tools: '["workflow","cronjob"]',
        updated_at: 400,
        revision: 5
      },
      {
        id: 'session-existing-tools',
        disabled_agent_tools: '["cronjob","custom-tool","workflow"]',
        updated_at: 200,
        revision: 3
      },
      {
        id: 'session-fallback-json',
        disabled_agent_tools: '["custom-tool","workflow"]',
        updated_at: 600,
        revision: 7
      },
      {
        id: 'session-malformed-json',
        disabled_agent_tools: '["workflow"]',
        updated_at: 800,
        revision: 9
      }
    ])

    const normalizedTools = migrated
      .prepare(
        `SELECT session_id, ordinal, tool_name
         FROM new_session_disabled_agent_tools
         WHERE session_id LIKE 'session-%'
         ORDER BY session_id, ordinal`
      )
      .all()
    expect(normalizedTools).toEqual([
      { session_id: 'session-already-disabled', ordinal: 0, tool_name: 'workflow' },
      { session_id: 'session-already-disabled', ordinal: 1, tool_name: 'cronjob' },
      { session_id: 'session-existing-tools', ordinal: 0, tool_name: 'cronjob' },
      { session_id: 'session-existing-tools', ordinal: 1, tool_name: 'custom-tool' },
      { session_id: 'session-existing-tools', ordinal: 2, tool_name: 'workflow' },
      { session_id: 'session-fallback-json', ordinal: 0, tool_name: 'custom-tool' },
      { session_id: 'session-fallback-json', ordinal: 1, tool_name: 'workflow' },
      { session_id: 'session-malformed-json', ordinal: 0, tool_name: 'workflow' }
    ])
    migrated.close()
  })
})
