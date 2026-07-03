import logger from '@shared/logger'

import {
  EMBEDDING_PREWARM_TEXT,
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
}

export class EmbeddingPipeline {
  private readonly embeddingWarmups = new Map<string, Promise<void>>()
  private readonly vectorStoreWarmups = new Map<string, Promise<void>>()
  private readonly vectorStoreDimensionFailures = new Map<string, number>()
  private readonly embeddingDrains = new Map<string, Promise<unknown>>()
  private readonly reindexing = new Map<string, Promise<void>>()
  private readonly backfilling = new Map<string, Promise<void>>()

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
    const pending = this.ctx.deps.repository.listPendingEmbedding(limit, agentId)
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
    this.ctx.deps.repository.requeueForEmbedding(agentId, ['fts_only'])
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
    if (!this.reindexing.has(agentId)) {
      void this.ports.backfillEmbeddings(agentId).catch((error) => {
        logger.warn(`[Memory] backfill failed for ${agentId}: ${String(error)}`)
      })
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
      ...this.vectorStoreWarmups.values(),
      ...this.embeddingWarmups.values()
    ]
  }

  private getAgentInFlight(agentId: string): Promise<unknown>[] {
    const reindexing = this.reindexing.get(agentId)
    const backfilling = this.backfilling.get(agentId)
    const embeddingDrain = this.embeddingDrains.get(agentId)
    const vectorWarmups = this.getAgentEntries(this.vectorStoreWarmups, agentId)
    const embeddingWarmups = this.getAgentEntries(this.embeddingWarmups, agentId)
    return [
      reindexing,
      backfilling,
      embeddingDrain,
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
  }

  /** @internal Live mutable state for legacy facade-oracle tests only. */
  getMutableRuntimeStateForTests(): EmbeddingPipelineRuntimeState {
    return {
      embeddingWarmups: this.embeddingWarmups,
      vectorStoreWarmups: this.vectorStoreWarmups,
      vectorStoreDimensionFailures: this.vectorStoreDimensionFailures,
      embeddingDrains: this.embeddingDrains,
      reindexing: this.reindexing,
      backfilling: this.backfilling
    }
  }
}
