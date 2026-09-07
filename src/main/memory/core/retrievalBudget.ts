export const MEMORY_RETRIEVAL_MAX_CANDIDATES = 800
export const MEMORY_RETRIEVAL_REFILL_MULTIPLIER = 4

export function nextMemoryRetrievalCandidateLimit(current: number): number {
  const normalized = Number.isFinite(current) ? Math.max(1, Math.floor(current)) : 1
  if (normalized >= MEMORY_RETRIEVAL_MAX_CANDIDATES) {
    return MEMORY_RETRIEVAL_MAX_CANDIDATES
  }
  return Math.min(MEMORY_RETRIEVAL_MAX_CANDIDATES, normalized * MEMORY_RETRIEVAL_REFILL_MULTIPLIER)
}
