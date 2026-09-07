import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { LiveDelegationStatus } from '@shared/orchestration/liveDelegation'

export const LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION = 60
export const LIVE_DELEGATION_EFFECT_DATABASE_SCHEMA_VERSION = 61
export const LIVE_DELEGATION_DATABASE_SCHEMA_VERSION = 62
export const ORCHESTRATION_DATABASE_SCHEMA_VERSION = 64
export const LIVE_DELEGATION_CONTRACT_DATABASE_SCHEMA_VERSION = 65
export const LIVE_DELEGATION_EVALUATION_DATABASE_SCHEMA_VERSION = 66

export interface LiveDelegationRow {
  delegation_id: string
  parent_session_id: string
  child_session_id: string | null
  slot_id: string
  target_agent_id: string
  title: string
  status: LiveDelegationStatus
  last_turn_seq: number
  last_summary: string | null
  last_error: string | null
  created_at: number
  updated_at: number
  revision: number
}

const LIVE_DELEGATIONS_BASE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS live_delegations (
    delegation_id TEXT PRIMARY KEY CHECK (length(delegation_id) BETWEEN 1 AND 256),
    parent_session_id TEXT NOT NULL CHECK (length(parent_session_id) BETWEEN 1 AND 256),
    child_session_id TEXT UNIQUE CHECK (
      child_session_id IS NULL OR length(child_session_id) BETWEEN 1 AND 256
    ),
    slot_id TEXT NOT NULL CHECK (length(slot_id) BETWEEN 1 AND 256),
    target_agent_id TEXT NOT NULL CHECK (length(target_agent_id) BETWEEN 1 AND 256),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
    status TEXT NOT NULL CHECK (
      status IN (
        'queued', 'running', 'waiting_permission', 'waiting_question', 'idle', 'failed',
        'interrupted'
      )
    ),
    last_turn_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_turn_seq >= 0),
    last_summary TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_live_delegations_parent_updated
    ON live_delegations(parent_session_id, updated_at DESC, delegation_id DESC);
  CREATE INDEX IF NOT EXISTS idx_live_delegations_status_updated
    ON live_delegations(status, updated_at ASC, delegation_id ASC);
`

const LIVE_DELEGATIONS_CORE_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS trg_live_delegations_parent_insert
  BEFORE INSERT ON live_delegations
  WHEN NOT EXISTS (SELECT 1 FROM new_sessions WHERE id = NEW.parent_session_id)
  BEGIN
    SELECT RAISE(ABORT, 'live delegation parent session does not exist');
  END;
  CREATE TRIGGER IF NOT EXISTS trg_live_delegations_child_rebind
  BEFORE UPDATE OF child_session_id ON live_delegations
  WHEN OLD.child_session_id IS NOT NULL AND NEW.child_session_id IS NOT OLD.child_session_id
  BEGIN
    SELECT RAISE(ABORT, 'live delegation child session is immutable');
  END;
`

const LIVE_DELEGATIONS_CHILD_BIND_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS trg_live_delegations_child_bind
  BEFORE UPDATE OF child_session_id ON live_delegations
  WHEN NEW.child_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM new_sessions
    WHERE id = NEW.child_session_id
      AND session_kind = 'subagent'
      AND parent_session_id = NEW.parent_session_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'live delegation child session is invalid');
  END;
`

const LIVE_DELEGATIONS_TRIGGER_SQL = `${LIVE_DELEGATIONS_CORE_TRIGGER_SQL}\n${LIVE_DELEGATIONS_CHILD_BIND_TRIGGER_SQL}`

const RETIRED_WORKFLOW_SCHEMA_SQL = `
  DROP TRIGGER IF EXISTS trg_workflow_runs_parent_insert;
  DROP TRIGGER IF EXISTS trg_workflow_runs_immutable_snapshot;
  DROP TRIGGER IF EXISTS trg_workflow_invocations_run_insert;
  DROP TRIGGER IF EXISTS trg_workflow_invocations_child_insert;
  DROP TRIGGER IF EXISTS trg_workflow_invocations_child_update;
  DROP TRIGGER IF EXISTS trg_workflow_invocations_immutable_identity;
  DROP TRIGGER IF EXISTS trg_workflow_invocations_timeout_arm;
  DROP TRIGGER IF EXISTS trg_workflow_invocations_timeout_required;
  DROP TRIGGER IF EXISTS trg_workflow_runs_delete_invocations;
  DROP TRIGGER IF EXISTS trg_workflow_sessions_delete_references;
  DROP TABLE IF EXISTS workflow_invocations;
  DROP TABLE IF EXISTS workflow_runs;
`

export class LiveDelegationsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'live_delegations')
  }

  getCreateTableSQL(): string {
    return `${LIVE_DELEGATIONS_BASE_SCHEMA_SQL}\n${LIVE_DELEGATIONS_TRIGGER_SQL}`
  }

  override createTable(): void {
    if (!this.tableExists()) {
      this.db.exec(LIVE_DELEGATIONS_BASE_SCHEMA_SQL)
    }
    this.db.exec(LIVE_DELEGATIONS_CORE_TRIGGER_SQL)
    if (this.canInstallChildBindTrigger()) {
      this.db.exec(LIVE_DELEGATIONS_CHILD_BIND_TRIGGER_SQL)
    }
  }

  getMigrationSQL(version: number): string | null {
    if (version === LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION) {
      return LIVE_DELEGATIONS_BASE_SCHEMA_SQL
    }
    if (version === ORCHESTRATION_DATABASE_SCHEMA_VERSION) {
      return RETIRED_WORKFLOW_SCHEMA_SQL
    }
    return null
  }

  finalizeMigration(version: number): void {
    if (version === LIVE_DELEGATION_INITIAL_DATABASE_SCHEMA_VERSION) {
      this.db.exec(LIVE_DELEGATIONS_TRIGGER_SQL)
    }
  }

  getLatestVersion(): number {
    return ORCHESTRATION_DATABASE_SCHEMA_VERSION
  }

  get(id: string): LiveDelegationRow | undefined {
    return this.db.prepare('SELECT * FROM live_delegations WHERE delegation_id = ?').get(id) as
      | LiveDelegationRow
      | undefined
  }

  private canInstallChildBindTrigger(): boolean {
    const columns = this.db.prepare('PRAGMA table_info(new_sessions)').all() as Array<{
      name: string
    }>
    const names = new Set(columns.map((column) => column.name))
    return names.has('session_kind') && names.has('parent_session_id')
  }
}
