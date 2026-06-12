import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface DeepChatUserMessageLinkRow {
  message_id: string
  ordinal: number
  url: string
}

const NORMALIZATION_SCHEMA_VERSION = 26

export class DeepChatUserMessageLinksTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_user_message_links')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_user_message_links (
        message_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        url TEXT NOT NULL,
        PRIMARY KEY (message_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS idx_deepchat_user_message_links_message
        ON deepchat_user_message_links(message_id, ordinal);
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

  replaceForMessage(messageId: string, links: string[]): void {
    const insert = this.db.prepare(
      `INSERT INTO deepchat_user_message_links (
        message_id,
        ordinal,
        url
      ) VALUES (?, ?, ?)`
    )

    this.db.transaction(() => {
      this.delete(messageId)
      links.forEach((url, index) => {
        insert.run(messageId, index, url)
      })
    })()
  }

  listByMessageIds(messageIds: string[]): DeepChatUserMessageLinkRow[] {
    if (messageIds.length === 0) {
      return []
    }

    const placeholders = messageIds.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT * FROM deepchat_user_message_links
         WHERE message_id IN (${placeholders})
         ORDER BY message_id, ordinal`
      )
      .all(...messageIds) as DeepChatUserMessageLinkRow[]
  }

  delete(messageId: string): void {
    this.db.prepare('DELETE FROM deepchat_user_message_links WHERE message_id = ?').run(messageId)
  }

  deleteByMessageIds(messageIds: string[]): void {
    if (messageIds.length === 0) {
      return
    }

    const placeholders = messageIds.map(() => '?').join(', ')
    this.db
      .prepare(`DELETE FROM deepchat_user_message_links WHERE message_id IN (${placeholders})`)
      .run(...messageIds)
  }

  deleteBySession(sessionId: string): void {
    this.db
      .prepare(
        `DELETE FROM deepchat_user_message_links
         WHERE message_id IN (
           SELECT id FROM deepchat_messages WHERE session_id = ?
         )`
      )
      .run(sessionId)
  }
}
