function normalizeSourceEntryIds(values: readonly unknown[]): number[] | null {
  const seen = new Set<number>()
  const ids: number[] = []
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || seen.has(value)) {
      continue
    }
    seen.add(value)
    ids.push(value)
  }
  return ids.length > 0 ? ids : null
}

export function parseAgentMemorySourceEntryIds(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? normalizeSourceEntryIds(parsed) : null
  } catch {
    return null
  }
}

export function serializeAgentMemorySourceEntryIds(
  ids: readonly unknown[] | null | undefined
): string | null {
  if (!ids) return null
  const normalized = normalizeSourceEntryIds(ids)
  return normalized ? JSON.stringify(normalized) : null
}
