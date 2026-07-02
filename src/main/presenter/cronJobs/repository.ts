import type { CronJob, CronJobRun, CronJobRunReason } from '@shared/cronJobs'
import type { cronJobsUpsertInputSchema } from '@shared/contracts/routes/cronJobs.routes'
import type { z } from 'zod'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { CronJobRow } from '../sqlitePresenter/tables/cronJobs'
import type { CronJobRunRow } from '../sqlitePresenter/tables/cronJobRuns'

export type CronJobUpsertInput = z.input<typeof cronJobsUpsertInputSchema>

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
      enabled: input.enabled,
      cronExpr: input.cronExpr,
      timezone: input.timezone,
      agentId: input.agentId,
      nextRunAt: input.nextRunAt
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
    enabled: row.enabled === 1,
    cronExpr: row.cron_expr,
    timezone: row.timezone,
    agentId: row.agent_id,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
