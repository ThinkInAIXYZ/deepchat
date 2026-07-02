import type { SchedulerStore } from '../schedulerStore'

export function recoverStaleRuns(
  store: SchedulerStore,
  input: {
    now: number
    staleQueuedMs: number
    staleRunningMs: number
  }
): void {
  store.recoverStaleRuns(input)
}
