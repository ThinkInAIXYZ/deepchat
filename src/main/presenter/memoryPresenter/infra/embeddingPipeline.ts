import logger from '@shared/logger'

import {
  ERROR_RETRY_BATCH_LIMIT,
  ERROR_RETRY_COOLDOWN_MS,
  EMBEDDING_PREWARM_TEXT,
  ORPHAN_RECONCILE_BATCH,
  ORPHAN_RECONCILE_RETRY_COOLDOWN_MS,
  REINDEX_BATCH_SIZE,
  REINDEX_MAX_BATCHES,
  WARM_DIMENSION_FAILURE_COOLDOWN_MS
} from '../runtimeConstants'
import type { AgentMemoryRow, MemoryVectorRecord } from '../types'
import { embeddingFingerprint, type MemoryModelRef, type MemoryRuntimeContext } from '../context'
import { VectorStoreManager } from './vectorStoreManager'

export interface EmbeddingPipelinePorts {
  reindexEmbeddings: (agentId: string, force?: boolean) => Promise<void>
  backfillEmbeddings: (agentId: string) => Promise<void>
}

interface PendingEmbeddableRowPort {
  isPendingEmbeddableRow(agentId: string, row: AgentMemoryRow | undefined): boolean
}

interface EmbeddingPipelineRuntimeState {
  embeddingWarmups: Map<string, Promise<void>>
  vectorStoreWarmups: Map<string, Promise<void>>
  vectorStoreDimensionFailures: Map<string, number>
  embeddingDrains: Map<string, Promise<unknown>>
  reindexing: Map<string, Promise<void>>
  backfilling: Map<string, Promise<void>>
  errorRetryAt: Map<string, number>
  errorRetryAfterId: Map<string, string | null>
  orphanVectorReconciles: Map<string, Promise<void>>
  orphanVectorReconciled: Set<string>
  orphanVectorReconcileRetryAt: Map<string, number>
}

export class EmbeddingPipeline {
  private readonly embeddingWarmups = new Map<string, Promise<void>>()
  private readonly vectorStoreWarmups = new Map<string, Promise<void>>()
  private readonly vectorStoreDimensionFailures = new Map<string, number>()
  private readonly embeddingDrains = new Map<string, Promise<unknown>>()
  private readonly reindexing = new Map<string, Promise<void>>()
  private readonly backfilling = new Map<string, Promise<void>>()
  private readonly errorRetryAt = new Map<string, number>()
  private readonly errorRetryAfterId = new Map<string, string | null>()
  private readonly orphanVectorReconciles = new Map<string, Promise<void>>()
  private readonly orphanVectorReconcileTokens = new Map<string, symbol>()
  private readonly orphanVectorReconciled = new Set<string>()
  private readonly orphanVectorReconcileRetryAt = new Map<string, number>()

  constructor(
    private readonly ctx: MemoryRuntimeContext,
    private readonly vectorStore: VectorStoreManager,
    private readonly rows: PendingEmbeddableRowPort,
    private readonly ports: EmbeddingPipelinePorts
  ) {}

  isReindexing(agentId: string): boolean {
    return this.reindexing.has(agentId)
  }

  processPendingEmbeddings(agentId: string, limit = 50): Promise<void> {
    if (!this.ctx.canWriteAgentMemory(agentId)) return Promise.resolve()
    const prev = this.embeddingDrains.get(agentId)
    const run = prev
      ? prev.then(
          () => this.drainPendingEmbeddings(agentId, limit),
          () => this.drainPendingEmbeddings(agentId, limit)
        )
      : this.drainPendingEmbeddings(agentId, limit)
    const tracked = run.then(
      () => undefined,
      () => undefined
    )
    this.embeddingDrains.set(agentId, tracked)
    void tracked.finally(() => {
      if (this.embeddingDrains.get(agentId) === tracked) {
        this.embeddingDrains.delete(agentId)
      }
    })
    return run
  }

  private async drainPendingEmbeddings(agentId: string, limit: number): Promise<void> {
    if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
    const config = this.ctx.deps.resolveAgentConfig(agentId)
    let pending = this.ctx.deps.repository.listPendingEmbedding(limit, agentId)
    if (!pending.length) {
      const lastRetryAt = this.errorRetryAt.get(agentId) ?? 0
      const now = Date.now()
      if (now - lastRetryAt >= ERROR_RETRY_COOLDOWN_MS) {
        let afterId = this.errorRetryAfterId.get(agentId) ?? null
        let retryIds = this.ctx.deps.repository.listEmbeddingStatusIds(
          agentId,
          ['error'],
          ERROR_RETRY_BATCH_LIMIT,
          afterId
        )
        if (!retryIds.length && afterId !== null) {
          afterId = null
          retryIds = this.ctx.deps.repository.listEmbeddingStatusIds(
            agentId,
            ['error'],
            ERROR_RETRY_BATCH_LIMIT,
            null
          )
        }
        if (retryIds.length) {
          const requeued = this.ctx.deps.repository.requeueForEmbedding(
            agentId,
            ['error'],
            retryIds.length,
            afterId
          )
          this.errorRetryAt.set(agentId, now)
          this.errorRetryAfterId.set(agentId, retryIds[retryIds.length - 1])
          if (requeued > 0) pending = this.ctx.deps.repository.listPendingEmbedding(limit, agentId)
        }
      }
    }
    if (!pending.length) return

    const embedding = config?.memoryEmbedding
    if (!embedding?.providerId || !embedding?.modelId) {
      for (const row of pending) {
        this.ctx.deps.repository.updatePendingEmbeddingStatus(agentId, row.id, 'fts_only')
      }
      return
    }

    let vectors: number[][]
    try {
      vectors = await this.ctx.deps.getEmbeddings(
        embedding.providerId,
        embedding.modelId,
        pending.map((row) => row.content)
      )
    } catch (error) {
      logger.error(`[Memory] embedding service failed for ${agentId}, will retry: ${String(error)}`)
      if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
      for (const row of pending) {
        this.ctx.deps.repository.updatePendingEmbeddingStatus(agentId, row.id, 'pending_embedding')
      }
      return
    }

    if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
    try {
      const dim = vectors.find((vector) => vector?.length)?.length ?? 0
      const records: MemoryVectorRecord[] = []
      let liveRecordsForOutcome: MemoryVectorRecord[] = []
      for (let i = 0; i < pending.length; i += 1) {
        const vector = vectors[i]
        if (dim > 0 && vector?.length === dim) {
          records.push({ memoryId: pending[i].id, embedding: vector })
        } else if (
          this.rows.isPendingEmbeddableRow(agentId, this.ctx.deps.repository.getById(pending[i].id))
        ) {
          this.ctx.deps.repository.updatePendingEmbeddingStatus(agentId, pending[i].id, 'error')
          this.errorRetryAt.set(agentId, Date.now())
        }
      }
      if (!records.length) return

      const outcome = await this.vectorStore.withAgentLock(agentId, async (locked) => {
        if (!this.ctx.canContinueAgentMemoryTask(agentId)) {
          return { written: new Set<string>(), usable: true }
        }
        const live = records.filter((record) =>
          this.rows.isPendingEmbeddableRow(
            agentId,
            this.ctx.deps.repository.getById(record.memoryId)
          )
        )
        liveRecordsForOutcome = live
        if (!live.length) return { written: new Set<string>(), usable: true }
        const currentEmbedding = this.ctx.deps.resolveAgentConfig(agentId)?.memoryEmbedding
        if (
          !currentEmbedding?.providerId ||
          !currentEmbedding?.modelId ||
          embeddingFingerprint(currentEmbedding.providerId, currentEmbedding.modelId) !==
            embeddingFingerprint(embedding.providerId, embedding.modelId)
        ) {
          return { written: new Set<string>(), usable: true }
        }
        const store = await locked.open(
          { providerId: embedding.providerId, modelId: embedding.modelId },
          dim
        )
        if (!this.ctx.canContinueAgentMemoryTask(agentId)) {
          return { written: new Set<string>(), usable: true }
        }
        if (!store.isUsable()) return { written: new Set<string>(), usable: false }
        await store.upsert(live)
        return { written: new Set(live.map((record) => record.memoryId)), usable: true }
      })

      if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
      const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
      const currentEmbedding = this.ctx.deps.resolveAgentConfig(agentId)?.memoryEmbedding
      const currentFingerprint =
        currentEmbedding?.providerId && currentEmbedding?.modelId
          ? embeddingFingerprint(currentEmbedding.providerId, currentEmbedding.modelId)
          : null
      if (currentFingerprint !== fingerprint) {
        logger.info(
          `[Memory] embedding config changed during drain for ${agentId}; discarding stale vectors`
        )
        return
      }
      for (const record of liveRecordsForOutcome) {
        if (outcome.written.has(record.memoryId)) {
          this.ctx.deps.repository.updatePendingEmbeddingStatus(
            agentId,
            record.memoryId,
            'embedded',
            {
              embeddingId: record.memoryId,
              embeddingDim: dim,
              embeddingModel: fingerprint
            }
          )
        } else if (!outcome.usable) {
          this.errorRetryAt.set(agentId, Date.now())
          this.ctx.deps.repository.updatePendingEmbeddingStatus(agentId, record.memoryId, 'error')
        }
      }
      if (!outcome.usable) {
        this.vectorStore.clearReady(agentId)
      } else if (
        outcome.written.size > 0 &&
        !this.ctx.deps.repository.hasStaleEmbeddings(agentId, dim, fingerprint)
      ) {
        this.vectorStore.markReady(
          agentId,
          { providerId: embedding.providerId, modelId: embedding.modelId },
          dim
        )
      }
    } catch (error) {
      logger.error(`[Memory] vector store write failed for ${agentId}: ${String(error)}`)
      if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
      const liveRows = pending.filter((row) =>
        this.rows.isPendingEmbeddableRow(agentId, this.ctx.deps.repository.getById(row.id))
      )
      if (liveRows.length) this.errorRetryAt.set(agentId, Date.now())
      for (const row of liveRows) {
        this.ctx.deps.repository.updatePendingEmbeddingStatus(agentId, row.id, 'error')
      }
    }
  }

  reindexEmbeddings(agentId: string, force = false): Promise<void> {
    if (this.ctx.isDisposed) return Promise.resolve()
    this.vectorStore.clearReady(agentId)
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
    const requeued = this.ctx.deps.repository.requeueForEmbedding(agentId, [
      'embedded',
      'error',
      'fts_only'
    ])
    if (!requeued && !force) return
    await this.vectorStore.withAgentLock(agentId, async (locked) => {
      if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
      await locked.close()
      await this.ctx.deps.resetVectorStore(agentId)
    })
    this.clearOrphanReconcileMarks(agentId)
    if (!this.ctx.canContinueAgentMemoryTask(agentId)) return
    this.ctx.emitChanged(agentId, 'reindex')
    await this.drainUntilExhausted(agentId)
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
    if (this.ctx.deps.repository.listEmbeddingStatusIds(agentId, ['fts_only'], 1).length) {
      this.ctx.deps.repository.requeueForEmbedding(agentId, ['fts_only'])
    }
    await this.drainUntilExhausted(agentId)
  }

  private async drainUntilExhausted(agentId: string): Promise<void> {
    for (let i = 0; i < REINDEX_MAX_BATCHES; i += 1) {
      if (!this.ctx.canContinueAgentMemoryTask(agentId)) break
      const head = this.ctx.deps.repository.listPendingEmbedding(1, agentId)
      if (!head.length) break
      await this.processPendingEmbeddings(agentId, REINDEX_BATCH_SIZE)
      if (!this.ctx.canContinueAgentMemoryTask(agentId)) break
      const next = this.ctx.deps.repository.listPendingEmbedding(1, agentId)
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
    const key = this.vectorStore.warmupKey(agentId, embedding)
    const inflight = this.vectorStoreWarmups.get(key)
    if (inflight) return inflight

    const openDelay = options.delayOpen ? this.waitForBackgroundTick() : null
    const tracked = Promise.resolve()
      .then(async () => {
        await this.runWarmVectorStore(agentId, embedding, openDelay)
      })
      .catch((error) => {
        this.vectorStore.clearReady(agentId)
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
  ): Promise<void> {
    if (!this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) return
    const dimensions = await this.resolveWarmVectorDimensions(agentId, embedding)
    if (!this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) return

    const store = await this.vectorStore.withAgentLock(agentId, async (locked) => {
      if (openDelay) await openDelay
      if (!this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) return null
      return locked.open(embedding, dimensions)
    })
    if (!store) return
    if (!this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) return

    if (!store.isUsable()) {
      this.vectorStore.clearReady(agentId)
      if (!this.reindexing.has(agentId)) {
        void this.ports.reindexEmbeddings(agentId, true).catch((error) => {
          logger.warn(`[Memory] store rebuild failed for ${agentId}: ${String(error)}`)
        })
      }
      return
    }

    const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
    if (this.ctx.deps.repository.hasStaleEmbeddings(agentId, dimensions, fingerprint)) {
      this.vectorStore.clearReady(agentId)
      void this.ports.reindexEmbeddings(agentId).catch((error) => {
        logger.warn(`[Memory] reindex failed for ${agentId}: ${String(error)}`)
      })
      return
    }

    this.vectorStore.markReady(agentId, embedding, dimensions)
    this.scheduleOrphanVectorReconcile(agentId, embedding, dimensions, fingerprint)
    if (!this.reindexing.has(agentId)) {
      void this.ports.backfillEmbeddings(agentId).catch((error) => {
        logger.warn(`[Memory] backfill failed for ${agentId}: ${String(error)}`)
      })
    }
  }

  private scheduleOrphanVectorReconcile(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    fingerprint: string
  ): void {
    const key = this.vectorStore.cacheKey(agentId, embedding, dimensions)
    if (this.orphanVectorReconciled.has(key)) return
    if (Date.now() < (this.orphanVectorReconcileRetryAt.get(key) ?? 0)) return
    if (this.orphanVectorReconciles.has(key)) return

    const token = Symbol(key)
    this.orphanVectorReconcileTokens.set(key, token)
    const tracked = this.waitForBackgroundTick()
      .then(() =>
        this.reconcileOrphanVectorsOnce(agentId, embedding, dimensions, fingerprint, key, token)
      )
      .catch((error) => {
        if (this.isCurrentOrphanReconcile(key, token)) {
          this.orphanVectorReconcileRetryAt.set(
            key,
            Date.now() + ORPHAN_RECONCILE_RETRY_COOLDOWN_MS
          )
        }
        logger.warn(`[Memory] orphan vector reconcile failed for ${agentId}: ${String(error)}`)
      })
      .finally(() => {
        if (this.orphanVectorReconciles.get(key) === tracked) {
          this.orphanVectorReconciles.delete(key)
          if (this.isCurrentOrphanReconcile(key, token)) {
            this.orphanVectorReconcileTokens.delete(key)
          }
        }
      })
    this.orphanVectorReconciles.set(key, tracked)
  }

  private isCurrentOrphanReconcile(key: string, token: symbol): boolean {
    return this.orphanVectorReconcileTokens.get(key) === token
  }

  private async reconcileOrphanVectorsOnce(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    fingerprint: string,
    key: string,
    token: symbol
  ): Promise<void> {
    if (!this.isCurrentOrphanReconcile(key, token)) return
    if (this.orphanVectorReconciled.has(key)) return
    const retryAt = this.orphanVectorReconcileRetryAt.get(key) ?? 0
    if (Date.now() < retryAt) return
    try {
      const completed = await this.vectorStore.withAgentLock(agentId, async (locked) => {
        if (!this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) return false
        const store = await locked.open(embedding, dimensions)
        if (!store.isUsable()) {
          return false
        }
        let afterId: string | null = null
        for (let guard = 0; guard < REINDEX_MAX_BATCHES; guard += 1) {
          const ids = await store.listMemoryIds(afterId, ORPHAN_RECONCILE_BATCH)
          if (!ids.length) return true
          afterId = ids[ids.length - 1]
          const liveRows = this.ctx.deps.repository.listByIds(agentId, ids)
          const liveIds = new Set(liveRows.map((row) => row.id))
          const missingIds = ids.filter((id) => !liveIds.has(id))
          if (missingIds.length) {
            const prunableIds = [
              ...new Set(
                this.ctx.deps.repository.filterPrunableVectorRefs(
                  agentId,
                  missingIds,
                  dimensions,
                  fingerprint
                )
              )
            ]
            for (let start = 0; start < prunableIds.length; start += ORPHAN_RECONCILE_BATCH) {
              if (!this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) return false
              await store.deleteByMemoryIds(
                prunableIds.slice(start, start + ORPHAN_RECONCILE_BATCH)
              )
            }
          }
          if (ids.length < ORPHAN_RECONCILE_BATCH) {
            return true
          }
        }
        return false
      })
      if (!this.isCurrentOrphanReconcile(key, token)) return
      if (completed) {
        this.orphanVectorReconciled.add(key)
        this.orphanVectorReconcileRetryAt.delete(key)
      } else {
        this.orphanVectorReconcileRetryAt.set(key, Date.now() + ORPHAN_RECONCILE_RETRY_COOLDOWN_MS)
        logger.warn(
          `[Memory] orphan vector reconcile did not complete full scan for ${agentId}; retrying later`
        )
      }
    } catch (error) {
      if (this.isCurrentOrphanReconcile(key, token)) {
        this.orphanVectorReconcileRetryAt.set(key, Date.now() + ORPHAN_RECONCILE_RETRY_COOLDOWN_MS)
      }
      logger.warn(`[Memory] orphan vector reconcile failed for ${agentId}: ${String(error)}`)
    }
  }

  private clearOrphanReconcileMarks(agentId: string): void {
    for (const key of this.orphanVectorReconciled) {
      if (key.startsWith(`${agentId}::`)) this.orphanVectorReconciled.delete(key)
    }
    for (const key of this.orphanVectorReconcileRetryAt.keys()) {
      if (key.startsWith(`${agentId}::`)) this.orphanVectorReconcileRetryAt.delete(key)
    }
    for (const key of this.orphanVectorReconcileTokens.keys()) {
      if (key.startsWith(`${agentId}::`)) this.orphanVectorReconcileTokens.delete(key)
    }
  }

  private async resolveWarmVectorDimensions(
    agentId: string,
    embedding: MemoryModelRef
  ): Promise<number> {
    const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
    const storedDim = this.ctx.deps.repository.getCurrentEmbeddingDimension(agentId, fingerprint)
    const key = this.vectorStore.warmupKey(agentId, embedding)
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
      const attrs = await this.ctx.deps.getDimensions(embedding.providerId, embedding.modelId)
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
      this.vectorStoreDimensionFailures.set(key, Date.now())
      throw error
    }
  }

  warmEmbeddingConnection(agentId: string, embedding: MemoryModelRef): void {
    if (this.ctx.isDisposed || !this.ctx.canUseCurrentMemoryEmbedding(agentId, embedding)) return
    const key = this.vectorStore.warmupKey(agentId, embedding)
    if (this.embeddingWarmups.has(key)) return
    const tracked = Promise.resolve()
      .then(async () => {
        await this.ctx.deps.getEmbeddings(embedding.providerId, embedding.modelId, [
          EMBEDDING_PREWARM_TEXT
        ])
      })
      .catch((error) => {
        logger.warn(`[Memory] embedding warm failed for ${agentId}: ${String(error)}`)
      })
      .finally(() => {
        if (this.embeddingWarmups.get(key) === tracked) this.embeddingWarmups.delete(key)
      })
    this.embeddingWarmups.set(key, tracked)
  }

  getInFlight(): Promise<unknown>[] {
    return [
      ...this.reindexing.values(),
      ...this.backfilling.values(),
      ...this.embeddingDrains.values(),
      ...this.orphanVectorReconciles.values(),
      ...this.vectorStoreWarmups.values(),
      ...this.embeddingWarmups.values()
    ]
  }

  private getAgentInFlight(agentId: string): Promise<unknown>[] {
    const reindexing = this.reindexing.get(agentId)
    const backfilling = this.backfilling.get(agentId)
    const embeddingDrain = this.embeddingDrains.get(agentId)
    const orphanReconciles = this.getAgentEntries(this.orphanVectorReconciles, agentId)
    const vectorWarmups = this.getAgentEntries(this.vectorStoreWarmups, agentId)
    const embeddingWarmups = this.getAgentEntries(this.embeddingWarmups, agentId)
    return [
      reindexing,
      backfilling,
      embeddingDrain,
      ...orphanReconciles.map(([, promise]) => promise),
      ...vectorWarmups.map(([, promise]) => promise),
      ...embeddingWarmups.map(([, promise]) => promise)
    ].filter((promise): promise is Promise<unknown> => Boolean(promise))
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

    this.reindexing.delete(agentId)
    this.backfilling.delete(agentId)
    this.embeddingDrains.delete(agentId)
    this.errorRetryAt.delete(agentId)
    this.errorRetryAfterId.delete(agentId)
    this.clearOrphanReconcileMarks(agentId)
    for (const [key] of this.getAgentEntries(this.orphanVectorReconciles, agentId)) {
      this.orphanVectorReconciles.delete(key)
      this.orphanVectorReconcileTokens.delete(key)
    }
    for (const [key] of this.getAgentEntries(this.vectorStoreWarmups, agentId)) {
      this.vectorStoreWarmups.delete(key)
    }
    for (const [key] of this.getAgentEntries(this.embeddingWarmups, agentId)) {
      this.embeddingWarmups.delete(key)
    }
    for (const key of this.vectorStoreDimensionFailures.keys()) {
      if (key.startsWith(`${agentId}::`)) this.vectorStoreDimensionFailures.delete(key)
    }
  }

  clearAll(): void {
    this.embeddingWarmups.clear()
    this.vectorStoreWarmups.clear()
    this.vectorStoreDimensionFailures.clear()
    this.embeddingDrains.clear()
    this.reindexing.clear()
    this.backfilling.clear()
    this.errorRetryAt.clear()
    this.errorRetryAfterId.clear()
    this.orphanVectorReconciles.clear()
    this.orphanVectorReconcileTokens.clear()
    this.orphanVectorReconciled.clear()
    this.orphanVectorReconcileRetryAt.clear()
  }

  /** @internal Live mutable state for legacy facade-oracle tests only. */
  getMutableRuntimeStateForTests(): EmbeddingPipelineRuntimeState {
    return {
      embeddingWarmups: this.embeddingWarmups,
      vectorStoreWarmups: this.vectorStoreWarmups,
      vectorStoreDimensionFailures: this.vectorStoreDimensionFailures,
      embeddingDrains: this.embeddingDrains,
      reindexing: this.reindexing,
      backfilling: this.backfilling,
      errorRetryAt: this.errorRetryAt,
      errorRetryAfterId: this.errorRetryAfterId,
      orphanVectorReconciles: this.orphanVectorReconciles,
      orphanVectorReconciled: this.orphanVectorReconciled,
      orphanVectorReconcileRetryAt: this.orphanVectorReconcileRetryAt
    }
  }
}
