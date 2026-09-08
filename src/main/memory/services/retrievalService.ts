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
  MEMORY_RETRIEVAL_MAX_CANDIDATES,
  nextMemoryRetrievalCandidateLimit
} from '../core/retrievalBudget'
import {
  isMemoryProviderCancellationError,
  isMemoryProviderDeadlineError
} from '../core/providerCancellation'
import { evaluateNormalizedMemoryTemporalPolicy, temporalMetadataFromRow } from '../core/temporal'
import {
  createMemoryTopicSuppressionPolicy,
  directiveSuppressionAppliesToPurpose
} from '../core/directivePolicy'
import {
  buildRecallKeywordQuery,
  extractRecallKeywordCandidates,
  selectRecallKeywordTerms
} from '../core/recallKeyword'
import {
  AGENT_MEMORY_AGENT_SCOPE_FILTER,
  memoryScopeFilterFromContext,
  normalizeMemoryScopeFilter
} from '../core/scope'
import {
  resolveInjectionTokenBudget,
  type MemoryInjectionManifest,
  type MemoryInjectionOptions,
  type MemoryInjectionPayload,
  type MemoryInjectionResult
} from '../core/injectionPort'
import {
  DECISION_NEIGHBOR_TOP_S,
  MEMORY_SEARCH_DEFAULT_LIMIT,
  SCOPE_VECTOR_OVERSAMPLE_MULTIPLIER
} from '../runtimeConstants'
import {
  MAX_TOP_K,
  type AgentMemoryRow,
  type MemoryDecisionNeighborSet,
  type MemoryDecisionQueryVectorSnapshot,
  type MemoryRecallItem,
  type MemoryScope,
  type MemoryScopeContext,
  type MemorySearchHit,
  type MemoryTemporalPolicyMode,
  type MemoryVectorMatch,
  type NormalizedMemoryCandidate
} from '../types'
import { VectorStoreLeaseUnavailableError, VectorStoreQueryTimeoutError } from '../domain/types'
import {
  embeddingFingerprint,
  type MemoryModelRef,
  type MemoryOperationFence,
  type MemoryRuntimeContext
} from '../context'
import type {
  MemoryAccessRepositoryPort,
  MemoryAgentPolicyPort,
  MemoryEmbeddingGatewayPort,
  MemoryReadRepositoryPort,
  VectorStoreRetrievalPort,
  WorkingMemoryReadPort
} from '../ports'
import {
  QueryEmbeddingCircuitBreaker,
  type QueryEmbeddingCircuitDiagnostics,
  type QueryEmbeddingCircuitState
} from '../infra/queryEmbeddingCircuit'

const LEGACY_RETRIEVAL_CANDIDATE_MULTIPLIER = 2
const TEMPORAL_RETRIEVAL_CANDIDATE_MULTIPLIER = 4
const DIRECTIVE_RETRIEVAL_CANDIDATE_MULTIPLIER = 4
const INITIAL_VECTOR_RETRIEVAL_MAX_CANDIDATES = MAX_TOP_K * TEMPORAL_RETRIEVAL_CANDIDATE_MULTIPLIER

function scopeAwareVectorCandidateLimit(baseLimit: number): number {
  return Math.min(
    INITIAL_VECTOR_RETRIEVAL_MAX_CANDIDATES,
    baseLimit * SCOPE_VECTOR_OVERSAMPLE_MULTIPLIER
  )
}

function temporalPolicyModeForPurpose(purpose: MemoryRetrievalPurpose): MemoryTemporalPolicyMode {
  return purpose === 'recall' || purpose === 'injection' ? 'current' : 'evidence'
}

function selectTemporalCandidates<T>(
  candidates: readonly T[],
  rowOf: (candidate: T) => AgentMemoryRow,
  limit: number,
  now: number,
  mode: MemoryTemporalPolicyMode
): T[] {
  if (mode === 'evidence') return candidates.slice(0, limit)
  const selected: T[] = []
  for (const candidate of candidates) {
    const temporal = temporalMetadataFromRow(rowOf(candidate))
    if (!evaluateNormalizedMemoryTemporalPolicy(temporal, now, mode).eligible) continue
    selected.push(candidate)
    if (selected.length >= limit) break
  }
  return selected
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

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

function vectorStoreDegradation(
  error: unknown,
  health: ReturnType<VectorStoreRetrievalPort['getRecallHealth']>,
  activeStage: MemoryRecallLatencyStage
): MemoryRetrievalDegradationCause {
  if (error instanceof VectorStoreQueryTimeoutError || health === 'suspect') return 'storeTimeout'
  if (
    error instanceof VectorStoreLeaseUnavailableError ||
    health === 'quarantined' ||
    health === 'stopped'
  ) {
    return 'storeUnusable'
  }
  if (activeStage !== 'queryEmbedding') return 'storeError'
  return isMemoryProviderDeadlineError(error) ? 'embeddingTimeout' : 'embeddingError'
}

function isStaleExecutionCancellation(error: unknown, isDisposed: boolean): boolean {
  return (
    isMemoryProviderCancellationError(error) ||
    (isDisposed && error instanceof VectorStoreLeaseUnavailableError && error.reason === 'stopped')
  )
}

export class RetrievalService {
  private readonly ctx: MemoryRuntimeContext
  private readonly queryEmbeddingCircuit: QueryEmbeddingCircuitBreaker

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
      getActiveSuppressionTopics: (agentId: string) => readonly string[]
      diagnostics?: QueryEmbeddingCircuitDiagnostics & {
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
    this.queryEmbeddingCircuit = new QueryEmbeddingCircuitBreaker({
      embeddingGateway: ports.embeddingGateway,
      diagnostics: ports.diagnostics
    })
  }

  async recall(
    agentId: string,
    query: string,
    now?: number,
    scopeContext?: MemoryScopeContext
  ): Promise<MemoryRecallItem[]> {
    return this.retrieve(agentId, query, now ?? this.ctx.now(), true, {
      purpose: 'recall',
      keywordQuery: this.buildAgentFacingRecallKeywordQuery(query),
      keywordMatchMode: 'any',
      scopeFilter: memoryScopeFilterFromContext(scopeContext)
    })
  }

  async retrieveForDecisions(
    agentId: string,
    candidates: readonly NormalizedMemoryCandidate[],
    now: number,
    queryVectors?: readonly (MemoryDecisionQueryVectorSnapshot | undefined)[],
    pinnedIdsByCandidate?: readonly (readonly string[] | undefined)[],
    scopeFilter?: readonly MemoryScope[]
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
      const normalizedScopeFilter = normalizeMemoryScopeFilter(
        scopeFilter,
        AGENT_MEMORY_AGENT_SCOPE_FILTER
      )
      if (!normalizedScopeFilter.length) {
        outcome = 'completed'
        return candidates.map(() => ({ neighbors: [] }))
      }
      const { rrfK, similarityThreshold, weights } = resolveRetrieval(config?.memoryRetrieval)
      const candidateLimit = DECISION_NEIGHBOR_TOP_S * 2
      const vectorCandidateLimit = scopeAwareVectorCandidateLimit(candidateLimit)
      const keywordStartedAt = performance.now()
      activeStage = 'keyword'
      const keywordSearches = candidates.map((candidate) => {
        const keywordQuery = this.buildAgentFacingRecallKeywordQuery(candidate.content)
        return keywordQuery
          ? this.ports.repository.searchWithStrategy(agentId, keywordQuery, candidateLimit, {
              matchMode: 'any',
              scopeFilter: normalizedScopeFilter
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
      const vectorMatches: Array<Array<{ memoryId: string; similarity: number }>> = candidates.map(
        () => []
      )
      let vectorContext: { embedding: MemoryModelRef; dimensions: number } | null = null
      if (currentEmbedding && this.ctx.canUseCurrentMemoryEmbedding(agentId, currentEmbedding)) {
        const recallHealth = this.ports.vectorStore.getRecallHealth(agentId)
        if (recallHealth !== 'available') {
          degradations.add(recallHealth === 'suspect' ? 'storeTimeout' : 'storeUnusable')
        } else if (!this.ports.vectorStore.hasReadyCertificate(agentId, currentEmbedding)) {
          degradations.add('vectorCold')
          void this.ports
            .warmVectorStore(agentId, currentEmbedding, { delayOpen: true })
            .catch((error) => {
              logger.warn(`[Memory] vector warmup failed for ${agentId}: ${String(error)}`)
            })
          this.ports.warmEmbeddingConnection(agentId, currentEmbedding)
        } else {
          // Query embeddings are only worth a provider round trip once the store can answer. A
          // supplied vector array is a retry snapshot: undefined slots stay FTS-only so contention
          // never performs a second embedding call after the first attempt failed or omitted one.
          if (queryVectors === undefined) {
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
                logger.warn(
                  `[Memory] batch query embedding failed for ${agentId}: ${String(error)}`
                )
              }
            }
          }
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
                vectorCandidateLimit
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
              if (
                errorName !== 'AbortError' &&
                !(error instanceof VectorStoreLeaseUnavailableError)
              ) {
                this.ports.vectorStore.clearReady(agentId)
              }
              degradations.add(
                vectorStoreDegradation(
                  error,
                  this.ports.vectorStore.getRecallHealth(agentId),
                  activeStage
                )
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
        ? this.ports.repository.listApplicableByIds(
            agentId,
            [...candidateIds],
            normalizedScopeFilter
          )
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
          now,
          temporalMode: 'evidence'
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
              temporal: temporalMetadataFromRow(pinned),
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

  async searchMemories(
    agentId: string,
    query: string,
    options: { limit?: number; scopeContext?: MemoryScopeContext } = {}
  ): Promise<MemorySearchHit[]> {
    const limit =
      options.limit != null
        ? Math.min(MAX_TOP_K, Math.max(0, Math.floor(options.limit)))
        : MEMORY_SEARCH_DEFAULT_LIMIT
    if (limit === 0) return []
    if (!this.ctx.canReadAgentMemory(agentId)) return []
    const operationFence = this.ctx.captureOperationFence(agentId)
    const scopeFilter = memoryScopeFilterFromContext(options.scopeContext)
    const hits = await this.retrieve(agentId, query, this.ctx.now(), false, {
      purpose: 'search',
      topKOverride: limit,
      enableInlinePrune: false,
      scopeFilter
    })
    if (!this.ctx.canContinueOperation(operationFence)) return []
    const limited = hits.slice(0, limit)
    const rowsById = new Map(
      this.ports.repository
        .listApplicableByIds(
          agentId,
          limited.map((hit) => hit.id),
          scopeFilter
        )
        .map((row) => [row.id, row])
    )
    const results: MemorySearchHit[] = []
    for (const hit of limited) {
      const row = rowsById.get(hit.id)
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
      degradationCollector?: Set<MemoryRetrievalDegradationCause>
      signal?: AbortSignal
      scopeFilter?: readonly MemoryScope[]
    }
  ): Promise<MemoryRecallItem[]> {
    const totalStartedAt = performance.now()
    const latencyMs: Partial<Record<MemoryRecallLatencyStage, number>> = {}
    const degradations = options.degradationCollector ?? new Set<MemoryRetrievalDegradationCause>()
    let outcome: MemoryRetrievalOutcome = 'failed'
    let ftsCandidates = 0
    let vectorCandidates = 0
    let selected = 0
    let activeStage: MemoryRecallLatencyStage | 'idle' = 'idle'
    let operationFence: MemoryOperationFence | null = null
    let readEpoch: number | null = null
    try {
      if (!this.ctx.canReadAgentMemory(agentId)) {
        outcome = 'disabled'
        return []
      }
      operationFence = this.ctx.captureOperationFence(agentId)
      throwIfAborted(options.signal)
      const config = this.ports.policy.resolveAgentConfig(agentId)
      const scopeFilter = normalizeMemoryScopeFilter(
        options.scopeFilter,
        AGENT_MEMORY_AGENT_SCOPE_FILTER
      )
      if (!scopeFilter.length) {
        outcome = 'completed'
        return []
      }
      const { topK, rrfK, similarityThreshold, weights } = resolveRetrieval(config?.memoryRetrieval)
      const normalizedQuery = query.trim()
      if (!normalizedQuery) {
        outcome = 'emptyQuery'
        return []
      }
      const normalizedKeywordQuery = (options.keywordQuery ?? normalizedQuery).trim()
      const directiveSuppressionApplies = directiveSuppressionAppliesToPurpose(options.purpose)
      activeStage = 'authoritativeRevalidation'
      const suppressionTopics = directiveSuppressionApplies
        ? this.ports.getActiveSuppressionTopics(agentId)
        : []
      if (directiveSuppressionApplies) readEpoch = this.ctx.captureReadEpoch(agentId)

      const effectiveTopK =
        options.topKOverride !== undefined ? clampRetrievalTopK(options.topKOverride) : topK
      const temporalMode = temporalPolicyModeForPurpose(options.purpose)
      const fusionCandidateLimit = effectiveTopK * LEGACY_RETRIEVAL_CANDIDATE_MULTIPLIER
      const candidateMultiplier =
        temporalMode === 'current'
          ? TEMPORAL_RETRIEVAL_CANDIDATE_MULTIPLIER
          : suppressionTopics.length > 0
            ? DIRECTIVE_RETRIEVAL_CANDIDATE_MULTIPLIER
            : LEGACY_RETRIEVAL_CANDIDATE_MULTIPLIER
      let candidateLimit = effectiveTopK * candidateMultiplier
      let vectorCandidateLimit = scopeAwareVectorCandidateLimit(candidateLimit)
      const searchKeywordCandidates = (limit: number): AgentMemoryRow[] => {
        if (!normalizedKeywordQuery) return []
        const keywordStartedAt = performance.now()
        const search = this.ports.repository.searchWithStrategy(
          agentId,
          normalizedKeywordQuery,
          limit,
          {
            matchMode: options.keywordMatchMode ?? 'all',
            scopeFilter
          }
        )
        if (search.strategy === 'like-fallback') degradations.add('ftsUnavailable')
        latencyMs.keyword = (latencyMs.keyword ?? 0) + (performance.now() - keywordStartedAt)
        return search.rows.filter((row) => row.kind !== 'persona' && row.kind !== 'working')
      }
      activeStage = 'keyword'
      let ftsRows = searchKeywordCandidates(candidateLimit)
      throwIfAborted(options.signal)

      const vecCandidates: { memoryId: string; similarity: number }[] = []
      let rawVectorMatches: MemoryVectorMatch[] = []
      let vectorContext: { embedding: MemoryModelRef; dimensions: number } | null = null
      // The exact scan costs the same for any top-K, so one query fetches the whole candidate
      // budget and adaptive refills widen the visible page locally instead of rescanning the store.
      let vectorPool: MemoryVectorMatch[] | null = null
      const takeVectorCandidates = (limit: number): void => {
        vectorCandidateLimit = limit
        rawVectorMatches = vectorPool?.slice(0, limit) ?? []
        vecCandidates.splice(0, vecCandidates.length)
        for (const match of rawVectorMatches) {
          const similarity = distanceToSimilarity(match.distance)
          if (similarity < similarityThreshold) continue
          vecCandidates.push({ memoryId: match.memoryId, similarity })
        }
      }
      const embedding = config?.memoryEmbedding
      if (embedding?.providerId && embedding?.modelId) {
        const currentEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
        const recallHealth = this.ports.vectorStore.getRecallHealth(agentId)
        if (recallHealth !== 'available') {
          degradations.add(recallHealth === 'suspect' ? 'storeTimeout' : 'storeUnusable')
        } else if (!this.ports.vectorStore.hasReadyCertificate(agentId, currentEmbedding)) {
          degradations.add('vectorCold')
          void this.ports
            .warmVectorStore(agentId, currentEmbedding, { delayOpen: true })
            .catch((error) => {
              logger.warn(`[Memory] vector warmup failed for ${agentId}: ${String(error)}`)
            })
          this.ports.warmEmbeddingConnection(agentId, currentEmbedding)
        } else {
          try {
            const queryEmbedding = this.queryEmbeddingCircuit.start(
              agentId,
              currentEmbedding,
              normalizedQuery,
              options.signal
            )
            if (queryEmbedding.status === 'circuitOpen') {
              degradations.add('embeddingCircuitOpen')
            } else if (queryEmbedding.status === 'capacity') {
              logger.warn(
                `[Memory] query embedding already in flight for ${agentId}; vector recall skipped this turn`
              )
            } else {
              const embeddingStartedAt = performance.now()
              activeStage = 'queryEmbedding'
              // The gateway owns the deadline; its rejection lands in the catch below.
              const vectors = await queryEmbedding.promise
              throwIfAborted(options.signal)
              latencyMs.queryEmbedding = performance.now() - embeddingStartedAt
              if (!this.ctx.canContinueOperation(operationFence)) {
                outcome = 'cancelled'
                return []
              }
              const vector = vectors[0]
              if (vector?.length) {
                if (!this.ctx.canContinueOperation(operationFence)) {
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
                  MEMORY_RETRIEVAL_MAX_CANDIDATES
                )
                throwIfAborted(options.signal)
                latencyMs.vector = performance.now() - vectorStartedAt
                if (!this.ctx.canContinueOperation(operationFence)) {
                  outcome = 'cancelled'
                  return []
                }
                if (
                  this.ports.vectorStore.hasReadyCertificate(agentId, currentEmbedding) &&
                  this.ctx.canUseCurrentMemoryEmbedding(agentId, currentEmbedding)
                ) {
                  if (!this.ctx.canContinueOperation(operationFence)) {
                    outcome = 'cancelled'
                    return []
                  }
                  vectorContext = { embedding: currentEmbedding, dimensions: vector.length }
                  vectorPool = matches
                  takeVectorCandidates(vectorCandidateLimit)
                  if (
                    this.ctx.canContinueOperation(operationFence) &&
                    !this.ports.isReindexing(agentId)
                  ) {
                    void this.ports.backfillEmbeddings(agentId).catch((error) => {
                      logger.warn(`[Memory] backfill failed for ${agentId}: ${String(error)}`)
                    })
                  }
                } else if (
                  this.ctx.canContinueOperation(operationFence) &&
                  !this.ports.isReindexing(agentId)
                ) {
                  degradations.add('revisionChanged')
                  void this.ports.reindexEmbeddings(agentId, true).catch((error) => {
                    logger.warn(`[Memory] store rebuild failed for ${agentId}: ${String(error)}`)
                  })
                }
              }
            }
          } catch (error) {
            if (options.signal?.aborted) throwIfAborted(options.signal)
            const executionIsCurrent = this.ctx.canContinueOperation(operationFence)
            if (!executionIsCurrent && isStaleExecutionCancellation(error, this.ctx.isDisposed)) {
              outcome = 'cancelled'
              return []
            }
            const errorName = (error as { name?: string } | null)?.name
            if (
              activeStage === 'vector' &&
              errorName !== 'AbortError' &&
              !(error instanceof VectorStoreLeaseUnavailableError)
            ) {
              this.ports.vectorStore.clearReady(agentId)
            }
            degradations.add(
              vectorStoreDegradation(
                error,
                this.ports.vectorStore.getRecallHealth(agentId),
                activeStage
              )
            )
            logger.warn(`[Memory] vector recall degraded to FTS for ${agentId}: ${String(error)}`)
            if (!executionIsCurrent) {
              outcome = 'cancelled'
              throw error
            }
          }
        }
      }

      if (
        !this.ctx.canContinueOperation(operationFence) ||
        (readEpoch !== null && !this.ctx.isReadEpochCurrent(agentId, readEpoch))
      ) {
        outcome = 'cancelled'
        return []
      }
      const isEligibleRow = isLiveRecallRow
      const suppressionPolicy = directiveSuppressionApplies
        ? createMemoryTopicSuppressionPolicy(suppressionTopics)
        : null
      let authoritativeRows: AgentMemoryRow[] = []
      let structurallyValidVecMatches: Array<{ row: AgentMemoryRow; similarity: number }> = []
      let authoritativeFtsRows: AgentMemoryRow[] = []
      let authoritativeVecMatches: Array<{ row: AgentMemoryRow; similarity: number }> = []

      while (true) {
        if (
          !this.ctx.canContinueOperation(operationFence) ||
          (readEpoch !== null && !this.ctx.isReadEpochCurrent(agentId, readEpoch))
        ) {
          outcome = 'cancelled'
          return []
        }
        throwIfAborted(options.signal)
        const candidateIds = [
          ...ftsRows.map((row) => row.id),
          ...vecCandidates.map((candidate) => candidate.memoryId)
        ]
        const revalidationStartedAt = performance.now()
        activeStage = 'authoritativeRevalidation'
        authoritativeRows = candidateIds.length
          ? this.ports.repository.listApplicableByIds(
              agentId,
              [...new Set(candidateIds)],
              scopeFilter
            )
          : []
        latencyMs.authoritativeRevalidation =
          (latencyMs.authoritativeRevalidation ?? 0) + (performance.now() - revalidationStartedAt)
        const rowsById = new Map(authoritativeRows.map((row) => [row.id, row]))
        const structurallyValidFtsRows = ftsRows
          .map((row) => rowsById.get(row.id))
          .filter((row): row is AgentMemoryRow => isEligibleRow(agentId, row))
        const vectorFingerprint = vectorContext
          ? embeddingFingerprint(
              vectorContext.embedding.providerId,
              vectorContext.embedding.modelId
            )
          : null
        structurallyValidVecMatches = vecCandidates
          .map((candidate) => {
            const row = rowsById.get(candidate.memoryId)
            return vectorContext && vectorFingerprint
              ? isCurrentRecallVectorRow(
                  agentId,
                  row,
                  vectorContext.dimensions,
                  vectorFingerprint
                ) && isEligibleRow(agentId, row)
                ? { row, similarity: candidate.similarity }
                : null
              : null
          })
          .filter((match): match is { row: AgentMemoryRow; similarity: number } => match !== null)
        const directiveEligibleFtsRows = suppressionPolicy
          ? structurallyValidFtsRows.filter((row) => !suppressionPolicy.suppresses(row.content))
          : structurallyValidFtsRows
        const directiveEligibleVecMatches = suppressionPolicy
          ? structurallyValidVecMatches.filter(
              (match) => !suppressionPolicy.suppresses(match.row.content)
            )
          : structurallyValidVecMatches
        authoritativeFtsRows = selectTemporalCandidates(
          directiveEligibleFtsRows,
          (row) => row,
          fusionCandidateLimit,
          now,
          temporalMode
        )
        authoritativeVecMatches = selectTemporalCandidates(
          directiveEligibleVecMatches,
          (match) => match.row,
          fusionCandidateLimit,
          now,
          temporalMode
        )
        ftsCandidates = authoritativeFtsRows.length
        vectorCandidates = authoritativeVecMatches.length

        const eligibleIds = new Set([
          ...authoritativeFtsRows.map((row) => row.id),
          ...authoritativeVecMatches.map((match) => match.row.id)
        ])
        if (eligibleIds.size >= effectiveTopK) break

        const ftsSourceSaturated =
          Boolean(normalizedKeywordQuery) && ftsRows.length >= candidateLimit
        const vectorSourceSaturated =
          vectorPool !== null &&
          rawVectorMatches.length >= vectorCandidateLimit &&
          vecCandidates.length === rawVectorMatches.length
        const nextFtsLimit = nextMemoryRetrievalCandidateLimit(candidateLimit)
        const nextVectorLimit = nextMemoryRetrievalCandidateLimit(vectorCandidateLimit)
        const canRefillFts = ftsSourceSaturated && nextFtsLimit > candidateLimit
        const canRefillVector = vectorSourceSaturated && nextVectorLimit > vectorCandidateLimit
        if (!canRefillFts && !canRefillVector) {
          if (
            (ftsSourceSaturated && candidateLimit >= MEMORY_RETRIEVAL_MAX_CANDIDATES) ||
            (vectorSourceSaturated && vectorCandidateLimit >= MEMORY_RETRIEVAL_MAX_CANDIDATES)
          ) {
            degradations.add('candidateBudgetExhausted')
          }
          break
        }

        if (canRefillFts) {
          candidateLimit = nextFtsLimit
          activeStage = 'keyword'
          ftsRows = searchKeywordCandidates(candidateLimit)
        }
        if (canRefillVector) takeVectorCandidates(nextVectorLimit)
      }
      throwIfAborted(options.signal)

      if (
        options.enableInlinePrune !== false &&
        vectorContext &&
        this.ctx.canContinueOperation(operationFence)
      ) {
        throwIfAborted(options.signal)
        // Temporal ineligibility is not structural deletion: future states can become eligible
        // later, so inline pruning must retain every otherwise-live vector.
        const liveVectorIds = new Set(structurallyValidVecMatches.map((match) => match.row.id))
        const applicableIds = new Set(authoritativeRows.map((row) => row.id))
        const unmatchedVectorIds = [
          ...new Set(
            vecCandidates
              .map((candidate) => candidate.memoryId)
              .filter((memoryId) => !applicableIds.has(memoryId))
          )
        ]
        // An unmatched vector can belong to a valid row outside this request's scope. Resolve only
        // those misses against the owner namespace so inline cleanup never deletes another scope's
        // vector while still removing true orphans.
        const existingUnmatchedIds = new Set(
          unmatchedVectorIds.length
            ? this.ports.repository.listByIds(agentId, unmatchedVectorIds).map((row) => row.id)
            : []
        )
        const deadVectorIds = [
          ...new Set(
            vecCandidates
              .map((candidate) => candidate.memoryId)
              .filter(
                (memoryId) =>
                  (applicableIds.has(memoryId) && !liveVectorIds.has(memoryId)) ||
                  (!applicableIds.has(memoryId) && !existingUnmatchedIds.has(memoryId))
              )
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
      throwIfAborted(options.signal)
      const results = fuse(authoritativeFtsRows, authoritativeVecMatches, {
        topK: effectiveTopK,
        rrfK,
        weights,
        now,
        trace: options.trace,
        temporalMode
      })
      latencyMs.assembly = performance.now() - assemblyStartedAt
      selected = results.length
      if (recordAccessHits) {
        this.ports.repository.recordAccessBatch(
          results.map((item) => item.id),
          now
        )
      }
      outcome = 'completed'
      return results
    } catch (error) {
      if (operationFence && !this.ctx.canContinueOperation(operationFence)) {
        outcome = 'cancelled'
        if (isStaleExecutionCancellation(error, this.ctx.isDisposed)) return []
      } else if (options.signal?.aborted || !this.ctx.canReadAgentMemory(agentId)) {
        outcome = 'cancelled'
      } else {
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

  async buildInjection(
    agentId: string,
    query: string,
    options: MemoryInjectionOptions = {}
  ): Promise<MemoryInjectionResult | null> {
    throwIfAborted(options.signal)
    if (!this.ctx.canReadAgentMemory(agentId)) return null
    const operationFence = this.ctx.captureOperationFence(agentId)
    const readEpoch = this.ctx.captureReadEpoch(agentId)
    const config = this.ports.policy.resolveAgentConfig(agentId)
    const degradations = new Set<MemoryRetrievalDegradationCause>()
    const scopeFilter = memoryScopeFilterFromContext(options.scopeContext)
    const recalled = await this.retrieve(agentId, query, this.ctx.now(), false, {
      purpose: 'injection',
      keywordQuery: this.buildAgentFacingRecallKeywordQuery(query),
      keywordMatchMode: 'any',
      scopeFilter,
      degradationCollector: degradations,
      signal: options.signal
    })
    throwIfAborted(options.signal)
    if (
      !this.ctx.canContinueOperation(operationFence) ||
      !this.ctx.isReadEpochCurrent(agentId, readEpoch)
    ) {
      return null
    }
    this.ports.workingMemory.flushWorkingMemoryIfDirty(agentId)
    throwIfAborted(options.signal)
    const finalizedEpoch = this.ctx.captureReadEpoch(agentId)
    const persona = this.ports.repository.getActivePersona(agentId)
    const working = this.ports.workingMemory.readWorkingMemory(agentId)
    if (!working) this.ports.workingMemory.scheduleWorkingRefresh(agentId)
    throwIfAborted(options.signal)
    if (
      !this.ctx.canContinueOperation(operationFence) ||
      !this.ctx.isReadEpochCurrent(agentId, finalizedEpoch)
    ) {
      return null
    }
    const manifestDegradations = [...degradations].filter(
      (degradation) => degradation !== 'vectorCold'
    )
    if (!persona && !working && recalled.length === 0 && manifestDegradations.length === 0)
      return null
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
        temporalAnnotation: item.temporalAnnotation,
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
      queryHash: query.trim()
        ? buildMemoryProvenanceKey(agentId, 'query', query.trim())
        : undefined,
      ...(manifestDegradations.length > 0 ? { degradations: manifestDegradations } : {})
    }
    return { payload, manifest }
  }

  getQueryEmbeddingCircuitState(agentId: string): QueryEmbeddingCircuitState {
    return this.queryEmbeddingCircuit.state(agentId)
  }

  cleanupAgent(agentId: string): void {
    this.onEmbeddingConfigChanged(agentId)
  }

  onEmbeddingConfigChanged(agentId: string): void {
    this.queryEmbeddingCircuit.reset(agentId)
  }

  clearAll(): void {
    this.queryEmbeddingCircuit.clear()
  }
}
