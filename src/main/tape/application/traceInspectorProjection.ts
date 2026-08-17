import { Buffer } from 'node:buffer'
import type { JsonValue } from '@shared/contracts/json'
import type {
  TapeInspectorFactFilters,
  TapeInspectorFactRecord,
  TapeInspectorFacts,
  TapeInspectorRecordDetail
} from '@shared/types/tape-inspector'
import {
  AGENT_MEMORY_DIRECTIVE_KINDS,
  AGENT_MEMORY_DIRECTIVE_SOURCES,
  AGENT_MEMORY_HEALTH_KIND_KEYS,
  MEMORY_RETRIEVAL_DEGRADATION_CAUSES
} from '@shared/types/agent-memory'
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
const MEMORY_VIEW_ANCHOR_NAME = 'memory/view_assembled'
const DIRECTIVE_VIEW_ANCHOR_NAME = 'memory/directive_view_assembled'
const RECOGNIZED_ANCHOR_NAMES = new Set<string>([
  'session/start',
  'fork/start',
  'summary/reset',
  MEMORY_VIEW_ANCHOR_NAME,
  DIRECTIVE_VIEW_ANCHOR_NAME,
  ...SUMMARY_ANCHOR_NAMES
])
const CURRENT_COMPACTION_STATE_KEYS = [
  'cursorOrderSeq',
  'previousSummaryUpdatedAt',
  'range',
  'retainedTokenEstimate',
  'retainedTokenTarget',
  'retainedTurnCount',
  'sourceMessageIds',
  'summary',
  'summaryableTurnCount'
] as const
const MIGRATED_COMPACTION_STATE_KEYS = [
  'cursorOrderSeq',
  'migratedFrom',
  'range',
  'sourceMessageIds',
  'summary'
] as const

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

function boundedNullableString(value: string | null): string | null {
  if (value === null || Buffer.byteLength(value, 'utf8') <= MAX_LIST_TEXT_BYTES) return value
  return boundedString(value) ?? ''
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function redactSerializedApiKeyFields(text: string): string {
  return /["'](?:api_key|apiKey)["']\s*[:=]/u.test(text) ? '***MASKED***' : text
}

function redactEmbeddedApiKey(text: string): string {
  try {
    return JSON.stringify(redactBody(JSON.parse(text)))
  } catch {
    return redactSerializedApiKeyFields(text)
  }
}

function boundedToolContent(value: unknown, maxBytes = MAX_LIST_TEXT_BYTES): string | undefined {
  if (typeof value !== 'string') return undefined
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return boundedString(redactEmbeddedApiKey(value), maxBytes)
  }
  const prefix = boundedString(value, maxBytes)
  return prefix === undefined ? undefined : redactSerializedApiKeyFields(prefix)
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
  const detail = projectToolDetailData(row)
  const messageId = detail ? boundedIdentity(detail.messageId) : undefined
  const providerToolCallId = detail
    ? boundedIdentity(detail.kind === 'tool_call' ? detail.toolCall.id : detail.toolCallId)
    : undefined
  const meta = parseJsonObject(row.meta_json)
  const status = boundedString(meta.status)
  const contentPreview = detail
    ? boundedToolContent(detail.kind === 'tool_call' ? detail.toolCall.params : detail.response)
    : undefined
  return {
    family: 'tool',
    ...(messageId ? { messageId } : {}),
    ...(providerToolCallId ? { providerToolCallId } : {}),
    facts: {
      ...(boundedString(row.name) ? { toolName: boundedString(row.name) } : {}),
      ...(status ? { status } : {}),
      ...(contentPreview ? { contentPreview } : {})
    }
  }
}

function projectMemorySelection(value: unknown): JsonValue | undefined {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ['id', 'kind', 'score', 'sources', 'similarity', 'breakdown'])
  ) {
    return undefined
  }
  const id = boundedIdentity(value.id)
  const kind = boundedString(value.kind)
  if (!id || !kind || !AGENT_MEMORY_HEALTH_KIND_KEYS.includes(kind as never)) return undefined
  const score = finiteNumber(value.score)
  const similarity = finiteNumber(value.similarity)
  if (value.score !== undefined && score === undefined) return undefined
  if (value.similarity !== undefined && similarity === undefined) return undefined
  if (
    value.sources !== undefined &&
    (!isPlainObject(value.sources) ||
      !hasOnlyKeys(value.sources, ['vec', 'fts']) ||
      (value.sources.vec !== undefined && typeof value.sources.vec !== 'boolean') ||
      (value.sources.fts !== undefined && typeof value.sources.fts !== 'boolean'))
  ) {
    return undefined
  }
  const sources = isPlainObject(value.sources)
    ? {
        ...(typeof value.sources.vec === 'boolean' ? { vec: value.sources.vec } : {}),
        ...(typeof value.sources.fts === 'boolean' ? { fts: value.sources.fts } : {})
      }
    : undefined
  return {
    id,
    kind,
    ...(score === undefined ? {} : { score }),
    ...(similarity === undefined ? {} : { similarity }),
    ...(sources && Object.keys(sources).length > 0 ? { sources } : {})
  }
}

function projectMemoryDrop(value: unknown): JsonValue | undefined {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['id', 'kind', 'reason'])) return undefined
  const id = boundedIdentity(value.id)
  const kind = boundedString(value.kind)
  if (
    !id ||
    !kind ||
    !AGENT_MEMORY_HEALTH_KIND_KEYS.includes(kind as never) ||
    value.reason !== 'budget'
  ) {
    return undefined
  }
  return { id, kind, reason: value.reason }
}

function projectDirectiveSelection(value: unknown): JsonValue | undefined {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['id', 'kind', 'source'])) return undefined
  const id = boundedIdentity(value.id)
  const kind = boundedString(value.kind)
  const source = boundedString(value.source)
  return id &&
    kind &&
    source &&
    AGENT_MEMORY_DIRECTIVE_KINDS.includes(kind as never) &&
    AGENT_MEMORY_DIRECTIVE_SOURCES.includes(source as never)
    ? { id, kind, source }
    : undefined
}

function projectDirectiveDrop(value: unknown): JsonValue | undefined {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['id', 'kind', 'reason'])) return undefined
  const id = boundedIdentity(value.id)
  const kind = boundedString(value.kind)
  const reason = boundedString(value.reason)
  return id &&
    kind &&
    AGENT_MEMORY_DIRECTIVE_KINDS.includes(kind as never) &&
    (reason === 'item_budget' || reason === 'total_budget')
    ? { id, kind, reason }
    : undefined
}

function projectMemoryTokenMap(value: unknown): JsonValue | undefined {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['directive', 'persona', 'working', 'queryRecall'])
  ) {
    return undefined
  }
  const directive = nonNegativeNumber(value.directive)
  const persona = nonNegativeNumber(value.persona)
  const working = nonNegativeNumber(value.working)
  const queryRecall = nonNegativeNumber(value.queryRecall)
  return directive === undefined ||
    persona === undefined ||
    working === undefined ||
    queryRecall === undefined
    ? undefined
    : { directive, persona, working, queryRecall }
}

function projectMemoryAllocation(value: unknown): JsonValue | undefined {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'policyVersion',
      'totalTokenBudget',
      'overheadTokens',
      'demand',
      'allocated',
      'used',
      'borrowed',
      'unallocatedTokens',
      'estimatedTotalTokens',
      'unusedTokens',
      'constrained'
    ])
  ) {
    return undefined
  }
  const policyVersion = nonNegativeNumber(value.policyVersion)
  const totalTokenBudget = nonNegativeNumber(value.totalTokenBudget)
  const overheadTokens = nonNegativeNumber(value.overheadTokens)
  const demand = projectMemoryTokenMap(value.demand)
  const allocated = projectMemoryTokenMap(value.allocated)
  const used = projectMemoryTokenMap(value.used)
  const borrowed = projectMemoryTokenMap(value.borrowed)
  const unallocatedTokens = nonNegativeNumber(value.unallocatedTokens)
  const estimatedTotalTokens = nonNegativeNumber(value.estimatedTotalTokens)
  const unusedTokens = nonNegativeNumber(value.unusedTokens)
  if (
    policyVersion === undefined ||
    totalTokenBudget === undefined ||
    overheadTokens === undefined ||
    demand === undefined ||
    allocated === undefined ||
    used === undefined ||
    borrowed === undefined ||
    unallocatedTokens === undefined ||
    estimatedTotalTokens === undefined ||
    unusedTokens === undefined ||
    typeof value.constrained !== 'boolean'
  ) {
    return undefined
  }
  return {
    policyVersion,
    totalTokenBudget,
    overheadTokens,
    demand,
    allocated,
    used,
    borrowed,
    unallocatedTokens,
    estimatedTotalTokens,
    unusedTokens,
    constrained: value.constrained
  }
}

interface ProjectedMemoryAnchor {
  data: JsonValue
  facts: TapeInspectorFacts
  messageId?: string
}

function projectMemoryAnchor(row: DeepChatTapeEntryRow): ProjectedMemoryAnchor | null {
  if (row.kind !== 'anchor') return null
  const state = anchorState(row)
  if (!state) return null
  const meta = parseJsonObject(row.meta_json)
  const messageId = boundedIdentity(meta.messageId)

  if (row.name === MEMORY_VIEW_ANCHOR_NAME) {
    if (
      !hasOnlyKeys(state, [
        'policyVersion',
        'selected',
        'dropped',
        'tokenBudget',
        'estimatedTokens',
        'allocation',
        'queryHash',
        'degradations'
      ]) ||
      state.policyVersion !== 1 ||
      !Array.isArray(state.selected) ||
      !Array.isArray(state.dropped) ||
      state.selected.length > MAX_DETAIL_ARRAY_ITEMS ||
      state.dropped.length > MAX_DETAIL_ARRAY_ITEMS
    ) {
      return null
    }
    const selected = state.selected.map(projectMemorySelection)
    const dropped = state.dropped.map(projectMemoryDrop)
    const tokenBudget = nonNegativeNumber(state.tokenBudget)
    const estimatedTokens = nonNegativeNumber(state.estimatedTokens)
    if (
      selected.some((value) => value === undefined) ||
      dropped.some((value) => value === undefined) ||
      tokenBudget === undefined ||
      estimatedTokens === undefined
    ) {
      return null
    }
    const degradations = Array.isArray(state.degradations) ? state.degradations : []
    if (
      degradations.some(
        (value) =>
          typeof value !== 'string' || !MEMORY_RETRIEVAL_DEGRADATION_CAUSES.includes(value as never)
      )
    ) {
      return null
    }
    const allocation =
      state.allocation === undefined ? undefined : projectMemoryAllocation(state.allocation)
    if (state.allocation !== undefined && allocation === undefined) return null
    return {
      ...(messageId ? { messageId } : {}),
      facts: {
        selectedCount: selected.length,
        droppedCount: dropped.length,
        tokenBudget,
        estimatedTokens
      },
      data: {
        name: row.name,
        manifest: {
          policyVersion: state.policyVersion,
          selected: selected as JsonValue[],
          dropped: dropped as JsonValue[],
          tokenBudget,
          estimatedTokens,
          ...(degradations.length > 0 ? { degradations: degradations as string[] } : {}),
          ...(allocation === undefined ? {} : { allocation })
        }
      }
    }
  }

  if (row.name !== DIRECTIVE_VIEW_ANCHOR_NAME) return null
  if (
    !hasOnlyKeys(state, [
      'policyVersion',
      'selected',
      'dropped',
      'tokenBudget',
      'totalTokenBudget',
      'itemTokenBudget',
      'estimatedTokens'
    ]) ||
    state.policyVersion !== 1 ||
    !Array.isArray(state.selected) ||
    !Array.isArray(state.dropped) ||
    state.selected.length > MAX_DETAIL_ARRAY_ITEMS ||
    state.dropped.length > MAX_DETAIL_ARRAY_ITEMS
  ) {
    return null
  }
  const selected = state.selected.map(projectDirectiveSelection)
  const dropped = state.dropped.map(projectDirectiveDrop)
  const tokenBudget = nonNegativeNumber(state.tokenBudget)
  const estimatedTokens = nonNegativeNumber(state.estimatedTokens)
  const itemTokenBudget = nonNegativeNumber(state.itemTokenBudget)
  const totalTokenBudget =
    state.totalTokenBudget === undefined ? undefined : nonNegativeNumber(state.totalTokenBudget)
  if (
    selected.some((value) => value === undefined) ||
    dropped.some((value) => value === undefined) ||
    tokenBudget === undefined ||
    estimatedTokens === undefined ||
    itemTokenBudget === undefined ||
    (state.totalTokenBudget !== undefined && totalTokenBudget === undefined)
  ) {
    return null
  }
  return {
    ...(messageId ? { messageId } : {}),
    facts: {
      selectedCount: selected.length,
      droppedCount: dropped.length,
      tokenBudget,
      estimatedTokens
    },
    data: {
      name: row.name,
      manifest: {
        policyVersion: state.policyVersion,
        selected: selected as JsonValue[],
        dropped: dropped as JsonValue[],
        tokenBudget,
        estimatedTokens,
        ...(totalTokenBudget === undefined ? {} : { totalTokenBudget }),
        itemTokenBudget
      }
    }
  }
}

function memoryProjection(row: DeepChatTapeEntryRow): Partial<TapeInspectorFactRecord> | null {
  const projected = projectMemoryAnchor(row)
  return projected
    ? {
        family: 'anchor',
        facts: projected.facts,
        ...(projected.messageId ? { messageId: projected.messageId } : {})
      }
    : null
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
    memoryProjection(row) ??
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
    name: boundedNullableString(row.name),
    ...(row.source_type ? { sourceType: row.source_type } : {}),
    ...(boundedIdentity(row.source_id) ? { sourceId: boundedIdentity(row.source_id) } : {}),
    ...(row.source_seq === null ? {} : { sourceSeq: row.source_seq }),
    createdAt: row.created_at,
    ...semantic,
    hashes
  }
}

function factStatus(record: TapeInspectorFactRecord): string | undefined {
  if (record.facts?.isError === true) return 'error'
  if (record.facts?.isError === false) return 'success'
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

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function projectToolDetailData(row: DeepChatTapeEntryRow):
  | {
      kind: 'tool_call'
      messageId: string
      orderSeq: number
      toolCall: { id: string; name: string; params?: string; serverName?: string }
    }
  | {
      kind: 'tool_result'
      messageId: string
      orderSeq: number
      toolCallId: string
      response: string
      rtkApplied?: boolean
      rtkMode?: string
      rtkFallbackReason?: string
      imagePreviewCount?: number
    }
  | null {
  const payload = parseJsonObject(row.payload_json)
  const messageId = boundedIdentity(payload.messageId)
  if (!messageId || !isNonNegativeInteger(payload.orderSeq)) return null

  if (row.kind === 'tool_call') {
    if (
      !hasExactKeys(payload, ['messageId', 'orderSeq', 'toolCall']) ||
      !isPlainObject(payload.toolCall)
    ) {
      return null
    }
    const toolCall = payload.toolCall
    if (
      !hasOnlyKeys(toolCall, [
        'id',
        'name',
        'params',
        'serverName',
        'serverIcons',
        'serverDescription'
      ]) ||
      !boundedIdentity(toolCall.id) ||
      typeof toolCall.name !== 'string' ||
      (toolCall.params !== undefined && typeof toolCall.params !== 'string') ||
      (toolCall.serverName !== undefined && typeof toolCall.serverName !== 'string')
    ) {
      return null
    }
    return {
      kind: 'tool_call',
      messageId,
      orderSeq: payload.orderSeq,
      toolCall: {
        id: toolCall.id as string,
        name: boundedString(toolCall.name) ?? '',
        ...(toolCall.params === undefined
          ? {}
          : { params: boundedToolContent(toolCall.params, MAX_DETAIL_STRING_BYTES) ?? '' }),
        ...(toolCall.serverName === undefined
          ? {}
          : { serverName: boundedString(toolCall.serverName, MAX_DETAIL_STRING_BYTES) ?? '' })
      }
    }
  }

  if (
    row.kind !== 'tool_result' ||
    !hasOnlyKeys(payload, [
      'messageId',
      'orderSeq',
      'toolCallId',
      'response',
      'rtkApplied',
      'rtkMode',
      'rtkFallbackReason',
      'imagePreviews'
    ]) ||
    !boundedIdentity(payload.toolCallId) ||
    typeof payload.response !== 'string' ||
    (payload.rtkApplied !== undefined && typeof payload.rtkApplied !== 'boolean') ||
    (payload.rtkMode !== undefined && typeof payload.rtkMode !== 'string') ||
    (payload.rtkFallbackReason !== undefined && typeof payload.rtkFallbackReason !== 'string') ||
    (payload.imagePreviews !== undefined && !Array.isArray(payload.imagePreviews))
  ) {
    return null
  }
  return {
    kind: 'tool_result',
    messageId,
    orderSeq: payload.orderSeq,
    toolCallId: payload.toolCallId as string,
    response: boundedToolContent(payload.response, MAX_DETAIL_STRING_BYTES) ?? '',
    ...(payload.rtkApplied === undefined ? {} : { rtkApplied: payload.rtkApplied }),
    ...(payload.rtkMode === undefined
      ? {}
      : { rtkMode: boundedString(payload.rtkMode, MAX_DETAIL_STRING_BYTES) ?? '' }),
    ...(payload.rtkFallbackReason === undefined
      ? {}
      : {
          rtkFallbackReason: boundedString(payload.rtkFallbackReason, MAX_DETAIL_STRING_BYTES) ?? ''
        }),
    ...(Array.isArray(payload.imagePreviews)
      ? { imagePreviewCount: payload.imagePreviews.length }
      : {})
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value)
}

function projectAnchorRange(value: unknown): { fromOrderSeq: number; toOrderSeq: number } | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const range = value as Record<string, unknown>
  if (
    !hasExactKeys(range, ['fromOrderSeq', 'toOrderSeq']) ||
    !isNonNegativeInteger(range.fromOrderSeq) ||
    !isNonNegativeInteger(range.toOrderSeq) ||
    range.fromOrderSeq > range.toOrderSeq
  ) {
    return null
  }
  return { fromOrderSeq: range.fromOrderSeq, toOrderSeq: range.toOrderSeq }
}

function anchorState(row: DeepChatTapeEntryRow): Record<string, unknown> | null {
  const payload = parseJsonObject(row.payload_json)
  if (!hasExactKeys(payload, ['name', 'state']) || payload.name !== row.name) return null
  return payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
    ? (payload.state as Record<string, unknown>)
    : null
}

function projectCurrentCompactionState(state: Record<string, unknown>): JsonValue | undefined {
  const range = projectAnchorRange(state.range)
  if (
    !hasExactKeys(state, CURRENT_COMPACTION_STATE_KEYS) ||
    typeof state.summary !== 'string' ||
    !isNonNegativeInteger(state.cursorOrderSeq) ||
    (state.range !== null && range === null) ||
    !Array.isArray(state.sourceMessageIds) ||
    state.sourceMessageIds.some((messageId) => typeof messageId !== 'string') ||
    !isNonNegativeInteger(state.summaryableTurnCount) ||
    !isNonNegativeInteger(state.retainedTurnCount) ||
    !isNonNegativeInteger(state.retainedTokenEstimate) ||
    !isNonNegativeInteger(state.retainedTokenTarget) ||
    !isNullableNonNegativeInteger(state.previousSummaryUpdatedAt)
  ) {
    return undefined
  }
  return {
    cursorOrderSeq: state.cursorOrderSeq,
    range,
    sourceMessageCount: state.sourceMessageIds.length,
    summaryableTurnCount: state.summaryableTurnCount,
    retainedTurnCount: state.retainedTurnCount,
    retainedTokenEstimate: state.retainedTokenEstimate,
    retainedTokenTarget: state.retainedTokenTarget,
    previousSummaryUpdatedAt: state.previousSummaryUpdatedAt
  }
}

function projectAnchorDetailData(row: DeepChatTapeEntryRow): JsonValue | undefined {
  const state = anchorState(row)
  if (!state) return undefined

  if (row.name === 'session/start') {
    if (
      row.entry_id !== 1 ||
      row.source_type !== 'session' ||
      row.source_id !== row.session_id ||
      row.source_seq !== 0 ||
      !hasExactKeys(state, ['owner']) ||
      state.owner !== 'human'
    ) {
      return undefined
    }
    return { name: row.name, state: { owner: state.owner } }
  }

  if (row.name === 'fork/start') {
    const parentSessionId = boundedIdentity(state.parentSessionId)
    const parentLastAnchorName =
      state.parentLastAnchorName === null ? null : boundedString(state.parentLastAnchorName)
    if (
      row.source_type !== 'fork' ||
      !boundedIdentity(row.source_id) ||
      row.source_seq !== 0 ||
      !hasExactKeys(state, [
        'parentHeadEntryId',
        'parentLastAnchorEntryId',
        'parentLastAnchorName',
        'parentSessionId'
      ]) ||
      !parentSessionId ||
      !isNonNegativeInteger(state.parentHeadEntryId) ||
      !isNullableNonNegativeInteger(state.parentLastAnchorEntryId) ||
      (state.parentLastAnchorName !== null && !parentLastAnchorName)
    ) {
      return undefined
    }
    const safeParentLastAnchorName = parentLastAnchorName ?? null
    return {
      name: row.name,
      state: {
        parentSessionId,
        parentHeadEntryId: state.parentHeadEntryId,
        parentLastAnchorEntryId: state.parentLastAnchorEntryId,
        parentLastAnchorName: safeParentLastAnchorName
      }
    }
  }

  if (row.name === 'summary/reset') {
    if (
      !hasExactKeys(state, ['cursorOrderSeq', 'reason']) ||
      !isNonNegativeInteger(state.cursorOrderSeq) ||
      state.reason !== 'summary_reset'
    ) {
      return undefined
    }
    return {
      name: row.name,
      state: { cursorOrderSeq: state.cursorOrderSeq, reason: state.reason }
    }
  }

  if (row.name === 'compaction/migrated_summary') {
    const range = projectAnchorRange(state.range)
    if (
      !hasExactKeys(state, MIGRATED_COMPACTION_STATE_KEYS) ||
      typeof state.summary !== 'string' ||
      !isNonNegativeInteger(state.cursorOrderSeq) ||
      (state.range !== null && range === null) ||
      !Array.isArray(state.sourceMessageIds) ||
      state.sourceMessageIds.some((messageId) => typeof messageId !== 'string') ||
      state.migratedFrom !== 'deepchat_sessions.summary_text'
    ) {
      return undefined
    }
    return {
      name: row.name,
      state: {
        cursorOrderSeq: state.cursorOrderSeq,
        range,
        sourceMessageCount: state.sourceMessageIds.length,
        migratedFrom: state.migratedFrom
      }
    }
  }

  if (SUMMARY_ANCHOR_NAMES.includes(row.name as (typeof SUMMARY_ANCHOR_NAMES)[number])) {
    const projected = projectCurrentCompactionState(state)
    return projected === undefined ? undefined : { name: row.name, state: projected }
  }
  return undefined
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
    const memoryAnchor = projectMemoryAnchor(row)
    if (memoryAnchor) return boundedJson(redactBody(memoryAnchor.data))
    const projected = projectAnchorDetailData(row)
    return projected === undefined ? undefined : boundedJson(redactBody(projected))
  }
  if (row.kind === 'tool_call' || row.kind === 'tool_result') {
    const projected = projectToolDetailData(row)
    return projected === null ? undefined : boundedJson(redactBody(projected))
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
  return record.physicalAttempt !== undefined
    ? {
        scope: 'attempt',
        messageId: record.messageId,
        requestSeq: record.requestSeq,
        physicalAttempt: record.physicalAttempt
      }
    : {
        scope: 'request',
        messageId: record.messageId,
        requestSeq: record.requestSeq
      }
}
