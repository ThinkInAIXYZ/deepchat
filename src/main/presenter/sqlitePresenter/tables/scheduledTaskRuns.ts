import Database from 'better-sqlite3-multiple-ciphers'
import { SCHEDULED_TASKS_SCHEMA_VERSION } from './scheduledTasks'
import { BaseTable } from './baseTable'

export interface ScheduledTaskRunRow {
  id: string
  task_id: string
  scheduled_at: number
  queued_at: number
  started_at: number | null
  completed_at: number | null
  status: string
  reason: string
  session_id: string | null
  tape_id: string | null
  output_message_id: string | null
  error: string | null
  output_preview: string | null
  owner: string | null
  created_at: number
  updated_at: number
}

export class ScheduledTaskRunsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'scheduled_task_runs')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS scheduled_task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL,
        queued_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        session_id TEXT,
        tape_id TEXT,
        output_message_id TEXT,
        error TEXT,
        output_preview TEXT,
        owner TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task_id_created
        ON scheduled_task_runs(task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_status
        ON scheduled_task_runs(status);
    `
  }

  getMigrationSQL(version: number): string | null {
    return version === SCHEDULED_TASKS_SCHEMA_VERSION ? this.getCreateTableSQL() : null
  }

  getLatestVersion(): number {
    return SCHEDULED_TASKS_SCHEMA_VERSION
  }
}
