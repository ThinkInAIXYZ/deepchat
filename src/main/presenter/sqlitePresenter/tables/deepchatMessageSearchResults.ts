import Database from 'better-sqlite3-multiple-ciphers'
import { nanoid } from 'nanoid'
import { BaseTable } from './baseTable'

export interface DeepChatMessageSearchResultRow {
  id: string
  session_id: string
  message_id: string
  search_id: string | null
  rank: number | null
  content: string
  dedupe_key: string
  created_at: number
}

export class DeepChatMessageSearchResultsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_message_search_results')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_message_search_results (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        search_id TEXT DEFAULT NULL,
        rank INTEGER DEFAULT NULL,
        content TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_search_results_message
        ON deepchat_message_search_results(message_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_search_results_message_search
        ON deepchat_message_search_results(message_id, search_id, rank);
      CREATE INDEX IF NOT EXISTS idx_search_results_session
        ON deepchat_message_search_results(session_id, created_at DESC);
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  add(row: {
    sessionId: string
    messageId: string
    searchId?: string | null
    rank?: number | null
    content: string
    createdAt?: number
  }): boolean {
    const normalizedSearchId = row.searchId?.trim() || null
    const normalizedRank = Number.isInteger(row.rank) ? (row.rank as number) : null
    const dedupeKey = this.buildDedupeKey(
      row.messageId,
      normalizedSearchId,
      normalizedRank,
      row.content
    )

    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO deepchat_message_search_results (
           id,
           session_id,
           message_id,
           search_id,
           rank,
           content,
           dedupe_key,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nanoid(),
        row.sessionId,
        row.messageId,
        normalizedSearchId,
        normalizedRank,
        row.content,
        dedupeKey,
        row.createdAt ?? Date.now()
      )

    return result.changes > 0
  }

  listByMessageId(messageId: string): DeepChatMessageSearchResultRow[] {
    return this.db
      .prepare(
        `SELECT * FROM deepchat_message_search_results
         WHERE message_id = ?
         ORDER BY created_at ASC, CASE WHEN rank IS NULL THEN 2147483647 ELSE rank END ASC`
      )
      .all(messageId) as DeepChatMessageSearchResultRow[]
  }

  deleteBySessionId(sessionId: string): void {
    this.db
      .prepare('DELETE FROM deepchat_message_search_results WHERE session_id = ?')
      .run(sessionId)
  }

  deleteByMessageIds(messageIds: string[]): void {
    if (messageIds.length === 0) return
    const placeholders = messageIds.map(() => '?').join(', ')
    this.db
      .prepare(`DELETE FROM deepchat_message_search_results WHERE message_id IN (${placeholders})`)
      .run(...messageIds)
  }

  private buildDedupeKey(
    messageId: string,
    searchId: string | null,
    rank: number | null,
    content: string
  ): string {
    return `${messageId}::${searchId ?? ''}::${rank ?? ''}::${content}`
  }
}
