import type {
  EpisodeRegistry,
  EpisodeSnapshot,
  NotificationClock,
  NotificationScheduler,
  ResolvedSemanticNotification,
  ScheduledNotificationTask,
  SemanticNotificationDelivery,
  SemanticNotificationIntent,
  SemanticNotificationTargetKind
} from '@shared/notifications'
import { NOTIFICATION_POLICY_DEFAULTS, resolveSemanticNotification } from '@shared/notifications'

export type NotificationWindowTarget = Readonly<{
  windowId: number
  webContentsId: number
  kind: SemanticNotificationTargetKind
}>

export interface WindowNotificationTargetPort {
  getTargetForWindow(windowId: number): Promise<NotificationWindowTarget | undefined>
  getTargetByWebContents(webContentsId: number): Promise<NotificationWindowTarget | undefined>
  getFocusedTarget(): Promise<NotificationWindowTarget | undefined>
  getExistingTargets(): Promise<readonly NotificationWindowTarget[]>
  send(target: NotificationWindowTarget, delivery: SemanticNotificationDelivery): Promise<boolean>
}

export type WindowNotificationDiagnosticReason =
  | 'no-compatible-target'
  | 'delivery-failed'
  | 'pending-expired'
  | 'pending-recovered'
  | 'pending-stale'
  | 'actionable-overflow'

export type WindowNotificationDiagnosticEvent = Readonly<{
  code: SemanticNotificationIntent['code']
  reason: WindowNotificationDiagnosticReason
  priority: number
  scopeKind: 'scope' | 'key'
}>

export interface WindowNotificationDiagnostics {
  record(event: WindowNotificationDiagnosticEvent): void
}

export const silentWindowNotificationDiagnostics: WindowNotificationDiagnostics = Object.freeze({
  record: () => undefined
})

export type WindowNotificationOccurrenceOptions = Readonly<{
  originWindowId?: number
}>

export type WindowNotificationSource = Readonly<{
  webContentsId: number
}>

export type WindowNotificationAvailabilityChange = Readonly<{
  unavailableWebContentsIds?: readonly number[]
}>

export type WindowNotificationRouterDependencies = Readonly<{
  clock: NotificationClock
  scheduler: NotificationScheduler
  episodes: EpisodeRegistry
  targets: WindowNotificationTargetPort
  diagnostics?: WindowNotificationDiagnostics
  pendingActionableCapacity?: number
  resolveIntent?: (intent: SemanticNotificationIntent) => ResolvedSemanticNotification
}>

type ActiveEpisodeRecord = {
  resolved: ResolvedSemanticNotification
  originWindowId?: number
}

type PendingActionableRecord = ActiveEpisodeRecord & {
  episodeId: string
  order: number
  expiresAt?: number
  expiryTask?: ScheduledNotificationTask
}

const isTargetCompatible = (
  target: NotificationWindowTarget,
  resolved: ResolvedSemanticNotification
): boolean =>
  resolved.routing.compatibility === 'any' || resolved.routing.compatibility === target.kind

export class WindowNotificationRouter {
  private readonly clock: NotificationClock
  private readonly scheduler: NotificationScheduler
  private readonly episodes: EpisodeRegistry
  private readonly targets: WindowNotificationTargetPort
  private readonly diagnostics: WindowNotificationDiagnostics
  private readonly pendingActionableCapacity: number
  private readonly resolveIntent: (
    intent: SemanticNotificationIntent
  ) => ResolvedSemanticNotification
  private readonly activeByEpisodeId = new Map<string, ActiveEpisodeRecord>()
  private readonly deliveredByEpisodeId = new Map<string, NotificationWindowTarget>()
  private readonly pendingByEpisodeId = new Map<string, PendingActionableRecord>()
  private readonly unsubscribeEpisodes: () => void
  private serial: Promise<void> = Promise.resolve()
  private pendingSequence = 0
  private disposed = false

  constructor(dependencies: WindowNotificationRouterDependencies) {
    const capacity =
      dependencies.pendingActionableCapacity ??
      NOTIFICATION_POLICY_DEFAULTS.mainPendingActionableCapacity
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('Pending actionable capacity must be a positive integer')
    }

    this.clock = dependencies.clock
    this.scheduler = dependencies.scheduler
    this.episodes = dependencies.episodes
    this.targets = dependencies.targets
    this.diagnostics = dependencies.diagnostics ?? silentWindowNotificationDiagnostics
    this.pendingActionableCapacity = capacity
    this.resolveIntent = dependencies.resolveIntent ?? resolveSemanticNotification
    this.unsubscribeEpisodes = this.episodes.subscribe((event) => {
      if (event.type !== 'closed') return
      void this.enqueue(() => this.handleEpisodeClosed(event.episode)).catch((error) => {
        console.error('[WindowNotificationRouter] episode close failed', error)
      })
    })
  }

  occur(
    intent: SemanticNotificationIntent,
    options: WindowNotificationOccurrenceOptions = {}
  ): Promise<string> {
    return this.enqueue(async () => {
      this.assertActive()
      const resolved = this.resolveIntent(intent)
      const episode = this.episodes.occur(resolved.episodeIdentity, resolved.quietTtlMs)
      if (episode.suppressed) {
        return episode.id
      }

      const existing = this.activeByEpisodeId.get(episode.id)
      const active: ActiveEpisodeRecord = {
        resolved,
        ...(options.originWindowId !== undefined
          ? { originWindowId: options.originWindowId }
          : existing?.originWindowId !== undefined
            ? { originWindowId: existing.originWindowId }
            : {})
      }
      this.activeByEpisodeId.set(episode.id, active)

      const deliveredTarget = this.deliveredByEpisodeId.get(episode.id)
      if (deliveredTarget) {
        const currentTarget = await this.targets.getTargetByWebContents(
          deliveredTarget.webContentsId
        )
        if (
          currentTarget &&
          currentTarget.kind === deliveredTarget.kind &&
          (await this.trySend(currentTarget, {
            kind: 'occur',
            episodeId: episode.id,
            intent: resolved.intent
          }))
        ) {
          this.deliveredByEpisodeId.set(episode.id, currentTarget)
          return episode.id
        }
        this.deliveredByEpisodeId.delete(episode.id)
      }

      const target = await this.deliverOccurrence(
        episode.id,
        active,
        deliveredTarget ? new Set([deliveredTarget.webContentsId]) : undefined
      )
      if (target) {
        this.removePending(episode.id)
        this.deliveredByEpisodeId.set(episode.id, target)
        return episode.id
      }

      if (resolved.routing.waitWhenUnavailable) {
        this.offerPending(episode.id, active)
      } else {
        this.recordDiagnostic(resolved, 'no-compatible-target')
      }
      return episode.id
    })
  }

  recover(intent: SemanticNotificationIntent): Promise<boolean> {
    return this.enqueue(async () => {
      this.assertActive()
      const resolved = this.resolveIntent(intent)
      const closed = this.episodes.recover(resolved.episodeIdentity)
      if (!closed) return false

      await this.handleEpisodeClosed(closed)
      return true
    })
  }

  acknowledgePresentation(episodeId: string, source: WindowNotificationSource): Promise<boolean> {
    return this.enqueue(async () => {
      this.assertActive()
      const target = this.deliveredByEpisodeId.get(episodeId)
      const active = this.activeByEpisodeId.get(episodeId)
      if (!target || !active || source.webContentsId !== target.webContentsId) {
        return false
      }

      this.deliveredByEpisodeId.delete(episodeId)
      this.activeByEpisodeId.delete(episodeId)
      this.episodes.suppress(active.resolved.episodeIdentity)
      return true
    })
  }

  availabilityChanged(change: WindowNotificationAvailabilityChange = {}): Promise<void> {
    return this.enqueue(async () => {
      this.assertActive()
      const unavailableWebContentsIds = new Set(change.unavailableWebContentsIds)
      await this.reconcileDeliveredTargets(unavailableWebContentsIds)
      await this.flushPending(unavailableWebContentsIds)
    })
  }

  whenIdle(): Promise<void> {
    return this.serial
  }

  dispose(): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed) return
      this.disposed = true
      this.unsubscribeEpisodes()
      for (const pending of this.pendingByEpisodeId.values()) {
        pending.expiryTask?.cancel()
      }
      this.pendingByEpisodeId.clear()
      this.deliveredByEpisodeId.clear()
      this.activeByEpisodeId.clear()
    })
  }

  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.serial.then(operation, operation)
    this.serial = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('WindowNotificationRouter is disposed')
    }
  }

  private async deliverOccurrence(
    episodeId: string,
    active: ActiveEpisodeRecord,
    excludedWebContentsIds: ReadonlySet<number> = new Set()
  ): Promise<NotificationWindowTarget | undefined> {
    const delivery: SemanticNotificationDelivery = Object.freeze({
      kind: 'occur',
      episodeId,
      intent: active.resolved.intent
    })
    for (const target of await this.resolveCandidateTargets(active)) {
      if (excludedWebContentsIds.has(target.webContentsId)) continue
      if (await this.trySend(target, delivery)) {
        return target
      }
    }
    return undefined
  }

  private async resolveCandidateTargets(
    active: ActiveEpisodeRecord
  ): Promise<NotificationWindowTarget[]> {
    const ordered: NotificationWindowTarget[] = []
    const seen = new Set<number>()
    const add = (target?: NotificationWindowTarget) => {
      if (
        !target ||
        seen.has(target.webContentsId) ||
        !isTargetCompatible(target, active.resolved)
      ) {
        return
      }
      seen.add(target.webContentsId)
      ordered.push(target)
    }

    if (active.originWindowId !== undefined) {
      add(await this.targets.getTargetForWindow(active.originWindowId))
    }
    add(await this.targets.getFocusedTarget())

    const existing = await this.targets.getExistingTargets()
    for (const target of existing) {
      if (target.kind === active.resolved.routing.preferredTarget) add(target)
    }
    for (const target of existing) add(target)
    return ordered
  }

  private async trySend(
    target: NotificationWindowTarget,
    delivery: SemanticNotificationDelivery,
    resolved?: ResolvedSemanticNotification
  ): Promise<boolean> {
    try {
      const sent = await this.targets.send(target, delivery)
      if (!sent) {
        const current = this.activeByEpisodeId.get(delivery.episodeId)?.resolved ?? resolved
        if (current) this.recordDiagnostic(current, 'delivery-failed')
      }
      return sent
    } catch (error) {
      const current = this.activeByEpisodeId.get(delivery.episodeId)?.resolved ?? resolved
      if (current) this.recordDiagnostic(current, 'delivery-failed')
      console.error('[WindowNotificationRouter] target delivery failed', error)
      return false
    }
  }

  private offerPending(episodeId: string, active: ActiveEpisodeRecord): void {
    const existing = this.pendingByEpisodeId.get(episodeId)
    if (existing) {
      existing.resolved = active.resolved
      existing.originWindowId = active.originWindowId
      return
    }

    const pendingTtlMs =
      active.resolved.routing.pendingTtlMs ??
      NOTIFICATION_POLICY_DEFAULTS.mainPendingActionableTtlMs
    if (pendingTtlMs !== Infinity && (!Number.isFinite(pendingTtlMs) || pendingTtlMs <= 0)) {
      throw new RangeError('Pending actionable TTL must be positive or Infinity')
    }

    const pending: PendingActionableRecord = {
      episodeId,
      resolved: active.resolved,
      originWindowId: active.originWindowId,
      order: ++this.pendingSequence
    }
    if (pendingTtlMs !== Infinity) {
      pending.expiresAt = this.clock.now() + pendingTtlMs
      pending.expiryTask = this.scheduler.schedule(pendingTtlMs, () => {
        void this.enqueue(() => this.expirePending(episodeId)).catch((error) => {
          console.error('[WindowNotificationRouter] pending expiry failed', error)
        })
      })
    }
    this.pendingByEpisodeId.set(episodeId, pending)
    this.enforcePendingCapacity()
  }

  private enforcePendingCapacity(): void {
    if (this.pendingByEpisodeId.size <= this.pendingActionableCapacity) return

    const victim = Array.from(this.pendingByEpisodeId.values()).sort(
      (left, right) => left.resolved.priority - right.resolved.priority || right.order - left.order
    )[0]
    if (!victim) return

    this.dropPending(victim, 'actionable-overflow', true)
  }

  private expirePending(episodeId: string): void {
    const pending = this.pendingByEpisodeId.get(episodeId)
    if (!pending) return
    this.dropPending(pending, 'pending-expired', true)
  }

  private dropPending(
    pending: PendingActionableRecord,
    reason: WindowNotificationDiagnosticReason,
    suppressEpisode: boolean
  ): void {
    this.removePending(pending.episodeId)
    this.recordDiagnostic(pending.resolved, reason)
    if (suppressEpisode) {
      this.episodes.suppress(pending.resolved.episodeIdentity)
      this.activeByEpisodeId.delete(pending.episodeId)
    }
  }

  private removePending(episodeId: string): PendingActionableRecord | undefined {
    const pending = this.pendingByEpisodeId.get(episodeId)
    if (!pending) return undefined
    pending.expiryTask?.cancel()
    this.pendingByEpisodeId.delete(episodeId)
    return pending
  }

  private async flushPending(
    unavailableWebContentsIds: ReadonlySet<number> = new Set()
  ): Promise<void> {
    const pendingRecords = Array.from(this.pendingByEpisodeId.values()).sort(
      (left, right) => right.resolved.priority - left.resolved.priority || left.order - right.order
    )

    for (const pending of pendingRecords) {
      if (this.pendingByEpisodeId.get(pending.episodeId) !== pending) continue
      if (pending.expiresAt !== undefined && pending.expiresAt <= this.clock.now()) {
        this.dropPending(pending, 'pending-expired', true)
        continue
      }
      const episode = this.episodes.get(pending.resolved.episodeIdentity)
      if (!episode || episode.id !== pending.episodeId || episode.suppressed) {
        this.dropPending(pending, 'pending-stale', false)
        this.activeByEpisodeId.delete(pending.episodeId)
        continue
      }

      const target = await this.deliverOccurrence(
        pending.episodeId,
        pending,
        unavailableWebContentsIds
      )
      if (!target) continue

      this.removePending(pending.episodeId)
      this.deliveredByEpisodeId.set(pending.episodeId, target)
    }
  }

  private async reconcileDeliveredTargets(
    unavailableWebContentsIds: ReadonlySet<number>
  ): Promise<void> {
    for (const [episodeId, deliveredTarget] of Array.from(this.deliveredByEpisodeId.entries())) {
      const currentTarget = unavailableWebContentsIds.has(deliveredTarget.webContentsId)
        ? undefined
        : await this.targets.getTargetByWebContents(deliveredTarget.webContentsId)
      if (currentTarget?.kind === deliveredTarget.kind) {
        this.deliveredByEpisodeId.set(episodeId, currentTarget)
        continue
      }

      this.deliveredByEpisodeId.delete(episodeId)
      const active = this.activeByEpisodeId.get(episodeId)
      if (!active) continue
      const episode = this.episodes.get(active.resolved.episodeIdentity)
      if (!episode || episode.id !== episodeId || episode.suppressed) {
        this.activeByEpisodeId.delete(episodeId)
        continue
      }

      if (active.resolved.routing.waitWhenUnavailable) {
        this.offerPending(episodeId, active)
      } else {
        this.recordDiagnostic(active.resolved, 'no-compatible-target')
      }
    }
  }

  private async handleEpisodeClosed(episode: EpisodeSnapshot): Promise<void> {
    const active = this.activeByEpisodeId.get(episode.id)
    const pending = this.removePending(episode.id)
    const target = this.deliveredByEpisodeId.get(episode.id)
    this.deliveredByEpisodeId.delete(episode.id)
    this.activeByEpisodeId.delete(episode.id)

    if (pending) {
      this.recordDiagnostic(
        pending.resolved,
        episode.closeReason === 'recovered' ? 'pending-recovered' : 'pending-stale'
      )
    }
    if (!target || !active) return

    await this.trySend(
      target,
      {
        kind: 'recover',
        episodeId: episode.id
      },
      active.resolved
    )
  }

  private recordDiagnostic(
    resolved: ResolvedSemanticNotification,
    reason: WindowNotificationDiagnosticReason
  ): void {
    try {
      this.diagnostics.record(
        Object.freeze({
          code: resolved.intent.code,
          reason,
          priority: resolved.priority,
          scopeKind:
            'scope' in resolved.presentation && resolved.presentation.scope ? 'scope' : 'key'
        })
      )
    } catch (error) {
      console.error('[WindowNotificationRouter] diagnostics failed', error)
    }
  }
}
