// Shared types for the scheduled tasks feature.
// Persisted by ConfigPresenter under the `scheduledTasks` key and exchanged
// with the renderer through the routes defined in
// `src/shared/contracts/routes/scheduledTasks.routes.ts`.

export const SCHEDULED_TASKS_VERSION = 2 as const

export const SCHEDULED_TASK_TRIGGER_KINDS = ['once', 'daily', 'weekly'] as const
export type ScheduledTaskTriggerKind = (typeof SCHEDULED_TASK_TRIGGER_KINDS)[number]

export const SCHEDULED_TASK_ACTION_KINDS = ['notify', 'prompt'] as const
export type ScheduledTaskActionKind = (typeof SCHEDULED_TASK_ACTION_KINDS)[number]

export const SCHEDULED_TASK_DEFAULT_AGENT_ID = 'deepchat'
export const SCHEDULED_TASK_DEFAULT_TIMEZONE = 'UTC'

export const SCHEDULED_TASK_RUN_STATUSES = [
  'queued',
  'running',
  'success',
  'failed',
  'cancelled',
  'skipped'
] as const
export type ScheduledTaskRunStatus = (typeof SCHEDULED_TASK_RUN_STATUSES)[number]

export const SCHEDULED_TASK_RUN_REASONS = [
  'startup',
  'tick',
  'resume',
  'manual',
  'task_changed',
  'scheduler_restart',
  'run_now'
] as const
export type ScheduledTaskRunReason = (typeof SCHEDULED_TASK_RUN_REASONS)[number]

export const SCHEDULER_PROCESS_STATES = [
  'stopped',
  'starting',
  'running',
  'idle',
  'crashed'
] as const
export type SchedulerProcessState = (typeof SCHEDULER_PROCESS_STATES)[number]

export type ScheduledTaskTrigger =
  | { kind: 'once'; firesAt: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; dayOfWeek: number; hour: number; minute: number }

export type ScheduledTaskAction =
  | {
      kind: 'notify'
      title: string
      body: string
    }
  | {
      kind: 'prompt'
      title: string
      message: string
      autoSend: boolean
      agentId?: string
      providerId?: string
      modelId?: string
      systemPrompt?: string
    }

export interface ScheduledTask {
  id: string
  version: typeof SCHEDULED_TASKS_VERSION
  name: string
  enabled: boolean
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskAction
  timezone: string
  nextRunAt: number | null
  lastRunId: string | null
  createdAt: number
  updatedAt: number
  lastFiredAt: number | null
}

export interface ScheduledTasksSettings {
  version: typeof SCHEDULED_TASKS_VERSION
  tasks: ScheduledTask[]
}

export interface ScheduledTaskRun {
  id: string
  taskId: string
  scheduledAt: number
  queuedAt: number
  startedAt: number | null
  completedAt: number | null
  status: ScheduledTaskRunStatus
  reason: ScheduledTaskRunReason
  sessionId?: string
  tapeId?: string
  outputMessageId?: string
  error?: string
  outputPreview?: string
  owner?: string
  createdAt: number
  updatedAt: number
}

export interface SchedulerProcessStatus {
  state: SchedulerProcessState
  pid?: number
  startedAt?: number
  lastHeartbeatAt?: number
  enabledTaskCount: number
  nextRunAt: number | null
  lastError?: string
}

export const createDefaultScheduledTasksSettings = (): ScheduledTasksSettings => ({
  version: SCHEDULED_TASKS_VERSION,
  tasks: []
})
