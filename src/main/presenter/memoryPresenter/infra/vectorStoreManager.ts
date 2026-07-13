import logger from '@shared/logger'

import {
  VectorStoreLeaseUnavailableError,
  VectorStoreOperationTimeoutError,
  VectorStoreQueryTimeoutError,
  VectorStoreQuarantineMarkerError,
  type VectorStoreCleanupDisposition
} from '../domain/types'
import type { IMemoryVectorStore, MemoryVectorMatch } from '../types'
import { embeddingFingerprint, type MemoryModelRef, type MemoryRuntimeContext } from '../context'
import type {
  MemoryAgentPolicyPort,
  MemoryEmbeddingRepositoryPort,
  MemoryPerfObserver,
  MemoryVectorStoreFactoryPort,
  VectorStoreRecallHealth,
  VectorStoreRetrievalPort
} from '../ports'
import {
  RECALL_VECTOR_QUERY_GRACE_MS,
  RECALL_VECTOR_QUERY_TIMEOUT_MS,
  VECTOR_STORE_OPERATION_TIMEOUT_MS,
  VECTOR_STORE_IDLE_TTL_MS,
  VECTOR_STORE_SOFT_CAP,
  VECTOR_STORE_SWEEP_INTERVAL_MS
} from '../runtimeConstants'
import { isDuckDbFatalError, MemoryVectorStoreQuarantineRequiredError } from './vectorStoreErrors'

export interface LockedVectorStorePort {
  open(embedding: MemoryModelRef, dimensions: number): Promise<IMemoryVectorStore>
  close(options?: { clearCertificate?: boolean }): Promise<void>
}

interface VectorStoreSuspectObservation {
  resumeAllowed: boolean
  leaseEpoch: number
  storeGeneration: number
  configGeneration: number
  configFingerprint: string | null | undefined
  logicalIdentity: string | null
  graceTimer: ReturnType<typeof setTimeout> | null
  completion: Promise<void>
  resolveCompletion: () => void
  completed: boolean
}

interface VectorStoreLeaseState {
  leaseEpoch: number
  storeGeneration: number
  configGeneration: number
  configFingerprint: string | null | undefined
  logicalIdentity: string | null
  accepting: boolean
  health: 'healthy' | 'suspect' | 'quarantined'
  active: number
  activeOperations: Set<Promise<unknown>>
  openInFlight: number
  lastUsedAt: number
  requiresReset: boolean
  drainWaiters: Set<() => void>
  suspectObservation: VectorStoreSuspectObservation | null
}

export interface VectorReadyCertificate {
  agentId: string
  providerId: string
  modelId: string
  dimensions: number
  storeGeneration: number
  configGeneration: number
}

interface VectorStoreLeaseOptions {
  allowHistoricalIdentity?: boolean
  operation?: string
  timeoutMs?: number
  createTimeoutError?: (timeoutMs: number) => Error
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
  private readonly activeAgentLocks = new Map<string, number>()
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
      diagnostics?: {
        recordVectorOutcome(
          outcome: 'eviction' | 'warmupSucceeded' | 'warmupDeferred' | 'warmupFailed'
        ): void
      }
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
    if (state.health !== 'healthy') return Promise.resolve()
    state.accepting = false
    state.leaseEpoch += 1
    const transitionEpoch = state.leaseEpoch
    const previous = this.identityTransitions.get(agentId) ?? Promise.resolve()
    const tracked = previous
      .catch(() => undefined)
      .then(async () => {
        await this.waitForLeaseDrain(state)
        if (state.health !== 'healthy' || state.leaseEpoch !== transitionEpoch) return
        await this.withAgentLock(agentId, async (locked) => {
          if (state.health !== 'healthy' || state.leaseEpoch !== transitionEpoch) return
          await locked.close({ clearCertificate: true })
        })
      })
      .finally(() => {
        if (this.identityTransitions.get(agentId) !== tracked) return
        this.identityTransitions.delete(agentId)
        if (!this.stopped && state.health === 'healthy' && state.leaseEpoch === transitionEpoch) {
          state.accepting = true
        }
      })
    this.identityTransitions.set(agentId, tracked)
    return tracked
  }

  hasReadyCertificate(agentId: string, embedding: MemoryModelRef): boolean {
    const existingState = this.leaseStates.get(agentId)
    if (existingState && existingState.health !== 'healthy') return false
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
    const existingState = this.leaseStates.get(agentId)
    if (existingState && existingState.health !== 'healthy') return
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
      const hasUnsafeWork =
        state.health !== 'healthy' ||
        state.activeOperations.size > 0 ||
        state.openInFlight > 0 ||
        this.identityTransitions.has(agentId) ||
        this.vectorMutationLocks.has(agentId) ||
        (this.activeAgentLocks.get(agentId) ?? 0) > 0
      if (hasUnsafeWork && state.health !== 'quarantined') {
        this.finishSuspectObservation(state)
        state.health = 'suspect'
        logger.info(
          `[Memory] detaching in-flight vector work during shutdown for ${agentId}; no quarantine marker was written`
        )
      }
      state.accepting = false
      state.leaseEpoch += 1
      this.clearReady(agentId)
      for (const resolve of state.drainWaiters) resolve()
      state.drainWaiters.clear()
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
        health: 'healthy',
        active: 0,
        activeOperations: new Set(),
        openInFlight: 0,
        lastUsedAt: Date.now(),
        requiresReset: false,
        drainWaiters: new Set(),
        suspectObservation: null
      }
      this.leaseStates.set(agentId, state)
    }
    return state
  }

  private assertLeaseAdmission(state: VectorStoreLeaseState): void {
    if (!this.stopped && state.health === 'healthy' && state.accepting) return
    const reason = this.stopped
      ? 'stopped'
      : state.health === 'quarantined'
        ? 'quarantined'
        : 'admission-closed'
    throw new VectorStoreLeaseUnavailableError(
      reason,
      reason === 'quarantined'
        ? '[Memory] vector store is quarantined for the remainder of this process'
        : '[Memory] vector store lease admission is closed'
    )
  }

  private assertAgentHealthy(agentId: string): VectorStoreLeaseState {
    const state = this.leaseState(agentId)
    if (this.stopped || state.health !== 'healthy') {
      const reason = this.stopped
        ? 'stopped'
        : state.health === 'quarantined'
          ? 'quarantined'
          : 'admission-closed'
      throw new VectorStoreLeaseUnavailableError(
        reason,
        reason === 'quarantined'
          ? '[Memory] vector store is quarantined for the remainder of this process'
          : '[Memory] vector store is under timeout observation or stopped'
      )
    }
    return state
  }

  private withAgentLock<T>(
    agentId: string,
    task: (locked: LockedVectorStorePort) => Promise<T>
  ): Promise<T> {
    const prev = this.vectorStoreLocks.get(agentId) ?? Promise.resolve()
    const run = prev.then(async () => {
      this.activeAgentLocks.set(agentId, (this.activeAgentLocks.get(agentId) ?? 0) + 1)
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
        const remaining = (this.activeAgentLocks.get(agentId) ?? 1) - 1
        if (remaining > 0) this.activeAgentLocks.set(agentId, remaining)
        else this.activeAgentLocks.delete(agentId)
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
    this.assertAgentHealthy(agentId)
    const previous = this.vectorMutationLocks.get(agentId) ?? Promise.resolve()
    const run = previous
      .catch(() => undefined)
      .then(() => {
        this.assertAgentHealthy(agentId)
        return task()
      })
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
    options: VectorStoreLeaseOptions = {}
  ): Promise<T> {
    const state = this.assertAgentHealthy(agentId)
    const operation = options.operation ?? 'operation'
    const timeoutMs = options.timeoutMs ?? VECTOR_STORE_OPERATION_TIMEOUT_MS
    return this.runLeaseOperationWithDeadline(agentId, state, operation, timeoutMs, options, () =>
      this.executeStoreLease(agentId, state, embedding, dimensions, task, options)
    )
  }

  private async executeStoreLease<T>(
    agentId: string,
    state: VectorStoreLeaseState,
    embedding: MemoryModelRef,
    dimensions: number,
    task: (store: IMemoryVectorStore, generation: number) => Promise<T>,
    options: VectorStoreLeaseOptions
  ): Promise<T> {
    let leaseActive = false
    try {
      while (true) {
        const currentEmbedding = this.resolveCurrentEmbedding(agentId)
        if (this.syncConfigIdentity(agentId, currentEmbedding)) {
          this.beginConfigIdentityTransition(agentId).catch((error) => {
            logger.warn(
              `[Memory] vector identity transition failed for ${agentId}: ${String(error)}`
            )
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
      this.assertLeaseAdmission(state)
      state.openInFlight += 1
      state.lastUsedAt = Date.now()
      let store: IMemoryVectorStore
      try {
        store = await this.withAgentLock(agentId, async (locked) => {
          this.assertLeaseAdmission(state)
          this.syncLogicalIdentity(agentId, embedding, dimensions)
          const desiredIdentity = this.cacheKey(agentId, embedding, dimensions)
          const openIdentity = this.vectorStoreIdentities.get(agentId)
          if (openIdentity && openIdentity !== desiredIdentity) {
            state.accepting = false
            state.leaseEpoch += 1
            const transitionEpoch = state.leaseEpoch
            try {
              await this.waitForLeaseDrain(state)
              if (state.health !== 'healthy' || state.leaseEpoch !== transitionEpoch) {
                this.assertLeaseAdmission(state)
              }
              await this.closeVectorStoreLocked(agentId, true)
            } finally {
              if (
                !this.stopped &&
                state.health === 'healthy' &&
                state.leaseEpoch === transitionEpoch
              ) {
                state.accepting = true
              }
            }
          }
          this.assertLeaseAdmission(state)
          if (state.requiresReset) {
            await this.ports.vectorStoreFactory.resetVectorStore(agentId)
            state.requiresReset = false
          }
          return locked.open(embedding, dimensions)
        })
      } finally {
        state.openInFlight -= 1
      }
      this.assertLeaseAdmission(state)
      const generation = state.leaseEpoch
      state.active += 1
      leaseActive = true
      this.observeResources()
      const result = await task(store, generation)
      if (this.leaseStates.get(agentId) !== state || this.stopped || state.health !== 'healthy') {
        this.assertLeaseAdmission(state)
        throw new VectorStoreLeaseUnavailableError(
          'admission-closed',
          '[Memory] vector store lease generation changed before completion'
        )
      }
      return result
    } catch (error) {
      if (isDuckDbFatalError(error)) {
        if (this.quarantineAgent(agentId, error, state)) {
          throw new VectorStoreLeaseUnavailableError(
            'quarantined',
            '[Memory] vector store hit a fatal native error and was quarantined'
          )
        }
        logger.info(
          `[Memory] late fatal vector operation settled after manager teardown for ${agentId}; result ignored`
        )
      }
      throw error
    } finally {
      if (leaseActive) state.active -= 1
      state.lastUsedAt = Date.now()
      if (state.active === 0) {
        for (const resolve of state.drainWaiters) resolve()
        state.drainWaiters.clear()
      }
      if (this.vectorStores.size > VECTOR_STORE_SOFT_CAP) {
        this.requestResourceConvergence()
      }
      this.observeResources()
    }
  }

  private runLeaseOperationWithDeadline<T>(
    agentId: string,
    state: VectorStoreLeaseState,
    operation: string,
    timeoutMs: number,
    options: VectorStoreLeaseOptions,
    task: () => Promise<T>
  ): Promise<T> {
    const nativeOperation = Promise.resolve().then(task)
    state.activeOperations.add(nativeOperation)
    void nativeOperation
      .finally(() => state.activeOperations.delete(nativeOperation))
      .catch(() => undefined)
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<T>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        const error =
          options.createTimeoutError?.(timeoutMs) ??
          new VectorStoreOperationTimeoutError(agentId, operation, timeoutMs)
        if (this.leaseStates.get(agentId) === state) {
          this.markOperationSuspect(agentId, state, error)
        }
        reject(error)
      }, timeoutMs)
      if (typeof timeoutId.unref === 'function') timeoutId.unref()
    })
    return Promise.race([nativeOperation, timeout]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId)
    })
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
    this.observeResources()
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
      state.health !== 'healthy' ||
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
        state.health !== 'healthy' ||
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
      this.ports.diagnostics?.recordVectorOutcome('eviction')
      return true
    })
  }

  private runRecallQueryWithDeadline<T>(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    task: (store: IMemoryVectorStore, generation: number) => Promise<T>
  ): Promise<T> {
    return this.withStoreLease(agentId, embedding, dimensions, task, {
      operation: 'query',
      timeoutMs: RECALL_VECTOR_QUERY_TIMEOUT_MS,
      createTimeoutError: (timeoutMs) => new VectorStoreQueryTimeoutError(agentId, timeoutMs)
    })
  }

  private markOperationSuspect(agentId: string, state: VectorStoreLeaseState, error: Error): void {
    if (this.stopped || this.leaseStates.get(agentId) !== state || state.health !== 'healthy')
      return
    const operations = [...state.activeOperations]
    if (!operations.length) return
    const resumeAllowed = state.accepting
    state.health = 'suspect'
    state.accepting = false
    state.leaseEpoch += 1
    this.clearReady(agentId)
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })
    const observation: VectorStoreSuspectObservation = {
      resumeAllowed,
      leaseEpoch: state.leaseEpoch,
      storeGeneration: state.storeGeneration,
      configGeneration: state.configGeneration,
      configFingerprint: state.configFingerprint,
      logicalIdentity: state.logicalIdentity,
      graceTimer: null,
      completion,
      resolveCompletion,
      completed: false
    }
    const graceTimer = setTimeout(() => {
      if (
        this.stopped ||
        this.leaseStates.get(agentId) !== state ||
        state.suspectObservation !== observation ||
        state.health !== 'suspect'
      )
        return
      this.quarantineAgent(
        agentId,
        new Error(
          `[Memory] vector store operation did not settle during ${RECALL_VECTOR_QUERY_GRACE_MS}ms grace period`,
          { cause: error }
        ),
        state
      )
      logger.error(
        `[Memory] vector operation grace expired for ${agentId}; vector access is disabled until restart`
      )
    }, RECALL_VECTOR_QUERY_GRACE_MS)
    if (typeof graceTimer.unref === 'function') graceTimer.unref()
    observation.graceTimer = graceTimer
    state.suspectObservation = observation
    logger.warn(
      `[Memory] vector ${error instanceof VectorStoreOperationTimeoutError ? error.operation : 'query'} timed out for ${agentId}; pausing vector admission during grace observation`
    )
    void Promise.allSettled(operations)
      .then((results) => this.finishOperationGraceObservation(agentId, state, observation, results))
      .catch((observationError) => {
        logger.error(
          `[Memory] vector operation grace observation failed for ${agentId}: ${String(observationError)}`
        )
      })
  }

  private finishSuspectObservation(
    state: VectorStoreLeaseState,
    observation: VectorStoreSuspectObservation | null = state.suspectObservation
  ): void {
    if (!observation || observation.completed) return
    observation.completed = true
    if (observation.graceTimer) clearTimeout(observation.graceTimer)
    observation.graceTimer = null
    if (state.suspectObservation === observation) state.suspectObservation = null
    observation.resolveCompletion()
  }

  private async finishOperationGraceObservation(
    agentId: string,
    expectedState: VectorStoreLeaseState,
    observation: VectorStoreSuspectObservation,
    results: PromiseSettledResult<unknown>[]
  ): Promise<void> {
    const state = this.leaseStates.get(agentId)
    if (
      state !== expectedState ||
      state.health !== 'suspect' ||
      state.suspectObservation !== observation
    ) {
      logger.info(
        `[Memory] late vector operation settled for ${agentId}; terminal or detached state was preserved`
      )
      return
    }
    const fatal = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' && isDuckDbFatalError(result.reason)
    )
    if (fatal) {
      this.quarantineAgent(agentId, fatal.reason, state)
      return
    }
    this.finishSuspectObservation(state, observation)
    state.health = 'healthy'
    const snapshotUnchanged =
      state.leaseEpoch === observation.leaseEpoch &&
      state.storeGeneration === observation.storeGeneration &&
      state.configGeneration === observation.configGeneration &&
      state.configFingerprint === observation.configFingerprint &&
      state.logicalIdentity === observation.logicalIdentity
    if (this.stopped) {
      state.accepting = false
      return
    }
    if (observation.resumeAllowed && snapshotUnchanged) {
      state.accepting = true
      logger.info(
        `[Memory] vector operation grace settled for ${agentId}; vector admission resumed`
      )
      return
    }
    state.accepting = false
    if (!observation.resumeAllowed) {
      logger.info(
        `[Memory] vector operation grace settled for ${agentId}; existing cleanup ownership retained`
      )
      return
    }
    logger.info(
      `[Memory] vector operation grace settled across an identity change for ${agentId}; converging the current store`
    )
    void this.beginConfigIdentityTransition(agentId).catch((transitionError) => {
      logger.warn(
        `[Memory] vector identity transition after timeout failed for ${agentId}: ${String(transitionError)}`
      )
    })
  }

  query(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    vector: number[],
    topK: number
  ): Promise<MemoryVectorMatch[]> {
    return this.runRecallQueryWithDeadline(agentId, embedding, dimensions, async (store) => {
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
    return this.runRecallQueryWithDeadline(
      agentId,
      embedding,
      dimensions,
      async (store, generation) => {
        if (!store.isUsable()) {
          this.clearReady(agentId)
          return vectors.map(() => [])
        }
        const results: MemoryVectorMatch[][] = []
        for (const vector of vectors) {
          results.push(await store.query(vector, { topK }))
          if (!this.isGenerationCurrent(agentId, generation)) {
            throw new VectorStoreLeaseUnavailableError(
              'admission-closed',
              '[Memory] vector batch query stopped after its lease generation changed'
            )
          }
        }
        return results
      }
    )
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
        if (error instanceof MemoryVectorStoreQuarantineRequiredError) {
          this.quarantineAgent(agentId, error, this.leaseStates.get(agentId))
          throw new VectorStoreLeaseUnavailableError(
            'quarantined',
            '[Memory] vector store recovery is pending restart'
          )
        }
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

  private quarantineAgent(
    agentId: string,
    error: unknown,
    expectedState?: VectorStoreLeaseState
  ): boolean {
    const state = this.leaseStates.get(agentId)
    if (!state || (expectedState && state !== expectedState) || this.stopped) return false
    const firstQuarantine = state.health !== 'quarantined'
    this.finishSuspectObservation(state)
    state.health = 'quarantined'
    state.accepting = false
    state.leaseEpoch += 1
    state.storeGeneration += 1
    state.logicalIdentity = null
    state.requiresReset = false
    this.vectorStores.delete(agentId)
    this.vectorStoreIdentities.delete(agentId)
    this.identityTransitions.delete(agentId)
    this.vectorStoreLocks.delete(agentId)
    this.vectorMutationLocks.delete(agentId)
    this.activeAgentLocks.delete(agentId)
    this.clearReady(agentId)
    for (const resolve of state.drainWaiters) resolve()
    state.drainWaiters.clear()
    if (!firstQuarantine) return true
    try {
      this.ports.vectorStoreFactory.markVectorStoreQuarantined(agentId)
    } catch (markerError) {
      logger.error(
        `[Memory] failed to persist vector quarantine marker for ${agentId}: ${String(markerError)}; terminal vector failure: ${String(error)}`
      )
    }
    return true
  }

  private persistQuarantineMarker(agentId: string): void {
    try {
      this.ports.vectorStoreFactory.markVectorStoreQuarantined(agentId)
    } catch (error) {
      throw new VectorStoreQuarantineMarkerError(agentId, error)
    }
  }

  private deferQuarantinedCleanup(agentId: string): VectorStoreCleanupDisposition | null {
    if (this.leaseStates.get(agentId)?.health !== 'quarantined') return null
    this.persistQuarantineMarker(agentId)
    return 'pending-restart'
  }

  private async waitForSuspectResolution(
    agentId: string,
    state: VectorStoreLeaseState
  ): Promise<void> {
    while (
      !this.stopped &&
      this.leaseStates.get(agentId) === state &&
      state.health === 'suspect' &&
      state.suspectObservation
    ) {
      await state.suspectObservation.completion
    }
  }

  async resetAgentStore(agentId: string): Promise<VectorStoreCleanupDisposition> {
    const state = this.leaseStates.get(agentId)
    if (state) await this.waitForSuspectResolution(agentId, state)
    const deferred = this.deferQuarantinedCleanup(agentId)
    if (deferred) return deferred
    try {
      return await this.withVectorMutation(agentId, () => this.drainAndClose(agentId, true))
    } catch (error) {
      if (state) await this.waitForSuspectResolution(agentId, state)
      const deferredAfterFailure = this.deferQuarantinedCleanup(agentId)
      if (deferredAfterFailure) return deferredAfterFailure
      throw error
    }
  }

  async retireAgentStore(agentId: string): Promise<VectorStoreCleanupDisposition> {
    const state = this.leaseStates.get(agentId)
    if (state) await this.waitForSuspectResolution(agentId, state)
    const deferred = this.deferQuarantinedCleanup(agentId)
    if (deferred) return deferred
    try {
      return await this.withVectorMutation(agentId, () => this.drainAndClose(agentId, true, true))
    } catch (error) {
      if (state) await this.waitForSuspectResolution(agentId, state)
      const deferredAfterFailure = this.deferQuarantinedCleanup(agentId)
      if (deferredAfterFailure) return deferredAfterFailure
      throw error
    }
  }

  async closeAgentStore(agentId: string): Promise<void> {
    const state = this.leaseStates.get(agentId)
    if (state) await this.waitForSuspectResolution(agentId, state)
    await this.drainAndClose(agentId, false)
  }

  private async drainAndClose(
    agentId: string,
    reset: boolean,
    permanent = false
  ): Promise<VectorStoreCleanupDisposition> {
    const state = this.leaseState(agentId)
    const initiallyDeferred = this.deferQuarantinedCleanup(agentId)
    if (initiallyDeferred) return initiallyDeferred
    state.accepting = false
    state.leaseEpoch += 1
    let closeEpoch = state.leaseEpoch
    if (reset || permanent) {
      state.storeGeneration += 1
      state.logicalIdentity = null
      this.clearReady(agentId)
    }
    try {
      await this.waitForLeaseDrain(state)
      await this.waitForSuspectResolution(agentId, state)
      const deferredAfterDrain = this.deferQuarantinedCleanup(agentId)
      if (deferredAfterDrain) return deferredAfterDrain
      if (this.stopped || state.health !== 'healthy') {
        throw new VectorStoreLeaseUnavailableError(
          this.stopped ? 'stopped' : 'admission-closed',
          '[Memory] vector cleanup stopped before native close'
        )
      }
      closeEpoch = state.leaseEpoch
      await this.withAgentLock(agentId, async (locked) => {
        if (state.health === 'quarantined') return
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
      await this.waitForSuspectResolution(agentId, state)
      const deferredAfterLock = this.deferQuarantinedCleanup(agentId)
      if (deferredAfterLock) return deferredAfterLock
    } finally {
      if (
        !permanent &&
        !this.stopped &&
        state.health === 'healthy' &&
        state.leaseEpoch === closeEpoch
      ) {
        state.accepting = true
      }
    }
    return 'completed'
  }

  isGenerationCurrent(agentId: string, generation: number): boolean {
    const state = this.leaseStates.get(agentId)
    return state?.health === 'healthy' && state.leaseEpoch === generation
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
              if (isDuckDbFatalError(error)) throw error
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
          if (isDuckDbFatalError(error)) throw error
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
    return this.withStoreLease(
      agentId,
      embedding,
      dimensions,
      async (store) => {
        if (this.ctx.isDisposed) return []
        if (!store.isUsable()) {
          this.clearReady(agentId)
          return []
        }
        return store.queryByMemoryId(memoryId, { topK })
      },
      {
        operation: 'neighbor-query',
        timeoutMs: RECALL_VECTOR_QUERY_TIMEOUT_MS,
        createTimeoutError: (timeoutMs) => new VectorStoreQueryTimeoutError(agentId, timeoutMs)
      }
    )
  }

  getLockInFlight(): Promise<unknown>[] {
    return [
      ...this.vectorStoreLocks.values(),
      ...this.vectorMutationLocks.values(),
      ...this.identityTransitions.values()
    ]
  }

  async closeAllStores(): Promise<void> {
    this.stopAdmission()
    const skippedAgentIds = new Set(
      [...this.leaseStates.entries()]
        .filter(([, state]) => state.health !== 'healthy')
        .map(([agentId]) => agentId)
    )
    await Promise.allSettled(
      [...this.identityTransitions.entries()]
        .filter(([agentId]) => !skippedAgentIds.has(agentId))
        .map(([, transition]) => transition)
    )
    const agentIds = new Set(
      [...this.vectorStoreLocks.keys(), ...this.vectorStores.keys()].filter(
        (agentId) => !skippedAgentIds.has(agentId)
      )
    )
    await Promise.allSettled(
      [...agentIds].map((agentId) => this.drainAndClose(agentId, false, true))
    )
    await Promise.allSettled(
      [...this.vectorStoreLocks.entries()]
        .filter(([agentId]) => !skippedAgentIds.has(agentId))
        .map(([, lock]) => lock)
    )
    await Promise.allSettled(
      [...this.vectorMutationLocks.entries()]
        .filter(([agentId]) => !skippedAgentIds.has(agentId))
        .map(([, lock]) => lock)
    )
    for (const [agentId, pending] of this.vectorStores) {
      if (skippedAgentIds.has(agentId)) continue
      const store = await pending.catch(() => null)
      if (store) await store.close().catch(() => undefined)
    }
    this.vectorStores.clear()
    this.vectorStoreIdentities.clear()
    this.vectorStoreReady.clear()
    this.vectorStoreLocks.clear()
    this.vectorMutationLocks.clear()
    this.activeAgentLocks.clear()
    this.identityTransitions.clear()
    this.leaseStates.clear()
    this.resourceConvergence = null
    this.resourceConvergenceRequested = false
    this.observeResources()
  }

  async settleAgent(agentId: string): Promise<void> {
    if (this.leaseStates.get(agentId)?.health === 'suspect') {
      this.vectorStoreReady.delete(agentId)
      this.observeResources()
      return
    }
    if (this.leaseStates.get(agentId)?.health === 'quarantined') {
      this.identityTransitions.delete(agentId)
      this.vectorStoreLocks.delete(agentId)
      this.vectorMutationLocks.delete(agentId)
      this.vectorStoreReady.delete(agentId)
      this.observeResources()
      return
    }
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
    this.observeResources()
  }

  clearAgentReady(agentId: string): void {
    this.vectorStoreReady.delete(agentId)
  }

  currentEmbeddingFingerprint(embedding: MemoryModelRef): string {
    return embeddingFingerprint(embedding.providerId, embedding.modelId)
  }

  isQuarantined(agentId: string): boolean {
    return this.leaseStates.get(agentId)?.health === 'quarantined'
  }

  getRecallHealth(agentId: string): VectorStoreRecallHealth {
    if (this.stopped) return 'stopped'
    const health = this.leaseStates.get(agentId)?.health
    return health === 'suspect' || health === 'quarantined' ? health : 'available'
  }
}
