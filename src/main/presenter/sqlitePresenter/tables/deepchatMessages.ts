import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface DeepChatMessageRow {
  id: string
  session_id: string
  order_seq: number
  role: 'user' | 'assistant'
  content: string
  status: 'pending' | 'sent' | 'error'
  is_context_edge: number
  metadata: string
  created_at: number
  updated_at: number
  trace_count?: number
}

export interface DeepChatMessageUsageCandidateRow {
  id: string
  session_id: string
  metadata: string
  created_at: number
  updated_at: number
  provider_id: string | null
  model_id: string | null
}

export class DeepChatMessagesTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_messages')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        order_seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        is_context_edge INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deepchat_messages_session ON deepchat_messages(session_id, order_seq);
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  insert(row: {
    id: string
    sessionId: string
    orderSeq: number
    role: 'user' | 'assistant'
    content: string
    status: 'pending' | 'sent' | 'error'
    isContextEdge?: number
    metadata?: string
    createdAt?: number
    updatedAt?: number
  }): void {
    const now = Date.now()
    const createdAt = row.createdAt ?? now
    const updatedAt = row.updatedAt ?? createdAt
    this.db
      .prepare(
        `INSERT INTO deepchat_messages (
           id,
           session_id,
           order_seq,
           role,
           content,
           status,
           is_context_edge,
           metadata,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.sessionId,
        row.orderSeq,
        row.role,
        row.content,
        row.status,
        row.isContextEdge ?? 0,
        row.metadata ?? '{}',
        createdAt,
        updatedAt
      )
  }

  updateContent(messageId: string, content: string): void {
    this.db
      .prepare('UPDATE deepchat_messages SET content = ?, updated_at = ? WHERE id = ?')
      .run(content, Date.now(), messageId)
  }

  updateStatus(messageId: string, status: 'pending' | 'sent' | 'error'): void {
    this.db
      .prepare('UPDATE deepchat_messages SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), messageId)
  }

  updateContentAndStatus(
    messageId: string,
    content: string,
    status: 'sent' | 'error',
    metadata?: string
  ): void {
    const parts = ['content = ?', 'status = ?', 'updated_at = ?']
    const params: unknown[] = [content, status, Date.now()]

    if (metadata !== undefined) {
      parts.push('metadata = ?')
      params.push(metadata)
    }

    params.push(messageId)
    this.db.prepare(`UPDATE deepchat_messages SET ${parts.join(', ')} WHERE id = ?`).run(...params)
  }

  getBySession(sessionId: string): DeepChatMessageRow[] {
    return this.db
      .prepare(
        `SELECT
           m.*,
           COALESCE(t.trace_count, 0) AS trace_count
         FROM deepchat_messages m
         LEFT JOIN (
           SELECT message_id, COUNT(*) AS trace_count
           FROM deepchat_message_traces
           GROUP BY message_id
         ) t
           ON t.message_id = m.id
         WHERE m.session_id = ?
         ORDER BY m.order_seq`
      )
      .all(sessionId) as DeepChatMessageRow[]
  }

  getBySessionUpToOrderSeq(sessionId: string, maxOrderSeq: number): DeepChatMessageRow[] {
    return this.db
      .prepare(
        'SELECT * FROM deepchat_messages WHERE session_id = ? AND order_seq <= ? ORDER BY order_seq'
      )
      .all(sessionId, maxOrderSeq) as DeepChatMessageRow[]
  }

  getByStatus(status: 'pending' | 'sent' | 'error'): DeepChatMessageRow[] {
    return this.db
      .prepare('SELECT * FROM deepchat_messages WHERE status = ? ORDER BY updated_at DESC')
      .all(status) as DeepChatMessageRow[]
  }

  getIdsBySession(sessionId: string): string[] {
    const rows = this.db
      .prepare('SELECT id FROM deepchat_messages WHERE session_id = ? ORDER BY order_seq')
      .all(sessionId) as { id: string }[]
    return rows.map((r) => r.id)
  }

  get(messageId: string): DeepChatMessageRow | undefined {
    return this.db
      .prepare(
        `SELECT
           m.*,
           COALESCE((
             SELECT COUNT(*)
             FROM deepchat_message_traces t
             WHERE t.message_id = m.id
           ), 0) AS trace_count
         FROM deepchat_messages m
         WHERE m.id = ?`
      )
      .get(messageId) as DeepChatMessageRow | undefined
  }

  getMaxOrderSeq(sessionId: string): number {
    const row = this.db
      .prepare('SELECT MAX(order_seq) as max_seq FROM deepchat_messages WHERE session_id = ?')
      .get(sessionId) as { max_seq: number | null }
    return row.max_seq ?? 0
  }

  listAssistantUsageCandidates(): DeepChatMessageUsageCandidateRow[] {
    return this.db
      .prepare(
        `SELECT
          m.id,
          m.session_id,
          m.metadata,
          m.created_at,
          m.updated_at,
          s.provider_id,
          s.model_id
        FROM deepchat_messages m
        LEFT JOIN deepchat_sessions s
          ON s.id = m.session_id
        WHERE m.role = 'assistant'
        ORDER BY m.created_at ASC`
      )
      .all() as DeepChatMessageUsageCandidateRow[]
  }

  getLastUserMessageBeforeOrAtOrderSeq(
    sessionId: string,
    orderSeq: number
  ): DeepChatMessageRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM deepchat_messages WHERE session_id = ? AND role = 'user' AND order_seq <= ? ORDER BY order_seq DESC LIMIT 1"
      )
      .get(sessionId, orderSeq) as DeepChatMessageRow | undefined
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM deepchat_messages WHERE session_id = ?').run(sessionId)
  }

  delete(messageId: string): void {
    this.db.prepare('DELETE FROM deepchat_messages WHERE id = ?').run(messageId)
  }

  deleteFromOrderSeq(sessionId: string, fromOrderSeq: number): void {
    this.db
      .prepare('DELETE FROM deepchat_messages WHERE session_id = ? AND order_seq >= ?')
      .run(sessionId, fromOrderSeq)
  }

  getIdsFromOrderSeq(sessionId: string, fromOrderSeq: number): string[] {
    const rows = this.db
      .prepare('SELECT id FROM deepchat_messages WHERE session_id = ? AND order_seq >= ?')
      .all(sessionId, fromOrderSeq) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  recoverPendingMessages(): number {
    const result = this.db
      .prepare(
        "UPDATE deepchat_messages SET status = 'error', updated_at = ? WHERE status = 'pending'"
      )
      .run(Date.now())
    return result.changes
  }
}
