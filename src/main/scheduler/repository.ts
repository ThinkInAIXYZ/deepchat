import {
  CRON_JOBS_DEFAULT_DELIVERY,
  CRON_JOBS_DEFAULT_MISFIRE_POLICY,
  CRON_JOBS_DEFAULT_RUNTIME,
  type CronJobAgentSnapshot,
  type CronJobDelivery,
  type CronJobDeliveryReceipt,
  type CronJobRuntimeSettings,
  type CronJob,
  type CronJobRun,
  type CronJobRunReason
} from '@shared/cronJobs'
import type { cronJobsUpsertInputSchema } from '@shared/contracts/routes/cronJobs.routes'
import type { z } from 'zod'
import type { SchedulerDatabase } from './data/database'
import type { CronJobDeliveryRow } from './data/tables/cronJobDeliveries'
import type { CronJobRow } from './data/tables/cronJobs'
import type { CronJobRunRow } from './data/tables/cronJobRuns'

export type CronJobUpsertInput = z.input<typeof cronJobsUpsertInputSchema> & {
  now?: number
}

export interface CronJobsSchedulerSnapshot {
  enabledJobCount: number
  nextRunAt: number | null
}

export class CronJobsRepository {
  constructor(private readonly database: SchedulerDatabase) {}

  listJobs(): CronJob[] {
    return this.database.cronJobsTable.list().map(toCronJob)
  }

  getJob(id: string): CronJob | null {
    const row = this.database.cronJobsTable.get(id)
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
    const row = this.database.cronJobsTable.upsert({
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
      delivery: input.delivery,
      now: input.now
    })
    return toCronJob(row)
  }

  deleteJob(id: string): void {
    this.database.getDatabase().transaction(() => {
      this.database.cronJobDeliveriesTable.deleteByJob(id)
      this.database.cronJobRunsTable.deleteByJob(id)
      this.database.cronJobsTable.delete(id)
    })()
  }

  setJobEnabled(id: string, enabled: boolean): CronJob {
    return toCronJob(this.database.cronJobsTable.setEnabled(id, enabled))
  }

  updateJobNextRunAt(id: string, nextRunAt: number | null): CronJob {
    return toCronJob(this.database.cronJobsTable.updateNextRunAt(id, nextRunAt))
  }

  updateScheduleState(
    id: string,
    input: {
      nextRunAt: number | null
      scheduleError: string | null
      now?: number
    }
  ): CronJob {
    return toCronJob(this.database.cronJobsTable.updateScheduleState(id, input))
  }

  getSchedulerSnapshot(): CronJobsSchedulerSnapshot {
    return {
      enabledJobCount: this.database.cronJobsTable.countEnabled(),
      nextRunAt: this.database.cronJobsTable.getNextEnabledRunAt()
    }
  }

  queueRun(input: {
    jobId: string
    scheduledAt: number
    reason: CronJobRunReason
    now?: number
  }): CronJobRun {
    return toCronJobRun(
      this.database.cronJobRunsTable.insertQueued({
        jobId: input.jobId,
        scheduledAt: input.scheduledAt,
        reason: input.reason,
        now: input.now
      })
    )
  }

  getRun(id: string): CronJobRun | null {
    const row = this.database.cronJobRunsTable.get(id)
    return row ? toCronJobRun(row) : null
  }

  requireRun(id: string): CronJobRun {
    const run = this.getRun(id)
    if (!run) {
      throw new Error(`Unknown cron job run: ${id}`)
    }
    return run
  }

  markRunRunning(id: string): CronJobRun {
    return toCronJobRun(this.database.cronJobRunsTable.markRunning(id))
  }

  claimRun(id: string, claimOwner: string): CronJobRun | null {
    const row = this.database.cronJobRunsTable.claimQueued(id, claimOwner)
    return row ? toCronJobRun(row) : null
  }

  updateRunSession(id: string, sessionId: string): CronJobRun {
    return toCronJobRun(this.database.cronJobRunsTable.updateSession(id, sessionId))
  }

  updateRunOutput(
    id: string,
    input: {
      outputMessageId?: string | null
      outputPreview?: string | null
    }
  ): CronJobRun {
    return toCronJobRun(this.database.cronJobRunsTable.updateOutput(id, input))
  }

  markRunCompleted(id: string): CronJobRun {
    return toCronJobRun(this.database.cronJobRunsTable.markCompleted(id))
  }

  markRunFailed(id: string, error: string): CronJobRun {
    return toCronJobRun(this.database.cronJobRunsTable.markFailed(id, error))
  }

  markRunningRunsFailed(error: string): number {
    return this.database.cronJobRunsTable.markRunningFailed(error)
  }

  markRunCancelled(id: string, error?: string | null): CronJobRun {
    return toCronJobRun(this.database.cronJobRunsTable.markCancelled(id, error ?? null))
  }

  releaseRunQueued(id: string): CronJobRun {
    return toCronJobRun(this.database.cronJobRunsTable.releaseQueued(id))
  }

  countActiveRunsByJob(jobId: string, excludeRunId?: string): number {
    return this.database.cronJobRunsTable.countActiveByJob(jobId, excludeRunId)
  }

  listRunsByJob(jobId: string, limit?: number): CronJobRun[] {
    return this.database.cronJobRunsTable.listByJob(jobId, limit).map(toCronJobRun)
  }

  recordDelivery(input: {
    jobId: string
    runId: string
    target: CronJobDeliveryReceipt['target']
    status: CronJobDeliveryReceipt['status']
    remoteMessageId?: string | null
    error?: string | null
    now?: number
  }): CronJobDeliveryReceipt {
    return toCronJobDeliveryReceipt(this.database.cronJobDeliveriesTable.insert(input))
  }

  listDeliveriesByRun(runId: string): CronJobDeliveryReceipt[] {
    return this.database.cronJobDeliveriesTable.listByRun(runId).map(toCronJobDeliveryReceipt)
  }

  findDeliveryByRemoteMessageId(remoteMessageId: string): CronJobDeliveryReceipt | null {
    const row = this.database.cronJobDeliveriesTable.findByRemoteMessageId(remoteMessageId)
    return row ? toCronJobDeliveryReceipt(row) : null
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
    delivery: parseDelivery(row.delivery_json),
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

function parseDelivery(value: string | null | undefined): CronJobDelivery {
  try {
    const parsed = value ? (JSON.parse(value) as Partial<CronJobDelivery>) : {}
    return {
      targets: Array.isArray(parsed.targets)
        ? parsed.targets.filter(
            (target): target is CronJobDelivery['targets'][number] =>
              Boolean(target) &&
              typeof target === 'object' &&
              (target as { type?: unknown }).type === 'remote' &&
              typeof (target as { remoteId?: unknown }).remoteId === 'string' &&
              typeof (target as { channelId?: unknown }).channelId === 'string' &&
              ((target as { mode?: unknown }).mode === 'summary' ||
                (target as { mode?: unknown }).mode === 'full')
          )
        : [...CRON_JOBS_DEFAULT_DELIVERY.targets],
      suppressSuccessNotification:
        parsed.suppressSuccessNotification ??
        CRON_JOBS_DEFAULT_DELIVERY.suppressSuccessNotification,
      notifyOnFailure: parsed.notifyOnFailure ?? CRON_JOBS_DEFAULT_DELIVERY.notifyOnFailure
    } as CronJobDelivery
  } catch {
    return { ...CRON_JOBS_DEFAULT_DELIVERY, targets: [...CRON_JOBS_DEFAULT_DELIVERY.targets] }
  }
}

export function toCronJobRun(row: CronJobRunRow): CronJobRun {
  return {
    id: row.id,
    jobId: row.job_id,
    sessionId: row.session_id ?? null,
    scheduledAt: row.scheduled_at,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    reason: row.reason,
    outputMessageId: row.output_message_id ?? null,
    outputPreview: row.output_preview ?? null,
    error: row.error,
    claimedAt: row.claimed_at ?? null,
    claimOwner: row.claim_owner ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function toCronJobDeliveryReceipt(row: CronJobDeliveryRow): CronJobDeliveryReceipt {
  return {
    id: row.id,
    jobId: row.job_id,
    runId: row.run_id,
    targetType: row.target_type,
    target: JSON.parse(row.target_json) as CronJobDeliveryReceipt['target'],
    status: row.status,
    remoteMessageId: row.remote_message_id ?? null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
