import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'

/** Product reference identity, independent of native generations and transcript caches. */
export class SessionReferenceEpochsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'session_reference_epochs')
  }
  getCreateTableSQL(): string {
    return 'CREATE TABLE IF NOT EXISTS session_reference_epochs (session_id TEXT PRIMARY KEY, epoch TEXT NOT NULL);'
  }
  getLatestVersion(): number {
    return 0
  }
  getMigrationSQL(): null {
    return null
  }
  get(sessionId: string): string | null {
    return (
      (
        this.db
          .prepare('SELECT epoch FROM session_reference_epochs WHERE session_id=?')
          .get(sessionId) as { epoch: string } | undefined
      )?.epoch ?? null
    )
  }
  ensure(sessionId: string, previous?: string | null): string {
    this.db
      .prepare(
        'INSERT INTO session_reference_epochs (session_id,epoch) VALUES (?,?) ON CONFLICT(session_id) DO NOTHING'
      )
      .run(sessionId, previous ?? `native:${randomUUID()}`)
    return this.get(sessionId)!
  }
  rotate(sessionId: string): void {
    this.db
      .prepare(
        'INSERT INTO session_reference_epochs (session_id,epoch) VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET epoch=excluded.epoch'
      )
      .run(sessionId, `native:${randomUUID()}`)
  }
  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM session_reference_epochs WHERE session_id=?').run(sessionId)
  }
}
