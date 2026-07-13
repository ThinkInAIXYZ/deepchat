import type { DeepChatAgentMemoryRetrieval } from '@shared/types/agent-interface'
import type { LLM_EMBEDDING_ATTRS } from '@shared/presenter'
import type { MemoryUpdateReason } from '@shared/contracts/events/memory.events'

import type { MemoryUpdateContext } from './domain/types'
import type {
  IMemoryVectorStore,
  MemoryAgentPolicyPort,
  MemoryAuditRepositoryPort,
  MemoryPerfObserver,
  MemoryRepositoryPort
} from './ports'

export type {
  AgentMemoryConflictState,
  AgentMemoryEmbeddingState,
  AgentMemoryHealthStats,
  AgentMemoryInsertInput,
  AgentMemoryKind,
  AgentMemoryLifecycleState,
  AgentMemoryLifecycleRow,
  AgentMemoryListOptions,
  AgentMemoryPersonaState,
  AgentMemoryStatus,
  AgentMemoryWorkingCandidateCursor,
  ConsolidationScanCursor,
  EmbeddedMemoryUpdate,
  FailedEmbeddingUpdate,
  FuseOptions,
  MemoryCandidate,
  MemoryCognitiveMaintenanceInput,
  MemoryConflictPair,
  MemoryConflictResolution,
  MemoryDecisionNeighborSet,
  MemoryDecisionQueryVectorSnapshot,
  MemoryExtractionInput,
  MemoryExtractionResult,
  MemoryKeywordSearchResult,
  MemoryKeywordSearchStrategy,
  MemoryMaintenancePersonaResult,
  MemoryMaintenanceReflectionResult,
  MemoryMaintenanceStepResult,
  MemoryManagementPage,
  MemoryManagementPageCursor,
  MemoryPersonaDraftResult,
  MemoryRecallItem,
  MemoryReflectionResult,
  MemorySearchHit,
  MemoryStatus,
  MemoryTransitionTarget,
  ResolveChallengerTransition,
  ReviveSupersededTransition,
  ArchiveChallengerTransition,
  ArchiveConflictTargetTransition,
  UserContentTransition,
  InternalContentTransition,
  MemoryUpdateContext,
  MemoryVectorMatch,
  MemoryVectorQueryOptions,
  MemoryVectorRecord,
  MemoryVectorRef,
  MemoryWriteOutcome,
  NormalizedMemoryCandidate,
  RetrievalCandidate,
  WriteMemoriesOptions
} from './domain/types'
export type { CanonicalAgentMemoryRow as AgentMemoryRow } from './domain/types'
export type {
  AgentMemoryAuditActorType,
  AgentMemoryAuditInsertInput,
  AgentMemoryAuditRow,
  AgentMemoryAuditStatus,
  MemoryAuditListOptions
} from './domain/audit'
export type {
  IMemoryVectorStore,
  MemoryAuditRepositoryPort,
  MemoryRepositoryPort,
  MemoryRetrievalPort
} from './ports'
export type { MemoryUpdateReason } from '@shared/contracts/events/memory.events'

export type {
  MemoryInjectionPayload,
  MemoryInjectionPort,
  MemoryInjectionResult
} from './injection'

export interface MemoryPresenterDeps {
  repository: MemoryRepositoryPort
  auditRepository?: MemoryAuditRepositoryPort
  perfObserver?: MemoryPerfObserver
  resolveAgentConfig: MemoryAgentPolicyPort['resolveAgentConfig']
  resolveAgentDefaultModel?: MemoryAgentPolicyPort['resolveAgentDefaultModel']
  isManagedAgent?: MemoryAgentPolicyPort['isManagedAgent']
  listManagedMemoryAgentIds?: MemoryAgentPolicyPort['listManagedMemoryAgentIds']
  executeWithRateLimit: (
    providerId: string,
    options: { signal: AbortSignal; purpose: string }
  ) => Promise<void>
  getEmbeddings: (
    providerId: string,
    modelId: string,
    texts: string[],
    signal?: AbortSignal
  ) => Promise<number[][]>
  getDimensions: (
    providerId: string,
    modelId: string,
    signal?: AbortSignal
  ) => Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }>
  generateText: (
    providerId: string,
    modelId: string,
    prompt: string,
    signal?: AbortSignal
  ) => Promise<string>
  createVectorStore: (
    agentId: string,
    embedding: { providerId: string; modelId: string },
    dimensions: number
  ) => Promise<IMemoryVectorStore>
  resetVectorStore: (agentId: string) => Promise<void>
  markVectorStoreQuarantined: (agentId: string) => void
  onMemoryChanged?: (
    agentId: string,
    reason: MemoryUpdateReason,
    context?: MemoryUpdateContext
  ) => void
}

export const DEFAULT_SIMILARITY_THRESHOLD = 0.2
export const DEFAULT_RRF_K = 60
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

export const DEFAULT_RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000
export const EPISODIC_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000
export const REFLECTION_HALF_LIFE_MS = 60 * 24 * 60 * 60 * 1000
export const FORGET_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_CONFIDENCE = 0.7
export const CONFIDENCE_INCREMENT = 0.1
export const CONFIDENCE_BOOST = 0.5
export const IMPORTANCE_FLOOR_COEF = 0.15
export const FTS_SIMILARITY_BASELINE = 0.3
