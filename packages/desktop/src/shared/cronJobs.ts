export const CRON_JOBS_DEFAULT_CRON_EXPR = '* * * * *'
export const CRON_JOBS_DEFAULT_TIMEZONE = 'UTC'
export const CRON_JOBS_DEFAULT_MISFIRE_POLICY = 'skip'
export const CRON_JOBS_DEFAULT_RUNTIME = {
  maxDurationMs: 60 * 60 * 1000,
  maxTurns: 20,
  concurrencyPolicy: 'skip'
} as const
export const CRON_JOBS_DEFAULT_DELIVERY = {
  targets: [],
  suppressSuccessNotification: false,
  notifyOnFailure: true
} as const

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

export const CRON_JOB_STATUSES = ['ready', 'disabled', 'invalid_agent'] as const
export type CronJobStatus = (typeof CRON_JOB_STATUSES)[number]

export const CRON_JOB_OUTPUT_MODES = ['final_message', 'structured_json', 'artifact'] as const
export type CronJobOutputMode = (typeof CRON_JOB_OUTPUT_MODES)[number]

export const CRON_JOB_MODEL_POLICIES = ['follow_agent', 'pin_current'] as const
export type CronJobModelPolicy = (typeof CRON_JOB_MODEL_POLICIES)[number]

export const CRON_JOB_RUNTIME_POLICIES = ['follow_agent', 'snapshot'] as const
export type CronJobRuntimePolicy = (typeof CRON_JOB_RUNTIME_POLICIES)[number]

export const CRON_JOB_CONCURRENCY_POLICIES = ['skip', 'queue'] as const
export type CronJobConcurrencyPolicy = (typeof CRON_JOB_CONCURRENCY_POLICIES)[number]

export const CRON_JOB_DELIVERY_TARGET_TYPES = ['remote'] as const
export type CronJobDeliveryTargetType = (typeof CRON_JOB_DELIVERY_TARGET_TYPES)[number]

export const CRON_JOB_DELIVERY_STATUSES = ['success', 'failed'] as const
export type CronJobDeliveryStatus = (typeof CRON_JOB_DELIVERY_STATUSES)[number]

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
  description: string | null
  enabled: boolean
  status: CronJobStatus
  cronExpr: string
  timezone: string
  agentId: string | null
  nextRunAt: number | null
  misfirePolicy: CronJobMisfirePolicy
  maxCatchUpRuns: number | null
  scheduleError: string | null
  taskPrompt: string
  taskSystemInstruction: string | null
  taskOutputMode: CronJobOutputMode
  modelPolicy: CronJobModelPolicy
  toolPolicy: CronJobRuntimePolicy
  permissionPolicy: CronJobRuntimePolicy
  runtime: CronJobRuntimeSettings
  agentSnapshot: CronJobAgentSnapshot | null
  delivery: CronJobDelivery
  createdAt: number
  updatedAt: number
}

export interface CronJobRuntimeSettings {
  maxDurationMs: number
  maxTurns: number
  concurrencyPolicy: CronJobConcurrencyPolicy
}

export interface CronJobAgentSnapshot {
  version: 1
  capturedAt: number
  agent: {
    id: string
    name: string
    type: 'deepchat' | 'acp'
  }
  config: unknown | null
}

export interface CronJobDelivery {
  targets: CronJobDeliveryTarget[]
  suppressSuccessNotification: boolean
  notifyOnFailure: boolean
}

export type CronJobDeliveryTarget = {
  type: 'remote'
  remoteId: string
  channelId: string
  mode: 'summary' | 'full'
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
  sessionId: string | null
  scheduledAt: number
  queuedAt: number
  startedAt: number | null
  completedAt: number | null
  status: CronJobRunStatus
  reason: CronJobRunReason
  outputMessageId: string | null
  outputPreview: string | null
  error: string | null
  claimedAt: number | null
  claimOwner: string | null
  createdAt: number
  updatedAt: number
}

export interface CronJobDeliveryReceipt {
  id: string
  jobId: string
  runId: string
  targetType: CronJobDeliveryTargetType
  target: CronJobDeliveryTarget
  status: CronJobDeliveryStatus
  remoteMessageId: string | null
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
