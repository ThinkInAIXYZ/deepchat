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
  private reading = false
  private started = false
  private refreshScheduled = false
  private stopped = false
  private through: bigint
  private work: Promise<void> = Promise.resolve()
  private needsCatchup = false
  private idling: Promise<void> | null = null

  constructor(
    private readonly client: Pick<DimPluginClient, 'call' | 'on' | 'off'>,
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
      this.needsCatchup = true
      return
    }
    if (message.method === 'deepchat.host.gap') {
      this.reportFailure(new Error('dim event subscription overflowed; reconnect and catch up'))
      return
    }
    // Notifications can cross asynchronous plugin callbacks in a different order. They invalidate
    // the read model; only an ordered, fixed-through owner read may advance its durable cursor.
    this.needsCatchup = true
    this.refresh()
  }

  private refresh(): void {
    if (this.reading || this.refreshScheduled || this.stopped) return
    this.refreshScheduled = true
    void this.synchronize()
      .finally(() => {
        this.refreshScheduled = false
        if (this.needsCatchup) this.refresh()
      })
      .catch(() => {})
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
      // The watch is active before reading history. Notifications received during a fixed read
      // request another read without trusting their delivery order or retaining event payloads.
      do {
        this.needsCatchup = false
        await this.catchUp()
      } while (this.needsCatchup)
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
    const operation = this.work.then(() => this.synchronizeCommitted())
    this.work = operation.catch((error) => this.reportFailure(error))
    return operation
  }
  private async synchronizeCommitted(): Promise<void> {
    this.reading = true
    if (this.stopped) throw new Error('dim reader stopped before completing its projection')
    try {
      do {
        this.needsCatchup = false
        await this.catchUp()
      } while (this.needsCatchup)
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

  private reportFailure(error: unknown): void {
    if (this.stopped) return
    this.stopped = true
    this.client.off('notification', this.notice)
    this.client.off('disconnected', this.disconnected)
    if (this.watchId) {
      const watchId = this.watchId
      this.watchId = null
      void this.client.call('deepchat.host.unsubscribe', { watchId }).catch(() => {})
    }
    this.failed(error)
  }
}
