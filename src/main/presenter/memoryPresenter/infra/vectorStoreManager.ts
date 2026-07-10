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

interface VectorStoreLeaseState {
  generation: number
  accepting: boolean
  active: number
  requiresReset: boolean
  drainWaiters: Set<() => void>
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
  private readonly leaseStates = new Map<string, VectorStoreLeaseState>()
  private stopped = false

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

  markReady(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    generation?: number
  ): void {
    if (generation !== undefined && this.leaseState(agentId).generation !== generation) return
    this.vectorStoreReady.set(agentId, this.cacheKey(agentId, embedding, dimensions))
  }

  clearReady(agentId: string): void {
    this.vectorStoreReady.delete(agentId)
  }

  stopAdmission(): void {
    this.stopped = true
    for (const [agentId, state] of this.leaseStates) {
      state.accepting = false
      state.generation += 1
      this.clearReady(agentId)
    }
  }

  private leaseState(agentId: string): VectorStoreLeaseState {
    let state = this.leaseStates.get(agentId)
    if (!state) {
      state = {
        generation: 1,
        accepting: true,
        active: 0,
        requiresReset: false,
        drainWaiters: new Set()
      }
      this.leaseStates.set(agentId, state)
    }
    return state
  }

  private withAgentLock<T>(
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

  async withStoreLease<T>(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    task: (store: IMemoryVectorStore, generation: number) => Promise<T>
  ): Promise<T> {
    const state = this.leaseState(agentId)
    if (this.stopped || !state.accepting) {
      throw new Error('[Memory] vector store lease admission is closed')
    }
    const store = await this.withAgentLock(agentId, async (locked) => {
      if (this.stopped || !state.accepting) {
        throw new Error('[Memory] vector store lease admission is closed')
      }
      if (state.requiresReset) {
        await this.ctx.deps.resetVectorStore(agentId)
        state.requiresReset = false
      }
      return locked.open(embedding, dimensions)
    })
    if (this.stopped || !state.accepting) {
      throw new Error('[Memory] vector store lease admission is closed')
    }
    const generation = state.generation
    state.active += 1
    try {
      return await task(store, generation)
    } finally {
      state.active -= 1
      if (state.active === 0) {
        for (const resolve of state.drainWaiters) resolve()
        state.drainWaiters.clear()
      }
    }
  }

  private waitForLeaseDrain(state: VectorStoreLeaseState): Promise<void> {
    if (state.active === 0) return Promise.resolve()
    return new Promise((resolve) => state.drainWaiters.add(resolve))
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

  query(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    vector: number[],
    topK: number
  ): Promise<MemoryVectorMatch[]> {
    return this.withStoreLease(agentId, embedding, dimensions, async (store, generation) => {
      if (!store.isUsable()) {
        this.clearReady(agentId)
        return []
      }
      this.markReady(agentId, embedding, dimensions, generation)
      return store.query(vector, { topK })
    })
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
    await this.drainAndClose(agentId, true)
  }

  async retireAgentStore(agentId: string): Promise<void> {
    await this.drainAndClose(agentId, true, true)
  }

  async closeAgentStore(agentId: string): Promise<void> {
    await this.drainAndClose(agentId, false)
  }

  private async drainAndClose(agentId: string, reset: boolean, permanent = false): Promise<void> {
    const state = this.leaseState(agentId)
    state.accepting = false
    state.generation += 1
    this.clearReady(agentId)
    try {
      await this.waitForLeaseDrain(state)
      await this.withAgentLock(agentId, async (locked) => {
        await locked.close()
        if (reset) {
          try {
            await this.ctx.deps.resetVectorStore(agentId)
            state.requiresReset = false
          } catch (error) {
            state.requiresReset = true
            throw error
          }
        }
      })
    } finally {
      if (!permanent && !this.stopped) state.accepting = true
    }
  }

  isGenerationCurrent(agentId: string, generation: number): boolean {
    return this.leaseState(agentId).generation === generation
  }

  async deleteVectorsForMemoryIdsOpening(
    agentId: string,
    memoryIds: string[],
    options: VectorDeleteOptions = {}
  ): Promise<VectorDeleteResult> {
    if (!memoryIds.length) return 'skipped'
    let result: VectorDeleteResult = 'skipped'
    const targetEmbedding = embeddingFromFingerprint(options.embeddingModel)
    let resolvedEmbedding = targetEmbedding
    let targetDimensions =
      typeof options.embeddingDim === 'number' &&
      Number.isFinite(options.embeddingDim) &&
      options.embeddingDim > 0
        ? Math.floor(options.embeddingDim)
        : null
    if (!resolvedEmbedding) {
      const embedding = this.ctx.deps.resolveAgentConfig(agentId)?.memoryEmbedding
      if (!embedding?.providerId || !embedding?.modelId) return 'skipped'
      resolvedEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
    }
    if (targetDimensions === null) {
      const fingerprint = embeddingFingerprint(
        resolvedEmbedding.providerId,
        resolvedEmbedding.modelId
      )
      targetDimensions =
        this.getWarmVectorStoreDimension(agentId, resolvedEmbedding) ??
        this.ctx.deps.repository.getCurrentEmbeddingDimension(agentId, fingerprint)
      if (targetDimensions === null) return 'skipped'
    }
    try {
      await this.withStoreLease(agentId, resolvedEmbedding, targetDimensions, async (store) => {
        if (this.ctx.isDisposed) return
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
    } catch (error) {
      logger.warn(`[Memory] vector delete open failed for ${agentId}: ${String(error)}`)
    }
    return result
  }

  async deletePrunableVectorsForMemoryIds(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    memoryIds: string[]
  ): Promise<string[]> {
    if (!memoryIds.length) return []
    return this.withStoreLease(agentId, embedding, dimensions, async (store) => {
      if (this.ctx.isDisposed) return []
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
    return this.withStoreLease(agentId, embedding, dimensions, async (store) => {
      if (this.ctx.isDisposed) return []
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
    this.stopAdmission()
    const agentIds = new Set([...this.vectorStoreLocks.keys(), ...this.vectorStores.keys()])
    await Promise.allSettled(
      [...agentIds].map((agentId) => this.drainAndClose(agentId, false, true))
    )
    await Promise.allSettled(this.vectorStoreLocks.values())
    for (const pending of this.vectorStores.values()) {
      const store = await pending.catch(() => null)
      if (store) await store.close().catch(() => undefined)
    }
    this.vectorStores.clear()
    this.vectorStoreIdentities.clear()
    this.vectorStoreReady.clear()
    this.vectorStoreLocks.clear()
    this.leaseStates.clear()
  }

  async settleAgent(agentId: string): Promise<void> {
    const vectorStoreLock = this.vectorStoreLocks.get(agentId)
    if (vectorStoreLock) await Promise.allSettled([vectorStoreLock])
    if (this.vectorStoreLocks.get(agentId) === vectorStoreLock) {
      this.vectorStoreLocks.delete(agentId)
    }
    this.vectorStoreReady.delete(agentId)
    this.leaseStates.delete(agentId)
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
