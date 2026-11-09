import type Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { DimEvent } from '@/agent/dim/sessionConnection'

/** A disposable input-event cache for message projection, never a queue or admission authority. */
export class DimInputProjectionTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'dim_input_projection')
  }
  getLatestVersion(): number {
    return 0
  }
  getMigrationSQL(): null {
    return null
  }
  getCreateTableSQL(): string {
    return `CREATE TABLE IF NOT EXISTS dim_input_projection (
      session_id TEXT NOT NULL, input_id TEXT NOT NULL, event_json TEXT NOT NULL,
      PRIMARY KEY(session_id, input_id)
    )`
  }
  get(sessionId: string, inputId: string): DimEvent | null {
    const row = this.db
      .prepare('SELECT event_json FROM dim_input_projection WHERE session_id = ? AND input_id = ?')
      .get(sessionId, inputId) as { event_json: string } | undefined
    return row ? JSON.parse(row.event_json) : null
  }
  put(sessionId: string, event: DimEvent, key = event.id): void {
    this.db
      .prepare(
        'INSERT INTO dim_input_projection(session_id, input_id, event_json) VALUES (?, ?, ?) ON CONFLICT(session_id, input_id) DO UPDATE SET event_json = excluded.event_json'
      )
      .run(sessionId, key, JSON.stringify(event))
  }
  delete(sessionId: string, inputId: string): void {
    this.db
      .prepare('DELETE FROM dim_input_projection WHERE session_id = ? AND input_id = ?')
      .run(sessionId, inputId)
  }
  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM dim_input_projection WHERE session_id = ?').run(sessionId)
  }
}
