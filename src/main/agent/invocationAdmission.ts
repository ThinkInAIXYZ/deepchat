import { types as utilTypes } from 'node:util'
import {
  BoundedNumberRing,
  MAX_DIAGNOSTIC_DISTRIBUTION_SAMPLES,
  summarizeNumberDistribution,
  type NumberDistribution
} from '@/lib/boundedNumberRing'

export const DEFAULT_AGENT_INVOCATION_CAPACITY = 6
export const DEFAULT_AGENT_INVOCATION_MAX_PENDING = 256
const MAX_PENDING_OBSERVATIONS = 512
const OBSERVATION_DRAIN_BATCH_SIZE = 16

export interface AgentInvocationPermit {
  release(): void
}

export type AgentInvocationLeaseState = 'suspended' | 'acquiring' | 'active' | 'released'

export interface AgentInvocationLease {
  readonly state: AgentInvocationLeaseState
  resume(options?: { signal?: AbortSignal }): Promise<void>
  suspend(): void
  release(): void
}

export interface AgentInvocationAdmissionOptions {
  ownerId: string
  maxActiveForOwner?: number
  signal?: AbortSignal
  correlation?: AgentInvocationAdmissionCorrelation
}

export interface AgentInvocationAdmissionCorrelation {
  kind: 'live_delegation'
  parentSessionId: string
  delegationId: string
  turnId: string
}

export interface AgentInvocationAdmissionSnapshot {
  capacity: number
  active: number
  pending: number
  pendingOwners: number
  closed: boolean
  activeHighWater: number
  pendingHighWater: number
  granted: number
  rejected: number
  observationsDropped: number
  waitMs: NumberDistribution
  holdMs: NumberDistribution
}

type AgentInvocationAdmissionState = Pick<
  AgentInvocationAdmissionSnapshot,
  'capacity' | 'active' | 'pending'
>

export type AgentInvocationAdmissionObservation =
  | ({
      type: 'queued'
      acquisitionSeq: number
    } & AgentInvocationAdmissionCorrelation &
      AgentInvocationAdmissionState)
  | ({
      type: 'granted'
      acquisitionSeq: number
      waitMs: number
    } & AgentInvocationAdmissionCorrelation &
      AgentInvocationAdmissionState)
  | ({
      type: 'released'
      acquisitionSeq: number
      holdMs: number
      reason: 'permit_released' | 'lease_suspended' | 'lease_released'
      active: number
      pending: number
    } & AgentInvocationAdmissionCorrelation)
  | ({
      type: 'rejected'
      acquisitionSeq: number
      waitMs: number
      reason: 'queue_full' | 'aborted' | 'closed'
    } & AgentInvocationAdmissionCorrelation &
      AgentInvocationAdmissionState)
  | ({
      type: 'closed'
    } & Omit<AgentInvocationAdmissionSnapshot, 'pendingOwners' | 'closed'>)

export interface AgentInvocationAdmissionDiagnosticsOptions {
  observe?: (observation: AgentInvocationAdmissionObservation) => void
  now?: () => number
}

export interface AgentInvocationAdmissionPort {
  acquire(options: AgentInvocationAdmissionOptions): Promise<AgentInvocationPermit>
  createLease(options: AgentInvocationAdmissionOptions): AgentInvocationLease
  run<T>(options: AgentInvocationAdmissionOptions, task: () => Promise<T>): Promise<T>
}

export class AgentInvocationAdmissionClosedError extends Error {
  constructor(message = 'Agent invocation admission is closed.') {
    super(message)
    this.name = 'AgentInvocationAdmissionClosedError'
  }
}

export class AgentInvocationAdmissionAbortedError extends Error {
  constructor() {
    super('Agent invocation admission was cancelled while queued.')
    this.name = 'AgentInvocationAdmissionAbortedError'
  }
}

export class AgentInvocationAdmissionQueueFullError extends Error {
  constructor(maxPending: number) {
    super(`Agent invocation admission queue is full (${maxPending} pending).`)
    this.name = 'AgentInvocationAdmissionQueueFullError'
  }
}

interface AdmissionWaiter {
  ownerId: string
  maxActiveForOwner: number
  correlation?: AgentInvocationAdmissionCorrelation
  acquisitionSeq: number
  queuedAt: number | undefined
  resolve: (permit: AgentInvocationPermit) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
  settled: boolean
}

interface InternalAgentInvocationPermit extends AgentInvocationPermit {
  releaseWithReason(reason: 'permit_released' | 'lease_suspended' | 'lease_released'): void
}

export class AgentInvocationAdmission implements AgentInvocationAdmissionPort {
  private readonly ownerQueues = new Map<string, AdmissionWaiter[]>()
  private readonly ownerRing: string[] = []
  private readonly activeByOwner = new Map<string, number>()
  private active = 0
  private pending = 0
  private closedError: AgentInvocationAdmissionClosedError | null = null
  private acquisitionSequence = 0
  private activeHighWater = 0
  private pendingHighWater = 0
  private granted = 0
  private rejected = 0
  private observationsDropped = 0
  private readonly pendingObservations: AgentInvocationAdmissionObservation[] = []
  private observationDrain: NodeJS.Immediate | undefined
  private readonly observationFlushWaiters = new Set<() => void>()
  private readonly waitSamples = new BoundedNumberRing(MAX_DIAGNOSTIC_DISTRIBUTION_SAMPLES)
  private readonly holdSamples = new BoundedNumberRing(MAX_DIAGNOSTIC_DISTRIBUTION_SAMPLES)
  private readonly observe: (observation: AgentInvocationAdmissionObservation) => void
  private readonly now: () => number

  constructor(
    private readonly capacity = DEFAULT_AGENT_INVOCATION_CAPACITY,
    private readonly maxPending = DEFAULT_AGENT_INVOCATION_MAX_PENDING,
    diagnostics: AgentInvocationAdmissionDiagnosticsOptions = {}
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Agent invocation capacity must be a positive integer.')
    }
    if (!Number.isInteger(maxPending) || maxPending < 0) {
      throw new Error('Agent invocation pending limit must be a non-negative integer.')
    }
    this.observe = diagnostics.observe ?? (() => undefined)
    this.now = diagnostics.now ?? performance.now.bind(performance)
  }

  acquire(options: AgentInvocationAdmissionOptions): Promise<AgentInvocationPermit> {
    let ownerId: string
    let maxActiveForOwner: number
    try {
      ownerId = normalizeOwnerId(options.ownerId)
      maxActiveForOwner = normalizeOwnerLimit(options.maxActiveForOwner, this.capacity)
    } catch (error) {
      return Promise.reject(error)
    }
    const acquisitionSeq = this.nextAcquisitionSequence()
    const startedAt = this.readClock()
    const correlation = this.snapshotCorrelation(options.correlation)
    if (this.closedError) {
      this.recordImmediateRejection(correlation, acquisitionSeq, 'closed')
      return Promise.reject(this.closedError)
    }
    if (options.signal?.aborted) {
      this.recordImmediateRejection(correlation, acquisitionSeq, 'aborted')
      return Promise.reject(new AgentInvocationAdmissionAbortedError())
    }
    if (
      this.active < this.capacity &&
      this.pending === 0 &&
      this.getActiveForOwner(ownerId) < maxActiveForOwner
    ) {
      return Promise.resolve(this.grant(ownerId, correlation, acquisitionSeq, startedAt))
    }
    if (this.pending >= this.maxPending) {
      this.recordImmediateRejection(correlation, acquisitionSeq, 'queue_full')
      return Promise.reject(new AgentInvocationAdmissionQueueFullError(this.maxPending))
    }

    return new Promise<AgentInvocationPermit>((resolve, reject) => {
      const waiter: AdmissionWaiter = {
        ownerId,
        maxActiveForOwner,
        correlation,
        acquisitionSeq,
        queuedAt: startedAt,
        resolve,
        reject,
        signal: options.signal,
        settled: false
      }
      if (options.signal) {
        waiter.onAbort = () => this.abortWaiter(waiter)
        options.signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      const queue = this.ownerQueues.get(ownerId)
      if (queue) {
        queue.push(waiter)
      } else {
        this.ownerQueues.set(ownerId, [waiter])
        this.ownerRing.push(ownerId)
      }
      this.pending += 1
      this.pendingHighWater = Math.max(this.pendingHighWater, this.pending)
      if (waiter.correlation) {
        this.emit({
          type: 'queued',
          ...waiter.correlation,
          acquisitionSeq,
          ...this.currentState()
        })
      }
      this.dispatch()
    })
  }

  createLease(options: AgentInvocationAdmissionOptions): AgentInvocationLease {
    return new StatefulAgentInvocationLease(this, options)
  }

  async run<T>(options: AgentInvocationAdmissionOptions, task: () => Promise<T>): Promise<T> {
    const permit = await this.acquire(options)
    try {
      if (options.signal?.aborted) {
        throw new AgentInvocationAdmissionAbortedError()
      }
      return await task()
    } finally {
      permit.release()
    }
  }

  close(reason = 'Agent invocation admission is closed.'): void {
    if (this.closedError) {
      return
    }
    this.closedError = new AgentInvocationAdmissionClosedError(reason)
    for (const queue of this.ownerQueues.values()) {
      for (const waiter of queue) {
        if (!waiter.settled) this.pending -= 1
        this.rejectWaiter(waiter, this.closedError, 'closed')
      }
    }
    this.ownerQueues.clear()
    this.ownerRing.splice(0)
    this.pending = 0
    const snapshot = this.snapshot()
    this.emit({
      type: 'closed',
      capacity: snapshot.capacity,
      active: snapshot.active,
      pending: snapshot.pending,
      activeHighWater: snapshot.activeHighWater,
      pendingHighWater: snapshot.pendingHighWater,
      granted: snapshot.granted,
      rejected: snapshot.rejected,
      observationsDropped: snapshot.observationsDropped,
      waitMs: snapshot.waitMs,
      holdMs: snapshot.holdMs
    })
  }

  flushObservations(): Promise<void> {
    if (this.pendingObservations.length === 0 && !this.observationDrain) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.observationFlushWaiters.add(resolve)
      this.scheduleObservationDrain()
    })
  }

  snapshot(): AgentInvocationAdmissionSnapshot {
    return {
      capacity: this.capacity,
      active: this.active,
      pending: this.pending,
      pendingOwners: this.ownerQueues.size,
      closed: this.closedError !== null,
      activeHighWater: this.activeHighWater,
      pendingHighWater: this.pendingHighWater,
      granted: this.granted,
      rejected: this.rejected,
      observationsDropped: this.observationsDropped,
      waitMs: summarizeNumberDistribution(this.waitSamples.snapshot()),
      holdMs: summarizeNumberDistribution(this.holdSamples.snapshot())
    }
  }

  private dispatch(): void {
    while (this.active < this.capacity && this.pending > 0 && this.ownerRing.length > 0) {
      const ownersInRound = this.ownerRing.length
      let grantedInRound = false

      for (
        let ownerIndex = 0;
        ownerIndex < ownersInRound && this.active < this.capacity;
        ownerIndex += 1
      ) {
        const ownerId = this.ownerRing.shift()!
        const queue = this.ownerQueues.get(ownerId)
        if (!queue || queue.length === 0) {
          this.ownerQueues.delete(ownerId)
          continue
        }

        const waiter = queue[0]
        if (this.getActiveForOwner(ownerId) >= waiter.maxActiveForOwner) {
          this.ownerRing.push(ownerId)
          continue
        }

        queue.shift()
        if (queue.length > 0) {
          this.ownerRing.push(ownerId)
        } else {
          this.ownerQueues.delete(ownerId)
        }
        if (waiter.settled) {
          continue
        }

        waiter.settled = true
        this.detachAbort(waiter)
        this.pending -= 1
        grantedInRound = true
        waiter.resolve(
          this.grant(ownerId, waiter.correlation, waiter.acquisitionSeq, waiter.queuedAt)
        )
      }

      if (!grantedInRound) {
        return
      }
    }
  }

  private abortWaiter(waiter: AdmissionWaiter): void {
    if (waiter.settled) {
      return
    }
    const queue = this.ownerQueues.get(waiter.ownerId)
    if (queue) {
      const index = queue.indexOf(waiter)
      if (index >= 0) {
        queue.splice(index, 1)
      }
      if (queue.length === 0) {
        this.ownerQueues.delete(waiter.ownerId)
        const ownerIndex = this.ownerRing.indexOf(waiter.ownerId)
        if (ownerIndex >= 0) {
          this.ownerRing.splice(ownerIndex, 1)
        }
      }
    }
    this.pending -= 1
    this.rejectWaiter(waiter, new AgentInvocationAdmissionAbortedError(), 'aborted')
    this.dispatch()
  }

  private rejectWaiter(waiter: AdmissionWaiter, error: Error, reason: 'aborted' | 'closed'): void {
    if (waiter.settled) {
      return
    }
    waiter.settled = true
    this.detachAbort(waiter)
    this.rejected += 1
    const waitDuration = this.elapsedSince(waiter.queuedAt)
    if (waitDuration.valid) this.waitSamples.push(waitDuration.value)
    if (waiter.correlation) {
      this.emit({
        type: 'rejected',
        ...waiter.correlation,
        acquisitionSeq: waiter.acquisitionSeq,
        waitMs: waitDuration.value,
        reason,
        ...this.currentState()
      })
    }
    waiter.reject(error)
  }

  private detachAbort(waiter: AdmissionWaiter): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort)
    }
  }

  private getActiveForOwner(ownerId: string): number {
    return this.activeByOwner.get(ownerId) ?? 0
  }

  private grant(
    ownerId: string,
    correlation: AgentInvocationAdmissionCorrelation | undefined,
    acquisitionSeq: number,
    startedAt: number | undefined
  ): InternalAgentInvocationPermit {
    this.active += 1
    this.activeByOwner.set(ownerId, this.getActiveForOwner(ownerId) + 1)
    this.activeHighWater = Math.max(this.activeHighWater, this.active)
    this.granted += 1
    const grantedAt = this.readClock()
    const waitDuration = this.elapsedBetween(startedAt, grantedAt)
    if (waitDuration.valid) this.waitSamples.push(waitDuration.value)
    if (correlation) {
      this.emit({
        type: 'granted',
        ...correlation,
        acquisitionSeq,
        waitMs: waitDuration.value,
        ...this.currentState()
      })
    }
    let released = false
    const releaseWithReason: InternalAgentInvocationPermit['releaseWithReason'] = (reason) => {
      if (released) {
        return
      }
      if (this.active <= 0) {
        throw new Error('Agent invocation permit accounting underflow.')
      }
      const ownerActive = this.getActiveForOwner(ownerId)
      if (ownerActive <= 0) {
        throw new Error(`Agent invocation owner permit accounting underflow: ${ownerId}`)
      }
      released = true
      this.active -= 1
      if (ownerActive === 1) {
        this.activeByOwner.delete(ownerId)
      } else {
        this.activeByOwner.set(ownerId, ownerActive - 1)
      }
      const holdDuration = this.elapsedSince(grantedAt)
      if (holdDuration.valid) this.holdSamples.push(holdDuration.value)
      if (correlation) {
        this.emit({
          type: 'released',
          ...correlation,
          acquisitionSeq,
          holdMs: holdDuration.value,
          reason,
          active: this.active,
          pending: this.pending
        })
      }
      this.dispatch()
    }
    return {
      release: () => releaseWithReason('permit_released'),
      releaseWithReason
    }
  }

  private snapshotCorrelation(
    correlation: AgentInvocationAdmissionCorrelation | undefined
  ): AgentInvocationAdmissionCorrelation | undefined {
    if (!correlation) return undefined
    try {
      if (typeof correlation !== 'object' || utilTypes.isProxy(correlation)) return undefined
      const prototype = Object.getPrototypeOf(correlation)
      if (prototype !== Object.prototype && prototype !== null) return undefined
      const kind = Object.getOwnPropertyDescriptor(correlation, 'kind')
      const parentSessionId = Object.getOwnPropertyDescriptor(correlation, 'parentSessionId')
      const delegationId = Object.getOwnPropertyDescriptor(correlation, 'delegationId')
      const turnId = Object.getOwnPropertyDescriptor(correlation, 'turnId')
      if (
        !kind ||
        !('value' in kind) ||
        kind.value !== 'live_delegation' ||
        !parentSessionId ||
        !('value' in parentSessionId) ||
        typeof parentSessionId.value !== 'string' ||
        !delegationId ||
        !('value' in delegationId) ||
        typeof delegationId.value !== 'string' ||
        !turnId ||
        !('value' in turnId) ||
        typeof turnId.value !== 'string'
      ) {
        return undefined
      }
      return {
        kind: kind.value,
        parentSessionId: parentSessionId.value,
        delegationId: delegationId.value,
        turnId: turnId.value
      }
    } catch {
      return undefined
    }
  }

  private recordImmediateRejection(
    correlation: AgentInvocationAdmissionCorrelation | undefined,
    acquisitionSeq: number,
    reason: 'queue_full' | 'aborted' | 'closed'
  ): void {
    this.rejected += 1
    if (!correlation) return
    this.emit({
      type: 'rejected',
      ...correlation,
      acquisitionSeq,
      waitMs: 0,
      reason,
      ...this.currentState()
    })
  }

  private currentState(): AgentInvocationAdmissionState {
    return { capacity: this.capacity, active: this.active, pending: this.pending }
  }

  private nextAcquisitionSequence(): number {
    this.acquisitionSequence =
      this.acquisitionSequence >= Number.MAX_SAFE_INTEGER ? 1 : this.acquisitionSequence + 1
    return this.acquisitionSequence
  }

  private readClock(): number | undefined {
    try {
      const value = this.now()
      return Number.isFinite(value) && value >= 0 ? value : undefined
    } catch {
      return undefined
    }
  }

  private elapsedSince(startedAt: number | undefined): { value: number; valid: boolean } {
    return this.elapsedBetween(startedAt, this.readClock())
  }

  private elapsedBetween(
    startedAt: number | undefined,
    finishedAt: number | undefined
  ): { value: number; valid: boolean } {
    if (startedAt === undefined || finishedAt === undefined) return { value: 0, valid: false }
    return { value: Math.max(0, finishedAt - startedAt), valid: true }
  }

  private emit(observation: AgentInvocationAdmissionObservation): void {
    if (this.pendingObservations.length >= MAX_PENDING_OBSERVATIONS) {
      this.pendingObservations.shift()
      this.observationsDropped += 1
    }
    this.pendingObservations.push(
      observation.type === 'closed'
        ? { ...observation, observationsDropped: this.observationsDropped }
        : observation
    )
    this.scheduleObservationDrain()
  }

  private scheduleObservationDrain(): void {
    if (this.observationDrain || this.pendingObservations.length === 0) return
    this.observationDrain = setImmediate(() => this.drainObservations())
  }

  private drainObservations(): void {
    this.observationDrain = undefined
    const observations = this.pendingObservations.splice(0, OBSERVATION_DRAIN_BATCH_SIZE)
    for (const observation of observations) {
      try {
        this.observe(observation)
      } catch {
        // Diagnostics must not alter admission accounting, fairness, or permit ownership.
      }
    }
    if (this.pendingObservations.length > 0) {
      this.scheduleObservationDrain()
      return
    }
    for (const resolve of this.observationFlushWaiters) resolve()
    this.observationFlushWaiters.clear()
  }
}

class StatefulAgentInvocationLease implements AgentInvocationLease {
  private currentState: AgentInvocationLeaseState = 'suspended'
  private permit: InternalAgentInvocationPermit | null = null
  private acquisition:
    | {
        controller: AbortController
        promise: Promise<void>
        cleanupSignals: () => void
      }
    | undefined

  constructor(
    private readonly admission: AgentInvocationAdmission,
    private readonly options: AgentInvocationAdmissionOptions
  ) {}

  get state(): AgentInvocationLeaseState {
    return this.currentState
  }

  resume(options?: { signal?: AbortSignal }): Promise<void> {
    if (this.currentState === 'released') {
      return Promise.reject(new AgentInvocationAdmissionAbortedError())
    }
    if (this.currentState === 'active') return Promise.resolve()
    if (this.acquisition) {
      if (this.currentState === 'acquiring') return this.acquisition.promise
      return this.acquisition.promise
        .catch(() => undefined)
        .then(async () => await this.resume(options))
    }

    const controller = new AbortController()
    const cleanupSignals = forwardAbortSignals([this.options.signal, options?.signal], controller)
    this.currentState = 'acquiring'
    const promise = this.admission
      .acquire({ ...this.options, signal: controller.signal })
      .then((permit) => {
        const internalPermit = permit as InternalAgentInvocationPermit
        if (
          controller.signal.aborted ||
          this.currentState !== 'acquiring' ||
          this.acquisition?.controller !== controller
        ) {
          internalPermit.releaseWithReason(
            this.currentState === 'released' ? 'lease_released' : 'lease_suspended'
          )
          throw new AgentInvocationAdmissionAbortedError()
        }
        this.permit = internalPermit
        this.currentState = 'active'
      })
      .finally(() => {
        if (this.acquisition?.controller !== controller) return
        this.acquisition.cleanupSignals()
        this.acquisition = undefined
        if (this.currentState === 'acquiring') this.currentState = 'suspended'
      })
    this.acquisition = { controller, promise, cleanupSignals }
    return promise
  }

  suspend(): void {
    if (this.currentState === 'released' || this.currentState === 'suspended') return
    if (this.currentState === 'active') {
      this.releaseActivePermit('lease_suspended', 'suspended')
      return
    }
    this.currentState = 'suspended'
    this.acquisition?.controller.abort('Agent invocation lease suspended.')
  }

  release(): void {
    if (this.currentState === 'released') return
    if (this.currentState === 'active') {
      this.releaseActivePermit('lease_released', 'released')
      return
    }
    this.currentState = 'released'
    this.acquisition?.controller.abort('Agent invocation lease released.')
  }

  private releaseActivePermit(
    reason: 'lease_suspended' | 'lease_released',
    nextState: 'suspended' | 'released'
  ): void {
    if (!this.permit) throw new Error('Active Agent invocation lease has no permit.')
    this.permit.releaseWithReason(reason)
    this.permit = null
    this.currentState = nextState
  }
}

function forwardAbortSignals(
  signals: Array<AbortSignal | undefined>,
  target: AbortController
): () => void {
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = []
  for (const signal of signals) {
    if (!signal) continue
    const listener = () => target.abort(signal.reason)
    if (signal.aborted) {
      listener()
      break
    }
    signal.addEventListener('abort', listener, { once: true })
    listeners.push({ signal, listener })
  }
  return () => {
    for (const { signal, listener } of listeners) {
      signal.removeEventListener('abort', listener)
    }
  }
}

function normalizeOwnerId(ownerId: string): string {
  const normalized = ownerId.trim()
  if (!normalized || normalized.length > 256) {
    throw new Error('Agent invocation ownerId must contain 1 to 256 characters.')
  }
  return normalized
}

function normalizeOwnerLimit(requested: number | undefined, capacity: number): number {
  if (requested === undefined) {
    return capacity
  }
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new Error('Agent invocation owner limit must be a positive safe integer.')
  }
  return Math.min(requested, capacity)
}
