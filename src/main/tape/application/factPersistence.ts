import type { AssistantMessageBlock, ChatMessageRecord } from '@shared/types/agent-interface'
import {
  toTapeSessionId,
  type TapeFactSource,
  type TapeMessageReplacementOptions,
  type TapeToolFactInput
} from '@/tape/domain/facts'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import type { TapeBootstrapStore, TapeEntryStore } from '@/tape/ports/storage'
import { buildEffectiveTapeView } from '@/tape/domain/effectiveView'
import {
  parseAssistantBlocks,
  parseTapeJsonObject,
  readTapeToolIdentity,
  readTapeToolStatus
} from '@/tape/domain/effectiveSemantics'
import { hashJson } from '@/tape/domain/viewManifest'
import {
  readSkillContextEvidence,
  type TapeSkillContextEvidenceInput
} from '@/tape/domain/skillContext'
import { canonicalJsonStringifyData } from '@/tape/domain/canonicalJson'

export { tapeEntryToMessageRecord } from '@/tape/domain/effectiveSemantics'
export type { TapeFactSource } from '@/tape/domain/facts'

type TapeFactWriter = Pick<TapeEntryStore, 'append' | 'appendEvent'> & TapeBootstrapStore
type TapeFactStore = TapeFactWriter & Pick<TapeEntryStore, 'getBySessionExcludingContext'>

interface TapeToolRevisionState {
  semanticFingerprint: string
  entryId: number
}

type TapeToolRevisionIndex = Map<string, TapeToolRevisionState>

interface TapeMessageRecordAppendOptions {
  toolRevisionIndex?: TapeToolRevisionIndex
}

export interface TapeToolFactAppendOptions {
  reason?: string
  supersedesEntryId?: number
  skillContextEvidence?: TapeSkillContextEvidenceInput
  allowStoredSkillContextEvidence?: boolean
}

interface PreparedTapeToolFact {
  identityKey: string
  kind: 'tool_call' | 'tool_result'
  name: string
  payload: Record<string, unknown>
  status: 'success' | 'error'
  toolCallId: string
}

interface TapeToolFactSemanticContent {
  kind: 'tool_call' | 'tool_result'
  name: string | null
  payload: Record<string, unknown>
  status: 'success' | 'error'
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

function appendCompactionIndicatorToTape(
  table: TapeFactWriter,
  record: ChatMessageRecord,
  source: TapeFactSource,
  compactionStatus: string,
  correction?: TapeMessageReplacementOptions
): void {
  const orderRevision = correction?.revisionKind === 'order' ? `:order_seq:${record.orderSeq}` : ''
  table.appendEvent({
    sessionId: record.sessionId,
    name: 'message/compaction_indicator',
    source: {
      type: 'message',
      id: record.id,
      seq: record.updatedAt
    },
    provenanceKey: `message:${record.id}:compaction_indicator:${compactionStatus}:${record.updatedAt}${orderRevision}`,
    data: {
      messageId: record.id,
      orderSeq: record.orderSeq,
      status: compactionStatus,
      metadata: record.metadata
    },
    meta: correction
      ? {
          source,
          status: compactionStatus,
          correction: true,
          reason: correction.reason,
          orderSeq: record.orderSeq
        }
      : {
          source,
          status: compactionStatus
        },
    createdAt: record.updatedAt,
    idempotent: true
  })
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

function buildMessageReplacementProvenanceKey(
  record: ChatMessageRecord,
  options: TapeMessageReplacementOptions
): string {
  const orderRevision = options.revisionKind === 'order' ? `:order_seq:${record.orderSeq}` : ''
  return `message:${record.id}:revision:${record.updatedAt}${orderRevision}`
}

export function buildToolFactProvenanceKey(
  kind: 'tool_call' | 'tool_result',
  messageId: string,
  toolCallId: string,
  payload: Record<string, unknown>,
  supersedesEntryId?: number
): string {
  const revision = supersedesEntryId === undefined ? '' : `:after_entry:${supersedesEntryId}`
  return `${kind}:${messageId}:${toolCallId}:${hashJson(payload)}${revision}`
}

function buildToolFactSemanticFingerprint(fact: TapeToolFactSemanticContent): string {
  const payload = { ...fact.payload }
  delete payload.orderSeq
  return hashJson({ kind: fact.kind, name: fact.name, payload, status: fact.status })
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

function prepareTapeToolFact(input: TapeToolFactInput): PreparedTapeToolFact | null {
  const block = input.block
  const toolCall = block.type === 'tool_call' ? block.tool_call : undefined
  if (
    !toolCall?.id ||
    (block.status !== 'success' && block.status !== 'error') ||
    (input.provenance.source !== 'tool_call' && input.provenance.source !== 'tool_result')
  ) {
    return null
  }

  if (input.provenance.source === 'tool_call') {
    return {
      identityKey: `tool_call:${input.messageId}:${toolCall.id}`,
      kind: 'tool_call',
      name: toolCall.name || 'unknown',
      payload: {
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
      },
      status: block.status,
      toolCallId: toolCall.id
    }
  }

  if (typeof toolCall.response !== 'string' || toolCall.response.length === 0) return null
  return {
    identityKey: `tool_result:${input.messageId}:${toolCall.id}`,
    kind: 'tool_result',
    name: toolCall.name || 'unknown',
    payload: {
      messageId: input.messageId,
      orderSeq: input.orderSeq,
      toolCallId: toolCall.id,
      response: toolCall.response,
      rtkApplied: toolCall.rtkApplied,
      rtkMode: toolCall.rtkMode,
      rtkFallbackReason: toolCall.rtkFallbackReason,
      imagePreviews: toolCall.imagePreviews
    },
    status: block.status,
    toolCallId: toolCall.id
  }
}

function describeTapeToolFact(input: TapeToolFactInput): {
  prepared: PreparedTapeToolFact
  semanticFingerprint: string
} | null {
  const prepared = prepareTapeToolFact(input)
  if (!prepared) return null
  return {
    prepared,
    semanticFingerprint: buildToolFactSemanticFingerprint(prepared)
  }
}

export function buildTapeToolRevisionIndex(rows: DeepChatTapeEntryRow[]): TapeToolRevisionIndex {
  const revisions: TapeToolRevisionIndex = new Map()
  for (const row of rows) {
    const identity = readTapeToolIdentity(row)
    const status = readTapeToolStatus(row)
    if (
      !identity ||
      (row.kind !== 'tool_call' && row.kind !== 'tool_result') ||
      (status !== 'success' && status !== 'error')
    ) {
      continue
    }
    const current = revisions.get(identity.key)
    if (current && current.entryId > row.entry_id) continue
    revisions.set(identity.key, {
      semanticFingerprint: buildToolFactSemanticFingerprint({
        kind: row.kind,
        name: row.name,
        payload: parseTapeJsonObject(row.payload_json),
        status
      }),
      entryId: row.entry_id
    })
  }
  return revisions
}

function buildToolFactMeta(
  source: TapeFactSource,
  status: string,
  options: TapeToolFactAppendOptions,
  storedMeta?: Record<string, unknown>
): Record<string, unknown> {
  const baseMeta = options.reason
    ? { source, role: 'assistant', status, reason: options.reason }
    : { source, role: 'assistant', status }
  if (options.skillContextEvidence) {
    return {
      ...baseMeta,
      skillContextEvidence: readSkillContextEvidence({
        schemaVersion: 1,
        ...options.skillContextEvidence
      })
    }
  }
  if (options.allowStoredSkillContextEvidence && storedMeta?.skillContextEvidence) {
    return {
      ...baseMeta,
      skillContextEvidence: readSkillContextEvidence(storedMeta.skillContextEvidence)
    }
  }
  return baseMeta
}

export function appendTapeToolFact(
  table: TapeFactWriter,
  input: TapeToolFactInput,
  source: TapeFactSource,
  options: TapeToolFactAppendOptions = {}
): DeepChatTapeEntryRow | null {
  const block = input.block
  const described = describeTapeToolFact(input)
  if (!described) return null
  const { prepared } = described

  table.ensureBootstrapAnchor(input.sessionId)
  const meta = buildToolFactMeta(source, block.status, options)
  return table.append({
    sessionId: input.sessionId,
    kind: prepared.kind,
    name: prepared.name,
    source: {
      type: input.provenance.source,
      id: input.provenance.sourceId,
      seq: input.provenance.sequence
    },
    provenanceKey: buildToolFactProvenanceKey(
      prepared.kind,
      input.messageId,
      prepared.toolCallId,
      prepared.payload,
      options.supersedesEntryId
    ),
    payload: prepared.payload,
    meta,
    createdAt: block.timestamp,
    idempotent: true
  })
}

export function assertTapeToolFactPhysicalEnvelope(
  row: DeepChatTapeEntryRow,
  input: TapeToolFactInput,
  source: TapeFactSource,
  options: TapeToolFactAppendOptions = {}
): void {
  const described = describeTapeToolFact(input)
  if (!described) throw new Error('Tape tool fact input is not appendable.')
  const { prepared } = described
  const storedMeta = parseTapeJsonObject(row.meta_json)
  const expectedMeta = buildToolFactMeta(source, input.block.status, options, storedMeta)
  const expectedProvenanceKey = buildToolFactProvenanceKey(
    prepared.kind,
    input.messageId,
    prepared.toolCallId,
    prepared.payload,
    options.supersedesEntryId
  )
  const expectedPayload = parseTapeJsonObject(JSON.stringify(prepared.payload))
  if (
    row.session_id !== input.sessionId ||
    row.kind !== prepared.kind ||
    row.name !== prepared.name ||
    row.source_type !== input.provenance.source ||
    row.source_id !== input.provenance.sourceId ||
    row.source_seq !== input.provenance.sequence ||
    row.provenance_key !== expectedProvenanceKey ||
    row.created_at !== input.block.timestamp ||
    canonicalJsonStringifyData(parseTapeJsonObject(row.payload_json)) !==
      canonicalJsonStringifyData(expectedPayload) ||
    canonicalJsonStringifyData(storedMeta) !== canonicalJsonStringifyData(expectedMeta)
  ) {
    throw new Error('Tape tool fact physical envelope is corrupt.')
  }
}

function appendToolFactInputsWithRevisionIndex(
  table: TapeFactWriter,
  inputs: TapeToolFactInput[],
  source: TapeFactSource,
  revisionIndex: TapeToolRevisionIndex,
  reason?: string
): number {
  let appended = 0
  for (const input of inputs) {
    const described = describeTapeToolFact(input)
    if (!described) continue
    const current = revisionIndex.get(described.prepared.identityKey)
    if (current?.semanticFingerprint === described.semanticFingerprint) continue

    const row = appendTapeToolFact(table, input, source, {
      reason,
      supersedesEntryId: current?.entryId
    })
    if (!row) continue
    revisionIndex.set(described.prepared.identityKey, {
      semanticFingerprint: described.semanticFingerprint,
      entryId: row.entry_id
    })
    appended += 1
  }
  return appended
}

export function appendToolFactsToTape(
  table: TapeFactWriter,
  record: ChatMessageRecord,
  source: TapeFactSource,
  reason?: string
): number {
  if (record.role !== 'assistant') {
    return 0
  }

  return buildTapeToolFactInputs(record).reduce(
    (appended, input) => appended + (appendTapeToolFact(table, input, source, { reason }) ? 1 : 0),
    0
  )
}

export function appendMessageRecordToTape(
  table: TapeFactWriter,
  record: ChatMessageRecord,
  source: TapeFactSource,
  options: TapeMessageRecordAppendOptions = {}
): number {
  table.ensureBootstrapAnchor(record.sessionId)

  const compactionStatus = readCompactionStatus(record)
  if (compactionStatus) {
    appendCompactionIndicatorToTape(table, record, source, compactionStatus)
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

  const toolInputs = buildTapeToolFactInputs(record)
  return (
    1 +
    (options.toolRevisionIndex
      ? appendToolFactInputsWithRevisionIndex(table, toolInputs, source, options.toolRevisionIndex)
      : toolInputs.reduce(
          (appended, input) => appended + (appendTapeToolFact(table, input, source) ? 1 : 0),
          0
        ))
  )
}

export function appendMessageReplacementToTape(
  table: TapeFactStore,
  record: ChatMessageRecord,
  options: TapeMessageReplacementOptions
): number {
  table.ensureBootstrapAnchor(record.sessionId)
  const compactionStatus = readCompactionStatus(record)
  if (compactionStatus) {
    appendCompactionIndicatorToTape(table, record, 'live', compactionStatus, options)
    return 1
  }

  const toolInputs = options.revisionKind === 'record' ? buildTapeToolFactInputs(record) : []
  const toolRevisionIndex =
    toolInputs.length > 0
      ? buildTapeToolRevisionIndex(table.getBySessionExcludingContext(record.sessionId))
      : null

  table.append({
    sessionId: record.sessionId,
    kind: 'message',
    name: `message/${record.role}`,
    source: {
      type: 'message',
      id: record.id,
      seq: record.updatedAt
    },
    provenanceKey: buildMessageReplacementProvenanceKey(record, options),
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
      reason: options.reason,
      orderSeq: record.orderSeq,
      role: record.role,
      status: record.status
    },
    createdAt: record.updatedAt,
    idempotent: true
  })

  return (
    1 +
    (toolRevisionIndex
      ? appendToolFactInputsWithRevisionIndex(table, toolInputs, 'repair', toolRevisionIndex)
      : 0)
  )
}

export function appendMessageRetractionToTape(
  table: TapeFactWriter,
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
