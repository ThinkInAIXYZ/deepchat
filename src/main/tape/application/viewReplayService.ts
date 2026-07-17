import type {
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
  collectEntryIds,
  hashString,
  isPositiveInteger,
  normalizeStoredTapeViewManifest,
  withReplaySliceHash
} from '../domain/replay'
import {
  hashJson,
  TAPE_VIEW_MANIFEST_EVENT_NAME,
  verifyTapeViewManifestHash
} from '../domain/viewManifest'
import type {
  TapeApplicationProviders,
  TapeMessageTraceRow as DeepChatMessageTraceRow
} from '../ports/application'
import type { TapeMemoryViewManifestInspection } from '../ports/capabilities'
import { parseJsonObject } from './common'
import type { TapeViewManifestAssemblySources } from './contracts'

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

function deriveSelectedMemoryIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids = new Set<string>()
  for (const item of value) {
    const id =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>).id
          : null
    if (typeof id === 'string' && id.length > 0) ids.add(id)
  }
  return [...ids]
}

function toMemoryViewManifestInspection(
  row: DeepChatTapeEntryRow
): TapeMemoryViewManifestInspection | null {
  const payload = parseJsonObject(row.payload_json)
  const meta = parseJsonObject(row.meta_json)
  const manifest =
    payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
      ? (payload.state as Record<string, unknown>)
      : null
  if (!manifest) return null
  const readNumber = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  return {
    sessionId: row.session_id,
    messageId: typeof meta.messageId === 'string' ? meta.messageId : null,
    entryId: row.entry_id,
    policyVersion:
      typeof manifest.policyVersion === 'number' && Number.isFinite(manifest.policyVersion)
        ? manifest.policyVersion
        : null,
    tokenBudget: readNumber(manifest.tokenBudget),
    estimatedTokens: readNumber(manifest.estimatedTokens),
    selectedCount: Array.isArray(manifest.selected) ? manifest.selected.length : 0,
    selectedIds: deriveSelectedMemoryIds(manifest.selected),
    droppedCount: Array.isArray(manifest.dropped) ? manifest.dropped.length : 0,
    queryHash: typeof manifest.queryHash === 'string' ? manifest.queryHash : null,
    createdAt: row.created_at
  }
}

export class TapeViewReplayService {
  constructor(private readonly providers: TapeViewReplayProviders) {}

  private get table() {
    return this.providers.getEntryStore()
  }

  getViewManifestSourceMaps(
    sessionId: string,
    messageId?: string
  ): TapeViewManifestAssemblySources {
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

  listMemoryViewManifestsByAgent(
    agentId: string,
    options?: { sessionId?: string; limit?: number; messageId?: string }
  ): TapeMemoryViewManifestInspection[] {
    return this.table
      .listMemoryViewManifestAnchorsByAgent(agentId, options)
      .map(toMemoryViewManifestInspection)
      .filter((manifest): manifest is TapeMemoryViewManifestInspection => manifest !== null)
      .filter((manifest) => !options?.messageId || manifest.messageId === options.messageId)
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

    return withReplaySliceHash(sliceBase)
  }

  private toViewManifestRecord(row: DeepChatTapeEntryRow): DeepChatTapeViewManifestRecord | null {
    const payload = parseJsonObject(row.payload_json)
    const data = payload.data
    const rawManifest =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>).manifest
        : undefined
    const manifest = normalizeStoredTapeViewManifest(rawManifest, row.session_id)
    if (
      !manifest ||
      manifest.messageId !== row.source_id ||
      manifest.requestSeq !== row.source_seq
    ) {
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
