import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { endianness } from 'node:os'
import { z } from 'zod'
import { AsyncSemaphore } from '@/lib/asyncSemaphore'
import { withSoftDeadline } from '@/memory/core/asyncDeadline'
import type { IMemoryVectorStore, MemoryVectorStoreFactoryPort } from '@/memory/ports'
import type { MemoryVectorRecord, MemoryVectorQueryOptions } from '@/memory/types'
import {
  createMemoryVectorStorePaths,
  persistMemoryVectorQuarantine
} from '@/memory/infra/memoryVectorStorePaths'
import {
  isDuckDbFatalError,
  MemoryVectorStoreQuarantineRequiredError,
  MemoryVectorStoreTerminalRecoveryError
} from '@/memory/infra/vectorStoreErrors'
import {
  encodeMemoryVector,
  MEMORY_VECTOR_CHUNK_BYTES,
  MEMORY_VECTOR_INITIAL_CHUNK_BYTES,
  MEMORY_VECTOR_UPLOAD_BYTES,
  MemoryVectorCommandSchema,
  type MemoryVectorCommand,
  type MemoryVectorConfig
} from '@shared/harness/memory-vector'
import { isSafeAgentId } from '@shared/types/agent-memory'
import type { HarnessRuntime } from './runtime'

const matches = z
  .array(
    z.object({ memoryId: z.string().min(1).max(1024), distance: z.number().finite() }).strict()
  )
  .max(800)

export class RutisMemoryVectorStores implements MemoryVectorStoreFactoryPort {
  private readonly config: MemoryVectorConfig
  private readonly stores = new Map<string, RemoteMemoryVectorStore>()
  private readonly barriers = new Map<string, Promise<void>>()
  private readonly uploads = new AsyncSemaphore(1)
  private startup: Promise<void> | undefined
  private stopped = false

  constructor(
    readonly runtime: HarnessRuntime,
    config: Omit<MemoryVectorConfig, 'generation'>
  ) {
    this.config = { ...config, generation: randomUUID() }
  }

  async createVectorStore(
    agentId: string,
    embedding: { providerId: string; modelId: string },
    dimensions: number
  ): Promise<IMemoryVectorStore> {
    this.assertAgent(agentId)
    await this.barriers.get(agentId)
    if (this.stopped) throw new Error('Memory vector stores are stopping')
    if ([...this.stores.values()].some((store) => store.agentId === agentId)) {
      throw new Error('Memory vector store already has a local owner')
    }
    const store = new RemoteMemoryVectorStore(this, agentId, randomUUID(), dimensions)
    const opening = MemoryVectorCommandSchema.parse({
      method: 'open',
      resource: store.id,
      agentId,
      embedding,
      dimensions,
      generation: this.config.generation,
      operation: randomUUID()
    })
    this.stores.set(store.id, store)
    try {
      await this.start()
      store.assertUsable()
      const grant = z
        .object({ resource: z.literal(store.id), usable: z.boolean() })
        .strict()
        .parse(await this.request(opening))
      if (!grant.usable) store.revoke()
      return store
    } catch (error) {
      await store.close().catch(() => undefined)
      throw error
    }
  }

  async resetVectorStore(agentId: string): Promise<void> {
    this.assertAgent(agentId)
    await this.barriers.get(agentId)
    if (!this.startup) {
      const paths = createMemoryVectorStorePaths(this.config.memoryDbDir, agentId)
      if (
        !fs.existsSync(`${paths.current}.lease`) &&
        !Object.values(paths).some((file) => fs.existsSync(file) || fs.existsSync(`${file}.wal`))
      )
        return
    }
    for (const store of this.stores.values()) if (store.agentId === agentId) store.revoke()
    await this.start()
    await this.request({ method: 'reset', agentId })
    for (const [id, store] of this.stores) if (store.agentId === agentId) this.stores.delete(id)
  }

  markVectorStoreQuarantined(agentId: string): void {
    this.assertAgent(agentId)
    for (const store of this.stores.values()) if (store.agentId === agentId) store.revoke()
    // Append-only intent survives a dead worker; only the locked native owner consumes it.
    try {
      persistMemoryVectorQuarantine(createMemoryVectorStorePaths(this.config.memoryDbDir, agentId))
    } finally {
      const previous = this.barriers.get(agentId)
      const barrier = (async () => {
        await previous
        await this.start()
        await this.request({ method: 'quarantine', agentId })
      })()
      this.barriers.set(agentId, barrier)
      void barrier.catch(() => undefined)
    }
  }

  async dispose(): Promise<void> {
    this.stopped = true
    const drain = (async () => {
      await Promise.allSettled([...this.stores.values()].map((store) => store.close(true)))
      await Promise.allSettled(this.barriers.values())
    })()
    // The composition owner stops the host next; unresolved native work stays owned until death.
    const result = await withSoftDeadline(drain, 5_000)
    if (result.timedOut)
      console.warn('[Memory] Vector disposal timed out; host shutdown will fence native work')
  }

  async close(store: RemoteMemoryVectorStore, preserveLease: boolean): Promise<void> {
    try {
      await this.startup
      if (this.startup) await this.request({ method: 'close', resource: store.id, preserveLease })
      await this.barriers.get(store.agentId)
    } finally {
      this.stores.delete(store.id)
    }
  }

  async upsert(store: RemoteMemoryVectorStore, records: MemoryVectorRecord[]): Promise<void> {
    store.assertUsable()
    if (!records.length) return
    if (endianness() !== 'LE') throw new Error('Memory vector uploads require a little-endian host')
    const bytes = records.length * store.dimensions * 4
    if (records.length > 50 || bytes > MEMORY_VECTOR_UPLOAD_BYTES)
      throw new Error('Memory vector upload exceeds batch limit')
    for (const record of records) {
      if (record.embedding.length !== store.dimensions)
        throw new Error('Invalid memory vector upload values')
      for (let index = 0; index < record.embedding.length; index++) {
        const value = record.embedding[index]
        if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
          throw new Error('Invalid memory vector upload values')
      }
    }
    if (this.uploads.activeCount + this.uploads.pendingCount >= 24)
      throw new Error('Memory vector upload queue limit exceeded')
    await this.uploads.run(async () => {
      store.assertUsable()
      const upload = randomUUID()
      const chunkAt = (offset: number, limit = MEMORY_VECTOR_CHUNK_BYTES) => {
        const chunk = Buffer.allocUnsafe(Math.min(limit, bytes - offset))
        const values = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.length / 4)
        let sourceOffset = offset / 4
        for (let local = 0; local < values.length; ) {
          const source = records[Math.floor(sourceOffset / store.dimensions)].embedding
          const start = sourceOffset % store.dimensions
          const count = Math.min(source.length - start, values.length - local)
          if (start === 0 && count === source.length) values.set(source, local)
          else {
            for (let index = 0; index < count; index++)
              values[local + index] = source[start + index]
          }
          local += count
          sourceOffset += count
        }
        return chunk
      }
      try {
        let offset: number
        {
          const first = chunkAt(0, MEMORY_VECTOR_INITIAL_CHUNK_BYTES)
          offset = first.length
          await this.request({
            method: 'begin',
            resource: store.id,
            upload,
            memoryIds: records.map((record) => record.memoryId),
            bytes,
            data: first
          })
        }
        while (offset < bytes) {
          store.assertUsable()
          const chunk = chunkAt(offset)
          if (offset + chunk.length === bytes) {
            await this.request({
              method: 'commit',
              resource: store.id,
              upload,
              offset,
              data: chunk
            })
            return
          }
          z.literal(offset + chunk.length).parse(
            await this.request({
              method: 'chunk',
              resource: store.id,
              upload,
              offset,
              data: chunk
            })
          )
          offset += chunk.length
        }
        store.assertUsable()
        await this.request({ method: 'commit', resource: store.id, upload })
      } catch (error) {
        await this.request({ method: 'abort', resource: store.id, upload }).catch(() => undefined)
        throw error
      }
    })
  }

  async request(command: MemoryCommand): Promise<unknown> {
    try {
      return await this.runtime.requestMemory({
        ...command,
        generation: this.config.generation,
        operation: randomUUID()
      } as MemoryVectorCommand)
    } catch (error) {
      if (!this.runtime.memoryAvailable)
        throw new MemoryVectorStoreQuarantineRequiredError(
          'Memory vector runtime is unavailable; restart DeepChat',
          { cause: error }
        )
      if (error instanceof Error) {
        if (error.name === 'MemoryVectorStoreTerminalRecoveryError') {
          throw new MemoryVectorStoreTerminalRecoveryError(error.message, {
            fatal: isDuckDbFatalError(error)
          })
        }
        if (
          ['MemoryVectorStoreQuarantineRequiredError', 'MemoryVectorStorePostCommitError'].includes(
            error.name
          )
        ) {
          throw new MemoryVectorStoreQuarantineRequiredError(error.message)
        }
      }
      throw error
    }
  }

  private start(): Promise<void> {
    return (this.startup ??= this.runtime.startMemory(this.config).catch((error) => {
      throw new MemoryVectorStoreQuarantineRequiredError(
        'Memory vector runtime failed to start; restart DeepChat',
        { cause: error }
      )
    }))
  }

  private assertAgent(agentId: string): void {
    if (!isSafeAgentId(agentId)) throw new Error('Invalid memory vector Agent identity')
  }
}

type MemoryCommand = MemoryVectorCommand extends infer T
  ? T extends MemoryVectorCommand
    ? Omit<T, 'generation' | 'operation'>
    : never
  : never

class RemoteMemoryVectorStore implements IMemoryVectorStore {
  private usable = true
  private closing: Promise<void> | undefined

  constructor(
    private readonly owner: RutisMemoryVectorStores,
    readonly agentId: string,
    readonly id: string,
    readonly dimensions: number
  ) {}

  isUsable(): boolean {
    return this.usable && this.owner.runtime.memoryAvailable
  }
  revoke(): void {
    this.usable = false
  }
  assertUsable(): void {
    if (!this.owner.runtime.memoryAvailable)
      throw new MemoryVectorStoreQuarantineRequiredError(
        'Memory vector runtime is unavailable; restart DeepChat'
      )
    if (!this.isUsable()) throw new Error('Memory vector resource is unavailable')
  }

  upsert(records: MemoryVectorRecord[]): Promise<void> {
    return this.owner.upsert(this, records)
  }

  async query(embedding: number[], options: MemoryVectorQueryOptions) {
    this.assertUsable()
    return matches.parse(
      await this.owner.request({
        method: 'query',
        resource: this.id,
        vector: encodeMemoryVector(embedding, this.dimensions).toString('base64'),
        topK: options.topK
      })
    )
  }

  async queryByMemoryId(memoryId: string, options: MemoryVectorQueryOptions) {
    this.assertUsable()
    return matches.parse(
      await this.owner.request({
        method: 'queryByMemoryId',
        resource: this.id,
        memoryId,
        topK: options.topK
      })
    )
  }

  async deleteByMemoryIds(memoryIds: string[]): Promise<void> {
    this.assertUsable()
    await this.owner.request({ method: 'delete', resource: this.id, memoryIds })
  }

  async listMemoryIds(afterId: string | null, limit: number): Promise<string[]> {
    this.assertUsable()
    return z
      .array(z.string().min(1).max(1024))
      .max(512)
      .parse(await this.owner.request({ method: 'list', resource: this.id, afterId, limit }))
  }

  close(preserveLease = false): Promise<void> {
    this.revoke()
    return (this.closing ??= this.owner.close(this, preserveLease))
  }
}
