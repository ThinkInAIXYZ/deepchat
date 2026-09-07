import { Database } from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import { nanoid } from 'nanoid'

export class MessageAttachmentsTable extends BaseTable {
  constructor(db: Database) {
    super(db, 'message_attachments')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS message_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attachment_id TEXT UNIQUE NOT NULL,
        message_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(message_id) REFERENCES messages(msg_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_message_attachments_message ON message_attachments(message_id);
      CREATE INDEX idx_message_attachments_type ON message_attachments(type);
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  async add(messageId: string, attachmentType: string, attachmentData: string): Promise<void> {
    const attachmentId = nanoid()
    const insert = this.db.prepare(`
      INSERT INTO message_attachments (
        attachment_id,
        message_id,
        type,
        content,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    insert.run(attachmentId, messageId, attachmentType, attachmentData, Date.now())
  }

  async get(messageId: string, type: string): Promise<{ content: string }[]> {
    return this.db
      .prepare(
        `
        SELECT content
        FROM message_attachments
        WHERE message_id = ? AND type = ?
        ORDER BY created_at ASC
      `
      )
      .all(messageId, type) as { content: string }[]
  }
}
