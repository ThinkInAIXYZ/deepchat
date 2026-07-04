import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import {
  CRON_JOBS_DEFAULT_DELIVERY,
  CRON_JOBS_DEFAULT_MISFIRE_POLICY,
  CRON_JOBS_DEFAULT_RUNTIME,
  type CronJobAgentSnapshot,
  type CronJobDelivery,
  type CronJobModelPolicy,
  type CronJobMisfirePolicy,
  type CronJobOutputMode,
  type CronJobRuntimePolicy,
  type CronJobRuntimeSettings,
  type CronJobStatus
} from '@shared/cronJobs'
import { BaseTable } from './baseTable'

export interface CronJobRow {
  id: string
  name: string
  description: string | null
  enabled: number
  status: CronJobStatus
  cron_expr: string
  timezone: string
  agent_id: string | null
  next_run_at: number | null
  misfire_policy: CronJobMisfirePolicy
  max_catch_up_runs: number | null
  schedule_error: string | null
  task_prompt: string
  task_system_instruction: string | null
  task_output_mode: CronJobOutputMode
  model_policy: CronJobModelPolicy
  tool_policy: CronJobRuntimePolicy
  permission_policy: CronJobRuntimePolicy
  runtime_json: string
  agent_snapshot_json: string | null
  delivery_json: string
  created_at: number
  updated_at: number
}

export interface CronJobTableUpsertInput {
  id?: string
  name: string
  description?: string | null
  enabled: boolean
  status?: CronJobStatus
  cronExpr: string
  timezone: string
  agentId?: string | null
  nextRunAt?: number | null
  misfirePolicy?: CronJobMisfirePolicy
  maxCatchUpRuns?: number | null
  scheduleError?: string | null
  taskPrompt?: string
  taskSystemInstruction?: string | null
  taskOutputMode?: CronJobOutputMode
  modelPolicy?: CronJobModelPolicy
  toolPolicy?: CronJobRuntimePolicy
  permissionPolicy?: CronJobRuntimePolicy
  runtime?: CronJobRuntimeSettings
  agentSnapshot?: CronJobAgentSnapshot | null
  delivery?: CronJobDelivery
  now?: number
}

const CRON_JOBS_SCHEMA_VERSION = 40

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
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
        status TEXT NOT NULL DEFAULT 'disabled' CHECK(status IN ('ready', 'disabled', 'invalid_agent')),
        cron_expr TEXT NOT NULL,
        timezone TEXT NOT NULL,
        agent_id TEXT,
        next_run_at INTEGER,
        misfire_policy TEXT NOT NULL DEFAULT 'skip' CHECK(misfire_policy IN ('skip', 'run_once')),
        max_catch_up_runs INTEGER,
        schedule_error TEXT,
        task_prompt TEXT NOT NULL DEFAULT '',
        task_system_instruction TEXT,
        task_output_mode TEXT NOT NULL DEFAULT 'final_message' CHECK(task_output_mode IN ('final_message', 'structured_json', 'artifact')),
        model_policy TEXT NOT NULL DEFAULT 'follow_agent' CHECK(model_policy IN ('follow_agent', 'pin_current')),
        tool_policy TEXT NOT NULL DEFAULT 'follow_agent' CHECK(tool_policy IN ('follow_agent', 'snapshot')),
        permission_policy TEXT NOT NULL DEFAULT 'follow_agent' CHECK(permission_policy IN ('follow_agent', 'snapshot')),
        runtime_json TEXT NOT NULL DEFAULT '{}',
        agent_snapshot_json TEXT,
        delivery_json TEXT NOT NULL DEFAULT '{}',
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

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return CRON_JOBS_SCHEMA_VERSION
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
    const description =
      input.description === undefined ? (existing?.description ?? null) : input.description
    const status = input.status ?? existing?.status ?? (input.enabled ? 'ready' : 'disabled')
    const nextRunAt =
      input.nextRunAt === undefined ? (existing?.next_run_at ?? null) : input.nextRunAt
    const misfirePolicy =
      input.misfirePolicy ?? existing?.misfire_policy ?? CRON_JOBS_DEFAULT_MISFIRE_POLICY
    const maxCatchUpRuns =
      input.maxCatchUpRuns === undefined
        ? (existing?.max_catch_up_runs ?? null)
        : input.maxCatchUpRuns
    const scheduleError =
      input.scheduleError === undefined ? (existing?.schedule_error ?? null) : input.scheduleError
    const taskPrompt =
      input.taskPrompt === undefined ? (existing?.task_prompt ?? '') : input.taskPrompt
    const taskSystemInstruction =
      input.taskSystemInstruction === undefined
        ? (existing?.task_system_instruction ?? null)
        : input.taskSystemInstruction
    const taskOutputMode =
      input.taskOutputMode ?? existing?.task_output_mode ?? ('final_message' as const)
    const modelPolicy = input.modelPolicy ?? existing?.model_policy ?? ('follow_agent' as const)
    const toolPolicy = input.toolPolicy ?? existing?.tool_policy ?? ('follow_agent' as const)
    const permissionPolicy =
      input.permissionPolicy ?? existing?.permission_policy ?? ('follow_agent' as const)
    const runtimeJson =
      input.runtime === undefined
        ? (existing?.runtime_json ?? '{}')
        : JSON.stringify(input.runtime ?? CRON_JOBS_DEFAULT_RUNTIME)
    const agentSnapshotJson =
      input.agentSnapshot === undefined
        ? (existing?.agent_snapshot_json ?? null)
        : input.agentSnapshot
          ? JSON.stringify(input.agentSnapshot)
          : null
    const deliveryJson =
      input.delivery === undefined
        ? (existing?.delivery_json ?? '{}')
        : JSON.stringify(input.delivery ?? CRON_JOBS_DEFAULT_DELIVERY)

    this.db
      .prepare(
        `INSERT INTO cron_jobs (
           id,
           name,
           description,
           enabled,
           status,
           cron_expr,
           timezone,
           agent_id,
           next_run_at,
           misfire_policy,
           max_catch_up_runs,
           schedule_error,
           task_prompt,
           task_system_instruction,
           task_output_mode,
           model_policy,
           tool_policy,
           permission_policy,
           runtime_json,
           agent_snapshot_json,
           delivery_json,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           enabled = excluded.enabled,
           status = excluded.status,
           cron_expr = excluded.cron_expr,
           timezone = excluded.timezone,
           agent_id = excluded.agent_id,
           next_run_at = excluded.next_run_at,
           misfire_policy = excluded.misfire_policy,
           max_catch_up_runs = excluded.max_catch_up_runs,
           schedule_error = excluded.schedule_error,
           task_prompt = excluded.task_prompt,
           task_system_instruction = excluded.task_system_instruction,
           task_output_mode = excluded.task_output_mode,
           model_policy = excluded.model_policy,
           tool_policy = excluded.tool_policy,
           permission_policy = excluded.permission_policy,
           runtime_json = excluded.runtime_json,
           agent_snapshot_json = excluded.agent_snapshot_json,
           delivery_json = excluded.delivery_json,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.name,
        description,
        input.enabled ? 1 : 0,
        status,
        input.cronExpr,
        input.timezone,
        input.agentId ?? null,
        nextRunAt,
        misfirePolicy,
        maxCatchUpRuns,
        scheduleError,
        taskPrompt,
        taskSystemInstruction,
        taskOutputMode,
        modelPolicy,
        toolPolicy,
        permissionPolicy,
        runtimeJson,
        agentSnapshotJson,
        deliveryJson,
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

  updateScheduleState(
    id: string,
    input: {
      nextRunAt: number | null
      scheduleError: string | null
      now?: number
    }
  ): CronJobRow {
    const now = input.now ?? Date.now()
    const result = this.db
      .prepare(
        `UPDATE cron_jobs
         SET next_run_at = ?,
             schedule_error = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(input.nextRunAt, input.scheduleError, now, id)
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
      .prepare(
        `SELECT COUNT(*) AS count
         FROM cron_jobs
         WHERE enabled = 1
           AND status = 'ready'
           AND agent_id IS NOT NULL
           AND task_prompt != ''`
      )
      .get() as { count: number } | undefined
    return row?.count ?? 0
  }

  getNextEnabledRunAt(): number | null {
    const row = this.db
      .prepare(
        `SELECT MIN(next_run_at) AS next_run_at
         FROM cron_jobs
         WHERE enabled = 1
           AND status = 'ready'
           AND agent_id IS NOT NULL
           AND task_prompt != ''
           AND next_run_at IS NOT NULL`
      )
      .get() as { next_run_at: number | null } | undefined
    return row?.next_run_at ?? null
  }
}
