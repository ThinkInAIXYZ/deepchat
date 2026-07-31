import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import {
  WORKFLOW_STORED_EVIDENCE_MAX_BYTES,
  WORKFLOW_STORED_JSON_MAX_BYTES,
  WORKFLOW_STORED_METADATA_MAX_BYTES,
  type WorkflowEffectState,
  type WorkflowInvocationStatus
} from '@shared/workflow/domain'
import { WORKFLOW_SCHEMA_VERSION } from './workflowRuns'

export interface WorkflowInvocationRow {
  invocation_id: string
  run_id: string
  seq: number
  call_path: string
  attempt: number
  execution_epoch: number
  request_json: string
  input_hash: string
  policy_hash: string
  child_correlation_slot: string
  child_session_id: string | null
  status: WorkflowInvocationStatus
  timeout_deadline_at: number | null
  result_json: string | null
  error_json: string | null
  effect_state: WorkflowEffectState
  effect_evidence_json: string | null
  usage_json: string | null
  tape_link_receipt_json: string | null
  invalidated_at: number | null
  invalidation_reason: string | null
  created_at: number
  started_at: number | null
  updated_at: number
  completed_at: number | null
}

const WORKFLOW_INVOCATIONS_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_invocations_run_seq
    ON workflow_invocations(run_id, seq);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_invocations_run_path_attempt
    ON workflow_invocations(run_id, call_path, attempt);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_invocations_run_epoch_path
    ON workflow_invocations(run_id, execution_epoch, call_path);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_invocations_correlation
    ON workflow_invocations(run_id, child_correlation_slot);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_invocations_child
    ON workflow_invocations(child_session_id)
    WHERE child_session_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_workflow_invocations_status
    ON workflow_invocations(run_id, status, updated_at ASC);
`

const WORKFLOW_INVOCATIONS_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS trg_workflow_invocations_run_insert
  BEFORE INSERT ON workflow_invocations
  WHEN NOT EXISTS (
    SELECT 1 FROM workflow_runs WHERE run_id = NEW.run_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'workflow run does not exist');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_workflow_invocations_child_insert
  BEFORE INSERT ON workflow_invocations
  WHEN NEW.child_session_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM new_sessions WHERE id = NEW.child_session_id
    )
  BEGIN
    SELECT RAISE(ABORT, 'workflow child session does not exist');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_workflow_invocations_child_update
  BEFORE UPDATE OF child_session_id ON workflow_invocations
  WHEN NEW.child_session_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM new_sessions WHERE id = NEW.child_session_id
    )
  BEGIN
    SELECT RAISE(ABORT, 'workflow child session does not exist');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_workflow_invocations_immutable_identity
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

  CREATE TRIGGER IF NOT EXISTS trg_workflow_runs_delete_invocations
  AFTER DELETE ON workflow_runs
  BEGIN
    DELETE FROM workflow_invocations WHERE run_id = OLD.run_id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_workflow_sessions_delete_references
  AFTER DELETE ON new_sessions
  BEGIN
    DELETE FROM workflow_runs WHERE parent_session_id = OLD.id;
  END;
`

export class WorkflowInvocationsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'workflow_invocations')
  }

  getCreateTableSQL(): string {
    // child_session_id is a durable audit identity, not a cascading ownership edge.
    // Deleting a child must not invalidate its result or parent Tape receipt.
    return `
      CREATE TABLE IF NOT EXISTS workflow_invocations (
        invocation_id TEXT PRIMARY KEY CHECK (length(invocation_id) BETWEEN 1 AND 256),
        run_id TEXT NOT NULL CHECK (length(run_id) BETWEEN 1 AND 256),
        seq INTEGER NOT NULL CHECK (typeof(seq) = 'integer' AND seq > 0),
        call_path TEXT NOT NULL CHECK (length(call_path) BETWEEN 1 AND 2048),
        attempt INTEGER NOT NULL CHECK (typeof(attempt) = 'integer' AND attempt > 0),
        execution_epoch INTEGER NOT NULL CHECK (
          typeof(execution_epoch) = 'integer' AND execution_epoch > 0
        ),
        request_json TEXT NOT NULL CHECK (
          json_valid(request_json)
          AND json_type(request_json) = 'object'
          AND length(CAST(request_json AS BLOB)) <= ${WORKFLOW_STORED_JSON_MAX_BYTES}
        ),
        input_hash TEXT NOT NULL CHECK (
          length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'
        ),
        policy_hash TEXT NOT NULL CHECK (
          length(policy_hash) = 64 AND policy_hash NOT GLOB '*[^0-9a-f]*'
        ),
        child_correlation_slot TEXT NOT NULL CHECK (
          length(child_correlation_slot) BETWEEN 1 AND 256
        ),
        child_session_id TEXT CHECK (
          child_session_id IS NULL OR length(child_session_id) BETWEEN 1 AND 256
        ),
        status TEXT NOT NULL CHECK (
          status IN (
            'queued',
            'admitted',
            'running',
            'waiting_interaction',
            'succeeded',
            'failed',
            'timed_out',
            'cancelled',
            'interrupted'
          )
        ),
        timeout_deadline_at INTEGER CHECK (
          timeout_deadline_at IS NULL
          OR (
            typeof(timeout_deadline_at) = 'integer'
            AND timeout_deadline_at >= 0
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
        effect_state TEXT NOT NULL DEFAULT 'none' CHECK (
          effect_state IN ('none', 'read', 'unknown', 'write')
        ),
        effect_evidence_json TEXT CHECK (
          effect_evidence_json IS NULL
          OR (
            json_valid(effect_evidence_json)
            AND length(CAST(effect_evidence_json AS BLOB))
              <= ${WORKFLOW_STORED_EVIDENCE_MAX_BYTES}
          )
        ),
        usage_json TEXT CHECK (
          usage_json IS NULL
          OR (
            json_valid(usage_json)
            AND length(CAST(usage_json AS BLOB)) <= ${WORKFLOW_STORED_METADATA_MAX_BYTES}
          )
        ),
        tape_link_receipt_json TEXT CHECK (
          tape_link_receipt_json IS NULL
          OR (
            json_valid(tape_link_receipt_json)
            AND length(CAST(tape_link_receipt_json AS BLOB))
              <= ${WORKFLOW_STORED_EVIDENCE_MAX_BYTES}
          )
        ),
        invalidated_at INTEGER CHECK (
          invalidated_at IS NULL
          OR (typeof(invalidated_at) = 'integer' AND invalidated_at >= 0)
        ),
        invalidation_reason TEXT CHECK (
          invalidation_reason IS NULL OR length(invalidation_reason) <= 8192
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
        CHECK (
          (
            effect_state = 'none'
            AND effect_evidence_json IS NULL
          )
          OR (
            effect_state != 'none'
            AND effect_evidence_json IS NOT NULL
            AND json_extract(effect_evidence_json, '$.classification') = effect_state
          )
        ),
        CHECK (
          status != 'succeeded'
          OR (
            child_session_id IS NOT NULL
            AND result_json IS NOT NULL
            AND tape_link_receipt_json IS NOT NULL
            AND json_extract(tape_link_receipt_json, '$.childSessionId') = child_session_id
            AND json_extract(tape_link_receipt_json, '$.outcome') = 'completed'
            AND json_extract(tape_link_receipt_json, '$.childEntryCount')
              <= json_extract(tape_link_receipt_json, '$.childHeadEntryId')
            AND completed_at IS NOT NULL
          )
        ),
        CHECK (
          (
            status IN ('succeeded', 'failed', 'timed_out', 'cancelled', 'interrupted')
            AND completed_at IS NOT NULL
          )
          OR (
            status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled', 'interrupted')
            AND completed_at IS NULL
          )
        ),
        CHECK (
          (
            status IN ('failed', 'timed_out', 'cancelled', 'interrupted')
            AND error_json IS NOT NULL
          )
          OR (
            status NOT IN ('failed', 'timed_out', 'cancelled', 'interrupted')
            AND error_json IS NULL
          )
        ),
        FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE
      );
      ${WORKFLOW_INVOCATIONS_INDEX_SQL}
    `
  }

  override createTable(): void {
    super.createTable()
    this.db.exec(WORKFLOW_INVOCATIONS_INDEX_SQL)
    this.db.exec(WORKFLOW_INVOCATIONS_TRIGGER_SQL)
  }

  getMigrationSQL(version: number): string | null {
    return version === WORKFLOW_SCHEMA_VERSION ? this.getCreateTableSQL() : null
  }

  getLatestVersion(): number {
    return WORKFLOW_SCHEMA_VERSION
  }

  override finalizeMigration(version: number): void {
    if (version === WORKFLOW_SCHEMA_VERSION) {
      this.db.exec(WORKFLOW_INVOCATIONS_TRIGGER_SQL)
    }
  }

  get(invocationId: string): WorkflowInvocationRow | undefined {
    return this.db
      .prepare('SELECT * FROM workflow_invocations WHERE invocation_id = ?')
      .get(invocationId) as WorkflowInvocationRow | undefined
  }

  getByCorrelationSlot(
    runId: string,
    childCorrelationSlot: string
  ): WorkflowInvocationRow | undefined {
    return this.db
      .prepare(
        `SELECT *
         FROM workflow_invocations
         WHERE run_id = ?
           AND child_correlation_slot = ?`
      )
      .get(runId, childCorrelationSlot) as WorkflowInvocationRow | undefined
  }

  listByRun(runId: string): WorkflowInvocationRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM workflow_invocations
         WHERE run_id = ?
         ORDER BY seq ASC`
      )
      .all(runId) as WorkflowInvocationRow[]
  }
}
