import type { ScheduledTaskRunReason } from '@shared/scheduledTasks'

export type SchedulerCommand =
  | {
      type: 'START'
      dbPath: string
      dbPassword?: string
      owner: string
    }
  | {
      type: 'STOP'
      reason: 'no_enabled_tasks' | 'app_quit' | 'restart'
    }
  | {
      type: 'RECONCILE'
      reason: ScheduledTaskRunReason
    }
  | {
      type: 'TASK_CHANGED'
      taskId: string
    }
  | {
      type: 'RUN_NOW'
      taskId: string
    }

export type SchedulerEvent =
  | {
      type: 'READY'
      pid: number
    }
  | {
      type: 'HEARTBEAT'
      pid: number
      now: number
      enabledTaskCount: number
      nextRunAt: number | null
    }
  | {
      type: 'RUN_DUE'
      taskId: string
      runId: string
    }
  | {
      type: 'IDLE'
      enabledTaskCount: number
    }
  | {
      type: 'ERROR'
      error: string
      stack?: string
    }
