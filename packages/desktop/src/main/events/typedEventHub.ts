import { randomUUID } from 'node:crypto'
import {
  createDeepchatEventEnvelope,
  type DeepchatEventEnvelope,
  type DeepchatEventName
} from '@shared/contracts/events'
import { JsonValueSchema, type JsonValue } from '@shared/contracts/json'

export type TypedEventTarget =
  | Readonly<{ kind: 'renderer-all' }>
  | Readonly<{ kind: 'renderer'; webContentsId: number }>
  | Readonly<{ kind: 'cli-connection'; connectionId: string }>
  | Readonly<{ kind: 'request'; connectionId: string; requestId: string }>
  | Readonly<{ kind: 'run'; runId: string }>
  | Readonly<{ kind: 'internal'; subscriberId: string }>

export type TypedEventStreamTarget = Exclude<
  TypedEventTarget,
  { kind: 'renderer-all' } | { kind: 'renderer' }
>

export type TypedEventRecord = Readonly<{
  target: TypedEventStreamTarget
  sequence: number
  cursor: string
  timestamp: number
  event: DeepchatEventName
  data: JsonValue
}>

export type TypedEventRecoveryReason =
  | 'cursor_missing'
  | 'cursor_expired'
  | 'cursor_ahead'
  | 'server_restarted'

export type TypedEventSubscription = Readonly<{
  initialCursor: string
  recoveryReason: TypedEventRecoveryReason | null
  events: AsyncIterable<TypedEventRecord>
  close(): void
}>

export class TypedEventHubOverflowError extends Error {
  constructor(message = 'Event subscriber queue overflowed') {
    super(message)
    this.name = 'TypedEventHubOverflowError'
  }
}

export class TypedEventHubCapacityError extends Error {
  constructor(message = 'Event subscriber capacity is exhausted') {
    super(message)
    this.name = 'TypedEventHubCapacityError'
  }
}

export type TypedEventHubOptions = Readonly<{
  renderer: Readonly<{
    broadcast(envelope: DeepchatEventEnvelope): void | Promise<unknown>
    send(webContentsId: number, envelope: DeepchatEventEnvelope): void | Promise<unknown>
  }>
  epoch?: string
  now?: () => number
  maxStreams?: number
  maxSubscribers?: number
  maxRetainedEvents?: number
  maxRetainedBytes?: number
  maxTotalRetainedBytes?: number
  maxSubscriberEvents?: number
  maxSubscriberBytes?: number
  streamIdleTtlMs?: number
  log?: Pick<Console, 'warn'>
}>

type StreamState = {
  target: TypedEventStreamTarget
  cursorEpoch: string
  sequence: number
  retained: RetainedEvent[]
  retainedBytes: number
  subscribers: Set<EventSubscriber>
  lastUsedAt: number
}

type RetainedEvent = Readonly<{
  record: TypedEventRecord
  bytes: number
  order: number
  coalescingKey: string | null
}>

type PendingNext = Readonly<{
  resolve(value: IteratorResult<TypedEventRecord>): void
  reject(error: Error): void
}>

const DEFAULT_MAX_STREAMS = 128
const DEFAULT_MAX_SUBSCRIBERS = 64
const DEFAULT_MAX_RETAINED_EVENTS = 256
const DEFAULT_MAX_RETAINED_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_TOTAL_RETAINED_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_SUBSCRIBER_EVENTS = 64
const DEFAULT_MAX_SUBSCRIBER_BYTES = 1024 * 1024
const DEFAULT_STREAM_IDLE_TTL_MS = 30 * 60_000
const MAX_STREAM_SWEEP_INTERVAL_MS = 60_000

function targetKey(target: TypedEventStreamTarget): string {
  const field = (value: string): string => `${value.length}:${value}`
  switch (target.kind) {
    case 'cli-connection':
      return `connection:${field(target.connectionId)}`
    case 'request':
      return `request:${field(target.connectionId)}:${field(target.requestId)}`
    case 'run':
      return `run:${field(target.runId)}`
    case 'internal':
      return `internal:${field(target.subscriberId)}`
  }
}

function recordSize(record: TypedEventRecord): number {
  return Buffer.byteLength(JSON.stringify(record), 'utf8')
}

function retainedEventCoalescingKey(record: TypedEventRecord): string | null {
  if (record.event !== 'chat.stream.updated') return null
  if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) return null
  const messageId = record.data.messageId
  return typeof messageId === 'string' ? `${record.event}:${messageId}` : null
}

class EventSubscriber implements AsyncIterator<TypedEventRecord>, AsyncIterable<TypedEventRecord> {
  private readonly queue: Array<{ record: TypedEventRecord; bytes: number }> = []
  private queuedBytes = 0
  private pending: PendingNext | null = null
  private closed = false
  private failure: Error | null = null

  constructor(
    initialRecords: readonly RetainedEvent[],
    private readonly limits: { maxEvents: number; maxBytes: number },
    private readonly onClose: () => void
  ) {
    for (const { record, bytes } of initialRecords) {
      this.queue.push({ record, bytes })
      this.queuedBytes += bytes
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<TypedEventRecord> {
    return this
  }

  next(): Promise<IteratorResult<TypedEventRecord>> {
    if (this.failure) return Promise.reject(this.failure)
    const queued = this.queue.shift()
    if (queued) {
      this.queuedBytes -= queued.bytes
      return Promise.resolve({ value: queued.record, done: false })
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true })
    if (this.pending) {
      return Promise.reject(new Error('Concurrent event subscription reads are not supported'))
    }
    return new Promise<IteratorResult<TypedEventRecord>>((resolve, reject) => {
      this.pending = { resolve, reject }
    })
  }

  return(): Promise<IteratorResult<TypedEventRecord>> {
    this.close()
    return Promise.resolve({ value: undefined, done: true })
  }

  enqueue(record: TypedEventRecord, bytes: number): void {
    if (this.closed || this.failure) return
    if (bytes > this.limits.maxBytes) {
      this.fail(new TypedEventHubOverflowError('Event exceeds the subscriber byte limit'))
      return
    }
    if (this.pending) {
      const pending = this.pending
      this.pending = null
      pending.resolve({ value: record, done: false })
      return
    }

    if (
      this.queue.length >= this.limits.maxEvents ||
      this.queuedBytes + bytes > this.limits.maxBytes
    ) {
      this.fail(new TypedEventHubOverflowError())
      return
    }
    this.queue.push({ record, bytes })
    this.queuedBytes += bytes
  }

  fail(error: Error): void {
    if (this.closed || this.failure) return
    this.failure = error
    this.queue.length = 0
    this.queuedBytes = 0
    const pending = this.pending
    this.pending = null
    this.onClose()
    pending?.reject(error)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.queue.length = 0
    this.queuedBytes = 0
    const pending = this.pending
    this.pending = null
    this.onClose()
    pending?.resolve({ value: undefined, done: true })
  }
}

export class TypedEventHub {
  private readonly epoch: string
  private readonly now: () => number
  private readonly maxStreams: number
  private readonly maxSubscribers: number
  private readonly maxRetainedEvents: number
  private readonly maxRetainedBytes: number
  private readonly maxTotalRetainedBytes: number
  private readonly maxSubscriberEvents: number
  private readonly maxSubscriberBytes: number
  private readonly streamIdleTtlMs: number
  private readonly streamSweepTimer: NodeJS.Timeout
  private readonly log: Pick<Console, 'warn'>
  private readonly streams = new Map<string, StreamState>()
  private subscriberCount = 0
  private totalRetainedBytes = 0
  private streamIncarnation = 0
  private retentionOrder = 0

  constructor(private readonly options: TypedEventHubOptions) {
    this.epoch = options.epoch ?? randomUUID()
    this.now = options.now ?? Date.now
    this.maxStreams = options.maxStreams ?? DEFAULT_MAX_STREAMS
    this.maxSubscribers = options.maxSubscribers ?? DEFAULT_MAX_SUBSCRIBERS
    this.maxRetainedEvents = options.maxRetainedEvents ?? DEFAULT_MAX_RETAINED_EVENTS
    this.maxRetainedBytes = options.maxRetainedBytes ?? DEFAULT_MAX_RETAINED_BYTES
    this.maxTotalRetainedBytes = options.maxTotalRetainedBytes ?? DEFAULT_MAX_TOTAL_RETAINED_BYTES
    this.maxSubscriberEvents = options.maxSubscriberEvents ?? DEFAULT_MAX_SUBSCRIBER_EVENTS
    this.maxSubscriberBytes = options.maxSubscriberBytes ?? DEFAULT_MAX_SUBSCRIBER_BYTES
    this.streamIdleTtlMs = options.streamIdleTtlMs ?? DEFAULT_STREAM_IDLE_TTL_MS
    this.log = options.log ?? console
    this.streamSweepTimer = setInterval(
      () => this.pruneExpiredStreams(),
      Math.max(1_000, Math.min(this.streamIdleTtlMs, MAX_STREAM_SWEEP_INTERVAL_MS))
    )
    this.streamSweepTimer.unref()
  }

  publish(name: DeepchatEventName, payload: unknown, target: TypedEventTarget): void {
    const envelope = createDeepchatEventEnvelope(name, payload)
    if (target.kind === 'renderer-all') {
      this.deliver(() => this.options.renderer.broadcast(envelope), name, target)
      return
    }
    if (target.kind === 'renderer') {
      this.deliver(() => this.options.renderer.send(target.webContentsId, envelope), name, target)
      return
    }

    const data = JsonValueSchema.parse(envelope.payload)
    const state = this.getOrCreateStream(target)
    state.sequence += 1
    state.lastUsedAt = this.now()
    const record: TypedEventRecord = {
      target,
      sequence: state.sequence,
      cursor: this.cursor(state, state.sequence),
      timestamp: state.lastUsedAt,
      event: name,
      data
    }
    const bytes = recordSize(record)

    if (bytes <= this.maxRetainedBytes && bytes <= this.maxTotalRetainedBytes) {
      this.retain(state, record, bytes)
    }

    for (const subscriber of Array.from(state.subscribers)) subscriber.enqueue(record, bytes)
  }

  subscribe(
    target: TypedEventStreamTarget,
    options: { afterCursor?: string; signal?: AbortSignal } = {}
  ): TypedEventSubscription {
    if (this.subscriberCount >= this.maxSubscribers) throw new TypedEventHubCapacityError()
    const state = this.getOrCreateStream(target)
    const recovery = this.resolveRecovery(state, options.afterCursor)
    let initialRecords =
      recovery.sequence === null
        ? []
        : state.retained.filter((item) => item.record.sequence > recovery.sequence!)
    if (!this.recordsFitSubscriber(initialRecords)) {
      recovery.reason = 'cursor_expired'
      recovery.sequence = null
      initialRecords = []
    }

    let subscriber!: EventSubscriber
    let abortListener: (() => void) | undefined
    const close = () => {
      if (!state.subscribers.delete(subscriber)) return
      this.subscriberCount -= 1
      if (abortListener) options.signal?.removeEventListener('abort', abortListener)
      this.trimStreamCapacity()
    }
    subscriber = new EventSubscriber(
      initialRecords,
      { maxEvents: this.maxSubscriberEvents, maxBytes: this.maxSubscriberBytes },
      close
    )
    state.subscribers.add(subscriber)
    state.lastUsedAt = this.now()
    this.subscriberCount += 1
    if (options.signal?.aborted) subscriber.close()
    else {
      abortListener = () => subscriber.close()
      options.signal?.addEventListener('abort', abortListener, { once: true })
    }

    return {
      initialCursor: this.cursor(state, state.sequence),
      recoveryReason: recovery.reason,
      events: subscriber,
      close: () => subscriber.close()
    }
  }

  close(): void {
    clearInterval(this.streamSweepTimer)
    for (const state of this.streams.values()) {
      for (const subscriber of Array.from(state.subscribers)) subscriber.close()
    }
    this.streams.clear()
    this.totalRetainedBytes = 0
  }

  private deliver(
    action: () => void | Promise<unknown>,
    name: DeepchatEventName,
    target: TypedEventTarget
  ): void {
    try {
      void Promise.resolve(action()).catch((error) => {
        this.log.warn('[TypedEventHub] Renderer delivery failed', { name, target, error })
      })
    } catch (error) {
      this.log.warn('[TypedEventHub] Renderer delivery failed', { name, target, error })
    }
  }

  private cursor(state: StreamState, sequence: number): string {
    return `${state.cursorEpoch}:${sequence}`
  }

  private getOrCreateStream(target: TypedEventStreamTarget): StreamState {
    this.pruneExpiredStreams()
    const key = targetKey(target)
    const existing = this.streams.get(key)
    if (existing) return existing

    this.trimStreamCapacity(1)
    const state: StreamState = {
      target,
      cursorEpoch: `${this.epoch}_${++this.streamIncarnation}`,
      sequence: 0,
      retained: [],
      retainedBytes: 0,
      subscribers: new Set(),
      lastUsedAt: this.now()
    }
    this.streams.set(key, state)
    return state
  }

  private resolveRecovery(
    state: StreamState,
    cursor: string | undefined
  ): { reason: TypedEventRecoveryReason | null; sequence: number | null } {
    if (!cursor) return { reason: 'cursor_missing', sequence: null }
    const separator = cursor.lastIndexOf(':')
    const epoch = separator > 0 ? cursor.slice(0, separator) : ''
    const rawSequence = separator > 0 ? cursor.slice(separator + 1) : ''
    const sequence = /^(?:0|[1-9][0-9]*)$/.test(rawSequence) ? Number(rawSequence) : Number.NaN
    if (epoch !== state.cursorEpoch) {
      const sameHub = epoch === this.epoch || epoch.startsWith(`${this.epoch}_`)
      return { reason: sameHub ? 'cursor_expired' : 'server_restarted', sequence: null }
    }
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      return { reason: 'cursor_expired', sequence: null }
    }
    if (sequence > state.sequence) return { reason: 'cursor_ahead', sequence: null }

    const oldestSequence = state.retained[0]?.record.sequence ?? state.sequence + 1
    if (sequence < oldestSequence - 1) return { reason: 'cursor_expired', sequence: null }
    return { reason: null, sequence }
  }

  private recordsFitSubscriber(records: readonly RetainedEvent[]): boolean {
    if (records.length > this.maxSubscriberEvents) return false
    let bytes = 0
    for (const record of records) {
      bytes += record.bytes
      if (bytes > this.maxSubscriberBytes) return false
    }
    return true
  }

  private retain(state: StreamState, record: TypedEventRecord, bytes: number): void {
    const coalescingKey = retainedEventCoalescingKey(record)
    if (coalescingKey) {
      const supersededIndex = state.retained.findIndex(
        (item) => item.coalescingKey === coalescingKey
      )
      if (supersededIndex >= 0) this.removeRetainedAt(state, supersededIndex)
    }

    state.retained.push({
      record,
      bytes,
      order: ++this.retentionOrder,
      coalescingKey
    })
    state.retainedBytes += bytes
    this.totalRetainedBytes += bytes
    while (
      state.retained.length > this.maxRetainedEvents ||
      state.retainedBytes > this.maxRetainedBytes
    ) {
      this.removeRetainedAt(state, 0)
    }
    this.trimTotalRetainedBytes()
  }

  private trimTotalRetainedBytes(): void {
    while (this.totalRetainedBytes > this.maxTotalRetainedBytes) {
      let candidate: StreamState | undefined
      let oldestOrder = Number.POSITIVE_INFINITY
      for (const state of this.streams.values()) {
        const order = state.retained[0]?.order
        if (order !== undefined && order < oldestOrder) {
          candidate = state
          oldestOrder = order
        }
      }
      if (!candidate) break
      this.removeRetainedAt(candidate, 0)
    }
  }

  private removeRetainedAt(state: StreamState, index: number): void {
    const [removed] = state.retained.splice(index, 1)
    if (!removed) return
    state.retainedBytes -= removed.bytes
    this.totalRetainedBytes -= removed.bytes
  }

  private pruneExpiredStreams(): void {
    const expirationThreshold = this.now() - this.streamIdleTtlMs
    for (const [key, state] of this.streams) {
      if (state.subscribers.size === 0 && state.lastUsedAt < expirationThreshold) {
        this.removeStream(key, state)
      }
    }
  }

  private removeStream(key: string, state: StreamState): void {
    if (!this.streams.delete(key)) return
    this.totalRetainedBytes -= state.retainedBytes
  }

  private trimStreamCapacity(additionalStreams = 0): void {
    while (this.streams.size + additionalStreams > this.maxStreams) {
      const candidate = Array.from(this.streams.entries())
        .filter(([, state]) => state.subscribers.size === 0)
        .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0]
      if (!candidate) {
        if (additionalStreams > 0) {
          throw new TypedEventHubCapacityError('Event stream capacity is exhausted')
        }
        return
      }
      this.removeStream(candidate[0], candidate[1])
    }
  }
}
