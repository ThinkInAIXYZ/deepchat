import logger from '@shared/logger'

import {
  buildMemoryProvenanceKey,
  distanceToSimilarity,
  fuse,
  resolveRetrieval
} from '../core/scoring'
import {
  buildRecallKeywordQuery,
  extractRecallKeywordCandidates,
  selectRecallKeywordTerms
} from '../core/recallKeyword'
import {
  resolveInjectionTokenBudget,
  type MemoryInjectionManifest,
  type MemoryInjectionPayload,
  type MemoryInjectionResult
} from '../core/injectionPort'
import {
  MEMORY_SEARCH_DEFAULT_LIMIT,
  RECALL_QUERY_EMBEDDING_MAX_CONCURRENT,
  RECALL_QUERY_EMBEDDING_STALE_MS,
  RECALL_QUERY_EMBEDDING_TIMEOUT_MS
} from '../runtimeConstants'
import {
  MAX_TOP_K,
  type AgentMemoryRow,
  type MemoryRecallItem,
  type MemorySearchHit
} from '../types'
import { embeddingFingerprint, type MemoryModelRef, type MemoryRuntimeContext } from '../context'
import type { VectorStoreRetrievalPort, WorkingMemoryReadPort } from '../ports'

type SoftTimeoutResult<T> = { timedOut: true } | { timedOut: false; value: T }

type QueryEmbeddingInFlight = {
  startedAt: number
  promise: Promise<number[][]>
}

function isLiveRecallVectorRow(
  agentId: string,
  row: AgentMemoryRow | undefined
): row is AgentMemoryRow {
  return (
    !!row &&
    row.agent_id === agentId &&
    !row.superseded_by &&
    row.kind !== 'persona' &&
    row.kind !== 'working' &&
    row.status !== 'archived' &&
    row.status !== 'conflicted'
  )
}

function clampRetrievalTopK(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_TOP_K, Math.max(1, Math.floor(value)))
}

async function withSoftTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<SoftTimeoutResult<T>> {
  let timeoutId: NodeJS.Timeout | undefined
  const guarded = promise.then((value) => ({ timedOut: false, value }) as SoftTimeoutResult<T>)
  guarded.catch(() => undefined)
  const timeout = new Promise<SoftTimeoutResult<T>>((resolve) => {
    timeoutId = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
  })
  try {
    return await Promise.race([guarded, timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export class RetrievalService {
  private readonly queryEmbeddingInFlight = new Map<string, Map<string, QueryEmbeddingInFlight>>()

  constructor(
    private readonly ctx: MemoryRuntimeContext,
    private readonly vectorStore: VectorStoreRetrievalPort,
    private readonly workingMemory: WorkingMemoryReadPort,
    private readonly ports: {
      warmVectorStore: (
        agentId: string,
        embedding: MemoryModelRef,
        options?: { delayOpen?: boolean }
      ) => Promise<void>
      warmEmbeddingConnection: (agentId: string, embedding: MemoryModelRef) => void
      reindexEmbeddings: (agentId: string, force?: boolean) => Promise<void>
      backfillEmbeddings: (agentId: string) => Promise<void>
      isReindexing: (agentId: string) => boolean
      deletePrunableVectorsForMemoryIds: (
        agentId: string,
        embedding: MemoryModelRef,
        dimensions: number,
        memoryIds: string[]
      ) => Promise<string[]>
    }
  ) {}

  async recall(agentId: string, query: string, now = Date.now()): Promise<MemoryRecallItem[]> {
    if (!this.ctx.canReadAgentMemory(agentId)) return []
    return this.retrieve(agentId, query, now, true, {
      keywordQuery: this.buildAgentFacingRecallKeywordQuery(agentId, query),
      keywordMatchMode: 'any'
    })
  }

  async retrieveForDecision(
    agentId: string,
    query: string,
    now: number
  ): Promise<MemoryRecallItem[]> {
    return this.retrieve(agentId, query, now, false, {
      keywordQuery: this.buildAgentFacingRecallKeywordQuery(agentId, query),
      keywordMatchMode: 'any',
      enableInlinePrune: false
    })
  }

  private buildAgentFacingRecallKeywordQuery(agentId: string, query: string): string {
    const candidates = extractRecallKeywordCandidates(query)
    if (!candidates.length) return ''
    const stats = this.ctx.deps.repository.getRecallKeywordTermStats(
      agentId,
      candidates.map((candidate) => candidate.term)
    )
    return buildRecallKeywordQuery(selectRecallKeywordTerms(candidates, stats))
  }

  private startQueryEmbedding(
    agentId: string,
    embedding: MemoryModelRef,
    query: string
  ): Promise<number[][]> | null {
    const key = `${agentId}::${embeddingFingerprint(embedding.providerId, embedding.modelId)}`
    const now = Date.now()
    let group = this.queryEmbeddingInFlight.get(key)
    if (!group) {
      group = new Map()
      this.queryEmbeddingInFlight.set(key, group)
    }
    let replacedStale = false
    for (const [trackedQuery, entry] of group) {
      if (now - entry.startedAt >= RECALL_QUERY_EMBEDDING_STALE_MS) {
        group.delete(trackedQuery)
        replacedStale = true
      }
    }
    if (replacedStale) logger.warn(`[Memory] stale query embedding replaced for ${agentId}`)

    const existing = group.get(query)
    if (existing) return existing.promise
    if (group.size >= RECALL_QUERY_EMBEDDING_MAX_CONCURRENT) return null

    const promise = this.ctx.deps.getEmbeddings(embedding.providerId, embedding.modelId, [query])
    const entry: QueryEmbeddingInFlight = { startedAt: now, promise }
    group.set(query, entry)
    promise
      .finally(() => {
        const currentGroup = this.queryEmbeddingInFlight.get(key)
        if (currentGroup?.get(query) === entry) {
          currentGroup.delete(query)
          if (currentGroup.size === 0) this.queryEmbeddingInFlight.delete(key)
        }
      })
      .catch(() => undefined)
    return promise
  }

  async searchMemories(
    agentId: string,
    query: string,
    options: { limit?: number } = {}
  ): Promise<MemorySearchHit[]> {
    if (!this.ctx.canReadAgentMemory(agentId)) return []
    const limit =
      options.limit != null
        ? Math.min(MAX_TOP_K, Math.max(0, Math.floor(options.limit)))
        : MEMORY_SEARCH_DEFAULT_LIMIT
    if (limit === 0) return []
    const hits = await this.retrieve(agentId, query, Date.now(), false, {
      topKOverride: limit,
      enableInlinePrune: false
    })
    const limited = hits.slice(0, limit)
    const results: MemorySearchHit[] = []
    for (const hit of limited) {
      const row = this.ctx.deps.repository.getById(hit.id)
      if (row)
        results.push({ row, score: hit.score, sources: hit.sources, similarity: hit.similarity })
    }
    return results
  }

  async retrieve(
    agentId: string,
    query: string,
    now: number,
    recordAccessHits: boolean,
    options: {
      trace?: boolean
      keywordQuery?: string
      keywordMatchMode?: 'all' | 'any'
      topKOverride?: number
      enableInlinePrune?: boolean
    } = {}
  ): Promise<MemoryRecallItem[]> {
    if (!this.ctx.canReadAgentMemory(agentId)) return []
    const config = this.ctx.deps.resolveAgentConfig(agentId)
    const { topK, rrfK, similarityThreshold, weights } = resolveRetrieval(config?.memoryRetrieval)
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []
    const normalizedKeywordQuery = (options.keywordQuery ?? normalizedQuery).trim()

    const effectiveTopK =
      options.topKOverride !== undefined ? clampRetrievalTopK(options.topKOverride) : topK
    const candidateLimit = effectiveTopK * 2
    const ftsRows = normalizedKeywordQuery
      ? this.ctx.deps.repository
          .search(agentId, normalizedKeywordQuery, candidateLimit, {
            matchMode: options.keywordMatchMode ?? 'all'
          })
          .filter((row) => row.kind !== 'persona' && row.kind !== 'working')
      : []

    const vecMatches: { row: AgentMemoryRow; similarity: number }[] = []
    const embedding = config?.memoryEmbedding
    if (embedding?.providerId && embedding?.modelId) {
      const currentEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
      if (!this.vectorStore.isWarm(agentId, currentEmbedding)) {
        void this.ports
          .warmVectorStore(agentId, currentEmbedding, { delayOpen: true })
          .catch((error) => {
            logger.warn(`[Memory] vector warmup failed for ${agentId}: ${String(error)}`)
          })
        this.ports.warmEmbeddingConnection(agentId, currentEmbedding)
      } else {
        try {
          const queryEmbedding = this.startQueryEmbedding(
            agentId,
            currentEmbedding,
            normalizedQuery
          )
          if (!queryEmbedding) {
            logger.warn(
              `[Memory] query embedding already in flight for ${agentId}; vector recall skipped this turn`
            )
          } else {
            const vectorsResult = await withSoftTimeout(
              queryEmbedding,
              RECALL_QUERY_EMBEDDING_TIMEOUT_MS
            )
            if (vectorsResult.timedOut) {
              logger.warn(
                `[Memory] query embedding timed out for ${agentId}; vector recall skipped this turn`
              )
            } else {
              const vectors = vectorsResult.value
              if (!this.ctx.canReadAgentMemory(agentId)) return []
              const vector = vectors[0]
              if (vector?.length) {
                const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
                if (
                  this.ctx.deps.repository.hasStaleEmbeddings(agentId, vector.length, fingerprint)
                ) {
                  this.vectorStore.clearReady(agentId)
                  if (this.ctx.canReadAgentMemory(agentId)) {
                    void this.ports.reindexEmbeddings(agentId).catch((error) => {
                      logger.warn(`[Memory] reindex failed for ${agentId}: ${String(error)}`)
                    })
                  }
                } else {
                  const store = await this.vectorStore.getVectorStore(
                    agentId,
                    currentEmbedding,
                    vector.length
                  )
                  if (!this.ctx.canReadAgentMemory(agentId)) return []
                  if (store.isUsable()) {
                    this.vectorStore.markReady(agentId, currentEmbedding, vector.length)
                    const matches = await store.query(vector, { topK: candidateLimit })
                    if (!this.ctx.canReadAgentMemory(agentId)) return []
                    const deadVectorIds: string[] = []
                    for (const match of matches) {
                      const similarity = distanceToSimilarity(match.distance)
                      if (similarity < similarityThreshold) continue
                      const row = this.ctx.deps.repository.getById(match.memoryId)
                      if (!isLiveRecallVectorRow(agentId, row)) {
                        deadVectorIds.push(match.memoryId)
                        continue
                      }
                      vecMatches.push({ row, similarity })
                    }
                    if (
                      options.enableInlinePrune !== false &&
                      deadVectorIds.length &&
                      this.ctx.canReadAgentMemory(agentId)
                    ) {
                      void this.ports
                        .deletePrunableVectorsForMemoryIds(
                          agentId,
                          currentEmbedding,
                          vector.length,
                          [...new Set(deadVectorIds)]
                        )
                        .catch((error) => {
                          logger.warn(`[Memory] inline vector prune failed: ${String(error)}`)
                        })
                    }
                    if (this.ctx.canReadAgentMemory(agentId) && !this.ports.isReindexing(agentId)) {
                      void this.ports.backfillEmbeddings(agentId).catch((error) => {
                        logger.warn(`[Memory] backfill failed for ${agentId}: ${String(error)}`)
                      })
                    }
                  } else if (
                    this.ctx.canReadAgentMemory(agentId) &&
                    !this.ports.isReindexing(agentId)
                  ) {
                    this.vectorStore.clearReady(agentId)
                    void this.ports.reindexEmbeddings(agentId, true).catch((error) => {
                      logger.warn(`[Memory] store rebuild failed for ${agentId}: ${String(error)}`)
                    })
                  }
                }
              }
            }
          }
        } catch (error) {
          this.vectorStore.clearReady(agentId)
          logger.warn(`[Memory] vector recall degraded to FTS for ${agentId}: ${String(error)}`)
        }
      }
    }

    const results = fuse(ftsRows, vecMatches, {
      topK: effectiveTopK,
      rrfK,
      weights,
      now,
      trace: options.trace
    })
    if (recordAccessHits && this.ctx.canReadAgentMemory(agentId)) {
      this.ctx.deps.repository.recordAccessBatch(
        results.map((item) => item.id),
        now
      )
    }
    return results
  }

  async buildInjection(agentId: string, query: string): Promise<MemoryInjectionResult | null> {
    if (!this.ctx.canReadAgentMemory(agentId)) return null
    const config = this.ctx.deps.resolveAgentConfig(agentId)
    const persona = this.ctx.deps.repository.getActivePersona(agentId)
    const working = this.workingMemory.readWorkingMemory(agentId)
    if (!working) this.workingMemory.scheduleWorkingRefresh(agentId)
    const recalled = query.trim()
      ? await this.retrieve(agentId, query, Date.now(), true, {
          keywordQuery: this.buildAgentFacingRecallKeywordQuery(agentId, query),
          keywordMatchMode: 'any'
        })
      : []
    if (!persona && !working && recalled.length === 0) return null
    const tokenBudget = resolveInjectionTokenBudget(config?.memoryInjectionTokenBudget)
    const payload: MemoryInjectionPayload = {
      selfModel: persona?.content ?? null,
      working,
      memories: recalled.map((item) => ({
        id: item.id,
        kind: item.kind,
        content: item.content,
        score: item.score,
        sources: item.sources,
        similarity: item.similarity,
        breakdown: item.breakdown
      })),
      tokenBudget
    }
    const manifest: MemoryInjectionManifest = {
      policyVersion: 1,
      selected: [],
      dropped: [],
      tokenBudget,
      estimatedTokens: 0,
      queryHash: query.trim() ? buildMemoryProvenanceKey(agentId, 'query', query.trim()) : undefined
    }
    return { ...payload, payload, manifest }
  }

  cleanupAgent(agentId: string): void {
    for (const key of this.queryEmbeddingInFlight.keys()) {
      if (key.startsWith(`${agentId}::`)) this.queryEmbeddingInFlight.delete(key)
    }
  }

  clearAll(): void {
    this.queryEmbeddingInFlight.clear()
  }
}
