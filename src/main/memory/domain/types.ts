import type {
  AgentMemoryCategory,
  AgentMemoryEmbeddingState,
  AgentMemoryHealthCategory,
  AgentMemoryLifecycleState,
  AgentMemoryScopeType,
  AgentMemoryTemporalKind,
  AgentMemoryTemporalPrecision,
  LegacyAgentMemoryStatus
} from '@shared/types/agent-memory'
import { AGENT_MEMORY_HEALTH_KIND_KEYS } from '@shared/types/agent-memory'

export type MemoryModelRef = { providerId: string; modelId: string }

export type VectorStoreCleanupDisposition = 'completed' | 'pending-restart'

export interface MemoryClearResult {
  removed: number
  cleanupPendingRestart: boolean
}

export type MemoryClearPhase = 'claims' | 'vectors'

export interface MemoryClearJob {
  agentId: string
  cutoffRowId: number
  createdAt: number
  removed: number
  phase: MemoryClearPhase
}

export interface MemoryClearBatchResult {
  job: MemoryClearJob
  removedInBatch: number
}

export interface DeletedAgentMemoryCleanupResult {
  cleanupPendingRestart: boolean
}

export class VectorStoreQuarantineMarkerError extends Error {
  constructor(agentId: string, cause: unknown) {
    super(`[Memory] failed to persist vector quarantine marker for ${agentId}: ${String(cause)}`, {
      cause
    })
    this.name = 'VectorStoreQuarantineMarkerError'
  }
}

export class VectorStoreQueryTimeoutError extends Error {
  constructor(
    readonly agentId: string,
    readonly timeoutMs: number
  ) {
    super(`[Memory] vector store query timed out for ${agentId} after ${timeoutMs}ms`)
    this.name = 'VectorStoreQueryTimeoutError'
  }
}

export class VectorStoreOperationTimeoutError extends Error {
  constructor(
    readonly agentId: string,
    readonly operation: string,
    readonly timeoutMs: number
  ) {
    super(`[Memory] vector store ${operation} timed out for ${agentId} after ${timeoutMs}ms`)
    this.name = 'VectorStoreOperationTimeoutError'
  }
}

export class VectorStoreLeaseUnavailableError extends Error {
  constructor(
    readonly reason: 'stopped' | 'admission-closed' | 'quarantined' | 'stale-identity',
    message: string
  ) {
    super(message)
    this.name = 'VectorStoreLeaseUnavailableError'
  }
}

export type AgentMemoryKind = (typeof AGENT_MEMORY_HEALTH_KIND_KEYS)[number]
export type AgentMemoryStatus = LegacyAgentMemoryStatus
export type { AgentMemoryEmbeddingState, AgentMemoryLifecycleState }
export type { AgentMemoryScopeType }
export type AgentMemoryConflictState = 'challenged'
export type AgentMemoryPersonaState = 'draft' | 'active' | 'superseded' | 'rejected'
export type { AgentMemoryTemporalKind, AgentMemoryTemporalPrecision }

export interface MemoryTemporalMetadata {
  temporalKind: AgentMemoryTemporalKind
  validFrom: number | null
  validUntil: number | null
  temporalConfidence: number | null
  temporalPrecision: AgentMemoryTemporalPrecision | null
  temporalTimeZone: string | null
}

export type MemoryScope =
  | { type: 'agent' }
  | { type: Exclude<AgentMemoryScopeType, 'agent'>; id: string }

export interface MemoryScopeContext {
  userId?: string
  projectId?: string
  sessionId?: string
}

export type MemoryTemporalPolicyMode = 'current' | 'evidence'
export type MemoryTemporalStatus =
  | 'atemporal'
  | 'current'
  | 'undated'
  | 'future'
  | 'expired'
  | 'historical'
  | 'future_event'
  | 'planned'
  | 'previously_planned'
  | 'recurring'
  | 'future_recurrence'
  | 'ended_recurrence'

export interface MemoryTemporalPolicyResult {
  eligible: boolean
  scoreFactor: number
  status: MemoryTemporalStatus
  annotation: string | null
}

export interface MemoryTemporalTrace {
  status: MemoryTemporalStatus
  confidence: number | null
  factor: number
}

export type MemoryTombstoneIdentityKind = 'provenance' | 'content'
export type MemoryTombstoneReason = 'selective_delete' | 'agent_clear'
export type MemoryDerivationKind = 'merge' | 'reflection' | 'supersede' | 'manual_edit'

export interface MemoryTombstoneIdentity {
  identityKind: MemoryTombstoneIdentityKind
  identityHash: string
}

export interface MemoryTombstoneDeleteInput {
  agentId: string
  id: string
  expectedRevision: number
  createdAt: number
}

export interface MemoryDerivationInsertInput {
  agentId: string
  parentMemoryId: string
  childMemoryId: string
  derivationKind: MemoryDerivationKind
  createdAt: number
}

export interface AgentMemoryDerivationRow {
  agent_id: string
  parent_memory_id: string
  child_memory_id: string
  derivation_kind: MemoryDerivationKind
  created_at: number
}

export interface MemoryDirtySeed {
  memoryId: string
  generation: number
  claimRevision: number
  enqueuedAt: number
}

export type MemoryClaimInsertResult =
  | { action: 'inserted'; id: string }
  | { action: 'suppressed'; reason: 'forgotten' | 'collision' }

export type MemoryExplicitRelearnResult =
  | { action: 'inserted'; id: string }
  | { action: 'not-forgotten' }
  | { action: 'suppressed'; reason: 'collision' }

export type MemoryClaimContentUpdateResult =
  | { action: 'updated' }
  | { action: 'suppressed'; reason: 'forgotten' | 'concurrent-update' }

export interface MemoryTransitionTarget {
  agentId: string
  id: string
  expectedRevision: number
}

export interface ReviveSupersededTransition extends MemoryTransitionTarget {
  retiredHead?: {
    id: string
    expectedRevision: number
  } | null
}

interface ResolveChallengerTransitionBase extends MemoryTransitionTarget {
  targetId: string
}

export type ResolveChallengerTransition = ResolveChallengerTransitionBase &
  (
    | {
        content?: never
        provenanceKey?: never
        category?: never
        temporal?: never
        at?: never
      }
    | {
        content: string
        provenanceKey: string | null
        category?: string | null
        temporal?: MemoryTemporalMetadata
        at: number
      }
  )

export interface ArchiveChallengerTransition extends MemoryTransitionTarget {
  targetId: string
  winnerId: string
}

export interface ArchiveConflictTargetTransition extends MemoryTransitionTarget {
  challengerId: string
}

export interface UserContentTransition extends MemoryTransitionTarget {
  content: string
  provenanceKey: string | null
  at: number
  category?: string | null
  importance?: number
  temporal?: MemoryTemporalMetadata
}

export interface InternalContentTransition extends MemoryTransitionTarget {
  content: string
  provenanceKey: string | null
  at: number
}

export interface UserMetadataTransition extends MemoryTransitionTarget {
  category?: string | null
  importance?: number
  lastAccessedAt?: number
  temporal?: MemoryTemporalMetadata
}

export interface AgentMemoryRow {
  id: string
  agent_id: string
  user_scope: string | null
  scope_type: AgentMemoryScopeType
  scope_id: string | null
  kind: AgentMemoryKind
  category: string | null
  content: string
  importance: number
  status: AgentMemoryStatus
  lifecycle_state: AgentMemoryLifecycleState
  embedding_state: AgentMemoryEmbeddingState
  embedding_id: string | null
  embedding_dim: number | null
  embedding_model: string | null
  source_session: string | null
  provenance_key: string | null
  is_anchor: number
  superseded_by: string | null
  created_at: number
  last_accessed: number | null
  access_count: number
  decay_score: number | null
  source_entry_ids: string | null
  confidence: number | null
  temporal_kind: AgentMemoryTemporalKind
  valid_from: number | null
  valid_until: number | null
  temporal_confidence: number | null
  temporal_precision: AgentMemoryTemporalPrecision | null
  temporal_timezone: string | null
  last_consolidated_at: number | null
  conflict_state: string | null
  conflict_with: string | null
  persona_state: string | null
  decision_revision: number
}

export type CanonicalAgentMemoryRow = Omit<AgentMemoryRow, 'status'>

export interface AgentMemoryWorkingCandidateCursor {
  importance: number
  accessCount: number
  createdAt: number
  id: string
}

export type AgentMemoryLifecycleRow = Pick<
  CanonicalAgentMemoryRow,
  | 'id'
  | 'agent_id'
  | 'kind'
  | 'importance'
  | 'lifecycle_state'
  | 'embedding_state'
  | 'is_anchor'
  | 'superseded_by'
  | 'created_at'
  | 'last_accessed'
  | 'access_count'
  | 'decay_score'
  | 'confidence'
  | 'conflict_state'
>

type AgentMemoryCanonicalInsertState =
  | {
      lifecycleState: AgentMemoryLifecycleState
      embeddingState: AgentMemoryEmbeddingState
    }
  | {
      lifecycleState?: never
      embeddingState?: never
    }

export type AgentMemoryInsertInput = {
  id: string
  agentId: string
  kind: AgentMemoryKind
  category?: AgentMemoryCategory | null
  content: string
  importance?: number
  status?: AgentMemoryStatus
  scope?: MemoryScope
  sourceSession?: string | null
  provenanceKey?: string | null
  isAnchor?: boolean
  createdAt?: number
  sourceEntryIds?: number[] | null
  temporal?: MemoryTemporalMetadata
  conflictWith?: string | null
  personaState?: AgentMemoryPersonaState | null
} & AgentMemoryCanonicalInsertState

export type InternalMemoryInsertInput = AgentMemoryInsertInput & {
  kind: Extract<AgentMemoryKind, 'persona' | 'working'>
}

export interface AgentMemoryListOptions {
  kinds?: AgentMemoryKind[]
  statuses?: AgentMemoryStatus[]
  includeSuperseded?: boolean
  includeArchived?: boolean
  limit?: number
}

export interface AgentMemoryHealthStats {
  totalRows: number
  byKind: Record<AgentMemoryKind, number>
  byCategory: Record<AgentMemoryHealthCategory, number>
  byStatus: Record<AgentMemoryStatus, number>
  neverAccessed: number
  importanceAvg: number | null
  importanceMedian: number | null
  confidenceAvg: number | null
  conflicted: number
  challenged: number
}

export interface EmbeddedMemoryUpdate {
  id: string
  expectedRevision: number
  embeddingId: string
  embeddingDim: number
  embeddingModel: string
}

export interface FailedEmbeddingUpdate {
  id: string
  expectedRevision: number
}

export interface MemoryCognitiveMaintenanceInput {
  eligibleCount: number
  importanceAfterWatermark: number
  maxCreatedAt: number
  topRows: CanonicalAgentMemoryRow[]
}

export interface MemoryVectorRecord {
  memoryId: string
  embedding: number[]
}

export interface MemoryVectorMatch {
  memoryId: string
  distance: number
}

export interface MemoryVectorQueryOptions {
  topK: number
}

export interface MemoryVectorRef {
  id: string
  embeddingDim: number
  embeddingModel: string
}

export interface MemoryManagementPageCursor {
  createdAt: number
  id: string
}

export interface MemoryManagementPage {
  rows: CanonicalAgentMemoryRow[]
  nextCursor: MemoryManagementPageCursor | null
}

export interface MemoryCandidate {
  kind?: Extract<AgentMemoryKind, 'episodic' | 'semantic'> | null
  category?: string | null
  content: string
  importance?: number
  temporal?: MemoryTemporalMetadata
}

export interface NormalizedMemoryCandidate {
  kind: Extract<AgentMemoryKind, 'episodic' | 'semantic'>
  category: AgentMemoryCategory | null
  content: string
  importance: number
  temporal: MemoryTemporalMetadata
}

export interface WriteMemoriesOptions {
  agentId: string
  sourceSession?: string | null
  scope?: MemoryScope
  sourceEntryIds?: number[] | null
}

export type MemoryWriteOutcome =
  | { action: 'created'; id: string; reauthorized?: boolean }
  | { action: 'updated'; id: string }
  | { action: 'superseded'; id: string; supersededId: string; created?: boolean }
  | { action: 'noop'; reason: string; id?: string }
  | { action: 'challenged'; targetId: string; challengerId: string }

export type MemoryConflictResolution = 'keep_target' | 'keep_challenger' | 'keep_both'

export interface MemoryConflictPair {
  challenger: CanonicalAgentMemoryRow
  target: CanonicalAgentMemoryRow
}

export interface MemoryRecallItem {
  id: string
  decisionRevision: number
  kind: AgentMemoryKind
  content: string
  score: number
  importance: number
  sources?: { vec?: boolean; fts?: boolean }
  similarity?: number
  sourceSession?: string | null
  sourceEntryIds?: number[] | null
  temporal?: MemoryTemporalMetadata
  temporalAnnotation?: string
  breakdown?: {
    similarity: number
    recency: number
    importance: number
    confidence: number
    rrf: number
    final: number
    temporal?: MemoryTemporalTrace
  }
}

export interface MemoryDecisionNeighborSet {
  neighbors: MemoryRecallItem[]
  queryVector?: MemoryDecisionQueryVectorSnapshot
}

export interface MemoryDecisionQueryVectorSnapshot {
  vector: number[]
  providerId: string
  modelId: string
  dimensions: number
}

export type MemoryKeywordSearchStrategy = 'fts-only' | 'like-fallback'

export interface MemoryKeywordSearchResult {
  rows: CanonicalAgentMemoryRow[]
  strategy: MemoryKeywordSearchStrategy
}

export interface MemorySearchHit {
  row: CanonicalAgentMemoryRow
  score: number
  sources?: { vec?: boolean; fts?: boolean }
  similarity?: number
}

export interface RetrievalCandidate {
  row: CanonicalAgentMemoryRow
  similarity?: number
  sources: { vec?: boolean; fts?: boolean }
}

export interface FuseOptions {
  topK: number
  rrfK: number
  weights: { similarity: number; recency: number; importance: number }
  now: number
  halfLifeMs?: number
  ftsBaseline?: number
  trace?: boolean
  temporalMode?: MemoryTemporalPolicyMode
}

export interface MemoryStatus {
  total: number
  pendingEmbedding: number
  hasPersona: boolean
  activeMemoryCount: number
  archivedMemoryCount: number
  conflictCount: number
  personaDraftCount: number
  personaVersionCount: number
  directiveDraftCount: number
  activeDirectiveCount: number
  reindexing?: boolean
  lastReindex?: MemoryReindexResult
}

export type MemoryReindexOutcome = 'completed' | 'blocked' | 'aborted'

export type MemoryReindexErrorCode =
  | 'agent-unavailable'
  | 'embedding-model-changed'
  | 'embedding-invalid'
  | 'vector-store-unavailable'
  | 'pending-restart'
  | 'drain-stalled'

export interface MemoryReindexError {
  message: string
  retryable: boolean
  code?: MemoryReindexErrorCode
}

export interface MemoryReindexResult {
  outcome: MemoryReindexOutcome
  finishedAt: number
  lastError: MemoryReindexError | null
}

export interface MemoryUpdateContext {
  memoryId?: string
  directiveId?: string
  sessionId?: string | null
  createdIds?: string[]
}

export interface MemoryExtractionInput {
  agentId: string
  spanText: string
  model: MemoryModelRef
  scope?: MemoryScope
  sourceSession?: string | null
  sourceEntryIds?: number[] | null
}

export type MemoryExtractionResult = { ok: true; createdIds: string[] } | { ok: false }

export interface MemoryReflectionResult {
  reflectionIds: string[]
  sourceMemoryIds: string[]
}

export interface MemoryMaintenanceStepResult {
  touched: boolean
  calls: number
  failures: number
}

export interface MemoryMaintenanceReflectionResult {
  result: MemoryReflectionResult | null
  calls: number
  failures: number
}

export interface MemoryMaintenancePersonaResult {
  result: MemoryPersonaDraftResult | null
  calls: number
  failures: number
}

export interface MemoryPersonaDraftResult {
  draftId: string
  needsReview: boolean
  changeRatio: number
}

export type ProvenanceHitResult =
  | { action: 'absorbed' }
  | { action: 'continue' }
  | { action: 'noop'; reason: string }

export type ContentUpdateResult =
  | { action: 'updated'; id: string }
  | { action: 'folded'; id: string; retiredHeadId?: string }
  | {
      action: 'superseded'
      id: string
      supersededId: string
      created?: boolean
      retiredHeadId?: string
    }
  | { action: 'suppressed'; id: string; reason: string }

export interface ManualEditFieldFlags {
  category: boolean
  importance: boolean
}
