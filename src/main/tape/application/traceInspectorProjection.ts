import { Buffer } from 'node:buffer'
import type { JsonValue } from '@shared/contracts/json'
import type {
  TapeInspectorFactFilters,
  TapeInspectorFactRecord,
  TapeInspectorFacts,
  TapeInspectorRecordDetail
} from '@shared/types/tape-inspector'
import { redactBody } from '@/lib/redact'
import type { DeepChatTapeEntryRow } from '../domain/entry'
import {
  EXECUTION_JOURNAL_EVENT_NAMES,
  isNestedExecutionOperationIdentity,
  parseExecutionJournalFact
} from '../domain/executionJournal'
import {
  parseTapeProviderAttemptEvent,
  TAPE_PROVIDER_ATTEMPT_EVENT_NAME
} from '../domain/providerAttempt'
import { hashString, normalizeStoredTapeViewManifest } from '../domain/replay'
import {
  TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME,
  TAPE_TOOL_CATALOG_EVENT_NAME,
  TAPE_TOOL_SURFACE_EVENT_NAME,
  verifyTapeProgrammaticToolSurfaceFact,
  verifyTapeToolCatalogFact,
  verifyTapeToolSurfaceFact
} from '../domain/toolSurfaceFacts'
import { TAPE_VIEW_MANIFEST_EVENT_NAME, verifyTapeViewManifestHash } from '../domain/viewManifest'
import { CONTRACT_TAPE_EVENT_NAMES } from '../domain/contractFacts'
import { isDeepChatTaskContract, isDeepChatTaskContractRef } from '../domain/taskContract'
import { isDeepChatTaskEvaluation } from '../domain/taskEvaluation'
import { SKILL_MATERIALIZATION_NAME } from '../domain/skillMaterialization'
import { SUMMARY_ANCHOR_NAMES } from '../domain/entry'
import type { TapeInspectorTraceBinding } from '../ports/application'
import { parseJsonObject } from './common'

const MAX_LIST_TEXT_BYTES = 1_024
const MAX_DETAIL_STRING_BYTES = 16 * 1_024
const MAX_DETAIL_ARRAY_ITEMS = 256
const MAX_DETAIL_OBJECT_KEYS = 256
const MAX_DETAIL_DEPTH = 16
const RECOGNIZED_ANCHOR_NAMES = new Set<string>([
  'session/start',
  'fork/start',
  'summary/reset',
  ...SUMMARY_ANCHOR_NAMES
])

function boundedString(value: unknown, maxBytes = MAX_LIST_TEXT_BYTES): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let result = ''
  let bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maxBytes) break
    result += character
    bytes += size
  }
  return result
}

function boundedIdentity(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= MAX_LIST_TEXT_BYTES
    ? value
    : undefined
}

function eventData(row: DeepChatTapeEntryRow): Record<string, unknown> | null {
  const payload = parseJsonObject(row.payload_json)
  return payload.name === row.name &&
    payload.data &&
    typeof payload.data === 'object' &&
    !Array.isArray(payload.data)
    ? (payload.data as Record<string, unknown>)
    : null
}

function executionProjection(row: DeepChatTapeEntryRow): Partial<TapeInspectorFactRecord> | null {
  if (
    !EXECUTION_JOURNAL_EVENT_NAMES.includes(
      row.name as (typeof EXECUTION_JOURNAL_EVENT_NAMES)[number]
    )
  ) {
    return null
  }
  try {
    const fact = parseExecutionJournalFact(row)
    const projection: Partial<TapeInspectorFactRecord> = {
      family: 'journal',
      runId: fact.runId,
      messageId: fact.messageId
    }
    if (fact.type === 'execution/run_terminal') {
      projection.facts = {
        outcome: boundedString(fact.outcome),
        stopReason: boundedString(fact.stopReason)
      }
    } else if (fact.type === 'execution/dispatch_committed') {
      projection.requestSeq = fact.operation.requestSeq
      projection.providerToolCallId = fact.operation.providerToolCallId
      if (isNestedExecutionOperationIdentity(fact.operation)) {
        projection.childOrdinal = fact.operation.childOrdinal
      }
      projection.facts = {
        toolName: boundedString(fact.toolName),
        toolSource: fact.toolSource,
        targetServer: boundedString(fact.target.serverName)
      }
    } else if (fact.type === 'execution/tool_outcome') {
      projection.requestSeq = fact.operation.requestSeq
      projection.providerToolCallId = fact.operation.providerToolCallId
      if (isNestedExecutionOperationIdentity(fact.operation)) {
        projection.childOrdinal = fact.operation.childOrdinal
      }
      projection.facts = { isError: fact.isError }
    }
    return projection
  } catch {
    return null
  }
}

function attemptProjection(row: DeepChatTapeEntryRow): Partial<TapeInspectorFactRecord> | null {
  if (row.name !== TAPE_PROVIDER_ATTEMPT_EVENT_NAME) return null
  const attempt = parseTapeProviderAttemptEvent(row)
  if (!attempt) return null
  const facts: TapeInspectorFacts = {
    providerId: boundedString(attempt.providerId),
    modelId: boundedString(attempt.modelId),
    status: attempt.status,
    ...(attempt.stopReason ? { stopReason: attempt.stopReason } : {}),
    usage: attempt.usage
      ? {
          inputTokens: attempt.usage.inputTokens,
          outputTokens: attempt.usage.outputTokens,
          totalTokens: attempt.usage.totalTokens,
          ...(attempt.usage.cacheReadTokens === null
            ? {}
            : { cacheReadTokens: attempt.usage.cacheReadTokens }),
          ...(attempt.usage.cacheWriteTokens === null
            ? {}
            : { cacheWriteTokens: attempt.usage.cacheWriteTokens })
        }
      : undefined
  }
  return {
    family: 'attempt',
    messageId: boundedIdentity(attempt.messageId),
    requestSeq: attempt.requestSeq,
    ...('logicalRound' in attempt
      ? {
          logicalRound: attempt.logicalRound,
          physicalAttempt: attempt.physicalAttempt,
          facts: {
            ...facts,
            retryDecision: attempt.retryDecision,
            ...(attempt.errorCode ? { errorCode: boundedString(attempt.errorCode) } : {})
          }
        }
      : { facts })
  }
}

function viewProjection(row: DeepChatTapeEntryRow): Partial<TapeInspectorFactRecord> | null {
  const data = eventData(row)
  if (!data) return null
  if (row.name === TAPE_VIEW_MANIFEST_EVENT_NAME) {
    const manifest = normalizeStoredTapeViewManifest(data.manifest, row.session_id)
    if (
      !manifest ||
      row.source_type !== 'runtime_event' ||
      row.source_id !== manifest.messageId ||
      row.source_seq !== manifest.requestSeq
    ) {
      return null
    }
    const messageId = boundedIdentity(manifest.messageId)
    const runId = 'runId' in manifest ? boundedIdentity(manifest.runId) : undefined
    return {
      family: 'view',
      ...(messageId ? { messageId } : {}),
      requestSeq: manifest.requestSeq,
      ...(runId ? { runId } : {}),
      hashes: {
        payloadHash: hashString(row.payload_json),
        metaHash: hashString(row.meta_json),
        manifestHash: manifest.hashes.manifestHash
      },
      integrity: verifyTapeViewManifestHash(manifest)
    }
  }
  if (row.name === TAPE_TOOL_CATALOG_EVENT_NAME && verifyTapeToolCatalogFact(data)) {
    return { family: 'view' }
  }
  if (row.name === TAPE_TOOL_SURFACE_EVENT_NAME && verifyTapeToolSurfaceFact(data)) {
    const runId = boundedIdentity(data.request.runId)
    const messageId = boundedIdentity(data.request.messageId)
    return {
      family: 'view',
      ...(runId ? { runId } : {}),
      ...(messageId ? { messageId } : {}),
      requestSeq: data.request.requestSeq,
      hashes: {
        payloadHash: hashString(row.payload_json),
        metaHash: hashString(row.meta_json),
        manifestHash: data.manifestHash
      }
    }
  }
  if (
    row.name === TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME &&
    verifyTapeProgrammaticToolSurfaceFact(data)
  ) {
    const runId = boundedIdentity(data.request.runId)
    const messageId = boundedIdentity(data.request.messageId)
    return {
      family: 'view',
      ...(runId ? { runId } : {}),
      ...(messageId ? { messageId } : {}),
      requestSeq: data.request.requestSeq,
      hashes: {
        payloadHash: hashString(row.payload_json),
        metaHash: hashString(row.meta_json),
        manifestHash: data.manifestHash
      }
    }
  }
  return null
}

function contractProjection(row: DeepChatTapeEntryRow): Partial<TapeInspectorFactRecord> | null {
  if (!CONTRACT_TAPE_EVENT_NAMES.includes(row.name as (typeof CONTRACT_TAPE_EVENT_NAMES)[number])) {
    return null
  }
  const data = eventData(row)
  if (!data || data.schemaVersion !== 1) return null
  if (row.name === 'contract/task_frozen' && isDeepChatTaskContract(data.contract)) {
    return { family: 'contract' }
  }
  if (
    row.name === 'contract/evaluated' &&
    isDeepChatTaskEvaluation(data.evaluation) &&
    isDeepChatTaskContractRef(data.taskContractRef)
  ) {
    return { family: 'contract' }
  }
  return null
}

function lineageProjection(row: DeepChatTapeEntryRow): Partial<TapeInspectorFactRecord> | null {
  if (row.name === 'subagent/tape_linked') {
    const data = eventData(row)
    if (!data || (data.linkVersion !== 1 && data.linkVersion !== 2)) return null
    const runId = boundedIdentity(data.runId)
    return runId ? { family: 'lineage', runId } : null
  }
  if (row.name === 'fork/start' && row.kind === 'anchor' && row.source_type === 'fork') {
    return { family: 'lineage' }
  }
  if (
    (row.name === 'fork/merge' || row.name === 'fork/discard') &&
    row.kind === 'event' &&
    row.source_type === 'fork' &&
    eventData(row)
  ) {
    return { family: 'lineage' }
  }
  return null
}

function messageProjection(row: DeepChatTapeEntryRow): Partial<TapeInspectorFactRecord> | null {
  if (row.kind === 'message' && (row.name === 'message/user' || row.name === 'message/assistant')) {
    const payload = parseJsonObject(row.payload_json)
    const record =
      payload.record && typeof payload.record === 'object' && !Array.isArray(payload.record)
        ? (payload.record as Record<string, unknown>)
        : null
    const messageId = boundedIdentity(record?.id)
    return messageId ? { family: 'message', messageId } : null
  }
  if (
    row.kind === 'event' &&
    (row.name === 'message/retracted' || row.name === 'message/compaction_indicator')
  ) {
    const data = eventData(row)
    const messageId = boundedIdentity(data?.messageId)
    return messageId ? { family: 'message', messageId } : null
  }
  return null
}

function toolProjection(row: DeepChatTapeEntryRow): Partial<TapeInspectorFactRecord> | null {
  if (row.kind !== 'tool_call' && row.kind !== 'tool_result') return null
  const payload = parseJsonObject(row.payload_json)
  const messageId = boundedIdentity(payload.messageId)
  const toolCall =
    payload.toolCall && typeof payload.toolCall === 'object' && !Array.isArray(payload.toolCall)
      ? (payload.toolCall as Record<string, unknown>)
      : null
  const providerToolCallId = boundedIdentity(
    row.kind === 'tool_call' ? toolCall?.id : payload.toolCallId
  )
  const meta = parseJsonObject(row.meta_json)
  const status = boundedString(meta.status)
  return {
    family: 'tool',
    ...(messageId ? { messageId } : {}),
    ...(providerToolCallId ? { providerToolCallId } : {}),
    facts: {
      ...(boundedString(row.name) ? { toolName: boundedString(row.name) } : {}),
      ...(status ? { status } : {})
    }
  }
}

function semanticProjection(row: DeepChatTapeEntryRow): Partial<TapeInspectorFactRecord> {
  if (row.kind === 'context') return { family: 'context' }
  return (
    executionProjection(row) ??
    attemptProjection(row) ??
    viewProjection(row) ??
    contractProjection(row) ??
    lineageProjection(row) ??
    messageProjection(row) ??
    toolProjection(row) ??
    (row.kind === 'anchor' && RECOGNIZED_ANCHOR_NAMES.has(row.name ?? '')
      ? { family: 'anchor' as const }
      : { family: 'other' as const })
  )
}

export function projectTapeInspectorFact(row: DeepChatTapeEntryRow): TapeInspectorFactRecord {
  const semantic = semanticProjection(row)
  const hashes = semantic.hashes ?? {
    payloadHash: hashString(row.payload_json),
    metaHash: hashString(row.meta_json)
  }
  return {
    recordType: 'fact',
    key: `entry:${row.entry_id}`,
    entryId: row.entry_id,
    kind: row.kind,
    family: semantic.family ?? 'other',
    name: row.name,
    ...(row.source_type ? { sourceType: row.source_type } : {}),
    ...(boundedIdentity(row.source_id) ? { sourceId: boundedIdentity(row.source_id) } : {}),
    ...(row.source_seq === null ? {} : { sourceSeq: row.source_seq }),
    createdAt: row.created_at,
    ...semantic,
    hashes
  }
}

function factStatus(record: TapeInspectorFactRecord): string | undefined {
  return record.facts?.status ?? record.facts?.outcome
}

export function matchesTapeInspectorFilters(
  record: TapeInspectorFactRecord,
  filters: TapeInspectorFactFilters | undefined
): boolean {
  if (!filters) return true
  if (filters.kinds?.length && !filters.kinds.includes(record.kind)) return false
  if (filters.families?.length && !filters.families.includes(record.family)) return false
  if (filters.name !== undefined && record.name !== filters.name) return false
  if (filters.namePrefix !== undefined && !record.name?.startsWith(filters.namePrefix)) return false
  if (filters.factStatus !== undefined && factStatus(record) !== filters.factStatus) return false
  if (filters.messageId !== undefined && record.messageId !== filters.messageId) return false
  if (filters.requestSeq !== undefined && record.requestSeq !== filters.requestSeq) return false
  if (filters.errorsOnly) {
    return (
      record.facts?.isError === true ||
      record.facts?.status === 'error' ||
      record.facts?.outcome === 'error'
    )
  }
  return true
}

function boundedJson(value: unknown, depth = 0): JsonValue {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return boundedString(value, MAX_DETAIL_STRING_BYTES) ?? ''
  if (depth >= MAX_DETAIL_DEPTH) return '[truncated]'
  if (Array.isArray(value)) {
    return value.slice(0, MAX_DETAIL_ARRAY_ITEMS).map((item) => boundedJson(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_DETAIL_OBJECT_KEYS)
        .map(([key, nested]) => [boundedString(key) ?? '', boundedJson(nested, depth + 1)])
    )
  }
  return null
}

function allowedDetailData(row: DeepChatTapeEntryRow): JsonValue | undefined {
  if (row.name && EXECUTION_JOURNAL_EVENT_NAMES.includes(row.name as never)) {
    try {
      return boundedJson(redactBody(parseExecutionJournalFact(row)))
    } catch {
      return undefined
    }
  }
  if (row.name === TAPE_PROVIDER_ATTEMPT_EVENT_NAME) {
    const attempt = parseTapeProviderAttemptEvent(row)
    return attempt ? boundedJson(redactBody(attempt)) : undefined
  }
  if (row.kind === 'anchor' && RECOGNIZED_ANCHOR_NAMES.has(row.name ?? '')) {
    const payload = parseJsonObject(row.payload_json)
    const state = payload.state
    if (state && typeof state === 'object' && !Array.isArray(state)) {
      return boundedJson(redactBody({ name: row.name, state }))
    }
  }
  return undefined
}

export function projectTapeInspectorDetail(row: DeepChatTapeEntryRow): TapeInspectorRecordDetail {
  const data =
    row.kind === 'context' || row.name === SKILL_MATERIALIZATION_NAME
      ? undefined
      : allowedDetailData(row)
  return {
    record: projectTapeInspectorFact(row),
    disclosure: data === undefined ? 'metadata_only' : 'structured',
    provenance: {
      ...(row.source_type ? { sourceType: row.source_type } : {}),
      ...(boundedIdentity(row.source_id) ? { sourceId: boundedIdentity(row.source_id) } : {}),
      ...(row.source_seq === null ? {} : { sourceSeq: row.source_seq }),
      ...(row.provenance_key ? { provenanceKey: boundedString(row.provenance_key) } : {})
    },
    hashes: {
      payloadHash: hashString(row.payload_json),
      metaHash: hashString(row.meta_json)
    },
    sizes: {
      payloadBytes: Buffer.byteLength(row.payload_json, 'utf8'),
      metaBytes: Buffer.byteLength(row.meta_json, 'utf8')
    },
    ...(data === undefined ? {} : { data })
  }
}

export function getTapeInspectorTraceBinding(
  record: TapeInspectorFactRecord
): TapeInspectorTraceBinding | null {
  if (!record.messageId || record.requestSeq === undefined) return null
  return record.physicalAttempt !== undefined || record.family === 'attempt'
    ? {
        scope: 'attempt',
        messageId: record.messageId,
        requestSeq: record.requestSeq,
        physicalAttempt: record.physicalAttempt ?? null
      }
    : {
        scope: 'request',
        messageId: record.messageId,
        requestSeq: record.requestSeq
      }
}
