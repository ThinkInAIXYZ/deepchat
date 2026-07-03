export const CRON_JOBS_DEFAULT_CRON_EXPR = '0 9 * * *'
export const CRON_JOBS_DEFAULT_TIMEZONE = 'UTC'
export const CRON_JOBS_DEFAULT_MISFIRE_POLICY = 'skip'

export const CRON_JOB_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled'
] as const
export type CronJobRunStatus = (typeof CRON_JOB_RUN_STATUSES)[number]

export const CRON_JOB_RUN_REASONS = ['scheduled', 'manual'] as const
export type CronJobRunReason = (typeof CRON_JOB_RUN_REASONS)[number]

export const CRON_JOB_MISFIRE_POLICIES = ['skip', 'run_once'] as const
export type CronJobMisfirePolicy = (typeof CRON_JOB_MISFIRE_POLICIES)[number]

export const CRON_JOBS_SCHEDULER_STATES = [
  'stopped',
  'starting',
  'running',
  'idle',
  'error'
] as const
export type CronJobsSchedulerState = (typeof CRON_JOBS_SCHEDULER_STATES)[number]

export interface CronJob {
  id: string
  name: string
  enabled: boolean
  cronExpr: string
  timezone: string
  agentId: string | null
  nextRunAt: number | null
  misfirePolicy: CronJobMisfirePolicy
  maxCatchUpRuns: number | null
  scheduleError: string | null
  createdAt: number
  updatedAt: number
}

export type CronSchedulePreset =
  | { type: 'every_n_minutes'; n: number }
  | { type: 'hourly'; minute: number }
  | { type: 'daily'; time: string }
  | { type: 'weekdays'; time: string }
  | { type: 'weekly'; days: number[]; time: string }
  | { type: 'monthly'; day: number | 'last'; time: string }
  | { type: 'custom'; cronExpr: string }

export interface CronScheduleValidation {
  valid: boolean
  error: string | null
  nextRunAt: number | null
}

export interface CronSchedulePreview {
  runs: number[]
  error: string | null
}

export interface CronJobRun {
  id: string
  jobId: string
  scheduledAt: number
  queuedAt: number
  startedAt: number | null
  completedAt: number | null
  status: CronJobRunStatus
  reason: CronJobRunReason
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface CronJobsSchedulerStatus {
  state: CronJobsSchedulerState
  pid: number | null
  enabledJobCount: number
  nextRunAt: number | null
  lastHeartbeatAt: number | null
  lastError: string | null
  restartAttempts: number
  updatedAt: number
}

export type SchedulerCommand =
  | {
      type: 'START'
      now: number
    }
  | {
      type: 'RECONCILE'
      reason: string
      now: number
    }
  | {
      type: 'RUN_NOW'
      jobId: string
      now: number
    }
  | {
      type: 'STOP'
      reason: string
      now: number
    }

export type SchedulerEvent =
  | {
      type: 'READY'
      pid: number | null
      now: number
    }
  | {
      type: 'HEARTBEAT'
      enabledJobCount: number
      nextRunAt: number | null
      now: number
    }
  | {
      type: 'RUN_DUE'
      jobId: string
      runId: string
      scheduledAt: number
      reason: CronJobRunReason
      now: number
    }
  | {
      type: 'IDLE'
      enabledJobCount: number
      nextRunAt: number | null
      now: number
    }
  | {
      type: 'ERROR'
      message: string
      stack?: string
      now: number
    }
