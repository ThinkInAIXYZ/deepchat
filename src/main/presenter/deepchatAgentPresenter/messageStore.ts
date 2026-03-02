import { nanoid } from 'nanoid'
import { SQLitePresenter } from '../sqlitePresenter'
import type {
  ChatMessageRecord,
  UserMessageContent,
  AssistantMessageBlock
} from '@shared/types/agent-interface'
import type { DeepChatMessageRow } from '../sqlitePresenter/tables/deepchatMessages'

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
    const pendingRows = this.sqlitePresenter.deepchatMessagesTable.getByStatus('pending')
    let recoveredCount = 0
    for (const row of pendingRows) {
      if (this.shouldKeepPending(row)) {
        continue
      }
      this.sqlitePresenter.deepchatMessagesTable.updateStatus(row.id, 'error')
      recoveredCount += 1
    }
    return recoveredCount
  }

  private shouldKeepPending(row: DeepChatMessageRow): boolean {
    if (row.role !== 'assistant') {
      return false
    }
    try {
      const blocks = JSON.parse(row.content) as AssistantMessageBlock[]
      if (!Array.isArray(blocks)) {
        return false
      }
      return blocks.some(
        (block) =>
          block.type === 'action' &&
          (block.action_type === 'tool_call_permission' ||
            block.action_type === 'question_request') &&
          block.status === 'pending' &&
          block.extra?.needsUserAction !== false
      )
    } catch {
      return false
    }
  }
}
