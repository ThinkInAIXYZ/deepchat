import { nanoid } from 'nanoid'
import { SQLitePresenter } from '../sqlitePresenter'
import type {
  ChatMessageRecord,
  MessageTraceRecord,
  UserMessageContent,
  AssistantMessageBlock,
  MessageMetadata
} from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'
import logger from '@shared/logger'
import type { DeepChatMessageRow } from '../sqlitePresenter/tables/deepchatMessages'
import {
  buildUsageStatsRecord,
  parseMessageMetadata,
  resolveUsageModelId,
  resolveUsageProviderId
} from '../usageStats'

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

export class DeepChatMessageStore {
  private sqlitePresenter: SQLitePresenter

  constructor(sqlitePresenter: SQLitePresenter) {
    this.sqlitePresenter = sqlitePresenter
  }

  createUserMessage(sessionId: string, orderSeq: number, content: UserMessageContent): string {
    const id = nanoid()
    this.sqlitePresenter.deepchatMessagesTable.insert({
      id,
      sessionId,
      orderSeq,
      role: 'user',
      content: JSON.stringify(content),
      status: 'sent'
    })
    return id
  }

  createAssistantMessage(sessionId: string, orderSeq: number): string {
    const id = nanoid()
    this.sqlitePresenter.deepchatMessagesTable.insert({
      id,
      sessionId,
      orderSeq,
      role: 'assistant',
      content: '[]',
      status: 'pending'
    })
    return id
  }

  createCompactionMessage(
    sessionId: string,
    orderSeq: number,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null
  ): string {
    const id = nanoid()
    this.sqlitePresenter.deepchatMessagesTable.insert({
      id,
      sessionId,
      orderSeq,
      role: 'assistant',
      content: JSON.stringify(this.buildCompactionBlocks(status)),
      status: 'sent',
      metadata: JSON.stringify(this.buildCompactionMetadata(status, summaryUpdatedAt))
    })
    return id
  }

  updateAssistantContent(messageId: string, blocks: AssistantMessageBlock[]): void {
    this.sqlitePresenter.deepchatMessagesTable.updateContent(messageId, JSON.stringify(blocks))
  }

  updateMessageStatus(messageId: string, status: 'pending' | 'sent' | 'error'): void {
    this.sqlitePresenter.deepchatMessagesTable.updateStatus(messageId, status)
  }

  finalizeAssistantMessage(
    messageId: string,
    blocks: AssistantMessageBlock[],
    metadata: string
  ): void {
    this.sqlitePresenter.deepchatMessagesTable.updateContentAndStatus(
      messageId,
      JSON.stringify(blocks),
      'sent',
      metadata
    )
    this.persistUsageStats(messageId, metadata, 'live')
  }

  updateCompactionMessage(
    messageId: string,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null
  ): void {
    this.sqlitePresenter.deepchatMessagesTable.updateContentAndStatus(
      messageId,
      JSON.stringify(this.buildCompactionBlocks(status)),
      'sent',
      JSON.stringify(this.buildCompactionMetadata(status, summaryUpdatedAt))
    )
  }

  setMessageError(messageId: string, blocks: AssistantMessageBlock[], metadata?: string): void {
    const serializedBlocks = JSON.stringify(blocks)
    if (metadata === undefined) {
      this.sqlitePresenter.deepchatMessagesTable.updateContentAndStatus(
        messageId,
        serializedBlocks,
        'error'
      )
      return
    }
    this.sqlitePresenter.deepchatMessagesTable.updateContentAndStatus(
      messageId,
      serializedBlocks,
      'error',
      metadata
    )
    this.persistUsageStats(messageId, metadata, 'live')
  }

  getMessages(sessionId: string): ChatMessageRecord[] {
    const rows = this.sqlitePresenter.deepchatMessagesTable.getBySession(sessionId)
    return rows.map((row) => this.toRecord(row))
  }

  getMessagesUpToOrderSeq(sessionId: string, maxOrderSeq: number): ChatMessageRecord[] {
    const rows = this.sqlitePresenter.deepchatMessagesTable.getBySessionUpToOrderSeq(
      sessionId,
      maxOrderSeq
    )
    return rows.map((row) => this.toRecord(row))
  }

  getMessageIds(sessionId: string): string[] {
    return this.sqlitePresenter.deepchatMessagesTable.getIdsBySession(sessionId)
  }

  getMessage(messageId: string): ChatMessageRecord | null {
    const row = this.sqlitePresenter.deepchatMessagesTable.get(messageId)
    if (!row) return null
    return this.toRecord(row)
  }

  getLastUserMessageBeforeOrAt(sessionId: string, orderSeq: number): ChatMessageRecord | null {
    const row = this.sqlitePresenter.deepchatMessagesTable.getLastUserMessageBeforeOrAtOrderSeq(
      sessionId,
      orderSeq
    )
    if (!row) return null
    return this.toRecord(row)
  }

  updateMessageContent(messageId: string, content: string): void {
    this.sqlitePresenter.deepchatMessagesTable.updateContent(messageId, content)
  }

  getNextOrderSeq(sessionId: string): number {
    return this.sqlitePresenter.deepchatMessagesTable.getMaxOrderSeq(sessionId) + 1
  }

  deleteBySession(sessionId: string): void {
    this.sqlitePresenter.deepchatMessageTracesTable.deleteBySessionId(sessionId)
    this.sqlitePresenter.deepchatMessageSearchResultsTable.deleteBySessionId(sessionId)
    this.sqlitePresenter.deepchatMessagesTable.deleteBySession(sessionId)
  }

  deleteMessage(messageId: string): void {
    this.sqlitePresenter.deepchatMessageTracesTable.deleteByMessageIds([messageId])
    this.sqlitePresenter.deepchatMessageSearchResultsTable.deleteByMessageIds([messageId])
    this.sqlitePresenter.deepchatMessagesTable.delete(messageId)
  }

  deleteFromOrderSeq(sessionId: string, fromOrderSeq: number): void {
    const messageIds = this.sqlitePresenter.deepchatMessagesTable.getIdsFromOrderSeq(
      sessionId,
      fromOrderSeq
    )
    if (messageIds.length > 0) {
      this.sqlitePresenter.deepchatMessageTracesTable.deleteByMessageIds(messageIds)
      this.sqlitePresenter.deepchatMessageSearchResultsTable.deleteByMessageIds(messageIds)
    }
    this.sqlitePresenter.deepchatMessagesTable.deleteFromOrderSeq(sessionId, fromOrderSeq)
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

    this.sqlitePresenter.deepchatMessageSearchResultsTable.add({
      sessionId: row.sessionId,
      messageId: row.messageId,
      searchId: row.searchId,
      rank: row.rank,
      content: JSON.stringify(payload)
    })
  }

  getSearchResults(messageId: string, searchId?: string): SearchResult[] {
    const rows = this.sqlitePresenter.deepchatMessageSearchResultsTable.listByMessageId(messageId)
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
        console.warn('[DeepChatMessageStore] Failed to parse search result row:', error)
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
  }): number {
    return this.sqlitePresenter.deepchatMessageTracesTable.insert(row)
  }

  listMessageTraces(messageId: string): MessageTraceRecord[] {
    const rows = this.sqlitePresenter.deepchatMessageTracesTable.listByMessageId(messageId)
    return rows.map((row) => ({
      id: row.id,
      messageId: row.message_id,
      sessionId: row.session_id,
      providerId: row.provider_id,
      modelId: row.model_id,
      requestSeq: row.request_seq,
      endpoint: row.endpoint,
      headersJson: row.headers_json,
      bodyJson: row.body_json,
      truncated: row.truncated === 1,
      createdAt: row.created_at
    }))
  }

  getMessageTraceCount(messageId: string): number {
    return this.sqlitePresenter.deepchatMessageTracesTable.countByMessageId(messageId)
  }

  cloneSentMessagesToSession(
    sourceSessionId: string,
    targetSessionId: string,
    maxOrderSeq: number
  ): number {
    const sourceRows = this.sqlitePresenter.deepchatMessagesTable
      .getBySessionUpToOrderSeq(sourceSessionId, maxOrderSeq)
      .filter((row) => row.status === 'sent')

    let nextOrderSeq = 1
    for (const row of sourceRows) {
      this.sqlitePresenter.deepchatMessagesTable.insert({
        id: nanoid(),
        sessionId: targetSessionId,
        orderSeq: nextOrderSeq,
        role: row.role,
        content: row.content,
        status: 'sent',
        isContextEdge: row.is_context_edge,
        metadata: row.metadata
      })
      nextOrderSeq += 1
    }

    return sourceRows.length
  }

  recoverPendingMessages(): number {
    const pendingRows = this.sqlitePresenter.deepchatMessagesTable.getByStatus('pending')
    let recoveredCount = 0
    for (const row of pendingRows) {
      if (this.shouldKeepPending(row)) {
        continue
      }
      if (row.role === 'assistant') {
        const blocks = this.parseAssistantBlocks(row.content)
        const recoveredBlocks = buildTerminalErrorBlocks(blocks, 'common.error.sessionInterrupted')
        this.sqlitePresenter.deepchatMessagesTable.updateContentAndStatus(
          row.id,
          JSON.stringify(recoveredBlocks),
          'error'
        )
      } else {
        this.sqlitePresenter.deepchatMessagesTable.updateStatus(row.id, 'error')
      }
      recoveredCount += 1
    }
    return recoveredCount
  }

  private shouldKeepPending(row: DeepChatMessageRow): boolean {
    if (row.role !== 'assistant') {
      return false
    }
    const blocks = this.parseAssistantBlocks(row.content)
    return blocks.some(
      (block) =>
        block.type === 'action' &&
        (block.action_type === 'tool_call_permission' ||
          block.action_type === 'question_request') &&
        block.status === 'pending' &&
        block.extra?.needsUserAction !== false
    )
  }

  private toRecord(row: DeepChatMessageRow): ChatMessageRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      orderSeq: row.order_seq,
      role: row.role,
      content: row.content,
      status: row.status,
      isContextEdge: row.is_context_edge,
      metadata: row.metadata,
      traceCount: row.trace_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private parseAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
    try {
      const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
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
    summaryUpdatedAt: number | null
  ): MessageMetadata {
    return {
      messageType: 'compaction',
      compactionStatus: status,
      summaryUpdatedAt
    }
  }

  private persistUsageStats(
    messageId: string,
    metadataRaw: string,
    source: 'backfill' | 'live'
  ): void {
    const usageStatsTable = this.sqlitePresenter.deepchatUsageStatsTable
    if (!usageStatsTable) {
      return
    }

    const messageRow = this.sqlitePresenter.deepchatMessagesTable.get(messageId)
    if (!messageRow || messageRow.role !== 'assistant') {
      return
    }

    try {
      const metadata = parseMessageMetadata(metadataRaw)
      if (metadata.messageType === 'compaction') {
        return
      }

      const sessionRow = this.sqlitePresenter.deepchatSessionsTable.get(messageRow.session_id)
      const providerId = resolveUsageProviderId(metadata, sessionRow?.provider_id)
      const modelId = resolveUsageModelId(metadata, sessionRow?.model_id)

      if (!providerId || !modelId) {
        return
      }

      const usageRecord = buildUsageStatsRecord({
        messageId: messageRow.id,
        sessionId: messageRow.session_id,
        createdAt: messageRow.created_at,
        updatedAt: messageRow.updated_at,
        providerId,
        modelId,
        metadata,
        source
      })

      if (!usageRecord) {
        return
      }

      usageStatsTable.upsert(usageRecord)
    } catch (error) {
      logger.error('Failed to persist deepchat usage stats', { messageId, source }, error)
      return
    }
  }
}
