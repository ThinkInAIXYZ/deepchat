import type { NotificationClock, NotificationScheduler } from '@shared/notifications'
import type { ManagedNotificationEntry } from './notificationEntry'
import type { NotificationPolicy } from './notificationPolicy'
import type {
  NotificationCloseReason,
  NotificationDiagnosticReason,
  ProgressNotificationRequest
} from './notificationTypes'

export type NotificationArbitrationHooks = Readonly<{
  runMutation: (operation: () => void) => void
  present: (entry: ManagedNotificationEntry, slot: 'transient' | 'persistent') => boolean
  detachPresentation: (entry: ManagedNotificationEntry) => void
  cleanup: (
    entry: ManagedNotificationEntry,
    reason: NotificationCloseReason,
    dismissPresentation: boolean
  ) => void
  emitLifecycle: (entry: ManagedNotificationEntry, reason: NotificationCloseReason) => void
  recordDiagnostic: (entry: ManagedNotificationEntry, reason: NotificationDiagnosticReason) => void
}>

export class TransientNotificationArbiter {
  private active?: ManagedNotificationEntry
  private candidate?: ManagedNotificationEntry

  constructor(
    private readonly clock: NotificationClock,
    private readonly scheduler: NotificationScheduler,
    private readonly policy: NotificationPolicy,
    private readonly hooks: NotificationArbitrationHooks
  ) {}

  offer(entry: ManagedNotificationEntry): void {
    if (!this.active) {
      this.present(entry)
      return
    }

    if (entry.priority > this.active.priority) {
      this.close(this.active, 'preempted', true, false)
      this.present(entry)
      return
    }

    if (!this.policy.canBecomeTransientCandidate(entry.request)) {
      this.hooks.recordDiagnostic(entry, 'lower-priority')
      this.close(entry, 'programmatic', false, false)
      return
    }

    if (!this.candidate) {
      this.setCandidate(entry)
      return
    }

    if (entry.priority > this.candidate.priority) {
      this.hooks.recordDiagnostic(this.candidate, 'candidate-replaced')
      this.close(this.candidate, 'programmatic', false, false)
      this.setCandidate(entry)
      return
    }

    this.hooks.recordDiagnostic(entry, 'lower-priority')
    this.close(entry, 'programmatic', false, false)
  }

  refresh(entry: ManagedNotificationEntry): void {
    if (this.candidate === entry) {
      this.scheduleCandidateExpiry(entry)
    }
  }

  close(
    entry: ManagedNotificationEntry,
    reason: NotificationCloseReason,
    dismissPresentation: boolean,
    advance = true
  ): void {
    const wasActive = this.active === entry
    if (wasActive) this.active = undefined
    if (this.candidate === entry) this.candidate = undefined

    this.hooks.cleanup(entry, reason, dismissPresentation)
    if (wasActive && advance) this.advance()
  }

  reset(): void {
    this.active = undefined
    this.candidate = undefined
  }

  private present(entry: ManagedNotificationEntry): void {
    entry.location = 'transient'
    this.active = entry
    if (!this.hooks.present(entry, 'transient') && !entry.disposed) {
      this.close(entry, 'programmatic', false)
    }
  }

  private setCandidate(entry: ManagedNotificationEntry): void {
    entry.location = 'transient-candidate'
    this.candidate = entry
    this.scheduleCandidateExpiry(entry)
  }

  private scheduleCandidateExpiry(entry: ManagedNotificationEntry): void {
    entry.expiryTask?.cancel()
    entry.expiryTask = this.scheduler.schedule(this.policy.transientCandidateFreshnessMs, () => {
      this.hooks.runMutation(() => {
        if (this.candidate !== entry || entry.disposed) return
        this.hooks.recordDiagnostic(entry, 'candidate-expired')
        this.close(entry, 'programmatic', false, false)
      })
    })
  }

  private advance(): void {
    if (this.active || !this.candidate) return

    const candidate = this.candidate
    this.candidate = undefined
    candidate.expiryTask?.cancel()
    candidate.expiryTask = undefined
    const age = this.clock.now() - candidate.record.getSnapshot().lastSeenAt
    if (age >= this.policy.transientCandidateFreshnessMs) {
      this.hooks.recordDiagnostic(candidate, 'candidate-expired')
      this.close(candidate, 'programmatic', false, false)
      return
    }
    this.present(candidate)
  }
}

export class PersistentNotificationArbiter {
  private readonly actionableQueue: ManagedNotificationEntry[] = []
  private readonly progressByOperationId = new Map<string, ManagedNotificationEntry>()
  private active?: ManagedNotificationEntry

  constructor(
    private readonly scheduler: NotificationScheduler,
    private readonly policy: NotificationPolicy,
    private readonly hooks: NotificationArbitrationHooks
  ) {}

  offerActionable(entry: ManagedNotificationEntry): void {
    if (!this.active || this.active.request.kind === 'progress') {
      const activeProgress = this.active
      if (activeProgress?.request.kind === 'progress') {
        this.active = undefined
        this.hooks.detachPresentation(activeProgress)
        activeProgress.location = 'progress-waiting'
      }
      this.present(entry)
      return
    }

    if (entry.priority > this.active.priority) {
      const preempted = this.active
      this.active = undefined
      this.hooks.detachPresentation(preempted)
      this.enqueueActionable(preempted)
      this.present(entry)
      return
    }

    this.enqueueActionable(entry)
  }

  offerProgress(entry: ManagedNotificationEntry): void {
    const request = entry.request as ProgressNotificationRequest
    entry.location = 'progress-waiting'
    this.progressByOperationId.set(request.operationId, entry)

    if (!this.active) {
      this.present(entry)
    }
  }

  completeProgress(operationId: string): void {
    const entry = this.progressByOperationId.get(operationId)
    if (entry) this.close(entry, 'programmatic', true)
  }

  suppressProgress(
    entry: ManagedNotificationEntry,
    reason: Extract<NotificationCloseReason, 'auto' | 'dismissed' | 'action'>
  ): void {
    if (entry.disposed || entry.request.kind !== 'progress') return

    const wasActive = this.active === entry
    if (wasActive) this.active = undefined
    entry.location = 'progress-suppressed'
    this.hooks.emitLifecycle(entry, reason)
    if (wasActive) this.advance()
  }

  close(
    entry: ManagedNotificationEntry,
    reason: NotificationCloseReason,
    dismissPresentation: boolean
  ): void {
    const wasActive = this.active === entry
    if (wasActive) this.active = undefined

    const queueIndex = this.actionableQueue.indexOf(entry)
    if (queueIndex >= 0) this.actionableQueue.splice(queueIndex, 1)

    if (entry.request.kind === 'progress') {
      this.progressByOperationId.delete(entry.request.operationId)
    }

    this.hooks.cleanup(entry, reason, dismissPresentation)
    if (wasActive) {
      this.advance()
    } else {
      this.updatePendingActionableCount()
    }
  }

  reset(): void {
    this.actionableQueue.length = 0
    this.progressByOperationId.clear()
    this.active = undefined
  }

  private enqueueActionable(entry: ManagedNotificationEntry): void {
    entry.location = 'actionable-queue'
    this.actionableQueue.push(entry)
    this.actionableQueue.sort(
      (left, right) => right.priority - left.priority || left.order - right.order
    )
    this.scheduleActionableExpiry(entry)

    while (this.actionableQueue.length > this.policy.actionableQueueCapacity) {
      const overflow = this.actionableQueue.pop()
      if (!overflow) break
      this.hooks.recordDiagnostic(overflow, 'actionable-overflow')
      this.close(overflow, 'programmatic', false)
    }
    this.updatePendingActionableCount()
  }

  private scheduleActionableExpiry(entry: ManagedNotificationEntry): void {
    entry.expiryTask?.cancel()
    entry.expiryTask = undefined
    if (entry.request.kind !== 'actionable') {
      return
    }

    const queueTtlMs = this.policy.actionableQueueTtlMs(entry.request)
    if (!Number.isFinite(queueTtlMs)) return

    entry.expiryTask = this.scheduler.schedule(queueTtlMs, () => {
      this.hooks.runMutation(() => {
        if (entry.disposed || entry.location !== 'actionable-queue') return
        this.hooks.recordDiagnostic(entry, 'actionable-expired')
        this.close(entry, 'programmatic', false)
      })
    })
  }

  private present(entry: ManagedNotificationEntry): void {
    entry.location = 'persistent'
    this.active = entry
    entry.expiryTask?.cancel()
    entry.expiryTask = undefined
    if (!this.hooks.present(entry, 'persistent') && !entry.disposed) {
      this.close(entry, 'programmatic', false)
      return
    }
    this.updatePendingActionableCount()
  }

  private advance(): void {
    if (this.active) return

    const nextActionable = this.actionableQueue.shift()
    if (nextActionable) {
      this.present(nextActionable)
      return
    }

    for (const progress of this.progressByOperationId.values()) {
      if (!progress.disposed && progress.location === 'progress-waiting') {
        this.present(progress)
        return
      }
    }
  }

  private updatePendingActionableCount(): void {
    if (this.active?.request.kind === 'actionable') {
      this.active.record.patch({
        pendingCount: this.actionableQueue.length
      })
    }
  }
}
