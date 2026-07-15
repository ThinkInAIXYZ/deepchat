import { BaseTable } from '@/data/baseTable'
import type Database from 'better-sqlite3-multiple-ciphers'

export class AttachmentsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'attachments')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attach_id TEXT UNIQUE NOT NULL,
        message_id TEXT NOT NULL,
        attachment_type TEXT NOT NULL CHECK(attachment_type IN ('file', 'image', 'code', 'audio', 'video')),
        file_name TEXT NOT NULL,
        file_size INTEGER,
        storage_type TEXT NOT NULL CHECK(storage_type IN ('path', 'blob', 'cloud')),
        storage_path TEXT,
        thumbnail BLOB,
        vectorized INTEGER DEFAULT 0,
        data_summary TEXT,
        mime_type TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_attachment_type ON attachments(attachment_type);
      CREATE INDEX idx_attachment_vector ON attachments(vectorized);
    `
  }

  getMigrationSQL(): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }
}
