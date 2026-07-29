import type {
  NotificationClock,
  NotificationScheduler,
  OperationOwner,
  OperationRegistry,
  ScheduledNotificationTask
} from '@shared/notifications'
import type {
  ManagedNotificationHandle,
  NotificationLifecycleEvent,
  NotificationNotifyOptions
} from './notificationManager'
import { NotificationPolicy } from './notificationPolicy'
import { normalizeNotificationCode } from './notificationRequest'
import type {
  NotificationProgrammaticCloseReason,
  TransientNotificationRequest
} from './notificationTypes'
import type { SurfaceVisibilitySource } from './surfaceVisibility'

export type SurfaceFeedbackSnapshot =
  | Readonly<{
      status: 'idle'
      version: number
    }>
  | Readonly<{
      status: 'pending'
      operationId: string
      label: string
      version: number
    }>
  | Readonly<{
      status: 'success' | 'error'
      operationId: string
      code: string
      title: string
      description?: string
      version: number
    }>

export type SurfaceFeedbackResult = Readonly<{
  code: string
  title: string
  description?: string
}>

export type SurfaceFeedbackLease = Readonly<{
  setActive(active: boolean): void
  release(): void
}>

export interface SurfaceFeedbackNotificationPort {
  notify(
    request: TransientNotificationRequest,
    options?: NotificationNotifyOptions
  ): ManagedNotificationHandle
}

export type SurfaceFeedbackControllerDependencies = Readonly<{
  clock: NotificationClock
  scheduler: NotificationScheduler
  operations: OperationRegistry
  operationOwner: OperationOwner
  notifications: SurfaceFeedbackNotificationPort
  visibility: SurfaceVisibilitySource
  policy?: NotificationPolicy
}>

type SurfaceFeedbackListener = (snapshot: SurfaceFeedbackSnapshot) => void
type ActiveSurfaceFeedbackSnapshot = Exclude<SurfaceFeedbackSnapshot, { status: 'idle' }>
type SurfaceFeedbackSnapshotInput = ActiveSurfaceFeedbackSnapshot extends infer Snapshot
  ? Snapshot extends ActiveSurfaceFeedbackSnapshot
    ? Omit<Snapshot, 'version'>
    : never
  : never

export class SurfaceFeedbackController {
  private readonly clock: NotificationClock
  private readonly scheduler: NotificationScheduler
  private readonly operations: OperationRegistry
  private readonly operationOwner: OperationOwner
  private readonly notifications: SurfaceFeedbackNotificationPort
  private readonly visibility: SurfaceVisibilitySource
  private readonly policy: NotificationPolicy
  private readonly listeners = new Set<SurfaceFeedbackListener>()
  private readonly leases = new Map<number, boolean>()
  private snapshot: SurfaceFeedbackSnapshot = Object.freeze({ status: 'idle', version: 0 })
  private leaseSequence = 0
  private leaseRevision = 0
  private feedbackGeneration = 0
  private handoffTask?: ScheduledNotificationTask
  private successTask?: ScheduledNotificationTask
  private successTaskStartedAt?: number
  private successRemainingMs = 0
  private stopVisibilitySubscription?: () => void
  private toastHandle?: ManagedNotificationHandle
  private handoffDelivered = false
  private disposed = false

  constructor(dependencies: SurfaceFeedbackControllerDependencies) {
    this.clock = dependencies.clock
    this.scheduler = dependencies.scheduler
    this.operations = dependencies.operations
    this.operationOwner = dependencies.operationOwner
    this.notifications = dependencies.notifications
    this.visibility = dependencies.visibility
    this.policy = dependencies.policy ?? new NotificationPolicy()
  }

  getSnapshot(): SurfaceFeedbackSnapshot {
    return this.snapshot
  }

  subscribe(listener: SurfaceFeedbackListener): () => void {
    this.ensureUsable()
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  acquireLease(active = true): SurfaceFeedbackLease {
    this.ensureUsable()
    const leaseId = ++this.leaseSequence
    let released = false
    this.leases.set(leaseId, active)
    this.onLeaseChanged()

    return Object.freeze({
      setActive: (nextActive: boolean) => {
        if (released || this.leases.get(leaseId) === nextActive) return
        this.leases.set(leaseId, nextActive)
        this.onLeaseChanged()
      },
      release: () => {
        if (released) return
        released = true
        this.leases.delete(leaseId)
        this.onLeaseChanged()
      }
    })
  }

  begin(operationId: string, label: string): void {
    this.ensureUsable()
    if (this.snapshot.status === 'pending') {
      throw new Error(`Operation "${this.snapshot.operationId}" is already pending`)
    }

    const normalizedLabel = label.trim()
    if (!normalizedLabel) throw new TypeError('Pending feedback label must not be empty')

    const operation = this.operations.create(operationId, this.operationOwner)
    try {
      this.operations.start(operation.id)
    } catch (error) {
      this.operations.cancel(operation.id)
      throw error
    }

    this.resetPresentation('programmatic')
    this.feedbackGeneration += 1
    this.setSnapshot({
      status: 'pending',
      operationId: operation.id,
      label: normalizedLabel
    })
  }

  succeed(result: SurfaceFeedbackResult): void {
    this.settle('success', result)
  }

  fail(result: SurfaceFeedbackResult): void {
    this.settle('error', result)
  }

  clear(): void {
    this.ensureUsable()
    if (this.snapshot.status === 'pending') {
      throw new Error('Pending feedback must be cancelled or settled before it can be cleared')
    }
    this.transitionToIdle('programmatic')
  }

  cancel(): void {
    this.ensureUsable()
    if (this.snapshot.status !== 'pending') {
      throw new Error(`Cannot cancel feedback from "${this.snapshot.status}"`)
    }
    this.operations.cancel(this.snapshot.operationId)
    this.transitionToIdle('programmatic')
  }

  dispose(): void {
    if (this.disposed) return
    if (this.snapshot.status === 'pending') {
      this.cancel()
    } else {
      this.transitionToIdle('programmatic')
    }
    this.disposed = true
    this.leases.clear()
    this.listeners.clear()
  }

  private settle(status: 'success' | 'error', result: SurfaceFeedbackResult): void {
    this.ensureUsable()
    if (this.snapshot.status !== 'pending') {
      throw new Error(`Cannot settle feedback from "${this.snapshot.status}"`)
    }

    const operationId = this.snapshot.operationId
    const normalized = this.normalizeResult(result)
    if (status === 'success') {
      this.operations.succeed(operationId)
    } else {
      this.operations.fail(operationId, normalized.code)
    }

    this.resetPresentation('programmatic')
    this.feedbackGeneration += 1
    this.successRemainingMs = status === 'success' ? this.policy.inlineSuccessDisplayBudgetMs : 0
    this.setSnapshot({
      status,
      operationId,
      ...normalized
    })
  }

  private normalizeResult(result: SurfaceFeedbackResult): SurfaceFeedbackResult {
    const code = normalizeNotificationCode(result.code)
    const title = result.title.trim()
    if (!title) throw new TypeError('Feedback title must not be empty')
    const description = result.description?.trim()
    return Object.freeze({
      code,
      title,
      ...(description ? { description } : {})
    })
  }

  private setSnapshot(next: SurfaceFeedbackSnapshotInput): void {
    this.snapshot = Object.freeze({
      ...next,
      version: this.snapshot.version + 1
    }) as SurfaceFeedbackSnapshot
    this.reconcilePresentation()
    this.emit()
  }

  private transitionToIdle(reason: NotificationProgrammaticCloseReason): void {
    this.feedbackGeneration += 1
    this.resetPresentation(reason)
    if (this.snapshot.status === 'idle') return

    this.snapshot = Object.freeze({
      status: 'idle',
      version: this.snapshot.version + 1
    })
    this.emit()
  }

  private onLeaseChanged(): void {
    this.leaseRevision += 1
    this.reconcilePresentation()
  }

  private reconcilePresentation(): void {
    this.cancelHandoff()
    if (this.hasActiveLease()) {
      this.reclaimToast()
      if (this.snapshot.status === 'success') {
        this.startInlineSuccessBudget()
      } else {
        this.stopVisibilityTracking()
      }
      return
    }

    this.pauseInlineSuccessBudget()
    this.stopVisibilityTracking()
    if (
      (this.snapshot.status === 'success' || this.snapshot.status === 'error') &&
      !this.toastHandle &&
      !this.handoffDelivered
    ) {
      this.scheduleHandoff()
    }
  }

  private scheduleHandoff(): void {
    const feedbackGeneration = this.feedbackGeneration
    const leaseRevision = this.leaseRevision
    this.handoffTask = this.scheduler.schedule(this.policy.surfaceHandoffGraceMs, () => {
      this.handoffTask = undefined
      if (
        this.disposed ||
        feedbackGeneration !== this.feedbackGeneration ||
        leaseRevision !== this.leaseRevision ||
        this.hasActiveLease() ||
        this.toastHandle ||
        this.handoffDelivered ||
        (this.snapshot.status !== 'success' && this.snapshot.status !== 'error')
      ) {
        return
      }
      this.presentToast(this.snapshot, feedbackGeneration)
    })
  }

  private presentToast(
    snapshot: Extract<SurfaceFeedbackSnapshot, { status: 'success' | 'error' }>,
    feedbackGeneration: number
  ): void {
    this.handoffDelivered = true
    let synchronousEvent: NotificationLifecycleEvent | undefined
    let presenting = true
    let handle: ManagedNotificationHandle
    try {
      handle = this.notifications.notify(
        {
          kind: snapshot.status,
          code: snapshot.code,
          title: snapshot.title,
          description: snapshot.description
        },
        {
          onLifecycleEvent: (event) => {
            if (presenting) {
              synchronousEvent = event
              return
            }
            this.handleToastClosed(event, feedbackGeneration)
          }
        }
      )
    } catch (error) {
      presenting = false
      this.handoffDelivered = false
      console.error('[SurfaceFeedbackController] notification handoff failed', error)
      return
    }
    presenting = false

    if (synchronousEvent) {
      this.handleToastClosed(synchronousEvent, feedbackGeneration)
      return
    }
    if (this.disposed || feedbackGeneration !== this.feedbackGeneration || this.hasActiveLease()) {
      handle.dismiss('surface-reclaimed')
      return
    }
    this.toastHandle = handle
  }

  private handleToastClosed(event: NotificationLifecycleEvent, feedbackGeneration: number): void {
    if (feedbackGeneration !== this.feedbackGeneration) return
    this.toastHandle = undefined
    if (event.reason === 'surface-reclaimed') {
      this.handoffDelivered = false
      return
    }
    this.handoffDelivered = true
    if (this.snapshot.status === 'success') {
      this.transitionToIdle('programmatic')
    }
  }

  private reclaimToast(): void {
    const toastHandle = this.toastHandle
    if (!toastHandle) return

    this.toastHandle = undefined
    this.handoffDelivered = false
    toastHandle.dismiss('surface-reclaimed')
  }

  private startInlineSuccessBudget(): void {
    if (
      this.snapshot.status !== 'success' ||
      this.toastHandle ||
      this.successTask ||
      !this.hasActiveLease()
    ) {
      return
    }
    if (!this.visibility.isVisible()) {
      this.trackVisibility()
      return
    }
    if (this.successRemainingMs <= 0) {
      this.transitionToIdle('programmatic')
      return
    }

    this.trackVisibility()
    const feedbackGeneration = this.feedbackGeneration
    this.successTaskStartedAt = this.clock.now()
    this.successTask = this.scheduler.schedule(this.successRemainingMs, () => {
      this.successTask = undefined
      this.successTaskStartedAt = undefined
      this.successRemainingMs = 0
      if (
        feedbackGeneration === this.feedbackGeneration &&
        this.snapshot.status === 'success' &&
        this.hasActiveLease() &&
        this.visibility.isVisible() &&
        !this.toastHandle
      ) {
        this.transitionToIdle('programmatic')
      }
    })
  }

  private pauseInlineSuccessBudget(): void {
    if (!this.successTask) return
    this.successTask.cancel()
    this.successTask = undefined
    if (this.successTaskStartedAt !== undefined) {
      const elapsed = Math.max(0, this.clock.now() - this.successTaskStartedAt)
      this.successRemainingMs = Math.max(0, this.successRemainingMs - elapsed)
    }
    this.successTaskStartedAt = undefined
  }

  private trackVisibility(): void {
    if (this.stopVisibilitySubscription) return
    this.stopVisibilitySubscription = this.visibility.subscribe(() => {
      if (this.visibility.isVisible()) {
        this.startInlineSuccessBudget()
      } else {
        this.pauseInlineSuccessBudget()
      }
    })
  }

  private stopVisibilityTracking(): void {
    this.stopVisibilitySubscription?.()
    this.stopVisibilitySubscription = undefined
  }

  private resetPresentation(reason: NotificationProgrammaticCloseReason): void {
    this.cancelHandoff()
    this.pauseInlineSuccessBudget()
    this.stopVisibilityTracking()
    const toastHandle = this.toastHandle
    this.toastHandle = undefined
    this.handoffDelivered = false
    this.successRemainingMs = 0
    toastHandle?.dismiss(reason)
  }

  private cancelHandoff(): void {
    this.handoffTask?.cancel()
    this.handoffTask = undefined
  }

  private hasActiveLease(): boolean {
    for (const active of this.leases.values()) {
      if (active) return true
    }
    return false
  }

  private emit(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(this.snapshot)
      } catch (error) {
        console.error('[SurfaceFeedbackController] listener failed', error)
      }
    }
  }

  private ensureUsable(): void {
    if (this.disposed) throw new Error('SurfaceFeedbackController is disposed')
  }
}
