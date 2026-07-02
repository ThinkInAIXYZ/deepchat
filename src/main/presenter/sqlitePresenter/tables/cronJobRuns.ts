import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import type { CronJobRunReason, CronJobRunStatus } from '@shared/cronJobs'
import { BaseTable } from './baseTable'

export interface CronJobRunRow {
  id: string
  job_id: string
  scheduled_at: number
  queued_at: number
  started_at: number | null
  completed_at: number | null
  status: CronJobRunStatus
  reason: CronJobRunReason
  error: string | null
  created_at: number
  updated_at: number
}

export interface CronJobRunInsertInput {
  id?: string
  jobId: string
  scheduledAt: number
  queuedAt?: number
  reason: CronJobRunReason
  now?: number
}

const CRON_JOB_RUNS_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_cron_job_runs_job_created
    ON cron_job_runs(job_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_cron_job_runs_status_queued
    ON cron_job_runs(status, queued_at ASC, id ASC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_job_runs_scheduled_dedupe
    ON cron_job_runs(job_id, scheduled_at)
    WHERE reason = 'scheduled';
`

export class CronJobRunsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'cron_job_runs')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS cron_job_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL,
        queued_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        reason TEXT NOT NULL CHECK(reason IN ('scheduled', 'manual')),
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      ${CRON_JOB_RUNS_INDEX_SQL}
    `
  }

  override createTable(): void {
    super.createTable()
    this.db.exec(CRON_JOB_RUNS_INDEX_SQL)
  }

  getMigrationSQL(): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  get(id: string): CronJobRunRow | undefined {
    return this.db.prepare('SELECT * FROM cron_job_runs WHERE id = ?').get(id) as
      | CronJobRunRow
      | undefined
  }

  insertQueued(input: CronJobRunInsertInput): CronJobRunRow {
    const now = input.now ?? Date.now()
    const id = input.id ?? randomUUID()
    const queuedAt = input.queuedAt ?? now

    this.db
      .prepare(
        `INSERT INTO cron_job_runs (
           id,
           job_id,
           scheduled_at,
           queued_at,
           started_at,
           completed_at,
           status,
           reason,
           error,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, NULL, NULL, 'queued', ?, NULL, ?, ?)`
      )
      .run(id, input.jobId, input.scheduledAt, queuedAt, input.reason, now, now)

    const row = this.get(id)
    if (!row) {
      throw new Error(`Failed to queue cron job run: ${id}`)
    }
    return row
  }

  markRunning(id: string, startedAt = Date.now()): CronJobRunRow {
    const result = this.db
      .prepare(
        `UPDATE cron_job_runs
         SET status = 'running',
             started_at = COALESCE(started_at, ?),
             updated_at = ?
         WHERE id = ?`
      )
      .run(startedAt, startedAt, id)
    if (result.changes === 0) {
      throw new Error(`Unknown cron job run: ${id}`)
    }
    return this.requireRun(id)
  }

  markCompleted(id: string, completedAt = Date.now()): CronJobRunRow {
    const result = this.db
      .prepare(
        `UPDATE cron_job_runs
         SET status = 'completed',
             completed_at = ?,
             error = NULL,
             updated_at = ?
         WHERE id = ?`
      )
      .run(completedAt, completedAt, id)
    if (result.changes === 0) {
      throw new Error(`Unknown cron job run: ${id}`)
    }
    return this.requireRun(id)
  }

  markFailed(id: string, error: string, completedAt = Date.now()): CronJobRunRow {
    const result = this.db
      .prepare(
        `UPDATE cron_job_runs
         SET status = 'failed',
             completed_at = ?,
             error = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(completedAt, error, completedAt, id)
    if (result.changes === 0) {
      throw new Error(`Unknown cron job run: ${id}`)
    }
    return this.requireRun(id)
  }

  listByJob(jobId: string, limit = 50): CronJobRunRow[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200)
    return this.db
      .prepare(
        `SELECT *
         FROM cron_job_runs
         WHERE job_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(jobId, safeLimit) as CronJobRunRow[]
  }

  deleteByJob(jobId: string): number {
    return this.db.prepare('DELETE FROM cron_job_runs WHERE job_id = ?').run(jobId).changes
  }

  private requireRun(id: string): CronJobRunRow {
    const row = this.get(id)
    if (!row) {
      throw new Error(`Failed to reload cron job run: ${id}`)
    }
    return row
  }
}
