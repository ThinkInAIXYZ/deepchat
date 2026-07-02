import type { ScheduledTaskRunReason } from '@shared/scheduledTasks'
import type { SchedulerStore } from '../schedulerStore'

export function reconcileDueTasks(input: {
  store: SchedulerStore
  now: number
  reason: ScheduledTaskRunReason
  owner: string
  emitRunDue: (event: { taskId: string; runId: string }) => void
}): void {
  input.store.recoverStaleRuns({
    now: input.now,
    staleQueuedMs: 2 * 60 * 1000,
    staleRunningMs: 10 * 60 * 1000
  })

  const dueTasks = input.store.listDueTasks(input.now)
  for (const task of dueTasks) {
    const run = input.store.createQueuedRunWithLock({
      task,
      scheduledAt: task.nextRunAt ?? input.now,
      reason: input.reason,
      owner: input.owner,
      now: input.now
    })

    if (run) {
      input.emitRunDue({ taskId: task.id, runId: run.id })
    }
  }
}
