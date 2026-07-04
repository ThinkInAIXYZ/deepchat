import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import type { CronJobRunReason, CronJobRunStatus } from '@shared/cronJobs'
import { BaseTable } from './baseTable'

export interface CronJobRunRow {
  id: string
  job_id: string
  session_id: string | null
  scheduled_at: number
  queued_at: number
  started_at: number | null
  completed_at: number | null
  status: CronJobRunStatus
  reason: CronJobRunReason
  output_message_id: string | null
  output_preview: string | null
  error: string | null
  claimed_at: number | null
  claim_owner: string | null
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
        session_id TEXT,
        scheduled_at INTEGER NOT NULL,
        queued_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        reason TEXT NOT NULL CHECK(reason IN ('scheduled', 'manual')),
        output_message_id TEXT,
        output_preview TEXT,
        error TEXT,
        claimed_at INTEGER,
        claim_owner TEXT,
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
           session_id,
           scheduled_at,
           queued_at,
           started_at,
           completed_at,
           status,
           reason,
           output_message_id,
           output_preview,
           error,
           claimed_at,
           claim_owner,
           created_at,
           updated_at
         )
         VALUES (?, ?, NULL, ?, ?, NULL, NULL, 'queued', ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`
      )
      .run(id, input.jobId, input.scheduledAt, queuedAt, input.reason, now, now)

    const row = this.get(id)
    if (!row) {
      throw new Error(`Failed to queue cron job run: ${id}`)
    }
    return row
  }

  claimQueued(id: string, claimOwner: string, startedAt = Date.now()): CronJobRunRow | null {
    const result = this.db
      .prepare(
        `UPDATE cron_job_runs
         SET status = 'running',
             started_at = ?,
             claimed_at = ?,
             claim_owner = ?,
             updated_at = ?
         WHERE id = ?
           AND status = 'queued'`
      )
      .run(startedAt, startedAt, claimOwner, startedAt, id)
    return result.changes === 0 ? null : this.requireRun(id)
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

  updateSession(id: string, sessionId: string, updatedAt = Date.now()): CronJobRunRow {
    const result = this.db
      .prepare(
        `UPDATE cron_job_runs
         SET session_id = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(sessionId, updatedAt, id)
    if (result.changes === 0) {
      throw new Error(`Unknown cron job run: ${id}`)
    }
    return this.requireRun(id)
  }

  updateOutput(
    id: string,
    input: {
      outputMessageId?: string | null
      outputPreview?: string | null
      updatedAt?: number
    }
  ): CronJobRunRow {
    const updatedAt = input.updatedAt ?? Date.now()
    const result = this.db
      .prepare(
        `UPDATE cron_job_runs
         SET output_message_id = COALESCE(?, output_message_id),
             output_preview = COALESCE(?, output_preview),
             updated_at = ?
         WHERE id = ?`
      )
      .run(input.outputMessageId ?? null, input.outputPreview ?? null, updatedAt, id)
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

  markRunningFailed(error: string, completedAt = Date.now()): number {
    return this.db
      .prepare(
        `UPDATE cron_job_runs
         SET status = 'failed',
             completed_at = ?,
             error = ?,
             updated_at = ?
         WHERE status = 'running'`
      )
      .run(completedAt, error, completedAt).changes
  }

  markCancelled(id: string, error: string | null = null, completedAt = Date.now()): CronJobRunRow {
    const result = this.db
      .prepare(
        `UPDATE cron_job_runs
         SET status = 'cancelled',
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

  releaseQueued(id: string, updatedAt = Date.now()): CronJobRunRow {
    const result = this.db
      .prepare(
        `UPDATE cron_job_runs
         SET status = 'queued',
             started_at = NULL,
             claimed_at = NULL,
             claim_owner = NULL,
             updated_at = ?
         WHERE id = ?
           AND status = 'running'`
      )
      .run(updatedAt, id)
    if (result.changes === 0) {
      throw new Error(`Unknown running cron job run: ${id}`)
    }
    return this.requireRun(id)
  }

  countActiveByJob(jobId: string, excludeRunId?: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM cron_job_runs
         WHERE job_id = ?
           AND status = 'running'
           AND (? IS NULL OR id != ?)`
      )
      .get(jobId, excludeRunId ?? null, excludeRunId ?? null) as { count: number }
    return row.count
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
