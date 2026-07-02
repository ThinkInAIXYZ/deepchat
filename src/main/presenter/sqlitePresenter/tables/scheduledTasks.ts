import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export const SCHEDULED_TASKS_SCHEMA_VERSION = 38
export const SCHEDULED_TASKS_AGENT_RUN_SCHEMA_VERSION = 39

export interface ScheduledTaskRow {
  id: string
  version: number
  name: string
  enabled: number
  trigger_json: string
  action_json: string
  context_json: string | null
  execution_json: string | null
  delivery_json: string | null
  timezone: string
  next_run_at: number | null
  last_run_id: string | null
  last_fired_at: number | null
  created_at: number
  updated_at: number
}

export class ScheduledTasksTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'scheduled_tasks')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        trigger_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        context_json TEXT,
        execution_json TEXT,
        delivery_json TEXT,
        timezone TEXT NOT NULL,
        next_run_at INTEGER,
        last_run_id TEXT,
        last_fired_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled_next_run
        ON scheduled_tasks(enabled, next_run_at);
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === SCHEDULED_TASKS_SCHEMA_VERSION) {
      return this.getCreateTableSQL()
    }

    if (version === SCHEDULED_TASKS_AGENT_RUN_SCHEMA_VERSION) {
      return `
        ALTER TABLE scheduled_tasks ADD COLUMN context_json TEXT;
        ALTER TABLE scheduled_tasks ADD COLUMN execution_json TEXT;
        ALTER TABLE scheduled_tasks ADD COLUMN delivery_json TEXT;
      `
    }

    return null
  }

  getLatestVersion(): number {
    return SCHEDULED_TASKS_AGENT_RUN_SCHEMA_VERSION
  }
}
