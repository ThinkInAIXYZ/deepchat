import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import {
  WORKFLOW_EXECUTION_SNAPSHOT_MAX_BYTES,
  WORKFLOW_STORED_JSON_MAX_BYTES,
  WORKFLOW_STORED_METADATA_MAX_BYTES,
  WORKFLOW_UNAVAILABLE_EXECUTION_ID,
  type WorkflowResultDeliveryState,
  type WorkflowRunStatus
} from '@shared/workflow/domain'
import { WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES } from '@shared/workflow/runtimeProtocol'

export const WORKFLOW_BASE_SCHEMA_VERSION = 53
export const WORKFLOW_SCOPE_SCHEMA_VERSION = 54
export const WORKFLOW_INVOCATION_TIMEOUT_SCHEMA_VERSION = 55
export const WORKFLOW_EXECUTION_SNAPSHOT_SCHEMA_VERSION = 58
export const WORKFLOW_TOKEN_BUDGET_REMOVAL_SCHEMA_VERSION = 63
export const WORKFLOW_SCHEMA_VERSION = WORKFLOW_TOKEN_BUDGET_REMOVAL_SCHEMA_VERSION
// Historical migration behavior must not change with future runtime-default tuning.
const WORKFLOW_V63_DEFAULT_EXECUTION_TIMEOUT_MS = 7_200_000
export const LEGACY_WORKFLOW_CAPABILITY_SCOPE_HASH = '0'.repeat(64)
export const LEGACY_WORKFLOW_EXECUTION_SNAPSHOT_JSON = JSON.stringify({
  schemaVersion: 1,
  providerId: WORKFLOW_UNAVAILABLE_EXECUTION_ID,
  modelId: WORKFLOW_UNAVAILABLE_EXECUTION_ID,
  generationSettings: {}
})
const LEGACY_WORKFLOW_SYSTEM_PROMPT_MAX_BYTES = 256 * 1024
const LEGACY_WORKFLOW_MEDIA_OPTIONS_MAX_BYTES = 96 * 1024
export const WORKFLOW_EXECUTION_SNAPSHOT_ADD_COLUMN_SQL = `
  ALTER TABLE workflow_runs
  ADD COLUMN execution_snapshot_json TEXT NOT NULL
  DEFAULT '${LEGACY_WORKFLOW_EXECUTION_SNAPSHOT_JSON}' CHECK (
    json_valid(execution_snapshot_json)
    AND json_type(execution_snapshot_json) = 'object'
    AND json_extract(execution_snapshot_json, '$.schemaVersion') = 1
    AND json_type(execution_snapshot_json, '$.providerId') = 'text'
    AND length(json_extract(execution_snapshot_json, '$.providerId')) BETWEEN 1 AND 4096
    AND instr(json_extract(execution_snapshot_json, '$.providerId'), char(0)) = 0
    AND json_type(execution_snapshot_json, '$.modelId') = 'text'
    AND length(json_extract(execution_snapshot_json, '$.modelId')) BETWEEN 1 AND 4096
    AND instr(json_extract(execution_snapshot_json, '$.modelId'), char(0)) = 0
    AND json_type(execution_snapshot_json, '$.generationSettings') = 'object'
    AND length(CAST(execution_snapshot_json AS BLOB))
      <= ${WORKFLOW_EXECUTION_SNAPSHOT_MAX_BYTES}
  )
`
export const WORKFLOW_EXECUTION_SNAPSHOT_BACKFILL_SQL = `
  WITH execution_snapshots AS (
    SELECT
      workflow_runs.run_id,
      json_object(
        'schemaVersion', 1,
        'providerId', trim(deepchat_sessions.provider_id),
        'modelId', trim(deepchat_sessions.model_id),
        'generationSettings', json_patch(
          '{}',
          json_object(
            'systemPrompt', CASE
              WHEN length(CAST(deepchat_sessions.system_prompt AS BLOB))
                <= ${LEGACY_WORKFLOW_SYSTEM_PROMPT_MAX_BYTES}
                THEN deepchat_sessions.system_prompt
              ELSE NULL
            END,
            'temperature', CASE
              WHEN typeof(deepchat_sessions.temperature) IN ('integer', 'real')
                THEN deepchat_sessions.temperature
              ELSE NULL
            END,
            'topP', CASE
              WHEN deepchat_sessions.top_p BETWEEN 0.1 AND 1 THEN deepchat_sessions.top_p
              ELSE NULL
            END,
            'contextLength', CASE
              WHEN typeof(deepchat_sessions.context_length) = 'integer'
                THEN deepchat_sessions.context_length
              ELSE NULL
            END,
            'maxTokens', CASE
              WHEN typeof(deepchat_sessions.max_tokens) = 'integer'
                THEN deepchat_sessions.max_tokens
              ELSE NULL
            END,
            'timeout', CASE
              WHEN typeof(deepchat_sessions.timeout_ms) = 'integer'
                THEN deepchat_sessions.timeout_ms
              ELSE NULL
            END,
            'thinkingBudget', CASE
              WHEN typeof(deepchat_sessions.thinking_budget) = 'integer'
                THEN deepchat_sessions.thinking_budget
              ELSE NULL
            END,
            'reasoningEffort', CASE
              WHEN deepchat_sessions.reasoning_effort IN (
                'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'
              ) THEN deepchat_sessions.reasoning_effort
              ELSE NULL
            END,
            'reasoningVisibility', CASE
              WHEN deepchat_sessions.reasoning_visibility IN (
                'hidden', 'summary', 'full', 'mixed', 'omitted', 'summarized'
              ) THEN deepchat_sessions.reasoning_visibility
              ELSE NULL
            END,
            'verbosity', CASE
              WHEN deepchat_sessions.verbosity IN ('low', 'medium', 'high')
                THEN deepchat_sessions.verbosity
              ELSE NULL
            END,
            'forceInterleavedThinkingCompat', CASE
              WHEN deepchat_sessions.force_interleaved_thinking_compat = 1 THEN json('true')
              WHEN deepchat_sessions.force_interleaved_thinking_compat = 0 THEN json('false')
              ELSE NULL
            END,
            'imageGeneration', CASE
              WHEN json_valid(deepchat_sessions.image_generation_options_json)
                AND json_type(deepchat_sessions.image_generation_options_json) = 'object'
                AND length(CAST(deepchat_sessions.image_generation_options_json AS BLOB))
                  <= ${LEGACY_WORKFLOW_MEDIA_OPTIONS_MAX_BYTES}
                THEN json(deepchat_sessions.image_generation_options_json)
              ELSE NULL
            END,
            'videoGeneration', CASE
              WHEN json_valid(deepchat_sessions.video_generation_options_json)
                AND json_type(deepchat_sessions.video_generation_options_json) = 'object'
                AND length(CAST(deepchat_sessions.video_generation_options_json AS BLOB))
                  <= ${LEGACY_WORKFLOW_MEDIA_OPTIONS_MAX_BYTES}
                THEN json(deepchat_sessions.video_generation_options_json)
              ELSE NULL
            END
          )
        )
      ) AS snapshot_json
    FROM workflow_runs
    INNER JOIN deepchat_sessions
      ON deepchat_sessions.id = workflow_runs.parent_session_id
    WHERE workflow_runs.execution_snapshot_json = '${LEGACY_WORKFLOW_EXECUTION_SNAPSHOT_JSON}'
      AND length(trim(deepchat_sessions.provider_id)) BETWEEN 1 AND 4096
      AND instr(deepchat_sessions.provider_id, char(0)) = 0
      AND length(trim(deepchat_sessions.model_id)) BETWEEN 1 AND 4096
      AND instr(deepchat_sessions.model_id, char(0)) = 0
  )
  UPDATE workflow_runs
  SET execution_snapshot_json = (
    SELECT execution_snapshots.snapshot_json
    FROM execution_snapshots
    WHERE execution_snapshots.run_id = workflow_runs.run_id
  )
  WHERE workflow_runs.run_id IN (
    SELECT execution_snapshots.run_id
    FROM execution_snapshots
    WHERE length(CAST(execution_snapshots.snapshot_json AS BLOB))
      <= ${WORKFLOW_EXECUTION_SNAPSHOT_MAX_BYTES}
  )
`

export interface WorkflowRunRow {
  run_id: string
  parent_session_id: string
  parent_message_id: string | null
  named_workflow_path: string | null
  workspace_path: string | null
  capability_scope_hash: string
  execution_snapshot_json: string
  script_source: string
  script_hash: string
  input_json: string
  runtime_api_version: number
  limits_json: string
  allowed_agent_ids_json: string
  policy_hash: string
  budget_json: string | null
  status: WorkflowRunStatus
  execution_epoch: number
  next_invocation_seq: number
  phase_json: string | null
  result_json: string | null
  error_json: string | null
  usage_json: string | null
  cancellation_reason: string | null
  interruption_reason: string | null
  invalidated_from_seq: number | null
  result_delivery_state: WorkflowResultDeliveryState
  result_delivery_id: string | null
  created_at: number
  started_at: number | null
  updated_at: number
  completed_at: number | null
  revision: number
}

const WORKFLOW_RUNS_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_workflow_runs_parent_updated
    ON workflow_runs(parent_session_id, updated_at DESC, run_id DESC);
  CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_updated
    ON workflow_runs(status, updated_at ASC, run_id ASC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_delivery_id
    ON workflow_runs(result_delivery_id)
    WHERE result_delivery_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_workflow_runs_pending_delivery
    ON workflow_runs(updated_at ASC, run_id ASC)
    WHERE result_delivery_state = 'pending';
`

const WORKFLOW_RUNS_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS trg_workflow_runs_parent_insert
  BEFORE INSERT ON workflow_runs
  WHEN NOT EXISTS (
    SELECT 1 FROM new_sessions WHERE id = NEW.parent_session_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'workflow parent session does not exist');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_workflow_runs_immutable_snapshot
  BEFORE UPDATE OF
    parent_session_id,
    parent_message_id,
    named_workflow_path,
    workspace_path,
    capability_scope_hash,
    execution_snapshot_json,
    script_source,
    script_hash,
    input_json,
    runtime_api_version,
    limits_json,
    allowed_agent_ids_json,
    policy_hash,
    budget_json
  ON workflow_runs
  BEGIN
    SELECT RAISE(ABORT, 'workflow run snapshot is immutable');
  END;
`

export class WorkflowRunsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'workflow_runs')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS workflow_runs (
        run_id TEXT PRIMARY KEY CHECK (length(run_id) BETWEEN 1 AND 256),
        parent_session_id TEXT NOT NULL CHECK (length(parent_session_id) BETWEEN 1 AND 256),
        parent_message_id TEXT CHECK (
          parent_message_id IS NULL OR length(parent_message_id) BETWEEN 1 AND 256
        ),
        named_workflow_path TEXT CHECK (
          named_workflow_path IS NULL OR length(named_workflow_path) <= 4096
        ),
        workspace_path TEXT CHECK (
          workspace_path IS NULL
          OR (
            length(workspace_path) BETWEEN 1 AND 4096
            AND instr(workspace_path, char(0)) = 0
          )
        ),
        capability_scope_hash TEXT NOT NULL CHECK (
          length(capability_scope_hash) = 64
          AND capability_scope_hash NOT GLOB '*[^0-9a-f]*'
        ),
        execution_snapshot_json TEXT NOT NULL CHECK (
          json_valid(execution_snapshot_json)
          AND json_type(execution_snapshot_json) = 'object'
          AND json_extract(execution_snapshot_json, '$.schemaVersion') = 1
          AND json_type(execution_snapshot_json, '$.providerId') = 'text'
          AND length(json_extract(execution_snapshot_json, '$.providerId')) BETWEEN 1 AND 4096
          AND instr(json_extract(execution_snapshot_json, '$.providerId'), char(0)) = 0
          AND json_type(execution_snapshot_json, '$.modelId') = 'text'
          AND length(json_extract(execution_snapshot_json, '$.modelId')) BETWEEN 1 AND 4096
          AND instr(json_extract(execution_snapshot_json, '$.modelId'), char(0)) = 0
          AND json_type(execution_snapshot_json, '$.generationSettings') = 'object'
          AND length(CAST(execution_snapshot_json AS BLOB))
            <= ${WORKFLOW_EXECUTION_SNAPSHOT_MAX_BYTES}
        ),
        script_source TEXT NOT NULL CHECK (
          length(CAST(script_source AS BLOB)) BETWEEN 1 AND ${WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES}
        ),
        script_hash TEXT NOT NULL CHECK (
          length(script_hash) = 64 AND script_hash NOT GLOB '*[^0-9a-f]*'
        ),
        input_json TEXT NOT NULL CHECK (
          json_valid(input_json)
          AND length(CAST(input_json AS BLOB)) <= ${WORKFLOW_STORED_JSON_MAX_BYTES}
        ),
        runtime_api_version INTEGER NOT NULL CHECK (
          typeof(runtime_api_version) = 'integer' AND runtime_api_version > 0
        ),
        limits_json TEXT NOT NULL CHECK (
          json_valid(limits_json)
          AND length(CAST(limits_json AS BLOB)) <= ${WORKFLOW_STORED_METADATA_MAX_BYTES}
        ),
        allowed_agent_ids_json TEXT NOT NULL CHECK (
          json_valid(allowed_agent_ids_json)
          AND json_type(allowed_agent_ids_json) = 'array'
          AND length(CAST(allowed_agent_ids_json AS BLOB))
            <= ${WORKFLOW_STORED_METADATA_MAX_BYTES}
        ),
        policy_hash TEXT NOT NULL CHECK (
          length(policy_hash) = 64 AND policy_hash NOT GLOB '*[^0-9a-f]*'
        ),
        budget_json TEXT CHECK (
          budget_json IS NULL
          OR (
            json_valid(budget_json)
            AND length(CAST(budget_json AS BLOB)) <= ${WORKFLOW_STORED_METADATA_MAX_BYTES}
          )
        ),
        status TEXT NOT NULL CHECK (
          status IN (
            'queued',
            'running',
            'waiting_interaction',
            'cancelling',
            'succeeded',
            'failed',
            'cancelled',
            'interrupted'
          )
        ),
        execution_epoch INTEGER NOT NULL DEFAULT 1 CHECK (
          typeof(execution_epoch) = 'integer' AND execution_epoch > 0
        ),
        next_invocation_seq INTEGER NOT NULL DEFAULT 1 CHECK (
          typeof(next_invocation_seq) = 'integer' AND next_invocation_seq > 0
        ),
        phase_json TEXT CHECK (
          phase_json IS NULL
          OR (
            json_valid(phase_json)
            AND length(CAST(phase_json AS BLOB)) <= ${WORKFLOW_STORED_METADATA_MAX_BYTES}
          )
        ),
        result_json TEXT CHECK (
          result_json IS NULL
          OR (
            json_valid(result_json)
            AND length(CAST(result_json AS BLOB)) <= ${WORKFLOW_STORED_JSON_MAX_BYTES}
          )
        ),
        error_json TEXT CHECK (
          error_json IS NULL
          OR (
            json_valid(error_json)
            AND length(CAST(error_json AS BLOB)) <= ${WORKFLOW_STORED_METADATA_MAX_BYTES}
          )
        ),
        usage_json TEXT CHECK (
          usage_json IS NULL
          OR (
            json_valid(usage_json)
            AND length(CAST(usage_json AS BLOB)) <= ${WORKFLOW_STORED_METADATA_MAX_BYTES}
          )
        ),
        cancellation_reason TEXT CHECK (
          cancellation_reason IS NULL OR length(cancellation_reason) <= 8192
        ),
        interruption_reason TEXT CHECK (
          interruption_reason IS NULL OR length(interruption_reason) <= 8192
        ),
        invalidated_from_seq INTEGER CHECK (
          invalidated_from_seq IS NULL
          OR (
            typeof(invalidated_from_seq) = 'integer'
            AND invalidated_from_seq > 0
          )
        ),
        result_delivery_state TEXT NOT NULL DEFAULT 'not_ready' CHECK (
          result_delivery_state IN ('not_ready', 'pending', 'delivered')
        ),
        result_delivery_id TEXT CHECK (
          result_delivery_id IS NULL OR length(result_delivery_id) BETWEEN 1 AND 256
        ),
        created_at INTEGER NOT NULL CHECK (
          typeof(created_at) = 'integer' AND created_at >= 0
        ),
        started_at INTEGER CHECK (
          started_at IS NULL OR (typeof(started_at) = 'integer' AND started_at >= 0)
        ),
        updated_at INTEGER NOT NULL CHECK (
          typeof(updated_at) = 'integer' AND updated_at >= 0
        ),
        completed_at INTEGER CHECK (
          completed_at IS NULL OR (typeof(completed_at) = 'integer' AND completed_at >= 0)
        ),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (
          typeof(revision) = 'integer' AND revision >= 0
        ),
        CHECK (
          (
            status IN ('succeeded', 'failed', 'cancelled', 'interrupted')
            AND completed_at IS NOT NULL
          )
          OR (
            status NOT IN ('succeeded', 'failed', 'cancelled', 'interrupted')
            AND completed_at IS NULL
          )
        ),
        CHECK (
          (
            status = 'succeeded'
            AND result_json IS NOT NULL
            AND result_delivery_state IN ('pending', 'delivered')
            AND result_delivery_id IS NOT NULL
          )
          OR (
            status != 'succeeded'
            AND result_json IS NULL
            AND result_delivery_state = 'not_ready'
            AND result_delivery_id IS NULL
          )
        ),
        CHECK (
          (
            status IN ('failed', 'interrupted')
            AND error_json IS NOT NULL
          )
          OR (
            status NOT IN ('failed', 'interrupted')
            AND error_json IS NULL
          )
        ),
        FOREIGN KEY (parent_session_id) REFERENCES new_sessions(id) ON DELETE CASCADE
      );
      ${WORKFLOW_RUNS_INDEX_SQL}
    `
  }

  override createTable(): void {
    super.createTable()
    this.db.exec(WORKFLOW_RUNS_INDEX_SQL)
    this.db.exec(WORKFLOW_RUNS_TRIGGER_SQL)
  }

  getMigrationSQL(version: number): string | null {
    if (version === WORKFLOW_BASE_SCHEMA_VERSION) {
      return this.getCreateTableSQL()
    }
    if (version === WORKFLOW_SCOPE_SCHEMA_VERSION) {
      const statements: string[] = []
      if (!this.hasColumn('workspace_path')) {
        statements.push(`
          ALTER TABLE workflow_runs
          ADD COLUMN workspace_path TEXT CHECK (
            workspace_path IS NULL
            OR (
              length(workspace_path) BETWEEN 1 AND 4096
              AND instr(workspace_path, char(0)) = 0
            )
          )
        `)
      }
      if (!this.hasColumn('capability_scope_hash')) {
        statements.push(`
          ALTER TABLE workflow_runs
          ADD COLUMN capability_scope_hash TEXT NOT NULL
          DEFAULT '${LEGACY_WORKFLOW_CAPABILITY_SCOPE_HASH}' CHECK (
            length(capability_scope_hash) = 64
            AND capability_scope_hash NOT GLOB '*[^0-9a-f]*'
          )
        `)
      }
      statements.push('DROP TRIGGER IF EXISTS trg_workflow_runs_immutable_snapshot')
      return `${statements.join(';\n')};`
    }
    if (version === WORKFLOW_EXECUTION_SNAPSHOT_SCHEMA_VERSION) {
      const statements = ['DROP TRIGGER IF EXISTS trg_workflow_runs_immutable_snapshot']
      if (!this.hasColumn('execution_snapshot_json')) {
        statements.push(WORKFLOW_EXECUTION_SNAPSHOT_ADD_COLUMN_SQL)
        statements.push(WORKFLOW_EXECUTION_SNAPSHOT_BACKFILL_SQL)
      }
      return `${statements.join(';\n')};`
    }
    if (version === WORKFLOW_TOKEN_BUDGET_REMOVAL_SCHEMA_VERSION) {
      return `
        DROP TRIGGER IF EXISTS trg_workflow_runs_immutable_snapshot;
        UPDATE workflow_runs
        SET budget_json = CASE
          WHEN json_type(budget_json, '$.maxExecutionMs') IS NULL THEN
            json_set(
              json_remove(budget_json, '$.maxTotalTokens'),
              '$.maxExecutionMs',
              ${WORKFLOW_V63_DEFAULT_EXECUTION_TIMEOUT_MS}
            )
          ELSE json_remove(budget_json, '$.maxTotalTokens')
        END
        WHERE CASE
          WHEN budget_json IS NULL OR json_valid(budget_json) = 0 THEN 0
          WHEN json_type(budget_json) != 'object' THEN 0
          ELSE json_type(budget_json, '$.maxTotalTokens') IS NOT NULL
        END;
      `
    }
    return null
  }

  getLatestVersion(): number {
    return WORKFLOW_SCHEMA_VERSION
  }

  override finalizeMigration(version: number): void {
    if (
      version === WORKFLOW_BASE_SCHEMA_VERSION ||
      version === WORKFLOW_SCOPE_SCHEMA_VERSION ||
      version === WORKFLOW_EXECUTION_SNAPSHOT_SCHEMA_VERSION ||
      version === WORKFLOW_TOKEN_BUDGET_REMOVAL_SCHEMA_VERSION
    ) {
      this.db.exec(WORKFLOW_RUNS_TRIGGER_SQL)
    }
  }

  get(runId: string): WorkflowRunRow | undefined {
    return this.db.prepare('SELECT * FROM workflow_runs WHERE run_id = ?').get(runId) as
      | WorkflowRunRow
      | undefined
  }

  listByParent(parentSessionId: string, limit = 100): WorkflowRunRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM workflow_runs
         WHERE parent_session_id = ?
         ORDER BY updated_at DESC, run_id DESC
         LIMIT ?`
      )
      .all(parentSessionId, limit) as WorkflowRunRow[]
  }

  listPendingDeliveries(limit = 100): WorkflowRunRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM workflow_runs
         WHERE status = 'succeeded'
           AND result_delivery_state = 'pending'
         ORDER BY completed_at ASC, run_id ASC
         LIMIT ?`
      )
      .all(limit) as WorkflowRunRow[]
  }

  listQueuedIds(limit = 100): string[] {
    const rows = this.db
      .prepare(
        `SELECT run_id
         FROM workflow_runs
         WHERE status = 'queued'
         ORDER BY created_at ASC, run_id ASC
         LIMIT ?`
      )
      .all(limit) as Array<{ run_id: string }>
    return rows.map((row) => row.run_id)
  }
}
