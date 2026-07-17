import type {
  DeepChatTapeViewExcludedRange,
  DeepChatTapeViewManifest,
  DeepChatTapeViewManifestRecord
} from '@shared/types/tape-view-manifest'
import type {
  DeepChatCausalObservationReadOptions,
  DeepChatCausalObservationRequest,
  DeepChatCausalObservationSlice,
  DeepChatTapeReplayEntrySnapshot,
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice,
  DeepChatTapeReplayTraceSnapshot
} from '@shared/types/tape-replay'
import { SUMMARY_ANCHOR_NAMES, type DeepChatTapeEntryRow } from '../domain/entry'
import { buildEffectiveTapeView } from '../domain/effectiveView'
import {
  hashJson,
  TAPE_VIEW_MANIFEST_EVENT_NAME,
  verifyTapeViewManifestHash
} from '../domain/viewManifest'
import type {
  TapeApplicationProviders,
  TapeMessageTraceRow as DeepChatMessageTraceRow
} from '../ports/application'
import {
  collectEntryIds,
  hashString,
  isPositiveInteger,
  parseJsonObject,
  withReplaySliceHash
} from './common'
import type { TapeViewManifestSourceMaps } from './contracts'

type TapeViewReplayProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getMessageTraceReader' | 'getTerminalMessageReader'
>

const BOOTSTRAP_ANCHOR_NAME = 'session/start'

function isReconstructionAnchorName(name: string | null): boolean {
  if (name === null) {
    return false
  }
  return (
    (SUMMARY_ANCHOR_NAMES as readonly string[]).includes(name) ||
    name.startsWith('handoff/') ||
    name.startsWith('auto_handoff/')
  )
}

function readToolFactStatus(row: DeepChatTapeEntryRow): string | null {
  const status = parseJsonObject(row.meta_json).status
  return typeof status === 'string' ? status : null
}

function readToolFactToolCallId(row: DeepChatTapeEntryRow): string | null {
  const payload = parseJsonObject(row.payload_json)
  if (row.kind === 'tool_call') {
    const toolCall = payload.toolCall
    if (toolCall && typeof toolCall === 'object' && !Array.isArray(toolCall)) {
      const id = (toolCall as Record<string, unknown>).id
      return typeof id === 'string' && id.length > 0 ? id : null
    }
    return null
  }
  const toolCallId = payload.toolCallId
  return typeof toolCallId === 'string' && toolCallId.length > 0 ? toolCallId : null
}

function readToolFactMessageId(row: DeepChatTapeEntryRow): string | null {
  const messageId = parseJsonObject(row.payload_json).messageId
  return typeof messageId === 'string' && messageId.length > 0 ? messageId : null
}

const VIEW_POLICIES = new Set([
  'legacy_context_v1',
  'legacy_context_shadow',
  'resume_shadow',
  'tool_loop_shadow',
  'context_pressure_recovery_shadow'
])

const VIEW_ENTRY_REASONS = new Set([
  'system_prompt',
  'selected_history',
  'new_user_input',
  'resume_target',
  'tool_loop_message'
])

const VIEW_EXCLUDED_REASONS = new Set([
  'before_summary_cursor',
  'compaction_indicator',
  'pending_not_context_history',
  'out_of_budget',
  'empty_after_formatting',
  'superseded',
  'retracted'
])

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function isViewEntryRef(value: unknown): value is DeepChatTapeViewManifest['included'][number] {
  if (!isRecordObject(value)) {
    return false
  }

  return (
    isNullableNumber(value.entryId) &&
    isNullableString(value.messageId) &&
    isNullableNumber(value.orderSeq) &&
    (value.role === 'system' ||
      value.role === 'user' ||
      value.role === 'assistant' ||
      value.role === 'tool' ||
      value.role === null) &&
    (value.source === 'tape' || value.source === 'synthetic') &&
    typeof value.reason === 'string' &&
    VIEW_ENTRY_REASONS.has(value.reason)
  )
}

function isViewExcludedRef(value: unknown): value is DeepChatTapeViewManifest['excluded'][number] {
  if (!isRecordObject(value)) {
    return false
  }

  return (
    isNullableNumber(value.entryId) &&
    isNullableString(value.messageId) &&
    isNullableNumber(value.orderSeq) &&
    typeof value.reason === 'string' &&
    VIEW_EXCLUDED_REASONS.has(value.reason)
  )
}

function isViewExcludedRange(value: unknown): value is DeepChatTapeViewExcludedRange {
  if (!isRecordObject(value)) {
    return false
  }

  return (
    typeof value.fromOrderSeq === 'number' &&
    typeof value.toOrderSeq === 'number' &&
    typeof value.count === 'number' &&
    typeof value.reason === 'string' &&
    VIEW_EXCLUDED_REASONS.has(value.reason)
  )
}

function hasNumberFields(value: unknown, fields: string[]): value is Record<string, number> {
  if (!isRecordObject(value)) {
    return false
  }

  return fields.every((field) => typeof value[field] === 'number')
}

function hasStringFields(value: unknown, fields: string[]): value is Record<string, string> {
  if (!isRecordObject(value)) {
    return false
  }

  return fields.every((field) => typeof value[field] === 'string')
}

function isViewManifestMeta(value: unknown): value is DeepChatTapeViewManifest['meta'] {
  if (!isRecordObject(value)) {
    return false
  }

  return (
    typeof value.providerId === 'string' &&
    typeof value.modelId === 'string' &&
    typeof value.summaryCursorOrderSeq === 'number' &&
    typeof value.supportsVision === 'boolean' &&
    typeof value.supportsAudioInput === 'boolean' &&
    typeof value.traceDebugEnabled === 'boolean'
  )
}

function isViewManifest(value: unknown, sessionId: string): value is DeepChatTapeViewManifest {
  if (!isRecordObject(value)) {
    return false
  }

  return (
    (value.schemaVersion === 1 || value.schemaVersion === 2) &&
    typeof value.hashVersion === 'number' &&
    value.sessionId === sessionId &&
    typeof value.viewId === 'string' &&
    typeof value.messageId === 'string' &&
    typeof value.requestSeq === 'number' &&
    (value.taskType === 'chat' || value.taskType === 'resume' || value.taskType === 'tool_loop') &&
    typeof value.policy === 'string' &&
    VIEW_POLICIES.has(value.policy) &&
    (typeof value.policyVersion === 'number' || value.policyVersion === null) &&
    value.contextBuilderVersion === 'legacy-v1' &&
    typeof value.latestEntryId === 'number' &&
    Array.isArray(value.anchorEntryIds) &&
    value.anchorEntryIds.every((entryId) => typeof entryId === 'number') &&
    (value.reconstructionAnchorEntryId === undefined ||
      isNullableNumber(value.reconstructionAnchorEntryId)) &&
    (value.excludedRanges === undefined ||
      (Array.isArray(value.excludedRanges) && value.excludedRanges.every(isViewExcludedRange))) &&
    Array.isArray(value.included) &&
    value.included.every(isViewEntryRef) &&
    Array.isArray(value.excluded) &&
    value.excluded.every(isViewExcludedRef) &&
    hasNumberFields(value.tokenBudget, [
      'contextLength',
      'requestedMaxTokens',
      'effectiveMaxTokens',
      'reserveTokens',
      'toolReserveTokens',
      'estimatedPromptTokens'
    ]) &&
    hasStringFields(value.hashes, ['promptHash', 'toolDefinitionsHash', 'manifestHash']) &&
    isViewManifestMeta(value.meta) &&
    typeof value.assembledAt === 'number'
  )
}

export class TapeViewReplayService {
  constructor(private readonly providers: TapeViewReplayProviders) {}

  private get table() {
    return this.providers.getEntryStore()
  }

  getViewManifestSourceMaps(sessionId: string, messageId?: string): TapeViewManifestSourceMaps {
    const table = this.table
    const rows = table.getBySession(sessionId)
    const entryIdByMessageId = new Map<string, number>()
    const toolCallEntryIdByToolId = new Map<string, number>()
    const toolResultEntryIdByToolId = new Map<string, number>()
    let latestEntryId = 0
    const anchorEntryIds: number[] = []
    let reconstructionAnchorEntryId: number | null = null
    let bootstrapAnchorEntryId: number | null = null

    for (const row of rows) {
      latestEntryId = Math.max(latestEntryId, row.entry_id)
      if (row.kind === 'anchor') {
        anchorEntryIds.push(row.entry_id)
        if (isReconstructionAnchorName(row.name)) {
          if (reconstructionAnchorEntryId === null || row.entry_id > reconstructionAnchorEntryId) {
            reconstructionAnchorEntryId = row.entry_id
          }
        } else if (row.name === BOOTSTRAP_ANCHOR_NAME) {
          bootstrapAnchorEntryId = row.entry_id
        }
        continue
      }
      if (row.kind === 'message' && row.source_type === 'message' && row.source_id) {
        entryIdByMessageId.set(row.source_id, row.entry_id)
        continue
      }
      if (row.kind === 'tool_call' || row.kind === 'tool_result') {
        if (messageId && readToolFactMessageId(row) !== messageId) {
          continue
        }
        const toolCallId = readToolFactToolCallId(row)
        if (!toolCallId || readToolFactStatus(row) === 'pending') {
          continue
        }
        const target =
          row.kind === 'tool_call' ? toolCallEntryIdByToolId : toolResultEntryIdByToolId
        target.set(toolCallId, row.entry_id)
      }
    }

    const reconstructionAnchorEntryIds =
      reconstructionAnchorEntryId !== null
        ? [reconstructionAnchorEntryId]
        : bootstrapAnchorEntryId !== null
          ? [bootstrapAnchorEntryId]
          : []

    return {
      latestEntryId,
      anchorEntryIds,
      reconstructionAnchorEntryIds,
      reconstructionAnchorEntryId,
      entryIdByMessageId,
      toolCallEntryIdByToolId,
      toolResultEntryIdByToolId
    }
  }

  appendViewManifest(manifest: DeepChatTapeViewManifest): DeepChatTapeEntryRow {
    const table = this.table
    table.ensureBootstrapAnchor(manifest.sessionId)
    return table.appendEvent({
      sessionId: manifest.sessionId,
      name: TAPE_VIEW_MANIFEST_EVENT_NAME,
      source: {
        type: 'runtime_event',
        id: manifest.messageId,
        seq: manifest.requestSeq
      },
      provenanceKey: `view:${manifest.sessionId}:${manifest.messageId}:${manifest.requestSeq}:${manifest.hashes.manifestHash}`,
      data: {
        manifest
      },
      meta: {
        viewId: manifest.viewId,
        requestSeq: manifest.requestSeq,
        taskType: manifest.taskType,
        policy: manifest.policy,
        policyVersion: manifest.policyVersion
      },
      createdAt: manifest.assembledAt,
      idempotent: true
    })
  }

  listViewManifestsByMessage(
    sessionId: string,
    messageId: string
  ): DeepChatTapeViewManifestRecord[] {
    const table = this.table
    return table
      .getBySession(sessionId)
      .filter(
        (row) =>
          row.kind === 'event' &&
          row.name === TAPE_VIEW_MANIFEST_EVENT_NAME &&
          row.source_type === 'runtime_event' &&
          row.source_id === messageId
      )
      .map((row) => this.toViewManifestRecord(row))
      .filter((record): record is DeepChatTapeViewManifestRecord => Boolean(record))
      .sort((left, right) => right.requestSeq - left.requestSeq || right.entryId - left.entryId)
  }

  exportReplaySlice(
    sessionId: string,
    messageId: string,
    options: DeepChatTapeReplayExportOptions = {}
  ): DeepChatTapeReplaySlice | null {
    if (options.requestSeq !== undefined && !isPositiveInteger(options.requestSeq)) {
      throw new Error('requestSeq must be a positive integer.')
    }

    const manifests = this.listViewManifestsByMessage(sessionId, messageId)
    const manifestRecord =
      options.requestSeq === undefined
        ? manifests[0]
        : manifests.find((record) => record.requestSeq === options.requestSeq)
    if (!manifestRecord) {
      return null
    }

    return this.buildReplaySlice(sessionId, messageId, manifestRecord, options)
  }

  readCausalObservationSlice(
    sessionId: string,
    messageId: string,
    options: DeepChatCausalObservationReadOptions = {}
  ): DeepChatCausalObservationSlice {
    if (options.requestSeq !== undefined && !isPositiveInteger(options.requestSeq)) {
      throw new Error('requestSeq must be a positive integer.')
    }

    const rows = this.table.getBySession(sessionId)
    const manifestRows = rows.filter(
      (row) =>
        row.kind === 'event' &&
        row.name === TAPE_VIEW_MANIFEST_EVENT_NAME &&
        row.source_type === 'runtime_event' &&
        row.source_id === messageId
    )
    const traces = this.providers
      .getMessageTraceReader()
      .listByMessageId(messageId)
      .filter(
        (row) =>
          row.session_id === sessionId &&
          row.message_id === messageId &&
          isPositiveInteger(row.request_seq)
      )

    const requestSeq =
      options.requestSeq ??
      [...manifestRows.map((row) => row.source_seq), ...traces.map((row) => row.request_seq)]
        .filter((value): value is number => typeof value === 'number' && isPositiveInteger(value))
        .reduce<number | null>((latest, value) => Math.max(latest ?? value, value), null)

    let request: DeepChatCausalObservationRequest
    if (requestSeq === null) {
      request = { state: 'request_unavailable', requestSeq: null, trace: null }
    } else {
      const selectedManifestRows = manifestRows.filter((row) => row.source_seq === requestSeq)
      const manifestRecord = selectedManifestRows
        .map((row) => this.toViewManifestRecord(row))
        .find((record) => record?.messageId === messageId && record.requestSeq === requestSeq)
      const trace = traces.find((row) => row.request_seq === requestSeq) ?? null

      if (manifestRecord) {
        request = {
          state: 'manifest_bound',
          requestSeq,
          replay: this.buildReplaySlice(sessionId, messageId, manifestRecord, options)
        }
      } else {
        request = {
          state: selectedManifestRows.length > 0 ? 'manifest_malformed' : 'manifest_missing',
          requestSeq,
          trace: trace
            ? this.toReplayTraceSnapshot(trace, options.includeTracePayload === true)
            : null
        }
      }
    }

    const outputEntries = buildEffectiveTapeView(rows, { includePending: false })
      .rows.filter(
        (row) =>
          (row.kind === 'message' &&
            row.source_type === 'message' &&
            row.source_id === messageId) ||
          ((row.kind === 'tool_call' || row.kind === 'tool_result') &&
            readToolFactMessageId(row) === messageId)
      )
      .map((row) => this.toReplayEntrySnapshot(row, options.includeTapePayloads === true))
    const message = this.providers.getTerminalMessageReader().get(messageId)
    const terminalMessage =
      message?.session_id === sessionId &&
      message.role === 'assistant' &&
      (message.status === 'sent' || message.status === 'error')
        ? {
            status: message.status,
            orderSeq: message.order_seq,
            createdAt: message.created_at,
            updatedAt: message.updated_at,
            contentHash: hashString(message.content),
            metadataHash: hashString(message.metadata)
          }
        : null

    return {
      schemaVersion: 1,
      sessionId,
      messageId,
      request,
      output: {
        correlation: 'message_only',
        entries: outputEntries,
        terminalMessage
      },
      runtime:
        options.currentRuntimeStatus === undefined
          ? { scope: 'unavailable', status: null, eventHistory: 'not_persisted' }
          : {
              scope: 'current_only',
              status: options.currentRuntimeStatus,
              eventHistory: 'not_persisted'
            }
    }
  }

  private buildReplaySlice(
    sessionId: string,
    messageId: string,
    manifestRecord: DeepChatTapeViewManifestRecord,
    options: DeepChatTapeReplayExportOptions
  ): DeepChatTapeReplaySlice {
    const table = this.table
    const manifest = manifestRecord.manifest
    const includedEntryIds = collectEntryIds(manifest.included.map((ref) => ref.entryId))
    const excludedEntryIds = collectEntryIds(manifest.excluded.map((ref) => ref.entryId))
    const anchorEntryIds = collectEntryIds(manifest.anchorEntryIds)
    const selectedEntryIds = new Set([
      manifestRecord.entryId,
      ...includedEntryIds,
      ...excludedEntryIds,
      ...anchorEntryIds
    ])
    const entries = table
      .getBySession(sessionId)
      .filter((row) => selectedEntryIds.has(row.entry_id))
      .map((row) => this.toReplayEntrySnapshot(row, options.includeTapePayloads === true))

    const trace = this.findReplayTrace(sessionId, messageId, manifestRecord.requestSeq)
    const createdAt = Date.now()
    const sliceBase: Omit<DeepChatTapeReplaySlice, 'hashes'> & {
      hashes: Omit<DeepChatTapeReplaySlice['hashes'], 'sliceHash'> & { sliceHash: '' }
    } = {
      schemaVersion: 1 as const,
      sliceId: `replay_${hashJson({
        sessionId,
        messageId,
        requestSeq: manifestRecord.requestSeq,
        manifestHash: manifest.hashes.manifestHash
      }).slice(0, 16)}`,
      sessionId,
      messageId,
      requestSeq: manifestRecord.requestSeq,
      mode: trace ? 'trace_bound' : 'manifest_only',
      manifestRecord,
      trace: trace ? this.toReplayTraceSnapshot(trace, options.includeTracePayload === true) : null,
      entries,
      refs: {
        manifestEntryId: manifestRecord.entryId,
        includedEntryIds,
        excludedEntryIds,
        anchorEntryIds
      },
      hashes: {
        manifestHash: manifest.hashes.manifestHash,
        sliceHash: ''
      },
      integrity: manifestRecord.integrity,
      createdAt
    }

    return withReplaySliceHash(sliceBase, hashJson)
  }

  private toViewManifestRecord(row: DeepChatTapeEntryRow): DeepChatTapeViewManifestRecord | null {
    const payload = parseJsonObject(row.payload_json)
    const data = payload.data
    const rawManifest =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>).manifest
        : undefined
    const manifest =
      isRecordObject(rawManifest) && rawManifest.hashVersion === undefined
        ? { ...rawManifest, hashVersion: 1 }
        : rawManifest
    if (!isViewManifest(manifest, row.session_id)) {
      return null
    }

    return {
      sessionId: row.session_id,
      messageId: manifest.messageId,
      requestSeq: manifest.requestSeq,
      entryId: row.entry_id,
      createdAt: row.created_at,
      integrity: verifyTapeViewManifestHash(manifest),
      manifest
    }
  }

  private findReplayTrace(
    sessionId: string,
    messageId: string,
    requestSeq: number
  ): DeepChatMessageTraceRow | null {
    const traceTable = this.providers.getMessageTraceReader()
    return (
      traceTable
        .listByMessageId(messageId)
        .find((row) => row.session_id === sessionId && row.request_seq === requestSeq) ?? null
    )
  }

  private toReplayEntrySnapshot(
    row: DeepChatTapeEntryRow,
    includePayloads: boolean
  ): DeepChatTapeReplayEntrySnapshot {
    const snapshot: DeepChatTapeReplayEntrySnapshot = {
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceSeq: row.source_seq,
      provenanceKey: row.provenance_key,
      payloadHash: hashString(row.payload_json),
      metaHash: hashString(row.meta_json),
      createdAt: row.created_at
    }

    if (includePayloads) {
      snapshot.payload = parseJsonObject(row.payload_json)
      snapshot.meta = parseJsonObject(row.meta_json)
    }

    return snapshot
  }

  private toReplayTraceSnapshot(
    row: DeepChatMessageTraceRow,
    includePayload: boolean
  ): DeepChatTapeReplayTraceSnapshot {
    const snapshot: DeepChatTapeReplayTraceSnapshot = {
      id: row.id,
      requestSeq: row.request_seq,
      providerId: row.provider_id,
      modelId: row.model_id,
      endpoint: row.endpoint,
      headersHash: hashString(row.headers_json),
      bodyHash: hashString(row.body_json),
      truncated: row.truncated === 1,
      createdAt: row.created_at
    }

    if (includePayload) {
      snapshot.headersJson = row.headers_json
      snapshot.bodyJson = row.body_json
    }

    return snapshot
  }
}
