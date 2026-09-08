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

interface RecallState {
  readonly agentId: string
  readonly now: number
  readonly signal?: AbortSignal
  readonly scopeFilter: readonly MemoryScope[]
  readonly operationFence: MemoryOperationFence
  readonly readEpoch: number | null
  readonly latencyMs: Partial<Record<MemoryRecallLatencyStage, number>>
  readonly degradations: Set<MemoryRetrievalDegradationCause>
  activeStage: MemoryRecallLatencyStage | 'idle'
  // Eligible candidates after the latest revalidation round; reported even when a later round
  // is cancelled so diagnostics reflect the work that was actually done.
  ftsCandidates: number
  vectorCandidates: number
  readonly keywordQuery: string
  readonly keywordMatchMode: 'all' | 'any'
  candidateLimit: number
  ftsRows: AgentMemoryRow[]
  readonly similarityThreshold: number
  vectorCandidateLimit: number
  vectorPool: MemoryVectorMatch[] | null
  rawVectorMatches: MemoryVectorMatch[]
  vecCandidates: { memoryId: string; similarity: number }[]
  vectorContext: { embedding: MemoryModelRef; dimensions: number } | null
}

interface RecallRefillResult {
  authoritativeRows: AgentMemoryRow[]
  structurallyValidVecMatches: Array<{ row: AgentMemoryRow; similarity: number }>
  authoritativeFtsRows: AgentMemoryRow[]
  authoritativeVecMatches: Array<{ row: AgentMemoryRow; similarity: number }>
}

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
  activeStage: MemoryRecallLatencyStage | 'idle'
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

  // Per-request recall state shared by the keyword, vector, refill, and prune stages. Every
  // stage reads the same fence and read epoch so a cancelled request never reaches assembly.
  private createRecallState(input: {
    agentId: string
    now: number
    signal?: AbortSignal
    scopeFilter: readonly MemoryScope[]
    operationFence: MemoryOperationFence
    readEpoch: number | null
    latencyMs: Partial<Record<MemoryRecallLatencyStage, number>>
    degradations: Set<MemoryRetrievalDegradationCause>
    keywordQuery: string
    keywordMatchMode: 'all' | 'any'
    candidateLimit: number
    similarityThreshold: number
  }): RecallState {
    return {
      ...input,
      activeStage: 'idle',
      ftsCandidates: 0,
      vectorCandidates: 0,
      ftsRows: [],
      vectorCandidateLimit: scopeAwareVectorCandidateLimit(input.candidateLimit),
      vectorPool: null,
      rawVectorMatches: [],
      vecCandidates: [],
      vectorContext: null
    }
  }

  private isRecallCurrent(state: RecallState): boolean {
    return (
      this.ctx.canContinueOperation(state.operationFence) &&
      (state.readEpoch === null || this.ctx.isReadEpochCurrent(state.agentId, state.readEpoch))
    )
  }

  private searchKeywordCandidates(state: RecallState, limit: number): AgentMemoryRow[] {
    if (!state.keywordQuery) return []
    const keywordStartedAt = performance.now()
    const search = this.ports.repository.searchWithStrategy(
      state.agentId,
      state.keywordQuery,
      limit,
      { matchMode: state.keywordMatchMode, scopeFilter: state.scopeFilter }
    )
    if (search.strategy === 'like-fallback') state.degradations.add('ftsUnavailable')
    state.latencyMs.keyword =
      (state.latencyMs.keyword ?? 0) + (performance.now() - keywordStartedAt)
    return search.rows.filter((row) => row.kind !== 'persona' && row.kind !== 'working')
  }

  // The exact scan costs the same for any top-K, so one query fetches the whole candidate budget
  // and adaptive refills widen the visible page locally instead of rescanning the store.
  private takeVectorCandidates(state: RecallState, limit: number): void {
    state.vectorCandidateLimit = limit
    state.rawVectorMatches = state.vectorPool?.slice(0, limit) ?? []
    state.vecCandidates = []
    for (const match of state.rawVectorMatches) {
      const similarity = distanceToSimilarity(match.distance)
      if (similarity < state.similarityThreshold) continue
      state.vecCandidates.push({ memoryId: match.memoryId, similarity })
    }
  }

  /**
   * Vector stage: health gate, cold warm-up, breaker-guarded query embedding, one exact scan, and
   * the ready-certificate re-check before the pool is admitted. Returns false when the execution
   * fence moved while a provider call was in flight so the caller reports a cancelled recall.
   * Provider or store failures degrade to FTS unless the fence is already stale, in which case
   * the error propagates and the outer handler classifies it.
   */
  private async recallVectorCandidates(
    state: RecallState,
    currentEmbedding: MemoryModelRef,
    query: string
  ): Promise<boolean> {
    const { agentId, operationFence, signal } = state
    const recallHealth = this.ports.vectorStore.getRecallHealth(agentId)
    if (recallHealth !== 'available') {
      state.degradations.add(recallHealth === 'suspect' ? 'storeTimeout' : 'storeUnusable')
      return true
    }
    if (!this.ports.vectorStore.hasReadyCertificate(agentId, currentEmbedding)) {
      state.degradations.add('vectorCold')
      void this.ports
        .warmVectorStore(agentId, currentEmbedding, { delayOpen: true })
        .catch((error) => {
          logger.warn(`[Memory] vector warmup failed for ${agentId}: ${String(error)}`)
        })
      this.ports.warmEmbeddingConnection(agentId, currentEmbedding)
      return true
    }
    try {
      const queryEmbedding = this.queryEmbeddingCircuit.start(
        agentId,
        currentEmbedding,
        query,
        signal
      )
      if (queryEmbedding.status === 'circuitOpen') {
        state.degradations.add('embeddingCircuitOpen')
        return true
      }
      if (queryEmbedding.status === 'capacity') {
        logger.warn(
          `[Memory] query embedding already in flight for ${agentId}; vector recall skipped this turn`
        )
        return true
      }
      const embeddingStartedAt = performance.now()
      state.activeStage = 'queryEmbedding'
      // The gateway owns the deadline; its rejection lands in the catch below.
      const vectors = await queryEmbedding.promise
      throwIfAborted(signal)
      state.latencyMs.queryEmbedding = performance.now() - embeddingStartedAt
      if (!this.ctx.canContinueOperation(operationFence)) return false
      const vector = vectors[0]
      if (!vector?.length) return true
      const vectorStartedAt = performance.now()
      state.activeStage = 'vector'
      const matches = await this.ports.vectorStore.query(
        agentId,
        currentEmbedding,
        vector.length,
        vector,
        MEMORY_RETRIEVAL_MAX_CANDIDATES
      )
      throwIfAborted(signal)
      state.latencyMs.vector = performance.now() - vectorStartedAt
      if (!this.ctx.canContinueOperation(operationFence)) return false
      if (
        this.ports.vectorStore.hasReadyCertificate(agentId, currentEmbedding) &&
        this.ctx.canUseCurrentMemoryEmbedding(agentId, currentEmbedding)
      ) {
        state.vectorContext = { embedding: currentEmbedding, dimensions: vector.length }
        state.vectorPool = matches
        this.takeVectorCandidates(state, state.vectorCandidateLimit)
        if (!this.ports.isReindexing(agentId)) {
          void this.ports.backfillEmbeddings(agentId).catch((error) => {
            logger.warn(`[Memory] backfill failed for ${agentId}: ${String(error)}`)
          })
        }
      } else if (!this.ports.isReindexing(agentId)) {
        state.degradations.add('revisionChanged')
        void this.ports.reindexEmbeddings(agentId, true).catch((error) => {
          logger.warn(`[Memory] store rebuild failed for ${agentId}: ${String(error)}`)
        })
      }
      return true
    } catch (error) {
      if (signal?.aborted) throwIfAborted(signal)
      const executionIsCurrent = this.ctx.canContinueOperation(operationFence)
      if (!executionIsCurrent && isStaleExecutionCancellation(error, this.ctx.isDisposed)) {
        return false
      }
      const errorName = (error as { name?: string } | null)?.name
      if (
        state.activeStage === 'vector' &&
        errorName !== 'AbortError' &&
        !(error instanceof VectorStoreLeaseUnavailableError)
      ) {
        this.ports.vectorStore.clearReady(agentId)
      }
      state.degradations.add(
        vectorStoreDegradation(
          error,
          this.ports.vectorStore.getRecallHealth(agentId),
          state.activeStage
        )
      )
      logger.warn(`[Memory] vector recall degraded to FTS for ${agentId}: ${String(error)}`)
      if (!executionIsCurrent) throw error
      return true
    }
  }

  /**
   * Refill stage: revalidate every candidate against the authoritative rows, apply directive
   * suppression and temporal eligibility, and widen the FTS page or the local vector page
   * geometrically until top-K is covered or both sources saturate. Returns null when the fence
   * or read epoch moved between rounds.
   */
  private refillCandidates(
    state: RecallState,
    limits: {
      effectiveTopK: number
      fusionCandidateLimit: number
      temporalMode: MemoryTemporalPolicyMode
      suppressionPolicy: ReturnType<typeof createMemoryTopicSuppressionPolicy> | null
    }
  ): RecallRefillResult | null {
    const { agentId, now } = state
    const result: RecallRefillResult = {
      authoritativeRows: [],
      structurallyValidVecMatches: [],
      authoritativeFtsRows: [],
      authoritativeVecMatches: []
    }
    while (true) {
      if (!this.isRecallCurrent(state)) return null
      throwIfAborted(state.signal)
      const candidateIds = [
        ...state.ftsRows.map((row) => row.id),
        ...state.vecCandidates.map((candidate) => candidate.memoryId)
      ]
      const revalidationStartedAt = performance.now()
      state.activeStage = 'authoritativeRevalidation'
      result.authoritativeRows = candidateIds.length
        ? this.ports.repository.listApplicableByIds(
            agentId,
            [...new Set(candidateIds)],
            state.scopeFilter
          )
        : []
      state.latencyMs.authoritativeRevalidation =
        (state.latencyMs.authoritativeRevalidation ?? 0) +
        (performance.now() - revalidationStartedAt)
      const rowsById = new Map(result.authoritativeRows.map((row) => [row.id, row]))
      const structurallyValidFtsRows = state.ftsRows
        .map((row) => rowsById.get(row.id))
        .filter((row): row is AgentMemoryRow => isLiveRecallRow(agentId, row))
      const vectorContext = state.vectorContext
      const vectorFingerprint = vectorContext
        ? embeddingFingerprint(vectorContext.embedding.providerId, vectorContext.embedding.modelId)
        : null
      result.structurallyValidVecMatches = state.vecCandidates
        .map((candidate) => {
          const row = rowsById.get(candidate.memoryId)
          return vectorContext && vectorFingerprint
            ? isCurrentRecallVectorRow(agentId, row, vectorContext.dimensions, vectorFingerprint) &&
              isLiveRecallRow(agentId, row)
              ? { row, similarity: candidate.similarity }
              : null
            : null
        })
        .filter((match): match is { row: AgentMemoryRow; similarity: number } => match !== null)
      const { suppressionPolicy } = limits
      const directiveEligibleFtsRows = suppressionPolicy
        ? structurallyValidFtsRows.filter((row) => !suppressionPolicy.suppresses(row.content))
        : structurallyValidFtsRows
      const directiveEligibleVecMatches = suppressionPolicy
        ? result.structurallyValidVecMatches.filter(
            (match) => !suppressionPolicy.suppresses(match.row.content)
          )
        : result.structurallyValidVecMatches
      result.authoritativeFtsRows = selectTemporalCandidates(
        directiveEligibleFtsRows,
        (row) => row,
        limits.fusionCandidateLimit,
        now,
        limits.temporalMode
      )
      result.authoritativeVecMatches = selectTemporalCandidates(
        directiveEligibleVecMatches,
        (match) => match.row,
        limits.fusionCandidateLimit,
        now,
        limits.temporalMode
      )
      state.ftsCandidates = result.authoritativeFtsRows.length
      state.vectorCandidates = result.authoritativeVecMatches.length

      const eligibleIds = new Set([
        ...result.authoritativeFtsRows.map((row) => row.id),
        ...result.authoritativeVecMatches.map((match) => match.row.id)
      ])
      if (eligibleIds.size >= limits.effectiveTopK) return result

      const ftsSourceSaturated =
        Boolean(state.keywordQuery) && state.ftsRows.length >= state.candidateLimit
      const vectorSourceSaturated =
        state.vectorPool !== null &&
        state.rawVectorMatches.length >= state.vectorCandidateLimit &&
        state.vecCandidates.length === state.rawVectorMatches.length
      const nextFtsLimit = nextMemoryRetrievalCandidateLimit(state.candidateLimit)
      const nextVectorLimit = nextMemoryRetrievalCandidateLimit(state.vectorCandidateLimit)
      const canRefillFts = ftsSourceSaturated && nextFtsLimit > state.candidateLimit
      const canRefillVector = vectorSourceSaturated && nextVectorLimit > state.vectorCandidateLimit
      if (!canRefillFts && !canRefillVector) {
        if (
          (ftsSourceSaturated && state.candidateLimit >= MEMORY_RETRIEVAL_MAX_CANDIDATES) ||
          (vectorSourceSaturated && state.vectorCandidateLimit >= MEMORY_RETRIEVAL_MAX_CANDIDATES)
        ) {
          state.degradations.add('candidateBudgetExhausted')
        }
        return result
      }

      if (canRefillFts) {
        state.candidateLimit = nextFtsLimit
        state.activeStage = 'keyword'
        state.ftsRows = this.searchKeywordCandidates(state, state.candidateLimit)
      }
      if (canRefillVector) this.takeVectorCandidates(state, nextVectorLimit)
    }
  }

  /**
   * Prune stage: delete vectors whose rows are gone or no longer live. Temporal ineligibility is
   * not structural deletion (future states can become eligible later), and an unmatched vector may
   * belong to a valid row outside this request's scope, so misses are resolved against the owner
   * namespace before anything is deleted.
   */
  private pruneStaleVectors(
    state: RecallState,
    vectorContext: { embedding: MemoryModelRef; dimensions: number },
    refill: RecallRefillResult
  ): void {
    const { agentId } = state
    const liveVectorIds = new Set(refill.structurallyValidVecMatches.map((match) => match.row.id))
    const applicableIds = new Set(refill.authoritativeRows.map((row) => row.id))
    const candidateIds = state.vecCandidates.map((candidate) => candidate.memoryId)
    const unmatchedVectorIds = [
      ...new Set(candidateIds.filter((memoryId) => !applicableIds.has(memoryId)))
    ]
    const existingUnmatchedIds = new Set(
      unmatchedVectorIds.length
        ? this.ports.repository.listByIds(agentId, unmatchedVectorIds).map((row) => row.id)
        : []
    )
    const deadVectorIds = [
      ...new Set(
        candidateIds.filter(
          (memoryId) =>
            (applicableIds.has(memoryId) && !liveVectorIds.has(memoryId)) ||
            (!applicableIds.has(memoryId) && !existingUnmatchedIds.has(memoryId))
        )
      )
    ]
    if (!deadVectorIds.length) return
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
    let selected = 0
    let operationFence: MemoryOperationFence | null = null
    let setupStage: MemoryRecallLatencyStage | 'idle' = 'idle'
    let state: RecallState | null = null
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
      const directiveSuppressionApplies = directiveSuppressionAppliesToPurpose(options.purpose)
      setupStage = 'authoritativeRevalidation'
      const suppressionTopics = directiveSuppressionApplies
        ? this.ports.getActiveSuppressionTopics(agentId)
        : []
      const readEpoch = directiveSuppressionApplies ? this.ctx.captureReadEpoch(agentId) : null

      const effectiveTopK =
        options.topKOverride !== undefined ? clampRetrievalTopK(options.topKOverride) : topK
      const temporalMode = temporalPolicyModeForPurpose(options.purpose)
      const candidateMultiplier =
        temporalMode === 'current'
          ? TEMPORAL_RETRIEVAL_CANDIDATE_MULTIPLIER
          : suppressionTopics.length > 0
            ? DIRECTIVE_RETRIEVAL_CANDIDATE_MULTIPLIER
            : LEGACY_RETRIEVAL_CANDIDATE_MULTIPLIER
      state = this.createRecallState({
        agentId,
        now,
        signal: options.signal,
        scopeFilter,
        operationFence,
        readEpoch,
        latencyMs,
        degradations,
        keywordQuery: (options.keywordQuery ?? normalizedQuery).trim(),
        keywordMatchMode: options.keywordMatchMode ?? 'all',
        candidateLimit: effectiveTopK * candidateMultiplier,
        similarityThreshold
      })

      state.activeStage = 'keyword'
      state.ftsRows = this.searchKeywordCandidates(state, state.candidateLimit)
      throwIfAborted(options.signal)

      const embedding = config?.memoryEmbedding
      if (embedding?.providerId && embedding?.modelId) {
        const currentEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
        if (!(await this.recallVectorCandidates(state, currentEmbedding, normalizedQuery))) {
          outcome = 'cancelled'
          return []
        }
      }

      if (!this.isRecallCurrent(state)) {
        outcome = 'cancelled'
        return []
      }
      const refill = this.refillCandidates(state, {
        effectiveTopK,
        fusionCandidateLimit: effectiveTopK * LEGACY_RETRIEVAL_CANDIDATE_MULTIPLIER,
        temporalMode,
        suppressionPolicy: directiveSuppressionApplies
          ? createMemoryTopicSuppressionPolicy(suppressionTopics)
          : null
      })
      if (!refill) {
        outcome = 'cancelled'
        return []
      }
      throwIfAborted(options.signal)

      if (
        options.enableInlinePrune !== false &&
        state.vectorContext &&
        this.ctx.canContinueOperation(operationFence)
      ) {
        throwIfAborted(options.signal)
        this.pruneStaleVectors(state, state.vectorContext, refill)
      }

      const assemblyStartedAt = performance.now()
      state.activeStage = 'assembly'
      throwIfAborted(options.signal)
      const results = fuse(refill.authoritativeFtsRows, refill.authoritativeVecMatches, {
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
      const activeStage = state?.activeStage ?? setupStage
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
        ftsCandidates: state?.ftsCandidates ?? 0,
        vectorCandidates: state?.vectorCandidates ?? 0,
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
