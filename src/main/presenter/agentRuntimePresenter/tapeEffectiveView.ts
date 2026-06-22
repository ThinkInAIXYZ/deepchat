import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type {
  DeepChatTapeEntryKind,
  DeepChatTapeEntryRow,
  DeepChatTapeSearchInput
} from '../sqlitePresenter/tables/deepchatTapeEntries'

export interface EffectiveMessageEntry {
  entryId: number
  record: ChatMessageRecord
}

export interface EffectiveTapeView {
  rows: DeepChatTapeEntryRow[]
  messageRecords: ChatMessageRecord[]
  /** Effective messages paired with their tape entry_id, ordered by orderSeq (for lineage). */
  messageEntries: EffectiveMessageEntry[]
}

interface EffectiveTapeViewOptions {
  includePending?: boolean
  includeAuditEvents?: boolean
}

type EffectiveMessageCandidate = {
  row: DeepChatTapeEntryRow
  record: ChatMessageRecord
}

type ToolIdentity = {
  key: string
  messageId: string
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

function parseNestedJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return parseJsonObject(value)
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function toNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.floor(value)
}

function readTokenUsage(metadata: Record<string, unknown>): number | null {
  const totalTokens = toNonNegativeInteger(metadata.totalTokens ?? metadata.total_tokens)
  if (totalTokens !== null) {
    return totalTokens
  }

  const inputTokens = toNonNegativeInteger(metadata.inputTokens ?? metadata.input_tokens)
  const outputTokens = toNonNegativeInteger(metadata.outputTokens ?? metadata.output_tokens)
  if (inputTokens !== null || outputTokens !== null) {
    return (inputTokens ?? 0) + (outputTokens ?? 0)
  }

  return null
}

function isMessageStatus(value: unknown): value is ChatMessageRecord['status'] {
  return value === 'pending' || value === 'sent' || value === 'error'
}

function tapeEntryToMessageRecord(row: DeepChatTapeEntryRow): ChatMessageRecord | null {
  if (row.kind !== 'message') {
    return null
  }

  const payload = parseJsonObject(row.payload_json)
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

function messageRank(record: ChatMessageRecord, includePending: boolean): number {
  if (record.status === 'sent' || record.status === 'error') {
    return 2
  }
  return includePending && record.status === 'pending' ? 1 : 0
}

function shouldReplaceMessage(
  current: EffectiveMessageCandidate | undefined,
  next: EffectiveMessageCandidate,
  includePending: boolean
): boolean {
  if (!current) {
    return true
  }

  const currentRank = messageRank(current.record, includePending)
  const nextRank = messageRank(next.record, includePending)
  if (nextRank > currentRank) {
    return true
  }
  if (nextRank < currentRank) {
    return false
  }
  return next.row.entry_id > current.row.entry_id
}

function readMessageRetractionId(row: DeepChatTapeEntryRow): string | null {
  if (row.kind !== 'event' || row.name !== 'message/retracted') {
    return null
  }

  const payload = parseJsonObject(row.payload_json)
  const data = parseNestedJsonObject(payload.data)
  return typeof data.messageId === 'string' ? data.messageId : null
}

function isAuditEvent(row: DeepChatTapeEntryRow): boolean {
  return (
    row.name === 'message/retracted' ||
    row.name === 'message/compaction_indicator' ||
    row.name === 'migration/backfill'
  )
}

function readToolStatus(row: DeepChatTapeEntryRow): string | null {
  const meta = parseJsonObject(row.meta_json)
  return typeof meta.status === 'string' ? meta.status : null
}

function toolRank(row: DeepChatTapeEntryRow, includePending: boolean): number {
  const status = readToolStatus(row)
  if (status === 'pending') {
    return includePending ? 1 : 0
  }
  return 2
}

function readToolIdentity(row: DeepChatTapeEntryRow): ToolIdentity | null {
  if (row.kind !== 'tool_call' && row.kind !== 'tool_result') {
    return null
  }

  const payload = parseJsonObject(row.payload_json)
  const messageId = payload.messageId
  if (typeof messageId !== 'string' || messageId.length === 0) {
    return null
  }

  let toolCallId: unknown
  if (row.kind === 'tool_call') {
    toolCallId = parseNestedJsonObject(payload.toolCall).id
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

function shouldReplaceToolRow(
  current: DeepChatTapeEntryRow | undefined,
  next: DeepChatTapeEntryRow,
  includePending: boolean
): boolean {
  if (!current) {
    return true
  }

  const currentRank = toolRank(current, includePending)
  const nextRank = toolRank(next, includePending)
  if (nextRank > currentRank) {
    return true
  }
  if (nextRank < currentRank) {
    return false
  }
  return next.entry_id > current.entry_id
}

function matchesKinds(
  row: DeepChatTapeEntryRow,
  kinds: DeepChatTapeEntryKind[] | undefined
): boolean {
  return !kinds?.length || kinds.includes(row.kind)
}

function matchesCreatedAt(row: DeepChatTapeEntryRow, options: DeepChatTapeSearchInput): boolean {
  if (
    Number.isFinite(options.startCreatedAt) &&
    row.created_at < (options.startCreatedAt as number)
  ) {
    return false
  }
  if (Number.isFinite(options.endCreatedAt) && row.created_at > (options.endCreatedAt as number)) {
    return false
  }
  return true
}

function matchesQuery(row: DeepChatTapeEntryRow, normalizedQuery: string): boolean {
  const haystack = `${row.payload_json}\n${row.meta_json}\n${row.name ?? ''}`.toLowerCase()
  return haystack.includes(normalizedQuery)
}

export function buildEffectiveTapeView(
  rows: DeepChatTapeEntryRow[],
  options: EffectiveTapeViewOptions = {}
): EffectiveTapeView {
  const includePending = options.includePending === true
  const includeAuditEvents = options.includeAuditEvents === true
  const messageCandidates = new Map<string, EffectiveMessageCandidate>()
  const retractedMessageIds = new Set<string>()
  const toolRows = new Map<string, { row: DeepChatTapeEntryRow; messageId: string }>()
  const anchorRows: DeepChatTapeEntryRow[] = []
  const eventRows: DeepChatTapeEntryRow[] = []

  for (const row of [...rows].sort((left, right) => left.entry_id - right.entry_id)) {
    if (row.kind === 'anchor') {
      anchorRows.push(row)
      continue
    }

    if (row.kind === 'event') {
      const retractedMessageId = readMessageRetractionId(row)
      if (retractedMessageId) {
        messageCandidates.delete(retractedMessageId)
        retractedMessageIds.add(retractedMessageId)
      }
      if (includeAuditEvents || !isAuditEvent(row)) {
        eventRows.push(row)
      }
      continue
    }

    if (row.kind === 'message') {
      const record = tapeEntryToMessageRecord(row)
      if (!record) {
        continue
      }
      const rank = messageRank(record, includePending)
      if (rank === 0) {
        continue
      }
      const candidate = { row, record }
      if (shouldReplaceMessage(messageCandidates.get(record.id), candidate, includePending)) {
        messageCandidates.set(record.id, candidate)
        retractedMessageIds.delete(record.id)
      }
      continue
    }

    const identity = readToolIdentity(row)
    if (!identity || toolRank(row, includePending) === 0) {
      continue
    }
    const current = toolRows.get(identity.key)?.row
    if (shouldReplaceToolRow(current, row, includePending)) {
      toolRows.set(identity.key, { row, messageId: identity.messageId })
    }
  }

  const messageRows = [...messageCandidates.values()]
    .filter((candidate) => !retractedMessageIds.has(candidate.record.id))
    .sort((left, right) => left.record.orderSeq - right.record.orderSeq)
  const effectiveMessageIds = new Set(messageRows.map((candidate) => candidate.record.id))
  const effectiveToolRows = [...toolRows.values()]
    .filter((candidate) => effectiveMessageIds.has(candidate.messageId))
    .map((candidate) => candidate.row)
  const effectiveRows = [
    ...anchorRows,
    ...eventRows,
    ...messageRows.map((candidate) => candidate.row),
    ...effectiveToolRows
  ].sort((left, right) => left.entry_id - right.entry_id)

  return {
    rows: effectiveRows,
    messageRecords: messageRows.map((candidate) => candidate.record),
    messageEntries: messageRows.map((candidate) => ({
      entryId: candidate.row.entry_id,
      record: candidate.record
    }))
  }
}

export function searchEffectiveTapeRows(
  rows: DeepChatTapeEntryRow[],
  query: string,
  options: DeepChatTapeSearchInput = {}
): DeepChatTapeEntryRow[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return []
  }

  const limit = Number.isFinite(options.limit) ? (options.limit as number) : 20
  const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 100)
  return buildEffectiveTapeView(rows, { includePending: false })
    .rows.filter((row) => matchesKinds(row, options.kinds))
    .filter((row) => matchesCreatedAt(row, options))
    .filter((row) => matchesQuery(row, normalizedQuery))
    .sort((left, right) => right.entry_id - left.entry_id)
    .slice(0, cappedLimit)
}

export function getLastEffectiveTokenUsage(rows: DeepChatTapeEntryRow[]): number | null {
  const effectiveRows = buildEffectiveTapeView(rows, { includePending: false }).rows
  for (let index = effectiveRows.length - 1; index >= 0; index -= 1) {
    const record = tapeEntryToMessageRecord(effectiveRows[index])
    if (!record || record.role !== 'assistant') {
      continue
    }
    const usage = readTokenUsage(parseNestedJsonObject(record.metadata))
    if (usage !== null) {
      return usage
    }
  }
  return null
}
