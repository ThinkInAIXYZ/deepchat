import {
  CONFIDENCE_BOOST,
  DEFAULT_CONFIDENCE,
  DEFAULT_RECENCY_HALF_LIFE_MS,
  DEFAULT_RETRIEVAL,
  DEFAULT_SIMILARITY_THRESHOLD,
  EPISODIC_HALF_LIFE_MS,
  FORGET_HALF_LIFE_MS,
  FTS_SIMILARITY_BASELINE,
  IMPORTANCE_FLOOR_COEF,
  MAX_RRF_K,
  MAX_TOP_K,
  REFLECTION_HALF_LIFE_MS,
  type AgentMemoryRow,
  type FuseOptions,
  type MemoryRecallItem
} from './types'
import type { AgentMemoryKind } from '../sqlitePresenter/tables/agentMemory'
import type { DeepChatAgentMemoryRetrieval } from '@shared/types/agent-interface'

// Recency half-life per cognitive layer: reflections persist longest, episodic summaries next,
// everything else on the semantic default. persona/working never reach recall, so they fall through.
export function halfLifeForKind(kind: AgentMemoryKind): number {
  if (kind === 'reflection') return REFLECTION_HALF_LIFE_MS
  if (kind === 'episodic') return EPISODIC_HALF_LIFE_MS
  return DEFAULT_RECENCY_HALF_LIFE_MS
}

/** Maps distance-like scores to a clamped similarity range. */
export function distanceToSimilarity(distance: number): number {
  const similarity = 1 - distance
  if (!Number.isFinite(similarity)) return 0
  return Math.min(1, Math.max(0, similarity))
}

/** Exponential recency decay: newer timestamps stay closer to 1. */
export function recencyScore(
  createdAt: number,
  now: number,
  halfLifeMs: number = DEFAULT_RECENCY_HALF_LIFE_MS
): number {
  const age = Math.max(0, now - createdAt)
  return Math.pow(0.5, age / halfLifeMs)
}

// Clamps a configured positive integer into [1, max], falling back to `fallback` for anything
// non-finite, non-positive, or otherwise malformed (NaN, Infinity, strings via untyped config).
function resolvePositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const floored = Math.floor(value)
  if (floored < 1) return fallback
  return Math.min(floored, max)
}

// Accepts the weights only when all three are finite and non-negative; a single bad field would
// otherwise produce NaN scores and corrupt the ranking, so fall back to the defaults wholesale.
function resolveWeights(weights: DeepChatAgentMemoryRetrieval['weights']): {
  similarity: number
  recency: number
  importance: number
} {
  if (
    !weights ||
    !Number.isFinite(weights.similarity) ||
    weights.similarity < 0 ||
    !Number.isFinite(weights.recency) ||
    weights.recency < 0 ||
    !Number.isFinite(weights.importance) ||
    weights.importance < 0
  ) {
    return DEFAULT_RETRIEVAL.weights
  }
  return {
    similarity: weights.similarity,
    recency: weights.recency,
    importance: weights.importance
  }
}

export function resolveRetrieval(config?: DeepChatAgentMemoryRetrieval | null): {
  topK: number
  rrfK: number
  similarityThreshold: number
  weights: { similarity: number; recency: number; importance: number }
} {
  const similarityThreshold =
    typeof config?.similarityThreshold === 'number' &&
    Number.isFinite(config.similarityThreshold) &&
    config.similarityThreshold >= 0 &&
    config.similarityThreshold <= 1
      ? config.similarityThreshold
      : DEFAULT_SIMILARITY_THRESHOLD
  return {
    topK: resolvePositiveInt(config?.topK, DEFAULT_RETRIEVAL.topK, MAX_TOP_K),
    rrfK: resolvePositiveInt(config?.rrfK, DEFAULT_RETRIEVAL.rrfK, MAX_RRF_K),
    similarityThreshold,
    weights: resolveWeights(config?.weights)
  }
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function retrievalScore(
  row: Pick<AgentMemoryRow, 'importance' | 'created_at'> & { confidence?: number | null },
  similarity: number,
  now: number,
  weights: { similarity: number; recency: number; importance: number },
  halfLifeMs?: number
): number {
  const recency = recencyScore(row.created_at, now, halfLifeMs)
  const importance = clamp01(row.importance)
  const confidence = clamp01(row.confidence ?? DEFAULT_CONFIDENCE)
  const base =
    weights.similarity * similarity + weights.recency * recency + weights.importance * importance
  const confidenceFactor = Math.max(0, 1 + CONFIDENCE_BOOST * (confidence - DEFAULT_CONFIDENCE))
  const floor = IMPORTANCE_FLOOR_COEF * importance
  return Math.max(base * confidenceFactor, floor)
}

export function decayScore(
  row: Pick<AgentMemoryRow, 'created_at' | 'last_accessed' | 'importance'>,
  now: number,
  halfLifeMs: number = FORGET_HALF_LIFE_MS
): number {
  const anchor = row.last_accessed ?? row.created_at
  const effectiveHalfLifeMs = halfLifeMs * (1 + clamp01(row.importance))
  return recencyScore(anchor, now, effectiveHalfLifeMs)
}

/** Parses the persisted source_entry_ids JSON back into a tape entry_id list, or null. */
export function parseSourceEntryIds(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const ids = parsed.filter((id): id is number => Number.isInteger(id) && id >= 0)
    return ids.length ? ids : null
  } catch {
    return null
  }
}

function toRecallItem(
  row: AgentMemoryRow,
  score: number,
  sources: { vec?: boolean; fts?: boolean },
  similarity?: number
): MemoryRecallItem {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    importance: row.importance,
    score,
    sources,
    similarity,
    sourceSession: row.source_session,
    sourceEntryIds: parseSourceEntryIds(row.source_entry_ids)
  }
}

/**
 * Reciprocal Rank Fusion of the keyword (FTS) and vector candidate lists, reranked by a combined
 * score. The final order is `retrievalScore + RRF`: retrievalScore (which carries the real vector
 * similarity vs. the FTS baseline) is the dominant term, so a strong vector hit is never displaced
 * by a weak keyword-only hit that merely sits at a better keyword rank (AC-1.1). RRF adds a small
 * additive boost on top, accumulated for a memory surfaced by both paths so dual-path evidence
 * lifts it above equally-scored single-path hits (AC-1.2). Returns the top-K items in that order.
 */
export function fuse(
  fts: AgentMemoryRow[],
  vec: { row: AgentMemoryRow; similarity: number }[],
  opts: FuseOptions
): MemoryRecallItem[] {
  const baseline = opts.ftsBaseline ?? FTS_SIMILARITY_BASELINE
  const candidates = new Map<
    string,
    {
      row: AgentMemoryRow
      rrf: number
      similarity?: number
      sources: { vec?: boolean; fts?: boolean }
    }
  >()

  const add = (row: AgentMemoryRow, rank: number, source: 'fts' | 'vec', similarity?: number) => {
    const contribution = 1 / (opts.rrfK + rank + 1)
    const existing = candidates.get(row.id)
    if (existing) {
      existing.rrf += contribution
      existing.sources[source] = true
      if (similarity !== undefined) existing.similarity = similarity
      return
    }
    const sources: { vec?: boolean; fts?: boolean } = {}
    sources[source] = true
    candidates.set(row.id, { row, rrf: contribution, similarity, sources })
  }

  fts.forEach((row, index) => add(row, index, 'fts'))
  vec.forEach(({ row, similarity }, index) => add(row, index, 'vec', similarity))

  return Array.from(candidates.values())
    .map((candidate) => {
      const score = retrievalScore(
        candidate.row,
        candidate.similarity ?? baseline,
        opts.now,
        opts.weights,
        opts.halfLifeMs ?? halfLifeForKind(candidate.row.kind)
      )
      // retrievalScore is the primary signal; RRF is folded in as a small additive boost.
      return {
        combined: score + candidate.rrf,
        score,
        item: {
          ...toRecallItem(candidate.row, score, candidate.sources, candidate.similarity),
          breakdown: opts.trace
            ? {
                similarity: candidate.similarity ?? baseline,
                recency: recencyScore(
                  candidate.row.created_at,
                  opts.now,
                  opts.halfLifeMs ?? halfLifeForKind(candidate.row.kind)
                ),
                importance: Math.min(1, Math.max(0, candidate.row.importance)),
                confidence: Math.min(
                  1,
                  Math.max(0, candidate.row.confidence ?? DEFAULT_CONFIDENCE)
                ),
                rrf: candidate.rrf,
                final: score
              }
            : undefined
        }
      }
    })
    .sort((a, b) => b.combined - a.combined || b.score - a.score)
    .slice(0, opts.topK)
    .map((entry) => entry.item)
}

/** Normalizes memory text for idempotent provenance keys. */
export function normalizeForProvenance(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Lightweight stable hash for provenance keys without depending on crypto. */
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
