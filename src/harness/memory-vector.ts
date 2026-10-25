import { AsyncSemaphore } from '@/lib/asyncSemaphore'
import fs from 'node:fs'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { MemoryVectorStore } from '@/memory/infra/memoryVectorStore'
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
  MEMORY_VECTOR_CHUNK_BYTES,
  MEMORY_VECTOR_PENDING,
  MemoryVectorCommandSchema,
  MemoryVectorConfigSchema,
  type MemoryVectorCommand,
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
  bytes: Buffer
  offset: number
  committing: boolean
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
    const command = MemoryVectorCommandSchema.parse(input)
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

  private async execute(command: MemoryVectorCommand): Promise<unknown> {
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
      case 'begin': {
        if (this.upload) throw new Error('Memory vector upload is busy')
        const initial = Buffer.from(command.data ?? '', 'base64')
        if (
          new Set(command.memoryIds).size !== command.memoryIds.length ||
          command.bytes !== command.memoryIds.length * resource.dimensions * 4 ||
          initial.length > command.bytes ||
          initial.length > MEMORY_VECTOR_CHUNK_BYTES
        ) {
          throw new Error('Invalid memory vector upload shape')
        }
        this.upload = {
          id: command.upload,
          resource: command.resource,
          memoryIds: command.memoryIds,
          bytes: Buffer.allocUnsafe(command.bytes),
          offset: initial.length,
          committing: false
        }
        initial.copy(this.upload.bytes)
        return null
      }
      case 'chunk': {
        const upload = this.requireUpload(command)
        this.append(upload, command.offset, command.data)
        return upload.offset
      }
      case 'commit': {
        const upload = this.requireUpload(command)
        if (command.data !== undefined || command.offset !== undefined) {
          if (command.data === undefined || command.offset === undefined)
            throw new Error('Invalid memory vector final chunk')
          this.append(upload, command.offset, command.data)
        }
        if (upload.offset !== upload.bytes.length)
          throw new Error('Memory vector upload is incomplete')
        const records = upload.memoryIds.map((memoryId, index) => ({
          memoryId,
          embedding: decodeMemoryVector(
            upload.bytes.subarray(
              index * resource.dimensions * 4,
              (index + 1) * resource.dimensions * 4
            ),
            resource.dimensions
          )
        }))
        upload.committing = true
        try {
          await this.run(resource, (store) => store.upsert(records), true)
          return null
        } finally {
          if (this.upload === upload) this.upload = undefined
        }
      }
      case 'abort':
        if (
          this.upload?.id === command.upload &&
          this.upload.resource === command.resource &&
          !this.upload.committing
        )
          this.upload = undefined
        return null
    }
  }

  private requireUpload(
    command: Extract<MemoryVectorCommand, { method: 'chunk' | 'commit' }>
  ): Upload {
    if (
      !this.upload ||
      this.upload.id !== command.upload ||
      this.upload.resource !== command.resource ||
      this.upload.committing
    ) {
      throw new Error('Memory vector upload is unavailable')
    }
    return this.upload
  }

  private append(upload: Upload, offset: number, data: string): void {
    const bytes = Buffer.from(data, 'base64')
    if (
      !bytes.length ||
      bytes.length > MEMORY_VECTOR_CHUNK_BYTES ||
      offset !== upload.offset ||
      bytes.length > upload.bytes.length - upload.offset
    ) {
      throw new Error('Invalid memory vector upload chunk')
    }
    bytes.copy(upload.bytes, upload.offset)
    upload.offset += bytes.length
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
    if (resource.disposal) return resource.disposal
    resource.closing = true
    const dirty = preserveLease || resource.writes > 0 || !resource.openingDone
    if (this.upload?.resource === id && !this.upload.committing) this.upload = undefined
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
