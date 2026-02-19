import { nanoid } from 'nanoid'
import { SQLitePresenter } from '../sqlitePresenter'
import type {
  ChatMessageRecord,
  UserMessageContent,
  AssistantMessageBlock
} from '@shared/types/agent-interface'

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

  updateAssistantContent(messageId: string, blocks: AssistantMessageBlock[]): void {
    this.sqlitePresenter.deepchatMessagesTable.updateContent(messageId, JSON.stringify(blocks))
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
  }

  setMessageError(messageId: string, blocks: AssistantMessageBlock[]): void {
    this.sqlitePresenter.deepchatMessagesTable.updateContentAndStatus(
      messageId,
      JSON.stringify(blocks),
      'error'
    )
  }

  getMessages(sessionId: string): ChatMessageRecord[] {
    const rows = this.sqlitePresenter.deepchatMessagesTable.getBySession(sessionId)
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      orderSeq: row.order_seq,
      role: row.role,
      content: row.content,
      status: row.status,
      isContextEdge: row.is_context_edge,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  getMessageIds(sessionId: string): string[] {
    return this.sqlitePresenter.deepchatMessagesTable.getIdsBySession(sessionId)
  }

  getMessage(messageId: string): ChatMessageRecord | null {
    const row = this.sqlitePresenter.deepchatMessagesTable.get(messageId)
    if (!row) return null
    return {
      id: row.id,
      sessionId: row.session_id,
      orderSeq: row.order_seq,
      role: row.role,
      content: row.content,
      status: row.status,
      isContextEdge: row.is_context_edge,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  getNextOrderSeq(sessionId: string): number {
    return this.sqlitePresenter.deepchatMessagesTable.getMaxOrderSeq(sessionId) + 1
  }

  deleteBySession(sessionId: string): void {
    this.sqlitePresenter.deepchatMessagesTable.deleteBySession(sessionId)
  }

  recoverPendingMessages(): number {
    return this.sqlitePresenter.deepchatMessagesTable.recoverPendingMessages()
  }
}
