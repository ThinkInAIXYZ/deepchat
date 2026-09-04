import type { AssistantMessageBlock, ChatMessageRecord } from '@shared/types/agent-interface'
import type { DeepChatTapeEntryKind, DeepChatTapeEntryRow } from './entry'

const TERMINAL_TAPE_TOOL_STATUSES = new Set(['success', 'error'])

export const TAPE_MESSAGE_RETRACTED_EVENT_NAME = 'message/retracted'

/**
 * Kinds an effective-state reader may select wholesale. `event` is excluded because the only event
 * the effective view acts on is `message/retracted`, which every input set already selects by
 * name (listing `event` would return those rows twice); `context` rows are behavioural evidence
 * the fold skips outright.
 */
export type EffectiveInputKind = Exclude<DeepChatTapeEntryKind, 'event' | 'context'>

/**
 * Rows that can change effective message/tool state or anchor positions, plus `message/retracted`
 * events. Every other row (ViewManifests, Journal, provider attempts, contracts, tool-surface
 * provenance, indicators) is evidence the effective view only passes through, so readers that need
 * effective state skip it at the store. `TapeEntryStore.getEffectiveViewInputRows` selects by the
 * same constant.
 */
export const EFFECTIVE_VIEW_INPUT_KINDS = [
  'message',
  'tool_call',
  'tool_result',
  'anchor'
] as const satisfies readonly EffectiveInputKind[]

/**
 * The subset that decides `messageRecords`/`messageEntries`: message rows plus the retraction
 * events that remove them. Tool rows only join onto messages and anchors only pass through, so
 * readers that need effective messages alone skip both at the store.
 * `TapeEntryStore.getEffectiveMessageInputRows` selects by the same constant.
 */
export const EFFECTIVE_MESSAGE_INPUT_KINDS = [
  'message'
] as const satisfies readonly EffectiveInputKind[]

function isEffectiveInputRow(
  row: { kind: string; name: string | null },
  kinds: readonly string[]
): boolean {
  return (
    kinds.includes(row.kind) ||
    (row.kind === 'event' && row.name === TAPE_MESSAGE_RETRACTED_EVENT_NAME)
  )
}

export function isEffectiveViewInputRow(row: { kind: string; name: string | null }): boolean {
  return isEffectiveInputRow(row, EFFECTIVE_VIEW_INPUT_KINDS)
}

export function isEffectiveMessageInputRow(row: { kind: string; name: string | null }): boolean {
  return isEffectiveInputRow(row, EFFECTIVE_MESSAGE_INPUT_KINDS)
}

export interface DeepChatTapeToolIdentity {
  key: string
  messageId: string
}

export function parseTapeJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}
  return {}
}

export function parseNestedTapeJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return parseTapeJsonObject(value)
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

export function parseAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
  try {
    const parsed = JSON.parse(rawContent) as unknown
    return Array.isArray(parsed) ? (parsed as AssistantMessageBlock[]) : []
  } catch {
    return []
  }
}

export function messageRecordHasFinalToolUse(record: ChatMessageRecord): boolean {
  if (record.role !== 'assistant' || (record.status !== 'sent' && record.status !== 'error')) {
    return false
  }
  const blocks = parseAssistantBlocks(record.content)
  const pendingInteractionToolIds = new Set(
    blocks.flatMap((block) =>
      block?.type === 'action' &&
      (block.action_type === 'tool_call_permission' || block.action_type === 'question_request') &&
      block.status === 'pending' &&
      typeof block.tool_call?.id === 'string'
        ? [block.tool_call.id]
        : []
    )
  )
  return blocks.some(
    (block) =>
      block?.type === 'tool_call' &&
      (block.status === 'success' || block.status === 'error') &&
      typeof block.tool_call?.id === 'string' &&
      !pendingInteractionToolIds.has(block.tool_call.id)
  )
}

function isMessageStatus(value: unknown): value is ChatMessageRecord['status'] {
  return value === 'pending' || value === 'sent' || value === 'error'
}

export function tapeEntryToMessageRecord(row: DeepChatTapeEntryRow): ChatMessageRecord | null {
  if (row.kind !== 'message') {
    return null
  }

  const payload = parseTapeJsonObject(row.payload_json)
  const record = payload.record
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null
  }

  const candidate = record as Partial<ChatMessageRecord>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.sessionId !== 'string' ||
    typeof candidate.orderSeq !== 'number' ||
    (candidate.role !== 'user' && candidate.role !== 'assistant') ||
    typeof candidate.content !== 'string'
  ) {
    return null
  }

  return {
    id: candidate.id,
    sessionId: candidate.sessionId,
    orderSeq: candidate.orderSeq,
    role: candidate.role,
    content: candidate.content,
    status: isMessageStatus(candidate.status) ? candidate.status : 'sent',
    isContextEdge: typeof candidate.isContextEdge === 'number' ? candidate.isContextEdge : 0,
    metadata: typeof candidate.metadata === 'string' ? candidate.metadata : '{}',
    traceCount: typeof candidate.traceCount === 'number' ? candidate.traceCount : 0,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : row.created_at,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : row.created_at
  }
}

export function tapeMessageRank(record: ChatMessageRecord, includePending: boolean): number {
  if (record.status === 'sent' || record.status === 'error') {
    return 2
  }
  return includePending && record.status === 'pending' ? 1 : 0
}

export function readTapeMessageRetractionId(row: DeepChatTapeEntryRow): string | null {
  if (row.kind !== 'event' || row.name !== TAPE_MESSAGE_RETRACTED_EVENT_NAME) {
    return null
  }

  const payload = parseTapeJsonObject(row.payload_json)
  const data = parseNestedTapeJsonObject(payload.data)
  return typeof data.messageId === 'string' ? data.messageId : null
}

export function readTapeToolStatus(row: DeepChatTapeEntryRow): string | null {
  const meta = parseTapeJsonObject(row.meta_json)
  return typeof meta.status === 'string' ? meta.status : null
}

export function tapeToolRankFromStatus(status: string | null, includePending: boolean): number {
  if (status === 'pending') {
    return includePending ? 1 : 0
  }
  return status !== null && TERMINAL_TAPE_TOOL_STATUSES.has(status) ? 2 : 0
}

export function tapeToolRank(row: DeepChatTapeEntryRow, includePending: boolean): number {
  return tapeToolRankFromStatus(readTapeToolStatus(row), includePending)
}

/** `readTapeToolIdentity` for a caller that has already parsed `payload_json`. */
export function readTapeToolIdentityFromPayload(
  kind: DeepChatTapeEntryRow['kind'],
  payload: Record<string, unknown>
): DeepChatTapeToolIdentity | null {
  if (kind !== 'tool_call' && kind !== 'tool_result') {
    return null
  }

  const messageId = payload.messageId
  if (typeof messageId !== 'string' || messageId.length === 0) {
    return null
  }

  const toolCallId =
    kind === 'tool_call' ? parseNestedTapeJsonObject(payload.toolCall).id : payload.toolCallId
  if (typeof toolCallId !== 'string' || toolCallId.length === 0) {
    return null
  }

  return {
    key: `${kind}:${messageId}:${toolCallId}`,
    messageId
  }
}

export function readTapeToolIdentity(row: DeepChatTapeEntryRow): DeepChatTapeToolIdentity | null {
  if (row.kind !== 'tool_call' && row.kind !== 'tool_result') {
    return null
  }
  return readTapeToolIdentityFromPayload(row.kind, parseTapeJsonObject(row.payload_json))
}
