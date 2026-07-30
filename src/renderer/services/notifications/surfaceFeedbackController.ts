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
  private terminalObservedInline = false
  private terminalPresentedAsToast = false
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
        if (released || this.disposed || this.leases.get(leaseId) === nextActive) return
        this.leases.set(leaseId, nextActive)
        this.onLeaseChanged()
      },
      release: () => {
        if (released) return
        released = true
        if (this.disposed) return
        this.leases.delete(leaseId)
        this.onLeaseChanged()
      }
    })
  }

  begin(operationId: string, label: string): boolean {
    if (this.disposed) return false
    if (this.snapshot.status === 'pending') {
      this.reportIntegrationError(
        'begin',
        new Error(`Operation "${this.snapshot.operationId}" is already pending`)
      )
      return false
    }

    let normalizedOperationId: string | undefined
    let normalizedLabel: string
    try {
      normalizedLabel = label.trim()
      if (!normalizedLabel) throw new TypeError('Pending feedback label must not be empty')

      const operation = this.operations.create(operationId, this.operationOwner)
      normalizedOperationId = operation.id
      this.operations.start(operation.id)
    } catch (error) {
      if (normalizedOperationId) this.cancelOperation(normalizedOperationId, 'begin rollback')
      this.reportIntegrationError('begin', error)
      return false
    }

    this.resetPresentation('programmatic')
    this.feedbackGeneration += 1
    this.setSnapshot({
      status: 'pending',
      operationId: normalizedOperationId,
      label: normalizedLabel
    })
    return true
  }

  succeed(result: SurfaceFeedbackResult): boolean {
    return this.settle('success', result)
  }

  fail(result: SurfaceFeedbackResult): boolean {
    return this.settle('error', result)
  }

  clearSettled(): boolean {
    if (this.disposed || this.snapshot.status === 'idle') return false
    if (this.snapshot.status === 'pending') {
      this.reportIntegrationError(
        'clear settled feedback',
        new Error('Pending feedback must be cancelled or settled before it can be cleared')
      )
      return false
    }
    this.transitionToIdle('programmatic')
    return true
  }

  cancelPending(): boolean {
    if (this.disposed) return false
    if (this.snapshot.status !== 'pending') {
      this.reportIntegrationError(
        'cancel pending feedback',
        new Error(`Cannot cancel feedback from "${this.snapshot.status}"`)
      )
      return false
    }
    const cancelled = this.cancelOperation(this.snapshot.operationId, 'cancel pending feedback')
    this.transitionToIdle('programmatic')
    return cancelled
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.snapshot.status === 'pending') {
      this.cancelOperation(this.snapshot.operationId, 'dispose')
    }
    this.feedbackGeneration += 1
    this.resetPresentation('programmatic')
    if (this.snapshot.status !== 'idle') {
      this.snapshot = Object.freeze({
        status: 'idle',
        version: this.snapshot.version + 1
      })
    }
    this.leases.clear()
    this.listeners.clear()
  }

  private settle(status: 'success' | 'error', result: SurfaceFeedbackResult): boolean {
    if (this.disposed) return false
    if (this.snapshot.status !== 'pending') {
      this.reportIntegrationError(
        `settle ${status}`,
        new Error(`Cannot settle feedback from "${this.snapshot.status}"`)
      )
      return false
    }

    const operationId = this.snapshot.operationId
    let normalized: SurfaceFeedbackResult
    try {
      normalized = this.normalizeResult(result)
    } catch (error) {
      this.reportIntegrationError(`settle ${status}`, error)
      this.settleInvalidResult(operationId, status)
      this.transitionToIdle('programmatic')
      return false
    }

    try {
      if (status === 'success') {
        this.operations.succeed(operationId)
      } else {
        this.operations.fail(operationId, normalized.code)
      }
    } catch (error) {
      this.reportIntegrationError(`settle ${status}`, error)
      this.cancelOperation(operationId, `settle ${status} rollback`)
      this.transitionToIdle('programmatic')
      return false
    }

    this.resetPresentation('programmatic')
    this.feedbackGeneration += 1
    this.successRemainingMs = status === 'success' ? this.policy.inlineSuccessDisplayBudgetMs : 0
    this.setSnapshot({
      status,
      operationId,
      ...normalized
    })
    return true
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
    this.reconcilePresentationSafely()
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
    this.reconcilePresentationSafely()
  }

  private reconcilePresentation(): void {
    this.cancelHandoff()
    if (this.hasActiveLease()) {
      const visible = this.visibility.isVisible()
      if (visible && (this.snapshot.status === 'success' || this.snapshot.status === 'error')) {
        this.terminalObservedInline = true
      }
      this.reclaimToast()
      if (this.snapshot.status === 'success') {
        if (visible) {
          this.startInlineSuccessBudget()
        } else {
          this.pauseInlineSuccessBudget()
          this.trackVisibility()
        }
      } else if (this.snapshot.status === 'error' && !this.terminalObservedInline) {
        this.trackVisibility()
      } else {
        this.stopVisibilityTracking()
      }
      return
    }

    this.pauseInlineSuccessBudget()
    this.stopVisibilityTracking()
    if (this.snapshot.status === 'success' && this.terminalObservedInline) {
      this.transitionToIdle('programmatic')
      return
    }
    if (
      (this.snapshot.status === 'success' || this.snapshot.status === 'error') &&
      !this.terminalObservedInline &&
      !this.toastHandle &&
      !this.terminalPresentedAsToast
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
        this.terminalObservedInline ||
        this.toastHandle ||
        this.terminalPresentedAsToast ||
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
    this.terminalPresentedAsToast = true
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
      this.terminalPresentedAsToast = false
      this.reportIntegrationError('notification handoff', error)
      return
    }
    presenting = false

    if (synchronousEvent) {
      this.handleToastClosed(synchronousEvent, feedbackGeneration)
      return
    }
    if (this.disposed || feedbackGeneration !== this.feedbackGeneration || this.hasActiveLease()) {
      this.terminalPresentedAsToast = false
      this.dismissToast(
        handle,
        this.hasActiveLease() ? 'surface-reclaimed' : 'programmatic',
        'stale notification handoff'
      )
      return
    }
    this.toastHandle = handle
  }

  private handleToastClosed(event: NotificationLifecycleEvent, feedbackGeneration: number): void {
    if (feedbackGeneration !== this.feedbackGeneration) return
    this.toastHandle = undefined
    if (event.reason === 'surface-reclaimed') {
      this.terminalPresentedAsToast = false
      return
    }
    this.terminalPresentedAsToast = true
    if (this.snapshot.status === 'success') {
      this.transitionToIdle('programmatic')
    }
  }

  private reclaimToast(): void {
    const toastHandle = this.toastHandle
    if (!toastHandle) return

    this.toastHandle = undefined
    this.terminalPresentedAsToast = false
    this.dismissToast(toastHandle, 'surface-reclaimed', 'surface reclaim')
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
    const successTask = this.successTask
    if (!successTask) return
    this.successTask = undefined
    try {
      successTask.cancel()
    } catch (error) {
      this.reportIntegrationError('inline success timer cancellation', error)
    }
    if (this.successTaskStartedAt !== undefined) {
      try {
        const elapsed = Math.max(0, this.clock.now() - this.successTaskStartedAt)
        this.successRemainingMs = Math.max(0, this.successRemainingMs - elapsed)
      } catch (error) {
        this.reportIntegrationError('inline success timer pause', error)
      }
    }
    this.successTaskStartedAt = undefined
  }

  private trackVisibility(): void {
    if (this.stopVisibilitySubscription) return
    this.stopVisibilitySubscription = this.visibility.subscribe(() => {
      this.reconcilePresentationSafely()
    })
  }

  private stopVisibilityTracking(): void {
    const stop = this.stopVisibilitySubscription
    this.stopVisibilitySubscription = undefined
    if (!stop) return
    try {
      stop()
    } catch (error) {
      this.reportIntegrationError('visibility subscription cleanup', error)
    }
  }

  private resetPresentation(reason: NotificationProgrammaticCloseReason): void {
    this.cancelHandoff()
    this.pauseInlineSuccessBudget()
    this.stopVisibilityTracking()
    const toastHandle = this.toastHandle
    this.toastHandle = undefined
    this.terminalObservedInline = false
    this.terminalPresentedAsToast = false
    this.successRemainingMs = 0
    if (toastHandle) this.dismissToast(toastHandle, reason, 'presentation reset')
  }

  private cancelHandoff(): void {
    const handoffTask = this.handoffTask
    this.handoffTask = undefined
    if (!handoffTask) return
    try {
      handoffTask.cancel()
    } catch (error) {
      this.reportIntegrationError('handoff cancellation', error)
    }
  }

  private hasActiveLease(): boolean {
    for (const active of this.leases.values()) {
      if (active) return true
    }
    return false
  }

  private reconcilePresentationSafely(): void {
    try {
      this.reconcilePresentation()
    } catch (error) {
      this.reportIntegrationError('presentation reconciliation', error)
    }
  }

  private settleInvalidResult(operationId: string, status: 'success' | 'error'): void {
    try {
      if (status === 'success') {
        this.operations.succeed(operationId)
      } else {
        this.operations.fail(operationId, 'notification.surface.invalidResult')
      }
    } catch (error) {
      this.reportIntegrationError(`settle invalid ${status}`, error)
      this.cancelOperation(operationId, `settle invalid ${status} rollback`)
    }
  }

  private cancelOperation(operationId: string, boundary: string): boolean {
    try {
      this.operations.cancel(operationId)
      return true
    } catch (error) {
      this.reportIntegrationError(boundary, error)
      return false
    }
  }

  private dismissToast(
    handle: ManagedNotificationHandle,
    reason: NotificationProgrammaticCloseReason,
    boundary: string
  ): void {
    try {
      handle.dismiss(reason)
    } catch (error) {
      this.reportIntegrationError(boundary, error)
    }
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

  private reportIntegrationError(boundary: string, error: unknown): void {
    console.error(`[SurfaceFeedbackController] ${boundary} failed`, error)
  }
}
