import type { AssistantMessageBlock, ChatMessageRecord } from '@shared/types/agent-interface'
import type { DeepChatTapeEntryRow } from './deepchatTapeEntries'

const TERMINAL_TAPE_TOOL_STATUSES = new Set(['success', 'error'])

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
      block.type === 'action' &&
      (block.action_type === 'tool_call_permission' || block.action_type === 'question_request') &&
      block.status === 'pending' &&
      typeof block.tool_call?.id === 'string'
        ? [block.tool_call.id]
        : []
    )
  )
  return blocks.some(
    (block) =>
      block.type === 'tool_call' &&
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
  if (row.kind !== 'event' || row.name !== 'message/retracted') {
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

export function tapeToolRank(row: DeepChatTapeEntryRow, includePending: boolean): number {
  const status = readTapeToolStatus(row)
  if (status === 'pending') {
    return includePending ? 1 : 0
  }
  return status !== null && TERMINAL_TAPE_TOOL_STATUSES.has(status) ? 2 : 0
}

export function readTapeToolIdentity(row: DeepChatTapeEntryRow): DeepChatTapeToolIdentity | null {
  if (row.kind !== 'tool_call' && row.kind !== 'tool_result') {
    return null
  }

  const payload = parseTapeJsonObject(row.payload_json)
  const messageId = payload.messageId
  if (typeof messageId !== 'string' || messageId.length === 0) {
    return null
  }

  let toolCallId: unknown
  if (row.kind === 'tool_call') {
    toolCallId = parseNestedTapeJsonObject(payload.toolCall).id
  } else {
    toolCallId = payload.toolCallId
  }

  if (typeof toolCallId !== 'string' || toolCallId.length === 0) {
    return null
  }

  return {
    key: `${row.kind}:${messageId}:${toolCallId}`,
    messageId
  }
}
