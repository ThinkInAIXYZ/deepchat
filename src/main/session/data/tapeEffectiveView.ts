import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type {
  DeepChatTapeEntryKind,
  DeepChatTapeEntryRow,
  DeepChatTapeSearchInput
} from '@/session/data/tables/deepchatTapeEntries'
import {
  parseNestedTapeJsonObject,
  readTapeMessageRetractionId,
  readTapeToolIdentity,
  tapeEntryToMessageRecord,
  tapeMessageRank,
  tapeToolRank
} from '@/session/data/tables/deepchatTapeEffectiveSemantics'

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

function compareSqliteBinaryText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
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

function shouldReplaceMessage(
  current: EffectiveMessageCandidate | undefined,
  next: EffectiveMessageCandidate,
  includePending: boolean
): boolean {
  if (!current) {
    return true
  }

  const currentRank = tapeMessageRank(current.record, includePending)
  const nextRank = tapeMessageRank(next.record, includePending)
  if (nextRank > currentRank) {
    return true
  }
  if (nextRank < currentRank) {
    return false
  }
  return next.row.entry_id > current.row.entry_id
}

function isAuditEvent(row: DeepChatTapeEntryRow): boolean {
  return (
    row.name === 'message/retracted' ||
    row.name === 'message/compaction_indicator' ||
    row.name === 'migration/backfill'
  )
}

function shouldReplaceToolRow(
  current: DeepChatTapeEntryRow | undefined,
  next: DeepChatTapeEntryRow,
  includePending: boolean
): boolean {
  if (!current) {
    return true
  }

  const currentRank = tapeToolRank(current, includePending)
  const nextRank = tapeToolRank(next, includePending)
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
      const retractedMessageId = readTapeMessageRetractionId(row)
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
      const rank = tapeMessageRank(record, includePending)
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

    const identity = readTapeToolIdentity(row)
    if (!identity || tapeToolRank(row, includePending) === 0) {
      continue
    }
    const current = toolRows.get(identity.key)?.row
    if (shouldReplaceToolRow(current, row, includePending)) {
      toolRows.set(identity.key, { row, messageId: identity.messageId })
    }
  }

  const messageRows = [...messageCandidates.values()]
    .filter((candidate) => !retractedMessageIds.has(candidate.record.id))
    .sort(
      (left, right) =>
        left.record.orderSeq - right.record.orderSeq ||
        compareSqliteBinaryText(left.record.id, right.record.id)
    )
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
    const usage = readTokenUsage(parseNestedTapeJsonObject(record.metadata))
    if (usage !== null) {
      return usage
    }
  }
  return null
}
