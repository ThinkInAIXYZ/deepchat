import type {
  NotificationClock,
  NotificationScheduler,
  ScheduledNotificationTask
} from '@shared/notifications'

type PendingTask = {
  id: number
  dueAt: number
  callback: () => void
  cancelled: boolean
}

export class FakeNotificationTime implements NotificationClock, NotificationScheduler {
  private readonly tasks: PendingTask[] = []
  private nowMs = 0
  private sequence = 0

  now(): number {
    return this.nowMs
  }

  schedule(delayMs: number, callback: () => void): ScheduledNotificationTask {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError('Fake time requires a non-negative finite delay')
    }

    const task: PendingTask = {
      id: ++this.sequence,
      dueAt: this.nowMs + delayMs,
      callback,
      cancelled: false
    }
    this.tasks.push(task)
    return {
      cancel: () => {
        task.cancelled = true
      }
    }
  }

  advanceBy(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError('Fake time can only advance by a non-negative finite duration')
    }

    const target = this.nowMs + durationMs
    while (true) {
      const next = this.tasks
        .filter((task) => !task.cancelled && task.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0]
      if (!next) break

      next.cancelled = true
      this.nowMs = next.dueAt
      next.callback()
    }
    this.nowMs = target
  }
}
