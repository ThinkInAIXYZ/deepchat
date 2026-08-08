import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import type { LLM_EMBEDDING_ATTRS } from '@shared/types/provider'
import type { MemoryUpdateReason } from '@shared/contracts/events/memory.events'

import type {
  AgentMemoryHealthAuditStats,
  AgentMemoryAuditInsertInput,
  AgentMemoryAuditRow,
  MemoryAuditListOptions
} from './domain/audit'
import type {
  AgentMemoryDirectiveRow,
  MemoryDirectiveCounts,
  MemoryDirectiveInsertResult,
  MemoryDirectiveTransitionResult,
  MemoryDirectiveWriteInput,
  MemoryDirectiveWriteResult
} from './domain/directives'
import type {
  AgentMemoryHealthStats,
  AgentMemoryDerivationRow,
  AgentMemoryEmbeddingState,
  AgentMemoryInsertInput,
  AgentMemoryKind,
  AgentMemoryLifecycleRow,
  AgentMemoryListOptions,
  AgentMemoryPersonaState,
  AgentMemoryConflictState,
  CanonicalAgentMemoryRow as AgentMemoryRow,
  AgentMemoryStatus,
  AgentMemoryWorkingCandidateCursor,
  ContentUpdateResult,
  EmbeddedMemoryUpdate,
  FailedEmbeddingUpdate,
  FuseOptions,
  ManualEditFieldFlags,
  MemoryCognitiveMaintenanceInput,
  MemoryManagementPageCursor,
  MemoryClearBatchResult,
  MemoryClearJob,
  MemoryDerivationInsertInput,
  MemoryDirtySeed,
  MemoryModelRef,
  MemoryClaimContentUpdateResult,
  MemoryClaimInsertResult,
  MemoryExplicitRelearnResult,
  MemoryTransitionTarget,
  MemoryTemporalMetadata,
  MemoryTombstoneDeleteInput,
  ResolveChallengerTransition,
  ReviveSupersededTransition,
  ArchiveChallengerTransition,
  ArchiveConflictTargetTransition,
  UserContentTransition,
  UserMetadataTransition,
  InternalContentTransition,
  InternalMemoryInsertInput,
  MemoryRecallItem,
  MemoryScope,
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
  hasTombstoneForClaim(
    input: Pick<AgentMemoryInsertInput, 'agentId' | 'kind' | 'content' | 'provenanceKey' | 'scope'>
  ): boolean
  listByAgent(agentId: string, options?: AgentMemoryListOptions): AgentMemoryRow[]
  listManagementPage(
    agentId: string,
    cursor: MemoryManagementPageCursor | null,
    limit: number
  ): AgentMemoryRow[]
  listManagementVisibleByIds(agentId: string, ids: string[]): AgentMemoryRow[]
  listByIds(agentId: string, ids: string[]): AgentMemoryRow[]
  listApplicableByIds(
    agentId: string,
    ids: string[],
    scopeFilter?: readonly MemoryScope[]
  ): AgentMemoryRow[]
  getActivePersona(agentId: string): AgentMemoryRow | undefined
  getDraftPersona(agentId: string): AgentMemoryRow | undefined
  listPersonaVersions(agentId: string): AgentMemoryRow[]
  search(
    agentId: string,
    query: string,
    limit?: number,
    options?: { matchMode?: 'all' | 'any'; scopeFilter?: readonly MemoryScope[] }
  ): AgentMemoryRow[]
  searchWithStrategy(
    agentId: string,
    query: string,
    limit?: number,
    options?: { matchMode?: 'all' | 'any'; scopeFilter?: readonly MemoryScope[] }
  ): { rows: AgentMemoryRow[]; strategy: 'fts-only' | 'like-fallback' }
  listWorkingCandidates(
    agentId: string,
    limit: number,
    after?: AgentMemoryWorkingCandidateCursor
  ): AgentMemoryRow[]
  listAgentIdsWithMemories(): string[]
  listRecentlyActiveAgentIds(candidateAgentIds: readonly string[], limit: number): string[]
  hasActiveMemory(agentId: string): boolean
  listPendingMemoryClearJobs(): MemoryClearJob[]
}

export interface MemoryMutationRepositoryPort {
  insertInternalMemory(input: InternalMemoryInsertInput): AgentMemoryRow
  insertClaimUnlessTombstoned(input: AgentMemoryInsertInput): AgentMemoryRow | null
  insertExplicitlyReauthorizedClaim(input: AgentMemoryInsertInput): AgentMemoryRow | null
  rekeyProvenance(agentId: string, id: string, expectedKey: string, nextKey: string): boolean
  updateInternalContent(input: InternalContentTransition): boolean
  updateUserContentAndInvalidateEmbedding(
    input: UserContentTransition
  ): MemoryClaimContentUpdateResult
  updateUserMetadataIfRevision(input: UserMetadataTransition): boolean
  // Confidence-only bookkeeping is suppressed while the row's Agent clear is pending.
  setConfidence(id: string, confidence: number): void
  setPersonaState(id: string, state: AgentMemoryPersonaState, supersededBy?: string | null): void
  setAnchor(id: string, anchored: boolean): void
  markSupersededIfRevision(
    agentId: string,
    id: string,
    expectedRevision: number,
    supersededBy: string
  ): boolean
  markConflictIfRevision(
    agentId: string,
    id: string,
    expectedRevision: number,
    state: AgentMemoryConflictState
  ): boolean
  deleteInternalMemory(agentId: string, id: string): boolean
  tombstoneAndDelete(input: MemoryTombstoneDeleteInput): AgentMemoryRow | null
  beginMemoryClear(agentId: string, createdAt: number): MemoryClearJob
  processMemoryClearBatch(agentId: string): MemoryClearBatchResult | null
  completeMemoryClear(agentId: string): boolean
  retireAgentMemoryNamespace(agentId: string): number
}

export interface MemoryAccessRepositoryPort {
  // Bookkeeping writes atomically no-op when the owning Agent has a pending durable clear job.
  recordAccess(id: string, accessedAt?: number): void
  recordAccessBatch(ids: string[], accessedAt?: number): void
}

export interface MemoryEmbeddingRepositoryPort {
  listPendingEmbedding(limit?: number, agentId?: string): AgentMemoryRow[]
  countPendingEmbedding(agentId?: string): number
  markPendingEmbeddingsReady(agentId: string, updates: readonly EmbeddedMemoryUpdate[]): string[]
  markPendingEmbeddingsError(
    agentId: string,
    updates: readonly FailedEmbeddingUpdate[],
    status?: Extract<AgentMemoryStatus, 'error' | 'fts_only'>
  ): string[]
  requeueForEmbedding(
    agentId: string,
    states: AgentMemoryEmbeddingState[],
    limit?: number,
    afterId?: string | null
  ): number
  listEmbeddingStateIds(
    agentId: string,
    states: AgentMemoryEmbeddingState[],
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
  // Row-only maintenance bookkeeping follows the same pending-clear no-op contract as access.
  updateDecayScore(id: string, decayScore: number | null, consolidatedAt?: number | null): void
  setLastConsolidatedAt(id: string, at?: number): void
  getLastConsolidatedAt(agentId: string): number | null
  archiveActiveMemory(input: MemoryTransitionTarget): boolean
  restoreArchivedMemory(input: MemoryTransitionTarget): boolean
  reviveSupersededMemory(input: ReviveSupersededTransition): boolean
  activateResolvedChallenger(input: ResolveChallengerTransition): boolean
  archiveResolvedChallenger(input: ArchiveChallengerTransition): boolean
  archiveResolvedConflictTarget(input: ArchiveConflictTargetTransition): boolean
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
  countLegacyShadowMismatches(agentId?: string): number
}

export interface MemoryTransactionPort {
  runInTransaction<T>(fn: () => T): T
}

export interface MemoryLineageRepositoryPort {
  insertDerivations(inputs: readonly MemoryDerivationInsertInput[]): number
  listDerivationsByChild(agentId: string, childMemoryId: string): AgentMemoryDerivationRow[]
  listDerivationsByParent(agentId: string, parentMemoryId: string): AgentMemoryDerivationRow[]
}

export interface MemoryDirtyRepositoryPort {
  listDirtySeeds(agentId: string, limit: number): MemoryDirtySeed[]
  settleDirtySeeds(agentId: string, seeds: readonly MemoryDirtySeed[]): number
  deferDirtySeeds(agentId: string, seeds: readonly MemoryDirtySeed[], deferredAt: number): number
  countDirtySeeds(agentId: string): number
}

export interface MemoryDirectiveRepositoryPort {
  getDirective(agentId: string, directiveId: string): AgentMemoryDirectiveRow | undefined
  listDirectives(
    agentId: string,
    options?: {
      statuses?: readonly AgentMemoryDirectiveRow['status'][]
      limit?: number
    }
  ): AgentMemoryDirectiveRow[]
  listActiveDirectives(agentId: string, limit: number): AgentMemoryDirectiveRow[]
  upsertExplicitDirective(input: MemoryDirectiveWriteInput): MemoryDirectiveWriteResult
  insertDerivedDirectiveDraft(input: MemoryDirectiveWriteInput): MemoryDirectiveInsertResult
  transitionDirective(
    agentId: string,
    directiveId: string,
    fromStatus: AgentMemoryDirectiveRow['status'],
    toStatus: AgentMemoryDirectiveRow['status'],
    updatedAt: number
  ): MemoryDirectiveTransitionResult
  deleteDirective(agentId: string, directiveId: string): AgentMemoryDirectiveRow | null
  countDirectivesByStatus(agentId: string): MemoryDirectiveCounts
  retireDirectiveNamespace(agentId: string): number
}

export interface MemoryRepositoryPort
  extends
    MemoryReadRepositoryPort,
    MemoryMutationRepositoryPort,
    MemoryAccessRepositoryPort,
    MemoryEmbeddingRepositoryPort,
    MemoryLifecycleRepositoryPort,
    MemoryHealthRepositoryPort,
    MemoryLineageRepositoryPort,
    MemoryDirtyRepositoryPort,
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
  // Compatibility fallback for unfiltered managed DeepChat Agent enumeration.
  listManagedAgentIds?(): string[]
  // Bulk resolved configs for all managed DeepChat Agents, including disabled Agents.
  listManagedAgentConfigs?(): Array<{ agentId: string; config: DeepChatAgentConfig }>
  // Enabled Agents eligible for prewarm and maintenance scheduling.
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
  diagnostics?: {
    recordProviderAdmissionDecision(outcome: 'admitted' | 'rateLimited' | 'capacityRejected'): void
    recordProviderRaceEvent(outcome: 'deadline' | 'aborted' | 'lateSettled'): void
  }
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
  markVectorStoreQuarantined(agentId: string): void
}

export interface MemoryChangeSinkPort {
  onMemoryChanged?(
    agentId: string,
    reason: MemoryUpdateReason,
    context?: { memoryId?: string; sessionId?: string | null; createdIds?: string[] }
  ): void
}

export interface MemoryProvenanceResolverPort {
  resolveProvenance(
    agentId: string,
    kind: string,
    content: string,
    scope: MemoryScope,
    beforeMutation?: () => void
  ): AgentMemoryRow | undefined
}

export interface MemoryPendingEmbeddableRowPort {
  isPendingEmbeddableRow(agentId: string, row: AgentMemoryRow | undefined): boolean
}

export interface MemoryWriteMutationPort extends MemoryProvenanceResolverPort {
  reauthorizeForgottenMemory(
    agentId: string,
    candidate: NormalizedMemoryCandidate,
    content: string,
    options: WriteMemoriesOptions,
    createdAt: number
  ): MemoryExplicitRelearnResult
  insertMemory(
    agentId: string,
    candidate: NormalizedMemoryCandidate,
    content: string,
    options: WriteMemoriesOptions,
    createdAt: number
  ): MemoryClaimInsertResult
  insertConflictedMemory(
    agentId: string,
    candidate: NormalizedMemoryCandidate,
    content: string,
    targetId: string,
    options: WriteMemoriesOptions,
    createdAt: number
  ): MemoryClaimInsertResult
  bumpConfidence(id: string): void
  enrichEquivalentClaimTemporalMetadata(
    agentId: string,
    existing: AgentMemoryRow,
    incoming: MemoryTemporalMetadata,
    beforeMutation?: () => void
  ): boolean
  supersedeHead(agentId: string, row: AgentMemoryRow): AgentMemoryRow
  handleProvenanceHit(
    agentId: string,
    existing: AgentMemoryRow,
    options?: { allowDecisionForSuperseded?: boolean }
  ): ProvenanceHitResult
  reviveSupersededAfterDecision(
    agentId: string,
    existing: AgentMemoryRow
  ): { applied: boolean; retiredHeadId: string | null }
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

export type VectorStoreRecallHealth = 'available' | 'suspect' | 'quarantined' | 'stopped'

export interface VectorStoreRetrievalPort {
  getRecallHealth(agentId: string): VectorStoreRecallHealth
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
