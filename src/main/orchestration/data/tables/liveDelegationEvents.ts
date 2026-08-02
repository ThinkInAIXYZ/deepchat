import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type {
  LiveDelegationEventDirection,
  LiveDelegationEventKind
} from '@shared/orchestration/liveDelegation'
import {
  LIVE_DELEGATION_DATABASE_SCHEMA_VERSION,
  LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION
} from './liveDelegations'

export interface LiveDelegationEventRow {
  event_id: number
  delegation_id: string
  parent_session_id: string
  direction: LiveDelegationEventDirection
  kind: LiveDelegationEventKind
  content: string
  related_turn_id: string | null
  consumed_by_turn_id: string | null
  created_at: number
}

const LIVE_DELEGATION_EVENTS_SCHEMA_SQL = `
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
    super.createTable()
    this.db.exec(LIVE_DELEGATION_EVENTS_TRIGGER_SQL)
  }

  getMigrationSQL(version: number): string | null {
    return version === LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION
      ? LIVE_DELEGATION_EVENTS_SCHEMA_SQL
      : null
  }

  getLatestVersion(): number {
    return LIVE_DELEGATION_DATABASE_SCHEMA_VERSION
  }

  finalizeMigration(version: number): void {
    if (version === LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION) {
      this.db.exec(LIVE_DELEGATION_EVENTS_TRIGGER_SQL)
    }
  }
}
