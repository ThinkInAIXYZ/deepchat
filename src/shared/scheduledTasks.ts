// Shared types for the scheduled tasks feature.
// Persisted by ConfigPresenter under the `scheduledTasks` key and exchanged
// with the renderer through the routes defined in
// `src/shared/contracts/routes/scheduledTasks.routes.ts`.

export const SCHEDULED_TASKS_VERSION = 1 as const

export const SCHEDULED_TASK_TRIGGER_KINDS = ['once', 'daily', 'weekly'] as const
export type ScheduledTaskTriggerKind = (typeof SCHEDULED_TASK_TRIGGER_KINDS)[number]

export const SCHEDULED_TASK_ACTION_KINDS = ['notify', 'prompt'] as const
export type ScheduledTaskActionKind = (typeof SCHEDULED_TASK_ACTION_KINDS)[number]

export const SCHEDULED_TASK_DEFAULT_AGENT_ID = 'deepchat'

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
  name: string
  enabled: boolean
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskAction
  createdAt: number
  lastFiredAt: number | null
}

export interface ScheduledTasksSettings {
  version: typeof SCHEDULED_TASKS_VERSION
  tasks: ScheduledTask[]
}

export const createDefaultScheduledTasksSettings = (): ScheduledTasksSettings => ({
  version: SCHEDULED_TASKS_VERSION,
  tasks: []
})
