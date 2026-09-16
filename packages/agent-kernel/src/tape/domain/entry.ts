export type DeepChatTapeEntryKind =
  | 'event'
  | 'anchor'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'context'

export const TAPE_INCARNATION_META_KEY = 'tapeIncarnationId'

export type DeepChatTapeSourceType =
  | 'session'
  | 'message'
  | 'assistant_block'
  | 'tool_call'
  | 'tool_result'
  | 'runtime_event'
  | 'migration'
  | 'summary'
  | 'fork'
  | 'subagent'

export interface DeepChatTapeEntryRow {
  session_id: string
  entry_id: number
  kind: DeepChatTapeEntryKind
  name: string | null
  source_type: DeepChatTapeSourceType | null
  source_id: string | null
  source_seq: number | null
  provenance_key: string | null
  payload_json: string
  meta_json: string
  created_at: number
}

export interface DeepChatTapeSourceInput {
  type: DeepChatTapeSourceType
  id: string
  seq?: number | null
}

export interface DeepChatTapeAppendInput {
  sessionId: string
  kind: DeepChatTapeEntryKind
  name?: string | null
  source?: DeepChatTapeSourceInput | null
  provenanceKey?: string | null
  payload: Record<string, unknown>
  meta?: Record<string, unknown>
  createdAt?: number
  idempotent?: boolean
}

export interface TapeAnchorAppendInput {
  sessionId: string
  name: string
  state: Record<string, unknown>
  meta?: Record<string, unknown>
  source?: DeepChatTapeSourceInput | null
  provenanceKey?: string | null
  createdAt?: number
  idempotent?: boolean
}

export interface TapeEventAppendInput {
  sessionId: string
  name: string
  data: Record<string, unknown>
  meta?: Record<string, unknown>
  source?: DeepChatTapeSourceInput | null
  provenanceKey?: string | null
  createdAt?: number
  idempotent?: boolean
}

export interface DeepChatTapeSearchInput {
  limit?: number
  kinds?: DeepChatTapeEntryKind[]
  startCreatedAt?: number
  endCreatedAt?: number
}

export interface DeepChatTapeReadSource {
  sessionId: string
  maxEntryId: number
}

export const SUMMARY_ANCHOR_NAMES = [
  'compaction/auto',
  'compaction/manual',
  'compaction/context_pressure',
  'compaction/resume',
  'compaction/migrated_summary',
  'auto_handoff/context_overflow',
  'summary/reset'
] as const

export function normalizeDeepChatTapeReadSources(
  sources: readonly DeepChatTapeReadSource[]
): DeepChatTapeReadSource[] {
  const maxEntryIdBySession = new Map<string, number>()
  for (const source of sources) {
    const sessionId = source.sessionId.trim()
    if (!sessionId || !Number.isSafeInteger(source.maxEntryId) || source.maxEntryId < 0) {
      continue
    }
    maxEntryIdBySession.set(
      sessionId,
      Math.max(maxEntryIdBySession.get(sessionId) ?? 0, source.maxEntryId)
    )
  }
  return [...maxEntryIdBySession.entries()]
    .map(([sessionId, maxEntryId]) => ({ sessionId, maxEntryId }))
    .sort((left, right) =>
      left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0
    )
}

export function serializeDeepChatTapeReadSources(
  sources: readonly DeepChatTapeReadSource[]
): string {
  return JSON.stringify(normalizeDeepChatTapeReadSources(sources))
}
