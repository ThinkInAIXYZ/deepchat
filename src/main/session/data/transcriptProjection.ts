import type { ChatMessageRecord, UserMessageContent } from '@shared/types/agent-interface'
import { getAttachmentSearchableText } from '@shared/utils/attachmentRepresentation'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import {
  parseTapeJsonObject,
  TAPE_MESSAGE_RETRACTED_EVENT_NAME,
  tapeEntryToMessageRecord
} from '@/tape/domain/effectiveSemantics'
import type { SessionDatabase } from './database'
import { parseAssistantBlocks, parseUserContent, toUserMessageFileRowInput } from './messageContent'

const MAX_SEARCHABLE_ATTACHMENT_CHARACTERS = 32_000
const SEARCH_ATTACHMENT_TRUNCATION_MARKER = '[Attachment search text truncated]'

/**
 * Writes terminal message state into the transcript tables from a `ChatMessageRecord`. The record
 * is the one carried by the message fact, so live writes and replay from Tape run the same code
 * and cannot leave a table behind. Every write is an UPSERT or a replace keyed by message id;
 * nothing here deletes a row except `applyRetractions`, and nothing here opens a transaction.
 *
 * Usage stats are not part of the projection. They count provider calls, and a record reaches the
 * applier again on fork, import, recovery and replay without any call having happened; the
 * assistant terminal writes record usage themselves.
 */
export class TranscriptProjectionApplier {
  constructor(private readonly database: SessionDatabase) {}

  applyRecord(record: ChatMessageRecord): void {
    this.database.deepchatMessagesTable.upsert({
      id: record.id,
      sessionId: record.sessionId,
      orderSeq: record.orderSeq,
      role: record.role,
      content: record.content,
      status: record.status,
      isContextEdge: record.isContextEdge,
      metadata: record.metadata,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    })

    if (record.role === 'user') {
      const content = parseUserContent(record.content)
      if (content) {
        this.persistUserContent(record.id, content)
      } else {
        // Nothing structured to derive: drop what an earlier record left so the read path falls
        // back to the content column instead of showing the previous message.
        this.database.deepchatUserMessageLinksTable.deleteByMessageIds([record.id])
        this.database.deepchatUserMessageFilesTable.deleteByMessageIds([record.id])
        this.database.deepchatUserMessagesTable.deleteByMessageIds([record.id])
      }
      this.upsertSearchDocument(record)
      return
    }

    this.database.deepchatAssistantBlocksTable.replaceForMessage(
      record.id,
      parseAssistantBlocks(record.content),
      record.updatedAt
    )
    if (record.status !== 'pending') {
      this.upsertSearchDocument(record)
    }
  }

  /**
   * Replays message facts and retractions the Tape holds past the projection cursor, in entry
   * order. Compaction indicator events are left to `reconcileCompactionMessages`, which settles
   * marker rows from the reconstruction anchor.
   */
  applyTapeEntries(rows: readonly DeepChatTapeEntryRow[]): void {
    for (const row of rows) {
      if (row.kind === 'message') {
        const record = tapeEntryToMessageRecord(row)
        if (record) this.applyRecord(record)
        continue
      }
      if (row.kind === 'event' && row.name === TAPE_MESSAGE_RETRACTED_EVENT_NAME) {
        const data = parseTapeJsonObject(row.payload_json).data
        const messageId =
          data && typeof data === 'object' && !Array.isArray(data)
            ? (data as { messageId?: unknown }).messageId
            : undefined
        if (typeof messageId === 'string' && messageId) {
          this.applyRetractions([messageId])
        }
      }
    }
  }

  /**
   * Removes every message-scoped row, including the runtime sidecars keyed by message id. A range
   * delete can hand over a whole Session, so the ids go through in chunks that stay below SQLite's
   * bound-variable floor on every table.
   */
  applyRetractions(messageIds: string[]): void {
    for (let offset = 0; offset < messageIds.length; offset += 500) {
      const chunk = messageIds.slice(offset, offset + 500)
      this.database.deepchatSearchDocumentsTable.deleteByMessageIds(chunk)
      this.database.deepchatAssistantBlocksTable.deleteByMessageIds(chunk)
      this.database.deepchatUserMessageLinksTable.deleteByMessageIds(chunk)
      this.database.deepchatUserMessageFilesTable.deleteByMessageIds(chunk)
      this.database.deepchatUserMessagesTable.deleteByMessageIds(chunk)
      this.database.deepchatMessageTracesTable.deleteByMessageIds(chunk)
      this.database.deepchatMessageSearchResultsTable.deleteByMessageIds(chunk)
      this.database.deepchatMessagesTable.deleteByIds(chunk)
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
      content.files.map((file) => toUserMessageFileRowInput(file))
    )
    this.database.deepchatUserMessageLinksTable.replaceForMessage(messageId, content.links)
  }

  private upsertSearchDocument(record: ChatMessageRecord): void {
    const sessionTitle = this.database.newSessionsTable.get(record.sessionId)?.title ?? ''
    this.database.deepchatSearchDocumentsTable.upsert({
      documentKey: `message:${record.id}`,
      sessionId: record.sessionId,
      messageId: record.id,
      documentKind: 'message',
      role: record.role,
      title: sessionTitle,
      content: extractSearchableMessageContent(record.content),
      updatedAt: record.updatedAt
    })
  }
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
      const searchableAttachmentText = buildSearchableAttachmentText(parsed.files)
      if (searchableAttachmentText) segments.push(searchableAttachmentText)
      return segments.join('\n')
    }
  } catch {
    // Plain-text fallback.
  }

  return rawContent.trim()
}

function buildSearchableAttachmentText(files: unknown): string {
  if (!Array.isArray(files)) return ''
  const text = files
    .flatMap((file) => {
      const searchableText = getAttachmentSearchableText(file).trim()
      return searchableText ? [searchableText] : []
    })
    .join('\n')
  if (text.length <= MAX_SEARCHABLE_ATTACHMENT_CHARACTERS) return text

  const marker = `\n${SEARCH_ATTACHMENT_TRUNCATION_MARKER}\n`
  const retainedCharacters = Math.max(
    0,
    Math.floor((MAX_SEARCHABLE_ATTACHMENT_CHARACTERS - marker.length) / 2)
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
