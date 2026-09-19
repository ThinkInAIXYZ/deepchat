import type { NotificationScheduler, ScheduledNotificationTask } from '@shared/notifications'
import type {
  WindowNotificationDiagnosticEvent,
  WindowNotificationDiagnostics
} from './windowNotificationRouter'

export type AggregatedWindowNotificationDiagnosticsDependencies = Readonly<{
  scheduler: NotificationScheduler
  write: (event: WindowNotificationDiagnosticEvent & { count: number }) => void
  flushIntervalMs?: number
}>

type DiagnosticCount = {
  event: WindowNotificationDiagnosticEvent
  count: number
}

export class AggregatedWindowNotificationDiagnostics implements WindowNotificationDiagnostics {
  private readonly scheduler: NotificationScheduler
  private readonly write: AggregatedWindowNotificationDiagnosticsDependencies['write']
  private readonly flushIntervalMs: number
  private readonly counts = new Map<string, DiagnosticCount>()
  private flushTask?: ScheduledNotificationTask
  private disposed = false

  constructor(dependencies: AggregatedWindowNotificationDiagnosticsDependencies) {
    const flushIntervalMs = dependencies.flushIntervalMs ?? 30_000
    if (!Number.isFinite(flushIntervalMs) || flushIntervalMs <= 0) {
      throw new RangeError('Notification diagnostic flush interval must be positive')
    }
    this.scheduler = dependencies.scheduler
    this.write = dependencies.write
    this.flushIntervalMs = flushIntervalMs
  }

  record(event: WindowNotificationDiagnosticEvent): void {
    if (this.disposed) return

    const key = JSON.stringify([event.code, event.reason, event.priority, event.scopeKind])
    const current = this.counts.get(key)
    if (current) {
      current.count += 1
    } else {
      this.counts.set(key, { event, count: 1 })
    }
    if (this.flushTask) return

    try {
      this.flushTask = this.scheduler.schedule(this.flushIntervalMs, () => {
        this.flushTask = undefined
        this.flush()
      })
    } catch (error) {
      console.error('[WindowNotificationDiagnostics] scheduling failed', error)
      this.flush()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.flushTask?.cancel()
    this.flushTask = undefined
    this.flush()
  }

  private flush(): void {
    const pending = Array.from(this.counts.values())
    this.counts.clear()
    for (const { event, count } of pending) {
      try {
        this.write(Object.freeze({ ...event, count }))
      } catch (error) {
        console.error('[WindowNotificationDiagnostics] writer failed', error)
      }
    }
  }
}
