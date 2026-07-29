export interface NotificationClock {
  now(): number
}

export interface ScheduledNotificationTask {
  cancel(): void
}

export interface NotificationScheduler {
  schedule(delayMs: number, callback: () => void): ScheduledNotificationTask
}

const getMonotonicNow = (): number => {
  if (typeof globalThis.performance?.now === 'function') {
    return globalThis.performance.now()
  }

  return Date.now()
}

export const systemNotificationClock: NotificationClock = {
  now: getMonotonicNow
}

export class TimeoutNotificationScheduler implements NotificationScheduler {
  schedule(delayMs: number, callback: () => void): ScheduledNotificationTask {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError('Scheduled notification delay must be a non-negative finite number')
    }

    const timeout = setTimeout(callback, delayMs)
    let cancelled = false

    return {
      cancel: () => {
        if (cancelled) return
        cancelled = true
        clearTimeout(timeout)
      }
    }
  }
}
