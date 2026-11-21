import type Database from 'better-sqlite3-multiple-ciphers'
import type { JsonValue } from '@shared/contracts/json'
import { BaseTable } from '@/data/baseTable'
import type { DimSessionBinding } from './dimSessionBindings'

export type DimHistoryChange =
  | { kind: 'retain' }
  | { kind: 'clear' }
  | { kind: 'truncate'; fromOrderSeq: number }
  | { kind: 'retry'; fromOrderSeq: number; messageId: string }
  | { kind: 'edit'; messageId: string; expectedContent: string; content: string }
  | {
      kind: 'fork'
      productSessionId: string
      sessionId: string
      branchId: string
      through: string
      messageId: string
    }

export interface DimScopeChange {
  sessionId: string
  operationId: string
  source: Pick<DimSessionBinding, 'dimSessionId' | 'branchId' | 'generation'>
  creation: JsonValue
  change: DimHistoryChange
  through: string | null
  targetSessionId: string | null
}
interface Row {
  session_id: string
  operation_id: string
  source_session_id: string
  source_branch_id: string
  source_generation: number
  creation: string
  change: string
  source_through: string | null
  target_session_id: string | null
}

/** A recoverable product mutation intent, never a copy of the canonical native transcript. */
export class DimScopeChangesTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'dim_scope_changes')
  }
  getCreateTableSQL(): string {
    return `CREATE TABLE IF NOT EXISTS dim_scope_changes (
      session_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
      source_session_id TEXT NOT NULL, source_branch_id TEXT NOT NULL,
      source_generation INTEGER NOT NULL, creation TEXT NOT NULL, change TEXT NOT NULL,
      source_through TEXT, target_session_id TEXT, created_at INTEGER NOT NULL
    );`
  }
  getLatestVersion(): number {
    return 0
  }
  getMigrationSQL(): null {
    return null
  }
  get(sessionId: string): DimScopeChange | null {
    const row = this.db
      .prepare('SELECT * FROM dim_scope_changes WHERE session_id=?')
      .get(sessionId) as Row | undefined
    return row
      ? {
          sessionId: row.session_id,
          operationId: row.operation_id,
          source: {
            dimSessionId: row.source_session_id,
            branchId: row.source_branch_id,
            generation: row.source_generation
          },
          creation: JSON.parse(row.creation),
          change: JSON.parse(row.change),
          through: row.source_through,
          targetSessionId: row.target_session_id
        }
      : null
  }
  begin(record: DimScopeChange): void {
    this.db
      .prepare(`INSERT INTO dim_scope_changes
      (session_id,operation_id,source_session_id,source_branch_id,source_generation,creation,change,created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(
        record.sessionId,
        record.operationId,
        record.source.dimSessionId,
        record.source.branchId,
        record.source.generation,
        JSON.stringify(record.creation),
        JSON.stringify(record.change),
        Date.now()
      )
  }
  freeze(record: DimScopeChange, through: string): void {
    if (!/^\d+$/.test(through)) throw new Error('Invalid native transition cutoff')
    const result = this.db
      .prepare(`UPDATE dim_scope_changes SET source_through=?
      WHERE session_id=? AND operation_id=? AND (source_through IS NULL OR source_through=?)`)
      .run(through, record.sessionId, record.operationId, through)
    if (result.changes !== 1) throw new Error('Native transition cutoff changed')
  }
  target(record: DimScopeChange, targetSessionId: string): void {
    const result = this.db
      .prepare(`UPDATE dim_scope_changes SET target_session_id=?
      WHERE session_id=? AND operation_id=? AND (target_session_id IS NULL OR target_session_id=?)`)
      .run(targetSessionId, record.sessionId, record.operationId, targetSessionId)
    if (result.changes !== 1) throw new Error('Native transition target changed')
  }
  finish(record: DimScopeChange): void {
    this.db
      .prepare('DELETE FROM dim_scope_changes WHERE session_id=? AND operation_id=?')
      .run(record.sessionId, record.operationId)
  }
}
