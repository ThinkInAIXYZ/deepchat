import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import type {
  CronJobDeliveryStatus,
  CronJobDeliveryTarget,
  CronJobDeliveryTargetType
} from '@shared/cronJobs'
import { BaseTable } from './baseTable'

export interface CronJobDeliveryRow {
  id: string
  job_id: string
  run_id: string
  target_type: CronJobDeliveryTargetType
  target_json: string
  status: CronJobDeliveryStatus
  remote_message_id: string | null
  error: string | null
  created_at: number
  updated_at: number
}

export interface CronJobDeliveryInsertInput {
  id?: string
  jobId: string
  runId: string
  target: CronJobDeliveryTarget
  status: CronJobDeliveryStatus
  remoteMessageId?: string | null
  error?: string | null
  now?: number
}

const CRON_JOB_DELIVERIES_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_cron_job_deliveries_run
    ON cron_job_deliveries(run_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_cron_job_deliveries_remote_message
    ON cron_job_deliveries(remote_message_id);
`

export class CronJobDeliveriesTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'cron_job_deliveries')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS cron_job_deliveries (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('remote')),
        target_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
        remote_message_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      ${CRON_JOB_DELIVERIES_INDEX_SQL}
    `
  }

  override createTable(): void {
    super.createTable()
    this.db.exec(CRON_JOB_DELIVERIES_INDEX_SQL)
  }

  getMigrationSQL(): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  insert(input: CronJobDeliveryInsertInput): CronJobDeliveryRow {
    const now = input.now ?? Date.now()
    const id = input.id ?? randomUUID()

    this.db
      .prepare(
        `INSERT INTO cron_job_deliveries (
           id,
           job_id,
           run_id,
           target_type,
           target_json,
           status,
           remote_message_id,
           error,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.jobId,
        input.runId,
        input.target.type,
        JSON.stringify(input.target),
        input.status,
        input.remoteMessageId ?? null,
        input.error ?? null,
        now,
        now
      )

    return this.requireDelivery(id)
  }

  listByRun(runId: string): CronJobDeliveryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM cron_job_deliveries
         WHERE run_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(runId) as CronJobDeliveryRow[]
  }

  findByRemoteMessageId(remoteMessageId: string): CronJobDeliveryRow | undefined {
    return this.db
      .prepare(
        `SELECT *
         FROM cron_job_deliveries
         WHERE remote_message_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(remoteMessageId) as CronJobDeliveryRow | undefined
  }

  deleteByJob(jobId: string): number {
    return this.db.prepare('DELETE FROM cron_job_deliveries WHERE job_id = ?').run(jobId).changes
  }

  private requireDelivery(id: string): CronJobDeliveryRow {
    const row = this.db.prepare('SELECT * FROM cron_job_deliveries WHERE id = ?').get(id) as
      | CronJobDeliveryRow
      | undefined
    if (!row) {
      throw new Error(`Failed to reload cron job delivery: ${id}`)
    }
    return row
  }
}
