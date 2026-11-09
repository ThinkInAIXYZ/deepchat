import { randomUUID } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type { DimPluginClient } from './pluginClient'

export interface DimSessionRef {
  sessionId: string
  branchId: string
}
export interface DimEvent {
  id: string
  sequence: number | string
  create_at: number
  type: string
  name: string
  data: Record<string, JsonValue>
}
export interface DimInputReceipt {
  inputId: string
  sequence: number | string
}
interface HistoryPage {
  through: number | string
  events: DimEvent[]
}
interface Notice {
  method: string
  params: { watchId: string; event?: DimEvent }
}

export function dimSequence(value: number | string): bigint {
  if (
    (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) ||
    !/^\d+$/.test(String(value))
  ) {
    throw new Error('Invalid dim timeline position')
  }
  const result = BigInt(value)
  if (result > 18446744073709551615n) throw new Error('dim timeline position exceeds u64')
  return result
}

/** One desktop reader of a native branch. It never owns turn progression or a pending-input pump. */
export class DimSessionConnection {
  private watchId: string | null = null
  private live: Notice[] = []
  private reading = false
  private started = false
  private pendingOperations = 0
  private stopped = false
  private through: bigint
  private work: Promise<void> = Promise.resolve()
  private needsCatchup = false
  private idling: Promise<void> | null = null
  private synchronizing: Promise<void> | null = null

  constructor(
    private readonly client: DimPluginClient,
    readonly ref: DimSessionRef,
    private readonly consume: (event: DimEvent) => void | Promise<void>,
    private readonly failed: (error: unknown) => void,
    through: number | string = 0
  ) {
    this.through = dimSequence(through)
  }

  get cursor(): string {
    return this.through.toString()
  }

  private readonly notice = (message: Notice): void => {
    if (this.stopped || !['deepchat.host.event', 'deepchat.host.gap'].includes(message.method))
      return
    if (this.watchId && message.params.watchId !== this.watchId) return
    if (!this.watchId) {
      if (this.live.length >= 256) this.needsCatchup = true
      else this.live.push(message)
      return
    }
    if (message.method === 'deepchat.host.gap') {
      this.reportFailure(new Error('dim event subscription overflowed; reconnect and catch up'))
      return
    }
    if (this.reading) {
      if (this.live.length >= 256) this.needsCatchup = true
      else this.live.push(message)
      return
    }
    if (message.params.event) this.enqueue(() => this.accept(message.params.event!))
  }

  private readonly disconnected = (): void =>
    this.reportFailure(
      new Error('dim session connection ended; its accepted input outcome must be queried')
    )

  async start(): Promise<void> {
    if (this.started) throw new Error('dim session reader already started')
    this.started = true
    this.reading = true
    this.client.on('notification', this.notice)
    this.client.on('disconnected', this.disconnected)
    try {
      const { watchId } = await this.client.call<{ watchId: string }>(
        'deepchat.host.subscribe',
        this.ref as unknown as JsonValue
      )
      this.watchId = watchId
      // The watch is active before reading history. Facts delivered during catch-up are buffered
      // and deduplicated by their native sequence after the fixed read completes.
      do {
        this.needsCatchup = false
        await this.catchUp()
        const buffered = this.live.splice(0)
        for (const notice of buffered) {
          if (notice.params.watchId !== watchId) continue
          if (notice.method === 'deepchat.host.gap')
            throw new Error('dim subscription lost while catching up')
          if (notice.params.event) await this.accept(notice.params.event)
        }
      } while (this.needsCatchup || this.live.length > 0)
      this.reading = false
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async send(
    text: string,
    options: { mode?: 'queue' | 'steer' | 'append'; submissionId?: string } = {}
  ): Promise<DimInputReceipt> {
    return this.input([{ type: 'text', text }], options)
  }

  async input(
    content: JsonValue[],
    options: { mode?: 'queue' | 'steer' | 'append'; submissionId?: string } = {}
  ): Promise<DimInputReceipt> {
    if (this.stopped || !this.started) throw new Error('dim session reader is not connected')
    // Callers persist this ID before sending; this layer never retries a model input.
    return this.client.call('deepchat.host.input', {
      ...this.ref,
      mode: options.mode ?? 'queue',
      submissionId: options.submissionId ?? randomUUID(),
      rawBlocks: [],
      content
    })
  }

  lookup(
    submissionId: string
  ): Promise<{ status: 'accepted' | 'unknown'; inputId?: string; sequence?: number | string }> {
    return this.client.call('deepchat.host.lookup', { ...this.ref, submissionId })
  }

  waitIdle(): Promise<void> {
    if (this.idling) return this.idling
    const idling = this.finishIdle()
    this.idling = idling
    void idling
      .finally(() => {
        if (this.idling === idling) this.idling = null
      })
      .catch(() => {})
    return idling
  }

  private async finishIdle(): Promise<void> {
    await this.client.call('deepchat.host.idle', { ...this.ref })
    await this.synchronize()
  }

  synchronize(): Promise<void> {
    // A caller arriving during a fixed-through read needs a subsequent read: joining the old
    // one could miss facts committed before this caller (notably stop/retirement acknowledgements).
    const operation = this.synchronizing
      ? this.synchronizing.then(() => this.synchronizeCommitted())
      : this.synchronizeCommitted()
    this.synchronizing = operation
    void operation
      .finally(() => {
        if (this.synchronizing === operation) this.synchronizing = null
      })
      .catch(() => {})
    return operation
  }
  private async synchronizeCommitted(): Promise<void> {
    this.reading = true
    await this.work
    if (this.stopped) throw new Error('dim reader stopped before completing its projection')
    try {
      do {
        this.needsCatchup = false
        await this.catchUp()
        for (const notice of this.live.splice(0)) {
          if (notice.method === 'deepchat.host.gap')
            throw new Error('dim subscription needs resynchronization')
          if (notice.params.event) await this.accept(notice.params.event)
        }
      } while (this.needsCatchup || this.live.length > 0)
    } catch (error) {
      this.reportFailure(error)
      throw error
    } finally {
      this.reading = false
    }
  }

  async stopGeneration(): Promise<void> {
    await this.client.call('deepchat.host.stop', { ...this.ref })
  }

  async close(): Promise<void> {
    this.stopped = true
    this.client.off('notification', this.notice)
    this.client.off('disconnected', this.disconnected)
    this.live = []
    const watchId = this.watchId
    this.watchId = null
    if (watchId) await this.client.call('deepchat.host.unsubscribe', { watchId }).catch(() => {})
    await this.work
  }

  private async catchUp(): Promise<void> {
    let through: string | undefined
    while (!this.stopped) {
      const page = await this.client.call<HistoryPage>('deepchat.storage.history', {
        ...this.ref,
        after: this.cursor,
        limit: 200,
        ...(through ? { through } : {})
      })
      through ??= String(page.through)
      for (const event of page.events) await this.accept(event)
      if (this.through >= dimSequence(through) || page.events.length === 0) return
    }
  }

  private async accept(event: DimEvent): Promise<void> {
    if (this.stopped || dimSequence(event.sequence) <= this.through) return
    await this.consume(event)
    this.through = dimSequence(event.sequence)
  }

  private enqueue(operation: () => Promise<void>): void {
    if (this.pendingOperations >= 256) {
      this.reportFailure(
        new Error('dim desktop reader fell behind; reconnect from its committed cursor')
      )
      return
    }
    this.pendingOperations++
    this.work = this.work
      .then(async () => {
        if (!this.stopped) await operation()
      })
      .catch((error) => this.reportFailure(error))
      .finally(() => {
        this.pendingOperations--
      })
  }

  private reportFailure(error: unknown): void {
    if (this.stopped) return
    this.stopped = true
    this.client.off('notification', this.notice)
    this.client.off('disconnected', this.disconnected)
    this.live = []
    if (this.watchId) {
      const watchId = this.watchId
      this.watchId = null
      void this.client.call('deepchat.host.unsubscribe', { watchId }).catch(() => {})
    }
    this.failed(error)
  }
}
