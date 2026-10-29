import path from 'node:path'
import type { Context } from '@arcships/rutis'
import { z } from 'zod'
import {
  isMemoryVectorControl,
  MEMORY_VECTOR_FRAME_BYTES,
  MEMORY_VECTOR_PENDING,
  MemoryVectorCommandSchema,
  MemoryVectorConfigSchema,
  type MemoryVectorCommand,
  type MemoryVectorConfig
} from '@shared/harness/memory-vector'

export interface CoreMemoryService {
  memory(
    generation: string,
    sequence: number,
    method: 'start' | 'call' | 'retire',
    input: unknown,
    data: Uint8Array | null
  ): Promise<unknown>
}

const identitySchema = z
  .object({
    generation: z.string().uuid(),
    pid: z.number().int().positive(),
    node: z.string().max(64),
    modules: z.string().max(32)
  })
  .strict()

export class CoreMemoryRuntime {
  private config: MemoryVectorConfig | undefined
  private startup: Promise<void> | undefined
  private ready = false
  private stopping = false
  private retirement: Promise<void> | undefined
  private failure: Error | undefined
  private sequence = 0
  private readonly pending = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>()
  private readonly unsubscribe: () => void

  constructor(
    context: Pick<Context, 'on'>,
    private readonly service: CoreMemoryService,
    private readonly generation: string
  ) {
    this.unsubscribe = context.on('deepchat/memory/stopped', (generation, message) => {
      if (generation === this.config?.generation && typeof message === 'string')
        this.fail(new Error(message))
    })
  }

  get memoryAvailable(): boolean {
    return this.ready && !this.failure && !this.stopping
  }

  async startMemory(input: MemoryVectorConfig): Promise<void> {
    if (this.failure) throw this.failure
    if (this.stopping) throw new Error('Core Memory is stopping')
    const config = MemoryVectorConfigSchema.parse(input)
    if (
      !path.isAbsolute(config.memoryDbDir) ||
      !path.isAbsolute(config.host.appPath) ||
      !path.isAbsolute(config.host.userDataPath)
    )
      throw new Error('Core Memory paths must be absolute')
    if (this.config && JSON.stringify(this.config) !== JSON.stringify(config))
      throw new Error('Core Memory configuration cannot change')
    this.config = config
    this.startup ??= (async () => {
      const timeout = Promise.withResolvers<never>()
      const timer = setTimeout(
        () => timeout.reject(new Error('Core Memory startup timed out')),
        15_000
      )
      timer.unref()
      try {
        const identity = identitySchema.parse(
          await Promise.race([
            this.service.memory(this.generation, 0, 'start', config, null),
            timeout.promise
          ])
        )
        if (
          identity.generation !== config.generation ||
          identity.modules !== process.versions.modules ||
          identity.node.split('.')[0] !== process.versions.node.split('.')[0]
        )
          throw new Error('Core Memory runtime identity changed')
        if (this.failure) throw this.failure
        this.ready = true
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
        throw this.failure
      } finally {
        clearTimeout(timer)
      }
    })()
    await this.startup
  }

  requestMemory(input: MemoryVectorCommand): Promise<unknown> {
    if (!this.memoryAvailable)
      return Promise.reject(this.failure ?? new Error('Core Memory is unavailable'))
    let command: MemoryVectorCommand
    let data: Uint8Array | undefined
    let metadata: unknown
    const id = this.sequence + 1
    try {
      command = MemoryVectorCommandSchema.parse(input)
      if (command.generation !== this.config?.generation)
        throw new Error('Core Memory generation changed')
      const control = isMemoryVectorControl(command.method)
      if (this.pending.size >= (control ? MEMORY_VECTOR_PENDING : MEMORY_VECTOR_PENDING - 8))
        throw new Error('Core Memory operation limit exceeded')
      data = 'data' in command ? command.data : undefined
      metadata = Object.fromEntries(
        Object.entries(command).filter(([key, value]) => key !== 'data' && value !== undefined)
      )
      const bytes = Buffer.byteLength(JSON.stringify([this.generation, id, 'call', metadata]))
      if (bytes + (data?.byteLength ?? 0) > (control ? 64 * 1024 : MEMORY_VECTOR_FRAME_BYTES))
        throw new Error('Core Memory frame limit exceeded')
      if (!Number.isSafeInteger(id)) throw new Error('Core Memory sequence exhausted')
    } catch (error) {
      return Promise.reject(error)
    }
    this.sequence = id
    const pending = Promise.withResolvers<unknown>()
    this.pending.set(id, pending)
    void this.service.memory(this.generation, id, 'call', metadata, data ?? null).then(
      (value) => {
        this.pending.delete(id)
        pending.resolve(value)
      },
      (error: unknown) => {
        this.pending.delete(id)
        if (
          !(error instanceof Error) ||
          [
            'MemoryVectorRuntimeUnavailableError',
            'MemoryVectorProtocolError',
            'HarnessTransportError',
            'BindingError'
          ].includes(error.name)
        )
          this.fail(error instanceof Error ? error : new Error(String(error)))
        pending.reject(error)
      }
    )
    return pending.promise
  }

  retire(): Promise<void> {
    this.stopping = true
    return (this.retirement ??= (async () => {
      // The host fences startup and reaps the child before the Core profile can unlock.
      await this.service.memory(this.generation, 0, 'retire', null, null)
      this.fail(new Error('Core Memory generation retired'))
      this.unsubscribe()
    })())
  }

  private fail(error: Error): void {
    this.failure ??= error
    for (const pending of this.pending.values()) pending.reject(this.failure)
    this.pending.clear()
  }
}
