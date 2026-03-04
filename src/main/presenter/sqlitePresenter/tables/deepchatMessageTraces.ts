import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface DeepChatMessageTraceRow {
  id: string
  message_id: string
  session_id: string
  provider_id: string
  model_id: string
  request_seq: number
  endpoint: string
  headers_json: string
  body_json: string
  truncated: number
  created_at: number
}

export class DeepChatMessageTracesTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_message_traces')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_message_traces (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        request_seq INTEGER NOT NULL,
        endpoint TEXT NOT NULL,
        headers_json TEXT NOT NULL,
        body_json TEXT NOT NULL,
        truncated INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trace_message_seq
        ON deepchat_message_traces(message_id, request_seq DESC);
      CREATE INDEX IF NOT EXISTS idx_trace_session_time
        ON deepchat_message_traces(session_id, created_at DESC);
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === 13) {
      return this.getCreateTableSQL()
    }
    return null
  }

  getLatestVersion(): number {
    return 13
  }

  insert(row: {
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
    const tx = this.db.transaction((insertRow: typeof row) => {
      const nextSeqRow = this.db
        .prepare(
          'SELECT COALESCE(MAX(request_seq), 0) + 1 AS next_seq FROM deepchat_message_traces WHERE message_id = ?'
        )
        .get(insertRow.messageId) as { next_seq: number }

      const requestSeq = nextSeqRow.next_seq
      this.db
        .prepare(
          `INSERT INTO deepchat_message_traces (
             id,
             message_id,
             session_id,
             provider_id,
             model_id,
             request_seq,
             endpoint,
             headers_json,
             body_json,
             truncated,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          insertRow.id,
          insertRow.messageId,
          insertRow.sessionId,
          insertRow.providerId,
          insertRow.modelId,
          requestSeq,
          insertRow.endpoint,
          insertRow.headersJson,
          insertRow.bodyJson,
          insertRow.truncated ? 1 : 0,
          insertRow.createdAt ?? Date.now()
        )

      return requestSeq
    })

    return tx(row)
  }

  listByMessageId(messageId: string): DeepChatMessageTraceRow[] {
    return this.db
      .prepare(
        'SELECT * FROM deepchat_message_traces WHERE message_id = ? ORDER BY request_seq DESC'
      )
      .all(messageId) as DeepChatMessageTraceRow[]
  }

  countByMessageId(messageId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM deepchat_message_traces WHERE message_id = ?')
      .get(messageId) as { count: number }
    return row.count
  }

  deleteByMessageId(messageId: string): void {
    this.db.prepare('DELETE FROM deepchat_message_traces WHERE message_id = ?').run(messageId)
  }

  deleteByMessageIds(messageIds: string[]): void {
    if (messageIds.length === 0) return
    const placeholders = messageIds.map(() => '?').join(', ')
    this.db
      .prepare(`DELETE FROM deepchat_message_traces WHERE message_id IN (${placeholders})`)
      .run(...messageIds)
  }

  deleteBySessionId(sessionId: string): void {
    this.db.prepare('DELETE FROM deepchat_message_traces WHERE session_id = ?').run(sessionId)
  }
}
