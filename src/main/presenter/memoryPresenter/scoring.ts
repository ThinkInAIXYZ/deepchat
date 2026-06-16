import { DEFAULT_RECENCY_HALF_LIFE_MS, DEFAULT_RETRIEVAL, type AgentMemoryRow } from './types'
import type { DeepChatAgentMemoryRetrieval } from '@shared/types/agent-interface'

/** 余弦距离([0,2]) → 相似度([0,1])。其它度量也按 1-distance 归一并裁剪。 */
export function distanceToSimilarity(distance: number): number {
  const similarity = 1 - distance
  if (!Number.isFinite(similarity)) return 0
  return Math.min(1, Math.max(0, similarity))
}

/** recency 指数衰减：越新越接近 1。 */
export function recencyScore(
  createdAt: number,
  now: number,
  halfLifeMs: number = DEFAULT_RECENCY_HALF_LIFE_MS
): number {
  const age = Math.max(0, now - createdAt)
  return Math.pow(0.5, age / halfLifeMs)
}

export function resolveRetrieval(config?: DeepChatAgentMemoryRetrieval | null): {
  topK: number
  weights: { similarity: number; recency: number; importance: number }
} {
  return {
    topK: config?.topK && config.topK > 0 ? Math.floor(config.topK) : DEFAULT_RETRIEVAL.topK,
    weights: config?.weights ?? DEFAULT_RETRIEVAL.weights
  }
}

/** 综合检索打分：α·相似度 + β·recency + γ·importance。 */
export function retrievalScore(
  row: Pick<AgentMemoryRow, 'importance' | 'created_at'>,
  similarity: number,
  now: number,
  weights: { similarity: number; recency: number; importance: number },
  halfLifeMs?: number
): number {
  const recency = recencyScore(row.created_at, now, halfLifeMs)
  const importance = Math.min(1, Math.max(0, row.importance))
  return (
    weights.similarity * similarity + weights.recency * recency + weights.importance * importance
  )
}

/** 规范化记忆正文用于幂等去重：小写、折叠空白、裁剪。 */
export function normalizeForProvenance(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * 简易稳定哈希（FNV-1a 变体），用于生成 provenance_key。避免依赖 crypto。
 */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

export function buildMemoryProvenanceKey(agentId: string, kind: string, content: string): string {
  return `${kind}:${stableHash(`${agentId}:${kind}:${normalizeForProvenance(content)}`)}`
}
