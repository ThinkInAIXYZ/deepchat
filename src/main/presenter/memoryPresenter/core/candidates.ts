import { CATEGORY_IMPORTANCE_FLOOR, isAgentMemoryCategory } from '@shared/types/agent-memory'

import type { MemoryCandidate, NormalizedMemoryCandidate } from '../types'

function clampImportance(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 0.5
  return Math.min(1, Math.max(0, num))
}

export function normalizeMemoryCandidate(
  candidate: MemoryCandidate
): NormalizedMemoryCandidate | null {
  const content = candidate.content.trim()
  if (!content) return null

  const rawCategory = typeof candidate.category === 'string' ? candidate.category.trim() : ''
  const category = isAgentMemoryCategory(rawCategory) ? rawCategory : null
  const categoryWasProvided = rawCategory.length > 0
  const kind =
    category !== null
      ? category === 'task_outcome'
        ? 'episodic'
        : 'semantic'
      : categoryWasProvided
        ? 'semantic'
        : candidate.kind === 'episodic' || candidate.kind === 'semantic'
          ? candidate.kind
          : 'semantic'
  const importance = category
    ? Math.max(clampImportance(candidate.importance), CATEGORY_IMPORTANCE_FLOOR[category])
    : clampImportance(candidate.importance)

  return { kind, category, content, importance }
}
