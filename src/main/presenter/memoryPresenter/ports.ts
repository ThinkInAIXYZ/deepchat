import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import type { LLM_EMBEDDING_ATTRS } from '@shared/presenter'
import type { MemoryUpdateReason } from '@shared/contracts/events/memory.events'

import type {
  AgentMemoryHealthAuditStats,
  AgentMemoryAuditInsertInput,
  AgentMemoryAuditRow,
  MemoryAuditListOptions
} from './domain/audit'
import type {
  AgentMemoryHealthStats,
  AgentMemoryInsertInput,
  AgentMemoryKind,
  AgentMemoryLifecycleRow,
  AgentMemoryListOptions,
  AgentMemoryPersonaState,
  AgentMemoryConflictState,
  AgentMemoryRow,
  AgentMemoryStatus,
  AgentMemoryWorkingCandidateCursor,
  ConsolidationScanCursor,
  ContentUpdateResult,
  EmbeddedMemoryUpdate,
  FailedEmbeddingUpdate,
  FuseOptions,
  ManualEditFieldFlags,
  MemoryCognitiveMaintenanceInput,
  MemoryManagementPageCursor,
  MemoryModelRef,
  MemoryRecallItem,
  MemoryVectorMatch,
  MemoryVectorQueryOptions,
  MemoryVectorRecord,
  MemoryVectorRef,
  NormalizedMemoryCandidate,
  ProvenanceHitResult,
  WriteMemoriesOptions
} from './domain/types'

export interface MemoryReadRepositoryPort {
  getById(id: string): AgentMemoryRow | undefined
  getByProvenanceKey(agentId: string, provenanceKey: string): AgentMemoryRow | undefined
  listByAgent(agentId: string, options?: AgentMemoryListOptions): AgentMemoryRow[]
  listManagementPage(
    agentId: string,
    cursor: MemoryManagementPageCursor | null,
    limit: number
  ): AgentMemoryRow[]
  listManagementVisibleByIds(agentId: string, ids: string[]): AgentMemoryRow[]
  listByIds(agentId: string, ids: string[]): AgentMemoryRow[]
  getActivePersona(agentId: string): AgentMemoryRow | undefined
  getDraftPersona(agentId: string): AgentMemoryRow | undefined
  listPersonaVersions(agentId: string): AgentMemoryRow[]
  search(
    agentId: string,
    query: string,
    limit?: number,
    options?: { matchMode?: 'all' | 'any' }
  ): AgentMemoryRow[]
  searchWithStrategy(
    agentId: string,
    query: string,
    limit?: number,
    options?: { matchMode?: 'all' | 'any' }
  ): { rows: AgentMemoryRow[]; strategy: 'fts-only' | 'like-fallback' }
  listWorkingCandidates(
    agentId: string,
    limit: number,
    after?: AgentMemoryWorkingCandidateCursor
  ): AgentMemoryRow[]
  listAgentIdsWithMemories(): string[]
  listRecentlyActiveAgentIds(candidateAgentIds: readonly string[], limit: number): string[]
  hasActiveMemory(agentId: string): boolean
}

export interface MemoryMutationRepositoryPort {
  insert(input: AgentMemoryInsertInput): AgentMemoryRow
  rekeyProvenance(agentId: string, id: string, expectedKey: string, nextKey: string): boolean
  updateStatus(
    id: string,
    status: AgentMemoryStatus,
    embedding?: {
      embeddingId?: string | null
      embeddingDim?: number | null
      embeddingModel?: string | null
    }
  ): void
  updateContent(
    id: string,
    content: string,
    provenanceKey: string | null,
    at?: number,
    category?: string | null
  ): void
  updateDecisionContentIfRevision(input: {
    agentId: string
    id: string
    expectedRevision: number
    content: string
    provenanceKey: string | null
    at: number
    category?: string | null
  }): boolean
  updateUserMetadata(id: string, patch: { category?: string | null; importance?: number }): void
  setConfidence(id: string, confidence: number): void
  setImportance(id: string, importance: number): void
  setPersonaState(id: string, state: AgentMemoryPersonaState, supersededBy?: string | null): void
  setAnchor(id: string, anchored: boolean): void
  markSuperseded(id: string, supersededBy: string | null): void
  markSupersededIfRevision(
    agentId: string,
    id: string,
    expectedRevision: number,
    supersededBy: string
  ): boolean
  markConflict(id: string, state: AgentMemoryConflictState | null): void
  markConflictIfRevision(
    agentId: string,
    id: string,
    expectedRevision: number,
    state: AgentMemoryConflictState
  ): boolean
  setConflictWith(id: string, targetId: string | null): void
  delete(id: string): void
  clearByAgent(agentId: string): number
}

export interface MemoryAccessRepositoryPort {
  recordAccess(id: string, accessedAt?: number): void
  recordAccessBatch(ids: string[], accessedAt?: number): void
}

export interface MemoryEmbeddingRepositoryPort {
  listPendingEmbedding(limit?: number, agentId?: string): AgentMemoryRow[]
  activateForEmbedding(id: string): void
  activateForEmbeddingIfRevision(agentId: string, id: string, expectedRevision: number): boolean
  markPendingEmbeddingsReady(agentId: string, updates: readonly EmbeddedMemoryUpdate[]): string[]
  markPendingEmbeddingsError(
    agentId: string,
    updates: readonly FailedEmbeddingUpdate[],
    status?: Extract<AgentMemoryStatus, 'error' | 'fts_only'>
  ): string[]
  requeueForEmbedding(
    agentId: string,
    statuses: AgentMemoryStatus[],
    limit?: number,
    afterId?: string | null
  ): number
  listEmbeddingStatusIds(
    agentId: string,
    statuses: AgentMemoryStatus[],
    limit: number,
    afterId?: string | null
  ): string[]
  listCurrentEmbeddedIds(
    agentId: string,
    embeddingDim: number,
    embeddingModel: string,
    afterId: string | null,
    limit: number
  ): string[]
  getCurrentEmbeddingDimension(agentId: string, fingerprint: string): number | null
  hasStaleEmbeddings(agentId: string, currentDim: number, fingerprint: string): boolean
  countStaleEmbeddings(agentId: string, currentDim: number, fingerprint: string): number
  listPrunableVectorRefs(
    agentId: string,
    options: { limit: number; embeddingModel?: string; embeddingDim?: number }
  ): MemoryVectorRef[]
  filterPrunableVectorRefs(
    agentId: string,
    ids: string[],
    embeddingDim: number,
    embeddingModel: string
  ): string[]
  clearPrunableEmbeddingRefs(
    agentId: string,
    ids: string[],
    embeddingDim: number,
    embeddingModel: string
  ): number
}

export interface MemoryLifecycleRepositoryPort {
  getCognitiveMaintenanceInput(
    agentId: string,
    options: { kinds: AgentMemoryKind[]; watermark: number; limit: number }
  ): MemoryCognitiveMaintenanceInput
  updateDecayScore(id: string, decayScore: number | null, consolidatedAt?: number | null): void
  setLastConsolidatedAt(id: string, at?: number): void
  getLastConsolidatedAt(agentId: string): number | null
  archive(id: string, at?: number): void
  archiveEligibleBatch(
    agentId: string,
    options: {
      now: number
      createdBefore: number
      minimumBaseAgeMs: number
      limit: number
    }
  ): string[]
  countArchiveEligible(
    agentId: string,
    options: { now: number; createdBefore: number; minimumBaseAgeMs: number }
  ): number
  listArchiveCandidateLifecycleRows(
    agentId: string,
    before: number,
    limit: number
  ): AgentMemoryLifecycleRow[]
  countConflictPairs(agentId: string): number
  isUnresolvedConflictParticipant(agentId: string, memoryId: string): boolean
  listConflictIntegrityRows(agentId: string): AgentMemoryRow[]
  listConflictChallengersForMaintenance(agentId: string, limit: number): AgentMemoryRow[]
  listConflictSiblings(
    agentId: string,
    targetId: string,
    excludeChallengerId: string
  ): AgentMemoryRow[]
  retireConflictSiblings(
    agentId: string,
    targetId: string,
    excludeChallengerId: string,
    winnerId: string,
    at: number
  ): number
  clearTargetConflictIfNoChallengers(agentId: string, targetId: string): boolean
  repairConflictIntegrityBatch(
    agentId: string,
    limit: number
  ): {
    repairedTargets: number
    archivedChallengers: number
    clearedTargets: number
    clearedLinks: number
  }
  listConsolidationScanRows(
    agentId: string,
    options: {
      embeddingDim: number
      embeddingModel: string
      after?: ConsolidationScanCursor
      limit: number
    }
  ): AgentMemoryRow[]
  repairInternalKindStatuses(agentId: string): number
}

export interface MemoryHealthRepositoryPort {
  getHealthStats(agentId: string): AgentMemoryHealthStats
  listTopAccessed(agentId: string, limit: number): AgentMemoryRow[]
  countByAgent(agentId: string): number
  countStatusView(agentId: string): {
    total: number
    pendingEmbedding: number
    activeMemoryCount: number
    archivedMemoryCount: number
  }
  getPersonaCounts(agentId: string): { total: number; draft: number }
}

export interface MemoryTransactionPort {
  runInTransaction<T>(fn: () => T): T
}

export interface MemoryRepositoryPort
  extends
    MemoryReadRepositoryPort,
    MemoryMutationRepositoryPort,
    MemoryAccessRepositoryPort,
    MemoryEmbeddingRepositoryPort,
    MemoryLifecycleRepositoryPort,
    MemoryHealthRepositoryPort,
    MemoryTransactionPort {}

export interface MemoryAuditReadPort {
  listByAgent(agentId: string, options?: number | MemoryAuditListOptions): AgentMemoryAuditRow[]
  getLatestCompletedEventAt(agentId: string, eventType: string): number | null
  hasForgetEvent(agentId: string, memoryId: string): boolean
  getHealthAuditStats(
    agentId: string,
    scanLimit: number,
    failuresLimit: number
  ): AgentMemoryHealthAuditStats
}

export interface MemoryAuditWritePort {
  insert(input: AgentMemoryAuditInsertInput): AgentMemoryAuditRow
}

export interface MemoryAuditMaintenancePort {
  pruneOperationalEvents(agentId: string, keep?: number, limit?: number): number
}

export interface MemoryAuditRepositoryPort
  extends MemoryAuditReadPort, MemoryAuditWritePort, MemoryAuditMaintenancePort {}

export interface MemoryAgentPolicyPort {
  resolveAgentConfig(agentId: string): DeepChatAgentConfig | null
  resolveAgentDefaultModel?(agentId: string): MemoryModelRef | null
  isManagedAgent?(agentId: string): boolean
  listManagedMemoryAgentIds?(): string[]
}

export type MemoryTextGenerationPurpose = 'extraction' | 'decision' | 'maintenance'
export type MemoryEmbeddingPurpose = 'query-embedding' | 'embedding-batch' | 'embedding-warm'
export type MemoryProviderPurpose =
  | MemoryTextGenerationPurpose
  | MemoryEmbeddingPurpose
  | 'dimension'

export interface MemoryTextGenerationPort {
  generateText(
    agentId: string,
    providerId: string,
    modelId: string,
    prompt: string,
    purpose: MemoryTextGenerationPurpose
  ): Promise<string>
}

export interface MemoryEmbeddingGatewayPort {
  getEmbeddings(
    agentId: string,
    providerId: string,
    modelId: string,
    texts: string[],
    purpose: MemoryEmbeddingPurpose
  ): Promise<number[][]>
  getDimensions(
    agentId: string,
    providerId: string,
    modelId: string
  ): Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }>
}

export interface MemoryProviderControlPort {
  abortAll(): void
  abortAgent(agentId: string): void
}

export interface MemoryProviderGatewayPort
  extends MemoryTextGenerationPort, MemoryEmbeddingGatewayPort, MemoryProviderControlPort {}

export interface MemoryProviderGatewayDeps {
  executeWithRateLimit(
    providerId: string,
    options: { signal: AbortSignal; purpose: string }
  ): Promise<void>
  getEmbeddings(
    providerId: string,
    modelId: string,
    texts: string[],
    signal?: AbortSignal
  ): Promise<number[][]>
  getDimensions(
    providerId: string,
    modelId: string,
    signal?: AbortSignal
  ): Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }>
  generateText(
    providerId: string,
    modelId: string,
    prompt: string,
    signal?: AbortSignal
  ): Promise<string>
  perfObserver?: MemoryPerfObserver
}

export interface IMemoryVectorStore {
  upsert(records: MemoryVectorRecord[]): Promise<void>
  query(embedding: number[], options: MemoryVectorQueryOptions): Promise<MemoryVectorMatch[]>
  queryByMemoryId(memoryId: string, options: MemoryVectorQueryOptions): Promise<MemoryVectorMatch[]>
  deleteByMemoryIds(memoryIds: string[]): Promise<void>
  listMemoryIds(afterId: string | null, limit: number): Promise<string[]>
  close(): Promise<void>
  isUsable(): boolean
}

export interface MemoryVectorStoreFactoryPort {
  createVectorStore(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number
  ): Promise<IMemoryVectorStore>
  resetVectorStore(agentId: string): Promise<void>
}

export interface MemoryChangeSinkPort {
  onMemoryChanged?(
    agentId: string,
    reason: MemoryUpdateReason,
    context?: { memoryId?: string; sessionId?: string | null; createdIds?: string[] }
  ): void
}

export interface MemoryProvenanceResolverPort {
  resolveProvenance(agentId: string, kind: string, content: string): AgentMemoryRow | undefined
}

export interface MemoryPendingEmbeddableRowPort {
  isPendingEmbeddableRow(agentId: string, row: AgentMemoryRow | undefined): boolean
}

export interface MemoryWriteMutationPort extends MemoryProvenanceResolverPort {
  insertMemory(
    agentId: string,
    candidate: NormalizedMemoryCandidate,
    content: string,
    provenanceKey: string,
    options: WriteMemoriesOptions
  ): string | null
  insertConflictedMemory(
    agentId: string,
    candidate: NormalizedMemoryCandidate,
    content: string,
    provenanceKey: string,
    targetId: string,
    options: WriteMemoriesOptions
  ): string | null
  bumpConfidence(id: string): void
  supersedeHead(agentId: string, row: AgentMemoryRow): AgentMemoryRow
  handleProvenanceHit(
    agentId: string,
    existing: AgentMemoryRow,
    options?: { allowDecisionForSuperseded?: boolean }
  ): ProvenanceHitResult
  reviveSupersededAfterDecision(
    agentId: string,
    existing: AgentMemoryRow
  ): { retiredHeadId: string | null }
}

export interface MemoryManualEditPort {
  applyManualContentEdit(
    agentId: string,
    row: AgentMemoryRow,
    candidate: NormalizedMemoryCandidate,
    content: string,
    now: number,
    options: WriteMemoriesOptions,
    providedFields: ManualEditFieldFlags
  ): ContentUpdateResult
}

export interface MemoryMaintenanceRowMutationPort extends MemoryProvenanceResolverPort {
  bumpConfidence(id: string): void
}

export interface MemoryRetrievalPort {
  fuse(
    fts: AgentMemoryRow[],
    vec: { row: AgentMemoryRow; similarity: number }[],
    opts: FuseOptions
  ): MemoryRecallItem[]
}

export const MEMORY_PERF_COUNTER_NAMES = [
  'sqliteStatements',
  'repositoryCalls',
  'materializedRows',
  'providerCalls',
  'duckDbStatements'
] as const

export const MEMORY_PERF_HIGH_WATER_NAMES = [
  'openStores',
  'activeLeases',
  'queueDepth',
  'cacheEntries'
] as const

export type MemoryPerfCounterName = (typeof MEMORY_PERF_COUNTER_NAMES)[number]
export type MemoryPerfHighWaterName = (typeof MEMORY_PERF_HIGH_WATER_NAMES)[number]

export interface MemoryPerfObserver {
  increment(name: MemoryPerfCounterName, amount?: number): void
  observe(name: MemoryPerfHighWaterName, value: number): void
}

export interface VectorStoreRetrievalPort {
  hasReadyCertificate(agentId: string, embedding: MemoryModelRef): boolean
  query(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    vector: number[],
    topK: number
  ): Promise<MemoryVectorMatch[]>
  queryBatch(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    vectors: readonly number[][],
    topK: number
  ): Promise<MemoryVectorMatch[][]>
  markReady(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    leaseEpoch?: number
  ): void
  clearReady(agentId: string): void
}

export interface WorkingMemoryReadPort {
  readWorkingMemory(agentId: string): string | null
  flushWorkingMemoryIfDirty(agentId: string): void
  scheduleWorkingRefresh(agentId: string): void
}
