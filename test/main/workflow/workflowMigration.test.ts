import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WORKFLOW_RUNTIME_DEFAULT_LIMITS } from '@shared/workflow/runtimeProtocol'
import { WorkflowExecutionSnapshotSchema } from '@shared/workflow/domain'
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
const LATEST_SCHEMA_VERSION = Math.max(
  WORKFLOW_SCHEMA_VERSION ?? 0,
  newSessionsModule?.SESSION_ORCHESTRATION_POLICY_SCHEMA_VERSION ?? 0
)
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
      ALTER TABLE new_sessions DROP COLUMN orchestration_policy;
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
      ALTER TABLE workflow_runs DROP COLUMN execution_snapshot_json;
      ALTER TABLE new_sessions DROP COLUMN orchestration_policy;
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
      DROP TRIGGER IF EXISTS trg_workflow_runs_immutable_snapshot;
      DROP TRIGGER IF EXISTS trg_workflow_invocations_immutable_identity;
      DROP TRIGGER IF EXISTS trg_workflow_invocations_timeout_arm;
      DROP TRIGGER IF EXISTS trg_workflow_invocations_timeout_required;
      ALTER TABLE workflow_runs DROP COLUMN execution_snapshot_json;
      ALTER TABLE new_sessions DROP COLUMN orchestration_policy;
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

  it('backfills immutable launch settings when upgrading an existing v57 run', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'deepchat-workflow-snapshot-migration-')
    )
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      DROP TRIGGER IF EXISTS trg_workflow_runs_immutable_snapshot;
      ALTER TABLE workflow_runs DROP COLUMN execution_snapshot_json;
      ALTER TABLE new_sessions DROP COLUMN orchestration_policy;
      ALTER TABLE new_sessions
        ADD COLUMN orchestration_mode TEXT NOT NULL DEFAULT 'adaptive'
        CHECK (orchestration_mode IN ('adaptive', 'workflow'));

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
        orchestration_mode,
        created_at,
        updated_at,
        revision
      ) VALUES (
        'snapshot-parent',
        'deepchat',
        'Snapshot parent',
        '/repo',
        0,
        0,
        '[]',
        '[]',
        1,
        'regular',
        NULL,
        NULL,
        'workflow',
        100,
        100,
        0
      );

      INSERT INTO deepchat_sessions (
        id,
        provider_id,
        model_id,
        permission_mode,
        system_prompt,
        temperature,
        top_p,
        context_length,
        max_tokens,
        timeout_ms,
        thinking_budget,
        reasoning_effort,
        reasoning_visibility,
        verbosity,
        force_interleaved_thinking_compat,
        image_generation_options_json,
        video_generation_options_json
      ) VALUES (
        'snapshot-parent',
        'openai',
        'gpt-5.6-sol',
        'default',
        'Frozen system prompt',
        0.25,
        0.9,
        64000,
        8192,
        120000,
        4096,
        'high',
        'summary',
        'medium',
        1,
        '{"size":"1024x1024","quality":"high"}',
        '{"seconds":"5","watermark":true}'
      );

      INSERT INTO workflow_runs (
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
      ) VALUES (
        'snapshot-run',
        'snapshot-parent',
        '/repo',
        '${'b'.repeat(64)}',
        'return null',
        '${createHash('sha256').update('return null').digest('hex')}',
        'null',
        1,
        '${JSON.stringify(WORKFLOW_RUNTIME_DEFAULT_LIMITS)}',
        '["deepchat"]',
        '${'c'.repeat(64)}',
        'queued',
        100,
        100,
        0
      );

      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (57, 100);
    `)
    bootstrap.close()

    const database = new MainDatabaseCtor(databasePath)
    database.close()

    const migrated = new DatabaseCtor(databasePath)
    const row = migrated
      .prepare('SELECT execution_snapshot_json FROM workflow_runs WHERE run_id = ?')
      .get('snapshot-run') as { execution_snapshot_json: string }
    const snapshot = WorkflowExecutionSnapshotSchema.parse(JSON.parse(row.execution_snapshot_json))
    expect(snapshot).toEqual({
      schemaVersion: 1,
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
      generationSettings: {
        systemPrompt: 'Frozen system prompt',
        temperature: 0.25,
        topP: 0.9,
        contextLength: 64_000,
        maxTokens: 8_192,
        timeout: 120_000,
        thinkingBudget: 4_096,
        reasoningEffort: 'high',
        reasoningVisibility: 'summary',
        verbosity: 'medium',
        forceInterleavedThinkingCompat: true,
        imageGeneration: { size: '1024x1024', quality: 'high' },
        videoGeneration: { seconds: '5', watermark: true }
      }
    })
    expect(() =>
      migrated
        .prepare('UPDATE workflow_runs SET execution_snapshot_json = ? WHERE run_id = ?')
        .run(row.execution_snapshot_json, 'snapshot-run')
    ).toThrow('workflow run snapshot is immutable')
    expect(
      migrated
        .prepare('SELECT orchestration_policy FROM new_sessions WHERE id = ?')
        .get('snapshot-parent')
    ).toEqual({ orchestration_policy: 'proactive' })
    migrated.close()
  })

  it('moves legacy workflow tool state to explicit policy when upgrading v55', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-workflow-tool-migration-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      DROP TRIGGER IF EXISTS trg_workflow_runs_immutable_snapshot;
      ALTER TABLE workflow_runs DROP COLUMN execution_snapshot_json;
      ALTER TABLE new_sessions DROP COLUMN orchestration_policy;

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
        `SELECT id, disabled_agent_tools, orchestration_policy, updated_at, revision
         FROM new_sessions
         WHERE id LIKE 'session-%'
         ORDER BY id`
      )
      .all()
    expect(sessions).toEqual([
      {
        id: 'session-already-disabled',
        disabled_agent_tools: '["cronjob"]',
        orchestration_policy: 'explicit',
        updated_at: 400,
        revision: 5
      },
      {
        id: 'session-existing-tools',
        disabled_agent_tools: '["cronjob","custom-tool"]',
        orchestration_policy: 'explicit',
        updated_at: 200,
        revision: 3
      },
      {
        id: 'session-fallback-json',
        disabled_agent_tools: '["custom-tool"]',
        orchestration_policy: 'explicit',
        updated_at: 600,
        revision: 7
      },
      {
        id: 'session-malformed-json',
        disabled_agent_tools: '[]',
        orchestration_policy: 'explicit',
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
      { session_id: 'session-already-disabled', ordinal: 1, tool_name: 'cronjob' },
      { session_id: 'session-existing-tools', ordinal: 0, tool_name: 'cronjob' },
      { session_id: 'session-existing-tools', ordinal: 1, tool_name: 'custom-tool' },
      { session_id: 'session-fallback-json', ordinal: 0, tool_name: 'custom-tool' }
    ])
    migrated.close()
  })

  it('maps legacy orchestration modes to explicit and proactive policies when upgrading v58', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-policy-migration-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      ALTER TABLE new_sessions DROP COLUMN orchestration_policy;
      ALTER TABLE new_sessions
        ADD COLUMN orchestration_mode TEXT NOT NULL DEFAULT 'adaptive'
        CHECK (orchestration_mode IN ('adaptive', 'workflow'));

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
        orchestration_mode,
        created_at,
        updated_at,
        revision
      ) VALUES
        ('session-explicit', 'deepchat', 'Explicit', NULL, 0, 0, '[]', '[]', 1,
          'regular', NULL, NULL, 'adaptive', 100, 100, 0),
        ('session-proactive', 'deepchat', 'Proactive', NULL, 0, 0, '[]', '[]', 1,
          'regular', NULL, NULL, 'workflow', 100, 100, 0);

      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (58, 100);
    `)
    bootstrap.close()

    const database = new MainDatabaseCtor(databasePath)
    database.close()

    const migrated = new DatabaseCtor(databasePath)
    expect(
      migrated
        .prepare(
          `SELECT id, orchestration_policy
           FROM new_sessions
           WHERE id LIKE 'session-%'
           ORDER BY id`
        )
        .all()
    ).toEqual([
      { id: 'session-explicit', orchestration_policy: 'explicit' },
      { id: 'session-proactive', orchestration_policy: 'proactive' }
    ])
    const columns = migrated.prepare('PRAGMA table_info(new_sessions)').all() as Array<{
      name: string
    }>
    expect(columns.some((column) => column.name === 'orchestration_mode')).toBe(false)
    migrated.close()
  })
})
