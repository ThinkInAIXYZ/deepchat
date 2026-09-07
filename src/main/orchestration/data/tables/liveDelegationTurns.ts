import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import {
  LIVE_DELEGATION_MAX_EFFECT_EVIDENCE_BYTES,
  LIVE_DELEGATION_MAX_RESULT_REF_BYTES,
  type LiveDelegationTurnStatus
} from '@shared/orchestration/liveDelegation'
import type { OrchestrationEffectState } from '@shared/orchestration/toolEffect'
import {
  MAX_TASK_CONTRACT_BYTES,
  MAX_TASK_CONTRACT_REF_BYTES,
  MAX_TASK_EVALUATION_BYTES,
  MAX_TASK_EVALUATION_REF_BYTES
} from '@shared/types/task-contract'
import {
  LIVE_DELEGATION_CONTRACT_DATABASE_SCHEMA_VERSION,
  LIVE_DELEGATION_DATABASE_SCHEMA_VERSION,
  LIVE_DELEGATION_EFFECT_DATABASE_SCHEMA_VERSION,
  LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION
} from './liveDelegations'

export interface LiveDelegationTurnRow {
  turn_id: string
  delegation_id: string
  seq: number
  kind: 'initial' | 'follow_up'
  prompt: string
  status: LiveDelegationTurnStatus
  result_summary: string | null
  error: string | null
  tape_receipt_json: string | null
  result_ref_json: string | null
  task_contract_json: string | null
  task_contract_ref_json: string | null
  inherited_task_contract_ref_json: string | null
  evaluation_json: string | null
  evaluation_ref_json: string | null
  effect_state: OrchestrationEffectState
  effect_evidence_json: string | null
  created_at: number
  started_at: number | null
  updated_at: number
  completed_at: number | null
}

const LIVE_DELEGATION_TURN_EFFECT_COLUMNS_SQL = `
    effect_state TEXT NOT NULL DEFAULT 'none' CHECK (
      effect_state IN ('none', 'read', 'unknown', 'write')
    ),
    effect_evidence_json TEXT CHECK (
      (effect_state = 'none' AND effect_evidence_json IS NULL)
      OR (
        effect_state != 'none'
        AND json_valid(effect_evidence_json)
        AND json_type(effect_evidence_json) = 'object'
        AND length(CAST(effect_evidence_json AS BLOB)) <= ${LIVE_DELEGATION_MAX_EFFECT_EVIDENCE_BYTES}
      )
    ),
`

const LIVE_DELEGATION_TURN_RESULT_REF_COLUMN_SQL = `
    result_ref_json TEXT CHECK (
      result_ref_json IS NULL
      OR (
        json_valid(result_ref_json)
        AND json_type(result_ref_json) = 'object'
        AND length(CAST(result_ref_json AS BLOB)) <= ${LIVE_DELEGATION_MAX_RESULT_REF_BYTES}
      )
    ),
`

const LIVE_DELEGATION_TURN_CONTRACT_COLUMNS_SQL = `
    task_contract_json TEXT CHECK (
      task_contract_json IS NULL
      OR (
        json_valid(task_contract_json)
        AND json_type(task_contract_json) = 'object'
        AND length(CAST(task_contract_json AS BLOB)) <= ${MAX_TASK_CONTRACT_BYTES}
      )
    ),
    task_contract_ref_json TEXT CHECK (
      (task_contract_json IS NULL) = (task_contract_ref_json IS NULL)
      AND (
        task_contract_ref_json IS NULL
        OR (
          json_valid(task_contract_ref_json)
          AND json_type(task_contract_ref_json) = 'object'
          AND length(CAST(task_contract_ref_json AS BLOB)) <= ${MAX_TASK_CONTRACT_REF_BYTES}
        )
      )
    ),
    inherited_task_contract_ref_json TEXT CHECK (
      inherited_task_contract_ref_json IS NULL
      OR (
        task_contract_json IS NOT NULL
        AND json_valid(inherited_task_contract_ref_json)
        AND json_type(inherited_task_contract_ref_json) = 'object'
        AND length(CAST(inherited_task_contract_ref_json AS BLOB)) <= ${MAX_TASK_CONTRACT_REF_BYTES}
      )
    ),
    evaluation_json TEXT CHECK (
      evaluation_json IS NULL
      OR (
        task_contract_json IS NOT NULL
        AND json_valid(evaluation_json)
        AND json_type(evaluation_json) = 'object'
        AND length(CAST(evaluation_json AS BLOB)) <= ${MAX_TASK_EVALUATION_BYTES}
      )
    ),
    evaluation_ref_json TEXT CHECK (
      (evaluation_json IS NULL) = (evaluation_ref_json IS NULL)
      AND (
        evaluation_ref_json IS NULL
        OR (
          json_valid(evaluation_ref_json)
          AND json_type(evaluation_ref_json) = 'object'
          AND length(CAST(evaluation_ref_json AS BLOB)) <= ${MAX_TASK_EVALUATION_REF_BYTES}
        )
      )
    ),
`

const createLiveDelegationTurnsSchemaSql = (
  includeEffectEvidence: boolean,
  includeResultRef: boolean,
  includeContractProjection: boolean
): string => `
  CREATE TABLE IF NOT EXISTS live_delegation_turns (
    turn_id TEXT PRIMARY KEY CHECK (length(turn_id) BETWEEN 1 AND 256),
    delegation_id TEXT NOT NULL CHECK (length(delegation_id) BETWEEN 1 AND 256),
    seq INTEGER NOT NULL CHECK (seq > 0),
    kind TEXT NOT NULL CHECK (kind IN ('initial', 'follow_up')),
    prompt TEXT NOT NULL CHECK (
      length(CAST(prompt AS BLOB)) BETWEEN 1 AND 65536
      AND instr(prompt, char(0)) = 0
    ),
    status TEXT NOT NULL CHECK (
      status IN (
        'queued', 'running', 'waiting_permission', 'waiting_question', 'completed', 'failed',
        'cancelled', 'interrupted'
      )
    ),
    result_summary TEXT CHECK (
      result_summary IS NULL OR length(CAST(result_summary AS BLOB)) <= 16384
    ),
    error TEXT CHECK (error IS NULL OR length(CAST(error AS BLOB)) <= 16384),
    tape_receipt_json TEXT CHECK (
      tape_receipt_json IS NULL
      OR (json_valid(tape_receipt_json) AND json_type(tape_receipt_json) = 'object')
    ),
${includeResultRef ? LIVE_DELEGATION_TURN_RESULT_REF_COLUMN_SQL : ''}
${includeEffectEvidence ? LIVE_DELEGATION_TURN_EFFECT_COLUMNS_SQL : ''}
${includeContractProjection ? LIVE_DELEGATION_TURN_CONTRACT_COLUMNS_SQL : ''}
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    started_at INTEGER CHECK (started_at IS NULL OR started_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
    completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= 0),
    UNIQUE (delegation_id, seq),
    FOREIGN KEY (delegation_id) REFERENCES live_delegations(delegation_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_live_delegation_turns_delegation_seq
    ON live_delegation_turns(delegation_id, seq DESC);
  CREATE INDEX IF NOT EXISTS idx_live_delegation_turns_active
    ON live_delegation_turns(status, updated_at ASC, turn_id ASC)
    WHERE status IN ('queued', 'running', 'waiting_permission', 'waiting_question');
`

const LIVE_DELEGATION_TURNS_SCHEMA_SQL = createLiveDelegationTurnsSchemaSql(true, true, true)
const LIVE_DELEGATION_TURNS_V62_SCHEMA_SQL = createLiveDelegationTurnsSchemaSql(true, true, false)
const LIVE_DELEGATION_TURNS_V61_SCHEMA_SQL = createLiveDelegationTurnsSchemaSql(true, false, false)
const LIVE_DELEGATION_TURNS_V60_SCHEMA_SQL = createLiveDelegationTurnsSchemaSql(false, false, false)

const LIVE_DELEGATION_TURN_EFFECT_STATE_ADD_COLUMN_SQL = `
  ALTER TABLE live_delegation_turns
    ADD COLUMN effect_state TEXT NOT NULL DEFAULT 'none'
      CHECK (effect_state IN ('none', 'read', 'unknown', 'write'));
`

const LIVE_DELEGATION_TURN_EFFECT_EVIDENCE_ADD_COLUMN_SQL = `
  ALTER TABLE live_delegation_turns
    ADD COLUMN effect_evidence_json TEXT CHECK (
      (effect_state = 'none' AND effect_evidence_json IS NULL)
      OR (
        effect_state != 'none'
        AND json_valid(effect_evidence_json)
        AND json_type(effect_evidence_json) = 'object'
        AND length(CAST(effect_evidence_json AS BLOB)) <= ${LIVE_DELEGATION_MAX_EFFECT_EVIDENCE_BYTES}
      )
    );
`

export const LIVE_DELEGATION_TURN_RESULT_REF_ADD_COLUMN_SQL = `
  ALTER TABLE live_delegation_turns
    ADD COLUMN result_ref_json TEXT CHECK (
      result_ref_json IS NULL
      OR (
        json_valid(result_ref_json)
        AND json_type(result_ref_json) = 'object'
        AND length(CAST(result_ref_json AS BLOB)) <= ${LIVE_DELEGATION_MAX_RESULT_REF_BYTES}
      )
    )
`

export const LIVE_DELEGATION_TURN_CONTRACT_ADD_COLUMN_SQL = `
  ALTER TABLE live_delegation_turns
    ADD COLUMN task_contract_json TEXT CHECK (
      task_contract_json IS NULL
      OR (
        json_valid(task_contract_json)
        AND json_type(task_contract_json) = 'object'
        AND length(CAST(task_contract_json AS BLOB)) <= ${MAX_TASK_CONTRACT_BYTES}
      )
    )
`

export const LIVE_DELEGATION_TURN_CONTRACT_REF_ADD_COLUMN_SQL = `
  ALTER TABLE live_delegation_turns
    ADD COLUMN task_contract_ref_json TEXT CHECK (
      (task_contract_json IS NULL) = (task_contract_ref_json IS NULL)
      AND (
        task_contract_ref_json IS NULL
        OR (
          json_valid(task_contract_ref_json)
          AND json_type(task_contract_ref_json) = 'object'
          AND length(CAST(task_contract_ref_json AS BLOB)) <= ${MAX_TASK_CONTRACT_REF_BYTES}
        )
      )
    )
`

export const LIVE_DELEGATION_TURN_INHERITED_CONTRACT_REF_ADD_COLUMN_SQL = `
  ALTER TABLE live_delegation_turns
    ADD COLUMN inherited_task_contract_ref_json TEXT CHECK (
      inherited_task_contract_ref_json IS NULL
      OR (
        task_contract_json IS NOT NULL
        AND json_valid(inherited_task_contract_ref_json)
        AND json_type(inherited_task_contract_ref_json) = 'object'
        AND length(CAST(inherited_task_contract_ref_json AS BLOB)) <= ${MAX_TASK_CONTRACT_REF_BYTES}
      )
    )
`

export const LIVE_DELEGATION_TURN_EVALUATION_ADD_COLUMN_SQL = `
  ALTER TABLE live_delegation_turns
    ADD COLUMN evaluation_json TEXT CHECK (
      evaluation_json IS NULL
      OR (
        task_contract_json IS NOT NULL
        AND json_valid(evaluation_json)
        AND json_type(evaluation_json) = 'object'
        AND length(CAST(evaluation_json AS BLOB)) <= ${MAX_TASK_EVALUATION_BYTES}
      )
    )
`

export const LIVE_DELEGATION_TURN_EVALUATION_REF_ADD_COLUMN_SQL = `
  ALTER TABLE live_delegation_turns
    ADD COLUMN evaluation_ref_json TEXT CHECK (
      (evaluation_json IS NULL) = (evaluation_ref_json IS NULL)
      AND (
        evaluation_ref_json IS NULL
        OR (
          json_valid(evaluation_ref_json)
          AND json_type(evaluation_ref_json) = 'object'
          AND length(CAST(evaluation_ref_json AS BLOB)) <= ${MAX_TASK_EVALUATION_REF_BYTES}
        )
      )
    )
`

const LIVE_DELEGATION_TURNS_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS trg_live_delegation_turns_parent_insert
  BEFORE INSERT ON live_delegation_turns
  WHEN NOT EXISTS (
    SELECT 1 FROM live_delegations WHERE delegation_id = NEW.delegation_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'live delegation turn parent does not exist');
  END;
`

export class LiveDelegationTurnsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'live_delegation_turns')
  }

  getCreateTableSQL(): string {
    return `${LIVE_DELEGATION_TURNS_SCHEMA_SQL}\n${LIVE_DELEGATION_TURNS_TRIGGER_SQL}`
  }

  override createTable(): void {
    if (!this.tableExists()) {
      const recordedVersion = this.getRecordedSchemaVersion()
      const schemaSql =
        recordedVersion > 0 && recordedVersion < LIVE_DELEGATION_EFFECT_DATABASE_SCHEMA_VERSION
          ? LIVE_DELEGATION_TURNS_V60_SCHEMA_SQL
          : recordedVersion > 0 && recordedVersion < LIVE_DELEGATION_DATABASE_SCHEMA_VERSION
            ? LIVE_DELEGATION_TURNS_V61_SCHEMA_SQL
            : recordedVersion > 0 &&
                recordedVersion < LIVE_DELEGATION_CONTRACT_DATABASE_SCHEMA_VERSION
              ? LIVE_DELEGATION_TURNS_V62_SCHEMA_SQL
              : LIVE_DELEGATION_TURNS_SCHEMA_SQL
      this.db.exec(schemaSql)
    }
    this.db.exec(LIVE_DELEGATION_TURNS_TRIGGER_SQL)
  }

  getMigrationSQL(version: number): string | null {
    if (version === LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION) {
      return LIVE_DELEGATION_TURNS_V60_SCHEMA_SQL
    }
    if (version === LIVE_DELEGATION_EFFECT_DATABASE_SCHEMA_VERSION) {
      const statements = [
        ...(this.hasColumn('effect_state')
          ? []
          : [LIVE_DELEGATION_TURN_EFFECT_STATE_ADD_COLUMN_SQL]),
        ...(this.hasColumn('effect_evidence_json')
          ? []
          : [LIVE_DELEGATION_TURN_EFFECT_EVIDENCE_ADD_COLUMN_SQL])
      ]
      return statements.length > 0
        ? statements.join('\n')
        : 'SELECT 1 /* live delegation effect schema already present */;'
    }
    if (version === LIVE_DELEGATION_DATABASE_SCHEMA_VERSION) {
      return this.hasColumn('result_ref_json')
        ? 'SELECT 1 /* live delegation result reference already present */;'
        : `${LIVE_DELEGATION_TURN_RESULT_REF_ADD_COLUMN_SQL};`
    }
    if (version === LIVE_DELEGATION_CONTRACT_DATABASE_SCHEMA_VERSION) {
      const statements = [
        ...(this.hasColumn('task_contract_json')
          ? []
          : [LIVE_DELEGATION_TURN_CONTRACT_ADD_COLUMN_SQL]),
        ...(this.hasColumn('task_contract_ref_json')
          ? []
          : [LIVE_DELEGATION_TURN_CONTRACT_REF_ADD_COLUMN_SQL]),
        ...(this.hasColumn('inherited_task_contract_ref_json')
          ? []
          : [LIVE_DELEGATION_TURN_INHERITED_CONTRACT_REF_ADD_COLUMN_SQL]),
        ...(this.hasColumn('evaluation_json')
          ? []
          : [LIVE_DELEGATION_TURN_EVALUATION_ADD_COLUMN_SQL]),
        ...(this.hasColumn('evaluation_ref_json')
          ? []
          : [LIVE_DELEGATION_TURN_EVALUATION_REF_ADD_COLUMN_SQL])
      ]
      return statements.length > 0
        ? statements.map((statement) => `${statement.trimEnd()};`).join('\n')
        : 'SELECT 1 /* live delegation contract schema already present */;'
    }
    return null
  }

  getLatestVersion(): number {
    return LIVE_DELEGATION_CONTRACT_DATABASE_SCHEMA_VERSION
  }

  finalizeMigration(version: number): void {
    if (version === LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION) {
      this.db.exec(LIVE_DELEGATION_TURNS_TRIGGER_SQL)
    }
  }

  get(id: string): LiveDelegationTurnRow | undefined {
    return this.db.prepare('SELECT * FROM live_delegation_turns WHERE turn_id = ?').get(id) as
      | LiveDelegationTurnRow
      | undefined
  }
}
