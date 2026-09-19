export interface BoundedObservationQueueOptions<TObservation> {
  observe: (observation: TObservation) => void | Promise<void>
  enabled?: () => boolean
  createDroppedObservation?: (droppedCount: number) => TObservation
  capacity?: number
  drainBatchSize?: number
  schedule?: (drain: () => void) => void
}

const DEFAULT_CAPACITY = 512
const DEFAULT_DRAIN_BATCH_SIZE = 16

export class BoundedObservationQueue<TObservation> {
  private readonly pending: TObservation[] = []
  private readonly flushWaiters = new Set<() => void>()
  private readonly capacity: number
  private readonly drainBatchSize: number
  private readonly schedule: (drain: () => void) => void
  private drainScheduled = false
  private totalDropped = 0
  private unreportedDropped = 0

  constructor(private readonly options: BoundedObservationQueueOptions<TObservation>) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY
    this.drainBatchSize = options.drainBatchSize ?? DEFAULT_DRAIN_BATCH_SIZE
    this.schedule = options.schedule ?? ((drain) => void setImmediate(drain))
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1) {
      throw new Error('Observation queue capacity must be a positive safe integer.')
    }
    if (!Number.isSafeInteger(this.drainBatchSize) || this.drainBatchSize < 1) {
      throw new Error('Observation drain batch size must be a positive safe integer.')
    }
  }

  get droppedCount(): number {
    return this.totalDropped
  }

  enqueue(observation: TObservation): boolean {
    return this.enqueueWithDroppedCount(() => observation)
  }

  enqueueWithDroppedCount(
    createObservation: (totalDroppedAfterEnqueue: number) => TObservation
  ): boolean {
    if (!this.isEnabled()) return false
    const dropsOnEnqueue = this.pending.length >= this.capacity ? 1 : 0
    let observation: TObservation
    try {
      observation = createObservation(this.totalDropped + dropsOnEnqueue)
    } catch {
      return false
    }
    if (dropsOnEnqueue > 0) {
      this.pending.shift()
      this.recordDropped(dropsOnEnqueue)
    }
    this.pending.push(observation)
    this.scheduleDrain()
    return true
  }

  flush(): Promise<void> {
    if (this.pending.length === 0 && !this.drainScheduled) return Promise.resolve()
    return new Promise((resolve) => {
      this.flushWaiters.add(resolve)
      this.scheduleDrain()
    })
  }

  private isEnabled(): boolean {
    try {
      return this.options.enabled?.() ?? true
    } catch {
      return false
    }
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || this.pending.length === 0) return
    this.drainScheduled = true
    try {
      this.schedule(() => {
        this.drainScheduled = false
        this.drain()
      })
    } catch {
      this.drainScheduled = false
      this.recordDropped(this.pending.length)
      this.pending.splice(0)
      this.resolveFlushWaiters()
    }
  }

  private drain(): void {
    const observations = this.pending.splice(0, this.drainBatchSize)
    for (const observation of observations) this.dispatch(observation)
    if (this.pending.length > 0) {
      this.scheduleDrain()
      return
    }
    if (this.unreportedDropped > 0 && this.options.createDroppedObservation) {
      const droppedCount = this.unreportedDropped
      this.unreportedDropped = 0
      try {
        this.dispatch(this.options.createDroppedObservation(droppedCount))
      } catch {
        // Diagnostics must remain fail-open even when loss reporting is malformed.
      }
      if (this.pending.length > 0) {
        this.scheduleDrain()
        return
      }
    }
    this.resolveFlushWaiters()
  }

  private dispatch(observation: TObservation): void {
    try {
      const result = this.options.observe(observation)
      if (result) void result.catch(() => undefined)
    } catch {
      // Diagnostics must not alter the observed operation.
    }
  }

  private recordDropped(count: number): void {
    this.totalDropped += count
    if (this.options.createDroppedObservation) this.unreportedDropped += count
  }

  private resolveFlushWaiters(): void {
    for (const resolve of this.flushWaiters) resolve()
    this.flushWaiters.clear()
  }
}
