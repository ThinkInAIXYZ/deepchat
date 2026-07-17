import type { AssistantMessageBlock, ChatMessageRecord } from '@shared/types/agent-interface'
import { toTapeSessionId, type TapeFactSource, type TapeToolFactInput } from '@/tape/domain/facts'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import type { TapeBootstrapStore, TapeEntryStore } from '@/tape/ports/storage'
import { buildEffectiveTapeView } from '@/tape/domain/effectiveView'
import { parseAssistantBlocks } from '@/tape/domain/effectiveSemantics'
import { hashJson } from '@/tape/domain/viewManifest'

export { tapeEntryToMessageRecord } from '@/tape/domain/effectiveSemantics'
export type { TapeFactSource } from '@/tape/domain/facts'

type TapeFactStore = Pick<TapeEntryStore, 'append' | 'appendEvent'> & TapeBootstrapStore

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
      block?.type === 'action' &&
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

export function buildTapeToolFactInputs(record: ChatMessageRecord): TapeToolFactInput[] {
  if (record.role !== 'assistant') return []

  const inputs: TapeToolFactInput[] = []
  const blocks = parseAssistantBlocks(record.content)
  const pendingInteractionToolIds = collectPendingInteractionToolIds(blocks)
  blocks.forEach((block, blockIndex) => {
    if (block?.type !== 'tool_call' || !block.tool_call) return
    if (block.status !== 'success' && block.status !== 'error') return

    const toolCallId = block.tool_call.id
    if (!toolCallId || pendingInteractionToolIds.has(toolCallId)) return
    const sourceId = `${record.id}:${toolCallId}`
    const factBlock =
      block.timestamp === undefined ? { ...block, timestamp: record.updatedAt } : block
    inputs.push({
      sessionId: toTapeSessionId(record.sessionId),
      messageId: record.id,
      orderSeq: record.orderSeq,
      blockIndex,
      block: factBlock,
      provenance: { source: 'tool_call', sourceId, sequence: blockIndex }
    })
    if (typeof block.tool_call.response === 'string' && block.tool_call.response.length > 0) {
      inputs.push({
        sessionId: toTapeSessionId(record.sessionId),
        messageId: record.id,
        orderSeq: record.orderSeq,
        blockIndex,
        block: factBlock,
        provenance: { source: 'tool_result', sourceId, sequence: blockIndex }
      })
    }
  })
  return inputs
}

export function appendTapeToolFact(
  table: TapeFactStore,
  input: TapeToolFactInput,
  source: TapeFactSource,
  reason?: string
): DeepChatTapeEntryRow | null {
  const block = input.block
  const toolCall = block.type === 'tool_call' ? block.tool_call : undefined
  if (
    !toolCall?.id ||
    (block.status !== 'success' && block.status !== 'error') ||
    (input.provenance.source !== 'tool_call' && input.provenance.source !== 'tool_result')
  ) {
    return null
  }

  table.ensureBootstrapAnchor(input.sessionId)
  const meta = reason
    ? { source, role: 'assistant', status: block.status, reason }
    : { source, role: 'assistant', status: block.status }
  if (input.provenance.source === 'tool_call') {
    const payload = {
      messageId: input.messageId,
      orderSeq: input.orderSeq,
      toolCall: {
        id: toolCall.id,
        name: toolCall.name,
        params: toolCall.params,
        serverName: toolCall.server_name,
        serverIcons: toolCall.server_icons,
        serverDescription: toolCall.server_description
      }
    }
    return table.append({
      sessionId: input.sessionId,
      kind: 'tool_call',
      name: toolCall.name || 'unknown',
      source: {
        type: input.provenance.source,
        id: input.provenance.sourceId,
        seq: input.provenance.sequence
      },
      provenanceKey: buildToolFactProvenanceKey('tool_call', input.messageId, toolCall.id, payload),
      payload,
      meta,
      createdAt: block.timestamp,
      idempotent: true
    })
  }

  if (typeof toolCall.response !== 'string' || toolCall.response.length === 0) return null
  const payload = {
    messageId: input.messageId,
    orderSeq: input.orderSeq,
    toolCallId: toolCall.id,
    response: toolCall.response,
    rtkApplied: toolCall.rtkApplied,
    rtkMode: toolCall.rtkMode,
    rtkFallbackReason: toolCall.rtkFallbackReason,
    imagePreviews: toolCall.imagePreviews
  }
  return table.append({
    sessionId: input.sessionId,
    kind: 'tool_result',
    name: toolCall.name || 'unknown',
    source: {
      type: input.provenance.source,
      id: input.provenance.sourceId,
      seq: input.provenance.sequence
    },
    provenanceKey: buildToolFactProvenanceKey('tool_result', input.messageId, toolCall.id, payload),
    payload,
    meta,
    createdAt: block.timestamp,
    idempotent: true
  })
}

export function appendToolFactsToTape(
  table: TapeFactStore,
  record: ChatMessageRecord,
  source: TapeFactSource,
  reason?: string
): number {
  if (record.role !== 'assistant') {
    return 0
  }

  return buildTapeToolFactInputs(record).reduce(
    (appended, input) => appended + (appendTapeToolFact(table, input, source, reason) ? 1 : 0),
    0
  )
}

export function appendMessageRecordToTape(
  table: TapeFactStore,
  record: ChatMessageRecord,
  source: TapeFactSource
): number {
  table.ensureBootstrapAnchor(record.sessionId)

  const compactionStatus = readCompactionStatus(record)
  if (compactionStatus) {
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
  table: TapeFactStore,
  record: ChatMessageRecord,
  reason: string
): number {
  table.ensureBootstrapAnchor(record.sessionId)
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
  table: TapeFactStore,
  record: ChatMessageRecord,
  reason: string
): number {
  table.ensureBootstrapAnchor(record.sessionId)
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

export function tapeEntriesToEffectiveMessageRecords(
  rows: DeepChatTapeEntryRow[]
): ChatMessageRecord[] {
  return buildEffectiveTapeView(rows, { includePending: true }).messageRecords
}
