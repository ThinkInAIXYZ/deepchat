import type { NotificationClock, NotificationScheduler, ScheduledNotificationTask } from './timing'

export type EpisodeCloseReason = 'recovered' | 'quiet-expired'

export type EpisodeSnapshot = Readonly<{
  id: string
  identity: string
  state: 'active' | 'closed'
  occurrenceCount: number
  firstSeenAt: number
  lastSeenAt: number
  suppressed: boolean
  closeReason?: EpisodeCloseReason
}>

export type EpisodeRegistryEvent =
  | Readonly<{ type: 'opened'; episode: EpisodeSnapshot }>
  | Readonly<{ type: 'updated'; episode: EpisodeSnapshot }>
  | Readonly<{ type: 'suppressed'; episode: EpisodeSnapshot }>
  | Readonly<{ type: 'closed'; episode: EpisodeSnapshot }>

export type EpisodeRegistryListener = (event: EpisodeRegistryEvent) => void

type ActiveEpisode = {
  snapshot: EpisodeSnapshot
  quietTtlMs?: number
  quietTask?: ScheduledNotificationTask
}

export class EpisodeRegistry {
  private readonly activeByIdentity = new Map<string, ActiveEpisode>()
  private readonly listeners = new Set<EpisodeRegistryListener>()
  private readonly pendingEvents: EpisodeRegistryEvent[] = []
  private sequence = 0
  private emitting = false

  constructor(
    private readonly clock: NotificationClock,
    private readonly scheduler: NotificationScheduler
  ) {}

  occur(identity: string, quietTtlMs?: number): EpisodeSnapshot {
    const normalizedIdentity = this.normalizeIdentity(identity)
    const normalizedQuietTtlMs = this.normalizeQuietTtl(quietTtlMs)
    const now = this.clock.now()
    const active = this.activeByIdentity.get(normalizedIdentity)
    const effectiveQuietTtlMs =
      active && quietTtlMs === undefined ? active.quietTtlMs : normalizedQuietTtlMs
    const quietTask = this.scheduleQuietClose(normalizedIdentity, effectiveQuietTtlMs)

    if (active) {
      active.quietTask?.cancel()
      active.snapshot = Object.freeze({
        ...active.snapshot,
        occurrenceCount: active.snapshot.occurrenceCount + 1,
        lastSeenAt: now
      })
      active.quietTtlMs = effectiveQuietTtlMs
      active.quietTask = quietTask
      this.emit(Object.freeze({ type: 'updated', episode: active.snapshot }))
      return active.snapshot
    }

    const snapshot: EpisodeSnapshot = Object.freeze({
      id: `episode-${++this.sequence}`,
      identity: normalizedIdentity,
      state: 'active',
      occurrenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      suppressed: false
    })
    const episode: ActiveEpisode = {
      snapshot,
      quietTtlMs: effectiveQuietTtlMs,
      quietTask
    }
    this.activeByIdentity.set(normalizedIdentity, episode)
    this.emit(Object.freeze({ type: 'opened', episode: snapshot }))
    return snapshot
  }

  suppress(identity: string): EpisodeSnapshot | undefined {
    const active = this.activeByIdentity.get(this.normalizeIdentity(identity))
    if (!active || active.snapshot.suppressed) {
      return active?.snapshot
    }

    active.snapshot = Object.freeze({
      ...active.snapshot,
      suppressed: true
    })
    this.emit(Object.freeze({ type: 'suppressed', episode: active.snapshot }))
    return active.snapshot
  }

  recover(identity: string): EpisodeSnapshot | undefined {
    return this.close(this.normalizeIdentity(identity), 'recovered')
  }

  get(identity: string): EpisodeSnapshot | undefined {
    return this.activeByIdentity.get(this.normalizeIdentity(identity))?.snapshot
  }

  isActive(identity: string): boolean {
    return this.activeByIdentity.has(this.normalizeIdentity(identity))
  }

  subscribe(listener: EpisodeRegistryListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    for (const episode of this.activeByIdentity.values()) {
      episode.quietTask?.cancel()
    }
    this.activeByIdentity.clear()
    this.listeners.clear()
  }

  private close(identity: string, reason: EpisodeCloseReason): EpisodeSnapshot | undefined {
    const active = this.activeByIdentity.get(identity)
    if (!active) return undefined

    active.quietTask?.cancel()
    this.activeByIdentity.delete(identity)
    const snapshot: EpisodeSnapshot = Object.freeze({
      ...active.snapshot,
      state: 'closed',
      closeReason: reason
    })
    this.emit(Object.freeze({ type: 'closed', episode: snapshot }))
    return snapshot
  }

  private scheduleQuietClose(
    identity: string,
    quietTtlMs?: number
  ): ScheduledNotificationTask | undefined {
    if (quietTtlMs === undefined || quietTtlMs === Infinity) {
      return undefined
    }

    return this.scheduler.schedule(quietTtlMs, () => {
      this.close(identity, 'quiet-expired')
    })
  }

  private normalizeQuietTtl(quietTtlMs?: number): number | undefined {
    if (quietTtlMs === undefined || quietTtlMs === Infinity) {
      return quietTtlMs
    }
    if (!Number.isFinite(quietTtlMs) || quietTtlMs <= 0) {
      throw new RangeError('quietTtlMs must be a positive finite number or Infinity')
    }
    return quietTtlMs
  }

  private normalizeIdentity(identity: string): string {
    const normalized = identity.trim()
    if (!normalized) {
      throw new TypeError('Episode identity must not be empty')
    }
    return normalized
  }

  private emit(event: EpisodeRegistryEvent): void {
    this.pendingEvents.push(event)
    if (this.emitting) return

    this.emitting = true
    try {
      let index = 0
      while (index < this.pendingEvents.length) {
        const pending = this.pendingEvents[index]
        index += 1
        for (const listener of Array.from(this.listeners)) {
          try {
            listener(pending)
          } catch (error) {
            console.error('[EpisodeRegistry] listener failed', error)
          }
        }
      }
      this.pendingEvents.length = 0
    } finally {
      this.emitting = false
    }
  }
}
