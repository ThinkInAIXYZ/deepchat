import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface DeepChatUserMessageRow {
  message_id: string
  text: string
  search_enabled: number
  think_enabled: number
}

const NORMALIZATION_SCHEMA_VERSION = 26

export class DeepChatUserMessagesTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_user_messages')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_user_messages (
        message_id TEXT PRIMARY KEY,
        text TEXT NOT NULL DEFAULT '',
        search_enabled INTEGER NOT NULL DEFAULT 0,
        think_enabled INTEGER NOT NULL DEFAULT 0
      );
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === NORMALIZATION_SCHEMA_VERSION) {
      return this.getCreateTableSQL()
    }
    return null
  }

  getLatestVersion(): number {
    return NORMALIZATION_SCHEMA_VERSION
  }

  upsert(row: {
    messageId: string
    text: string
    searchEnabled: boolean
    thinkEnabled: boolean
  }): void {
    this.db
      .prepare(
        `INSERT INTO deepchat_user_messages (
          message_id,
          text,
          search_enabled,
          think_enabled
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET
          text = excluded.text,
          search_enabled = excluded.search_enabled,
          think_enabled = excluded.think_enabled`
      )
      .run(row.messageId, row.text, row.searchEnabled ? 1 : 0, row.thinkEnabled ? 1 : 0)
  }

  get(messageId: string): DeepChatUserMessageRow | undefined {
    return this.db
      .prepare('SELECT * FROM deepchat_user_messages WHERE message_id = ?')
      .get(messageId) as DeepChatUserMessageRow | undefined
  }

  listByMessageIds(messageIds: string[]): DeepChatUserMessageRow[] {
    if (messageIds.length === 0) {
      return []
    }

    const placeholders = messageIds.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT * FROM deepchat_user_messages WHERE message_id IN (${placeholders}) ORDER BY message_id`
      )
      .all(...messageIds) as DeepChatUserMessageRow[]
  }

  delete(messageId: string): void {
    this.db.prepare('DELETE FROM deepchat_user_messages WHERE message_id = ?').run(messageId)
  }

  deleteByMessageIds(messageIds: string[]): void {
    if (messageIds.length === 0) {
      return
    }

    const placeholders = messageIds.map(() => '?').join(', ')
    this.db
      .prepare(`DELETE FROM deepchat_user_messages WHERE message_id IN (${placeholders})`)
      .run(...messageIds)
  }

  deleteBySession(sessionId: string): void {
    this.db
      .prepare(
        `DELETE FROM deepchat_user_messages
         WHERE message_id IN (
           SELECT id FROM deepchat_messages WHERE session_id = ?
         )`
      )
      .run(sessionId)
  }
}
