import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskRunReason
} from '@shared/scheduledTasks'

export interface SchedulerStore {
  countEnabledTasks(): number
  listEnabledTasks(): ScheduledTask[]
  getNearestNextRunAt(): number | null
  listDueTasks(now: number): ScheduledTask[]
  getTask(taskId: string): ScheduledTask | null
  upsertTask(task: ScheduledTask): void
  deleteTask(taskId: string): void
  createManualRun(taskId: string, now: number, owner: string): ScheduledTaskRun
  createQueuedRunWithLock(input: {
    task: ScheduledTask
    scheduledAt: number
    reason: ScheduledTaskRunReason
    owner: string
    now: number
  }): ScheduledTaskRun | null
  markRunRunning(runId: string, startedAt: number): boolean
  markRunSuccess(input: {
    runId: string
    completedAt: number
    sessionId?: string
    tapeId?: string
    outputMessageId?: string
    outputPreview?: string
  }): void
  markRunFailed(input: { runId: string; completedAt: number; error: string }): void
  markRunCancelled(runId: string, completedAt: number): void
  recoverStaleRuns(input: { now: number; staleQueuedMs: number; staleRunningMs: number }): void
  listRuns(taskId: string, limit: number): ScheduledTaskRun[]
}
