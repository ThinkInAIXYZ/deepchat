export const DEFAULT_AGENT_INVOCATION_CAPACITY = 6
export const DEFAULT_AGENT_INVOCATION_MAX_PENDING = 256

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
}

export interface AgentInvocationAdmissionSnapshot {
  capacity: number
  active: number
  pending: number
  pendingOwners: number
  closed: boolean
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
  resolve: (permit: AgentInvocationPermit) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
  settled: boolean
}

export class AgentInvocationAdmission implements AgentInvocationAdmissionPort {
  private readonly ownerQueues = new Map<string, AdmissionWaiter[]>()
  private readonly ownerRing: string[] = []
  private readonly activeByOwner = new Map<string, number>()
  private active = 0
  private pending = 0
  private closedError: AgentInvocationAdmissionClosedError | null = null

  constructor(
    private readonly capacity = DEFAULT_AGENT_INVOCATION_CAPACITY,
    private readonly maxPending = DEFAULT_AGENT_INVOCATION_MAX_PENDING
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Agent invocation capacity must be a positive integer.')
    }
    if (!Number.isInteger(maxPending) || maxPending < 0) {
      throw new Error('Agent invocation pending limit must be a non-negative integer.')
    }
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
    if (this.closedError) {
      return Promise.reject(this.closedError)
    }
    if (options.signal?.aborted) {
      return Promise.reject(new AgentInvocationAdmissionAbortedError())
    }
    if (
      this.active < this.capacity &&
      this.pending === 0 &&
      this.getActiveForOwner(ownerId) < maxActiveForOwner
    ) {
      return Promise.resolve(this.grant(ownerId))
    }
    if (this.pending >= this.maxPending) {
      return Promise.reject(new AgentInvocationAdmissionQueueFullError(this.maxPending))
    }

    return new Promise<AgentInvocationPermit>((resolve, reject) => {
      const waiter: AdmissionWaiter = {
        ownerId,
        maxActiveForOwner,
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
        this.rejectWaiter(waiter, this.closedError)
      }
    }
    this.ownerQueues.clear()
    this.ownerRing.splice(0)
    this.pending = 0
  }

  snapshot(): AgentInvocationAdmissionSnapshot {
    return {
      capacity: this.capacity,
      active: this.active,
      pending: this.pending,
      pendingOwners: this.ownerQueues.size,
      closed: this.closedError !== null
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
        waiter.resolve(this.grant(ownerId))
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
    this.rejectWaiter(waiter, new AgentInvocationAdmissionAbortedError())
    this.dispatch()
  }

  private rejectWaiter(waiter: AdmissionWaiter, error: Error): void {
    if (waiter.settled) {
      return
    }
    waiter.settled = true
    this.detachAbort(waiter)
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

  private grant(ownerId: string): AgentInvocationPermit {
    this.active += 1
    this.activeByOwner.set(ownerId, this.getActiveForOwner(ownerId) + 1)
    let released = false
    return {
      release: () => {
        if (released) {
          return
        }
        released = true
        if (this.active <= 0) {
          throw new Error('Agent invocation permit accounting underflow.')
        }
        const ownerActive = this.getActiveForOwner(ownerId)
        if (ownerActive <= 0) {
          throw new Error(`Agent invocation owner permit accounting underflow: ${ownerId}`)
        }
        this.active -= 1
        if (ownerActive === 1) {
          this.activeByOwner.delete(ownerId)
        } else {
          this.activeByOwner.set(ownerId, ownerActive - 1)
        }
        this.dispatch()
      }
    }
  }
}

class StatefulAgentInvocationLease implements AgentInvocationLease {
  private currentState: AgentInvocationLeaseState = 'suspended'
  private permit: AgentInvocationPermit | null = null
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
        if (
          controller.signal.aborted ||
          this.currentState !== 'acquiring' ||
          this.acquisition?.controller !== controller
        ) {
          permit.release()
          throw new AgentInvocationAdmissionAbortedError()
        }
        this.permit = permit
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
    this.currentState = 'suspended'
    this.acquisition?.controller.abort('Agent invocation lease suspended.')
    this.permit?.release()
    this.permit = null
  }

  release(): void {
    if (this.currentState === 'released') return
    this.currentState = 'released'
    this.acquisition?.controller.abort('Agent invocation lease released.')
    this.permit?.release()
    this.permit = null
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
