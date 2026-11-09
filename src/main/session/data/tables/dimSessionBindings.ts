import type Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { SessionStatus } from '@shared/types/agent-interface'

export interface DimSessionBinding {
  sessionId: string
  dimSessionId: string
  branchId: string
  generation: number
  cursor: string
  nextOrderSeq: number
  activeTurnId: string | null
  assistantMessageId: string | null
  status: SessionStatus
}
interface Row {
  session_id: string
  dim_session_id: string
  branch_id: string
  generation: number
  cursor: string
  next_order_seq: number
  active_turn_id: string | null
  assistant_message_id: string | null
  status: SessionStatus
}

/** Product identity and rebuildable projection cursor. Agent facts remain in dim's store. */
export class DimSessionBindingsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'dim_session_bindings')
  }
  getCreateTableSQL(): string {
    return `CREATE TABLE IF NOT EXISTS dim_session_bindings (
      session_id TEXT PRIMARY KEY, dim_session_id TEXT NOT NULL, branch_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1, cursor TEXT NOT NULL DEFAULT '0',
      next_order_seq INTEGER NOT NULL DEFAULT 1, active_turn_id TEXT,
      assistant_message_id TEXT, status TEXT NOT NULL DEFAULT 'idle',
      UNIQUE(dim_session_id, branch_id)
    );`
  }
  getLatestVersion(): number {
    return 0
  }
  getMigrationSQL(): null {
    return null
  }
  get(sessionId: string): DimSessionBinding | null {
    const row = this.db
      .prepare('SELECT * FROM dim_session_bindings WHERE session_id = ?')
      .get(sessionId) as Row | undefined
    return row
      ? {
          sessionId: row.session_id,
          dimSessionId: row.dim_session_id,
          branchId: row.branch_id,
          generation: row.generation,
          cursor: row.cursor,
          nextOrderSeq: row.next_order_seq,
          activeTurnId: row.active_turn_id,
          assistantMessageId: row.assistant_message_id,
          status: row.status
        }
      : null
  }
  bind(
    sessionId: string,
    dimSessionId: string,
    branchId = 'main',
    nextOrderSeq = 1
  ): DimSessionBinding {
    this.db
      .prepare(
        'INSERT INTO dim_session_bindings (session_id, dim_session_id, branch_id, next_order_seq) VALUES (?, ?, ?, ?)'
      )
      .run(sessionId, dimSessionId, branchId, nextOrderSeq)
    return this.get(sessionId)!
  }
  /** Must share the transaction of the associated transcript projection writes. */
  advance(previous: DimSessionBinding, next: DimSessionBinding): void {
    if (
      previous.sessionId !== next.sessionId ||
      previous.dimSessionId !== next.dimSessionId ||
      previous.branchId !== next.branchId ||
      previous.generation !== next.generation
    ) {
      throw new Error('Cannot change dim identity through projection')
    }
    if (
      !/^\d+$/.test(next.cursor) ||
      BigInt(next.cursor) <= BigInt(previous.cursor) ||
      next.nextOrderSeq < previous.nextOrderSeq
    )
      throw new Error('dim projection cursor must advance monotonically')
    const result = this.db
      .prepare(`UPDATE dim_session_bindings SET cursor = ?, next_order_seq = ?,
      active_turn_id = ?, assistant_message_id = ?, status = ?
      WHERE session_id = ? AND dim_session_id = ? AND branch_id = ? AND generation = ? AND cursor = ?`)
      .run(
        next.cursor,
        next.nextOrderSeq,
        next.activeTurnId,
        next.assistantMessageId,
        next.status,
        previous.sessionId,
        previous.dimSessionId,
        previous.branchId,
        previous.generation,
        previous.cursor
      )
    if (result.changes !== 1) throw new Error('Stale dim session projection')
  }
  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM dim_session_bindings WHERE session_id = ?').run(sessionId)
  }
}
