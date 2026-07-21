import { nanoid } from 'nanoid'
import type { SessionDatabase } from './database'
import type {
  ChatMessagePageResult,
  ChatMessageRecord,
  MessageFile,
  MessageMetadata,
  MessagePageCursor,
  MessageTraceRecord,
  UserMessageContent,
  AssistantMessageBlock
} from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'
import logger from '@shared/logger'
import type { DeepChatMessageRow } from '@/session/data/tables/deepchatMessages'
import type { DeepChatAssistantBlockRow } from '@/session/data/tables/deepchatAssistantBlocks'
import type { DeepChatUserMessageFileRow } from '@/session/data/tables/deepchatUserMessageFiles'
import type { DeepChatUserMessageLinkRow } from '@/session/data/tables/deepchatUserMessageLinks'
import type { DeepChatUserMessageRow } from '@/session/data/tables/deepchatUserMessages'
import {
  buildUsageStatsRecord,
  parseMessageMetadata,
  resolveUsageModelId,
  resolveUsageProviderId
} from '@/session/usageStats'
import type { TapeMessageFactWriter } from '@/tape/ports/capabilities'
import {
  normalizeAttachmentRepresentationPreference,
  normalizeAttachmentResolvedRepresentation
} from '@shared/utils/attachmentRepresentation'

const MAX_SEARCHABLE_OCR_CHARACTERS = 32_000
const SEARCH_OCR_TRUNCATION_MARKER = '[OCR search text truncated]'

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

function normalizePersistedActionType(
  actionType: string | null
): AssistantMessageBlock['action_type'] | undefined {
  if (
    actionType === 'tool_call_permission' ||
    actionType === 'question_request' ||
    actionType === 'rate_limit'
  ) {
    return actionType
  }

  return undefined
}

function extractSearchableMessageContent(rawContent: string): string {
  try {
    const parsed = JSON.parse(rawContent) as
      | UserMessageContent
      | Array<{
          type?: string
          content?: string
          text?: string
          error?: string
        }>

    if (Array.isArray(parsed)) {
      const segments = parsed
        .flatMap((block) => {
          if (!block || typeof block !== 'object') {
            return []
          }

          const values = [block.content, block.text, block.error]
          return values.filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0
          )
        })
        .map((value) => value.trim())

      if (segments.length > 0) {
        return segments.join('\n')
      }
    } else if (parsed && typeof parsed === 'object') {
      const segments: string[] = []
      if (typeof parsed.text === 'string' && parsed.text.trim()) {
        segments.push(parsed.text.trim())
      }
      const searchableOcrText = buildSearchableOcrText(parsed.files)
      if (searchableOcrText) segments.push(searchableOcrText)
      return segments.join('\n')
    }
  } catch {
    // Plain-text fallback.
  }

  return rawContent.trim()
}

function buildSearchableOcrText(files: unknown): string {
  if (!Array.isArray(files)) return ''
  const text = files
    .flatMap((file) => {
      if (!file || typeof file !== 'object' || Array.isArray(file)) return []
      const resolved = normalizeAttachmentResolvedRepresentation(
        (file as Record<string, unknown>).resolvedRepresentation
      )
      return resolved?.kind === 'ocr_text' && resolved.text.trim() ? [resolved.text.trim()] : []
    })
    .join('\n')
  if (text.length <= MAX_SEARCHABLE_OCR_CHARACTERS) return text

  const marker = `\n${SEARCH_OCR_TRUNCATION_MARKER}\n`
  const retainedCharacters = Math.max(
    0,
    Math.floor((MAX_SEARCHABLE_OCR_CHARACTERS - marker.length) / 2)
  )
  let headEnd = retainedCharacters
  if (isHighSurrogate(text.charCodeAt(headEnd - 1))) headEnd -= 1
  let tailStart = text.length - retainedCharacters
  if (isLowSurrogate(text.charCodeAt(tailStart))) tailStart += 1
  return `${text.slice(0, headEnd).trimEnd()}${marker}${text.slice(tailStart).trimStart()}`
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

export class SessionTranscript {
  private database: SessionDatabase
  private readonly tapeFacts: TapeMessageFactWriter

  constructor(database: SessionDatabase, tapeFacts: TapeMessageFactWriter) {
    this.database = database
    this.tapeFacts = tapeFacts
  }

  private runInDatabaseTransaction<T>(operation: () => T): T {
    return this.database.getDatabase().transaction(operation)() as T
  }

  createUserMessage(sessionId: string, orderSeq: number, content: UserMessageContent): string {
    const id = nanoid()
    const serializedContent = JSON.stringify(content)
    this.database.deepchatMessagesTable.insert({
      id,
      sessionId,
      orderSeq,
      role: 'user',
      content: serializedContent,
      status: 'sent'
    })
    this.persistUserContent(id, content)
    this.upsertMessageSearchDocument(sessionId, id, 'user', serializedContent)
    this.appendLiveTapeFacts(id)
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
    summaryUpdatedAt: number | null
  ): string {
    const id = nanoid()
    this.database.deepchatMessagesTable.insert({
      id,
      sessionId,
      orderSeq,
      role: 'assistant',
      content: JSON.stringify(this.buildCompactionBlocks(status)),
      status: 'sent',
      metadata: JSON.stringify(this.buildCompactionMetadata(status, summaryUpdatedAt))
    })
    this.appendLiveTapeFacts(id)
    return id
  }

  createCompactionMessage(
    sessionId: string,
    orderSeq: number,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null
  ): string {
    return this.insertCompactionMessageRecord(sessionId, orderSeq, status, summaryUpdatedAt)
  }

  createCompactionMessageAtOrderSeq(
    sessionId: string,
    orderSeq: number,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null,
    options?: { shiftExistingMessages?: boolean }
  ): string {
    let messageId = ''
    this.runInDatabaseTransaction(() => {
      if (options?.shiftExistingMessages) {
        this.database.deepchatMessagesTable.incrementOrderSeqFrom(sessionId, orderSeq)
      }
      messageId = this.insertCompactionMessageRecord(sessionId, orderSeq, status, summaryUpdatedAt)
    })
    return messageId
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
    this.persistUsageStats(messageId, metadata, 'live')
  }

  updateMessageStatus(messageId: string, status: 'pending' | 'sent' | 'error'): void {
    this.database.deepchatMessagesTable.updateStatus(messageId, status)
  }

  finalizeAssistantMessage(
    messageId: string,
    blocks: AssistantMessageBlock[],
    metadata: string
  ): void {
    this.database.deepchatAssistantBlocksTable.replaceForMessage(messageId, blocks)
    this.database.deepchatMessagesTable.updateContentAndStatus(
      messageId,
      JSON.stringify(blocks),
      'sent',
      metadata
    )
    this.upsertAssistantSearchDocument(messageId, blocks)
    this.persistUsageStats(messageId, metadata, 'live')
    this.appendLiveTapeFacts(messageId)
  }

  updateCompactionMessage(
    messageId: string,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null
  ): void {
    this.runInDatabaseTransaction(() => {
      this.database.deepchatMessagesTable.updateContentAndStatus(
        messageId,
        JSON.stringify(this.buildCompactionBlocks(status)),
        'sent',
        JSON.stringify(this.buildCompactionMetadata(status, summaryUpdatedAt))
      )
      this.appendLiveTapeFacts(messageId)
    })
  }

  setMessageError(messageId: string, blocks: AssistantMessageBlock[], metadata?: string): void {
    this.database.deepchatAssistantBlocksTable.replaceForMessage(messageId, blocks)
    const serializedBlocks = JSON.stringify(blocks)
    if (metadata === undefined) {
      this.database.deepchatMessagesTable.updateContentAndStatus(
        messageId,
        serializedBlocks,
        'error'
      )
      this.upsertAssistantSearchDocument(messageId, blocks)
      this.appendLiveTapeFacts(messageId)
      return
    }
    this.database.deepchatMessagesTable.updateContentAndStatus(
      messageId,
      serializedBlocks,
      'error',
      metadata
    )
    this.upsertAssistantSearchDocument(messageId, blocks)
    this.persistUsageStats(messageId, metadata, 'live')
    this.appendLiveTapeFacts(messageId)
  }

  getMessages(sessionId: string): ChatMessageRecord[] {
    const rows = this.database.deepchatMessagesTable.getBySession(sessionId)
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
    const messages = this.toRecords(pageRows)
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

  getLastUserMessageBeforeOrAt(sessionId: string, orderSeq: number): ChatMessageRecord | null {
    const row = this.database.deepchatMessagesTable.getLastUserMessageBeforeOrAtOrderSeq(
      sessionId,
      orderSeq
    )
    if (!row) return null
    return this.toRecord(row)
  }

  updateMessageContent(messageId: string, content: string): void {
    this.database.deepchatMessagesTable.updateContent(messageId, content)
    const row = this.database.deepchatMessagesTable.get(messageId)
    if (!row) {
      return
    }

    if (row.role === 'user') {
      const parsed = this.parseUserContent(content)
      if (parsed) {
        this.persistUserContent(messageId, parsed)
        this.upsertMessageSearchDocument(row.session_id, messageId, 'user', content, row.updated_at)
      }
      const updated = this.getMessage(messageId)
      if (updated) {
        this.tapeFacts.appendMessageReplacement(updated, 'message_content_updated')
      }
      return
    }

    const blocks = this.parseAssistantBlocks(content)
    this.database.deepchatAssistantBlocksTable.replaceForMessage(messageId, blocks)
    if (row.status === 'sent' || row.status === 'error') {
      this.upsertMessageSearchDocument(
        row.session_id,
        messageId,
        'assistant',
        content,
        row.updated_at
      )
    }
    const updated = this.getMessage(messageId)
    if (updated) {
      this.tapeFacts.appendMessageReplacement(updated, 'message_content_updated')
    }
  }

  getNextOrderSeq(sessionId: string): number {
    return this.database.deepchatMessagesTable.getMaxOrderSeq(sessionId) + 1
  }

  deleteBySession(sessionId: string): void {
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
    this.runInDatabaseTransaction(() => {
      const record = this.getMessage(messageId)
      if (record) {
        this.tapeFacts.appendMessageRetraction(record, 'message_deleted')
      }
      this.database.deepchatSearchDocumentsTable.delete(`message:${messageId}`)
      this.database.deepchatAssistantBlocksTable.delete(messageId)
      this.database.deepchatUserMessageLinksTable.delete(messageId)
      this.database.deepchatUserMessageFilesTable.delete(messageId)
      this.database.deepchatUserMessagesTable.delete(messageId)
      this.database.deepchatMessageTracesTable.deleteByMessageIds([messageId])
      this.database.deepchatMessageSearchResultsTable.deleteByMessageIds([messageId])
      this.database.deepchatMessagesTable.delete(messageId)
    })
  }

  deleteFromOrderSeq(sessionId: string, fromOrderSeq: number): void {
    this.runInDatabaseTransaction(() => {
      const records = this.getMessages(sessionId).filter(
        (record) => record.orderSeq >= fromOrderSeq
      )
      for (const record of records) {
        this.tapeFacts.appendMessageRetraction(record, 'messages_deleted_from_order_seq')
      }
      const messageIds = records.map((record) => record.id)
      if (messageIds.length > 0) {
        this.database.deepchatSearchDocumentsTable.deleteByMessageIds(messageIds)
        this.database.deepchatAssistantBlocksTable.deleteByMessageIds(messageIds)
        this.database.deepchatUserMessageLinksTable.deleteByMessageIds(messageIds)
        this.database.deepchatUserMessageFilesTable.deleteByMessageIds(messageIds)
        this.database.deepchatUserMessagesTable.deleteByMessageIds(messageIds)
        this.database.deepchatMessageTracesTable.deleteByMessageIds(messageIds)
        this.database.deepchatMessageSearchResultsTable.deleteByMessageIds(messageIds)
      }
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
      .filter((row) => row.status === 'sent')
    const sourceRecords = this.toRecords(sourceRows)

    let nextOrderSeq = 1
    for (const record of sourceRecords) {
      const nextId = nanoid()
      this.database.deepchatMessagesTable.insert({
        id: nextId,
        sessionId: targetSessionId,
        orderSeq: nextOrderSeq,
        role: record.role,
        content: record.content,
        status: 'sent',
        isContextEdge: record.isContextEdge,
        metadata: record.metadata
      })
      if (record.role === 'user') {
        const userContent = this.parseUserContent(record.content)
        if (userContent) {
          this.persistUserContent(nextId, userContent)
        }
      } else {
        this.database.deepchatAssistantBlocksTable.replaceForMessage(
          nextId,
          this.parseAssistantBlocks(record.content)
        )
      }
      this.upsertMessageSearchDocument(
        targetSessionId,
        nextId,
        record.role,
        record.content,
        record.updatedAt
      )
      nextOrderSeq += 1
    }

    return sourceRecords.length
  }

  recoverPendingMessages(): number {
    const pendingRows = this.database.deepchatMessagesTable.getByStatus('pending')
    const recoveredRecords = new Map(
      this.toRecords(pendingRows).map((record) => [record.id, record])
    )
    let recoveredCount = 0
    for (const row of pendingRows) {
      if (this.shouldKeepPending(row)) {
        continue
      }
      if (row.role === 'assistant') {
        const blocks = this.parseAssistantBlocks(
          recoveredRecords.get(row.id)?.content ?? row.content
        )
        const recoveredBlocks = buildTerminalErrorBlocks(blocks, 'common.error.sessionInterrupted')
        this.database.deepchatAssistantBlocksTable.replaceForMessage(row.id, recoveredBlocks)
        this.database.deepchatMessagesTable.updateContentAndStatus(
          row.id,
          JSON.stringify(recoveredBlocks),
          'error'
        )
      } else {
        this.database.deepchatMessagesTable.updateStatus(row.id, 'error')
      }
      recoveredCount += 1
    }
    return recoveredCount
  }

  backfillMessageRow(row: DeepChatMessageRow): void {
    if (row.role === 'user') {
      const content = this.parseUserContent(row.content)
      if (content) {
        this.persistUserContent(row.id, content)
      }
    } else {
      this.database.deepchatAssistantBlocksTable.replaceForMessage(
        row.id,
        this.parseAssistantBlocks(row.content)
      )
    }

    if (row.status === 'sent' || row.status === 'error') {
      this.upsertMessageSearchDocument(
        row.session_id,
        row.id,
        row.role,
        this.materializeContent(row),
        row.updated_at
      )
    }
  }

  private shouldKeepPending(row: DeepChatMessageRow): boolean {
    if (row.role !== 'assistant') {
      return false
    }
    const blocks = this.parseAssistantBlocks(this.materializeContent(row))
    return blocks.some(
      (block) =>
        block.type === 'action' &&
        (block.action_type === 'tool_call_permission' ||
          block.action_type === 'question_request') &&
        block.status === 'pending' &&
        block.extra?.needsUserAction !== false
    )
  }

  private appendLiveTapeFacts(messageId: string): void {
    const record = this.getMessage(messageId)
    if (!record) {
      return
    }
    this.tapeFacts.appendMessageRecord(record)
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

      const rawUserContent = this.parseUserContent(row.content)
      const activeSkills = rawUserContent?.activeSkills ?? []
      const inlineItems = rawUserContent?.inlineItems ?? []
      return JSON.stringify({
        text: userRow.text,
        files: fileRows.map((fileRow) => this.toMessageFile(fileRow)),
        links: linkRows.map((linkRow) => linkRow.url),
        search: userRow.search_enabled === 1,
        think: userRow.think_enabled === 1,
        ...(activeSkills.length > 0 ? { activeSkills } : {}),
        ...(inlineItems.length > 0 ? { inlineItems } : {})
      } satisfies UserMessageContent)
    }

    const assistantRows = maps
      ? (maps.assistantRows.get(row.id) ?? [])
      : this.database.deepchatAssistantBlocksTable.listByMessageId(row.id)
    if (assistantRows.length === 0) {
      return row.content
    }

    return JSON.stringify(assistantRows.map((blockRow) => this.toAssistantBlock(blockRow)))
  }

  private parseAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
    try {
      const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private parseUserContent(rawContent: string): UserMessageContent | null {
    try {
      const parsed = JSON.parse(rawContent) as Partial<UserMessageContent>
      if (!parsed || typeof parsed !== 'object') {
        return null
      }

      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        files: Array.isArray(parsed.files) ? (parsed.files.filter(Boolean) as MessageFile[]) : [],
        links: Array.isArray(parsed.links)
          ? parsed.links.filter((item): item is string => typeof item === 'string')
          : [],
        search: parsed.search === true,
        think: parsed.think === true,
        activeSkills: this.normalizeActiveSkills(parsed.activeSkills),
        inlineItems: Array.isArray(parsed.inlineItems) ? parsed.inlineItems : []
      }
    } catch {
      return null
    }
  }

  private normalizeActiveSkills(activeSkills?: string[]): string[] {
    if (!Array.isArray(activeSkills)) {
      return []
    }

    return Array.from(
      new Set(
        activeSkills
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      )
    )
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

  private persistUserContent(messageId: string, content: UserMessageContent): void {
    this.database.deepchatUserMessagesTable.upsert({
      messageId,
      text: content.text,
      searchEnabled: content.search === true,
      thinkEnabled: content.think === true
    })
    this.database.deepchatUserMessageFilesTable.replaceForMessage(
      messageId,
      content.files.map((file) => ({
        name: file.name,
        path: file.path,
        mimeType: file.mimeType ?? file.type,
        size: file.size,
        metadataJson: JSON.stringify({
          type: file.type,
          content: file.content,
          token: file.token,
          thumbnail: file.thumbnail,
          metadata: file.metadata,
          requestedRepresentation: normalizeAttachmentRepresentationPreference(
            file.requestedRepresentation
          ),
          resolvedRepresentation: normalizeAttachmentResolvedRepresentation(
            file.resolvedRepresentation
          )
        })
      }))
    )
    this.database.deepchatUserMessageLinksTable.replaceForMessage(messageId, content.links)
  }

  private toMessageFile(row: DeepChatUserMessageFileRow): MessageFile {
    const extra = this.parseJson<Record<string, unknown>>(row.metadata_json, {})
    return {
      name: row.name ?? '',
      path: row.path,
      type: typeof extra.type === 'string' ? extra.type : (row.mime_type ?? undefined),
      size: row.size ?? undefined,
      content: typeof extra.content === 'string' ? extra.content : undefined,
      mimeType: row.mime_type ?? undefined,
      token: typeof extra.token === 'number' ? extra.token : undefined,
      thumbnail: typeof extra.thumbnail === 'string' ? extra.thumbnail : undefined,
      requestedRepresentation: normalizeAttachmentRepresentationPreference(
        extra.requestedRepresentation
      ),
      resolvedRepresentation: normalizeAttachmentResolvedRepresentation(
        extra.resolvedRepresentation
      ),
      metadata:
        extra.metadata && typeof extra.metadata === 'object' && !Array.isArray(extra.metadata)
          ? (extra.metadata as MessageFile['metadata'])
          : undefined
    }
  }

  private toAssistantBlock(row: DeepChatAssistantBlockRow): AssistantMessageBlock {
    const extra = this.parseJson<{
      id?: string
      timestamp?: number
      imageData?: string
      extra?: AssistantMessageBlock['extra']
      toolCallExtra?: Record<string, unknown>
      reasoningTime?: number
    }>(row.extra_json, {})

    const toolCall =
      row.tool_call_id ||
      row.tool_name ||
      row.tool_params ||
      row.tool_response ||
      extra.toolCallExtra
        ? {
            ...extra.toolCallExtra,
            id: row.tool_call_id ?? undefined,
            name: row.tool_name ?? undefined,
            params: row.tool_params ?? undefined,
            response: row.tool_response ?? undefined
          }
        : undefined

    const reasoningTime =
      typeof extra.reasoningTime === 'number'
        ? extra.reasoningTime
        : row.reasoning_start_at !== null && row.reasoning_end_at !== null
          ? {
              start: row.reasoning_start_at,
              end: row.reasoning_end_at
            }
          : undefined

    const imageData = extra.imageData?.trim()
    const actionType = normalizePersistedActionType(row.action_type)

    return {
      id: extra.id,
      type: row.block_type as AssistantMessageBlock['type'],
      content: row.text_content ?? undefined,
      status: row.status as AssistantMessageBlock['status'],
      timestamp: extra.timestamp ?? row.updated_at,
      reasoning_time: reasoningTime,
      image_data:
        imageData && row.image_mime_type
          ? {
              data: imageData,
              mimeType: row.image_mime_type
            }
          : undefined,
      tool_call: toolCall as AssistantMessageBlock['tool_call'],
      extra: extra.extra,
      ...(actionType ? { action_type: actionType } : {})
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

  private upsertAssistantSearchDocument(messageId: string, blocks: AssistantMessageBlock[]): void {
    const messageRow = this.database.deepchatMessagesTable.get(messageId)
    if (!messageRow) {
      return
    }

    this.upsertMessageSearchDocument(
      messageRow.session_id,
      messageId,
      'assistant',
      JSON.stringify(blocks),
      messageRow.updated_at
    )
  }

  private upsertMessageSearchDocument(
    sessionId: string,
    messageId: string,
    role: 'user' | 'assistant',
    rawContent: string,
    updatedAt: number = Date.now()
  ): void {
    const sessionTitle = this.database.newSessionsTable.get(sessionId)?.title ?? ''
    this.database.deepchatSearchDocumentsTable.upsert({
      documentKey: `message:${messageId}`,
      sessionId,
      messageId,
      documentKind: 'message',
      role,
      title: sessionTitle,
      content: extractSearchableMessageContent(rawContent),
      updatedAt
    })
  }

  private parseJson<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) {
      return fallback
    }

    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  private persistUsageStats(
    messageId: string,
    metadataRaw: string,
    source: 'backfill' | 'live'
  ): void {
    const usageStatsTable = this.database.deepchatUsageStatsTable
    const messageRow = this.database.deepchatMessagesTable.get(messageId)
    if (!messageRow || messageRow.role !== 'assistant') {
      return
    }

    try {
      const metadata = parseMessageMetadata(metadataRaw)
      if (metadata.messageType === 'compaction') {
        return
      }

      const sessionRow = this.database.deepchatSessionsTable.get(messageRow.session_id)
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
