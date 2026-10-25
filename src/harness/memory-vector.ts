import { AsyncSemaphore } from '@/lib/asyncSemaphore'
import fs from 'node:fs'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { MemoryVectorStore, type PackedMemoryVectors } from '@/memory/infra/memoryVectorStore'
import {
  createMemoryVectorStorePaths,
  MEMORY_VECTOR_OWNER_FILE,
  MEMORY_VECTOR_LEASE_SUFFIX
} from '@/memory/infra/memoryVectorStorePaths'
import { isSafeAgentId } from '@shared/types/agent-memory'
import {
  isDuckDbFatalError,
  MemoryVectorStoreQuarantineRequiredError
} from '@/memory/infra/vectorStoreErrors'
import {
  decodeMemoryVector,
  isMemoryVectorControl,
  MEMORY_VECTOR_PENDING,
  MEMORY_VECTOR_NATIVE_PART_BYTES,
  MemoryVectorNativeCommandSchema,
  MemoryVectorConfigSchema,
  type MemoryVectorNativeCommand,
  type MemoryVectorConfig
} from '@shared/harness/memory-vector'

interface Resource {
  agentId: string
  dimensions: number
  opening: Promise<MemoryVectorStore>
  tail: Promise<unknown>
  closing: boolean
  openingDone: boolean
  writes: number
  disposal?: Promise<void>
}

interface Upload {
  id: string
  resource: string
  memoryIds: string[]
  bytes: Buffer<ArrayBuffer>
  offset: number
  committing: boolean
  records: ReturnType<typeof Promise.withResolvers<PackedMemoryVectors>>
  writing: Promise<void>
}

export class MemoryVectorOwner {
  private readonly config: MemoryVectorConfig
  private readonly resources = new Map<string, Resource>()
  private readonly agents = new Map<string, string>()
  private readonly jobs = new AsyncSemaphore(2)
  private readonly operations = new Set<string>()
  private readonly recovered = new Set<string>()
  private readonly quarantined = new Set<string>()
  private upload: Upload | undefined
  private stopped = false
  private readonly ownership: Promise<DuckDBInstance>

  constructor(config: MemoryVectorConfig) {
    this.config = MemoryVectorConfigSchema.parse(config)
    const memoryDbDir = this.config.memoryDbDir
    this.ownership = (async () => {
      fs.mkdirSync(memoryDbDir, { recursive: true })
      let owner: DuckDBInstance
      try {
        owner = await DuckDBInstance.create(path.join(memoryDbDir, MEMORY_VECTOR_OWNER_FILE), {
          threads: '1',
          memory_limit: '16MB'
        })
      } catch {
        const error = new Error('Memory vector file ownership is unavailable')
        error.name = 'MemoryVectorOwnershipUnavailableError'
        throw error
      }
      try {
        if (this.stopped) throw new Error('Memory vector owner is stopping')
        for (const entry of fs.readdirSync(memoryDbDir, { withFileTypes: true })) {
          const suffix = entry.name.endsWith(MEMORY_VECTOR_LEASE_SUFFIX)
            ? MEMORY_VECTOR_LEASE_SUFFIX
            : entry.name.endsWith('.v2.duckdb.quarantine')
              ? '.v2.duckdb.quarantine'
              : undefined
          if (!entry.isFile() || !suffix) continue
          const agentId = entry.name.slice(0, -suffix.length)
          if (!isSafeAgentId(agentId)) continue
          this.recovered.add(agentId)
          MemoryVectorStore.markQuarantined(this.paths(agentId))
        }
        MemoryVectorStore.recoverQuarantinedStores(memoryDbDir)
        return owner
      } catch (error) {
        owner.closeSync()
        throw error
      }
    })()
    void this.ownership.catch(() => undefined)
  }

  async command(input: unknown): Promise<unknown> {
    const command = MemoryVectorNativeCommandSchema.parse(input)
    if (this.stopped || command.generation !== this.config.generation) {
      throw new Error('Memory vector generation is unavailable')
    }
    if (
      this.operations.has(command.operation) ||
      this.operations.size >=
        (isMemoryVectorControl(command.method) ? MEMORY_VECTOR_PENDING : MEMORY_VECTOR_PENDING - 8)
    ) {
      throw new Error('Memory vector operation limit exceeded')
    }
    this.operations.add(command.operation)
    try {
      await this.ownership
      if (this.stopped) throw new Error('Memory vector owner is stopping')
      return await this.execute(command)
    } finally {
      this.operations.delete(command.operation)
    }
  }

  async dispose(): Promise<void> {
    this.stopped = true
    this.upload?.records.reject(new Error('Memory vector owner is stopping'))
    this.upload = undefined
    await Promise.all([...this.resources].map(([id, resource]) => this.close(id, resource, true)))
    const owner = await this.ownership.catch(() => undefined)
    owner?.closeSync()
  }

  private paths(agentId: string) {
    return createMemoryVectorStorePaths(this.config.memoryDbDir, agentId)
  }

  private lease(agentId: string) {
    return `${this.paths(agentId).current}.lease`
  }

  private quarantine(agentId: string): void {
    this.quarantined.add(agentId)
    const id = this.agents.get(agentId)
    const resource = id ? this.resources.get(id) : undefined
    if (resource) resource.closing = true
    try {
      MemoryVectorStore.markQuarantined(this.paths(agentId))
    } catch (error) {
      throw new MemoryVectorStoreQuarantineRequiredError('Vector quarantine marker failed', {
        cause: error
      })
    }
  }

  private assertRecoverable(agentId: string): void {
    if (this.quarantined.has(agentId))
      throw new MemoryVectorStoreQuarantineRequiredError(
        'Native vector recovery requires a new process'
      )
  }

  private async execute(command: MemoryVectorNativeCommand): Promise<unknown> {
    if (command.method === 'open') {
      this.assertRecoverable(command.agentId)
      if (this.resources.has(command.resource) || this.agents.has(command.agentId)) {
        throw new Error('Memory vector store already has an owner')
      }
      if (fs.existsSync(this.lease(command.agentId))) {
        this.recovered.add(command.agentId)
        MemoryVectorStore.markQuarantined(this.paths(command.agentId))
      }
      fs.writeFileSync(this.lease(command.agentId), '')
      const opening = this.jobs.run(() =>
        MemoryVectorStore.create(
          this.paths(command.agentId),
          command.dimensions,
          command.embedding,
          this.config.host
        )
      )
      const resource: Resource = {
        agentId: command.agentId,
        dimensions: command.dimensions,
        opening,
        tail: opening,
        closing: false,
        openingDone: false,
        writes: 0
      }
      this.resources.set(command.resource, resource)
      this.agents.set(command.agentId, command.resource)
      void opening.then(
        () => {
          resource.openingDone = true
        },
        () => {
          resource.openingDone = true
        }
      )
      try {
        const store = await opening
        if (resource.closing) throw new Error('Memory vector resource was revoked while opening')
        return {
          resource: command.resource,
          usable: store.isUsable() && !this.recovered.has(command.agentId)
        }
      } catch (error) {
        if (
          error instanceof MemoryVectorStoreQuarantineRequiredError ||
          isDuckDbFatalError(error)
        ) {
          this.quarantine(resource.agentId)
          throw error
        }
        // Failed or late opens remain owned until the native promise has settled and cleanup runs.
        await this.close(command.resource, resource)
        throw error
      }
    }
    if (command.method === 'reset' || command.method === 'quarantine') {
      const id = this.agents.get(command.agentId)
      const resource = id ? this.resources.get(id) : undefined
      if (command.method === 'quarantine') {
        this.quarantine(command.agentId)
        return null
      }
      this.assertRecoverable(command.agentId)
      if (id && resource) await this.close(id, resource)
      if (command.method === 'reset') {
        MemoryVectorStore.destroyFiles(this.paths(command.agentId))
        this.recovered.delete(command.agentId)
      }
      return null
    }
    const resource = this.resources.get(command.resource)
    if (command.method === 'close') {
      if (resource) await this.close(command.resource, resource, command.preserveLease)
      return null
    }
    if (!resource || resource.closing) throw new Error('Memory vector resource is unavailable')
    switch (command.method) {
      case 'query': {
        const vector = decodeMemoryVector(
          Buffer.from(command.vector, 'base64'),
          resource.dimensions
        )
        return this.run(resource, (store) => store.query(vector, { topK: command.topK }))
      }
      case 'queryByMemoryId':
        return this.run(resource, (store) =>
          store.queryByMemoryId(command.memoryId, { topK: command.topK })
        )
      case 'delete':
        return this.run(resource, (store) => store.deleteByMemoryIds(command.memoryIds), true)
      case 'list':
        return this.run(resource, (store) => store.listMemoryIds(command.afterId, command.limit))
      case 'upsert': {
        const complete = command.offset === 0 && command.data.length === command.bytes
        if (
          !(command.data.buffer instanceof ArrayBuffer) ||
          new Set(command.memoryIds).size !== command.memoryIds.length ||
          command.bytes !== command.memoryIds.length * resource.dimensions * 4
        )
          throw new Error('Invalid memory vector upload shape')
        if (command.offset === 0) {
          if (this.upload) throw new Error('Memory vector upload is busy')
          const bytes = complete
            ? Buffer.from(command.data.buffer, command.data.byteOffset, command.data.byteLength)
            : Buffer.allocUnsafe(command.bytes)
          const records = Promise.withResolvers<PackedMemoryVectors>()
          void records.promise.catch(() => undefined)
          const writing = this.run(resource, async (store) => {
            const batch = await records.promise
            if (resource.closing || this.recovered.has(resource.agentId) || !store.isUsable())
              throw new Error('Memory vector resource is unavailable')
            resource.writes++
            try {
              await store.upsertPacked(batch)
            } finally {
              resource.writes--
            }
          })
          void writing.catch(() => undefined)
          this.upload = {
            id: command.upload,
            resource: command.resource,
            memoryIds: command.memoryIds,
            bytes,
            offset: 0,
            committing: false,
            records,
            writing
          }
        }
        const upload = this.upload
        if (
          !upload ||
          upload.id !== command.upload ||
          upload.resource !== command.resource ||
          upload.committing
        )
          throw new Error('Memory vector upload is unavailable')
        try {
          if (
            command.offset !== upload.offset ||
            command.bytes !== upload.bytes.length ||
            command.memoryIds.length !== upload.memoryIds.length ||
            command.memoryIds.some((id, index) => id !== upload.memoryIds[index]) ||
            command.data.length > MEMORY_VECTOR_NATIVE_PART_BYTES ||
            command.data.length > upload.bytes.length - upload.offset
          )
            throw new Error('Invalid memory vector upload part')
          if (!complete) upload.bytes.set(command.data, upload.offset)
          upload.offset += command.data.length
          if (upload.offset !== upload.bytes.length) return null
          upload.committing = true
          upload.records.resolve({
            memoryIds: upload.memoryIds,
            dimensions: resource.dimensions,
            bytes: upload.bytes
          })
          await upload.writing
          return null
        } catch (error) {
          upload.records.reject(error)
          await upload.writing.catch(() => undefined)
          if (this.upload === upload) this.upload = undefined
          throw error
        } finally {
          if (upload.committing || upload.offset === upload.bytes.length) this.upload = undefined
        }
      }
      case 'abort':
        if (
          this.upload?.id === command.upload &&
          this.upload.resource === command.resource &&
          !this.upload.committing
        ) {
          const upload = this.upload
          upload.records.reject(new Error('Memory vector upload was aborted'))
          await upload.writing.catch(() => undefined)
          if (this.upload === upload) this.upload = undefined
        }
        return null
    }
  }

  private run<T>(
    resource: Resource,
    task: (store: MemoryVectorStore) => Promise<T>,
    write = false
  ): Promise<T> {
    if (write) resource.writes++
    const result = resource.tail
      .catch(() => undefined)
      .then(async () => {
        const store = await resource.opening
        try {
          return await this.jobs.run(() => {
            if (resource.closing || this.recovered.has(resource.agentId) || !store.isUsable())
              throw new Error('Memory vector resource is unavailable')
            return task(store)
          })
        } catch (error) {
          if (
            error instanceof MemoryVectorStoreQuarantineRequiredError ||
            isDuckDbFatalError(error)
          ) {
            this.quarantine(resource.agentId)
          }
          throw error
        }
      })
      .finally(() => {
        if (write) resource.writes--
      })
    resource.tail = result
    return result
  }

  private close(id: string, resource: Resource, preserveLease = false): Promise<void> {
    if (this.upload?.resource === id && !this.upload.committing) {
      this.upload.records.reject(new Error('Memory vector resource is closing'))
      this.upload = undefined
    }
    if (resource.disposal) return resource.disposal
    resource.closing = true
    const dirty = preserveLease || resource.writes > 0 || !resource.openingDone
    resource.disposal = (async () => {
      await resource.tail.catch(() => undefined)
      this.assertRecoverable(resource.agentId)
      const store = await resource.opening.catch(() => undefined)
      if (store) {
        try {
          await this.jobs.run(() => store.close())
        } catch (error) {
          this.quarantine(resource.agentId)
          throw new MemoryVectorStoreQuarantineRequiredError(
            'Native vector close failed; recovery requires a new process',
            { cause: error }
          )
        }
      }
      if (!dirty) fs.rmSync(this.lease(resource.agentId), { force: true })
      if (this.resources.get(id) === resource) {
        this.resources.delete(id)
        this.agents.delete(resource.agentId)
      }
    })()
    return resource.disposal
  }
}
