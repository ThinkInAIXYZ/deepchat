import type { NotificationClock } from './timing'

export type OperationOwner =
  | Readonly<{ process: 'main' }>
  | Readonly<{ process: 'renderer'; rendererId: string }>

export type OperationStatus = 'created' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type OperationSnapshot = Readonly<{
  id: string
  owner: OperationOwner
  status: OperationStatus
  progress?: number
  failureCode?: string
  createdAt: number
  updatedAt: number
}>

export type OperationRegistryEvent =
  | Readonly<{ type: 'created'; operation: OperationSnapshot }>
  | Readonly<{ type: 'started'; operation: OperationSnapshot }>
  | Readonly<{ type: 'progressed'; operation: OperationSnapshot }>
  | Readonly<{ type: 'settled'; operation: OperationSnapshot }>

export type OperationRegistryListener = (event: OperationRegistryEvent) => void

export class OperationRegistry {
  private readonly activeById = new Map<string, OperationSnapshot>()
  private readonly listeners = new Set<OperationRegistryListener>()
  private readonly pendingEvents: OperationRegistryEvent[] = []
  private emitting = false

  constructor(private readonly clock: NotificationClock) {}

  create(id: string, owner: OperationOwner): OperationSnapshot {
    const normalizedId = this.normalizeId(id)
    if (this.activeById.has(normalizedId)) {
      throw new Error(`Operation "${normalizedId}" already exists`)
    }

    const now = this.clock.now()
    const normalizedOwner = this.normalizeOwner(owner)
    const snapshot: OperationSnapshot = Object.freeze({
      id: normalizedId,
      owner: normalizedOwner,
      status: 'created',
      createdAt: now,
      updatedAt: now
    })
    this.activeById.set(normalizedId, snapshot)
    this.emit(Object.freeze({ type: 'created', operation: snapshot }))
    return snapshot
  }

  start(id: string): OperationSnapshot {
    const current = this.requireActive(id)
    if (current.status !== 'created') {
      throw new Error(`Operation "${current.id}" cannot start from ${current.status}`)
    }

    return this.update(current, { status: 'running' }, 'started')
  }

  reportProgress(id: string, progress: number): OperationSnapshot {
    const current = this.requireActive(id)
    if (current.status !== 'running') {
      throw new Error(`Operation "${id}" cannot report progress from ${current.status}`)
    }
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
      throw new RangeError('Operation progress must be a finite number between 0 and 1')
    }
    if (current.progress !== undefined && progress < current.progress) {
      throw new RangeError('Operation progress must not move backwards')
    }

    return this.update(current, { progress }, 'progressed')
  }

  succeed(id: string): OperationSnapshot {
    return this.settle(id, 'succeeded', undefined, false)
  }

  fail(id: string, failureCode: string): OperationSnapshot {
    const normalizedFailureCode = this.normalizeFailureCode(failureCode)
    return this.settle(id, 'failed', normalizedFailureCode, false)
  }

  cancel(id: string): OperationSnapshot {
    return this.settle(id, 'cancelled', undefined, true)
  }

  get(id: string): OperationSnapshot | undefined {
    return this.activeById.get(this.normalizeId(id))
  }

  subscribe(listener: OperationRegistryListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this.activeById.clear()
    this.listeners.clear()
  }

  private settle(
    id: string,
    status: Extract<OperationStatus, 'succeeded' | 'failed' | 'cancelled'>,
    failureCode: string | undefined,
    allowCreated: boolean
  ): OperationSnapshot {
    const current = this.requireActive(id)
    if (current.status !== 'running' && !(allowCreated && current.status === 'created')) {
      throw new Error(`Operation "${current.id}" cannot settle from ${current.status}`)
    }

    const snapshot: OperationSnapshot = Object.freeze({
      ...current,
      status,
      ...(failureCode ? { failureCode } : {}),
      updatedAt: this.clock.now()
    })
    this.activeById.delete(current.id)
    this.emit(Object.freeze({ type: 'settled', operation: snapshot }))
    return snapshot
  }

  private update(
    current: OperationSnapshot,
    patch: Partial<OperationSnapshot>,
    eventType: Extract<OperationRegistryEvent['type'], 'started' | 'progressed'>
  ): OperationSnapshot {
    const snapshot: OperationSnapshot = Object.freeze({
      ...current,
      ...patch,
      updatedAt: this.clock.now()
    })
    this.activeById.set(current.id, snapshot)
    this.emit(Object.freeze({ type: eventType, operation: snapshot }))
    return snapshot
  }

  private requireActive(id: string): OperationSnapshot {
    const normalizedId = this.normalizeId(id)
    const operation = this.activeById.get(normalizedId)
    if (!operation) {
      throw new Error(`Operation "${normalizedId}" is not active`)
    }
    return operation
  }

  private normalizeId(id: string): string {
    const normalized = id.trim()
    if (!normalized) {
      throw new TypeError('Operation ID must not be empty')
    }
    return normalized
  }

  private normalizeOwner(owner: OperationOwner): OperationOwner {
    if (owner.process === 'main') {
      return Object.freeze({ process: 'main' })
    }
    if (owner.process !== 'renderer' || typeof owner.rendererId !== 'string') {
      throw new TypeError('Operation owner must be main or renderer')
    }

    const rendererId = owner.rendererId.trim()
    if (!rendererId) {
      throw new TypeError('Renderer-owned operations require a renderer ID')
    }
    return Object.freeze({ process: 'renderer', rendererId })
  }

  private normalizeFailureCode(failureCode: string): string {
    const normalized = failureCode.trim()
    if (
      !normalized ||
      normalized.length > 96 ||
      !/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)*$/.test(normalized)
    ) {
      throw new TypeError('Operation failure code must be a stable dotted identifier')
    }
    return normalized
  }

  private emit(event: OperationRegistryEvent): void {
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
            console.error('[OperationRegistry] listener failed', error)
          }
        }
      }
      this.pendingEvents.length = 0
    } finally {
      this.emitting = false
    }
  }
}
