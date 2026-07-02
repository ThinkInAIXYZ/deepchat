import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface CronJobRow {
  id: string
  name: string
  enabled: number
  cron_expr: string
  timezone: string
  agent_id: string | null
  next_run_at: number | null
  created_at: number
  updated_at: number
}

export interface CronJobTableUpsertInput {
  id?: string
  name: string
  enabled: boolean
  cronExpr: string
  timezone: string
  agentId?: string | null
  nextRunAt?: number | null
  now?: number
}

const CRON_JOBS_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled_next_run
    ON cron_jobs(enabled, next_run_at);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_updated_at
    ON cron_jobs(updated_at DESC, id DESC);
`

export class CronJobsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'cron_jobs')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
        cron_expr TEXT NOT NULL,
        timezone TEXT NOT NULL,
        agent_id TEXT,
        next_run_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      ${CRON_JOBS_INDEX_SQL}
    `
  }

  override createTable(): void {
    super.createTable()
    this.db.exec(CRON_JOBS_INDEX_SQL)
  }

  getMigrationSQL(): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  list(): CronJobRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM cron_jobs
         ORDER BY updated_at DESC, id DESC`
      )
      .all() as CronJobRow[]
  }

  get(id: string): CronJobRow | undefined {
    return this.db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJobRow | undefined
  }

  upsert(input: CronJobTableUpsertInput): CronJobRow {
    const now = input.now ?? Date.now()
    const existing = input.id ? this.get(input.id) : undefined
    const id = existing?.id ?? input.id ?? randomUUID()
    const createdAt = existing?.created_at ?? now
    const nextRunAt =
      input.nextRunAt === undefined ? (existing?.next_run_at ?? null) : input.nextRunAt

    this.db
      .prepare(
        `INSERT INTO cron_jobs (
           id,
           name,
           enabled,
           cron_expr,
           timezone,
           agent_id,
           next_run_at,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           enabled = excluded.enabled,
           cron_expr = excluded.cron_expr,
           timezone = excluded.timezone,
           agent_id = excluded.agent_id,
           next_run_at = excluded.next_run_at,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.name,
        input.enabled ? 1 : 0,
        input.cronExpr,
        input.timezone,
        input.agentId ?? null,
        nextRunAt,
        createdAt,
        now
      )

    const row = this.get(id)
    if (!row) {
      throw new Error(`Failed to persist cron job: ${id}`)
    }
    return row
  }

  delete(id: string): number {
    return this.db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id).changes
  }

  setEnabled(id: string, enabled: boolean, now = Date.now()): CronJobRow {
    const result = this.db
      .prepare('UPDATE cron_jobs SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, now, id)
    if (result.changes === 0) {
      throw new Error(`Unknown cron job: ${id}`)
    }

    const row = this.get(id)
    if (!row) {
      throw new Error(`Failed to reload cron job: ${id}`)
    }
    return row
  }

  updateNextRunAt(id: string, nextRunAt: number | null, now = Date.now()): CronJobRow {
    const result = this.db
      .prepare('UPDATE cron_jobs SET next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(nextRunAt, now, id)
    if (result.changes === 0) {
      throw new Error(`Unknown cron job: ${id}`)
    }

    const row = this.get(id)
    if (!row) {
      throw new Error(`Failed to reload cron job: ${id}`)
    }
    return row
  }

  countEnabled(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM cron_jobs WHERE enabled = 1')
      .get() as { count: number } | undefined
    return row?.count ?? 0
  }

  getNextEnabledRunAt(): number | null {
    const row = this.db
      .prepare(
        `SELECT MIN(next_run_at) AS next_run_at
         FROM cron_jobs
         WHERE enabled = 1
           AND next_run_at IS NOT NULL`
      )
      .get() as { next_run_at: number | null } | undefined
    return row?.next_run_at ?? null
  }
}
