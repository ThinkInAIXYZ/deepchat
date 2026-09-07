import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { TapeProjectionCursor } from '@/tape/ports/capabilities'

/**
 * Bump when the transcript tables derived from a message fact change shape in a way that makes a
 * stored cursor meaningless; older rows are then treated as absent and the Session is projected
 * again from its transcript and Tape.
 */
const TRANSCRIPT_PROJECTION_VERSION = 1

/**
 * How far the transcript tables have followed a Session's Tape: the Tape incarnation they were
 * derived from and the highest entry id whose message facts they reflect. Written inside the same
 * transaction as each terminal transcript write, so it is never ahead of the tables or behind the
 * fact that was just appended.
 */
export class DeepChatTranscriptProjectionMetaTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_transcript_projection_meta')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_transcript_projection_meta (
        session_id TEXT PRIMARY KEY,
        tape_incarnation_id TEXT NOT NULL,
        max_entry_id INTEGER NOT NULL,
        projection_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  get(sessionId: string): TapeProjectionCursor | null {
    const row = this.db
      .prepare(
        `SELECT tape_incarnation_id, max_entry_id, projection_version
         FROM deepchat_transcript_projection_meta
         WHERE session_id = ?`
      )
      .get(sessionId) as
      | { tape_incarnation_id: string; max_entry_id: number; projection_version: number }
      | undefined
    if (!row || row.projection_version !== TRANSCRIPT_PROJECTION_VERSION) {
      return null
    }
    return { tapeIncarnationId: row.tape_incarnation_id, maxEntryId: row.max_entry_id }
  }

  upsert(sessionId: string, cursor: TapeProjectionCursor): void {
    this.db
      .prepare(
        `INSERT INTO deepchat_transcript_projection_meta (
           session_id,
           tape_incarnation_id,
           max_entry_id,
           projection_version,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           tape_incarnation_id = excluded.tape_incarnation_id,
           max_entry_id = excluded.max_entry_id,
           projection_version = excluded.projection_version,
           updated_at = excluded.updated_at`
      )
      .run(
        sessionId,
        cursor.tapeIncarnationId,
        cursor.maxEntryId,
        TRANSCRIPT_PROJECTION_VERSION,
        Date.now()
      )
  }

  delete(sessionId: string): void {
    this.db
      .prepare('DELETE FROM deepchat_transcript_projection_meta WHERE session_id = ?')
      .run(sessionId)
  }
}
