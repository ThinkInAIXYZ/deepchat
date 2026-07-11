import type { AgentMemoryCategory, AgentMemoryHealthCategory } from '@shared/types/agent-memory'
import {
  AGENT_MEMORY_HEALTH_KIND_KEYS,
  AGENT_MEMORY_HEALTH_STATUS_KEYS
} from '@shared/types/agent-memory'

export type MemoryModelRef = { providerId: string; modelId: string }

export type AgentMemoryKind = (typeof AGENT_MEMORY_HEALTH_KIND_KEYS)[number]
export type AgentMemoryStatus = (typeof AGENT_MEMORY_HEALTH_STATUS_KEYS)[number]
export type AgentMemoryConflictState = 'challenged'
export type AgentMemoryPersonaState = 'draft' | 'active' | 'superseded' | 'rejected'

export interface AgentMemoryRow {
  id: string
  agent_id: string
  user_scope: string | null
  kind: AgentMemoryKind
  category: string | null
  content: string
  importance: number
  status: AgentMemoryStatus
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
  last_consolidated_at: number | null
  conflict_state: string | null
  conflict_with: string | null
  persona_state: string | null
  decision_revision: number
}

export interface AgentMemoryWorkingCandidateCursor {
  importance: number
  accessCount: number
  createdAt: number
  id: string
}

export type AgentMemoryLifecycleRow = Pick<
  AgentMemoryRow,
  | 'id'
  | 'agent_id'
  | 'kind'
  | 'importance'
  | 'status'
  | 'is_anchor'
  | 'superseded_by'
  | 'created_at'
  | 'last_accessed'
  | 'access_count'
  | 'decay_score'
  | 'confidence'
  | 'conflict_state'
>

export interface AgentMemoryInsertInput {
  id: string
  agentId: string
  kind: AgentMemoryKind
  category?: AgentMemoryCategory | null
  content: string
  importance?: number
  status?: AgentMemoryStatus
  userScope?: string | null
  sourceSession?: string | null
  provenanceKey?: string | null
  isAnchor?: boolean
  createdAt?: number
  sourceEntryIds?: number[] | null
  conflictWith?: string | null
  personaState?: AgentMemoryPersonaState | null
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
  topRows: AgentMemoryRow[]
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

export interface ConsolidationScanCursor {
  createdAt: number
  id: string
}

export interface MemoryManagementPageCursor {
  createdAt: number
  id: string
}

export interface MemoryManagementPage {
  rows: AgentMemoryRow[]
  nextCursor: MemoryManagementPageCursor | null
}

export interface MemoryCandidate {
  kind?: Extract<AgentMemoryKind, 'episodic' | 'semantic'> | null
  category?: string | null
  content: string
  importance?: number
}

export interface NormalizedMemoryCandidate {
  kind: Extract<AgentMemoryKind, 'episodic' | 'semantic'>
  category: AgentMemoryCategory | null
  content: string
  importance: number
}

export interface WriteMemoriesOptions {
  agentId: string
  sourceSession?: string | null
  userScope?: string | null
  sourceEntryIds?: number[] | null
}

export type MemoryWriteOutcome =
  | { action: 'created'; id: string }
  | { action: 'updated'; id: string }
  | { action: 'superseded'; id: string; supersededId: string; created?: boolean }
  | { action: 'noop'; reason: string; id?: string }
  | { action: 'challenged'; targetId: string; challengerId: string }

export type MemoryConflictResolution = 'keep_target' | 'keep_challenger' | 'keep_both'

export interface MemoryConflictPair {
  challenger: AgentMemoryRow
  target: AgentMemoryRow
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
  breakdown?: {
    similarity: number
    recency: number
    importance: number
    confidence: number
    rrf: number
    final: number
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
  rows: AgentMemoryRow[]
  strategy: MemoryKeywordSearchStrategy
}

export interface MemorySearchHit {
  row: AgentMemoryRow
  score: number
  sources?: { vec?: boolean; fts?: boolean }
  similarity?: number
}

export interface RetrievalCandidate {
  row: AgentMemoryRow
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
  reindexing?: boolean
}

export interface MemoryUpdateContext {
  memoryId?: string
  sessionId?: string | null
  createdIds?: string[]
}

export interface MemoryExtractionInput {
  agentId: string
  spanText: string
  model: MemoryModelRef
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
  | { action: 'folded'; id: string }
  | { action: 'superseded'; id: string; supersededId: string; created?: boolean }
  | { action: 'suppressed'; id: string; reason: string }

export interface ManualEditFieldFlags {
  category: boolean
  importance: boolean
}
