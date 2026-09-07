import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type {
  LiveDelegationEventDirection,
  LiveDelegationEventKind
} from '@shared/orchestration/liveDelegation'
import {
  LIVE_DELEGATION_EVALUATION_DATABASE_SCHEMA_VERSION,
  LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION
} from './liveDelegations'
import {
  MAX_TASK_EVALUATION_BYTES,
  MAX_TASK_EVALUATION_REF_BYTES
} from '@shared/types/task-contract'

export interface LiveDelegationEventRow {
  event_id: number
  delegation_id: string
  parent_session_id: string
  direction: LiveDelegationEventDirection
  kind: LiveDelegationEventKind
  content: string
  related_turn_id: string | null
  consumed_by_turn_id: string | null
  evaluation_json: string | null
  evaluation_ref_json: string | null
  created_at: number
}

const LIVE_DELEGATION_EVENT_EVALUATION_COLUMNS_SQL = `
    evaluation_json TEXT CHECK (
      evaluation_json IS NULL
      OR (
        json_valid(evaluation_json)
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

const createLiveDelegationEventsSchemaSql = (includeEvaluation: boolean): string => `
  CREATE TABLE IF NOT EXISTS live_delegation_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegation_id TEXT NOT NULL CHECK (length(delegation_id) BETWEEN 1 AND 256),
    parent_session_id TEXT NOT NULL CHECK (length(parent_session_id) BETWEEN 1 AND 256),
    direction TEXT NOT NULL CHECK (direction IN ('parent_to_child', 'child_to_parent')),
    kind TEXT NOT NULL CHECK (
      kind IN (
        'message', 'turn_completed', 'turn_failed', 'turn_cancelled', 'turn_interrupted'
      )
    ),
    content TEXT NOT NULL CHECK (
      length(CAST(content AS BLOB)) <= 16384 AND instr(content, char(0)) = 0
    ),
    related_turn_id TEXT,
    consumed_by_turn_id TEXT,
${includeEvaluation ? LIVE_DELEGATION_EVENT_EVALUATION_COLUMNS_SQL : ''}
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    FOREIGN KEY (delegation_id) REFERENCES live_delegations(delegation_id) ON DELETE CASCADE,
    FOREIGN KEY (related_turn_id) REFERENCES live_delegation_turns(turn_id) ON DELETE SET NULL,
    FOREIGN KEY (consumed_by_turn_id) REFERENCES live_delegation_turns(turn_id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_live_delegation_events_parent_cursor
    ON live_delegation_events(parent_session_id, event_id ASC);
  CREATE INDEX IF NOT EXISTS idx_live_delegation_events_pending_messages
    ON live_delegation_events(delegation_id, event_id ASC)
    WHERE direction = 'parent_to_child' AND consumed_by_turn_id IS NULL;
`

const LIVE_DELEGATION_EVENTS_SCHEMA_SQL = createLiveDelegationEventsSchemaSql(true)
const LIVE_DELEGATION_EVENTS_V60_SCHEMA_SQL = createLiveDelegationEventsSchemaSql(false)

export const LIVE_DELEGATION_EVENT_EVALUATION_ADD_COLUMN_SQL = `
  ALTER TABLE live_delegation_events
    ADD COLUMN evaluation_json TEXT CHECK (
      evaluation_json IS NULL
      OR (
        json_valid(evaluation_json)
        AND json_type(evaluation_json) = 'object'
        AND length(CAST(evaluation_json AS BLOB)) <= ${MAX_TASK_EVALUATION_BYTES}
      )
    )
`

export const LIVE_DELEGATION_EVENT_EVALUATION_REF_ADD_COLUMN_SQL = `
  ALTER TABLE live_delegation_events
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

const LIVE_DELEGATION_EVENTS_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS trg_live_delegation_events_parent_insert
  BEFORE INSERT ON live_delegation_events
  WHEN NOT EXISTS (
    SELECT 1 FROM live_delegations
    WHERE delegation_id = NEW.delegation_id
      AND parent_session_id = NEW.parent_session_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'live delegation event parent does not match');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_live_delegations_delete_children
  AFTER DELETE ON live_delegations
  BEGIN
    DELETE FROM live_delegation_events WHERE delegation_id = OLD.delegation_id;
    DELETE FROM live_delegation_turns WHERE delegation_id = OLD.delegation_id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_live_delegation_sessions_delete_references
  AFTER DELETE ON new_sessions
  BEGIN
    DELETE FROM live_delegations WHERE parent_session_id = OLD.id;
  END;
`

export class LiveDelegationEventsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'live_delegation_events')
  }

  getCreateTableSQL(): string {
    return `${LIVE_DELEGATION_EVENTS_SCHEMA_SQL}\n${LIVE_DELEGATION_EVENTS_TRIGGER_SQL}`
  }

  override createTable(): void {
    if (!this.tableExists()) {
      const recordedVersion = this.getRecordedSchemaVersion()
      this.db.exec(
        recordedVersion > 0 && recordedVersion < LIVE_DELEGATION_EVALUATION_DATABASE_SCHEMA_VERSION
          ? LIVE_DELEGATION_EVENTS_V60_SCHEMA_SQL
          : LIVE_DELEGATION_EVENTS_SCHEMA_SQL
      )
    }
    this.db.exec(LIVE_DELEGATION_EVENTS_TRIGGER_SQL)
  }

  getMigrationSQL(version: number): string | null {
    if (version === LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION) {
      return LIVE_DELEGATION_EVENTS_V60_SCHEMA_SQL
    }
    if (version === LIVE_DELEGATION_EVALUATION_DATABASE_SCHEMA_VERSION) {
      const statements = [
        ...(this.hasColumn('evaluation_json')
          ? []
          : [LIVE_DELEGATION_EVENT_EVALUATION_ADD_COLUMN_SQL]),
        ...(this.hasColumn('evaluation_ref_json')
          ? []
          : [LIVE_DELEGATION_EVENT_EVALUATION_REF_ADD_COLUMN_SQL])
      ]
      return statements.length > 0
        ? statements.map((statement) => `${statement.trimEnd()};`).join('\n')
        : 'SELECT 1 /* live delegation event evaluation schema already present */;'
    }
    return null
  }

  getLatestVersion(): number {
    return LIVE_DELEGATION_EVALUATION_DATABASE_SCHEMA_VERSION
  }

  finalizeMigration(version: number): void {
    if (version === LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION) {
      this.db.exec(LIVE_DELEGATION_EVENTS_TRIGGER_SQL)
    }
  }
}
