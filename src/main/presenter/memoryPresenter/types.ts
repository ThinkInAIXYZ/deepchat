import type {
  AgentMemoryKind,
  AgentMemoryRow,
  AgentMemoryStatus,
  AgentMemoryInsertInput,
  AgentMemoryListOptions
} from '../sqlitePresenter/tables/agentMemory'
import type {
  DeepChatAgentConfig,
  DeepChatAgentMemoryRetrieval
} from '@shared/types/agent-interface'

export type {
  AgentMemoryKind,
  AgentMemoryRow,
  AgentMemoryStatus,
  AgentMemoryInsertInput,
  AgentMemoryListOptions
}

// SQLite repository port. AgentMemoryTable satisfies it structurally; the abstraction lets
// the presenter's scoring/dedup/staging logic be unit-tested without the native module.
export interface MemoryRepositoryPort {
  insert(input: AgentMemoryInsertInput): AgentMemoryRow
  getById(id: string): AgentMemoryRow | undefined
  getByProvenanceKey(agentId: string, provenanceKey: string): AgentMemoryRow | undefined
  listByAgent(agentId: string, options?: AgentMemoryListOptions): AgentMemoryRow[]
  getActivePersona(agentId: string): AgentMemoryRow | undefined
  listPersonaVersions(agentId: string): AgentMemoryRow[]
  search(agentId: string, query: string, limit?: number): AgentMemoryRow[]
  listPendingEmbedding(limit?: number, agentId?: string): AgentMemoryRow[]
  updateStatus(
    id: string,
    status: AgentMemoryStatus,
    embedding?: { embeddingId?: string | null; embeddingDim?: number | null }
  ): void
  markSuperseded(id: string, supersededBy: string | null): void
  recordAccess(id: string, accessedAt?: number): void
  delete(id: string): void
  clearByAgent(agentId: string): number
  countByAgent(agentId: string): number
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
  kind: Extract<AgentMemoryKind, 'episodic' | 'semantic'>
  content: string
  importance?: number
}

export interface WriteMemoriesOptions {
  agentId: string
  sourceSession?: string | null
  userScope?: string | null
  /** Tape entry_id lineage; only persisted when sourceSession scopes them. */
  sourceEntryIds?: number[] | null
}

export type { MemoryInjectionPayload, MemoryInjectionPort } from './injectionPort'

export interface MemoryRecallItem {
  id: string
  kind: AgentMemoryKind
  content: string
  score: number
  importance: number
}

export interface MemoryStatus {
  total: number
  pendingEmbedding: number
  hasPersona: boolean
}

export interface MemoryPresenterDeps {
  repository: MemoryRepositoryPort
  resolveAgentConfig: (agentId: string) => DeepChatAgentConfig | null
  // True only for a real, existing DeepChat agent. Management surfaces use it to refuse
  // reads/writes against arbitrary or nonexistent agents; skipped when absent (e.g. tests).
  isManagedAgent?: (agentId: string) => boolean
  getEmbeddings: (providerId: string, modelId: string, texts: string[]) => Promise<number[][]>
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
  | 'persona-rollback'

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

// URL-safe ids only (matching nanoid's `deepchat-xxxx`). Guards against path traversal when an
// externally supplied id is used in a file path, and against malformed keys.
const SAFE_AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/
export function isSafeAgentId(agentId: unknown): agentId is string {
  return typeof agentId === 'string' && SAFE_AGENT_ID_PATTERN.test(agentId)
}

export const DEFAULT_RETRIEVAL: Required<Omit<DeepChatAgentMemoryRetrieval, 'weights'>> & {
  weights: { similarity: number; recency: number; importance: number }
} = {
  topK: 6,
  weights: { similarity: 0.6, recency: 0.25, importance: 0.15 }
}

export const DEFAULT_SIMILARITY_THRESHOLD = 0.2
// Half-life (ms) for recency exponential decay; 14 days.
export const DEFAULT_RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000
// Similarity baseline for FTS-only hits that have no vector distance.
export const FTS_SIMILARITY_BASELINE = 0.5
