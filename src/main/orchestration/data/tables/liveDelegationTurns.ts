import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { LiveDelegationTurnStatus } from '@shared/orchestration/liveDelegation'
import { LIVE_DELEGATION_DATABASE_SCHEMA_VERSION } from './liveDelegations'

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
  created_at: number
  started_at: number | null
  updated_at: number
  completed_at: number | null
}

const LIVE_DELEGATION_TURNS_SCHEMA_SQL = `
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
    super.createTable()
    this.db.exec(LIVE_DELEGATION_TURNS_TRIGGER_SQL)
  }

  getMigrationSQL(version: number): string | null {
    return version === LIVE_DELEGATION_DATABASE_SCHEMA_VERSION
      ? LIVE_DELEGATION_TURNS_SCHEMA_SQL
      : null
  }

  getLatestVersion(): number {
    return LIVE_DELEGATION_DATABASE_SCHEMA_VERSION
  }

  finalizeMigration(version: number): void {
    if (version === LIVE_DELEGATION_DATABASE_SCHEMA_VERSION) {
      this.db.exec(LIVE_DELEGATION_TURNS_TRIGGER_SQL)
    }
  }

  get(id: string): LiveDelegationTurnRow | undefined {
    return this.db.prepare('SELECT * FROM live_delegation_turns WHERE turn_id = ?').get(id) as
      | LiveDelegationTurnRow
      | undefined
  }
}
