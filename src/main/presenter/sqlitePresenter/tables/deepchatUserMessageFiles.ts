import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface DeepChatUserMessageFileRow {
  message_id: string
  ordinal: number
  name: string | null
  path: string
  mime_type: string | null
  size: number | null
  metadata_json: string | null
}

const NORMALIZATION_SCHEMA_VERSION = 26

export class DeepChatUserMessageFilesTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_user_message_files')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_user_message_files (
        message_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        name TEXT,
        path TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER,
        metadata_json TEXT,
        PRIMARY KEY (message_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS idx_deepchat_user_message_files_message
        ON deepchat_user_message_files(message_id, ordinal);
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

  replaceForMessage(
    messageId: string,
    files: Array<{
      name?: string
      path: string
      mimeType?: string
      size?: number
      metadataJson?: string | null
    }>
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO deepchat_user_message_files (
        message_id,
        ordinal,
        name,
        path,
        mime_type,
        size,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    this.db.transaction(() => {
      this.delete(messageId)
      files.forEach((file, index) => {
        insert.run(
          messageId,
          index,
          file.name ?? null,
          file.path,
          file.mimeType ?? null,
          file.size ?? null,
          file.metadataJson ?? null
        )
      })
    })()
  }

  listByMessageIds(messageIds: string[]): DeepChatUserMessageFileRow[] {
    if (messageIds.length === 0) {
      return []
    }

    const placeholders = messageIds.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT * FROM deepchat_user_message_files
         WHERE message_id IN (${placeholders})
         ORDER BY message_id, ordinal`
      )
      .all(...messageIds) as DeepChatUserMessageFileRow[]
  }

  delete(messageId: string): void {
    this.db.prepare('DELETE FROM deepchat_user_message_files WHERE message_id = ?').run(messageId)
  }

  deleteByMessageIds(messageIds: string[]): void {
    if (messageIds.length === 0) {
      return
    }

    const placeholders = messageIds.map(() => '?').join(', ')
    this.db
      .prepare(`DELETE FROM deepchat_user_message_files WHERE message_id IN (${placeholders})`)
      .run(...messageIds)
  }

  deleteBySession(sessionId: string): void {
    this.db
      .prepare(
        `DELETE FROM deepchat_user_message_files
         WHERE message_id IN (
           SELECT id FROM deepchat_messages WHERE session_id = ?
         )`
      )
      .run(sessionId)
  }
}
