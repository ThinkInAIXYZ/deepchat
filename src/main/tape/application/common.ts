export function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}
  return {}
}

export function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export function isEntryIdPrefix(prefix: number[], values: number[]): boolean {
  if (prefix.length > values.length) return false
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] !== values[index]) return false
  }
  return true
}

export function migrationProvenanceKey(sessionId: string): string {
  return `migration:${sessionId}:message-backfill:v1`
}
