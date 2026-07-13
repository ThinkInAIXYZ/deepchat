import logger from '@shared/logger'
import type {
  MemoryRecallLatencyStage,
  MemoryRetrievalDegradationCause,
  MemoryRetrievalOutcome,
  MemoryRetrievalPurpose
} from '@shared/types/agent-memory'

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
  DECISION_NEIGHBOR_TOP_S,
  MEMORY_SEARCH_DEFAULT_LIMIT,
  RECALL_QUERY_EMBEDDING_MAX_CONCURRENT,
  RECALL_QUERY_EMBEDDING_STALE_MS,
  RECALL_QUERY_EMBEDDING_TIMEOUT_MS
} from '../runtimeConstants'
import {
  MAX_TOP_K,
  type AgentMemoryRow,
  type MemoryDecisionNeighborSet,
  type MemoryDecisionQueryVectorSnapshot,
  type MemoryRecallItem,
  type MemorySearchHit,
  type NormalizedMemoryCandidate
} from '../types'
import { embeddingFingerprint, type MemoryModelRef, type MemoryRuntimeContext } from '../context'
import type {
  MemoryAccessRepositoryPort,
  MemoryAgentPolicyPort,
  MemoryEmbeddingGatewayPort,
  MemoryReadRepositoryPort,
  VectorStoreRetrievalPort,
  WorkingMemoryReadPort
} from '../ports'

type SoftTimeoutResult<T> = { timedOut: true } | { timedOut: false; value: T }

type QueryEmbeddingInFlight = {
  startedAt: number
  promise: Promise<number[][]>
}

function isLiveRecallRow(agentId: string, row: AgentMemoryRow | undefined): row is AgentMemoryRow {
  return (
    !!row &&
    row.agent_id === agentId &&
    !row.superseded_by &&
    row.kind !== 'persona' &&
    row.kind !== 'working' &&
    row.lifecycle_state === 'active'
  )
}

function isLiveDecisionRow(
  agentId: string,
  row: AgentMemoryRow | undefined
): row is AgentMemoryRow {
  return isLiveRecallRow(agentId, row) && row.conflict_state === null && row.conflict_with === null
}

function isCurrentRecallVectorRow(
  agentId: string,
  row: AgentMemoryRow | undefined,
  dimensions: number,
  fingerprint: string
): row is AgentMemoryRow {
  return (
    isLiveRecallRow(agentId, row) &&
    row.lifecycle_state === 'active' &&
    row.embedding_state === 'ready' &&
    row.embedding_dim === dimensions &&
    row.embedding_model === fingerprint
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
  private readonly ctx: MemoryRuntimeContext
  private readonly queryEmbeddingInFlight = new Map<string, Map<string, QueryEmbeddingInFlight>>()

  constructor(
    private readonly ports: {
      ctx: MemoryRuntimeContext
      repository: MemoryReadRepositoryPort & MemoryAccessRepositoryPort
      policy: MemoryAgentPolicyPort
      embeddingGateway: MemoryEmbeddingGatewayPort
      vectorStore: VectorStoreRetrievalPort
      workingMemory: WorkingMemoryReadPort
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
      diagnostics?: {
        recordRecall(
          agentId: string,
          sample: {
            latencyMs: Partial<Record<MemoryRecallLatencyStage, number>>
            ftsCandidates: number
            vectorCandidates: number
            selected: number
            purpose: MemoryRetrievalPurpose
            outcome: MemoryRetrievalOutcome
            degradations: readonly MemoryRetrievalDegradationCause[]
          }
        ): void
      }
    }
  ) {
    this.ctx = ports.ctx
  }

  async recall(agentId: string, query: string, now = Date.now()): Promise<MemoryRecallItem[]> {
    return this.retrieve(agentId, query, now, true, {
      purpose: 'recall',
      keywordQuery: this.buildAgentFacingRecallKeywordQuery(query),
      keywordMatchMode: 'any'
    })
  }

  async retrieveForDecision(
    agentId: string,
    query: string,
    now: number
  ): Promise<MemoryRecallItem[]> {
    return this.retrieve(agentId, query, now, false, {
      purpose: 'decision',
      keywordQuery: this.buildAgentFacingRecallKeywordQuery(query),
      keywordMatchMode: 'any',
      enableInlinePrune: false,
      excludeConflictParticipants: true
    })
  }

  async retrieveForDecisions(
    agentId: string,
    candidates: readonly NormalizedMemoryCandidate[],
    now: number,
    queryVectors?: readonly (MemoryDecisionQueryVectorSnapshot | undefined)[],
    pinnedIdsByCandidate?: readonly (readonly string[] | undefined)[]
  ): Promise<MemoryDecisionNeighborSet[]> {
    const totalStartedAt = performance.now()
    const latencyMs: Partial<Record<MemoryRecallLatencyStage, number>> = {}
    const degradations = new Set<MemoryRetrievalDegradationCause>()
    let outcome: MemoryRetrievalOutcome = 'failed'
    let ftsCandidates = 0
    let vectorCandidates = 0
    let selected = 0
    let activeStage: MemoryRecallLatencyStage | 'idle' = 'idle'
    try {
      if (!candidates.length) {
        outcome = 'completed'
        return []
      }
      if (!this.ctx.canReadAgentMemory(agentId)) {
        outcome = 'disabled'
        return candidates.map(() => ({ neighbors: [] }))
      }

      const config = this.ports.policy.resolveAgentConfig(agentId)
      const { rrfK, similarityThreshold, weights } = resolveRetrieval(config?.memoryRetrieval)
      const candidateLimit = DECISION_NEIGHBOR_TOP_S * 2
      const keywordStartedAt = performance.now()
      activeStage = 'keyword'
      const keywordSearches = candidates.map((candidate) => {
        const keywordQuery = this.buildAgentFacingRecallKeywordQuery(candidate.content)
        return keywordQuery
          ? this.ports.repository.searchWithStrategy(agentId, keywordQuery, candidateLimit, {
              matchMode: 'any'
            })
          : null
      })
      const keywordRows = keywordSearches.map((search) => search?.rows ?? [])
      if (keywordSearches.some((search) => search?.strategy === 'like-fallback')) {
        degradations.add('ftsUnavailable')
      }
      latencyMs.keyword = performance.now() - keywordStartedAt

      const embedding = config?.memoryEmbedding
      const currentEmbedding =
        embedding?.providerId && embedding?.modelId
          ? { providerId: embedding.providerId, modelId: embedding.modelId }
          : null
      const vectors: Array<number[] | undefined> = candidates.map((_, index) => {
        const snapshot = queryVectors?.[index]
        return snapshot &&
          currentEmbedding &&
          snapshot.providerId === currentEmbedding.providerId &&
          snapshot.modelId === currentEmbedding.modelId &&
          snapshot.dimensions === snapshot.vector.length
          ? Array.from(snapshot.vector)
          : undefined
      })
      // A supplied vector array is a retry snapshot. Undefined slots stay FTS-only so contention
      // never performs a second embedding provider call after the first attempt failed or omitted one.
      if (currentEmbedding && queryVectors === undefined) {
        const missingIndexes = vectors
          .map((vector, index) => (vector ? -1 : index))
          .filter((index) => index >= 0)
        if (missingIndexes.length) {
          try {
            const embeddingStartedAt = performance.now()
            activeStage = 'queryEmbedding'
            const embedded = await this.ports.embeddingGateway.getEmbeddings(
              agentId,
              currentEmbedding.providerId,
              currentEmbedding.modelId,
              missingIndexes.map((index) => candidates[index].content),
              'query-embedding'
            )
            missingIndexes.forEach((candidateIndex, embeddedIndex) => {
              const vector = embedded[embeddedIndex]
              if (vector?.length) vectors[candidateIndex] = vector
            })
            latencyMs.queryEmbedding = performance.now() - embeddingStartedAt
          } catch (error) {
            degradations.add('embeddingError')
            logger.warn(`[Memory] batch query embedding failed for ${agentId}: ${String(error)}`)
          }
        }
      }

      const vectorMatches: Array<Array<{ memoryId: string; similarity: number }>> = candidates.map(
        () => []
      )
      let vectorContext: { embedding: MemoryModelRef; dimensions: number } | null = null
      if (currentEmbedding && this.ctx.canUseCurrentMemoryEmbedding(agentId, currentEmbedding)) {
        if (!this.ports.vectorStore.hasReadyCertificate(agentId, currentEmbedding)) {
          degradations.add('vectorCold')
          void this.ports
            .warmVectorStore(agentId, currentEmbedding, { delayOpen: true })
            .catch((error) => {
              logger.warn(`[Memory] vector warmup failed for ${agentId}: ${String(error)}`)
            })
          this.ports.warmEmbeddingConnection(agentId, currentEmbedding)
        } else {
          const dimensions = vectors.find((vector) => vector?.length)?.length ?? 0
          const queryIndexes = vectors
            .map((vector, index) => (vector?.length === dimensions ? index : -1))
            .filter((index) => index >= 0)
          if (dimensions > 0 && queryIndexes.length > 0) {
            try {
              const vectorStartedAt = performance.now()
              activeStage = 'vector'
              const matches = await this.ports.vectorStore.queryBatch(
                agentId,
                currentEmbedding,
                dimensions,
                queryIndexes.map((index) => vectors[index] as number[]),
                candidateLimit
              )
              latencyMs.vector = performance.now() - vectorStartedAt
              if (
                this.ctx.canUseCurrentMemoryEmbedding(agentId, currentEmbedding) &&
                this.ports.vectorStore.hasReadyCertificate(agentId, currentEmbedding)
              ) {
                vectorContext = { embedding: currentEmbedding, dimensions }
                queryIndexes.forEach((candidateIndex, resultIndex) => {
                  vectorMatches[candidateIndex] = (matches[resultIndex] ?? [])
                    .map((match) => ({
                      memoryId: match.memoryId,
                      similarity: distanceToSimilarity(match.distance)
                    }))
                    .filter((match) => match.similarity >= similarityThreshold)
                })
              }
            } catch (error) {
              const errorName = (error as { name?: string } | null)?.name
              if (errorName !== 'AbortError' && errorName !== 'VectorStoreLeaseUnavailableError') {
                this.ports.vectorStore.clearReady(agentId)
              }
              degradations.add(
                errorName === 'VectorStoreLeaseUnavailableError' ? 'storeUnusable' : 'storeError'
              )
              logger.warn(`[Memory] batch vector recall degraded to FTS: ${String(error)}`)
            }
          }
        }
      }

      if (!this.ctx.canReadAgentMemory(agentId)) {
        outcome = 'cancelled'
        return candidates.map(() => ({ neighbors: [] }))
      }
      const candidateIds = new Set<string>()
      keywordRows.forEach((rows) => rows.forEach((row) => candidateIds.add(row.id)))
      vectorMatches.forEach((matches) =>
        matches.forEach((match) => candidateIds.add(match.memoryId))
      )
      pinnedIdsByCandidate?.forEach((ids) => ids?.forEach((id) => candidateIds.add(id)))
      const revalidationStartedAt = performance.now()
      activeStage = 'authoritativeRevalidation'
      const authoritativeRows = candidateIds.size
        ? this.ports.repository.listByIds(agentId, [...candidateIds])
        : []
      latencyMs.authoritativeRevalidation = performance.now() - revalidationStartedAt
      const rowsById = new Map(authoritativeRows.map((row) => [row.id, row]))
      const vectorFingerprint = vectorContext
        ? embeddingFingerprint(vectorContext.embedding.providerId, vectorContext.embedding.modelId)
        : null

      const assemblyStartedAt = performance.now()
      activeStage = 'assembly'
      const results = candidates.map((_, index) => {
        const ftsRows = keywordRows[index]
          .map((row) => rowsById.get(row.id))
          .filter((row): row is AgentMemoryRow => isLiveDecisionRow(agentId, row))
        const currentVectorMatches = vectorMatches[index]
          .map((match) => {
            const row = rowsById.get(match.memoryId)
            return vectorContext && vectorFingerprint
              ? isCurrentRecallVectorRow(
                  agentId,
                  row,
                  vectorContext.dimensions,
                  vectorFingerprint
                ) && isLiveDecisionRow(agentId, row)
                ? { row, similarity: match.similarity }
                : null
              : null
          })
          .filter((match): match is { row: AgentMemoryRow; similarity: number } => match !== null)
        const neighbors = fuse(ftsRows, currentVectorMatches, {
          topK: DECISION_NEIGHBOR_TOP_S,
          rrfK,
          weights,
          now
        })
        ftsCandidates += ftsRows.length
        vectorCandidates += currentVectorMatches.length
        const pinnedRows = (pinnedIdsByCandidate?.[index] ?? [])
          .map((id) => rowsById.get(id))
          .filter((row): row is AgentMemoryRow => isLiveDecisionRow(agentId, row))
        for (const pinned of pinnedRows.reverse()) {
          if (!neighbors.some((neighbor) => neighbor.id === pinned.id)) {
            neighbors.unshift({
              id: pinned.id,
              decisionRevision: pinned.decision_revision,
              kind: pinned.kind,
              content: pinned.content,
              score: 1,
              importance: pinned.importance,
              sources: { fts: true },
              sourceSession: pinned.source_session,
              sourceEntryIds: null,
              breakdown: {
                similarity: 0,
                recency: pinned.last_accessed ?? pinned.created_at,
                importance: pinned.importance,
                confidence: pinned.confidence ?? 0,
                rrf: 1,
                final: 1
              }
            })
          }
        }
        neighbors.splice(DECISION_NEIGHBOR_TOP_S)
        const vector = vectors[index]
        const queryVector =
          vector &&
          currentEmbedding &&
          this.ctx.canUseCurrentMemoryEmbedding(agentId, currentEmbedding)
            ? {
                vector,
                providerId: currentEmbedding.providerId,
                modelId: currentEmbedding.modelId,
                dimensions: vector.length
              }
            : undefined
        return { neighbors, queryVector }
      })
      selected = results.reduce((total, result) => total + result.neighbors.length, 0)
      latencyMs.assembly = performance.now() - assemblyStartedAt
      outcome = 'completed'
      return results
    } catch (error) {
      if (!this.ctx.canReadAgentMemory(agentId)) outcome = 'cancelled'
      else {
        outcome = 'failed'
        degradations.add(
          activeStage === 'keyword' || activeStage === 'authoritativeRevalidation'
            ? 'storeError'
            : 'unknown'
        )
      }
      throw error
    } finally {
      latencyMs.total = performance.now() - totalStartedAt
      this.ports.diagnostics?.recordRecall(agentId, {
        purpose: 'decision',
        latencyMs,
        ftsCandidates,
        vectorCandidates,
        selected,
        outcome,
        degradations: [...degradations]
      })
    }
  }

  private buildAgentFacingRecallKeywordQuery(query: string): string {
    const candidates = extractRecallKeywordCandidates(query)
    if (!candidates.length) return ''
    return buildRecallKeywordQuery(selectRecallKeywordTerms(candidates))
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

    const promise = this.ports.embeddingGateway.getEmbeddings(
      agentId,
      embedding.providerId,
      embedding.modelId,
      [query],
      'query-embedding'
    )
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
    const limit =
      options.limit != null
        ? Math.min(MAX_TOP_K, Math.max(0, Math.floor(options.limit)))
        : MEMORY_SEARCH_DEFAULT_LIMIT
    if (limit === 0) return []
    const hits = await this.retrieve(agentId, query, Date.now(), false, {
      purpose: 'search',
      topKOverride: limit,
      enableInlinePrune: false
    })
    const limited = hits.slice(0, limit)
    const results: MemorySearchHit[] = []
    for (const hit of limited) {
      const row = this.ports.repository.getById(hit.id)
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
      purpose: MemoryRetrievalPurpose
      trace?: boolean
      keywordQuery?: string
      keywordMatchMode?: 'all' | 'any'
      topKOverride?: number
      enableInlinePrune?: boolean
      excludeConflictParticipants?: boolean
    }
  ): Promise<MemoryRecallItem[]> {
    const totalStartedAt = performance.now()
    const latencyMs: Partial<Record<MemoryRecallLatencyStage, number>> = {}
    const degradations = new Set<MemoryRetrievalDegradationCause>()
    let outcome: MemoryRetrievalOutcome = 'failed'
    let ftsCandidates = 0
    let vectorCandidates = 0
    let selected = 0
    let activeStage: MemoryRecallLatencyStage | 'idle' = 'idle'
    try {
      if (!this.ctx.canReadAgentMemory(agentId)) {
        outcome = 'disabled'
        return []
      }
      const config = this.ports.policy.resolveAgentConfig(agentId)
      const { topK, rrfK, similarityThreshold, weights } = resolveRetrieval(config?.memoryRetrieval)
      const normalizedQuery = query.trim()
      if (!normalizedQuery) {
        outcome = 'emptyQuery'
        return []
      }
      const normalizedKeywordQuery = (options.keywordQuery ?? normalizedQuery).trim()

      const effectiveTopK =
        options.topKOverride !== undefined ? clampRetrievalTopK(options.topKOverride) : topK
      const candidateLimit = effectiveTopK * 2
      const keywordStartedAt = performance.now()
      activeStage = 'keyword'
      const keywordSearch = normalizedKeywordQuery
        ? this.ports.repository.searchWithStrategy(
            agentId,
            normalizedKeywordQuery,
            candidateLimit,
            {
              matchMode: options.keywordMatchMode ?? 'all'
            }
          )
        : null
      const ftsRows = (keywordSearch?.rows ?? []).filter(
        (row) => row.kind !== 'persona' && row.kind !== 'working'
      )
      if (keywordSearch?.strategy === 'like-fallback') degradations.add('ftsUnavailable')
      latencyMs.keyword = performance.now() - keywordStartedAt

      const vecCandidates: { memoryId: string; similarity: number }[] = []
      let vectorContext: { embedding: MemoryModelRef; dimensions: number } | null = null
      const embedding = config?.memoryEmbedding
      if (embedding?.providerId && embedding?.modelId) {
        const currentEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
        if (!this.ports.vectorStore.hasReadyCertificate(agentId, currentEmbedding)) {
          degradations.add('vectorCold')
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
              const embeddingStartedAt = performance.now()
              activeStage = 'queryEmbedding'
              const vectorsResult = await withSoftTimeout(
                queryEmbedding,
                RECALL_QUERY_EMBEDDING_TIMEOUT_MS
              )
              latencyMs.queryEmbedding = performance.now() - embeddingStartedAt
              if (vectorsResult.timedOut) {
                degradations.add('embeddingTimeout')
                logger.warn(
                  `[Memory] query embedding timed out for ${agentId}; vector recall skipped this turn`
                )
              } else {
                const vectors = vectorsResult.value
                if (!this.ctx.canReadAgentMemory(agentId)) {
                  outcome = 'cancelled'
                  return []
                }
                const vector = vectors[0]
                if (vector?.length) {
                  if (!this.ctx.canReadAgentMemory(agentId)) {
                    outcome = 'cancelled'
                    return []
                  }
                  const vectorStartedAt = performance.now()
                  activeStage = 'vector'
                  const matches = await this.ports.vectorStore.query(
                    agentId,
                    currentEmbedding,
                    vector.length,
                    vector,
                    candidateLimit
                  )
                  latencyMs.vector = performance.now() - vectorStartedAt
                  if (!this.ctx.canReadAgentMemory(agentId)) {
                    outcome = 'cancelled'
                    return []
                  }
                  if (
                    this.ports.vectorStore.hasReadyCertificate(agentId, currentEmbedding) &&
                    this.ctx.canUseCurrentMemoryEmbedding(agentId, currentEmbedding)
                  ) {
                    if (!this.ctx.canReadAgentMemory(agentId)) {
                      outcome = 'cancelled'
                      return []
                    }
                    vectorContext = { embedding: currentEmbedding, dimensions: vector.length }
                    for (const match of matches) {
                      const similarity = distanceToSimilarity(match.distance)
                      if (similarity < similarityThreshold) continue
                      vecCandidates.push({ memoryId: match.memoryId, similarity })
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
                    degradations.add('revisionChanged')
                    void this.ports.reindexEmbeddings(agentId, true).catch((error) => {
                      logger.warn(`[Memory] store rebuild failed for ${agentId}: ${String(error)}`)
                    })
                  }
                }
              }
            }
          } catch (error) {
            if (!this.ctx.canReadAgentMemory(agentId)) {
              outcome = 'cancelled'
              return []
            }
            const errorName = (error as { name?: string } | null)?.name
            if (errorName !== 'AbortError' && errorName !== 'VectorStoreLeaseUnavailableError') {
              this.ports.vectorStore.clearReady(agentId)
            }
            degradations.add(
              errorName === 'VectorStoreLeaseUnavailableError'
                ? 'storeUnusable'
                : activeStage === 'queryEmbedding'
                  ? 'embeddingError'
                  : 'storeError'
            )
            logger.warn(`[Memory] vector recall degraded to FTS for ${agentId}: ${String(error)}`)
          }
        }
      }

      const candidateIds = [
        ...ftsRows.map((row) => row.id),
        ...vecCandidates.map((candidate) => candidate.memoryId)
      ]
      const revalidationStartedAt = performance.now()
      activeStage = 'authoritativeRevalidation'
      const authoritativeRows = candidateIds.length
        ? this.ports.repository.listByIds(agentId, [...new Set(candidateIds)])
        : []
      latencyMs.authoritativeRevalidation = performance.now() - revalidationStartedAt
      const rowsById = new Map(authoritativeRows.map((row) => [row.id, row]))
      const isEligibleRow = options.excludeConflictParticipants
        ? isLiveDecisionRow
        : isLiveRecallRow
      const authoritativeFtsRows = ftsRows
        .map((row) => rowsById.get(row.id))
        .filter((row): row is AgentMemoryRow => isEligibleRow(agentId, row))
      const vectorFingerprint = vectorContext
        ? embeddingFingerprint(vectorContext.embedding.providerId, vectorContext.embedding.modelId)
        : null
      const authoritativeVecMatches = vecCandidates
        .map((candidate) => {
          const row = rowsById.get(candidate.memoryId)
          return vectorContext && vectorFingerprint
            ? isCurrentRecallVectorRow(agentId, row, vectorContext.dimensions, vectorFingerprint) &&
              isEligibleRow(agentId, row)
              ? { row, similarity: candidate.similarity }
              : null
            : null
        })
        .filter((match): match is { row: AgentMemoryRow; similarity: number } => match !== null)
      ftsCandidates = authoritativeFtsRows.length
      vectorCandidates = authoritativeVecMatches.length

      if (
        options.enableInlinePrune !== false &&
        vectorContext &&
        this.ctx.canReadAgentMemory(agentId)
      ) {
        const liveVectorIds = new Set(authoritativeVecMatches.map((match) => match.row.id))
        const deadVectorIds = [
          ...new Set(
            vecCandidates
              .map((candidate) => candidate.memoryId)
              .filter((memoryId) => !liveVectorIds.has(memoryId))
          )
        ]
        if (deadVectorIds.length > 0) {
          void this.ports
            .deletePrunableVectorsForMemoryIds(
              agentId,
              vectorContext.embedding,
              vectorContext.dimensions,
              deadVectorIds
            )
            .catch((error) => {
              logger.warn(`[Memory] inline vector prune failed: ${String(error)}`)
            })
        }
      }

      const assemblyStartedAt = performance.now()
      activeStage = 'assembly'
      const results = fuse(authoritativeFtsRows, authoritativeVecMatches, {
        topK: effectiveTopK,
        rrfK,
        weights,
        now,
        trace: options.trace
      })
      latencyMs.assembly = performance.now() - assemblyStartedAt
      selected = results.length
      if (recordAccessHits && this.ctx.canReadAgentMemory(agentId)) {
        this.ports.repository.recordAccessBatch(
          results.map((item) => item.id),
          now
        )
      }
      outcome = 'completed'
      return results
    } catch (error) {
      if (!this.ctx.canReadAgentMemory(agentId)) outcome = 'cancelled'
      else {
        outcome = 'failed'
        degradations.add(
          activeStage === 'keyword' || activeStage === 'authoritativeRevalidation'
            ? 'storeError'
            : 'unknown'
        )
      }
      throw error
    } finally {
      latencyMs.total = performance.now() - totalStartedAt
      this.ports.diagnostics?.recordRecall(agentId, {
        purpose: options.purpose,
        latencyMs,
        ftsCandidates,
        vectorCandidates,
        selected,
        outcome,
        degradations: [...degradations]
      })
    }
  }

  async buildInjection(agentId: string, query: string): Promise<MemoryInjectionResult | null> {
    const readEpoch = this.ctx.captureReadEpoch(agentId)
    const config = this.ports.policy.resolveAgentConfig(agentId)
    const recalled = await this.retrieve(agentId, query, Date.now(), false, {
      purpose: 'injection',
      keywordQuery: this.buildAgentFacingRecallKeywordQuery(query),
      keywordMatchMode: 'any'
    })
    if (!this.ctx.canReadAgentMemory(agentId) || !this.ctx.isReadEpochCurrent(agentId, readEpoch)) {
      return null
    }
    this.ports.workingMemory.flushWorkingMemoryIfDirty(agentId)
    const finalizedEpoch = this.ctx.captureReadEpoch(agentId)
    const persona = this.ports.repository.getActivePersona(agentId)
    const working = this.ports.workingMemory.readWorkingMemory(agentId)
    if (!working) this.ports.workingMemory.scheduleWorkingRefresh(agentId)
    if (
      !this.ctx.canReadAgentMemory(agentId) ||
      !this.ctx.isReadEpochCurrent(agentId, finalizedEpoch)
    ) {
      return null
    }
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
    return { payload, manifest }
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
