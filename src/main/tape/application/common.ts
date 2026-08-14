import { TAPE_INCARNATION_META_KEY, type DeepChatTapeEntryRow } from '../domain/entry'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}
  return {}
}

export function readCanonicalTapeIncarnationId(row: DeepChatTapeEntryRow): string | null {
  if (
    row.entry_id !== 1 ||
    row.kind !== 'anchor' ||
    row.name !== 'session/start' ||
    row.source_type !== 'session' ||
    row.source_id !== row.session_id ||
    row.source_seq !== 0
  ) {
    return null
  }
  const value = parseJsonObject(row.meta_json)[TAPE_INCARNATION_META_KEY]
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null
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
