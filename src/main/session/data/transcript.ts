import { nanoid } from 'nanoid'
import type { SessionDatabase } from './database'
import type {
  ChatMessagePageResult,
  ChatMessageRecord,
  MessageMetadata,
  MessagePageCursor,
  MessageTraceRecord,
  SessionCompactionBoundaryReason,
  UserMessageContent,
  AssistantMessageBlock
} from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'
import logger from '@shared/logger'
import type { DeepChatMessageRow } from '@/session/data/tables/deepchatMessages'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import type { DeepChatAssistantBlockRow } from '@/session/data/tables/deepchatAssistantBlocks'
import type { DeepChatUserMessageFileRow } from '@/session/data/tables/deepchatUserMessageFiles'
import type { DeepChatUserMessageLinkRow } from '@/session/data/tables/deepchatUserMessageLinks'
import type { DeepChatUserMessageRow } from '@/session/data/tables/deepchatUserMessages'
import {
  buildCompactionUsageStatsRecord,
  buildUsageStatsRecord,
  parseMessageMetadata,
  resolveUsageModelId,
  resolveUsageProviderId
} from '@/session/usageStats'
import type {
  ExecutionJournalAuditReader,
  TapeAnchorReader,
  TapeCompactionModelCallWriter,
  TapeMessageFactWriter,
  TapeProjectionCursor,
  TapeProjectionHeadReader,
  TapeTranscriptProjection
} from '@/tape/ports/capabilities'
import type { TapeMessageReplacementOptions } from '@/tape/domain/facts'
import type { TapeCompactionModelCallInput } from '@/tape/domain/compactionUsage'
import {
  assembleUserContent,
  canonicalizeMessageContent,
  parseAssistantBlocks,
  parseUserContent,
  toAssistantBlock,
  toMessageFile
} from './messageContent'
import { TranscriptProjectionApplier } from './transcriptProjection'

const COMPACTION_SHIFT_MATERIALIZATION_BATCH_SIZE = 500
const MAX_COMPACTION_ATTEMPT_ID_CHARACTERS = 128

type CompactionMessageOptions = {
  compactionAttemptId: string
  boundaryReason?: SessionCompactionBoundaryReason | null
}

function normalizeCompactionAttemptId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= MAX_COMPACTION_ATTEMPT_ID_CHARACTERS ? normalized : null
}

function normalizeCompactionBoundaryReason(value: unknown): SessionCompactionBoundaryReason | null {
  return value === 'summary_unavailable' || value === 'summary_rejected_larger' ? value : null
}

function parseTapeAnchorState(row: DeepChatTapeEntryRow): Record<string, unknown> | null {
  try {
    const payload = JSON.parse(row.payload_json) as unknown
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    const state = (payload as Record<string, unknown>).state
    return state && typeof state === 'object' && !Array.isArray(state)
      ? (state as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function summaryUpdatedAtFromCompactionAnchor(row: DeepChatTapeEntryRow): number | null {
  const state = parseTapeAnchorState(row)
  const generatedSummary = state?.summary ?? state?.summaryText
  return typeof generatedSummary === 'string' && generatedSummary.trim() ? row.created_at : null
}

function shouldConvertPendingBlockToError(
  status: AssistantMessageBlock['status']
): status is 'pending' | 'loading' {
  return status === 'pending' || status === 'loading'
}

export function buildTerminalErrorBlocks(
  blocks: AssistantMessageBlock[],
  errorMessage: string
): AssistantMessageBlock[] {
  const normalizedBlocks: AssistantMessageBlock[] = Array.isArray(blocks)
    ? blocks.map(
        (block): AssistantMessageBlock =>
          shouldConvertPendingBlockToError(block.status)
            ? { ...block, status: 'error' as const }
            : block
      )
    : []

  const lastBlock = normalizedBlocks[normalizedBlocks.length - 1]
  if (lastBlock?.type === 'error' && lastBlock.content === errorMessage) {
    return normalizedBlocks
  }

  normalizedBlocks.push({
    type: 'error',
    content: errorMessage,
    status: 'error',
    timestamp: Date.now()
  })

  return normalizedBlocks
}

type StructuredMessageMaps = {
  userRows: Map<string, DeepChatUserMessageRow>
  fileRows: Map<string, DeepChatUserMessageFileRow[]>
  linkRows: Map<string, DeepChatUserMessageLinkRow[]>
  assistantRows: Map<string, DeepChatAssistantBlockRow[]>
}

/** The Tape capabilities the transcript needs: message facts, compaction usage, and the head. */
export type TranscriptTapePort = TapeMessageFactWriter &
  TapeCompactionModelCallWriter &
  TapeProjectionHeadReader

export class SessionTranscript implements TapeTranscriptProjection {
  private database: SessionDatabase
  private readonly tapeFacts: TapeMessageFactWriter
  private readonly tapeHead: TapeProjectionHeadReader
  private readonly compactionUsage: TapeCompactionModelCallWriter
  private readonly projection: TranscriptProjectionApplier

  constructor(
    database: SessionDatabase,
    tapeFacts: TranscriptTapePort,
    private readonly executionAudit?: Pick<
      ExecutionJournalAuditReader,
      'listMessageIdsWithNestedExecutionAudit'
    >,
    private readonly compactionAnchors?: Pick<
      TapeAnchorReader,
      'getReconstructionAnchorByCompactionAttemptId'
    >
  ) {
    this.database = database
    this.tapeFacts = tapeFacts
    this.tapeHead = tapeFacts
    this.compactionUsage = tapeFacts
    this.projection = new TranscriptProjectionApplier(database)
  }

  // TapeTranscriptProjection: reconciliation reads where the tables stand, replays what the Tape
  // holds past that point, and moves the cursor. Terminal writes below move it themselves.

  readProjectionCursor(sessionId: string): TapeProjectionCursor | null {
    return this.database.deepchatTranscriptProjectionMetaTable.get(sessionId)
  }

  writeProjectionCursor(sessionId: string, cursor: TapeProjectionCursor): void {
    this.database.deepchatTranscriptProjectionMetaTable.upsert(sessionId, cursor)
  }

  applyTapeEntries(rows: readonly DeepChatTapeEntryRow[]): void {
    this.projection.applyTapeEntries(rows)
  }

  private runInDatabaseTransaction<T>(operation: () => T): T {
    return this.database.getDatabase().transaction(operation)() as T
  }

  createUserMessage(
    sessionId: string,
    orderSeq: number,
    content: UserMessageContent,
    options?: {
      status?: 'pending' | 'sent'
      metadata?: MessageMetadata
    }
  ): string {
    const id = nanoid()
    const now = Date.now()
    const record = this.terminalRecord({
      id,
      sessionId,
      orderSeq,
      role: 'user',
      content: JSON.stringify(content),
      status: options?.status ?? 'sent',
      isContextEdge: 0,
      metadata: options?.metadata ? JSON.stringify(options.metadata) : '{}',
      createdAt: now,
      updatedAt: now
    })
    this.runInDatabaseTransaction(() => this.commitRecord(record))
    return id
  }

  createAssistantMessage(sessionId: string, orderSeq: number): string {
    const id = nanoid()
    this.database.deepchatMessagesTable.insert({
      id,
      sessionId,
      orderSeq,
      role: 'assistant',
      content: '[]',
      status: 'pending'
    })
    return id
  }

  private insertCompactionMessageRecord(
    sessionId: string,
    orderSeq: number,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null,
    options: CompactionMessageOptions
  ): string {
    const id = nanoid()
    const now = Date.now()
    this.commitRecord(
      this.terminalRecord({
        id,
        sessionId,
        orderSeq,
        role: 'assistant',
        content: JSON.stringify(this.buildCompactionBlocks(status)),
        status: 'sent',
        isContextEdge: 0,
        metadata: JSON.stringify(
          this.buildCompactionMetadata(
            status,
            summaryUpdatedAt,
            options.compactionAttemptId,
            options.boundaryReason
          )
        ),
        createdAt: now,
        updatedAt: now
      })
    )
    return id
  }

  createCompactionMessage(
    sessionId: string,
    orderSeq: number,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null,
    options: CompactionMessageOptions
  ): string {
    return this.runInDatabaseTransaction(() =>
      this.insertCompactionMessageRecord(sessionId, orderSeq, status, summaryUpdatedAt, options)
    )
  }

  createCompactionMessageAtOrderSeq(
    sessionId: string,
    orderSeq: number,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null,
    options: CompactionMessageOptions & { shiftExistingMessages?: boolean }
  ): string {
    let messageId = ''
    this.runInDatabaseTransaction(() => {
      if (options?.shiftExistingMessages) {
        this.shiftMessagesFrom(sessionId, orderSeq)
      }
      messageId = this.insertCompactionMessageRecord(
        sessionId,
        orderSeq,
        status,
        summaryUpdatedAt,
        options
      )
    })
    return messageId
  }

  /**
   * Compaction inserts its marker in front of the messages it summarised. The shifted rows keep
   * their content; each records its new position as an order replacement fact, and the table moves
   * them in one statement stamped with the same time the facts carry.
   */
  private shiftMessagesFrom(sessionId: string, fromOrderSeq: number): void {
    const shiftedAt = Date.now()
    const messageIds = this.database.deepchatMessagesTable.getIdsFromOrderSeq(
      sessionId,
      fromOrderSeq
    )
    const shiftedRecords: ChatMessageRecord[] = []
    for (
      let offset = 0;
      offset < messageIds.length;
      offset += COMPACTION_SHIFT_MATERIALIZATION_BATCH_SIZE
    ) {
      const batchIds = messageIds.slice(
        offset,
        offset + COMPACTION_SHIFT_MATERIALIZATION_BATCH_SIZE
      )
      const rows = this.database.deepchatMessagesTable.getBySessionAndIds(sessionId, batchIds)
      shiftedRecords.push(...this.toRecords(rows))
    }
    if (shiftedRecords.length !== messageIds.length) {
      throw new Error('Failed to materialize every message shifted by compaction.')
    }
    for (const record of shiftedRecords) {
      this.tapeFacts.appendMessageReplacement(
        { ...record, orderSeq: record.orderSeq + 1, updatedAt: shiftedAt },
        { reason: 'compaction_order_shifted', revisionKind: 'order' }
      )
    }
    this.database.deepchatMessagesTable.incrementOrderSeqFrom(sessionId, fromOrderSeq, shiftedAt)
    this.markProjectionCurrent(sessionId)
  }

  updateAssistantContent(
    messageId: string,
    blocks: AssistantMessageBlock[],
    metadata?: string
  ): void {
    this.database.deepchatAssistantBlocksTable.replaceForMessage(messageId, blocks)
    this.database.deepchatMessagesTable.updateStatus(messageId, 'pending')
    if (metadata !== undefined) {
      this.updateAssistantMetadata(messageId, metadata)
    }
  }

  updateAssistantMetadata(messageId: string, metadata: string): void {
    this.database.deepchatMessagesTable.updateMetadata(messageId, metadata)
    const row = this.database.deepchatMessagesTable.get(messageId)
    if (row?.role === 'assistant') {
      this.persistUsageStats({ ...this.recordFromRow(row), metadata })
    }
  }

  /**
   * Only the pending region is written in place. Terminal status arrives through a fact-backed
   * method (`finalizeAssistantMessage`, `setMessageError`, `settleSteerMessages`,
   * `restoreUserMessage`), never by flipping the column.
   */
  updateMessageStatus(messageId: string, status: 'pending'): void {
    this.database.deepchatMessagesTable.updateStatus(messageId, status)
  }

  markSteerMessagesRead(messageIds: string[], readAt: number): ChatMessageRecord[] {
    for (const messageId of messageIds) {
      const message = this.getMessage(messageId)
      if (!message || message.role !== 'user' || message.status !== 'pending') {
        throw new Error(`Pending steer message not found: ${messageId}`)
      }
      const metadata = parseMessageMetadata(message.metadata)
      if (metadata.inputReceipt?.mode !== 'steer' || metadata.inputReceipt.readAt !== null) {
        throw new Error(`Message ${messageId} is not an unread steer message.`)
      }
      this.commitReplacement(
        {
          ...message,
          metadata: JSON.stringify({
            ...metadata,
            inputReceipt: {
              mode: 'steer',
              readAt
            }
          } satisfies MessageMetadata),
          updatedAt: Date.now()
        },
        { reason: 'steer_message_read', revisionKind: 'record' }
      )
    }
    return messageIds.map((messageId) => this.requireMessage(messageId))
  }

  settleSteerMessages(messageIds: string[]): ChatMessageRecord[] {
    for (const messageId of messageIds) {
      const message = this.getMessage(messageId)
      if (!message || message.role !== 'user' || message.status !== 'pending') {
        throw new Error(`Pending steer message not found: ${messageId}`)
      }
      this.commitReplacement(
        { ...message, status: 'sent', updatedAt: Date.now() },
        { reason: 'steer_message_settled', revisionKind: 'record' }
      )
    }
    return messageIds.map((messageId) => this.requireMessage(messageId))
  }

  failPendingSteerMessages(messageIds: string[]): ChatMessageRecord[] {
    for (const messageId of messageIds) {
      const message = this.getMessage(messageId)
      if (!message || message.role !== 'user' || message.status !== 'pending') {
        throw new Error(`Pending steer message not found: ${messageId}`)
      }
      const metadata = parseMessageMetadata(message.metadata)
      if (metadata.inputReceipt?.mode !== 'steer' || metadata.inputReceipt.readAt !== null) {
        throw new Error(`Message ${messageId} is not an unread steer message.`)
      }
      this.commitReplacement(
        { ...message, status: 'error', updatedAt: Date.now() },
        { reason: 'steer_message_restart_failed', revisionKind: 'record' }
      )
    }
    return messageIds.map((messageId) => this.requireMessage(messageId))
  }

  /**
   * A retried prompt whose row had failed (for example a Steer prompt that could not restart) is
   * kept and re-sent, so it must count as sent again for context history.
   */
  restoreUserMessage(messageId: string): void {
    this.runInDatabaseTransaction(() => {
      const message = this.getMessage(messageId)
      if (!message || message.role !== 'user' || message.status === 'sent') {
        return
      }
      this.commitReplacement(
        { ...message, status: 'sent', updatedAt: Date.now() },
        { reason: 'retry_restored_prompt', revisionKind: 'record' }
      )
    })
  }

  finalizeAssistantMessage(
    messageId: string,
    blocks: AssistantMessageBlock[],
    metadata: string
  ): void {
    this.runInDatabaseTransaction(() => {
      const row = this.database.deepchatMessagesTable.get(messageId)
      if (!row) return
      const record = this.terminalRecord({
        ...this.recordFromRow(row),
        role: 'assistant',
        content: JSON.stringify(blocks),
        status: 'sent',
        metadata,
        updatedAt: Date.now()
      })
      this.commitRecord(record)
      this.persistUsageStats(record)
    })
  }

  updateCompactionMessage(
    messageId: string,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null,
    options: CompactionMessageOptions
  ): void {
    this.runInDatabaseTransaction(() => {
      const row = this.database.deepchatMessagesTable.get(messageId)
      if (!row) return
      this.commitRecord(
        this.terminalRecord({
          ...this.recordFromRow(row),
          role: 'assistant',
          content: JSON.stringify(this.buildCompactionBlocks(status)),
          status: 'sent',
          metadata: JSON.stringify(
            this.buildCompactionMetadata(
              status,
              summaryUpdatedAt,
              options.compactionAttemptId,
              options.boundaryReason
            )
          ),
          updatedAt: Date.now()
        })
      )
    })
  }

  recordCompactionModelCall(input: TapeCompactionModelCallInput): void {
    this.runInDatabaseTransaction(() => {
      const receipt = this.compactionUsage.appendCompactionModelCall(input)
      this.database.deepchatUsageStatsTable.upsert(
        buildCompactionUsageStatsRecord({
          sessionId: receipt.row.session_id,
          event: receipt.event,
          source: 'live'
        })
      )
    })
  }

  setMessageError(messageId: string, blocks: AssistantMessageBlock[], metadata?: string): void {
    this.runInDatabaseTransaction(() => {
      const row = this.database.deepchatMessagesTable.get(messageId)
      if (!row) return
      const record = this.terminalRecord({
        ...this.recordFromRow(row),
        role: 'assistant',
        content: JSON.stringify(blocks),
        status: 'error',
        metadata: metadata ?? row.metadata,
        updatedAt: Date.now()
      })
      this.commitRecord(record)
      if (metadata !== undefined) {
        this.persistUsageStats(record)
      }
    })
  }

  getMessages(sessionId: string): ChatMessageRecord[] {
    const rows = this.database.deepchatMessagesTable.getBySession(sessionId)
    return this.toRecords(rows)
  }

  getPendingAssistantMessages(sessionId: string): ChatMessageRecord[] {
    const rows = this.database.deepchatMessagesTable.getPendingAssistantBySession(sessionId)
    return this.toRecords(rows)
  }

  hasMessages(sessionId: string): boolean {
    return this.database.deepchatMessagesTable.hasBySession(sessionId)
  }

  listMessagesPage(
    sessionId: string,
    options?: {
      limit?: number
      cursor?: MessagePageCursor | null
    }
  ): ChatMessagePageResult {
    const limit = Math.min(Math.max(Math.floor(options?.limit ?? 100), 1), 500)
    const rows = this.database.deepchatMessagesTable.listPageBySession(sessionId, {
      limit: limit + 1,
      cursor: options?.cursor ?? null
    })
    const hasMore = rows.length > limit
    const pageRows = (hasMore ? rows.slice(0, limit) : rows).reverse()
    let auditedMessageIds = new Set<string>()
    if (this.executionAudit && pageRows.length > 0) {
      try {
        auditedMessageIds = new Set(
          this.executionAudit.listMessageIdsWithNestedExecutionAudit(
            sessionId,
            pageRows.map((row) => row.id)
          )
        )
      } catch (error) {
        logger.warn('Failed to project nested execution audit availability', { sessionId }, error)
      }
    }
    const messages = this.toRecords(pageRows).map((message) => ({
      ...message,
      hasNestedExecutionAudit: auditedMessageIds.has(message.id)
    }))
    const nextCursor =
      hasMore && messages.length > 0
        ? {
            orderSeq: messages[0].orderSeq,
            id: messages[0].id
          }
        : null

    return {
      messages,
      nextCursor,
      hasMore
    }
  }

  getMessagesUpToOrderSeq(sessionId: string, maxOrderSeq: number): ChatMessageRecord[] {
    const rows = this.database.deepchatMessagesTable.getBySessionUpToOrderSeq(
      sessionId,
      maxOrderSeq
    )
    return this.toRecords(rows)
  }

  getMessageIds(sessionId: string): string[] {
    return this.database.deepchatMessagesTable.getIdsBySession(sessionId)
  }

  getMessage(messageId: string): ChatMessageRecord | null {
    const row = this.database.deepchatMessagesTable.get(messageId)
    if (!row) return null
    return this.toRecord(row)
  }

  private requireMessage(messageId: string): ChatMessageRecord {
    const message = this.getMessage(messageId)
    if (!message) {
      throw new Error(`Message not found: ${messageId}`)
    }
    return message
  }

  getLastUserMessageBeforeOrAt(sessionId: string, orderSeq: number): ChatMessageRecord | null {
    const row = this.database.deepchatMessagesTable.getLastUserMessageBeforeOrAtOrderSeq(
      sessionId,
      orderSeq
    )
    if (!row) return null
    return this.toRecord(row)
  }

  updateMessageContent(messageId: string, content: string): void {
    this.runInDatabaseTransaction(() => this.applyMessageContentUpdate(messageId, content))
  }

  private applyMessageContentUpdate(messageId: string, content: string): void {
    const row = this.database.deepchatMessagesTable.get(messageId)
    if (!row) {
      return
    }
    this.commitReplacement(
      this.terminalRecord({ ...this.recordFromRow(row), content, updatedAt: Date.now() }),
      { reason: 'message_content_updated', revisionKind: 'record' }
    )
  }

  getNextOrderSeq(sessionId: string): number {
    return this.database.deepchatMessagesTable.getMaxOrderSeq(sessionId) + 1
  }

  deleteBySession(sessionId: string): void {
    this.database.deepchatTranscriptProjectionMetaTable.delete(sessionId)
    this.database.deepchatSearchDocumentsTable.deleteBySession(sessionId)
    this.database.deepchatAssistantBlocksTable.deleteBySession(sessionId)
    this.database.deepchatUserMessageLinksTable.deleteBySession(sessionId)
    this.database.deepchatUserMessageFilesTable.deleteBySession(sessionId)
    this.database.deepchatUserMessagesTable.deleteBySession(sessionId)
    this.database.deepchatMessageTracesTable.deleteBySessionId(sessionId)
    this.database.deepchatMessageSearchResultsTable.deleteBySessionId(sessionId)
    this.database.deepchatMessagesTable.deleteBySession(sessionId)
  }

  deleteMessage(messageId: string): void {
    this.deleteMessageWithReason(messageId, 'message_deleted')
  }

  private deleteMessageWithReason(messageId: string, reason: string): void {
    this.runInDatabaseTransaction(() => {
      const record = this.getMessage(messageId)
      if (!record) {
        this.projection.applyRetractions([messageId])
        return
      }
      this.commitRetractions(record.sessionId, [record], reason)
    })
  }

  deleteFromOrderSeq(sessionId: string, fromOrderSeq: number): void {
    this.runInDatabaseTransaction(() => {
      const records = this.getMessages(sessionId).filter(
        (record) => record.orderSeq >= fromOrderSeq
      )
      this.commitRetractions(sessionId, records, 'messages_deleted_from_order_seq')
      // The range delete is the table-level guarantee this method has always given: no row of the
      // Session at or past `fromOrderSeq` survives, whatever the read above surfaced.
      this.database.deepchatMessagesTable.deleteFromOrderSeq(sessionId, fromOrderSeq)
    })
  }

  addSearchResult(row: {
    sessionId: string
    messageId: string
    searchId?: string | null
    rank?: number | null
    result: SearchResult
  }): void {
    const payload: SearchResult = {
      title: row.result.title || '',
      url: row.result.url || '',
      snippet: row.result.snippet,
      favicon: row.result.favicon,
      content: row.result.content,
      description: row.result.description,
      icon: row.result.icon,
      rank: row.result.rank,
      searchId: row.result.searchId ?? row.searchId ?? undefined
    }

    this.database.deepchatMessageSearchResultsTable.add({
      sessionId: row.sessionId,
      messageId: row.messageId,
      searchId: row.searchId,
      rank: row.rank,
      content: JSON.stringify(payload)
    })
  }

  getSearchResults(messageId: string, searchId?: string): SearchResult[] {
    const rows = this.database.deepchatMessageSearchResultsTable.listByMessageId(messageId)
    const parsed: SearchResult[] = []

    for (const row of rows) {
      try {
        const result = JSON.parse(row.content) as SearchResult
        parsed.push({
          ...result,
          rank: typeof result.rank === 'number' ? result.rank : (row.rank ?? undefined),
          searchId: result.searchId ?? row.search_id ?? undefined
        })
      } catch (error) {
        console.warn('[SessionTranscript] Failed to parse search result row:', error)
      }
    }

    if (searchId) {
      const filtered = parsed.filter((item) => item.searchId === searchId)
      if (filtered.length > 0) {
        return filtered
      }

      const legacyResults = parsed.filter((item) => !item.searchId)
      if (legacyResults.length > 0) {
        return legacyResults
      }
    }

    return parsed
  }

  insertMessageTrace(row: {
    id: string
    messageId: string
    sessionId: string
    providerId: string
    modelId: string
    endpoint: string
    headersJson: string
    bodyJson: string
    truncated: boolean
    createdAt?: number
    requestSeq?: number
    logicalRound?: number | null
    physicalAttempt?: number | null
  }): number {
    return this.database.deepchatMessageTracesTable.insert(row)
  }

  listMessageTraces(messageId: string): MessageTraceRecord[] {
    const rows = this.database.deepchatMessageTracesTable.listByMessageId(messageId)
    return rows.map((row) => ({
      id: row.id,
      messageId: row.message_id,
      sessionId: row.session_id,
      providerId: row.provider_id,
      modelId: row.model_id,
      requestSeq: row.request_seq,
      logicalRound: row.logical_round,
      physicalAttempt: row.physical_attempt,
      endpoint: row.endpoint,
      headersJson: row.headers_json,
      bodyJson: row.body_json,
      truncated: row.truncated === 1,
      createdAt: row.created_at
    }))
  }

  getMessageTraceCount(messageId: string): number {
    return this.database.deepchatMessageTracesTable.countByMessageId(messageId)
  }

  getMaxMessageTraceRequestSeq(messageId: string): number {
    return this.database.deepchatMessageTracesTable.maxRequestSeqByMessageId(messageId)
  }

  cloneSentMessagesToSession(
    sourceSessionId: string,
    targetSessionId: string,
    maxOrderSeq: number
  ): number {
    const sourceRows = this.database.deepchatMessagesTable
      .getBySessionUpToOrderSeq(sourceSessionId, maxOrderSeq)
      .filter(
        (row) =>
          row.status === 'sent' && parseMessageMetadata(row.metadata).messageType !== 'compaction'
      )
    const sourceRecords = this.toRecords(sourceRows)
    const forkedAt = Date.now()

    this.runInDatabaseTransaction(() => {
      let nextOrderSeq = 1
      for (const record of sourceRecords) {
        this.commitRecord(
          this.terminalRecord({
            ...record,
            id: nanoid(),
            sessionId: targetSessionId,
            orderSeq: nextOrderSeq,
            status: 'sent',
            createdAt: forkedAt,
            updatedAt: forkedAt
          })
        )
        nextOrderSeq += 1
      }
    })

    return sourceRecords.length
  }

  recoverPendingMessages(options?: {
    forceRecoverMessagesBySession?: ReadonlyMap<string, ReadonlySet<string>>
  }): number {
    const pendingRows = this.database.deepchatMessagesTable.getByStatus('pending')
    const pendingRecords = new Map(this.toRecords(pendingRows).map((record) => [record.id, record]))
    let recoveredCount = 0
    for (const row of pendingRows) {
      const forceRecovery = options?.forceRecoverMessagesBySession?.get(row.session_id)?.has(row.id)
      if (!forceRecovery && this.shouldKeepPending(row)) {
        continue
      }
      const record = pendingRecords.get(row.id) ?? this.recordFromRow(row)
      const content =
        row.role === 'assistant'
          ? JSON.stringify(
              buildTerminalErrorBlocks(
                parseAssistantBlocks(record.content),
                'common.error.sessionInterrupted'
              )
            )
          : record.content
      // One transaction per message, as the row updates were before: a message that cannot be
      // recovered does not undo the ones already settled.
      this.runInDatabaseTransaction(() =>
        this.commitRecord(
          this.terminalRecord({ ...record, content, status: 'error', updatedAt: Date.now() })
        )
      )
      recoveredCount += 1
    }
    return recoveredCount
  }

  reconcileCompactionMessages(): { compacted: number; retracted: number; failed: number } {
    if (!this.compactionAnchors) return { compacted: 0, retracted: 0, failed: 0 }

    let compacted = 0
    let retracted = 0
    let failed = 0
    for (const row of this.database.deepchatMessagesTable.getCompactionRecoveryCandidates()) {
      try {
        const metadata = parseMessageMetadata(row.metadata)
        const compactionAttemptId = normalizeCompactionAttemptId(metadata.compactionAttemptId)
        const anchor = compactionAttemptId
          ? this.compactionAnchors.getReconstructionAnchorByCompactionAttemptId(
              row.session_id,
              compactionAttemptId
            )
          : undefined

        if (anchor && compactionAttemptId) {
          this.updateCompactionMessage(
            row.id,
            'compacted',
            summaryUpdatedAtFromCompactionAnchor(anchor),
            {
              compactionAttemptId,
              boundaryReason: normalizeCompactionBoundaryReason(
                parseTapeAnchorState(anchor)?.reason
              )
            }
          )
          compacted += 1
          continue
        }

        this.deleteMessageWithReason(row.id, 'stale_compaction_marker_recovered')
        retracted += 1
      } catch (error) {
        failed += 1
        logger.warn(
          'Failed to reconcile compaction marker',
          { sessionId: row.session_id, messageId: row.id },
          error
        )
      }
    }

    return { compacted, retracted, failed }
  }

  /** Legacy chat import: the row becomes a message fact and its transcript projection. */
  importMessageRow(row: DeepChatMessageRow): void {
    this.commitRecord(this.terminalRecord(this.recordFromRow(row)))
  }

  private shouldKeepPending(row: DeepChatMessageRow): boolean {
    if (row.role === 'user') {
      return parseMessageMetadata(row.metadata).inputReceipt?.mode === 'steer'
    }
    const blocks = parseAssistantBlocks(this.materializeContent(row))
    return blocks.some(
      (block) =>
        block.type === 'action' &&
        (block.action_type === 'tool_call_permission' ||
          block.action_type === 'question_request') &&
        block.status === 'pending' &&
        block.extra?.needsUserAction !== false
    )
  }

  /**
   * Terminal state is written fact-first: the record is appended to Tape, then the transcript
   * tables are derived from that same record. Both happen inside the caller's transaction, so a
   * failed append leaves no transcript row behind and a committed row always has its fact.
   */
  private commitRecord(record: ChatMessageRecord): void {
    this.tapeFacts.appendMessageRecord(record)
    this.projection.applyRecord(record)
    this.markProjectionCurrent(record.sessionId)
  }

  private commitReplacement(
    record: ChatMessageRecord,
    options: TapeMessageReplacementOptions
  ): void {
    this.tapeFacts.appendMessageReplacement(record, options)
    this.projection.applyRecord(record)
    this.markProjectionCurrent(record.sessionId)
  }

  private commitRetractions(sessionId: string, records: ChatMessageRecord[], reason: string): void {
    for (const record of records) {
      this.tapeFacts.appendMessageRetraction(record, reason)
    }
    this.projection.applyRetractions(records.map((record) => record.id))
    this.markProjectionCurrent(sessionId)
  }

  /**
   * The tables now reflect every message fact up to the Tape head, including the one just
   * appended, so an established cursor moves to the head. A Session without a cursor for this
   * incarnation is left alone: its transcript may still hold rows the Tape never saw (written
   * before the projection existed, or before a Tape reset), and only reconciliation's one-time
   * backfill may declare the two aligned.
   *
   * Moving straight to the head relies on message facts entering the Tape only through this
   * class and reconciliation's backfill. A third writer of `message/*` facts would have to replay
   * the rows between the cursor and the head before advancing it.
   */
  private markProjectionCurrent(sessionId: string): void {
    const head = this.tapeHead.getProjectionHead(sessionId)
    if (!head) return
    const current = this.readProjectionCursor(sessionId)
    if (current?.tapeIncarnationId !== head.tapeIncarnationId) return
    this.writeProjectionCursor(sessionId, head)
  }

  /** The record a fact carries: content in the form the tables will hand back after the write. */
  private terminalRecord(record: ChatMessageRecord): ChatMessageRecord {
    return {
      ...record,
      content: canonicalizeMessageContent(record.role, record.content, record.updatedAt),
      traceCount: 0
    }
  }

  /**
   * Usage stats count provider calls, so only the assistant writes that follow one record them:
   * the pending-region metadata update while a reply streams and the terminal write at its end.
   * Fork, import, recovery and replay carry the same record without a call and stay out.
   */
  private persistUsageStats(record: ChatMessageRecord): void {
    if (record.role !== 'assistant') return
    try {
      const metadata = parseMessageMetadata(record.metadata)
      if (metadata.messageType === 'compaction') {
        return
      }

      const sessionRow = this.database.deepchatSessionsTable.get(record.sessionId)
      const providerId = resolveUsageProviderId(metadata, sessionRow?.provider_id)
      const modelId = resolveUsageModelId(metadata, sessionRow?.model_id)
      if (!providerId || !modelId) {
        return
      }

      const usageRecord = buildUsageStatsRecord({
        messageId: record.id,
        sessionId: record.sessionId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        providerId,
        modelId,
        metadata,
        source: 'live'
      })
      if (usageRecord) {
        this.database.deepchatUsageStatsTable.upsert(usageRecord)
      }
    } catch (error) {
      logger.error(
        'Failed to persist deepchat usage stats',
        { messageId: record.id, source: 'live' },
        error
      )
    }
  }

  private recordFromRow(row: DeepChatMessageRow): ChatMessageRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      orderSeq: row.order_seq,
      role: row.role,
      content: row.content,
      status: row.status,
      isContextEdge: row.is_context_edge,
      metadata: row.metadata,
      traceCount: 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private toRecord(row: DeepChatMessageRow): ChatMessageRecord {
    return this.toRecords([row])[0]!
  }

  private toRecords(rows: DeepChatMessageRow[]): ChatMessageRecord[] {
    if (rows.length === 0) {
      return []
    }

    const maps = this.loadStructuredMaps(rows.map((row) => row.id))
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      orderSeq: row.order_seq,
      role: row.role,
      content: this.materializeContent(row, maps),
      status: row.status,
      isContextEdge: row.is_context_edge,
      metadata: row.metadata,
      traceCount: row.trace_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  private materializeContent(row: DeepChatMessageRow, maps?: StructuredMessageMaps): string {
    if (row.role === 'user') {
      const userRow =
        maps?.userRows.get(row.id) ?? this.database.deepchatUserMessagesTable.get(row.id)
      if (!userRow) {
        return row.content
      }

      const fileRows = maps
        ? (maps.fileRows.get(row.id) ?? [])
        : this.database.deepchatUserMessageFilesTable.listByMessageIds([row.id])
      const linkRows = maps
        ? (maps.linkRows.get(row.id) ?? [])
        : this.database.deepchatUserMessageLinksTable.listByMessageIds([row.id])

      const rawUserContent = parseUserContent(row.content)
      return assembleUserContent({
        text: userRow.text,
        files: fileRows.map((fileRow) => toMessageFile(fileRow)),
        links: linkRows.map((linkRow) => linkRow.url),
        search: userRow.search_enabled === 1,
        think: userRow.think_enabled === 1,
        activeSkills: rawUserContent?.activeSkills ?? [],
        inlineItems: rawUserContent?.inlineItems ?? []
      })
    }

    const assistantRows = maps
      ? (maps.assistantRows.get(row.id) ?? [])
      : this.database.deepchatAssistantBlocksTable.listByMessageId(row.id)
    if (assistantRows.length === 0) {
      return row.content
    }

    return JSON.stringify(assistantRows.map((blockRow) => toAssistantBlock(blockRow)))
  }

  private buildCompactionBlocks(status: 'compacting' | 'compacted'): AssistantMessageBlock[] {
    return [
      {
        type: 'content',
        content:
          status === 'compacting'
            ? 'Compacting conversation context...'
            : 'Conversation context compacted.',
        status: status === 'compacting' ? 'loading' : 'success',
        timestamp: Date.now()
      }
    ]
  }

  private buildCompactionMetadata(
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null,
    compactionAttemptId: string,
    boundaryReason: SessionCompactionBoundaryReason | null = null
  ): MessageMetadata {
    return {
      messageType: 'compaction',
      compactionStatus: status,
      compactionAttemptId,
      compactionBoundaryReason: boundaryReason,
      summaryUpdatedAt
    }
  }

  private loadStructuredMaps(messageIds: string[]): StructuredMessageMaps {
    const userRows = this.database.deepchatUserMessagesTable.listByMessageIds(messageIds)
    const fileRows = this.database.deepchatUserMessageFilesTable.listByMessageIds(messageIds)
    const linkRows = this.database.deepchatUserMessageLinksTable.listByMessageIds(messageIds)
    const assistantRows = this.database.deepchatAssistantBlocksTable.listByMessageIds(messageIds)

    return {
      userRows: new Map(userRows.map((row) => [row.message_id, row])),
      fileRows: this.groupByMessageId(fileRows),
      linkRows: this.groupByMessageId(linkRows),
      assistantRows: this.groupByMessageId(assistantRows)
    }
  }

  private groupByMessageId<T extends { message_id: string }>(rows: T[]): Map<string, T[]> {
    const grouped = new Map<string, T[]>()
    for (const row of rows) {
      const bucket = grouped.get(row.message_id)
      if (bucket) {
        bucket.push(row)
      } else {
        grouped.set(row.message_id, [row])
      }
    }
    return grouped
  }
}
