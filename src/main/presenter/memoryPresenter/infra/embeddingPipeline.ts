import logger from '@shared/logger'

import {
  ERROR_RETRY_BATCH_LIMIT,
  ERROR_RETRY_COOLDOWN_MS,
  EMBEDDING_PREWARM_TEXT,
  EMBEDDING_WARM_FAILURE_COOLDOWN_MS,
  ORPHAN_RECONCILE_BATCH,
  REINDEX_BATCH_SIZE,
  REINDEX_MAX_BATCHES,
  WARM_DIMENSION_FAILURE_COOLDOWN_MS
} from '../runtimeConstants'
import type { EmbeddedMemoryUpdate, FailedEmbeddingUpdate, MemoryVectorRecord } from '../types'
import {
  VectorStoreLeaseUnavailableError,
  VectorStoreOperationTimeoutError,
  type VectorStoreCleanupDisposition
} from '../domain/types'
import {
  embeddingFingerprint,
  type MemoryModelRef,
  type MemoryOperationFence,
  type MemoryRuntimeContext
} from '../context'
import type {
  IMemoryVectorStore,
  MemoryAgentPolicyPort,
  MemoryEmbeddingGatewayPort,
  MemoryEmbeddingRepositoryPort,
  MemoryPendingEmbeddableRowPort,
  MemoryReadRepositoryPort,
  VectorStoreRecallHealth
} from '../ports'

export interface EmbeddingPipelinePorts {
  ctx: MemoryRuntimeContext
  repository: MemoryReadRepositoryPort & MemoryEmbeddingRepositoryPort
  policy: MemoryAgentPolicyPort
  embeddingGateway: MemoryEmbeddingGatewayPort
  rows: MemoryPendingEmbeddableRowPort
  vectorStore: {
    getRecallHealth(agentId: string): VectorStoreRecallHealth
    warmupKey(agentId: string, embedding: MemoryModelRef): string
    hasReadyCertificate(agentId: string, embedding: MemoryModelRef): boolean
    getReadyCertificateDimension(agentId: string, embedding: MemoryModelRef): number | null
    markReady(
      agentId: string,
      embedding: MemoryModelRef,
      dimensions: number,
      leaseEpoch?: number
    ): void
    clearReady(agentId: string): void
    resetAgentStore(agentId: string): Promise<VectorStoreCleanupDisposition>
    isGenerationCurrent(agentId: string, generation: number): boolean
    withVectorMutation<T>(agentId: string, task: () => Promise<T>): Promise<T>
    withStoreLease<T>(
      agentId: string,
      embedding: MemoryModelRef,
      dimensions: number,
      task: (store: IMemoryVectorStore, generation: number) => Promise<T>,
      options?: { allowHistoricalIdentity?: boolean }
    ): Promise<T>
  }
  reindexEmbeddings: (agentId: string, force?: boolean) => Promise<void>
  backfillEmbeddings: (agentId: string) => Promise<void>
  diagnostics?: {
    observeEmbeddingBacklog(pending: number, activeAgents: number): void
    recordEmbedding(
      agentId: string,
      sample: {
        batchSize: number
        drainDurationMs: number
        succeeded: number
        failed: number
        ftsOnly: number
      }
    ): void
    recordVectorOutcome(
      outcome: 'eviction' | 'warmupSucceeded' | 'warmupDeferred' | 'warmupFailed'
    ): void
  }
}

type EmbeddingDrainOutcome = 'progress' | 'empty' | 'blocked'
type EmbeddingDrainResult = {
  outcome: EmbeddingDrainOutcome
  batchSize: number
  succeeded: number
  failed: number
  ftsOnly: number
}

function embeddingDrainResult(
  outcome: EmbeddingDrainOutcome,
  batchSize = 0,
  counts: Partial<Pick<EmbeddingDrainResult, 'succeeded' | 'failed' | 'ftsOnly'>> = {}
): EmbeddingDrainResult {
  return {
    outcome,
    batchSize,
    succeeded: counts.succeeded ?? 0,
    failed: counts.failed ?? 0,
    ftsOnly: counts.ftsOnly ?? 0
  }
}

export class EmbeddingPipeline {
  private readonly ctx: MemoryRuntimeContext
  private readonly embeddingWarmups = new Map<string, Promise<void>>()
  private readonly embeddingWarmupAgents = new Map<string, Set<string>>()
  private readonly embeddingWarmSuccesses = new Set<string>()
  private readonly embeddingWarmFailureUntil = new Map<string, number>()
  private readonly vectorStoreWarmups = new Map<string, Promise<void>>()
  private readonly vectorStoreDimensionFailures = new Map<string, number>()
  private readonly embeddingDrains = new Map<string, Promise<void>>()
  private readonly embeddingDrainDirty = new Set<string>()
  private readonly embeddingDrainLimits = new Map<string, number>()
  private readonly reindexing = new Map<string, Promise<void>>()
  private readonly backfilling = new Map<string, Promise<void>>()
  private readonly errorRetryAt = new Map<string, number>()
  private readonly errorRetryAfterId = new Map<string, string | null>()

  constructor(private readonly ports: EmbeddingPipelinePorts) {
    this.ctx = ports.ctx
  }

  isReindexing(agentId: string): boolean {
    return this.reindexing.has(agentId)
  }

  processPendingEmbeddings(agentId: string, limit = 50): Promise<void> {
    if (!this.ctx.canWriteAgentMemory(agentId)) return Promise.resolve()
    const normalizedLimit = Math.min(REINDEX_BATCH_SIZE, Math.max(1, Math.floor(limit)))
    this.embeddingDrainDirty.add(agentId)
    this.embeddingDrainLimits.set(
      agentId,
      Math.max(this.embeddingDrainLimits.get(agentId) ?? 0, normalizedLimit)
    )
    const existing = this.embeddingDrains.get(agentId)
    if (existing) return existing

    const tracked = this.runEmbeddingDrainSupervisor(agentId).finally(async () => {
      while (this.embeddingDrainDirty.has(agentId) && this.ctx.canWriteAgentMemory(agentId)) {
        await this.runEmbeddingDrainSupervisor(agentId)
      }
      if (this.embeddingDrains.get(agentId) !== tracked) return
      this.embeddingDrains.delete(agentId)
      this.embeddingDrainLimits.delete(agentId)
      this.observeBacklog()
    })
    this.embeddingDrains.set(agentId, tracked)
    this.observeBacklog()
    return tracked
  }

  private async runEmbeddingDrainSupervisor(agentId: string): Promise<void> {
    while (this.embeddingDrainDirty.delete(agentId) && this.ctx.canWriteAgentMemory(agentId)) {
      await this.runEmbeddingDrainLoop(agentId)
    }
  }

  private async runEmbeddingDrainLoop(agentId: string): Promise<void> {
    let keepDraining = true
    for (let cycle = 0; cycle < REINDEX_MAX_BATCHES && keepDraining; cycle += 1) {
      const limit = Math.min(
        REINDEX_BATCH_SIZE,
        Math.max(1, this.embeddingDrainLimits.get(agentId) || REINDEX_BATCH_SIZE)
      )
      this.embeddingDrainLimits.set(agentId, 0)
      const batchStartedAt = performance.now()
      const result = await this.drainPendingEmbeddings(agentId, limit)
      if (result.batchSize > 0) {
        this.ports.diagnostics?.recordEmbedding(agentId, {
          batchSize: result.batchSize,
          drainDurationMs: performance.now() - batchStartedAt,
          succeeded: result.succeeded,
          failed: result.failed,
          ftsOnly: result.ftsOnly
        })
      }
      if (!this.ctx.canContinueAgentMemoryTask(agentId)) break
      if (result.outcome === 'blocked' || result.outcome === 'empty') break
      keepDraining = true
      this.embeddingDrainDirty.delete(agentId)
      if (cycle === REINDEX_MAX_BATCHES - 1) this.embeddingDrainDirty.add(agentId)
    }
    if (
      !this.reindexing.has(agentId) &&
      this.ctx.canContinueAgentMemoryTask(agentId) &&
      this.ports.repository.listPendingEmbedding(1, agentId).length === 0
    ) {
      const embedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
      if (embedding?.providerId && embedding?.modelId) {
        await this.warmVectorStore(agentId, {
          providerId: embedding.providerId,
          modelId: embedding.modelId
        })
      }
    }
  }

  private observeBacklog(): void {
    this.ports.diagnostics?.observeEmbeddingBacklog(
      this.ports.repository.countPendingEmbedding(),
      this.embeddingDrains.size
    )
  }

  private async drainPendingEmbeddings(
    agentId: string,
    limit: number
  ): Promise<EmbeddingDrainResult> {
    if (!this.ctx.canContinueAgentMemoryTask(agentId)) return embeddingDrainResult('blocked')
    const operationFence = this.ctx.captureOperationFence(agentId)
    const config = this.ports.policy.resolveAgentConfig(agentId)
    let pending = this.ports.repository.listPendingEmbedding(limit, agentId)
    if (!pending.length) {
      const lastRetryAt = this.errorRetryAt.get(agentId) ?? 0
      const now = Date.now()
      if (now - lastRetryAt >= ERROR_RETRY_COOLDOWN_MS) {
        let afterId = this.errorRetryAfterId.get(agentId) ?? null
        let retryIds = this.ports.repository.listEmbeddingStateIds(
          agentId,
          ['error'],
          ERROR_RETRY_BATCH_LIMIT,
          afterId
        )
        if (!retryIds.length && afterId !== null) {
          afterId = null
          retryIds = this.ports.repository.listEmbeddingStateIds(
            agentId,
            ['error'],
            ERROR_RETRY_BATCH_LIMIT,
            null
          )
        }
        if (retryIds.length) {
          const requeued = this.ports.repository.requeueForEmbedding(
            agentId,
            ['error'],
            retryIds.length,
            afterId
          )
          this.errorRetryAt.set(agentId, now)
          this.errorRetryAfterId.set(agentId, retryIds[retryIds.length - 1])
          if (requeued > 0) pending = this.ports.repository.listPendingEmbedding(limit, agentId)
        }
      }
    }
    if (!pending.length) return embeddingDrainResult('empty')
    const batchSize = pending.length

    const embedding = config?.memoryEmbedding
    if (!embedding?.providerId || !embedding?.modelId) {
      const transitioned = this.ports.repository.markPendingEmbeddingsError(
        agentId,
        pending.map((row) => ({ id: row.id, expectedRevision: row.decision_revision })),
        'fts_only'
      )
      return embeddingDrainResult('progress', batchSize, { ftsOnly: transitioned.length })
    }

    let vectors: number[][]
    try {
      vectors = await this.ports.embeddingGateway.getEmbeddings(
        agentId,
        embedding.providerId,
        embedding.modelId,
        pending.map((row) => row.content),
        'embedding-batch'
      )
    } catch (error) {
      logger.error(`[Memory] embedding service failed for ${agentId}, will retry: ${String(error)}`)
      return embeddingDrainResult('blocked', batchSize)
    }

    if (!this.ctx.canContinueOperation(operationFence)) {
      return embeddingDrainResult('blocked', batchSize)
    }
    const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
    const currentEmbedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
    if (
      !currentEmbedding?.providerId ||
      !currentEmbedding?.modelId ||
      embeddingFingerprint(currentEmbedding.providerId, currentEmbedding.modelId) !== fingerprint
    ) {
      return embeddingDrainResult('blocked', batchSize)
    }

    const authoritativeRows = this.ports.repository.listByIds(
      agentId,
      pending.map((row) => row.id)
    )
    const authoritativeById = new Map(authoritativeRows.map((row) => [row.id, row]))
    const dim =
      vectors.find(
        (vector) =>
          Array.isArray(vector) &&
          vector.length > 0 &&
          vector.every((value) => Number.isFinite(value))
      )?.length ?? 0
    const records: MemoryVectorRecord[] = []
    const readyUpdates: EmbeddedMemoryUpdate[] = []
    const malformedUpdates: FailedEmbeddingUpdate[] = []
    for (let index = 0; index < pending.length; index += 1) {
      const snapshot = pending[index]
      const current = authoritativeById.get(snapshot.id)
      if (
        !current ||
        current.decision_revision !== snapshot.decision_revision ||
        !this.ports.rows.isPendingEmbeddableRow(agentId, current)
      ) {
        continue
      }
      const vector = vectors[index]
      if (
        dim > 0 &&
        Array.isArray(vector) &&
        vector.length === dim &&
        vector.every((value) => Number.isFinite(value))
      ) {
        records.push({ memoryId: current.id, embedding: vector })
        readyUpdates.push({
          id: current.id,
          expectedRevision: snapshot.decision_revision,
          embeddingId: current.id,
          embeddingDim: dim,
          embeddingModel: fingerprint
        })
      } else {
        malformedUpdates.push({
          id: current.id,
          expectedRevision: snapshot.decision_revision
        })
      }
    }

    if (!records.length) {
      let failed = 0
      if (malformedUpdates.length) {
        this.errorRetryAt.set(agentId, Date.now())
        failed = this.ports.repository.markPendingEmbeddingsError(agentId, malformedUpdates).length
      }
      return embeddingDrainResult('progress', batchSize, { failed })
    }

    let sidecarWritten = false
    let sqliteTransitionAttempted = false
    let succeeded = 0
    try {
      const outcome = await this.ports.vectorStore.withVectorMutation(agentId, () =>
        this.ports.vectorStore.withStoreLease(
          agentId,
          { providerId: embedding.providerId, modelId: embedding.modelId },
          dim,
          async (store, generation) => {
            if (
              !this.ctx.canContinueOperation(operationFence) ||
              !this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)
            ) {
              return { written: new Set<string>(), usable: true, generation }
            }
            if (!store.isUsable()) {
              return { written: new Set<string>(), usable: false, generation }
            }
            await store.upsert(records)
            sidecarWritten = true
            if (!this.ports.vectorStore.isGenerationCurrent(agentId, generation)) {
              return { written: new Set<string>(), usable: true, generation }
            }
            sqliteTransitionAttempted = true
            const readyIds = this.ports.repository.markPendingEmbeddingsReady(agentId, readyUpdates)
            succeeded = readyIds.length
            const readySet = new Set(readyIds)
            const orphanIds = records
              .map((record) => record.memoryId)
              .filter((memoryId) => !readySet.has(memoryId))
            if (orphanIds.length) await store.deleteByMemoryIds(orphanIds)
            return { written: readySet, usable: true, generation }
          }
        )
      )

      if (
        !this.ctx.canContinueOperation(operationFence) ||
        !this.ports.vectorStore.isGenerationCurrent(agentId, outcome.generation)
      ) {
        return embeddingDrainResult('blocked', batchSize, { succeeded })
      }
      const latestEmbedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
      const currentFingerprint =
        latestEmbedding?.providerId && latestEmbedding?.modelId
          ? embeddingFingerprint(latestEmbedding.providerId, latestEmbedding.modelId)
          : null
      if (currentFingerprint !== fingerprint) {
        logger.info(
          `[Memory] embedding config changed during drain for ${agentId}; discarding stale vectors`
        )
        return embeddingDrainResult('blocked', batchSize, { succeeded })
      }
      if (!outcome.usable) {
        this.errorRetryAt.set(agentId, Date.now())
        const failed = this.ports.repository.markPendingEmbeddingsError(agentId, [
          ...readyUpdates,
          ...malformedUpdates
        ]).length
        this.ports.vectorStore.clearReady(agentId)
        return embeddingDrainResult('progress', batchSize, { failed })
      }

      let failed = 0
      if (malformedUpdates.length) {
        this.errorRetryAt.set(agentId, Date.now())
        failed = this.ports.repository.markPendingEmbeddingsError(agentId, malformedUpdates).length
      }
      return embeddingDrainResult('progress', batchSize, { succeeded, failed })
    } catch (error) {
      logger.error(`[Memory] vector store write failed for ${agentId}: ${String(error)}`)
      if (
        error instanceof VectorStoreLeaseUnavailableError ||
        error instanceof VectorStoreOperationTimeoutError
      ) {
        return embeddingDrainResult('blocked', batchSize, { succeeded })
      }
      if (!this.ctx.canContinueOperation(operationFence)) {
        return embeddingDrainResult('blocked', batchSize, { succeeded })
      }
      const latestEmbedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
      if (
        !latestEmbedding?.providerId ||
        !latestEmbedding?.modelId ||
        embeddingFingerprint(latestEmbedding.providerId, latestEmbedding.modelId) !== fingerprint
      ) {
        return embeddingDrainResult('blocked', batchSize, { succeeded })
      }
      this.ports.vectorStore.clearReady(agentId)
      if (!sidecarWritten && !sqliteTransitionAttempted) {
        this.errorRetryAt.set(agentId, Date.now())
        const failed = this.ports.repository.markPendingEmbeddingsError(agentId, [
          ...readyUpdates,
          ...malformedUpdates
        ]).length
        return embeddingDrainResult('progress', batchSize, { failed })
      }
      let failed = 0
      if (malformedUpdates.length) {
        this.errorRetryAt.set(agentId, Date.now())
        failed = this.ports.repository.markPendingEmbeddingsError(agentId, malformedUpdates).length
      }
      return embeddingDrainResult('blocked', batchSize, { succeeded, failed })
    }
  }

  reindexEmbeddings(agentId: string, force = false): Promise<void> {
    if (this.ctx.isDisposed) return Promise.resolve()
    this.ports.vectorStore.clearReady(agentId)
    const inflight = this.reindexing.get(agentId)
    if (inflight) return inflight
    const tracked = this.runReindex(agentId, force).finally(() => {
      if (this.reindexing.get(agentId) === tracked) this.reindexing.delete(agentId)
      if (!this.ctx.isDisposed) this.ctx.emitChanged(agentId, 'reindex')
    })
    this.reindexing.set(agentId, tracked)
    return tracked
  }

  private async runReindex(agentId: string, force: boolean): Promise<void> {
    if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
    const inFlightDrain = this.embeddingDrains.get(agentId)
    if (inFlightDrain) await inFlightDrain.catch(() => undefined)
    if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
    const requeued = this.ports.repository.requeueForEmbedding(agentId, [
      'ready',
      'error',
      'fts_only'
    ])
    if (!requeued && !force) return
    if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
    const cleanupDisposition = await this.ports.vectorStore.resetAgentStore(agentId)
    if (cleanupDisposition === 'pending-restart') return
    if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
    this.ctx.emitChanged(agentId, 'reindex')
    await this.drainUntilExhausted(agentId)
    if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
    const currentEmbedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
    if (currentEmbedding?.providerId && currentEmbedding?.modelId) {
      await this.warmVectorStore(agentId, {
        providerId: currentEmbedding.providerId,
        modelId: currentEmbedding.modelId
      })
    }
  }

  backfillEmbeddings(agentId: string): Promise<void> {
    if (this.ctx.isDisposed) return Promise.resolve()
    const inflight = this.backfilling.get(agentId)
    if (inflight) return inflight
    const tracked = this.runBackfill(agentId).finally(() => {
      if (this.backfilling.get(agentId) === tracked) this.backfilling.delete(agentId)
    })
    this.backfilling.set(agentId, tracked)
    return tracked
  }

  private async runBackfill(agentId: string): Promise<void> {
    await Promise.resolve()
    if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
    if (this.ports.repository.listEmbeddingStateIds(agentId, ['fts_only'], 1).length) {
      this.ports.repository.requeueForEmbedding(agentId, ['fts_only'])
    }
    await this.drainUntilExhausted(agentId)
  }

  private async drainUntilExhausted(agentId: string): Promise<void> {
    for (let i = 0; i < REINDEX_MAX_BATCHES; i += 1) {
      if (!this.ctx.canContinueAgentMemoryTask(agentId)) break
      const head = this.ports.repository.listPendingEmbedding(1, agentId)
      if (!head.length) break
      await this.processPendingEmbeddings(agentId, REINDEX_BATCH_SIZE)
      if (!this.ctx.canContinueAgentMemoryTask(agentId)) break
      const next = this.ports.repository.listPendingEmbedding(1, agentId)
      if (next.length && next[0].id === head[0].id) break
    }
  }

  warmVectorStore(
    agentId: string,
    embedding: MemoryModelRef,
    options: { delayOpen?: boolean } = {}
  ): Promise<void> {
    if (this.ctx.isDisposed || !this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) {
      return Promise.resolve()
    }
    if (this.ports.vectorStore.getRecallHealth(agentId) !== 'available') {
      return Promise.resolve()
    }
    if (this.ports.vectorStore.hasReadyCertificate(agentId, embedding)) return Promise.resolve()
    const key = this.ports.vectorStore.warmupKey(agentId, embedding)
    const inflight = this.vectorStoreWarmups.get(key)
    if (inflight) return inflight

    const openDelay = options.delayOpen ? this.waitForBackgroundTick() : null
    const tracked = Promise.resolve()
      .then(async () => {
        const outcome = await this.runWarmVectorStore(agentId, embedding, openDelay)
        this.ports.diagnostics?.recordVectorOutcome(
          outcome === 'succeeded' ? 'warmupSucceeded' : 'warmupDeferred'
        )
      })
      .catch((error) => {
        this.ports.diagnostics?.recordVectorOutcome('warmupFailed')
        this.ports.vectorStore.clearReady(agentId)
        logger.warn(`[Memory] vector store warm failed for ${agentId}: ${String(error)}`)
      })
      .finally(() => {
        if (this.vectorStoreWarmups.get(key) === tracked) this.vectorStoreWarmups.delete(key)
      })
    this.vectorStoreWarmups.set(key, tracked)
    return tracked
  }

  private waitForBackgroundTick(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 0)
      if (typeof timer.unref === 'function') timer.unref()
    })
  }

  private async runWarmVectorStore(
    agentId: string,
    embedding: MemoryModelRef,
    openDelay: Promise<void> | null
  ): Promise<'succeeded' | 'deferred'> {
    if (!this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) return 'deferred'
    const operationFence = this.ctx.captureOperationFence(agentId)
    const dimensions = await this.resolveWarmVectorDimensions(agentId, embedding, operationFence)
    if (
      !this.ctx.canContinueOperation(operationFence) ||
      !this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)
    ) {
      return 'deferred'
    }
    if (this.ports.vectorStore.getReadyCertificateDimension(agentId, embedding) === dimensions)
      return 'succeeded'
    if (openDelay) await openDelay
    if (!this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) return 'deferred'

    const leaseResult = await this.ports.vectorStore.withStoreLease(
      agentId,
      embedding,
      dimensions,
      async (store, generation) => {
        if (!this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) {
          return { usable: false, generation }
        }
        return { usable: store.isUsable(), generation }
      }
    )
    if (!this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) return 'deferred'

    if (!leaseResult.usable) {
      this.ports.vectorStore.clearReady(agentId)
      if (!this.reindexing.has(agentId)) {
        void this.ports.reindexEmbeddings(agentId, true).catch((error) => {
          logger.warn(`[Memory] store rebuild failed for ${agentId}: ${String(error)}`)
        })
      }
      return 'deferred'
    }

    const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
    if (this.ports.repository.hasStaleEmbeddings(agentId, dimensions, fingerprint)) {
      this.ports.vectorStore.clearReady(agentId)
      void this.ports.reindexEmbeddings(agentId).catch((error) => {
        logger.warn(`[Memory] reindex failed for ${agentId}: ${String(error)}`)
      })
      return 'deferred'
    }

    const coverage = await this.verifyVectorCoverage(agentId, embedding, dimensions, fingerprint)
    if (!coverage.verified) {
      this.ports.vectorStore.clearReady(agentId)
      if (coverage.missingAuthoritativeVector && !this.reindexing.has(agentId)) {
        void this.ports.reindexEmbeddings(agentId, true).catch((error) => {
          logger.warn(
            `[Memory] incomplete vector store rebuild failed for ${agentId}: ${String(error)}`
          )
        })
      }
      return 'deferred'
    }

    this.ports.vectorStore.markReady(agentId, embedding, dimensions, coverage.generation)
    if (!this.reindexing.has(agentId)) {
      void this.ports.backfillEmbeddings(agentId).catch((error) => {
        logger.warn(`[Memory] backfill failed for ${agentId}: ${String(error)}`)
      })
    }
    return 'succeeded'
  }

  private collectCurrentEmbeddedIds(
    agentId: string,
    dimensions: number,
    fingerprint: string
  ): { ids: string[]; complete: boolean } {
    const ids: string[] = []
    let afterId: string | null = null
    for (let guard = 0; guard < REINDEX_MAX_BATCHES; guard += 1) {
      const page = this.ports.repository.listCurrentEmbeddedIds(
        agentId,
        dimensions,
        fingerprint,
        afterId,
        ORPHAN_RECONCILE_BATCH
      )
      ids.push(...page)
      if (page.length < ORPHAN_RECONCILE_BATCH) return { ids, complete: true }
      afterId = page[page.length - 1]
    }
    return { ids, complete: false }
  }

  private async verifyVectorCoverage(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    fingerprint: string
  ): Promise<{
    verified: boolean
    missingAuthoritativeVector: boolean
    generation: number
  }> {
    return this.ports.vectorStore.withVectorMutation(agentId, async () => {
      const readEpoch = this.ctx.captureReadEpoch(agentId)
      const authoritative = this.collectCurrentEmbeddedIds(agentId, dimensions, fingerprint)
      if (!authoritative.complete) {
        return { verified: false, missingAuthoritativeVector: true, generation: -1 }
      }
      const outcome = await this.ports.vectorStore.withStoreLease(
        agentId,
        embedding,
        dimensions,
        async (store, generation) => {
          if (!store.isUsable()) {
            return {
              verified: false,
              missingAuthoritativeVector: false,
              generation
            }
          }
          const sidecarIds: string[] = []
          let afterId: string | null = null
          let complete = false
          for (let guard = 0; guard < REINDEX_MAX_BATCHES; guard += 1) {
            const page = await store.listMemoryIds(afterId, ORPHAN_RECONCILE_BATCH)
            if (!this.ports.vectorStore.isGenerationCurrent(agentId, generation)) {
              return { verified: false, missingAuthoritativeVector: false, generation }
            }
            sidecarIds.push(...page)
            if (page.length < ORPHAN_RECONCILE_BATCH) {
              complete = true
              break
            }
            afterId = page[page.length - 1]
          }
          if (!complete) {
            return { verified: false, missingAuthoritativeVector: false, generation }
          }
          const authoritativeSet = new Set(authoritative.ids)
          const sidecarSet = new Set(sidecarIds)
          const missingAuthoritativeVector = authoritative.ids.some((id) => !sidecarSet.has(id))
          if (missingAuthoritativeVector) {
            return { verified: false, missingAuthoritativeVector: true, generation }
          }
          const extras = sidecarIds.filter((id) => !authoritativeSet.has(id))
          for (let start = 0; start < extras.length; start += ORPHAN_RECONCILE_BATCH) {
            await store.deleteByMemoryIds(extras.slice(start, start + ORPHAN_RECONCILE_BATCH))
            if (!this.ports.vectorStore.isGenerationCurrent(agentId, generation)) {
              return { verified: false, missingAuthoritativeVector: false, generation }
            }
          }
          return { verified: true, missingAuthoritativeVector: false, generation }
        }
      )
      if (
        !this.ctx.isReadEpochCurrent(agentId, readEpoch) ||
        !this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding) ||
        !this.ports.vectorStore.isGenerationCurrent(agentId, outcome.generation)
      ) {
        return {
          verified: false,
          missingAuthoritativeVector: false,
          generation: outcome.generation
        }
      }
      return outcome
    })
  }

  private async resolveWarmVectorDimensions(
    agentId: string,
    embedding: MemoryModelRef,
    operationFence: MemoryOperationFence
  ): Promise<number> {
    const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
    const storedDim = this.ports.repository.getCurrentEmbeddingDimension(agentId, fingerprint)
    const key = this.ports.vectorStore.warmupKey(agentId, embedding)
    if (storedDim !== null) {
      this.vectorStoreDimensionFailures.delete(key)
      return storedDim
    }
    const lastFailureAt = this.vectorStoreDimensionFailures.get(key)
    if (
      lastFailureAt !== undefined &&
      Date.now() - lastFailureAt < WARM_DIMENSION_FAILURE_COOLDOWN_MS
    ) {
      throw new Error(
        `[Memory] embedding dimension warm is cooling down for ${embedding.providerId}/${embedding.modelId}`
      )
    }

    try {
      const attrs = await this.ports.embeddingGateway.getDimensions(
        agentId,
        embedding.providerId,
        embedding.modelId
      )
      if (!this.ctx.canContinueOperation(operationFence)) {
        throw new Error('[Memory] embedding dimension request invalidated')
      }
      const dimensions = attrs.data.dimensions
      if (!Number.isFinite(dimensions) || dimensions <= 0) {
        throw new Error(
          attrs.errorMsg ??
            `[Memory] invalid embedding dimension for ${embedding.providerId}/${embedding.modelId}`
        )
      }
      this.vectorStoreDimensionFailures.delete(key)
      return dimensions
    } catch (error) {
      if (this.ctx.canContinueOperation(operationFence)) {
        this.vectorStoreDimensionFailures.set(key, Date.now())
      }
      throw error
    }
  }

  warmEmbeddingConnection(agentId: string, embedding: MemoryModelRef): void {
    if (this.ctx.isDisposed || !this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) return
    const key = `${embedding.providerId}::${embedding.modelId}`
    if (this.embeddingWarmSuccesses.has(key)) return
    if (Date.now() < (this.embeddingWarmFailureUntil.get(key) ?? 0)) return
    const agents = this.embeddingWarmupAgents.get(key) ?? new Set<string>()
    agents.add(agentId)
    this.embeddingWarmupAgents.set(key, agents)
    if (this.embeddingWarmups.has(key)) return
    const tracked = Promise.resolve()
      .then(async () => {
        await this.ports.embeddingGateway.getEmbeddings(
          agentId,
          embedding.providerId,
          embedding.modelId,
          [EMBEDDING_PREWARM_TEXT],
          'embedding-warm'
        )
        if (!this.ctx.isDisposed) {
          this.embeddingWarmSuccesses.add(key)
          this.embeddingWarmFailureUntil.delete(key)
        }
      })
      .catch((error) => {
        if (!this.ctx.isDisposed) {
          this.embeddingWarmFailureUntil.set(key, Date.now() + EMBEDDING_WARM_FAILURE_COOLDOWN_MS)
        }
        logger.warn(`[Memory] embedding warm failed for ${agentId}: ${String(error)}`)
      })
      .finally(() => {
        if (this.embeddingWarmups.get(key) === tracked) this.embeddingWarmups.delete(key)
        this.embeddingWarmupAgents.delete(key)
      })
    this.embeddingWarmups.set(key, tracked)
  }

  getInFlight(): Promise<unknown>[] {
    return [
      ...this.reindexing.values(),
      ...this.backfilling.values(),
      ...this.embeddingDrains.values(),
      ...this.vectorStoreWarmups.values(),
      ...this.embeddingWarmups.values()
    ]
  }

  private getAgentInFlight(agentId: string): Promise<unknown>[] {
    const reindexing = this.reindexing.get(agentId)
    const backfilling = this.backfilling.get(agentId)
    const embeddingDrain = this.embeddingDrains.get(agentId)
    const vectorWarmups = this.getAgentEntries(this.vectorStoreWarmups, agentId)
    const embeddingWarmups = [...this.embeddingWarmups.entries()].filter(([key]) =>
      this.embeddingWarmupAgents.get(key)?.has(agentId)
    )
    const inflight: Array<Promise<unknown> | undefined> = [
      reindexing,
      backfilling,
      embeddingDrain,
      ...vectorWarmups.map(([, promise]) => promise),
      ...embeddingWarmups.map(([, promise]) => promise)
    ]
    return inflight.filter((promise): promise is Promise<unknown> => Boolean(promise))
  }

  private getAgentEntries<T>(map: Map<string, T>, agentId: string): Array<[string, T]> {
    return [...map.entries()].filter(([key]) => key.startsWith(`${agentId}::`))
  }

  async cleanupAgent(agentId: string): Promise<void> {
    for (let i = 0; i < REINDEX_MAX_BATCHES; i += 1) {
      const inflight = this.getAgentInFlight(agentId)
      if (!inflight.length) break
      await Promise.allSettled(inflight)
    }

    this.abandonAgent(agentId)
  }

  abandonAgent(agentId: string): void {
    this.reindexing.delete(agentId)
    this.backfilling.delete(agentId)
    this.embeddingDrains.delete(agentId)
    this.embeddingDrainDirty.delete(agentId)
    this.embeddingDrainLimits.delete(agentId)
    this.errorRetryAt.delete(agentId)
    this.errorRetryAfterId.delete(agentId)
    for (const [key] of this.getAgentEntries(this.vectorStoreWarmups, agentId)) {
      this.vectorStoreWarmups.delete(key)
    }
    for (const [key, agents] of this.embeddingWarmupAgents) {
      agents.delete(agentId)
      if (!agents.size) this.embeddingWarmupAgents.delete(key)
    }
    for (const key of this.vectorStoreDimensionFailures.keys()) {
      if (key.startsWith(`${agentId}::`)) this.vectorStoreDimensionFailures.delete(key)
    }
    this.observeBacklog()
  }

  clearAll(): void {
    this.embeddingWarmups.clear()
    this.embeddingWarmupAgents.clear()
    this.embeddingWarmSuccesses.clear()
    this.embeddingWarmFailureUntil.clear()
    this.vectorStoreWarmups.clear()
    this.vectorStoreDimensionFailures.clear()
    this.embeddingDrains.clear()
    this.embeddingDrainDirty.clear()
    this.embeddingDrainLimits.clear()
    this.reindexing.clear()
    this.backfilling.clear()
    this.errorRetryAt.clear()
    this.errorRetryAfterId.clear()
  }
}
