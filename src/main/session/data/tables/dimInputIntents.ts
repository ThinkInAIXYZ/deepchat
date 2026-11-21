import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { BaseTable } from '@/data/baseTable'
import type { JsonValue } from '@shared/contracts/json'

export interface DimInputIntent {
  submissionId: string
  sessionId: string
  dimSessionId: string
  branchId: string
  state: 'sending' | 'accepted' | 'unknown' | 'rejected'
  payload: JsonValue
  receipt: { inputId: string; sequence: string | number } | null
}
interface Row {
  submission_id: string
  session_id: string
  dim_session_id: string
  branch_id: string
  state: DimInputIntent['state']
  payload_json: string
  payload_hash: string
  receipt_json: string | null
}

export class DimInputIntentsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'dim_input_intents')
  }
  getLatestVersion(): number {
    return 0
  }
  getMigrationSQL(): null {
    return null
  }
  getCreateTableSQL(): string {
    return `CREATE TABLE IF NOT EXISTS dim_input_intents (
      submission_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, dim_session_id TEXT NOT NULL,
      branch_id TEXT NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'sending', receipt_json TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_dim_input_intents_session ON dim_input_intents(session_id, state);`
  }
  get(id: string): DimInputIntent | null {
    const row = this.db
      .prepare('SELECT * FROM dim_input_intents WHERE submission_id = ?')
      .get(id) as Row | undefined
    return row
      ? {
          submissionId: row.submission_id,
          sessionId: row.session_id,
          dimSessionId: row.dim_session_id,
          branchId: row.branch_id,
          state: row.state,
          payload: JSON.parse(row.payload_json),
          receipt: row.receipt_json ? JSON.parse(row.receipt_json) : null
        }
      : null
  }
  begin(intent: Omit<DimInputIntent, 'state' | 'receipt'>): {
    intent: DimInputIntent
    created: boolean
  } {
    const payload = JSON.stringify(intent.payload)
    const hash = createHash('sha256').update(payload).digest('hex')
    const now = Date.now()
    const inserted = this.db
      .prepare(`INSERT INTO dim_input_intents
      (submission_id, session_id, dim_session_id, branch_id, payload_json, payload_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(submission_id) DO NOTHING`)
      .run(
        intent.submissionId,
        intent.sessionId,
        intent.dimSessionId,
        intent.branchId,
        payload,
        hash,
        now,
        now
      )
    const row = this.db
      .prepare('SELECT * FROM dim_input_intents WHERE submission_id = ?')
      .get(intent.submissionId) as Row
    if (
      row.session_id !== intent.sessionId ||
      row.dim_session_id !== intent.dimSessionId ||
      row.branch_id !== intent.branchId ||
      row.payload_hash !== hash
    ) {
      throw new Error('dim submission ID is already bound to another input')
    }
    return { intent: this.get(intent.submissionId)!, created: inserted.changes === 1 }
  }
  settle(
    id: string,
    state: DimInputIntent['state'],
    receipt: DimInputIntent['receipt'] = null
  ): void {
    this.db
      .prepare(`UPDATE dim_input_intents SET state = ?, receipt_json = ?,
      payload_json = CASE WHEN ? = 'accepted' THEN '{}' ELSE payload_json END, updated_at = ?
      WHERE submission_id = ? AND state != 'accepted'`)
      .run(state, receipt ? JSON.stringify(receipt) : null, state, Date.now(), id)
  }
  pending(sessionId: string): DimInputIntent[] {
    return (
      this.db
        .prepare(
          "SELECT submission_id FROM dim_input_intents WHERE session_id = ? AND state IN ('sending', 'unknown') ORDER BY created_at"
        )
        .all(sessionId) as Array<{ submission_id: string }>
    ).map((row) => this.get(row.submission_id)!)
  }
  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM dim_input_intents WHERE session_id = ?').run(sessionId)
  }
}
