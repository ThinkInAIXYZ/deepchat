import logger from '@shared/logger'

import type { IMemoryVectorStore, MemoryVectorMatch } from '../types'
import { embeddingFingerprint, type MemoryModelRef, type MemoryRuntimeContext } from '../context'
import type { VectorStoreRetrievalPort } from '../ports'

export interface LockedVectorStorePort {
  open(embedding: MemoryModelRef, dimensions: number): Promise<IMemoryVectorStore>
  close(): Promise<void>
}

interface VectorStoreRuntimeState {
  vectorStores: Map<string, Promise<IMemoryVectorStore>>
  vectorStoreIdentities: Map<string, string>
  vectorStoreReady: Map<string, string>
  vectorStoreLocks: Map<string, Promise<unknown>>
}

export type VectorDeleteResult = 'deleted' | 'skipped' | 'unusable'

export interface VectorDeleteOptions {
  embeddingModel?: string | null
  embeddingDim?: number | null
}

function embeddingFromFingerprint(fingerprint: string | null | undefined): MemoryModelRef | null {
  if (!fingerprint) return null
  const separator = fingerprint.indexOf(':')
  if (separator <= 0 || separator === fingerprint.length - 1) return null
  return {
    providerId: fingerprint.slice(0, separator),
    modelId: fingerprint.slice(separator + 1)
  }
}

export class VectorStoreManager implements VectorStoreRetrievalPort {
  private readonly vectorStores = new Map<string, Promise<IMemoryVectorStore>>()
  private readonly vectorStoreIdentities = new Map<string, string>()
  private readonly vectorStoreReady = new Map<string, string>()
  private readonly vectorStoreLocks = new Map<string, Promise<unknown>>()

  constructor(private readonly ctx: MemoryRuntimeContext) {}

  cacheKey(agentId: string, embedding: MemoryModelRef, dimensions: number): string {
    return `${agentId}::${embedding.providerId}::${embedding.modelId}::${dimensions}`
  }

  warmupKey(agentId: string, embedding: MemoryModelRef): string {
    return `${agentId}::${embedding.providerId}::${embedding.modelId}`
  }

  isWarm(agentId: string, embedding: MemoryModelRef): boolean {
    const readyIdentity = this.vectorStoreReady.get(agentId)
    if (!readyIdentity) return false
    if (this.vectorStoreIdentities.get(agentId) !== readyIdentity) return false
    if (!this.vectorStores.has(agentId)) return false
    return readyIdentity.startsWith(`${this.warmupKey(agentId, embedding)}::`)
  }

  getWarmVectorStoreDimension(agentId: string, embedding: MemoryModelRef): number | null {
    const readyIdentity = this.vectorStoreReady.get(agentId)
    if (!readyIdentity) return null
    if (this.vectorStoreIdentities.get(agentId) !== readyIdentity) return null
    if (!this.vectorStores.has(agentId)) return null
    const prefix = `${this.warmupKey(agentId, embedding)}::`
    if (!readyIdentity.startsWith(prefix)) return null
    const dimensions = Number(readyIdentity.slice(prefix.length))
    return Number.isFinite(dimensions) && dimensions > 0 ? Math.floor(dimensions) : null
  }

  markReady(agentId: string, embedding: MemoryModelRef, dimensions: number): void {
    this.vectorStoreReady.set(agentId, this.cacheKey(agentId, embedding, dimensions))
  }

  clearReady(agentId: string): void {
    this.vectorStoreReady.delete(agentId)
  }

  withAgentLock<T>(
    agentId: string,
    task: (locked: LockedVectorStorePort) => Promise<T>
  ): Promise<T> {
    const prev = this.vectorStoreLocks.get(agentId) ?? Promise.resolve()
    const run = prev.then(async () => {
      let active = true
      const assertActive = (): void => {
        if (!active) {
          throw new Error('[Memory] vector store lock capability used outside its lock scope')
        }
      }
      const locked: LockedVectorStorePort = {
        open: (embedding, dimensions) => {
          assertActive()
          return this.openVectorStoreLocked(agentId, embedding, dimensions)
        },
        close: () => {
          assertActive()
          return this.closeVectorStoreLocked(agentId)
        }
      }
      try {
        return await task(locked)
      } finally {
        active = false
      }
    })
    this.vectorStoreLocks.set(
      agentId,
      run.then(
        () => undefined,
        () => undefined
      )
    )
    return run
  }

  private async vectorStoreForAgent(agentId: string): Promise<IMemoryVectorStore | null> {
    const pending = this.vectorStores.get(agentId)
    return pending ? pending.catch(() => null) : null
  }

  private async closeVectorStoreLocked(agentId: string): Promise<void> {
    this.clearReady(agentId)
    const pending = this.vectorStores.get(agentId)
    if (!pending) {
      this.vectorStoreIdentities.delete(agentId)
      return
    }
    this.vectorStores.delete(agentId)
    this.vectorStoreIdentities.delete(agentId)
    const store = await pending.catch(() => null)
    if (store) await store.close().catch(() => undefined)
  }

  getVectorStore(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number
  ): Promise<IMemoryVectorStore> {
    return this.withAgentLock(agentId, (locked) => locked.open(embedding, dimensions))
  }

  private async openVectorStoreLocked(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number
  ): Promise<IMemoryVectorStore> {
    const identity = this.cacheKey(agentId, embedding, dimensions)
    const cached = this.vectorStores.get(agentId)
    if (cached && this.vectorStoreIdentities.get(agentId) === identity) return cached
    await this.closeVectorStoreLocked(agentId)
    const pending = this.ctx.deps
      .createVectorStore(agentId, embedding, dimensions)
      .catch((error) => {
        this.vectorStores.delete(agentId)
        this.vectorStoreIdentities.delete(agentId)
        this.clearReady(agentId)
        throw error
      })
    this.vectorStores.set(agentId, pending)
    this.vectorStoreIdentities.set(agentId, identity)
    return pending
  }

  async resetAgentStore(agentId: string): Promise<void> {
    await this.withAgentLock(agentId, async (locked) => {
      await locked.close()
      await this.ctx.deps.resetVectorStore(agentId)
    })
  }

  async closeAgentStore(agentId: string): Promise<void> {
    await this.withAgentLock(agentId, async (locked) => {
      await locked.close()
    })
  }

  async deleteVectorsForMemoryIdsOpening(
    agentId: string,
    memoryIds: string[],
    options: VectorDeleteOptions = {}
  ): Promise<VectorDeleteResult> {
    if (!memoryIds.length) return 'skipped'
    let result: VectorDeleteResult = 'skipped'
    await this.withAgentLock(agentId, async (locked) => {
      if (this.ctx.isDisposed) return
      let targetEmbedding = embeddingFromFingerprint(options.embeddingModel)
      let targetDimensions =
        typeof options.embeddingDim === 'number' &&
        Number.isFinite(options.embeddingDim) &&
        options.embeddingDim > 0
          ? Math.floor(options.embeddingDim)
          : null

      if (!targetEmbedding) {
        const embedding = this.ctx.deps.resolveAgentConfig(agentId)?.memoryEmbedding
        if (!embedding?.providerId || !embedding?.modelId) {
          logger.debug(`[Memory] vector delete skipped for ${agentId}: embedding is not configured`)
          return
        }
        targetEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
      }
      if (targetDimensions === null) {
        const fingerprint = embeddingFingerprint(
          targetEmbedding.providerId,
          targetEmbedding.modelId
        )
        targetDimensions =
          this.getWarmVectorStoreDimension(agentId, targetEmbedding) ??
          this.ctx.deps.repository.getCurrentEmbeddingDimension(agentId, fingerprint)
        if (targetDimensions === null) {
          logger.debug(`[Memory] vector delete deferred for ${agentId}: dimension is unknown`)
          return
        }
      }

      const targetIdentity = this.cacheKey(agentId, targetEmbedding, targetDimensions)
      let store =
        this.vectorStoreIdentities.get(agentId) === targetIdentity
          ? await this.vectorStoreForAgent(agentId)
          : null
      if (!store) {
        try {
          store = await locked.open(targetEmbedding, targetDimensions)
        } catch (error) {
          logger.warn(`[Memory] vector delete open failed for ${agentId}: ${String(error)}`)
          return
        }
      }
      if (!store.isUsable()) {
        this.clearReady(agentId)
        result = 'unusable'
        return
      }
      try {
        await store.deleteByMemoryIds(memoryIds)
        result = 'deleted'
      } catch (error) {
        logger.warn(`[Memory] vector delete failed: ${String(error)}`)
      }
    })
    return result
  }

  async deletePrunableVectorsForMemoryIds(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    memoryIds: string[]
  ): Promise<string[]> {
    if (!memoryIds.length) return []
    return this.withAgentLock(agentId, async (locked) => {
      if (this.ctx.isDisposed) return []
      const store = await locked.open(embedding, dimensions)
      if (!store.isUsable()) {
        this.clearReady(agentId)
        return []
      }
      const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
      const prunableIds = this.ctx.deps.repository.filterPrunableVectorRefs(
        agentId,
        memoryIds,
        dimensions,
        fingerprint
      )
      if (!prunableIds.length) return []
      try {
        await store.deleteByMemoryIds(prunableIds)
        return prunableIds
      } catch (error) {
        logger.warn(`[Memory] vector prune failed: ${String(error)}`)
        return []
      }
    })
  }

  async queryNeighborsByMemoryId(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    memoryId: string,
    topK: number
  ): Promise<MemoryVectorMatch[]> {
    return this.withAgentLock(agentId, async (locked) => {
      if (this.ctx.isDisposed) return []
      const store = await locked.open(embedding, dimensions)
      if (!store.isUsable()) {
        this.clearReady(agentId)
        return []
      }
      return store.queryByMemoryId(memoryId, { topK })
    })
  }

  getLockInFlight(): Promise<unknown>[] {
    return [...this.vectorStoreLocks.values()]
  }

  async closeAllStores(): Promise<void> {
    const agentIds = new Set([...this.vectorStoreLocks.keys(), ...this.vectorStores.keys()])
    for (const agentId of agentIds) {
      await this.withAgentLock(agentId, async (locked) => {
        await locked.close()
      }).catch(() => undefined)
    }
    await Promise.allSettled(this.vectorStoreLocks.values())
    for (const pending of this.vectorStores.values()) {
      const store = await pending.catch(() => null)
      if (store) await store.close().catch(() => undefined)
    }
    this.vectorStores.clear()
    this.vectorStoreIdentities.clear()
    this.vectorStoreReady.clear()
    this.vectorStoreLocks.clear()
  }

  async settleAgent(agentId: string): Promise<void> {
    const vectorStoreLock = this.vectorStoreLocks.get(agentId)
    if (vectorStoreLock) await Promise.allSettled([vectorStoreLock])
    if (this.vectorStoreLocks.get(agentId) === vectorStoreLock) {
      this.vectorStoreLocks.delete(agentId)
    }
    this.vectorStoreReady.delete(agentId)
  }

  clearAgentReady(agentId: string): void {
    this.vectorStoreReady.delete(agentId)
  }

  currentEmbeddingFingerprint(embedding: MemoryModelRef): string {
    return embeddingFingerprint(embedding.providerId, embedding.modelId)
  }

  /** @internal Live mutable state for legacy facade-oracle tests only. */
  getMutableRuntimeStateForTests(): VectorStoreRuntimeState {
    return {
      vectorStores: this.vectorStores,
      vectorStoreIdentities: this.vectorStoreIdentities,
      vectorStoreReady: this.vectorStoreReady,
      vectorStoreLocks: this.vectorStoreLocks
    }
  }
}
