import type { AssistantMessageBlock, ChatMessageRecord } from '@shared/types/agent-interface'
import type { DeepChatTapeEntriesTable } from '../sqlitePresenter/tables/deepchatTapeEntries'
import type { DeepChatTapeEntryRow } from '../sqlitePresenter/tables/deepchatTapeEntries'
import { buildEffectiveTapeView } from './tapeEffectiveView'
import { hashJson } from './tapeViewManifest'

export type TapeFactSource = 'live' | 'backfill' | 'repair'

function parseAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
  try {
    const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parsePayload(row: DeepChatTapeEntryRow): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(row.payload_json) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}
  return null
}

function readCompactionStatus(record: ChatMessageRecord): string | null {
  try {
    const parsed = JSON.parse(record.metadata) as {
      messageType?: string
      compactionStatus?: unknown
    }
    if (parsed.messageType !== 'compaction') {
      return null
    }
    return typeof parsed.compactionStatus === 'string' ? parsed.compactionStatus : record.status
  } catch {
    return null
  }
}

function shouldUseRevisionProvenance(record: ChatMessageRecord, source: TapeFactSource): boolean {
  return source === 'repair' || record.status !== 'sent'
}

function buildMessageProvenanceKey(
  record: ChatMessageRecord,
  source: TapeFactSource
): string | undefined {
  if (!shouldUseRevisionProvenance(record, source)) {
    return undefined
  }
  return `message:${record.id}:revision:${record.status}:${record.updatedAt}`
}

function buildToolFactProvenanceKey(
  kind: 'tool_call' | 'tool_result',
  messageId: string,
  toolCallId: string,
  payload: Record<string, unknown>
): string {
  return `${kind}:${messageId}:${toolCallId}:${hashJson(payload)}`
}

function collectPendingInteractionToolIds(blocks: AssistantMessageBlock[]): Set<string> {
  const ids = new Set<string>()
  for (const block of blocks) {
    if (
      block.type === 'action' &&
      (block.action_type === 'tool_call_permission' || block.action_type === 'question_request') &&
      block.status === 'pending' &&
      typeof block.tool_call?.id === 'string' &&
      block.tool_call.id.length > 0
    ) {
      ids.add(block.tool_call.id)
    }
  }
  return ids
}

export function appendToolFactsToTape(
  table: DeepChatTapeEntriesTable | undefined,
  record: ChatMessageRecord,
  source: TapeFactSource,
  reason?: string
): number {
  if (!table || typeof table.append !== 'function' || record.role !== 'assistant') {
    return 0
  }

  table.ensureBootstrapAnchor?.(record.sessionId)

  let appended = 0
  const blocks = parseAssistantBlocks(record.content)
  const pendingInteractionToolIds = collectPendingInteractionToolIds(blocks)
  blocks.forEach((block, index) => {
    if (block.type !== 'tool_call' || !block.tool_call) {
      return
    }
    if (block.status !== 'success' && block.status !== 'error') {
      return
    }

    const toolCall = block.tool_call
    if (typeof toolCall.id !== 'string' || toolCall.id.length === 0) {
      return
    }
    const toolCallId = toolCall.id
    if (pendingInteractionToolIds.has(toolCallId)) {
      return
    }
    const sourceId = `${record.id}:${toolCallId}`
    const meta = reason
      ? { source, role: record.role, status: block.status, reason }
      : { source, role: record.role, status: block.status }

    const callPayload = {
      messageId: record.id,
      orderSeq: record.orderSeq,
      toolCall: {
        id: toolCallId,
        name: toolCall.name,
        params: toolCall.params,
        serverName: toolCall.server_name,
        serverIcons: toolCall.server_icons,
        serverDescription: toolCall.server_description
      }
    }
    table.append({
      sessionId: record.sessionId,
      kind: 'tool_call',
      name: toolCall.name || 'unknown',
      source: {
        type: 'tool_call',
        id: sourceId,
        seq: index
      },
      provenanceKey: buildToolFactProvenanceKey('tool_call', record.id, toolCallId, callPayload),
      payload: callPayload,
      meta,
      createdAt: block.timestamp ?? record.updatedAt,
      idempotent: true
    })
    appended += 1

    if (typeof toolCall.response !== 'string' || toolCall.response.length === 0) {
      return
    }

    const resultPayload = {
      messageId: record.id,
      orderSeq: record.orderSeq,
      toolCallId,
      response: toolCall.response,
      rtkApplied: toolCall.rtkApplied,
      rtkMode: toolCall.rtkMode,
      rtkFallbackReason: toolCall.rtkFallbackReason,
      imagePreviews: toolCall.imagePreviews
    }
    table.append({
      sessionId: record.sessionId,
      kind: 'tool_result',
      name: toolCall.name || 'unknown',
      source: {
        type: 'tool_result',
        id: sourceId,
        seq: index
      },
      provenanceKey: buildToolFactProvenanceKey(
        'tool_result',
        record.id,
        toolCallId,
        resultPayload
      ),
      payload: resultPayload,
      meta,
      createdAt: block.timestamp ?? record.updatedAt,
      idempotent: true
    })
    appended += 1
  })

  return appended
}

export function appendMessageRecordToTape(
  table: DeepChatTapeEntriesTable | undefined,
  record: ChatMessageRecord,
  source: TapeFactSource
): number {
  if (!table) {
    return 0
  }

  table.ensureBootstrapAnchor?.(record.sessionId)

  const compactionStatus = readCompactionStatus(record)
  if (compactionStatus) {
    if (typeof table.appendEvent !== 'function') {
      return 0
    }
    table.appendEvent({
      sessionId: record.sessionId,
      name: 'message/compaction_indicator',
      source: {
        type: 'message',
        id: record.id,
        seq: record.updatedAt
      },
      provenanceKey: `message:${record.id}:compaction_indicator:${compactionStatus}:${record.updatedAt}`,
      data: {
        messageId: record.id,
        orderSeq: record.orderSeq,
        status: compactionStatus,
        metadata: record.metadata
      },
      meta: {
        source,
        status: compactionStatus
      },
      createdAt: record.updatedAt,
      idempotent: true
    })
    return 1
  }

  if (typeof table.append !== 'function') {
    return 0
  }

  table.append({
    sessionId: record.sessionId,
    kind: 'message',
    name: `message/${record.role}`,
    source: {
      type: 'message',
      id: record.id,
      seq: 0
    },
    provenanceKey: buildMessageProvenanceKey(record, source),
    payload: {
      record: {
        id: record.id,
        sessionId: record.sessionId,
        orderSeq: record.orderSeq,
        role: record.role,
        content: record.content,
        status: record.status,
        isContextEdge: record.isContextEdge,
        metadata: record.metadata,
        traceCount: record.traceCount,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }
    },
    meta: {
      source,
      orderSeq: record.orderSeq,
      role: record.role,
      status: record.status
    },
    createdAt: record.createdAt,
    idempotent: true
  })

  return 1 + appendToolFactsToTape(table, record, source)
}

export function appendMessageReplacementToTape(
  table: DeepChatTapeEntriesTable | undefined,
  record: ChatMessageRecord,
  reason: string
): number {
  if (!table || typeof table.append !== 'function') {
    return 0
  }

  table.ensureBootstrapAnchor?.(record.sessionId)
  table.append({
    sessionId: record.sessionId,
    kind: 'message',
    name: `message/${record.role}`,
    source: {
      type: 'message',
      id: record.id,
      seq: record.updatedAt
    },
    provenanceKey: `message:${record.id}:revision:${record.updatedAt}`,
    payload: {
      record: {
        id: record.id,
        sessionId: record.sessionId,
        orderSeq: record.orderSeq,
        role: record.role,
        content: record.content,
        status: record.status,
        isContextEdge: record.isContextEdge,
        metadata: record.metadata,
        traceCount: record.traceCount,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }
    },
    meta: {
      source: 'live',
      correction: true,
      reason,
      orderSeq: record.orderSeq,
      role: record.role,
      status: record.status
    },
    createdAt: record.updatedAt,
    idempotent: true
  })

  return 1 + appendToolFactsToTape(table, record, 'repair')
}

export function appendMessageRetractionToTape(
  table: DeepChatTapeEntriesTable | undefined,
  record: ChatMessageRecord,
  reason: string
): number {
  if (!table || typeof table.appendEvent !== 'function') {
    return 0
  }

  table.ensureBootstrapAnchor?.(record.sessionId)
  table.appendEvent({
    sessionId: record.sessionId,
    name: 'message/retracted',
    source: {
      type: 'message',
      id: record.id,
      seq: Date.now()
    },
    provenanceKey: null,
    data: {
      messageId: record.id,
      orderSeq: record.orderSeq,
      role: record.role,
      reason
    },
    meta: {
      source: 'live',
      correction: true
    },
    idempotent: false
  })

  return 1
}

export function tapeEntryToMessageRecord(row: DeepChatTapeEntryRow): ChatMessageRecord | null {
  if (row.kind !== 'message') {
    return null
  }
  const payload = parsePayload(row)
  const record = payload?.record
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
    status:
      candidate.status === 'pending' || candidate.status === 'error' || candidate.status === 'sent'
        ? candidate.status
        : 'sent',
    isContextEdge: typeof candidate.isContextEdge === 'number' ? candidate.isContextEdge : 0,
    metadata: typeof candidate.metadata === 'string' ? candidate.metadata : '{}',
    traceCount: typeof candidate.traceCount === 'number' ? candidate.traceCount : 0,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : row.created_at,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : row.created_at
  }
}

export function tapeEntriesToEffectiveMessageRecords(
  rows: DeepChatTapeEntryRow[]
): ChatMessageRecord[] {
  return buildEffectiveTapeView(rows, { includePending: true }).messageRecords
}
