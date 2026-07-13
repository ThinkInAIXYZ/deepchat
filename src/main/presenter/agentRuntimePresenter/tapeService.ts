import { SQLitePresenter } from '../sqlitePresenter'
import { nanoid } from 'nanoid'
import { createHash } from 'crypto'
import logger from 'electron-log'
import type {
  AgentTapeAnchorResult,
  AgentTapeAnchorsOptions,
  AgentTapeContextEntry,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeSearchOptions,
  ChatMessageRecord
} from '@shared/types/agent-interface'
import type {
  DeepChatTapeViewExcludedRange,
  DeepChatTapeViewManifest,
  DeepChatTapeViewManifestRecord
} from '@shared/types/tape-view-manifest'
import type {
  DeepChatTapeReplayEntrySnapshot,
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice,
  DeepChatTapeReplayTraceSnapshot
} from '@shared/types/tape-replay'
import type { DeepChatMessageStore } from './messageStore'
import {
  SUMMARY_ANCHOR_NAMES,
  type DeepChatTapeEntryRow,
  type DeepChatTapeSearchInput
} from '../sqlitePresenter/tables/deepchatTapeEntries'
import type {
  DeepChatTapeSearchProjectionInput,
  DeepChatTapeSearchProjectionResultRow,
  DeepChatTapeSearchProjectionRow
} from '../sqlitePresenter/tables/deepchatTapeSearchProjection'
import type { DeepChatMessageTraceRow } from '../sqlitePresenter/tables/deepchatMessageTraces'
import { appendMessageRecordToTape } from './tapeFacts'
import {
  buildEffectiveTapeView,
  getLastEffectiveTokenUsage,
  searchEffectiveTapeRows
} from './tapeEffectiveView'
import {
  hashJson,
  TAPE_VIEW_MANIFEST_EVENT_NAME,
  verifyTapeViewManifestHash
} from './tapeViewManifest'

export type TapeMigrationState = 'none' | 'ready'

export type TapeBackfillResult = {
  sessionId: string
  migrationState: TapeMigrationState
  messageCount: number
  maxOrderSeq: number
  appendedFactCount: number
  historyRecords: ChatMessageRecord[]
}

export type TapeInfo = {
  sessionId: string
  entries: number
  anchors: number
  lastAnchor: string | null
  lastAnchorEntryId: number | null
  entriesSinceLastAnchor: number
  lastTokenUsage: number | null
  migrationState: TapeMigrationState
}

export type TapeSearchResult = {
  entryId: number
  kind: string
  name: string | null
  createdAt: number
  summary?: string
  refs?: Record<string, unknown>
  score?: number
}

export type TapeAnchorResult = AgentTapeAnchorResult

export type TapeForkHandle = {
  parentSessionId: string
  forkId: string
  forkSessionId: string
}

export type TapeViewManifestSourceMaps = {
  latestEntryId: number
  anchorEntryIds: number[]
  reconstructionAnchorEntryIds: number[]
  reconstructionAnchorEntryId: number | null
  entryIdByMessageId: Map<string, number>
  toolCallEntryIdByToolId: Map<string, number>
  toolResultEntryIdByToolId: Map<string, number>
}

const BOOTSTRAP_ANCHOR_NAME = 'session/start'
const DEFAULT_CONTEXT_MAX_BYTES_PER_ENTRY = 2048
const DEFAULT_CONTEXT_MAX_TOTAL_BYTES = 16384
const MAX_CONTEXT_MAX_BYTES_PER_ENTRY = 8192
const MAX_CONTEXT_MAX_TOTAL_BYTES = 65536

// Mirrors getLatestReconstructionAnchor: the anchor set that owns the summary
// cursor and prompt-visible reconstruction state (summaries, handoffs).
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

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}
  return {}
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function compactText(value: string, maxLength = 1000): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function stringifyForSummary(value: unknown, maxLength = 1000): string {
  if (typeof value === 'string') return compactText(value, maxLength)
  if (value === null || value === undefined) return ''
  try {
    return compactText(JSON.stringify(value), maxLength)
  } catch {
    return compactText(String(value), maxLength)
  }
}

function truncateToUtf8Bytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const normalized = text.trim()
  if (maxBytes <= 0) {
    return { text: '', truncated: normalized.length > 0 }
  }
  if (maxBytes < 3) {
    return { text: '', truncated: normalized.length > 0 }
  }
  if (Buffer.byteLength(normalized, 'utf8') <= maxBytes) {
    return { text: normalized, truncated: false }
  }
  let bytes = 0
  let output = ''
  for (const character of normalized) {
    const nextBytes = Buffer.byteLength(character, 'utf8')
    if (bytes + nextBytes > Math.max(0, maxBytes - 3)) break
    output += character
    bytes += nextBytes
  }
  return { text: `${output.trimEnd()}...`, truncated: true }
}

function normalizeContextByteLimit(
  value: number | undefined,
  fallback: number,
  max: number
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value as number), 0), max)
}

function uniqueStrings(values: string[], limit = 10): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= limit) break
  }
  return result
}

function extractFilePaths(text: string): string[] {
  const matches = [
    ...text.matchAll(
      /(?:^|[\s"'`([{<])((?:[A-Za-z]:\\|\/|\.{1,2}\/|[\w.-]+\/)[^\s"'`<>{}(),;!?]+(?:[/\\][^\s"'`<>{}(),;!?]+)*)/g
    )
  ].map((match) => match[1].replace(/[.:]+$/g, ''))
  return uniqueStrings(matches ?? [])
}

function extractErrorCodes(text: string): string[] {
  const matches = text.match(/\b(?:E[A-Z0-9_]{3,}|[A-Z][A-Z0-9_]*Error)\b/g)
  return uniqueStrings(matches ?? [])
}

function collectKeyedStrings(
  value: unknown,
  keys: Set<string>,
  output: string[] = [],
  depth = 0
): string[] {
  if (depth > 4 || output.length >= 10 || !value || typeof value !== 'object') return output
  if (Array.isArray(value)) {
    for (const item of value) collectKeyedStrings(item, keys, output, depth + 1)
    return output
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof nested === 'string' && nested.trim()) {
      output.push(compactText(nested, 500))
      if (output.length >= 10) return output
    }
    collectKeyedStrings(nested, keys, output, depth + 1)
    if (output.length >= 10) return output
  }
  return output
}

function collectUserMessageAttachmentRefs(files: unknown): {
  searchText: string[]
  filePaths: string[]
  fileNames: string[]
} {
  const searchText: string[] = []
  const filePaths: string[] = []
  const fileNames: string[] = []
  if (!Array.isArray(files)) {
    return { searchText, filePaths, fileNames }
  }
  for (const file of files) {
    if (!isRecordObject(file)) continue
    const path = typeof file.path === 'string' ? file.path : ''
    const name = typeof file.name === 'string' ? file.name : ''
    const metadata = isRecordObject(file.metadata) ? file.metadata : null
    const metadataFileName =
      metadata && typeof metadata.fileName === 'string' ? metadata.fileName : ''
    if (path) {
      filePaths.push(compactText(path, 500))
      searchText.push(compactText(path, 500))
    }
    for (const value of [name, metadataFileName]) {
      if (!value) continue
      fileNames.push(compactText(value, 500))
      searchText.push(compactText(value, 500))
    }
  }
  return {
    searchText: uniqueStrings(searchText, 20),
    filePaths: uniqueStrings(filePaths, 20),
    fileNames: uniqueStrings(fileNames, 20)
  }
}

type UserMessageProjectionText = {
  text: string
  attachmentRefs: {
    searchText: string[]
    filePaths: string[]
    fileNames: string[]
  }
}

function emptyUserMessageAttachmentRefs(): UserMessageProjectionText['attachmentRefs'] {
  return { searchText: [], filePaths: [], fileNames: [] }
}

function parseUserMessageProjectionText(content: string): UserMessageProjectionText {
  const parsed = parseJsonValue(content)
  if (isRecordObject(parsed) && typeof parsed.text === 'string') {
    const attachmentRefs = collectUserMessageAttachmentRefs(parsed.files)
    const parts = [parsed.text]
    if (Array.isArray(parsed.files) && parsed.files.length > 0) {
      parts.push(`files:${parsed.files.length}`)
      parts.push(...attachmentRefs.searchText)
    }
    if (Array.isArray(parsed.links) && parsed.links.length > 0) {
      parts.push(`links:${parsed.links.length}`)
    }
    return { text: parts.join(' '), attachmentRefs }
  }
  return { text: content, attachmentRefs: emptyUserMessageAttachmentRefs() }
}

function getUserMessageProjectionText(
  row: DeepChatTapeEntryRow,
  payload: Record<string, unknown>
): UserMessageProjectionText | null {
  if (row.kind !== 'message' || !isRecordObject(payload.record)) return null
  const record = payload.record
  const role = typeof record.role === 'string' ? record.role : 'message'
  if (role === 'assistant') return null
  const content = typeof record.content === 'string' ? record.content : ''
  return parseUserMessageProjectionText(content)
}

function collectUserMessageAttachmentRefsFromPayload(payload: Record<string, unknown>): {
  searchText: string[]
  filePaths: string[]
  fileNames: string[]
} {
  if (!isRecordObject(payload.record)) {
    return { searchText: [], filePaths: [], fileNames: [] }
  }
  const content = typeof payload.record.content === 'string' ? payload.record.content : ''
  const parsed = parseJsonValue(content)
  return isRecordObject(parsed)
    ? collectUserMessageAttachmentRefs(parsed.files)
    : { searchText: [], filePaths: [], fileNames: [] }
}

function readUserMessageText(content: string, parsed?: UserMessageProjectionText): string {
  return parsed?.text ?? parseUserMessageProjectionText(content).text
}

function readAssistantMessageText(content: string): string {
  const parsed = parseJsonValue(content)
  if (!Array.isArray(parsed)) return content
  const parts: string[] = []
  for (const block of parsed) {
    if (!isRecordObject(block)) continue
    if (typeof block.content === 'string' && block.content.trim()) {
      parts.push(block.content)
      continue
    }
    const toolCall = block.tool_call
    if (isRecordObject(toolCall)) {
      const name = typeof toolCall.name === 'string' ? toolCall.name : 'unknown'
      const params = typeof toolCall.params === 'string' ? toolCall.params : ''
      const response = typeof toolCall.response === 'string' ? toolCall.response : ''
      parts.push(`tool ${name} ${params} ${response}`.trim())
    }
  }
  return parts.join(' ')
}

function summarizeTapeRow(
  row: DeepChatTapeEntryRow,
  payload: Record<string, unknown>,
  userMessage?: UserMessageProjectionText | null
): string {
  if (row.kind === 'message') {
    const record = payload.record
    if (isRecordObject(record)) {
      const role = typeof record.role === 'string' ? record.role : 'message'
      const content = typeof record.content === 'string' ? record.content : ''
      const text =
        role === 'assistant'
          ? readAssistantMessageText(content)
          : readUserMessageText(content, userMessage ?? undefined)
      return compactText(`${role}: ${text}`, 1200)
    }
  }

  if (row.kind === 'tool_call') {
    const toolCall = payload.toolCall
    if (isRecordObject(toolCall)) {
      const name = typeof toolCall.name === 'string' ? toolCall.name : (row.name ?? 'unknown')
      const params = typeof toolCall.params === 'string' ? toolCall.params : ''
      return compactText(`tool_call ${name}: ${params}`, 1200)
    }
  }

  if (row.kind === 'tool_result') {
    const response = typeof payload.response === 'string' ? payload.response : payload
    return compactText(
      `tool_result ${row.name ?? 'unknown'}: ${stringifyForSummary(response)}`,
      1200
    )
  }

  if (row.kind === 'anchor') {
    const state = isRecordObject(payload.state) ? payload.state : payload
    const summary = typeof state.summary === 'string' ? state.summary : stringifyForSummary(state)
    return compactText(`anchor ${row.name ?? 'unknown'}: ${summary}`, 1200)
  }

  if (row.kind === 'event') {
    const data = isRecordObject(payload.data) ? payload.data : payload
    return compactText(`event ${row.name ?? 'unknown'}: ${stringifyForSummary(data)}`, 1200)
  }

  return compactText(`${row.kind} ${row.name ?? ''}`.trim(), 1200)
}

function buildTapeRowEvidenceText(
  row: DeepChatTapeEntryRow,
  payload: Record<string, unknown>,
  meta: Record<string, unknown>,
  userMessage?: UserMessageProjectionText | null
): string {
  const parts: string[] = []
  if (row.kind === 'message' && isRecordObject(payload.record)) {
    const record = payload.record
    const content = typeof record.content === 'string' ? record.content : ''
    const role = typeof record.role === 'string' ? record.role : 'message'
    parts.push(
      role === 'assistant'
        ? readAssistantMessageText(content)
        : readUserMessageText(content, userMessage ?? undefined)
    )
  } else if (row.kind === 'tool_call' && isRecordObject(payload.toolCall)) {
    const toolCall = payload.toolCall
    parts.push(stringifyForSummary(toolCall.name, 200))
    parts.push(stringifyForSummary(toolCall.params, 3000))
  } else if (row.kind === 'tool_result') {
    parts.push(stringifyForSummary(payload.response ?? payload, 4000))
  } else if (row.kind === 'anchor') {
    parts.push(stringifyForSummary(isRecordObject(payload.state) ? payload.state : payload, 4000))
  } else if (row.kind === 'event') {
    parts.push(stringifyForSummary(isRecordObject(payload.data) ? payload.data : payload, 4000))
  } else {
    parts.push(stringifyForSummary(payload, 4000))
  }
  if (typeof meta.status === 'string') parts.push(`status:${meta.status}`)
  return compactText(parts.filter(Boolean).join('\n'), 5000)
}

function setRef(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== null && value !== undefined && value !== '') {
    target[key] = value
  }
}

function enrichTapeRowRefs(
  refs: Record<string, unknown>,
  payload: Record<string, unknown>,
  meta: Record<string, unknown>,
  evidenceText: string,
  userMessage?: UserMessageProjectionText | null
): void {
  const attachmentRefs =
    userMessage?.attachmentRefs ?? collectUserMessageAttachmentRefsFromPayload(payload)
  const filePaths = uniqueStrings(
    [...extractFilePaths(evidenceText), ...attachmentRefs.filePaths],
    20
  )
  const errorCodes = extractErrorCodes(evidenceText)
  const commands = uniqueStrings(
    [
      ...collectKeyedStrings(payload, new Set(['command', 'cmd', 'script', 'shellCommand'])),
      ...collectKeyedStrings(meta, new Set(['command', 'cmd', 'script', 'shellCommand']))
    ],
    10
  )
  setRef(refs, 'filePaths', filePaths.length ? filePaths : null)
  setRef(refs, 'fileNames', attachmentRefs.fileNames.length ? attachmentRefs.fileNames : null)
  setRef(refs, 'commands', commands.length ? commands : null)
  setRef(refs, 'errorCodes', errorCodes.length ? errorCodes : null)
  for (const key of ['exitCode', 'exitStatus', 'code']) {
    const value = payload[key] ?? meta[key]
    if (typeof value === 'number' || typeof value === 'string') {
      setRef(refs, key, value)
    }
  }
}

function buildTapeRowRefs(
  row: DeepChatTapeEntryRow,
  payload: Record<string, unknown>,
  meta: Record<string, unknown>,
  userMessage?: UserMessageProjectionText | null,
  evidenceText?: string
): Record<string, unknown> {
  const refs: Record<string, unknown> = {}
  setRef(refs, 'sourceType', row.source_type)
  setRef(refs, 'sourceId', row.source_id)
  setRef(refs, 'sourceSeq', row.source_seq)
  setRef(refs, 'status', typeof meta.status === 'string' ? meta.status : null)

  if (row.kind === 'message' && isRecordObject(payload.record)) {
    const record = payload.record
    setRef(refs, 'messageId', record.id)
    setRef(refs, 'orderSeq', record.orderSeq)
    setRef(refs, 'role', record.role)
    setRef(refs, 'messageStatus', record.status)
  } else if (row.kind === 'tool_call' && isRecordObject(payload.toolCall)) {
    const toolCall = payload.toolCall
    setRef(refs, 'messageId', payload.messageId)
    setRef(refs, 'orderSeq', payload.orderSeq)
    setRef(refs, 'toolCallId', toolCall.id)
    setRef(refs, 'toolName', toolCall.name ?? row.name)
    setRef(refs, 'serverName', toolCall.serverName)
  } else if (row.kind === 'tool_result') {
    setRef(refs, 'messageId', payload.messageId)
    setRef(refs, 'orderSeq', payload.orderSeq)
    setRef(refs, 'toolCallId', payload.toolCallId)
    setRef(refs, 'toolName', row.name)
  } else if (row.kind === 'anchor') {
    setRef(refs, 'anchorName', row.name)
  } else if (row.kind === 'event') {
    setRef(refs, 'eventName', row.name)
  }

  enrichTapeRowRefs(
    refs,
    payload,
    meta,
    evidenceText ?? buildTapeRowEvidenceText(row, payload, meta, userMessage),
    userMessage
  )
  return refs
}

function parseProjectionRefs(raw: string): Record<string, unknown> {
  const parsed = parseJsonObject(raw)
  return parsed
}

function normalizeContextWindowValue(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value as number), 0), 20)
}

function normalizeContextLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(Math.max(Math.floor(value as number), 1), 100)
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

function parseSearchBoundary(value: string | undefined, name: string): number | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  const numericValue = Number(trimmed)
  if (Number.isFinite(numericValue)) {
    return numericValue
  }

  const parsedDate = Date.parse(trimmed)
  if (Number.isFinite(parsedDate)) {
    return parsedDate
  }

  throw new Error(`${name} must be an ISO date/time or millisecond timestamp.`)
}

function toTapeSearchInput(options: AgentTapeSearchOptions | undefined): DeepChatTapeSearchInput {
  return {
    limit: options?.limit,
    kinds: options?.kinds,
    startCreatedAt: parseSearchBoundary(options?.start, 'start'),
    endCreatedAt: parseSearchBoundary(options?.end, 'end')
  }
}

function migrationProvenanceKey(sessionId: string): string {
  return `migration:${sessionId}:message-backfill:v1`
}

function legacySummaryProvenanceKey(sessionId: string): string {
  return `summary:${sessionId}:legacy-summary:v1`
}

function normalizeHandoffName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    return 'handoff/manual'
  }
  if (trimmed.startsWith('handoff/') || trimmed.startsWith('auto_handoff/')) {
    return trimmed
  }
  return `handoff/${trimmed}`
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value))
  }
  return null
}

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function buildOrderSeqRange(records: ChatMessageRecord[]): Record<string, number> | null {
  if (records.length === 0) {
    return null
  }

  return {
    fromOrderSeq: records[0].orderSeq,
    toOrderSeq: records[records.length - 1].orderSeq
  }
}

function enrichHandoffState(
  state: Record<string, unknown>,
  historyRecords: ChatMessageRecord[]
): Record<string, unknown> {
  const maxOrderSeq = historyRecords.reduce(
    (currentMax, record) => Math.max(currentMax, record.orderSeq),
    0
  )
  const cursorOrderSeq =
    normalizePositiveInteger(state.cursorOrderSeq ?? state.summaryCursorOrderSeq) ?? maxOrderSeq + 1
  const sourceRecords = historyRecords.filter((record) => record.orderSeq < cursorOrderSeq)
  const enrichedState: Record<string, unknown> = {
    ...state,
    cursorOrderSeq
  }

  if (!hasOwnKey(enrichedState, 'range')) {
    enrichedState.range = buildOrderSeqRange(sourceRecords)
  }

  const sourceMessageIds = enrichedState.sourceMessageIds
  if (!Array.isArray(sourceMessageIds) || sourceMessageIds.some((id) => typeof id !== 'string')) {
    enrichedState.sourceMessageIds = sourceRecords.map((record) => record.id)
  }

  return enrichedState
}

function forkSessionId(parentSessionId: string, forkId: string): string {
  return `${parentSessionId}::fork::${forkId}`
}

function isEntryIdPrefix(prefix: number[], values: number[]): boolean {
  if (prefix.length > values.length) return false
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] !== values[index]) return false
  }
  return true
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function collectEntryIds(values: Array<number | null>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === 'number'))].sort(
    (left, right) => left - right
  )
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

function withReplaySliceHash(
  slice: Omit<DeepChatTapeReplaySlice, 'hashes'> & {
    hashes: Omit<DeepChatTapeReplaySlice['hashes'], 'sliceHash'> & { sliceHash: '' }
  }
): DeepChatTapeReplaySlice {
  const sliceForHash = { ...slice } as Partial<DeepChatTapeReplaySlice>
  delete sliceForHash.createdAt
  delete sliceForHash.integrity
  return {
    ...slice,
    hashes: {
      ...slice.hashes,
      sliceHash: hashJson(sliceForHash)
    }
  }
}

export class DeepChatTapeService {
  constructor(private readonly sqlitePresenter: SQLitePresenter) {}

  private get table(): SQLitePresenter['deepchatTapeEntriesTable'] | undefined {
    return this.sqlitePresenter.deepchatTapeEntriesTable
  }

  private get searchProjectionTable():
    | SQLitePresenter['deepchatTapeSearchProjectionTable']
    | undefined {
    return this.sqlitePresenter.deepchatTapeSearchProjectionTable
  }

  ensureSessionTapeReady(
    sessionId: string,
    messageStore: DeepChatMessageStore
  ): TapeBackfillResult {
    const table = this.table
    const historyRecords = messageStore
      .getMessages(sessionId)
      .sort((left, right) => left.orderSeq - right.orderSeq)
    const maxOrderSeq = historyRecords.reduce(
      (currentMax, record) => Math.max(currentMax, record.orderSeq),
      0
    )

    if (!table) {
      return {
        sessionId,
        migrationState: 'none',
        messageCount: historyRecords.length,
        maxOrderSeq,
        appendedFactCount: 0,
        historyRecords
      }
    }

    table.ensureBootstrapAnchor(sessionId)

    let appendedFactCount = 0
    for (const record of historyRecords) {
      appendedFactCount += appendMessageRecordToTape(table, record, 'backfill')
    }

    this.backfillLegacySummaryAnchor(sessionId, historyRecords)

    table.appendEvent({
      sessionId,
      name: 'migration/backfill',
      source: {
        type: 'migration',
        id: 'message-backfill',
        seq: 1
      },
      provenanceKey: migrationProvenanceKey(sessionId),
      data: {
        source: 'deepchat_messages',
        messageCount: historyRecords.length,
        maxOrderSeq
      },
      idempotent: true
    })

    return {
      sessionId,
      migrationState: 'ready',
      messageCount: historyRecords.length,
      maxOrderSeq,
      appendedFactCount,
      historyRecords: this.getMessageRecords(sessionId)
    }
  }

  appendMessageRecord(record: ChatMessageRecord): number {
    const table = this.table
    if (!table) {
      throw new Error('Tape table is not available.')
    }

    return appendMessageRecordToTape(table, record, 'live')
  }

  getMessageRecords(sessionId: string): ChatMessageRecord[] {
    const table = this.table
    return table
      ? buildEffectiveTapeView(table.getBySession(sessionId), { includePending: true })
          .messageRecords
      : []
  }

  info(sessionId: string): TapeInfo {
    const table = this.table
    if (!table) {
      return {
        sessionId,
        entries: 0,
        anchors: 0,
        lastAnchor: null,
        lastAnchorEntryId: null,
        entriesSinceLastAnchor: 0,
        lastTokenUsage: null,
        migrationState: 'none'
      }
    }

    const lastAnchor = table.getLatestAnchor(sessionId)
    const rows = table.getBySession(sessionId)
    return {
      sessionId,
      entries: table.countBySession(sessionId),
      anchors: table.countAnchorsBySession(sessionId),
      lastAnchor: lastAnchor?.name ?? null,
      lastAnchorEntryId: lastAnchor?.entry_id ?? null,
      entriesSinceLastAnchor: lastAnchor
        ? table.countEntriesAfter(sessionId, lastAnchor.entry_id)
        : 0,
      lastTokenUsage: getLastEffectiveTokenUsage(rows),
      migrationState: table.getByProvenanceKey(sessionId, migrationProvenanceKey(sessionId))
        ? 'ready'
        : 'none'
    }
  }

  search(sessionId: string, query: string, options?: AgentTapeSearchOptions): TapeSearchResult[] {
    const table = this.table
    if (!table) return []

    const searchInput = toTapeSearchInput(options)
    const projectionTable = this.searchProjectionTable
    let skipProjectionSearch = false

    if (projectionTable) {
      try {
        const maxEntryId = table.getMaxEntryId(sessionId)
        if (projectionTable.isCurrent(sessionId, maxEntryId)) {
          return projectionTable
            .search(sessionId, query, searchInput)
            .map((row) => this.toProjectedSearchResult(row, undefined))
        }
      } catch (error) {
        skipProjectionSearch = true
        logger.warn(
          `[Tape] projection fast-path search failed; falling back to effective search: ${String(error)}`
        )
      }
    }

    const rows = table.getBySession(sessionId)
    const effectiveRows = buildEffectiveTapeView(rows, { includePending: false }).rows
    const preparedProjectionTable = skipProjectionSearch
      ? null
      : this.ensureSearchProjection(sessionId, rows, effectiveRows)
    if (!preparedProjectionTable) {
      return searchEffectiveTapeRows(rows, query, searchInput).map((row) =>
        this.toSearchResult(row)
      )
    }

    const rowByEntryId = new Map(effectiveRows.map((row) => [row.entry_id, row]))
    try {
      return preparedProjectionTable
        .search(sessionId, query, searchInput)
        .map((row) => this.toProjectedSearchResult(row, rowByEntryId.get(row.entry_id)))
    } catch (error) {
      logger.warn(
        `[Tape] projection search failed; falling back to effective search: ${String(error)}`
      )
      return searchEffectiveTapeRows(rows, query, searchInput).map((row) =>
        this.toSearchResult(row)
      )
    }
  }

  getContext(
    sessionId: string,
    entryIds: number[],
    options: AgentTapeContextOptions = {}
  ): AgentTapeContextResult {
    const requestedEntryIds = [
      ...new Set(entryIds.filter((entryId) => Number.isInteger(entryId) && entryId > 0))
    ].sort((left, right) => left - right)
    const table = this.table
    if (!table || requestedEntryIds.length === 0) {
      return { sessionId, requestedEntryIds, matchedEntryIds: [], entries: [] }
    }

    const rows = table.getBySession(sessionId)
    const effectiveRows = buildEffectiveTapeView(rows, { includePending: false }).rows
    const indexByEntryId = new Map(effectiveRows.map((row, index) => [row.entry_id, index]))
    const before = normalizeContextWindowValue(options.before, 2)
    const after = normalizeContextWindowValue(options.after, 2)
    const limit = normalizeContextLimit(options.limit)
    const maxBytesPerEntry = normalizeContextByteLimit(
      options.maxBytesPerEntry,
      DEFAULT_CONTEXT_MAX_BYTES_PER_ENTRY,
      MAX_CONTEXT_MAX_BYTES_PER_ENTRY
    )
    const maxTotalBytes = normalizeContextByteLimit(
      options.maxTotalBytes,
      DEFAULT_CONTEXT_MAX_TOTAL_BYTES,
      MAX_CONTEXT_MAX_TOTAL_BYTES
    )
    const selectedIndexes = new Set<number>()
    const requestedIndexes: number[] = []
    const windowIndexes: number[] = []

    for (const entryId of requestedEntryIds) {
      const index = indexByEntryId.get(entryId)
      if (index === undefined) continue
      requestedIndexes.push(index)
      for (
        let cursor = Math.max(0, index - before);
        cursor <= Math.min(effectiveRows.length - 1, index + after);
        cursor += 1
      ) {
        if (cursor === index) continue
        windowIndexes.push(cursor)
      }
    }

    for (const index of requestedIndexes) {
      if (selectedIndexes.size >= limit) break
      selectedIndexes.add(index)
    }
    for (const index of windowIndexes) {
      if (selectedIndexes.size >= limit) break
      selectedIndexes.add(index)
    }

    const selectedRows = [...selectedIndexes]
      .sort((left, right) => left - right)
      .map((index) => effectiveRows[index])
    let projectionRows = new Map<number, DeepChatTapeSearchProjectionRow>()
    try {
      projectionRows = new Map(
        (
          this.searchProjectionTable?.getByEntryIds(
            sessionId,
            selectedRows.map((row) => row.entry_id)
          ) ?? []
        ).map((row) => [row.entry_id, row])
      )
    } catch {
      projectionRows = new Map()
    }
    let usedBytes = 0
    const entries: AgentTapeContextEntry[] = []
    const priorityIndexes = [...requestedIndexes, ...windowIndexes].filter(
      (index, offset, indexes) => {
        return selectedIndexes.has(index) && indexes.indexOf(index) === offset
      }
    )
    for (const index of priorityIndexes) {
      const row = effectiveRows[index]
      const remaining = Math.max(0, maxTotalBytes - usedBytes)
      if (remaining <= 0) break
      const maxEntryBytes = Math.min(maxBytesPerEntry, remaining)
      if (maxEntryBytes <= 0) break
      const entry = this.toContextEntry(row, projectionRows.get(row.entry_id), maxEntryBytes)
      if (entry.evidence.bytes <= 0) continue
      usedBytes += entry.evidence.bytes
      entries.push(entry)
    }
    entries.sort((left, right) => left.entryId - right.entryId)
    const returnedEntryIds = new Set(entries.map((entry) => entry.entryId))

    return {
      sessionId,
      requestedEntryIds,
      matchedEntryIds: requestedEntryIds.filter((entryId) => returnedEntryIds.has(entryId)),
      entries
    }
  }

  anchors(sessionId: string, options: AgentTapeAnchorsOptions = {}): TapeAnchorResult[] {
    const table = this.table
    return table
      ? table.getAnchors(sessionId, options.limit).map((row) => this.toAnchorResult(row))
      : []
  }

  getViewManifestSourceMaps(sessionId: string, messageId?: string): TapeViewManifestSourceMaps {
    const table = this.table
    if (!table) {
      return {
        latestEntryId: 0,
        anchorEntryIds: [],
        reconstructionAnchorEntryIds: [],
        reconstructionAnchorEntryId: null,
        entryIdByMessageId: new Map(),
        toolCallEntryIdByToolId: new Map(),
        toolResultEntryIdByToolId: new Map()
      }
    }

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
    if (!table) {
      throw new Error('Tape table is not available.')
    }

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
    if (!table) {
      return []
    }

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

    const table = this.table
    if (!table) {
      return null
    }

    const manifests = this.listViewManifestsByMessage(sessionId, messageId)
    const manifestRecord =
      options.requestSeq === undefined
        ? manifests[0]
        : manifests.find((record) => record.requestSeq === options.requestSeq)
    if (!manifestRecord) {
      return null
    }

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

  handoff(
    sessionId: string,
    name: string,
    state: Record<string, unknown> = {},
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    const table = this.table
    if (!table) {
      throw new Error('Tape table is not available.')
    }

    table.ensureBootstrapAnchor(sessionId)
    const handoffState = enrichHandoffState(state, this.getMessageRecords(sessionId))
    return table.appendAnchor({
      sessionId,
      name: normalizeHandoffName(name),
      source: {
        type: 'runtime_event',
        id: `handoff:${Date.now()}`,
        seq: 0
      },
      state: handoffState,
      meta: {
        ...meta,
        handoff: true
      }
    })
  }

  createFork(parentSessionId: string, forkId: string = nanoid()): TapeForkHandle {
    const table = this.table
    if (!table) {
      throw new Error('Tape table is not available.')
    }

    const forkIdValue = forkId.trim() || nanoid()
    const forkSessionIdValue = forkSessionId(parentSessionId, forkIdValue)
    table.ensureBootstrapAnchor(forkSessionIdValue)
    const parentAnchor = table.getLatestAnchor(parentSessionId)
    table.appendAnchor({
      sessionId: forkSessionIdValue,
      name: 'fork/start',
      source: {
        type: 'fork',
        id: forkIdValue,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkIdValue}:start`,
      state: {
        parentSessionId,
        parentLastAnchorEntryId: parentAnchor?.entry_id ?? null,
        parentLastAnchorName: parentAnchor?.name ?? null
      },
      idempotent: true
    })
    return {
      parentSessionId,
      forkId: forkIdValue,
      forkSessionId: forkSessionIdValue
    }
  }

  appendForkMessageRecord(handle: TapeForkHandle, record: ChatMessageRecord): number {
    return appendMessageRecordToTape(
      this.table,
      {
        ...record,
        sessionId: handle.forkSessionId
      },
      'live'
    )
  }

  mergeFork(parentSessionId: string, forkId: string): number {
    const table = this.table
    if (!table) {
      return 0
    }

    const forkSessionIdValue = forkSessionId(parentSessionId, forkId)
    const forkEntries = table
      .getBySession(forkSessionIdValue)
      .filter((entry) => !(entry.kind === 'anchor' && entry.name === 'session/start'))

    let mergedCount = 0
    for (const entry of forkEntries) {
      table.append({
        sessionId: parentSessionId,
        kind: entry.kind,
        name: entry.name,
        source: {
          type: 'fork',
          id: forkId,
          seq: entry.entry_id
        },
        provenanceKey: `fork:${parentSessionId}:${forkId}:merge:${entry.entry_id}`,
        payload: parseJsonObject(entry.payload_json),
        meta: {
          ...parseJsonObject(entry.meta_json),
          forkId,
          forkSessionId: forkSessionIdValue,
          mergedFromEntryId: entry.entry_id
        },
        createdAt: entry.created_at,
        idempotent: true
      })
      mergedCount += 1
    }

    table.appendEvent({
      sessionId: parentSessionId,
      name: 'fork/merge',
      source: {
        type: 'fork',
        id: forkId,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkId}:merge:event`,
      data: {
        forkId,
        forkSessionId: forkSessionIdValue,
        mergedCount
      },
      idempotent: true
    })

    return mergedCount
  }

  discardFork(parentSessionId: string, forkId: string): void {
    const table = this.table
    if (!table) {
      return
    }

    const forkSessionIdValue = forkSessionId(parentSessionId, forkId)
    table.deleteBySession(forkSessionIdValue)
    try {
      this.searchProjectionTable?.deleteBySession(forkSessionIdValue)
    } catch (error) {
      logger.warn(`[Tape] failed to delete fork search projection: ${String(error)}`)
    }
    table.appendEvent({
      sessionId: parentSessionId,
      name: 'fork/discard',
      source: {
        type: 'fork',
        id: forkId,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkId}:discard:event`,
      data: {
        forkId,
        forkSessionId: forkSessionIdValue
      },
      idempotent: true
    })
  }

  recordExternalForkMerge(
    parentSessionId: string,
    forkSessionIdValue: string,
    forkId: string,
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    const table = this.table
    if (!table) {
      throw new Error('Tape table is not available.')
    }

    const referencedEntryCount = table.countBySession(forkSessionIdValue)
    return table.appendEvent({
      sessionId: parentSessionId,
      name: 'fork/merge',
      source: {
        type: 'fork',
        id: forkId,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkId}:external-merge:event`,
      data: {
        forkId,
        forkSessionId: forkSessionIdValue,
        referencedEntryCount,
        ...meta
      },
      idempotent: true
    })
  }

  recordExternalForkDiscard(
    parentSessionId: string,
    forkSessionIdValue: string,
    forkId: string,
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    const table = this.table
    if (!table) {
      throw new Error('Tape table is not available.')
    }

    return table.appendEvent({
      sessionId: parentSessionId,
      name: 'fork/discard',
      source: {
        type: 'fork',
        id: forkId,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkId}:external-discard:event`,
      data: {
        forkId,
        forkSessionId: forkSessionIdValue,
        ...meta
      },
      idempotent: true
    })
  }

  private backfillLegacySummaryAnchor(
    sessionId: string,
    historyRecords: ChatMessageRecord[]
  ): void {
    const table = this.table
    if (!table) {
      return
    }

    if (table.getLatestSummaryAnchor(sessionId)) {
      return
    }

    const legacyState = this.sqlitePresenter.deepchatSessionsTable.getSummaryState(sessionId)
    if (!legacyState) {
      return
    }

    const summary = legacyState.summary_text?.trim()
    if (!summary) {
      return
    }

    const cursorOrderSeq = Math.max(1, legacyState.summary_cursor_order_seq ?? 1)
    const sourceRecords = historyRecords.filter((record) => record.orderSeq < cursorOrderSeq)
    table.appendAnchor({
      sessionId,
      name: 'compaction/migrated_summary',
      source: {
        type: 'summary',
        id: 'legacy-summary',
        seq: 1
      },
      provenanceKey: legacySummaryProvenanceKey(sessionId),
      state: {
        summary,
        cursorOrderSeq,
        range:
          sourceRecords.length > 0
            ? {
                fromOrderSeq: sourceRecords[0].orderSeq,
                toOrderSeq: sourceRecords[sourceRecords.length - 1].orderSeq
              }
            : null,
        sourceMessageIds: sourceRecords.map((record) => record.id),
        migratedFrom: 'deepchat_sessions.summary_text'
      },
      idempotent: true,
      createdAt: legacyState.summary_updated_at ?? undefined
    })
  }

  private ensureSearchProjection(
    sessionId: string,
    rows: DeepChatTapeEntryRow[],
    effectiveRows: DeepChatTapeEntryRow[]
  ): SQLitePresenter['deepchatTapeSearchProjectionTable'] | null {
    const projectionTable = this.searchProjectionTable
    if (!projectionTable) return null
    const maxEntryId = rows.reduce((max, row) => Math.max(max, row.entry_id), 0)
    try {
      if (!projectionTable.isCurrent(sessionId, maxEntryId)) {
        const meta = projectionTable.getSessionMeta(sessionId)
        const projectedEntryIds = projectionTable.getProjectedEntryIds(sessionId)
        const effectiveEntryIds = effectiveRows.map((row) => row.entry_id)
        const canAppend =
          !!meta &&
          projectionTable.isCurrent(sessionId, meta.maxEntryId) &&
          meta.maxEntryId <= maxEntryId &&
          isEntryIdPrefix(projectedEntryIds, effectiveEntryIds)
        if (canAppend) {
          projectionTable.appendSession(
            sessionId,
            effectiveRows.slice(projectedEntryIds.length).map((row) => this.toProjectionInput(row)),
            maxEntryId
          )
        } else {
          projectionTable.replaceSession(
            sessionId,
            effectiveRows.map((row) => this.toProjectionInput(row)),
            maxEntryId
          )
        }
      }
      return projectionTable
    } catch {
      return null
    }
  }

  private toProjectionInput(row: DeepChatTapeEntryRow): DeepChatTapeSearchProjectionInput {
    const payload = parseJsonObject(row.payload_json)
    const meta = parseJsonObject(row.meta_json)
    const userMessage = getUserMessageProjectionText(row, payload)
    const summaryText = summarizeTapeRow(row, payload, userMessage)
    const evidenceText = buildTapeRowEvidenceText(row, payload, meta, userMessage)
    const refs = buildTapeRowRefs(row, payload, meta, userMessage, evidenceText)
    const searchText = [
      row.kind,
      row.name ?? '',
      summaryText,
      evidenceText,
      Object.values(refs)
        .map((value) => stringifyForSummary(value))
        .join(' ')
    ]
      .filter(Boolean)
      .join('\n')
    return {
      sessionId: row.session_id,
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceSeq: row.source_seq,
      searchText,
      summaryText,
      refs,
      createdAt: row.created_at
    }
  }

  private toProjectedSearchResult(
    row: DeepChatTapeSearchProjectionResultRow,
    _sourceRow: DeepChatTapeEntryRow | undefined
  ): TapeSearchResult {
    const score =
      typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : undefined
    return {
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      createdAt: row.created_at,
      summary: row.summary_text,
      refs: parseProjectionRefs(row.refs_json),
      ...(score === undefined ? {} : { score })
    }
  }

  private toContextEntry(
    row: DeepChatTapeEntryRow,
    projectionRow: DeepChatTapeSearchProjectionRow | undefined,
    maxBytes: number
  ): AgentTapeContextEntry {
    const fallbackProjection = projectionRow ? null : this.toProjectionInput(row)
    const payload = parseJsonObject(row.payload_json)
    const meta = parseJsonObject(row.meta_json)
    const evidenceSource = buildTapeRowEvidenceText(row, payload, meta)
    const clipped = truncateToUtf8Bytes(evidenceSource, maxBytes)
    const bytes = Buffer.byteLength(clipped.text, 'utf8')
    return {
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      summary: projectionRow?.summary_text ?? fallbackProjection?.summaryText ?? '',
      refs: projectionRow
        ? parseProjectionRefs(projectionRow.refs_json)
        : (fallbackProjection?.refs ?? {}),
      evidence: {
        text: clipped.text,
        truncated: clipped.truncated,
        bytes
      },
      createdAt: row.created_at
    }
  }

  private toSearchResult(row: DeepChatTapeEntryRow): TapeSearchResult {
    const projection = this.toProjectionInput(row)
    return {
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      createdAt: row.created_at,
      summary: projection.summaryText,
      refs: projection.refs
    }
  }

  private toAnchorResult(row: DeepChatTapeEntryRow): TapeAnchorResult {
    return {
      sessionId: row.session_id,
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      payload: parseJsonObject(row.payload_json),
      meta: parseJsonObject(row.meta_json),
      createdAt: row.created_at
    }
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
    const traceTable = this.sqlitePresenter.deepchatMessageTracesTable
    if (!traceTable) {
      return null
    }

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
