import {
  HARNESS_CONTROL_METADATA_BYTES,
  HARNESS_CONTROL_PENDING,
  HarnessControlCommandSchema,
  HarnessControlReceiptSchema,
  type HarnessControlCommand,
  type HarnessControlPort,
  type HarnessControlReceipt
} from '@shared/harness/control'

export interface CoreControlService {
  control(generation: string, sequence: number, command: HarnessControlCommand): Promise<unknown>
}

export class CoreHarnessControl implements HarnessControlPort {
  private sequence = 0
  private tail: Promise<void> = Promise.resolve()
  private pending = 0
  private pendingBytes = 0
  private failure: Error | undefined
  private stopped = false
  private readonly listeners = new Set<() => void>()
  private readonly grants = new Map<string, (leaseId: string) => void>()

  constructor(
    private readonly service: CoreControlService,
    private readonly generation: string,
    private readonly failOwner: () => void
  ) {}

  get closed(): boolean {
    return this.stopped || this.failure !== undefined
  }

  onClose(listener: () => void): () => void {
    if (this.closed) listener()
    else this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onGrant(scopeId: string, listener: (leaseId: string) => void): () => void {
    if (this.grants.has(scopeId)) throw new Error('Duplicate control scope listener')
    this.grants.set(scopeId, listener)
    return () => {
      this.grants.delete(scopeId)
    }
  }

  private applyGrants(receipt: HarnessControlReceipt): void {
    for (const grant of receipt.grants) this.grants.get(grant.scopeId)?.(grant.leaseId)
  }

  send(
    input: HarnessControlCommand,
    receive?: (receipt: HarnessControlReceipt) => void
  ): Promise<HarnessControlReceipt> {
    return this.enqueue(input, async (command) => {
      const receipt = await this.request(command)
      receive?.(receipt)
      this.applyGrants(receipt)
      return receipt
    })
  }

  transition(
    input: Extract<HarnessControlCommand, { method: 'prepareOperation' | 'prepareRun' }>,
    receive: (receipt: HarnessControlReceipt) => boolean
  ): Promise<HarnessControlReceipt> {
    return this.enqueue(input, async (command) => {
      if (command.method !== 'prepareOperation' && command.method !== 'prepareRun') {
        throw new Error('Expected a control transition')
      }
      const deadline = performance.now() + 10_000
      const prepared = await this.request(command, deadline)
      const aborted = receive(prepared)
      this.applyGrants(prepared)
      if (prepared.outcome !== 'accepted') return prepared
      const result = prepared.result as Record<string, unknown> | null
      if (result?.reused === true && typeof result.operationId === 'string') return prepared
      if (typeof result?.transitionId !== 'string') {
        throw new Error('Harness control transition has no acknowledgement identity')
      }
      const committed = await this.request(
        { method: 'commit', scopeId: command.scopeId, transitionId: result.transitionId, aborted },
        deadline
      )
      receive(committed)
      this.applyGrants(committed)
      return committed
    })
  }

  private enqueue(
    input: HarnessControlCommand,
    work: (command: HarnessControlCommand) => Promise<HarnessControlReceipt>
  ): Promise<HarnessControlReceipt> {
    if (this.closed) return Promise.reject(this.failure ?? new Error('Harness control stopped'))
    let command: HarnessControlCommand
    let bytes: number
    try {
      command = HarnessControlCommandSchema.parse(input)
      bytes = Buffer.byteLength(JSON.stringify(command))
      const cleanup = [
        'abort',
        'operationAborted',
        'abortDeferred',
        'ackInputEffect',
        'endInput',
        'clearOperation',
        'clearRun',
        'releaseLease',
        'clearSession',
        'parkInteraction',
        'releaseAcceptance',
        'retire',
        'release'
      ].includes(command.method)
      if (
        this.pending >= HARNESS_CONTROL_PENDING - (cleanup ? 0 : 16) ||
        this.pendingBytes + bytes > HARNESS_CONTROL_METADATA_BYTES - (cleanup ? 0 : 64 * 1024)
      ) {
        throw new Error('Harness control command queue exceeded its bound')
      }
    } catch (error) {
      return Promise.reject(this.fail(error))
    }
    this.pending++
    this.pendingBytes += bytes
    const task = this.tail.then(async () => {
      if (this.closed) throw this.failure ?? new Error('Harness control stopped')
      try {
        return await work(command)
      } catch (error) {
        if (this.stopped) throw error
        throw this.fail(error)
      }
    })
    this.tail = task.then(
      () => undefined,
      () => undefined
    )
    return task.finally(() => {
      this.pending--
      this.pendingBytes -= bytes
    })
  }

  private async request(
    command: HarnessControlCommand,
    deadline = performance.now() + 10_000
  ): Promise<HarnessControlReceipt> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const receipt = await Promise.race([
        this.service.control(this.generation, ++this.sequence, command),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Harness control request timed out')),
            Math.max(0, deadline - performance.now())
          )
          timer.unref()
        })
      ])
      if (this.closed) throw this.failure ?? new Error('Harness control stopped')
      return HarnessControlReceiptSchema.parse(receipt)
    } finally {
      clearTimeout(timer)
    }
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.fence()
  }

  private fail(cause: unknown): Error {
    if (this.failure) return this.failure
    this.failure = cause instanceof Error ? cause : new Error(String(cause))
    this.fence()
    if (!this.stopped) this.failOwner()
    return this.failure
  }

  private fence(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // One local cleanup cannot keep another effect handle alive.
      }
    }
    this.listeners.clear()
    this.grants.clear()
  }
}
