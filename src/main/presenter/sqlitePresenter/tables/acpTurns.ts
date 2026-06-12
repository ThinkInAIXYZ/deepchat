import type Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export type AcpTurnStatus = 'active' | 'completed' | 'cancelled' | 'error'

export type AcpTurnRow = {
  id: string
  acpSessionId: string
  conversationId: string
  userMessageId: string | null
  status: AcpTurnStatus
  stopReason: string | null
  startedAt: number
  completedAt: number | null
}

type AcpTurnDbRow = {
  id: string
  acp_session_id: string
  conversation_id: string
  user_message_id: string | null
  status: AcpTurnStatus
  stop_reason: string | null
  started_at: number
  completed_at: number | null
}

export class AcpTurnsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'acp_turns')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS acp_turns (
        id TEXT PRIMARY KEY,
        acp_session_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        user_message_id TEXT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK(status IN ('active', 'completed', 'cancelled', 'error')),
        stop_reason TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_acp_turns_session
        ON acp_turns(acp_session_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_acp_turns_conversation
        ON acp_turns(conversation_id, started_at DESC);
    `
  }

  getMigrationSQL(): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  start(input: {
    id: string
    acpSessionId: string
    conversationId: string
    userMessageId?: string | null
    startedAt: number
  }): void {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO acp_turns (
          id,
          acp_session_id,
          conversation_id,
          user_message_id,
          status,
          stop_reason,
          started_at,
          completed_at
        ) VALUES (?, ?, ?, ?, 'active', NULL, ?, NULL)
      `
      )
      .run(
        input.id,
        input.acpSessionId,
        input.conversationId,
        input.userMessageId ?? null,
        input.startedAt
      )
  }

  finish(input: {
    id: string
    status: Exclude<AcpTurnStatus, 'active'>
    stopReason?: string | null
    completedAt: number
  }): void {
    this.db
      .prepare(
        `
        UPDATE acp_turns
        SET status = ?, stop_reason = ?, completed_at = ?
        WHERE id = ?
      `
      )
      .run(input.status, input.stopReason ?? null, input.completedAt, input.id)
  }

  get(id: string): AcpTurnRow | null {
    const row = this.db.prepare(`SELECT * FROM acp_turns WHERE id = ? LIMIT 1`).get(id) as
      | AcpTurnDbRow
      | undefined
    return row ? this.mapRow(row) : null
  }

  private mapRow(row: AcpTurnDbRow): AcpTurnRow {
    return {
      id: row.id,
      acpSessionId: row.acp_session_id,
      conversationId: row.conversation_id,
      userMessageId: row.user_message_id,
      status: row.status,
      stopReason: row.stop_reason,
      startedAt: row.started_at,
      completedAt: row.completed_at
    }
  }
}
