import type { AgentMemorySource, DimMemorySource } from '../types/agent-memory'

function nativeSource(value: unknown): DimMemorySource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Partial<DimMemorySource>
  if (
    source.kind !== 'dim' ||
    [source.sessionId, source.branchId, source.messageId].some(
      (id) => typeof id !== 'string' || !id || id.length > 4096
    ) ||
    typeof source.through !== 'string' ||
    !/^(0|[1-9][0-9]{0,19})$/.test(source.through) ||
    BigInt(source.through) > 18446744073709551615n
  )
    return null
  return {
    kind: 'dim',
    sessionId: source.sessionId!,
    branchId: source.branchId!,
    through: source.through,
    messageId: source.messageId!
  }
}
function normalizeSourceEntryIds(values: readonly unknown[]): AgentMemorySource[] | null {
  const seen = new Set<string>()
  const ids: AgentMemorySource[] = []
  for (const value of values) {
    const source =
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : nativeSource(value)
    if (source === null) continue
    const key = JSON.stringify(source)
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(source)
  }
  return ids.length ? ids : null
}
export function parseAgentMemorySourceEntryIds(
  raw: string | null | undefined
): AgentMemorySource[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
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
