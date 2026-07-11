import logger from '@shared/logger'

import type { IMemoryVectorStore, MemoryVectorMatch } from '../types'
import { embeddingFingerprint, type MemoryModelRef, type MemoryRuntimeContext } from '../context'
import type {
  MemoryAgentPolicyPort,
  MemoryEmbeddingRepositoryPort,
  MemoryPerfObserver,
  MemoryVectorStoreFactoryPort,
  VectorStoreRetrievalPort
} from '../ports'
import {
  VECTOR_STORE_IDLE_TTL_MS,
  VECTOR_STORE_SOFT_CAP,
  VECTOR_STORE_SWEEP_INTERVAL_MS
} from '../runtimeConstants'

export interface LockedVectorStorePort {
  open(embedding: MemoryModelRef, dimensions: number): Promise<IMemoryVectorStore>
  close(options?: { clearCertificate?: boolean }): Promise<void>
}

interface VectorStoreRuntimeState {
  vectorStores: Map<string, Promise<IMemoryVectorStore>>
  vectorStoreIdentities: Map<string, string>
  vectorStoreReady: Map<string, VectorReadyCertificate>
  vectorStoreLocks: Map<string, Promise<unknown>>
}

interface VectorStoreLeaseState {
  leaseEpoch: number
  storeGeneration: number
  configGeneration: number
  configFingerprint: string | null | undefined
  logicalIdentity: string | null
  accepting: boolean
  active: number
  openInFlight: number
  lastUsedAt: number
  requiresReset: boolean
  drainWaiters: Set<() => void>
}

export interface VectorReadyCertificate {
  agentId: string
  providerId: string
  modelId: string
  dimensions: number
  storeGeneration: number
  configGeneration: number
}

export class VectorStoreLeaseUnavailableError extends Error {
  constructor(
    readonly reason: 'stopped' | 'admission-closed' | 'stale-identity',
    message: string
  ) {
    super(message)
    this.name = 'VectorStoreLeaseUnavailableError'
  }
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
  private readonly ctx: MemoryRuntimeContext
  private readonly vectorStores = new Map<string, Promise<IMemoryVectorStore>>()
  private readonly vectorStoreIdentities = new Map<string, string>()
  private readonly vectorStoreReady = new Map<string, VectorReadyCertificate>()
  private readonly vectorStoreLocks = new Map<string, Promise<unknown>>()
  private readonly vectorMutationLocks = new Map<string, Promise<unknown>>()
  private readonly leaseStates = new Map<string, VectorStoreLeaseState>()
  private readonly identityTransitions = new Map<string, Promise<void>>()
  private resourceSweepTimer: ReturnType<typeof setInterval> | null = null
  private resourceConvergenceTimer: ReturnType<typeof setTimeout> | null = null
  private resourceConvergence: Promise<void> | null = null
  private resourceConvergenceRequested = false
  private stopped = false

  constructor(
    private readonly ports: {
      ctx: MemoryRuntimeContext
      repository: MemoryEmbeddingRepositoryPort
      policy: MemoryAgentPolicyPort
      vectorStoreFactory: MemoryVectorStoreFactoryPort
      perfObserver?: MemoryPerfObserver
    }
  ) {
    this.ctx = ports.ctx
  }

  private observeResources(): void {
    const observer = this.ports.perfObserver
    if (!observer) return
    observer.observe('openStores', this.vectorStores.size)
    observer.observe(
      'activeLeases',
      [...this.leaseStates.values()].reduce((total, state) => total + state.active, 0)
    )
    observer.observe('cacheEntries', this.vectorStores.size)
  }

  cacheKey(agentId: string, embedding: MemoryModelRef, dimensions: number): string {
    return `${agentId}::${embedding.providerId}::${embedding.modelId}::${dimensions}`
  }

  warmupKey(agentId: string, embedding: MemoryModelRef): string {
    return `${agentId}::${embedding.providerId}::${embedding.modelId}`
  }

  private resolveCurrentEmbedding(agentId: string): MemoryModelRef | null {
    const embedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
    return embedding?.providerId && embedding?.modelId
      ? { providerId: embedding.providerId, modelId: embedding.modelId }
      : null
  }

  private syncConfigIdentity(agentId: string, embedding: MemoryModelRef | null): boolean {
    const state = this.leaseState(agentId)
    const fingerprint = embedding
      ? embeddingFingerprint(embedding.providerId, embedding.modelId)
      : null
    if (state.configFingerprint === undefined) {
      state.configFingerprint = fingerprint
      return false
    }
    if (state.configFingerprint === fingerprint) return false
    state.configFingerprint = fingerprint
    state.configGeneration += 1
    state.storeGeneration += 1
    state.logicalIdentity = null
    this.clearReady(agentId)
    return true
  }

  noteEmbeddingConfig(agentId: string, embedding: MemoryModelRef | null): boolean {
    if (!this.syncConfigIdentity(agentId, embedding)) return false
    void this.beginConfigIdentityTransition(agentId).catch((error) => {
      logger.warn(`[Memory] vector identity transition failed for ${agentId}: ${String(error)}`)
    })
    return true
  }

  private beginConfigIdentityTransition(agentId: string): Promise<void> {
    const state = this.leaseState(agentId)
    state.accepting = false
    state.leaseEpoch += 1
    const transitionEpoch = state.leaseEpoch
    const previous = this.identityTransitions.get(agentId) ?? Promise.resolve()
    const tracked = previous
      .catch(() => undefined)
      .then(async () => {
        await this.waitForLeaseDrain(state)
        await this.withAgentLock(agentId, async (locked) => {
          await locked.close({ clearCertificate: true })
        })
      })
      .finally(() => {
        if (this.identityTransitions.get(agentId) !== tracked) return
        this.identityTransitions.delete(agentId)
        if (!this.stopped && state.leaseEpoch === transitionEpoch) state.accepting = true
      })
    this.identityTransitions.set(agentId, tracked)
    return tracked
  }

  hasReadyCertificate(agentId: string, embedding: MemoryModelRef): boolean {
    const currentEmbedding = this.resolveCurrentEmbedding(agentId)
    if (this.syncConfigIdentity(agentId, currentEmbedding)) {
      void this.beginConfigIdentityTransition(agentId).catch((error) => {
        logger.warn(`[Memory] vector identity transition failed for ${agentId}: ${String(error)}`)
      })
      return false
    }
    if (
      currentEmbedding?.providerId !== embedding.providerId ||
      currentEmbedding.modelId !== embedding.modelId
    ) {
      return false
    }
    const certificate = this.vectorStoreReady.get(agentId)
    const state = this.leaseState(agentId)
    return (
      certificate?.agentId === agentId &&
      certificate.providerId === embedding.providerId &&
      certificate.modelId === embedding.modelId &&
      certificate.storeGeneration === state.storeGeneration &&
      certificate.configGeneration === state.configGeneration
    )
  }

  getReadyCertificateDimension(agentId: string, embedding: MemoryModelRef): number | null {
    if (!this.hasReadyCertificate(agentId, embedding)) return null
    return this.vectorStoreReady.get(agentId)?.dimensions ?? null
  }

  markReady(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    leaseEpoch?: number
  ): void {
    const currentEmbedding = this.resolveCurrentEmbedding(agentId)
    if (this.syncConfigIdentity(agentId, currentEmbedding)) {
      void this.beginConfigIdentityTransition(agentId).catch((error) => {
        logger.warn(`[Memory] vector identity transition failed for ${agentId}: ${String(error)}`)
      })
      return
    }
    if (
      currentEmbedding?.providerId !== embedding.providerId ||
      currentEmbedding.modelId !== embedding.modelId
    ) {
      return
    }
    const state = this.leaseState(agentId)
    if (leaseEpoch !== undefined && state.leaseEpoch !== leaseEpoch) return
    this.syncLogicalIdentity(agentId, embedding, dimensions)
    this.vectorStoreReady.set(agentId, {
      agentId,
      providerId: embedding.providerId,
      modelId: embedding.modelId,
      dimensions,
      storeGeneration: state.storeGeneration,
      configGeneration: state.configGeneration
    })
  }

  clearReady(agentId: string): void {
    this.vectorStoreReady.delete(agentId)
  }

  private syncLogicalIdentity(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number
  ): void {
    const state = this.leaseState(agentId)
    const identity = this.cacheKey(agentId, embedding, dimensions)
    if (state.logicalIdentity === null) {
      state.logicalIdentity = identity
      return
    }
    if (state.logicalIdentity === identity) return
    state.logicalIdentity = identity
    state.storeGeneration += 1
    this.clearReady(agentId)
  }

  stopAdmission(): void {
    this.stopped = true
    this.stopResourceSweep()
    for (const [agentId, state] of this.leaseStates) {
      state.accepting = false
      state.leaseEpoch += 1
      this.clearReady(agentId)
    }
  }

  private leaseState(agentId: string): VectorStoreLeaseState {
    let state = this.leaseStates.get(agentId)
    if (!state) {
      state = {
        leaseEpoch: 1,
        storeGeneration: 1,
        configGeneration: 1,
        configFingerprint: undefined,
        logicalIdentity: null,
        accepting: true,
        active: 0,
        openInFlight: 0,
        lastUsedAt: Date.now(),
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
        close: (options) => {
          assertActive()
          return this.closeVectorStoreLocked(agentId, options?.clearCertificate ?? true)
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

  async withVectorMutation<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.vectorMutationLocks.get(agentId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(task)
    const settled = run.then(
      () => undefined,
      () => undefined
    )
    this.vectorMutationLocks.set(agentId, settled)
    try {
      return await run
    } finally {
      if (this.vectorMutationLocks.get(agentId) === settled) {
        this.vectorMutationLocks.delete(agentId)
      }
    }
  }

  async withStoreLease<T>(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    task: (store: IMemoryVectorStore, generation: number) => Promise<T>,
    options: { allowHistoricalIdentity?: boolean } = {}
  ): Promise<T> {
    while (true) {
      const currentEmbedding = this.resolveCurrentEmbedding(agentId)
      if (this.syncConfigIdentity(agentId, currentEmbedding)) {
        this.beginConfigIdentityTransition(agentId).catch((error) => {
          logger.warn(`[Memory] vector identity transition failed for ${agentId}: ${String(error)}`)
        })
      }
      const transition = this.identityTransitions.get(agentId)
      if (transition) {
        await transition
        continue
      }
      if (
        !options.allowHistoricalIdentity &&
        (currentEmbedding?.providerId !== embedding.providerId ||
          currentEmbedding?.modelId !== embedding.modelId)
      ) {
        throw new VectorStoreLeaseUnavailableError(
          'stale-identity',
          '[Memory] vector store lease embedding identity is stale'
        )
      }
      break
    }
    const state = this.leaseState(agentId)
    if (this.stopped || !state.accepting) {
      throw new VectorStoreLeaseUnavailableError(
        this.stopped ? 'stopped' : 'admission-closed',
        '[Memory] vector store lease admission is closed'
      )
    }
    state.openInFlight += 1
    state.lastUsedAt = Date.now()
    let store: IMemoryVectorStore
    try {
      store = await this.withAgentLock(agentId, async (locked) => {
        if (this.stopped || !state.accepting) {
          throw new VectorStoreLeaseUnavailableError(
            this.stopped ? 'stopped' : 'admission-closed',
            '[Memory] vector store lease admission is closed'
          )
        }
        this.syncLogicalIdentity(agentId, embedding, dimensions)
        const desiredIdentity = this.cacheKey(agentId, embedding, dimensions)
        const openIdentity = this.vectorStoreIdentities.get(agentId)
        if (openIdentity && openIdentity !== desiredIdentity) {
          state.accepting = false
          state.leaseEpoch += 1
          const transitionEpoch = state.leaseEpoch
          try {
            await this.waitForLeaseDrain(state)
            await this.closeVectorStoreLocked(agentId, true)
          } finally {
            if (!this.stopped && state.leaseEpoch === transitionEpoch) state.accepting = true
          }
        }
        if (this.stopped || !state.accepting) {
          throw new VectorStoreLeaseUnavailableError(
            this.stopped ? 'stopped' : 'admission-closed',
            '[Memory] vector store lease admission is closed'
          )
        }
        if (state.requiresReset) {
          await this.ports.vectorStoreFactory.resetVectorStore(agentId)
          state.requiresReset = false
        }
        return locked.open(embedding, dimensions)
      })
    } finally {
      state.openInFlight -= 1
    }
    if (this.stopped || !state.accepting) {
      throw new VectorStoreLeaseUnavailableError(
        this.stopped ? 'stopped' : 'admission-closed',
        '[Memory] vector store lease admission is closed'
      )
    }
    const generation = state.leaseEpoch
    state.active += 1
    this.observeResources()
    try {
      return await task(store, generation)
    } finally {
      state.active -= 1
      state.lastUsedAt = Date.now()
      if (state.active === 0) {
        for (const resolve of state.drainWaiters) resolve()
        state.drainWaiters.clear()
      }
      if (this.vectorStores.size > VECTOR_STORE_SOFT_CAP) {
        this.requestResourceConvergence()
      }
    }
  }

  private waitForLeaseDrain(state: VectorStoreLeaseState): Promise<void> {
    if (state.active === 0) return Promise.resolve()
    return new Promise((resolve) => state.drainWaiters.add(resolve))
  }

  private async closeVectorStoreLocked(agentId: string, clearCertificate = true): Promise<void> {
    if (clearCertificate) this.clearReady(agentId)
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

  private ensureResourceSweep(): void {
    if (this.resourceSweepTimer || this.stopped) return
    const timer = setInterval(() => {
      void this.scheduleResourceConvergence()
    }, VECTOR_STORE_SWEEP_INTERVAL_MS)
    if (typeof timer.unref === 'function') timer.unref()
    this.resourceSweepTimer = timer
  }

  private stopResourceSweep(): void {
    if (this.resourceSweepTimer) clearInterval(this.resourceSweepTimer)
    if (this.resourceConvergenceTimer) clearTimeout(this.resourceConvergenceTimer)
    this.resourceSweepTimer = null
    this.resourceConvergenceTimer = null
  }

  private requestResourceConvergence(): void {
    if (this.stopped) return
    if (this.resourceConvergence) {
      this.resourceConvergenceRequested = true
      return
    }
    if (this.resourceConvergenceTimer) return
    const timer = setTimeout(() => {
      if (this.resourceConvergenceTimer === timer) this.resourceConvergenceTimer = null
      void this.scheduleResourceConvergence()
    }, 0)
    if (typeof timer.unref === 'function') timer.unref()
    this.resourceConvergenceTimer = timer
  }

  private scheduleResourceConvergence(now = Date.now()): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.resourceConvergence) return this.resourceConvergence
    const tracked = this.convergeResourceCache(now).finally(() => {
      if (this.resourceConvergence !== tracked) return
      const rerun = this.resourceConvergenceRequested
      this.resourceConvergenceRequested = false
      this.resourceConvergence = null
      if (rerun) this.requestResourceConvergence()
    })
    this.resourceConvergence = tracked
    return tracked
  }

  private async convergeResourceCache(now: number): Promise<void> {
    const candidates = [...this.vectorStores.keys()]
      .map((agentId) => {
        const state = this.leaseState(agentId)
        return { agentId, lastUsedAt: state.lastUsedAt }
      })
      .sort(
        (left, right) =>
          left.lastUsedAt - right.lastUsedAt || left.agentId.localeCompare(right.agentId)
      )

    for (const candidate of candidates) {
      if (this.stopped) return
      const expired = now - candidate.lastUsedAt >= VECTOR_STORE_IDLE_TTL_MS
      if (!expired && this.vectorStores.size <= VECTOR_STORE_SOFT_CAP) break
      await this.evictResourceCandidate(candidate.agentId, candidate.lastUsedAt, now)
    }
  }

  private async evictResourceCandidate(
    agentId: string,
    expectedLastUsedAt: number,
    now: number
  ): Promise<boolean> {
    const state = this.leaseStates.get(agentId)
    if (
      !state ||
      state.active > 0 ||
      state.openInFlight > 0 ||
      state.lastUsedAt !== expectedLastUsedAt ||
      !this.vectorStores.has(agentId)
    ) {
      return false
    }
    const expired = now - state.lastUsedAt >= VECTOR_STORE_IDLE_TTL_MS
    if (!expired && this.vectorStores.size <= VECTOR_STORE_SOFT_CAP) return false

    return this.withAgentLock(agentId, async (locked) => {
      if (
        state.active > 0 ||
        state.openInFlight > 0 ||
        state.lastUsedAt !== expectedLastUsedAt ||
        !this.vectorStores.has(agentId)
      ) {
        return false
      }
      const stillExpired = now - state.lastUsedAt >= VECTOR_STORE_IDLE_TTL_MS
      if (!stillExpired && this.vectorStores.size <= VECTOR_STORE_SOFT_CAP) return false
      state.leaseEpoch += 1
      await locked.close({ clearCertificate: false })
      return true
    })
  }

  query(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    vector: number[],
    topK: number
  ): Promise<MemoryVectorMatch[]> {
    return this.withStoreLease(agentId, embedding, dimensions, async (store) => {
      if (!store.isUsable()) {
        this.clearReady(agentId)
        return []
      }
      return store.query(vector, { topK })
    })
  }

  queryBatch(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    vectors: readonly number[][],
    topK: number
  ): Promise<MemoryVectorMatch[][]> {
    if (!vectors.length) return Promise.resolve([])
    return this.withStoreLease(agentId, embedding, dimensions, async (store) => {
      if (!store.isUsable()) {
        this.clearReady(agentId)
        return vectors.map(() => [])
      }
      const results: MemoryVectorMatch[][] = []
      for (const vector of vectors) {
        results.push(await store.query(vector, { topK }))
      }
      return results
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
    if (cached) {
      throw new Error('[Memory] vector store identity transition must drain existing leases first')
    }
    const pending = this.ports.vectorStoreFactory
      .createVectorStore(agentId, embedding, dimensions)
      .catch((error) => {
        this.vectorStores.delete(agentId)
        this.vectorStoreIdentities.delete(agentId)
        this.clearReady(agentId)
        throw error
      })
    this.vectorStores.set(agentId, pending)
    this.vectorStoreIdentities.set(agentId, identity)
    this.ports.perfObserver?.observe('cacheEntries', this.vectorStores.size)
    void pending.then(
      () => this.observeResources(),
      () => undefined
    )
    this.ensureResourceSweep()
    return pending
  }

  async resetAgentStore(agentId: string): Promise<void> {
    await this.withVectorMutation(agentId, () => this.drainAndClose(agentId, true))
  }

  async retireAgentStore(agentId: string): Promise<void> {
    await this.withVectorMutation(agentId, () => this.drainAndClose(agentId, true, true))
  }

  async closeAgentStore(agentId: string): Promise<void> {
    await this.drainAndClose(agentId, false)
  }

  private async drainAndClose(agentId: string, reset: boolean, permanent = false): Promise<void> {
    const state = this.leaseState(agentId)
    state.accepting = false
    state.leaseEpoch += 1
    const closeEpoch = state.leaseEpoch
    if (reset || permanent) {
      state.storeGeneration += 1
      state.logicalIdentity = null
      this.clearReady(agentId)
    }
    try {
      await this.waitForLeaseDrain(state)
      await this.withAgentLock(agentId, async (locked) => {
        await locked.close({ clearCertificate: reset || permanent })
        if (reset) {
          try {
            await this.ports.vectorStoreFactory.resetVectorStore(agentId)
            state.requiresReset = false
          } catch (error) {
            state.requiresReset = true
            throw error
          }
        }
      })
    } finally {
      if (!permanent && !this.stopped && state.leaseEpoch === closeEpoch) state.accepting = true
    }
  }

  isGenerationCurrent(agentId: string, generation: number): boolean {
    return this.leaseState(agentId).leaseEpoch === generation
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
      const embedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
      if (!embedding?.providerId || !embedding?.modelId) return 'skipped'
      resolvedEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
    }
    if (targetDimensions === null) {
      const fingerprint = embeddingFingerprint(
        resolvedEmbedding.providerId,
        resolvedEmbedding.modelId
      )
      targetDimensions =
        this.getReadyCertificateDimension(agentId, resolvedEmbedding) ??
        this.ports.repository.getCurrentEmbeddingDimension(agentId, fingerprint)
      if (targetDimensions === null) return 'skipped'
    }
    try {
      await this.withVectorMutation(agentId, () =>
        this.withStoreLease(
          agentId,
          resolvedEmbedding,
          targetDimensions,
          async (store) => {
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
          },
          { allowHistoricalIdentity: true }
        )
      )
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
    return this.withVectorMutation(agentId, () =>
      this.withStoreLease(agentId, embedding, dimensions, async (store) => {
        if (this.ctx.isDisposed) return []
        if (!store.isUsable()) {
          this.clearReady(agentId)
          return []
        }
        const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
        const prunableIds = this.ports.repository.filterPrunableVectorRefs(
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
    )
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
    return [
      ...this.vectorStoreLocks.values(),
      ...this.vectorMutationLocks.values(),
      ...this.identityTransitions.values(),
      ...(this.resourceConvergence ? [this.resourceConvergence] : [])
    ]
  }

  async closeAllStores(): Promise<void> {
    this.stopAdmission()
    await Promise.allSettled(this.identityTransitions.values())
    if (this.resourceConvergence) await Promise.allSettled([this.resourceConvergence])
    const agentIds = new Set([...this.vectorStoreLocks.keys(), ...this.vectorStores.keys()])
    await Promise.allSettled(
      [...agentIds].map((agentId) => this.drainAndClose(agentId, false, true))
    )
    await Promise.allSettled(this.vectorStoreLocks.values())
    await Promise.allSettled(this.vectorMutationLocks.values())
    for (const pending of this.vectorStores.values()) {
      const store = await pending.catch(() => null)
      if (store) await store.close().catch(() => undefined)
    }
    this.vectorStores.clear()
    this.vectorStoreIdentities.clear()
    this.vectorStoreReady.clear()
    this.vectorStoreLocks.clear()
    this.vectorMutationLocks.clear()
    this.identityTransitions.clear()
    this.leaseStates.clear()
    this.resourceConvergence = null
    this.resourceConvergenceRequested = false
  }

  async settleAgent(agentId: string): Promise<void> {
    const identityTransition = this.identityTransitions.get(agentId)
    if (identityTransition) await Promise.allSettled([identityTransition])
    if (this.identityTransitions.get(agentId) === identityTransition) {
      this.identityTransitions.delete(agentId)
    }
    const vectorStoreLock = this.vectorStoreLocks.get(agentId)
    if (vectorStoreLock) await Promise.allSettled([vectorStoreLock])
    if (this.vectorStoreLocks.get(agentId) === vectorStoreLock) {
      this.vectorStoreLocks.delete(agentId)
    }
    const vectorMutationLock = this.vectorMutationLocks.get(agentId)
    if (vectorMutationLock) await Promise.allSettled([vectorMutationLock])
    if (this.vectorMutationLocks.get(agentId) === vectorMutationLock) {
      this.vectorMutationLocks.delete(agentId)
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

  /** @internal Deterministic resource convergence seam for scale tests. */
  runResourceConvergenceForTests(now = Date.now()): Promise<void> {
    return this.scheduleResourceConvergence(now)
  }

  /** @internal Resource state snapshot for scale tests. */
  getResourceStatsForTests(): {
    openStores: number
    agents: Array<{
      agentId: string
      active: number
      openInFlight: number
      lastUsedAt: number
    }>
  } {
    return {
      openStores: this.vectorStores.size,
      agents: [...this.leaseStates.entries()].map(([agentId, state]) => ({
        agentId,
        active: state.active,
        openInFlight: state.openInFlight,
        lastUsedAt: state.lastUsedAt
      }))
    }
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
