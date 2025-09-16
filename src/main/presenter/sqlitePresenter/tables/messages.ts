import { Database } from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'
import { SQLITE_MESSAGE } from '@shared/presenter'
import { nanoid } from 'nanoid'

export class MessagesTable extends BaseTable {
  constructor(db: Database) {
    super(db, 'messages')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        msg_id TEXT UNIQUE NOT NULL,
        conversation_id TEXT NOT NULL,
        parent_id TEXT DEFAULT '',
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'function')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        order_seq INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'pending', 'error')),
        metadata TEXT,
        is_context_edge INTEGER DEFAULT 0,
        is_variant INTEGER DEFAULT 0,
        FOREIGN KEY(conversation_id) REFERENCES conversations(conv_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_messages_session ON messages(conversation_id, order_seq);
      CREATE INDEX idx_message_timeline ON messages(created_at DESC);
      CREATE INDEX idx_message_context_edge ON messages(is_context_edge);
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  createTable(): void {
    if (!this.tableExists()) {
      this.db.exec(this.getCreateTableSQL())
    }
  }

  async insert(
    conversationId: string,
    content: string,
    role: string,
    parentId: string,
    metadata: string = '{}',
    orderSeq: number = 0,
    tokenCount: number = 0,
    status: string = 'pending',
    isContextEdge: number = 0,
    isVariant: number = 0
  ): Promise<string> {
    const insert = this.db.prepare(`
      INSERT INTO messages (
        msg_id,
        conversation_id,
        parent_id,
        content,
        role,
        created_at,
        order_seq,
        token_count,
        status,
        metadata,
        is_context_edge,
        is_variant
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const msgId = nanoid()
    insert.run(
      msgId,
      conversationId,
      parentId,
      content,
      role,
      Date.now(),
      orderSeq,
      tokenCount,
      status,
      metadata,
      isContextEdge,
      isVariant
    )
    return msgId
  }

  async update(
    messageId: string,
    data: {
      content?: string
      status?: string
      metadata?: string
      isContextEdge?: number
      tokenCount?: number
    }
  ): Promise<void> {
    const updates: string[] = []
    const params: (string | number)[] = []

    if (data.content !== undefined) {
      updates.push('content = ?')
      params.push(data.content)
    }
    if (data.status !== undefined) {
      updates.push('status = ?')
      params.push(data.status)
    }
    if (data.metadata !== undefined) {
      updates.push('metadata = ?')
      params.push(data.metadata)
    }
    if (data.isContextEdge !== undefined) {
      updates.push('is_context_edge = ?')
      params.push(data.isContextEdge)
    }
    if (data.tokenCount !== undefined) {
      updates.push('token_count = ?')
      params.push(data.tokenCount)
    }

    if (updates.length > 0) {
      const updateStmt = this.db.prepare(`
        UPDATE messages
        SET ${updates.join(', ')}
        WHERE msg_id = ?
      `)
      params.push(messageId)
      updateStmt.run(...params)
    }
  }

  async updateParentId(messageId: string, parentId: string): Promise<void> {
    const updateStmt = this.db.prepare(`
      UPDATE messages
      SET parent_id = ?
      WHERE msg_id = ?
    `)
    updateStmt.run(parentId, messageId)
  }

  async delete(messageId: string): Promise<void> {
    const deleteStmt = this.db.prepare('DELETE FROM messages WHERE msg_id = ?')
    deleteStmt.run(messageId)
  }

  async deleteAll(): Promise<void> {
    const deleteStmt = this.db.prepare('DELETE FROM messages')
    deleteStmt.run()
  }

  async deleteAllInConversation(conversationId: string): Promise<void> {
    const deleteStmt = this.db.prepare('DELETE FROM messages WHERE conversation_id = ?')
    deleteStmt.run(conversationId)
  }

  async get(messageId: string): Promise<SQLITE_MESSAGE | null> {
    return this.db
      .prepare(
        `
        SELECT
          msg_id as id,
          conversation_id,
          parent_id,
          content,
          role,
          created_at,
          order_seq,
          token_count,
          status,
          metadata,
          is_context_edge,
          is_variant
        FROM messages
        WHERE msg_id = ?
      `
      )
      .get(messageId) as SQLITE_MESSAGE | null
  }

  async getVariants(messageId: string): Promise<SQLITE_MESSAGE[]> {
    return this.db
      .prepare(
        `
        SELECT
          msg_id as id,
          conversation_id,
          parent_id,
          content,
          role,
          created_at,
          order_seq,
          token_count,
          status,
          metadata,
          is_context_edge,
          is_variant
        FROM messages
        WHERE parent_id = ?
        ORDER BY created_at ASC
      `
      )
      .all(messageId) as SQLITE_MESSAGE[]
  }

  async getMaxOrderSeq(conversationId: string): Promise<number> {
    const result = this.db
      .prepare('SELECT MAX(order_seq) as maxSeq FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { maxSeq: number }
    return result.maxSeq || 0
  }

  async getLastUserMessage(conversationId: string): Promise<SQLITE_MESSAGE | null> {
    return this.db
      .prepare(
        `
        SELECT
          msg_id as id,
          conversation_id,
          parent_id,
          content,
          role,
          created_at,
          order_seq,
          token_count,
          status,
          metadata,
          is_context_edge,
          is_variant
        FROM messages
        WHERE conversation_id = ? AND role = 'user'
        ORDER BY created_at DESC
        LIMIT 1
      `
      )
      .get(conversationId) as SQLITE_MESSAGE | null
  }

  async getMainMessageByParentId(
    conversationId: string,
    parentId: string
  ): Promise<SQLITE_MESSAGE | null> {
    const mainMessage = this.db
      .prepare(
        `
        SELECT
          msg_id as id,
          conversation_id,
          parent_id,
          content,
          role,
          created_at,
          order_seq,
          token_count,
          status,
          metadata,
          is_context_edge,
          is_variant
        FROM messages
        WHERE conversation_id = ?
        AND parent_id = ?
        AND is_variant = 0
        ORDER BY created_at ASC
        LIMIT 1
      `
      )
      .get(conversationId, parentId) as SQLITE_MESSAGE | null

    if (mainMessage) {
      const variants = this.db
        .prepare(
          `
          SELECT
            msg_id as id,
            conversation_id,
            parent_id,
            content,
            role,
            created_at,
            order_seq,
            token_count,
            status,
            metadata,
            is_context_edge,
            is_variant
          FROM messages
          WHERE conversation_id = ?
          AND parent_id = ?
          AND is_variant = 1
          ORDER BY created_at ASC
        `
        )
        .all(conversationId, parentId) as SQLITE_MESSAGE[]

      mainMessage.variants = variants
    }

    return mainMessage
  }

  async query(conversationId: string): Promise<SQLITE_MESSAGE[]> {
    // 首先获取所有非变体消息
    const mainMessages = this.db
      .prepare(
        `
        SELECT
          msg_id as id,
          conversation_id,
          parent_id,
          content,
          role,
          created_at,
          order_seq,
          token_count,
          status,
          metadata,
          is_context_edge,
          is_variant
        FROM messages
        WHERE conversation_id = ? AND is_variant != 1
        ORDER BY created_at ASC, order_seq ASC
      `
      )
      .all(conversationId) as SQLITE_MESSAGE[]

    // 对于每个助手消息，获取其变体
    const getVariants = this.db.prepare(
      `
      SELECT
        msg_id as id,
        conversation_id,
        parent_id,
        content,
        role,
        created_at,
        order_seq,
        token_count,
        status,
        metadata,
        is_context_edge,
        is_variant
      FROM messages
      WHERE parent_id = ? AND is_variant = 1
      ORDER BY created_at ASC
    `
    )

    // 为每个助手消息添加变体
    return mainMessages.map((msg) => {
      if (msg.role === 'assistant' && msg.parent_id !== '') {
        const variants = getVariants.all(msg.parent_id) as SQLITE_MESSAGE[]
        if (variants.length > 0) {
          return {
            ...msg,
            variants
          }
        }
      }
      return msg
    })
  }
}
