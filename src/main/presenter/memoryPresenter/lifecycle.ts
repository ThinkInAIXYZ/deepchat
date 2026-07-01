import type { MemoryLifecycle } from '@shared/contracts/routes'
import {
  CONFIDENCE_BOOST,
  DEFAULT_CONFIDENCE,
  DEFAULT_RETRIEVAL,
  FORGET_HALF_LIFE_MS,
  FTS_SIMILARITY_BASELINE,
  IMPORTANCE_FLOOR_COEF,
  type AgentMemoryLifecycleRow
} from './types'
import { decayScore, halfLifeForKind, recencyScore, retrievalScore, clamp01 } from './scoring'
import {
  ARCHIVE_AGE_MS,
  ARCHIVE_DECAY_THRESHOLD,
  FRESH_DECAY_THRESHOLD
} from './lifecycleConstants'

const DAY_MS = 24 * 60 * 60 * 1000
const MATERIALIZED_DECAY_EPSILON = 1e-9
// Avoid classifying exact floor ties as floor-raised recall scores.
const FLOAT_EPSILON = 1e-12

export interface DeriveLifecycleOptions {
  weights?: { similarity: number; recency: number; importance: number }
  archiveAgeMs?: number
  archiveDecayThreshold?: number
}

export function deriveLifecycle(
  row: AgentMemoryLifecycleRow,
  now: number,
  options: DeriveLifecycleOptions = {}
): MemoryLifecycle {
  if (row.kind === 'working') {
    throw new Error('working memory rows do not expose lifecycle diagnostics')
  }

  const weights = options.weights ?? DEFAULT_RETRIEVAL.weights
  const archiveAgeMs = options.archiveAgeMs ?? ARCHIVE_AGE_MS
  const archiveDecayThreshold = options.archiveDecayThreshold ?? ARCHIVE_DECAY_THRESHOLD
  const importance = clamp01(row.importance)
  const active =
    row.status !== 'archived' && row.status !== 'conflicted' && row.superseded_by == null
  const exemptReasons = deriveExemptReasons(row)
  const exempt = exemptReasons.length > 0
  const recallable = row.kind !== 'persona' && active
  const forget = deriveForget(row, now, importance)
  const oldEnough = row.created_at <= now - archiveAgeMs
  const decayedEnough = forget.decayScore <= archiveDecayThreshold
  const neverAccessed = row.access_count === 0
  const eligible = !exempt && active && oldEnough && decayedEnough && neverAccessed
  const decayTier = deriveDecayTier(forget.decayScore, eligible, archiveDecayThreshold)

  return {
    memoryId: row.id,
    kind: row.kind,
    status: row.status,
    recallable,
    decayTier,
    recall: row.kind === 'persona' ? null : deriveRecall(row, now, weights, importance),
    forget,
    archiveEligibility: {
      eligible,
      oldEnough,
      decayedEnough,
      neverAccessed,
      active,
      exempt,
      exemptReasons,
      gaps: deriveArchiveGaps({
        row,
        now,
        archiveAgeMs,
        archiveDecayThreshold,
        oldEnough,
        decayedEnough,
        neverAccessed,
        decayScore: forget.decayScore
      })
    }
  }
}

export function deriveDecayTier(
  score: number,
  archiveEligible: boolean,
  archiveDecayThreshold: number = ARCHIVE_DECAY_THRESHOLD
): MemoryLifecycle['decayTier'] {
  if (archiveEligible) return 'archive_candidate'
  if (score >= FRESH_DECAY_THRESHOLD) return 'fresh'
  if (score > archiveDecayThreshold) return 'aging'
  return 'stale'
}

function deriveRecall(
  row: AgentMemoryLifecycleRow,
  now: number,
  weights: { similarity: number; recency: number; importance: number },
  importance: number
): NonNullable<MemoryLifecycle['recall']> {
  const halfLifeMs = halfLifeForKind(row.kind)
  const recency = recencyScore(row.created_at, now, halfLifeMs)
  const confidence = clamp01(row.confidence ?? DEFAULT_CONFIDENCE)
  const base =
    weights.similarity * FTS_SIMILARITY_BASELINE +
    weights.recency * recency +
    weights.importance * importance
  const confidenceFactor = Math.max(0, 1 + CONFIDENCE_BOOST * (confidence - DEFAULT_CONFIDENCE))
  const importanceFloor = IMPORTANCE_FLOOR_COEF * importance
  const final = retrievalScore(row, FTS_SIMILARITY_BASELINE, now, weights, halfLifeMs)

  return {
    weights,
    similarity: FTS_SIMILARITY_BASELINE,
    similaritySource: 'baseline',
    recency,
    importance,
    confidenceFactor,
    importanceFloor,
    final,
    flooredByImportance: importanceFloor > base * confidenceFactor + FLOAT_EPSILON,
    halfLifeMs
  }
}

function deriveForget(
  row: AgentMemoryLifecycleRow,
  now: number,
  importance: number
): MemoryLifecycle['forget'] {
  const anchorAt = row.last_accessed ?? row.created_at
  const ageMs = Math.max(0, now - anchorAt)
  const halfLifeMs = FORGET_HALF_LIFE_MS * (1 + importance)
  const score = decayScore(row, now)

  return {
    anchorAt,
    ageDays: ageMs / DAY_MS,
    halfLifeDays: halfLifeMs / DAY_MS,
    decayScore: score,
    materializedDecay: row.decay_score,
    materializedStale:
      row.decay_score === null || Math.abs(row.decay_score - score) > MATERIALIZED_DECAY_EPSILON
  }
}

function deriveExemptReasons(
  row: AgentMemoryLifecycleRow
): Array<'anchor' | 'persona' | 'working'> {
  const reasons: Array<'anchor' | 'persona' | 'working'> = []
  if (row.is_anchor === 1) reasons.push('anchor')
  if (row.kind === 'persona') reasons.push('persona')
  if (row.kind === 'working') reasons.push('working')
  return reasons
}

function deriveArchiveGaps(input: {
  row: AgentMemoryLifecycleRow
  now: number
  archiveAgeMs: number
  archiveDecayThreshold: number
  oldEnough: boolean
  decayedEnough: boolean
  neverAccessed: boolean
  decayScore: number
}): MemoryLifecycle['archiveEligibility']['gaps'] {
  const gaps: MemoryLifecycle['archiveEligibility']['gaps'] = {}
  if (!input.oldEnough) {
    const ageFromCreated = Math.max(0, input.now - input.row.created_at)
    gaps.daysUntilOldEnough = Math.max(0, (input.archiveAgeMs - ageFromCreated) / DAY_MS)
  }
  if (!input.decayedEnough) {
    gaps.decayAboveThresholdBy = Math.max(0, input.decayScore - input.archiveDecayThreshold)
  }
  if (!input.neverAccessed) {
    gaps.accessCount = input.row.access_count
  }
  return gaps
}
