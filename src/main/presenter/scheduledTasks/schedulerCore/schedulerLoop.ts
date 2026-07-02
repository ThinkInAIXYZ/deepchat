import type { ScheduledTaskRunReason } from '@shared/scheduledTasks'
import type { SchedulerEvent } from '../schedulerProtocol'
import type { SchedulerStore } from '../schedulerStore'
import { reconcileDueTasks } from './reconcileDueTasks'

const MIN_TICK_MS = 1000
const MAX_TICK_MS = 30_000

export class SchedulerLoop {
  private stopped = true
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly store: SchedulerStore,
    private readonly owner: string,
    private readonly emit: (event: SchedulerEvent) => void
  ) {}

  start(): void {
    if (!this.stopped) {
      return
    }
    this.stopped = false
    this.reconcile('startup')
    this.armNextTick()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  reconcile(reason: ScheduledTaskRunReason): void {
    const now = Date.now()
    reconcileDueTasks({
      store: this.store,
      now,
      reason,
      owner: this.owner,
      emitRunDue: ({ taskId, runId }) => this.emit({ type: 'RUN_DUE', taskId, runId })
    })

    const enabledTaskCount = this.store.countEnabledTasks()
    const nextRunAt = this.store.getNearestNextRunAt()
    this.emit({
      type: 'HEARTBEAT',
      pid: process.pid,
      now,
      enabledTaskCount,
      nextRunAt
    })

    if (enabledTaskCount === 0) {
      this.emit({ type: 'IDLE', enabledTaskCount })
    }
  }

  private armNextTick(): void {
    if (this.stopped) {
      return
    }

    const nextRunAt = this.store.getNearestNextRunAt()
    const now = Date.now()
    const delay = nextRunAt
      ? Math.min(Math.max(nextRunAt - now, MIN_TICK_MS), MAX_TICK_MS)
      : MAX_TICK_MS

    this.timer = setTimeout(() => {
      try {
        this.reconcile('tick')
      } catch (error) {
        this.emit({
          type: 'ERROR',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        })
      } finally {
        this.armNextTick()
      }
    }, delay)
  }
}
