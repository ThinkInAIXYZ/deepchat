import type {
  AgentMemoryKind,
  AgentMemoryLifecycleRow,
  AgentMemoryRow,
  AgentMemoryStatus,
  AgentMemoryConflictState,
  AgentMemoryPersonaState,
  AgentMemoryInsertInput,
  AgentMemoryListOptions,
  AgentMemoryHealthStats
} from '../sqlitePresenter/tables/agentMemory'
import type {
  AgentMemoryAuditActorType,
  AgentMemoryAuditInsertInput,
  AgentMemoryAuditRow,
  AgentMemoryAuditStatus,
  AgentMemoryHealthAuditStats
} from '../sqlitePresenter/tables/agentMemoryAudit'
import type {
  DeepChatAgentConfig,
  DeepChatAgentMemoryRetrieval
} from '@shared/types/agent-interface'
import type { AgentMemoryCategory } from '@shared/types/agent-memory'
import type { LLM_EMBEDDING_ATTRS } from '@shared/presenter'

export type {
  AgentMemoryKind,
  AgentMemoryLifecycleRow,
  AgentMemoryRow,
  AgentMemoryStatus,
  AgentMemoryConflictState,
  AgentMemoryPersonaState,
  AgentMemoryInsertInput,
  AgentMemoryListOptions,
  AgentMemoryHealthStats
}

// SQLite repository port. AgentMemoryTable satisfies it structurally; the abstraction lets
// the presenter's scoring/dedup/staging logic be unit-tested without the native module.
export interface MemoryRepositoryPort {
  insert(input: AgentMemoryInsertInput): AgentMemoryRow
  getById(id: string): AgentMemoryRow | undefined
  getByProvenanceKey(agentId: string, provenanceKey: string): AgentMemoryRow | undefined
  listByAgent(agentId: string, options?: AgentMemoryListOptions): AgentMemoryRow[]
  getActivePersona(agentId: string): AgentMemoryRow | undefined
  getDraftPersona(agentId: string): AgentMemoryRow | undefined
  setPersonaState(id: string, state: AgentMemoryPersonaState, supersededBy?: string | null): void
  setAnchor(id: string, anchored: boolean): void
  listPersonaVersions(agentId: string): AgentMemoryRow[]
  search(agentId: string, query: string, limit?: number): AgentMemoryRow[]
  listPendingEmbedding(limit?: number, agentId?: string): AgentMemoryRow[]
  updateStatus(
    id: string,
    status: AgentMemoryStatus,
    embedding?: {
      embeddingId?: string | null
      embeddingDim?: number | null
      embeddingModel?: string | null
    }
  ): void
  updatePendingEmbeddingStatus(
    agentId: string,
    id: string,
    status: AgentMemoryStatus,
    embedding?: {
      embeddingId?: string | null
      embeddingDim?: number | null
      embeddingModel?: string | null
    }
  ): boolean
  // Bulk-resets the embedding state of an agent's non-superseded rows in the given statuses back
  // to pending_embedding (one SQL UPDATE), returning how many rows changed. Used by reindex and
  // backfill so the requeue never loops per row on the caller's stack.
  requeueForEmbedding(agentId: string, statuses: AgentMemoryStatus[]): number
  markSuperseded(id: string, supersededBy: string | null): void
  recordAccess(id: string, accessedAt?: number): void
  updateDecayScore(id: string, decayScore: number | null, consolidatedAt?: number | null): void
  updateContent(
    id: string,
    content: string,
    provenanceKey: string | null,
    at?: number,
    category?: string | null
  ): void
  setConfidence(id: string, confidence: number): void
  setImportance(id: string, importance: number): void
  markConflict(id: string, state: AgentMemoryConflictState | null): void
  setConflictWith(id: string, targetId: string | null): void
  setLastConsolidatedAt(id: string, at?: number): void
  getLastConsolidatedAt(agentId: string): number | null
  getCurrentEmbeddingDimension(agentId: string, fingerprint: string): number | null
  getHealthStats(agentId: string): AgentMemoryHealthStats
  hasStaleEmbeddings(agentId: string, currentDim: number, fingerprint: string): boolean
  countStaleEmbeddings(agentId: string, currentDim: number, fingerprint: string): number
  archive(id: string, at?: number): void
  listArchiveCandidates(agentId: string, before: number, decayBelow: number): AgentMemoryRow[]
  listArchiveCandidateLifecycleRows(
    agentId: string,
    before: number,
    limit: number
  ): AgentMemoryLifecycleRow[]
  countArchiveCandidates(agentId: string, before: number, decayBelow: number): number
  listTopAccessed(agentId: string, limit: number): AgentMemoryRow[]
  delete(id: string): void
  clearByAgent(agentId: string): number
  countByAgent(agentId: string): number
  hasActiveMemory(agentId: string): boolean
  listAgentIdsWithMemories(): string[]
}

export interface MemoryAuditRepositoryPort {
  insert(input: AgentMemoryAuditInsertInput): AgentMemoryAuditRow
  listByAgent(agentId: string, options?: number | MemoryAuditListOptions): AgentMemoryAuditRow[]
  getLatestCompletedEventAt(agentId: string, eventType: string): number | null
  getHealthAuditStats(
    agentId: string,
    scanLimit: number,
    failuresLimit: number
  ): AgentMemoryHealthAuditStats
}

export interface MemoryAuditListOptions {
  eventType?: string
  actorType?: AgentMemoryAuditActorType
  sessionId?: string
  status?: AgentMemoryAuditStatus
  startCreatedAt?: number
  endCreatedAt?: number
  limit?: number
}

export type {
  AgentMemoryAuditActorType,
  AgentMemoryAuditInsertInput,
  AgentMemoryAuditRow,
  AgentMemoryAuditStatus
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
  threshold?: number
}

// Vector store port (DuckDB), isolated per agent: one database each, with independent dimensions.
export interface IMemoryVectorStore {
  upsert(records: MemoryVectorRecord[]): Promise<void>
  query(embedding: number[], options: MemoryVectorQueryOptions): Promise<MemoryVectorMatch[]>
  deleteByMemoryIds(memoryIds: string[]): Promise<void>
  close(): Promise<void>
  isUsable(): boolean
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
  /** Tape entry_id lineage; only persisted when sourceSession scopes them. */
  sourceEntryIds?: number[] | null
}

export type {
  MemoryInjectionPayload,
  MemoryInjectionPort,
  MemoryInjectionResult
} from './injectionPort'

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
  kind: AgentMemoryKind
  content: string
  score: number
  importance: number
  // Which retrieval path(s) surfaced this item; powers source-aware ranking and provenance UI.
  sources?: { vec?: boolean; fts?: boolean }
  // Raw vector similarity when surfaced by the vector path; used by consolidation near-dup gating.
  similarity?: number
  // Lineage back to the originating tape span, when the row carries it.
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

// A retrieval hit paired with its authoritative row for the read-only search facade. The route
// layer projects the row to the memory DTO and attaches the score; keeping the row here avoids the
// presenter depending on the DTO projection that lives at the IPC boundary.
export interface MemorySearchHit {
  row: AgentMemoryRow
  score: number
  sources?: { vec?: boolean; fts?: boolean }
  similarity?: number
}

// One ranked candidate from a single retrieval path, fed into RRF fusion.
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

// Pure fusion port: two already-ranked candidate lists in, one fused+reranked list out.
// Implemented as a free function in scoring.ts so it can be unit-tested without storage.
export interface MemoryRetrievalPort {
  fuse(
    fts: AgentMemoryRow[],
    vec: { row: AgentMemoryRow; similarity: number }[],
    opts: FuseOptions
  ): MemoryRecallItem[]
}

export interface MemoryStatus {
  total: number
  pendingEmbedding: number
  hasPersona: boolean
  // True while the agent's vectors are being rebuilt after an embedding model/dimension change.
  reindexing?: boolean
}

export interface MemoryPresenterDeps {
  repository: MemoryRepositoryPort
  auditRepository?: MemoryAuditRepositoryPort
  resolveAgentConfig: (agentId: string) => DeepChatAgentConfig | null
  resolveAgentDefaultModel?: (agentId: string) => { providerId: string; modelId: string } | null
  // True only for a real, existing DeepChat agent. Management surfaces use it to refuse
  // reads/writes against arbitrary or nonexistent agents; skipped when absent (e.g. tests).
  isManagedAgent?: (agentId: string) => boolean
  getEmbeddings: (providerId: string, modelId: string, texts: string[]) => Promise<number[][]>
  getDimensions: (
    providerId: string,
    modelId: string
  ) => Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }>
  generateText: (providerId: string, modelId: string, prompt: string) => Promise<string>
  // Creates/opens the agent's vector store: embedding identity validates it, dimensions seed
  // the first initialization.
  createVectorStore: (
    agentId: string,
    embedding: { providerId: string; modelId: string },
    dimensions: number
  ) => Promise<IMemoryVectorStore>
  // Deletes the agent's on-disk vector database (including wal) regardless of cache state, so a
  // restart with an empty cache still drops the old store and the next write rebuilds it under
  // the current embedding identity.
  resetVectorStore: (agentId: string) => Promise<void>
  // Fires after write/delete/clear/persona changes; the host bridges it to typed UI events.
  // Optional — without it the presenter is side-effect free (tests).
  onMemoryChanged?: (agentId: string, reason: MemoryUpdateReason) => void
}

// Mirrors MemoryUpdateReasonSchema in shared/contracts memory.events.
export type MemoryUpdateReason =
  | 'extract'
  | 'delete'
  | 'clear'
  | 'persona-evolve'
  | 'persona-anchor'
  | 'persona-draft'
  | 'persona-approve'
  | 'persona-reject'
  | 'persona-rollback'
  | 'reindex'

export interface MemoryExtractionInput {
  agentId: string
  spanText: string
  model: { providerId: string; modelId: string }
  sourceSession?: string | null
  sourceEntryIds?: number[] | null
}

// Distinguishes success (possibly 0 memories) from failure (model/parse error). The caller
// advances the memory cursor only on success, so a failure is retried next time.
export type MemoryExtractionResult = { ok: true; createdIds: string[] } | { ok: false }

// Outcome of a reflection pass: the new reflection rows plus the atomic memory ids that fed them.
// Both go into the audit anchor; only the reflection rows are recallable.
export interface MemoryReflectionResult {
  reflectionIds: string[]
  sourceMemoryIds: string[]
}

// Outcome of a guarded persona-evolution pass: the new draft (never auto-active) plus the measured
// drift from the current self-model. needsReview gates the draft out of any auto-approval path.
export interface MemoryPersonaDraftResult {
  draftId: string
  needsReview: boolean
  changeRatio: number
}

// URL-safe ids only (matching nanoid's `deepchat-xxxx`). Guards against path traversal when an
// externally supplied id is used in a file path, and against malformed keys.
const SAFE_AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/
export function isSafeAgentId(agentId: unknown): agentId is string {
  return typeof agentId === 'string' && SAFE_AGENT_ID_PATTERN.test(agentId)
}

export const DEFAULT_SIMILARITY_THRESHOLD = 0.2
// Reciprocal Rank Fusion constant; 60 is the long-standing default from the original RRF paper.
export const DEFAULT_RRF_K = 60
// Upper bounds that keep a malformed/imported config from producing a runaway vector LIMIT or a
// degenerate fusion constant. topK feeds candidateLimit (topK*2) and the store query size.
export const MAX_TOP_K = 100
export const MAX_RRF_K = 1000

export const DEFAULT_RETRIEVAL: Required<Omit<DeepChatAgentMemoryRetrieval, 'weights'>> & {
  weights: { similarity: number; recency: number; importance: number }
} = {
  topK: 6,
  rrfK: DEFAULT_RRF_K,
  similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
  weights: { similarity: 0.6, recency: 0.25, importance: 0.15 }
}

// Half-life (ms) for recency exponential decay; 14 days. Default for semantic units.
export const DEFAULT_RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000
// Per-kind recall half-lives: higher cognitive layers persist longer than raw units. Session
// episodic summaries outlive atomic facts; reflections (high-level insights) decay slowest.
export const EPISODIC_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000
export const REFLECTION_HALF_LIFE_MS = 60 * 24 * 60 * 60 * 1000
// Half-life (ms) for the materialized decay_score that drives archiving; 30 days.
export const FORGET_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000
// Neutral confidence for rows that carry none (legacy rows / not yet corroborated). Treated as the
// pivot of the recall confidence factor, so default-confidence rows rank exactly as before.
export const DEFAULT_CONFIDENCE = 0.7
// Corroboration bump applied on UPDATE; confidence only ever rises and is capped at 1.
export const CONFIDENCE_INCREMENT = 0.1
// Slope of the recall confidence factor around DEFAULT_CONFIDENCE (1 + boost·(conf − default)).
export const CONFIDENCE_BOOST = 0.5
// Importance floor coefficient: a decayed but important memory keeps at least coef·importance.
export const IMPORTANCE_FLOOR_COEF = 0.15
// Similarity placeholder for FTS-only hits that have no vector distance. Keyword-only recall is
// kept in check by RRF plus retrievalScore dominance rather than by the vector threshold.
export const FTS_SIMILARITY_BASELINE = 0.3
