import Database from 'better-sqlite3-multiple-ciphers'
import type { SessionMetadata } from '@shared/types/agent-interface'
import { BaseTable } from './baseTable'

export interface DeepChatSessionMetadataRow {
  session_id: string
  source: string
  metadata_json: string
  created_at: number
  updated_at: number
}

export class DeepChatSessionMetadataTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_session_metadata')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_session_metadata (
        session_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deepchat_session_metadata_source
        ON deepchat_session_metadata(source, updated_at DESC);
    `
  }

  getMigrationSQL(): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  upsert(sessionId: string, metadata: SessionMetadata, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO deepchat_session_metadata (
           session_id,
           source,
           metadata_json,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           source = excluded.source,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`
      )
      .run(sessionId, metadata.source, JSON.stringify(metadata), now, now)
  }

  get(sessionId: string): SessionMetadata | null {
    const row = this.db
      .prepare('SELECT * FROM deepchat_session_metadata WHERE session_id = ?')
      .get(sessionId) as DeepChatSessionMetadataRow | undefined
    return row ? this.parseMetadata(row) : null
  }

  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM deepchat_session_metadata WHERE session_id = ?').run(sessionId)
  }

  private parseMetadata(row: DeepChatSessionMetadataRow): SessionMetadata | null {
    try {
      const parsed = JSON.parse(row.metadata_json) as Partial<SessionMetadata>
      if (
        row.source === 'cron_job' &&
        parsed.source === 'cron_job' &&
        typeof parsed.cronJobId === 'string' &&
        typeof parsed.cronJobRunId === 'string' &&
        typeof parsed.scheduledAt === 'number'
      ) {
        return {
          source: 'cron_job',
          cronJobId: parsed.cronJobId,
          cronJobRunId: parsed.cronJobRunId,
          scheduledAt: parsed.scheduledAt
        }
      }
    } catch {
      return null
    }

    return null
  }
}
