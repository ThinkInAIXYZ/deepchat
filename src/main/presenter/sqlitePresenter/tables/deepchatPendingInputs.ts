import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface DeepChatPendingInputRow {
  id: string
  session_id: string
  mode: 'queue' | 'steer'
  state: 'pending' | 'claimed' | 'consumed'
  payload_json: string
  queue_order: number | null
  claimed_at: number | null
  consumed_at: number | null
  created_at: number
  updated_at: number
}

export class DeepChatPendingInputsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_pending_inputs')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_pending_inputs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        payload_json TEXT NOT NULL,
        queue_order INTEGER,
        claimed_at INTEGER,
        consumed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deepchat_pending_inputs_session
        ON deepchat_pending_inputs(session_id, state, mode, queue_order, created_at);
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === 17) {
      return this.getCreateTableSQL()
    }
    return null
  }

  getLatestVersion(): number {
    return 17
  }

  insert(row: {
    id: string
    sessionId: string
    mode: 'queue' | 'steer'
    state?: 'pending' | 'claimed' | 'consumed'
    payloadJson: string
    queueOrder?: number | null
    claimedAt?: number | null
    consumedAt?: number | null
    createdAt?: number
    updatedAt?: number
  }): void {
    const now = Date.now()
    const createdAt = row.createdAt ?? now
    const updatedAt = row.updatedAt ?? createdAt
    this.db
      .prepare(
        `INSERT INTO deepchat_pending_inputs (
          id,
          session_id,
          mode,
          state,
          payload_json,
          queue_order,
          claimed_at,
          consumed_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.sessionId,
        row.mode,
        row.state ?? 'pending',
        row.payloadJson,
        row.queueOrder ?? null,
        row.claimedAt ?? null,
        row.consumedAt ?? null,
        createdAt,
        updatedAt
      )
  }

  get(id: string): DeepChatPendingInputRow | undefined {
    return this.db.prepare('SELECT * FROM deepchat_pending_inputs WHERE id = ?').get(id) as
      | DeepChatPendingInputRow
      | undefined
  }

  listBySession(sessionId: string): DeepChatPendingInputRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_pending_inputs
         WHERE session_id = ?
         ORDER BY
           CASE mode WHEN 'steer' THEN 0 ELSE 1 END ASC,
           CASE
             WHEN mode = 'queue' THEN COALESCE(queue_order, 2147483647)
             ELSE created_at
           END ASC,
           created_at ASC`
      )
      .all(sessionId) as DeepChatPendingInputRow[]
  }

  listClaimed(): DeepChatPendingInputRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_pending_inputs
         WHERE state = 'claimed'
         ORDER BY session_id ASC, created_at ASC`
      )
      .all() as DeepChatPendingInputRow[]
  }

  listActiveBySession(sessionId: string): DeepChatPendingInputRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_pending_inputs
         WHERE session_id = ?
           AND state != 'consumed'
         ORDER BY
           CASE mode WHEN 'steer' THEN 0 ELSE 1 END ASC,
           CASE
             WHEN mode = 'queue' THEN COALESCE(queue_order, 2147483647)
             ELSE created_at
           END ASC,
           created_at ASC`
      )
      .all(sessionId) as DeepChatPendingInputRow[]
  }

  countActiveBySession(sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM deepchat_pending_inputs
         WHERE session_id = ?
           AND state != 'consumed'
           AND NOT (mode = 'queue' AND state = 'claimed')`
      )
      .get(sessionId) as { total: number }
    return row.total
  }

  update(
    id: string,
    fields: Partial<
      Pick<
        DeepChatPendingInputRow,
        'mode' | 'state' | 'payload_json' | 'queue_order' | 'claimed_at' | 'consumed_at'
      >
    >
  ): void {
    const setClauses: string[] = []
    const params: unknown[] = []

    if (fields.mode !== undefined) {
      setClauses.push('mode = ?')
      params.push(fields.mode)
    }
    if (fields.state !== undefined) {
      setClauses.push('state = ?')
      params.push(fields.state)
    }
    if (fields.payload_json !== undefined) {
      setClauses.push('payload_json = ?')
      params.push(fields.payload_json)
    }
    if (fields.queue_order !== undefined) {
      setClauses.push('queue_order = ?')
      params.push(fields.queue_order)
    }
    if (fields.claimed_at !== undefined) {
      setClauses.push('claimed_at = ?')
      params.push(fields.claimed_at)
    }
    if (fields.consumed_at !== undefined) {
      setClauses.push('consumed_at = ?')
      params.push(fields.consumed_at)
    }

    if (setClauses.length === 0) {
      return
    }

    setClauses.push('updated_at = ?')
    params.push(Date.now())
    params.push(id)

    this.db
      .prepare(`UPDATE deepchat_pending_inputs SET ${setClauses.join(', ')} WHERE id = ?`)
      .run(...params)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM deepchat_pending_inputs WHERE id = ?').run(id)
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM deepchat_pending_inputs WHERE session_id = ?').run(sessionId)
  }
}
