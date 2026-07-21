import type { AgentTapeSearchOptions, AgentTapeViewScope } from '@shared/types/agent-interface'
import type { DeepChatTapeEntryRow, DeepChatTapeSearchInput } from '../domain/entry'
import { parseJsonObject, parseJsonValue } from './common'
import type { TapeSearchResult } from './contracts'
import { normalizeAttachmentResolvedRepresentation } from '@shared/utils/attachmentRepresentation'

const MAX_OCR_SEARCH_CHARACTERS_PER_ATTACHMENT = 4_000
const MAX_OCR_SEARCH_CHARACTERS_PER_MESSAGE = 16_000
const MAX_OCR_SEARCH_ATTACHMENTS = 8

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function compactText(value: string, maxLength = 1000): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function stringifyForSummary(value: unknown, maxLength = 1000): string {
  if (typeof value === 'string') return compactText(value, maxLength)
  if (value === null || value === undefined) return ''
  try {
    return compactText(JSON.stringify(value), maxLength)
  } catch {
    return compactText(String(value), maxLength)
  }
}

export function truncateToUtf8Bytes(
  text: string,
  maxBytes: number
): { text: string; truncated: boolean } {
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

export function normalizeContextByteLimit(
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
  const attachmentMetadataSearchText: string[] = []
  const ocrSearchText: string[] = []
  const filePaths: string[] = []
  const fileNames: string[] = []
  let remainingOcrCharacters = MAX_OCR_SEARCH_CHARACTERS_PER_MESSAGE
  if (!Array.isArray(files)) {
    return { searchText: [], filePaths, fileNames }
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
      attachmentMetadataSearchText.push(compactText(path, 500))
    }
    for (const value of [name, metadataFileName]) {
      if (!value) continue
      fileNames.push(compactText(value, 500))
      attachmentMetadataSearchText.push(compactText(value, 500))
    }
    const resolved = normalizeAttachmentResolvedRepresentation(file.resolvedRepresentation)
    if (
      resolved?.kind === 'ocr_text' &&
      ocrSearchText.length < MAX_OCR_SEARCH_ATTACHMENTS &&
      remainingOcrCharacters > 3
    ) {
      const characterLimit = Math.min(
        MAX_OCR_SEARCH_CHARACTERS_PER_ATTACHMENT,
        remainingOcrCharacters
      )
      const ocrText = compactText(resolved.text, characterLimit)
      if (ocrText) {
        ocrSearchText.push(ocrText)
        remainingOcrCharacters -= ocrText.length
      }
    }
  }
  return {
    searchText: uniqueStrings(
      [...uniqueStrings(attachmentMetadataSearchText, 20), ...ocrSearchText],
      20 + MAX_OCR_SEARCH_ATTACHMENTS
    ),
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

export function getUserMessageProjectionText(
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

export function summarizeTapeRow(
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

export function buildTapeRowEvidenceText(
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

export function buildTapeRowRefs(
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

export function parseProjectionRefs(raw: string): Record<string, unknown> {
  const parsed = parseJsonObject(raw)
  return parsed
}

export function normalizeContextWindowValue(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value as number), 0), 20)
}

export function normalizeContextLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(Math.max(Math.floor(value as number), 1), 100)
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

export function toTapeSearchInput(
  options: AgentTapeSearchOptions | undefined
): DeepChatTapeSearchInput {
  return {
    limit: options?.limit,
    kinds: options?.kinds,
    startCreatedAt: parseSearchBoundary(options?.start, 'start'),
    endCreatedAt: parseSearchBoundary(options?.end, 'end')
  }
}

export function normalizeTapeViewScope(scope: AgentTapeViewScope | undefined): AgentTapeViewScope {
  if (scope === undefined || scope === 'current') return 'current'
  if (scope === 'linked_subagents' || scope === 'current_and_linked') return scope
  throw new Error(`Invalid Tape view scope: ${String(scope)}`)
}

export function normalizeTapeSearchLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20
  return Math.min(Math.max(Math.floor(value as number), 1), 100)
}

export function compareTapeSearchResults(left: TapeSearchResult, right: TapeSearchResult): number {
  const leftHasScore = typeof left.score === 'number' && Number.isFinite(left.score)
  const rightHasScore = typeof right.score === 'number' && Number.isFinite(right.score)
  if (leftHasScore && rightHasScore && left.score !== right.score) {
    return (left.score as number) - (right.score as number)
  }
  if (leftHasScore !== rightHasScore) {
    return leftHasScore ? -1 : 1
  }
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt
  }
  if (left.sessionId !== right.sessionId) {
    return left.sessionId < right.sessionId ? -1 : 1
  }
  return right.entryId - left.entryId
}
