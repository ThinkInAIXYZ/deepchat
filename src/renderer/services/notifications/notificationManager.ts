import type { NotificationClock, NotificationScheduler } from '@shared/notifications'
import {
  PersistentNotificationArbiter,
  TransientNotificationArbiter,
  type NotificationArbitrationHooks
} from './notificationArbitration'
import type { ManagedNotificationEntry } from './notificationEntry'
import {
  type NotificationPresentationHandle,
  type NotificationPresenter
} from './notificationPresenter'
import { NotificationPolicy } from './notificationPolicy'
import { ObservableNotificationRecord } from './notificationRecord'
import {
  normalizeNotificationOperationId,
  normalizeNotificationRecovery,
  normalizeNotificationRequest,
  resolveNotificationIdentity,
  resolveNotificationMemberKey,
  type NotificationRecovery
} from './notificationRequest'
import {
  silentNotificationDiagnostics,
  type NotificationCloseReason,
  type NotificationDiagnosticEvent,
  type NotificationDiagnosticReason,
  type NotificationDiagnostics,
  type NotificationProgrammaticCloseReason,
  type NotificationRequest
} from './notificationTypes'

export type ManagedNotificationHandle = Readonly<{
  logicalId: string
  dismiss: (reason?: NotificationProgrammaticCloseReason) => void
}>

export type NotificationLifecycleEvent = Readonly<{
  logicalId: string
  reason: NotificationCloseReason
  requests: readonly NotificationRequest[]
}>

export type NotificationNotifyOptions = Readonly<{
  onLifecycleEvent?: (event: NotificationLifecycleEvent) => void
}>

export type NotificationManagerDependencies = Readonly<{
  presenter: NotificationPresenter
  clock: NotificationClock
  scheduler: NotificationScheduler
  policy?: NotificationPolicy
  diagnostics?: NotificationDiagnostics
  onLifecycleEvent?: (event: NotificationLifecycleEvent) => void
}>

type PendingIntegrationEvent =
  | Readonly<{ type: 'diagnostic'; event: NotificationDiagnosticEvent }>
  | Readonly<{
      type: 'lifecycle'
      event: NotificationLifecycleEvent
      listeners: readonly ((event: NotificationLifecycleEvent) => void)[]
    }>

export class NotificationManager {
  private readonly byIdentity = new Map<string, ManagedNotificationEntry>()
  private readonly byLogicalId = new Map<string, ManagedNotificationEntry>()
  private readonly presenter: NotificationPresenter
  private readonly clock: NotificationClock
  private readonly scheduler: NotificationScheduler
  private readonly policy: NotificationPolicy
  private readonly diagnostics: NotificationDiagnostics
  private readonly onLifecycleEvent?: (event: NotificationLifecycleEvent) => void
  private readonly transientArbiter: TransientNotificationArbiter
  private readonly persistentArbiter: PersistentNotificationArbiter
  private readonly pendingIntegrationEvents: PendingIntegrationEvent[] = []
  private readonly lifecycleListeners = new Map<
    string,
    Set<(event: NotificationLifecycleEvent) => void>
  >()
  private sequence = 0
  private mutationDepth = 0
  private flushingIntegrationEvents = false
  private disposed = false

  constructor(dependencies: NotificationManagerDependencies) {
    this.presenter = dependencies.presenter
    this.clock = dependencies.clock
    this.scheduler = dependencies.scheduler
    this.policy = dependencies.policy ?? new NotificationPolicy()
    this.diagnostics = dependencies.diagnostics ?? silentNotificationDiagnostics
    this.onLifecycleEvent = dependencies.onLifecycleEvent

    const hooks: NotificationArbitrationHooks = {
      runMutation: (operation) => this.runMutation(operation),
      present: (entry, slot) => this.present(entry, slot),
      detachPresentation: (entry) => this.detachPresentation(entry),
      cleanup: (entry, reason, dismissPresentation) =>
        this.cleanup(entry, reason, dismissPresentation),
      emitLifecycle: (entry, reason) => this.emitLifecycle(entry, reason),
      recordDiagnostic: (entry, reason) => this.recordDiagnostic(entry, reason)
    }
    this.transientArbiter = new TransientNotificationArbiter(
      this.clock,
      this.scheduler,
      this.policy,
      hooks
    )
    this.persistentArbiter = new PersistentNotificationArbiter(this.scheduler, this.policy, hooks)
  }

  notify(
    request: NotificationRequest,
    options: NotificationNotifyOptions = {}
  ): ManagedNotificationHandle {
    return this.runMutation(() => {
      if (this.disposed) throw new Error('NotificationManager is disposed')

      const normalizedRequest = normalizeNotificationRequest(request)
      const identity = resolveNotificationIdentity(normalizedRequest)
      const existing = identity ? this.byIdentity.get(identity) : undefined
      if (existing) {
        const listenerRegistered = this.registerLifecycleListener(
          existing,
          options.onLifecycleEvent
        )
        try {
          this.aggregate(existing, normalizedRequest)
        } catch (error) {
          if (listenerRegistered && options.onLifecycleEvent) {
            this.unregisterLifecycleListener(existing, options.onLifecycleEvent)
          }
          throw error
        }
        return this.toHandle(existing)
      }

      const entry = this.createEntry(normalizedRequest, identity)
      this.registerLifecycleListener(entry, options.onLifecycleEvent)
      if (normalizedRequest.kind === 'actionable') {
        this.persistentArbiter.offerActionable(entry)
      } else if (normalizedRequest.kind === 'progress') {
        this.persistentArbiter.offerProgress(entry)
      } else {
        this.transientArbiter.offer(entry)
      }
      return this.toHandle(entry)
    })
  }

  completeProgress(operationId: string): void {
    this.runMutation(() => {
      this.persistentArbiter.completeProgress(normalizeNotificationOperationId(operationId))
    })
  }

  recover(recovery: NotificationRecovery): void {
    this.runMutation(() => {
      const normalized = normalizeNotificationRecovery(recovery)
      const entry = this.byIdentity.get(normalized.identity)
      if (!entry) return

      if (!normalized.scope || !entry.members) {
        this.close(entry, 'programmatic', true)
        return
      }

      entry.members.delete(normalized.key)
      if (entry.members.size === 0) {
        this.close(entry, 'programmatic', true)
        return
      }

      const remainingMembers = Array.from(entry.members.values())
      const latest = remainingMembers[remainingMembers.length - 1]
      entry.request = latest
      entry.record.patch({
        entityCount: entry.members.size,
        title: latest.title,
        description: latest.description,
        ...(latest.kind === 'actionable' ? { action: latest.action } : {})
      })
    })
  }

  dismiss(logicalId: string, reason: NotificationCloseReason = 'programmatic'): void {
    this.runMutation(() => {
      const entry = this.byLogicalId.get(logicalId)
      if (entry) this.close(entry, reason, true)
    })
  }

  dispose(): void {
    this.runMutation(() => {
      if (this.disposed) return
      this.disposed = true
      this.transientArbiter.reset()
      this.persistentArbiter.reset()
      for (const entry of Array.from(this.byLogicalId.values())) {
        this.cleanup(entry, 'programmatic', true)
      }
    })
  }

  private aggregate(entry: ManagedNotificationEntry, request: NotificationRequest): void {
    const now = this.clock.now()
    const nextPolicy = this.policy.resolve(request)
    if (
      request.kind !== entry.request.kind ||
      request.code !== entry.request.code ||
      nextPolicy.priority !== entry.priority ||
      nextPolicy.displayBudgetMs !== entry.displayBudgetMs ||
      nextPolicy.maxLifetimeMs !== entry.maxLifetimeMs ||
      nextPolicy.content !== entry.content
    ) {
      throw new Error(`Notification contract changed for active identity "${entry.identity}"`)
    }

    if (request.kind === 'progress' && entry.request.kind === 'progress') {
      const currentProgress = entry.request.progress
      if (
        currentProgress !== undefined &&
        (request.progress === undefined || request.progress < currentProgress)
      ) {
        throw new RangeError('Notification progress must not move backwards')
      }
      entry.request = request
      entry.record.patch({
        title: request.title,
        description: request.description,
        progress: request.progress,
        lastSeenAt: now
      })
      return
    }

    entry.request = request
    const memberKey = resolveNotificationMemberKey(request)
    if (entry.members && memberKey) {
      entry.members.delete(memberKey)
      entry.members.set(memberKey, request)
    }
    entry.record.patch({
      title: request.title,
      description: request.description,
      occurrenceCount: entry.record.getSnapshot().occurrenceCount + 1,
      entityCount: entry.members?.size ?? 1,
      lastSeenAt: now,
      ...(request.kind === 'actionable' ? { action: request.action } : {})
    })
    this.transientArbiter.refresh(entry)
  }

  private createEntry(request: NotificationRequest, identity?: string): ManagedNotificationEntry {
    const now = this.clock.now()
    const resolved = this.policy.resolve(request)
    const order = ++this.sequence
    const logicalId = `notification-${order}`
    const memberKey = resolveNotificationMemberKey(request)
    const members = memberKey ? new Map([[memberKey, request]]) : undefined
    const record = new ObservableNotificationRecord({
      logicalId,
      code: request.code,
      kind: request.kind,
      title: request.title,
      description: request.description,
      occurrenceCount: 1,
      entityCount: 1,
      pendingCount: 0,
      ...(request.kind === 'progress' ? { progress: request.progress } : {}),
      ...(request.kind === 'actionable' ? { action: request.action } : {}),
      createdAt: now,
      lastSeenAt: now
    })
    const entry: ManagedNotificationEntry = {
      logicalId,
      identity,
      request,
      record,
      priority: resolved.priority,
      displayBudgetMs: resolved.displayBudgetMs,
      maxLifetimeMs: resolved.maxLifetimeMs,
      content: resolved.content,
      order,
      location: resolved.slot === 'transient' ? 'transient' : 'persistent',
      members,
      disposed: false
    }
    this.byLogicalId.set(logicalId, entry)
    if (identity) this.byIdentity.set(identity, entry)
    return entry
  }

  private present(entry: ManagedNotificationEntry, slot: 'transient' | 'persistent'): boolean {
    let synchronousClose:
      | Extract<NotificationCloseReason, 'auto' | 'dismissed' | 'action'>
      | undefined
    let presentation: NotificationPresentationHandle
    try {
      presentation = this.presenter.present(
        entry.record,
        {
          displayBudgetMs: entry.displayBudgetMs,
          slot,
          content: entry.content
        },
        {
          onClosed: (reason) => {
            if (!entry.presentation) {
              synchronousClose = reason
              return
            }
            this.runMutation(() => this.handlePresenterClosed(entry, reason))
          }
        }
      )
    } catch (error) {
      this.reportIntegrationError('presenter', error)
      return false
    }

    entry.presentation = presentation
    if (synchronousClose) {
      this.handlePresenterClosed(entry, synchronousClose)
      return !entry.disposed
    }

    if (Number.isFinite(entry.maxLifetimeMs)) {
      try {
        entry.deadlineTask = this.scheduler.schedule(entry.maxLifetimeMs, () => {
          this.runMutation(() => {
            if (!entry.disposed && entry.presentation) {
              this.close(entry, 'max-lifetime', true)
            }
          })
        })
      } catch (error) {
        entry.presentation = undefined
        this.dismissPresentation(presentation)
        this.reportIntegrationError('deadline scheduler', error)
        return false
      }
    }
    return true
  }

  private handlePresenterClosed(
    entry: ManagedNotificationEntry,
    reason: Extract<NotificationCloseReason, 'auto' | 'dismissed' | 'action'>
  ): void {
    if (entry.disposed || !entry.presentation) return
    entry.presentation = undefined
    entry.deadlineTask?.cancel()
    entry.deadlineTask = undefined

    if (entry.request.kind === 'progress') {
      this.persistentArbiter.suppressProgress(entry, reason)
    } else {
      this.close(entry, reason, false)
    }
  }

  private detachPresentation(entry: ManagedNotificationEntry): void {
    const presentation = entry.presentation
    entry.presentation = undefined
    entry.deadlineTask?.cancel()
    entry.deadlineTask = undefined
    this.dismissPresentation(presentation)
  }

  private close(
    entry: ManagedNotificationEntry,
    reason: NotificationCloseReason,
    dismissPresentation: boolean
  ): void {
    if (entry.request.kind === 'progress' || entry.request.kind === 'actionable') {
      this.persistentArbiter.close(entry, reason, dismissPresentation)
    } else {
      this.transientArbiter.close(entry, reason, dismissPresentation)
    }
  }

  private cleanup(
    entry: ManagedNotificationEntry,
    reason: NotificationCloseReason,
    dismissPresentation: boolean
  ): void {
    if (entry.disposed) return
    entry.disposed = true

    const presentation = entry.presentation
    entry.presentation = undefined
    entry.deadlineTask?.cancel()
    entry.expiryTask?.cancel()
    entry.deadlineTask = undefined
    entry.expiryTask = undefined
    this.byLogicalId.delete(entry.logicalId)
    if (entry.identity && this.byIdentity.get(entry.identity) === entry) {
      this.byIdentity.delete(entry.identity)
    }

    if (dismissPresentation) this.dismissPresentation(presentation)
    this.emitLifecycle(entry, reason)
    entry.record.dispose()
  }

  private dismissPresentation(presentation?: NotificationPresentationHandle): void {
    if (!presentation) return
    try {
      presentation.dismiss()
    } catch (error) {
      this.reportIntegrationError('presenter dismissal', error)
    }
  }

  private toHandle(entry: ManagedNotificationEntry): ManagedNotificationHandle {
    return Object.freeze({
      logicalId: entry.logicalId,
      dismiss: (reason: NotificationProgrammaticCloseReason = 'programmatic') =>
        this.dismiss(entry.logicalId, reason)
    })
  }

  private emitLifecycle(entry: ManagedNotificationEntry, reason: NotificationCloseReason): void {
    const listeners = Array.from(this.lifecycleListeners.get(entry.logicalId) ?? [])
    this.lifecycleListeners.delete(entry.logicalId)
    if (!this.onLifecycleEvent && listeners.length === 0) return

    const requests =
      entry.members && entry.members.size > 0 ? Array.from(entry.members.values()) : [entry.request]
    this.enqueueIntegrationEvent(
      Object.freeze({
        type: 'lifecycle',
        event: Object.freeze({
          logicalId: entry.logicalId,
          reason,
          requests: Object.freeze(requests)
        }),
        listeners: Object.freeze(listeners)
      })
    )
  }

  private registerLifecycleListener(
    entry: ManagedNotificationEntry,
    listener?: (event: NotificationLifecycleEvent) => void
  ): boolean {
    if (!listener) return false
    const listeners = this.lifecycleListeners.get(entry.logicalId) ?? new Set()
    const sizeBefore = listeners.size
    listeners.add(listener)
    this.lifecycleListeners.set(entry.logicalId, listeners)
    return listeners.size !== sizeBefore
  }

  private unregisterLifecycleListener(
    entry: ManagedNotificationEntry,
    listener: (event: NotificationLifecycleEvent) => void
  ): void {
    const listeners = this.lifecycleListeners.get(entry.logicalId)
    if (!listeners) return
    listeners.delete(listener)
    if (listeners.size === 0) {
      this.lifecycleListeners.delete(entry.logicalId)
    }
  }

  private recordDiagnostic(
    entry: ManagedNotificationEntry,
    reason: NotificationDiagnosticReason
  ): void {
    this.enqueueIntegrationEvent(
      Object.freeze({
        type: 'diagnostic',
        event: Object.freeze({
          code: entry.request.code,
          reason,
          priority: entry.priority,
          scopeKind:
            entry.request.kind === 'progress'
              ? 'operation'
              : 'scope' in entry.request && entry.request.scope
                ? 'scope'
                : 'key' in entry.request && entry.request.key
                  ? 'key'
                  : 'none'
        })
      })
    )
  }

  private enqueueIntegrationEvent(event: PendingIntegrationEvent): void {
    this.pendingIntegrationEvents.push(event)
    if (this.mutationDepth === 0 && !this.flushingIntegrationEvents) {
      this.flushIntegrationEvents()
    }
  }

  private runMutation<T>(operation: () => T): T {
    this.mutationDepth += 1
    try {
      return operation()
    } finally {
      this.mutationDepth -= 1
      if (this.mutationDepth === 0) this.flushIntegrationEvents()
    }
  }

  private flushIntegrationEvents(): void {
    if (this.flushingIntegrationEvents) return
    this.flushingIntegrationEvents = true
    try {
      let index = 0
      while (index < this.pendingIntegrationEvents.length) {
        const pending = this.pendingIntegrationEvents[index]
        index += 1
        if (pending.type === 'lifecycle') {
          this.dispatchLifecycle(pending.event, pending.listeners)
        } else {
          this.dispatchDiagnostic(pending.event)
        }
      }
      this.pendingIntegrationEvents.length = 0
    } finally {
      this.flushingIntegrationEvents = false
    }
  }

  private dispatchLifecycle(
    event: NotificationLifecycleEvent,
    listeners: readonly ((event: NotificationLifecycleEvent) => void)[]
  ): void {
    for (const listener of [
      ...(this.onLifecycleEvent ? [this.onLifecycleEvent] : []),
      ...listeners
    ]) {
      try {
        listener(event)
      } catch (error) {
        this.reportIntegrationError('lifecycle listener', error)
      }
    }
  }

  private dispatchDiagnostic(event: NotificationDiagnosticEvent): void {
    try {
      this.diagnostics.record(event)
    } catch (error) {
      this.reportIntegrationError('diagnostics', error)
    }
  }

  private reportIntegrationError(boundary: string, error: unknown): void {
    console.error(`[NotificationManager] ${boundary} failed`, error)
  }
}
