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

/**
 * SQLite 侧记忆仓储端口。AgentMemoryTable 结构上即满足此接口；
 * 抽象出来是为了让 MemoryPresenter 的打分/去重/阶段逻辑可脱离原生模块单测。
 */
export interface MemoryRepositoryPort {
  insert(input: AgentMemoryInsertInput): AgentMemoryRow
  getById(id: string): AgentMemoryRow | undefined
  getByProvenanceKey(agentId: string, provenanceKey: string): AgentMemoryRow | undefined
  listByAgent(agentId: string, options?: AgentMemoryListOptions): AgentMemoryRow[]
  getActivePersona(agentId: string): AgentMemoryRow | undefined
  listPersonaVersions(agentId: string): AgentMemoryRow[]
  search(agentId: string, query: string, limit?: number): AgentMemoryRow[]
  listPendingEmbedding(limit?: number): AgentMemoryRow[]
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

/**
 * 记忆向量存储端口（DuckDB 实现），按 agent 维度隔离（每 agent 一个库，维度独立）。
 */
export interface IMemoryVectorStore {
  upsert(records: MemoryVectorRecord[]): Promise<void>
  query(embedding: number[], options: MemoryVectorQueryOptions): Promise<MemoryVectorMatch[]>
  deleteByMemoryIds(memoryIds: string[]): Promise<void>
  close(): Promise<void>
  isUsable(): boolean
}

/**
 * 抽取候选：来自 compaction 搭车或会话结束兜底。
 */
export interface MemoryCandidate {
  kind: Extract<AgentMemoryKind, 'episodic' | 'semantic'>
  content: string
  importance?: number
}

export interface WriteMemoriesOptions {
  agentId: string
  sourceSession?: string | null
  userScope?: string | null
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
  /** 解析后的 agent 配置（含 memoryEnabled / memoryEmbedding / memoryRetrieval）。 */
  resolveAgentConfig: (agentId: string) => DeepChatAgentConfig | null
  /**
   * 严格存在性校验：仅当 agentId 对应一个真实存在的 DeepChat agent 时返回 true。
   * 用于管理类接口防止对任意/不存在的 agent 读写记忆。缺省时（如单测）跳过该校验。
   */
  isManagedAgent?: (agentId: string) => boolean
  /** 计算 embedding；返回每条文本的向量。 */
  getEmbeddings: (providerId: string, modelId: string, texts: string[]) => Promise<number[][]>
  /** 廉价模型文本生成，用于记忆抽取（独立于摘要调用）。 */
  generateText: (providerId: string, modelId: string, prompt: string) => Promise<string>
  /** 为指定 agent 创建/打开向量存储；embedding 身份用于校验，dimensions 用于首次初始化。 */
  createVectorStore: (
    agentId: string,
    embedding: { providerId: string; modelId: string },
    dimensions: number
  ) => Promise<IMemoryVectorStore>
  /**
   * 删除指定 agent 的磁盘向量库（含 wal），与缓存是否存在无关。
   * 用于清空记忆时彻底重置：重启后缓存为空也能删掉老库，下次写入会以当前 embedding 身份重建。
   */
  resetVectorStore: (agentId: string) => Promise<void>
  /**
   * 记忆数据变更回调（写入/删除/清空/人格演化/回滚后触发），由宿主接 typed 事件广播给 UI。
   * 可选——单测不注入时为纯 presenter，无副作用。
   */
  onMemoryChanged?: (agentId: string, reason: MemoryUpdateReason) => void
}

/** 记忆变更原因，与 shared/contracts memory.events 的 MemoryUpdateReasonSchema 对应。 */
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
}

/**
 * 抽取结果：区分“成功（可能抽到 0 条）”与“失败（模型/解析异常）”。
 * 调用方据此决定是否推进记忆游标——失败时不应推进，以便下次重试。
 */
export type MemoryExtractionResult = { ok: true; createdIds: string[] } | { ok: false }

/**
 * agent id 安全格式：仅允许 URL-safe 字符（与 nanoid 生成的 `deepchat-xxxx` 一致）。
 * 用于杜绝把外部传入的 id 直接拼进文件路径造成的路径穿越，以及异常键写入。
 */
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
/** recency 指数衰减半衰期（毫秒），默认 14 天。 */
export const DEFAULT_RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000
/** FTS-only 命中（无向量相似度）时的相似度基线。 */
export const FTS_SIMILARITY_BASELINE = 0.5
