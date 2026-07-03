import {
  CRON_JOBS_DEFAULT_MISFIRE_POLICY,
  CRON_JOBS_DEFAULT_RUNTIME,
  type CronJobAgentSnapshot,
  type CronJobRuntimeSettings,
  type CronJob,
  type CronJobRun,
  type CronJobRunReason
} from '@shared/cronJobs'
import type { cronJobsUpsertInputSchema } from '@shared/contracts/routes/cronJobs.routes'
import type { z } from 'zod'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { CronJobRow } from '../sqlitePresenter/tables/cronJobs'
import type { CronJobRunRow } from '../sqlitePresenter/tables/cronJobRuns'

export type CronJobUpsertInput = z.input<typeof cronJobsUpsertInputSchema> & {
  now?: number
}

export interface CronJobsSchedulerSnapshot {
  enabledJobCount: number
  nextRunAt: number | null
}

export class CronJobsRepository {
  constructor(private readonly sqlitePresenter: SQLitePresenter) {}

  listJobs(): CronJob[] {
    return this.sqlitePresenter.cronJobsTable.list().map(toCronJob)
  }

  getJob(id: string): CronJob | null {
    const row = this.sqlitePresenter.cronJobsTable.get(id)
    return row ? toCronJob(row) : null
  }

  requireJob(id: string): CronJob {
    const job = this.getJob(id)
    if (!job) {
      throw new Error(`Unknown cron job: ${id}`)
    }
    return job
  }

  upsertJob(input: CronJobUpsertInput): CronJob {
    const row = this.sqlitePresenter.cronJobsTable.upsert({
      id: input.id,
      name: input.name,
      description: input.description,
      enabled: input.enabled,
      status: input.status,
      cronExpr: input.cronExpr,
      timezone: input.timezone,
      agentId: input.agentId,
      nextRunAt: input.nextRunAt,
      misfirePolicy: input.misfirePolicy,
      maxCatchUpRuns: input.maxCatchUpRuns,
      scheduleError: input.scheduleError,
      taskPrompt: input.taskPrompt,
      taskSystemInstruction: input.taskSystemInstruction,
      taskOutputMode: input.taskOutputMode,
      modelPolicy: input.modelPolicy,
      toolPolicy: input.toolPolicy,
      permissionPolicy: input.permissionPolicy,
      runtime: input.runtime,
      agentSnapshot: input.agentSnapshot,
      now: input.now
    })
    return toCronJob(row)
  }

  deleteJob(id: string): void {
    this.sqlitePresenter.getDatabase().transaction(() => {
      this.sqlitePresenter.cronJobRunsTable.deleteByJob(id)
      this.sqlitePresenter.cronJobsTable.delete(id)
    })()
  }

  setJobEnabled(id: string, enabled: boolean): CronJob {
    return toCronJob(this.sqlitePresenter.cronJobsTable.setEnabled(id, enabled))
  }

  updateJobNextRunAt(id: string, nextRunAt: number | null): CronJob {
    return toCronJob(this.sqlitePresenter.cronJobsTable.updateNextRunAt(id, nextRunAt))
  }

  updateScheduleState(
    id: string,
    input: {
      nextRunAt: number | null
      scheduleError: string | null
      now?: number
    }
  ): CronJob {
    return toCronJob(this.sqlitePresenter.cronJobsTable.updateScheduleState(id, input))
  }

  getSchedulerSnapshot(): CronJobsSchedulerSnapshot {
    return {
      enabledJobCount: this.sqlitePresenter.cronJobsTable.countEnabled(),
      nextRunAt: this.sqlitePresenter.cronJobsTable.getNextEnabledRunAt()
    }
  }

  queueRun(input: {
    jobId: string
    scheduledAt: number
    reason: CronJobRunReason
    now?: number
  }): CronJobRun {
    return toCronJobRun(
      this.sqlitePresenter.cronJobRunsTable.insertQueued({
        jobId: input.jobId,
        scheduledAt: input.scheduledAt,
        reason: input.reason,
        now: input.now
      })
    )
  }

  getRun(id: string): CronJobRun | null {
    const row = this.sqlitePresenter.cronJobRunsTable.get(id)
    return row ? toCronJobRun(row) : null
  }

  markRunRunning(id: string): CronJobRun {
    return toCronJobRun(this.sqlitePresenter.cronJobRunsTable.markRunning(id))
  }

  markRunCompleted(id: string): CronJobRun {
    return toCronJobRun(this.sqlitePresenter.cronJobRunsTable.markCompleted(id))
  }

  markRunFailed(id: string, error: string): CronJobRun {
    return toCronJobRun(this.sqlitePresenter.cronJobRunsTable.markFailed(id, error))
  }

  listRunsByJob(jobId: string, limit?: number): CronJobRun[] {
    return this.sqlitePresenter.cronJobRunsTable.listByJob(jobId, limit).map(toCronJobRun)
  }
}

export function toCronJob(row: CronJobRow): CronJob {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    enabled: row.enabled === 1,
    status:
      row.status ?? (row.agent_id ? (row.enabled === 1 ? 'ready' : 'disabled') : 'invalid_agent'),
    cronExpr: row.cron_expr,
    timezone: row.timezone,
    agentId: row.agent_id,
    nextRunAt: row.next_run_at,
    misfirePolicy: row.misfire_policy ?? CRON_JOBS_DEFAULT_MISFIRE_POLICY,
    maxCatchUpRuns: row.max_catch_up_runs ?? null,
    scheduleError: row.schedule_error ?? null,
    taskPrompt: row.task_prompt ?? '',
    taskSystemInstruction: row.task_system_instruction ?? null,
    taskOutputMode: row.task_output_mode ?? 'final_message',
    modelPolicy: row.model_policy ?? 'follow_agent',
    toolPolicy: row.tool_policy ?? 'follow_agent',
    permissionPolicy: row.permission_policy ?? 'follow_agent',
    runtime: parseRuntime(row.runtime_json),
    agentSnapshot: parseSnapshot(row.agent_snapshot_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseRuntime(value: string | null | undefined): CronJobRuntimeSettings {
  try {
    const parsed = value ? (JSON.parse(value) as Partial<CronJobRuntimeSettings>) : {}
    return {
      maxDurationMs: parsed.maxDurationMs ?? CRON_JOBS_DEFAULT_RUNTIME.maxDurationMs,
      maxTurns: parsed.maxTurns ?? CRON_JOBS_DEFAULT_RUNTIME.maxTurns,
      maxToolCalls: parsed.maxToolCalls ?? CRON_JOBS_DEFAULT_RUNTIME.maxToolCalls,
      concurrencyPolicy: parsed.concurrencyPolicy ?? CRON_JOBS_DEFAULT_RUNTIME.concurrencyPolicy
    }
  } catch {
    return { ...CRON_JOBS_DEFAULT_RUNTIME }
  }
}

function parseSnapshot(value: string | null | undefined): CronJobAgentSnapshot | null {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as CronJobAgentSnapshot
  } catch {
    return null
  }
}

export function toCronJobRun(row: CronJobRunRow): CronJobRun {
  return {
    id: row.id,
    jobId: row.job_id,
    scheduledAt: row.scheduled_at,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    reason: row.reason,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
