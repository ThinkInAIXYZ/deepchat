import Database from 'better-sqlite3-multiple-ciphers'
import { SCHEDULED_TASKS_SCHEMA_VERSION } from './scheduledTasks'
import { BaseTable } from './baseTable'

export class ScheduledTaskLocksTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'scheduled_task_locks')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS scheduled_task_locks (
        task_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        locked_at INTEGER NOT NULL,
        owner TEXT NOT NULL
      );
    `
  }

  getMigrationSQL(version: number): string | null {
    return version === SCHEDULED_TASKS_SCHEMA_VERSION ? this.getCreateTableSQL() : null
  }

  getLatestVersion(): number {
    return SCHEDULED_TASKS_SCHEMA_VERSION
  }
}
