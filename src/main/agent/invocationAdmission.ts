export const DEFAULT_AGENT_INVOCATION_CAPACITY = 4
export const DEFAULT_AGENT_INVOCATION_MAX_PENDING = 256

export interface AgentInvocationPermit {
  release(): void
}

export interface AgentInvocationAdmissionOptions {
  ownerId: string
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
  resolve: (permit: AgentInvocationPermit) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
  settled: boolean
}

export class AgentInvocationAdmission implements AgentInvocationAdmissionPort {
  private readonly ownerQueues = new Map<string, AdmissionWaiter[]>()
  private readonly ownerRing: string[] = []
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
    const ownerId = normalizeOwnerId(options.ownerId)
    if (this.closedError) {
      return Promise.reject(this.closedError)
    }
    if (options.signal?.aborted) {
      return Promise.reject(new AgentInvocationAdmissionAbortedError())
    }
    if (this.active < this.capacity && this.pending === 0) {
      this.active += 1
      return Promise.resolve(this.createPermit())
    }
    if (this.pending >= this.maxPending) {
      return Promise.reject(new AgentInvocationAdmissionQueueFullError(this.maxPending))
    }

    return new Promise<AgentInvocationPermit>((resolve, reject) => {
      const waiter: AdmissionWaiter = {
        ownerId,
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
      const ownerId = this.ownerRing.shift()!
      const queue = this.ownerQueues.get(ownerId)
      if (!queue || queue.length === 0) {
        this.ownerQueues.delete(ownerId)
        continue
      }

      const waiter = queue.shift()!
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
      this.active += 1
      waiter.resolve(this.createPermit())
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

  private createPermit(): AgentInvocationPermit {
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
        this.active -= 1
        this.dispatch()
      }
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
