import type Database from 'better-sqlite3-multiple-ciphers'
import type { AgentSessionLifecycleStatus } from '@shared/presenter'
import { BaseTable } from './baseTable'

export type AcpSessionRow = {
  id: number
  conversationId: string
  agentId: string
  sessionId: string | null
  workdir: string | null
  status: AgentSessionLifecycleStatus
  createdAt: number
  updatedAt: number
  metadata: Record<string, unknown> | null
}

type AcpSessionDbRow = {
  id: number
  conversation_id: string
  agent_id: string
  session_id: string | null
  workdir: string | null
  status: AgentSessionLifecycleStatus
  created_at: number
  updated_at: number
  metadata: string | null
}

export type AcpSessionUpsertData = {
  sessionId?: string | null
  workdir?: string | null
  status?: AgentSessionLifecycleStatus
  metadata?: Record<string, unknown> | null
}

export class AcpSessionsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'acp_sessions')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS acp_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT UNIQUE,
        workdir TEXT,
        status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle', 'active', 'error')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        UNIQUE(conversation_id, agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_acp_sessions_session_id ON acp_sessions(session_id);
      CREATE INDEX IF NOT EXISTS idx_acp_sessions_agent ON acp_sessions(agent_id);
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  async getByConversationAndAgent(
    conversationId: string,
    agentId: string
  ): Promise<AcpSessionRow | null> {
    const row = this.db
      .prepare(
        `
        SELECT *
        FROM acp_sessions
        WHERE conversation_id = ? AND agent_id = ?
        LIMIT 1
      `
      )
      .get(conversationId, agentId) as AcpSessionDbRow | undefined

    return row ? this.mapRow(row) : null
  }

  async upsert(conversationId: string, agentId: string, data: AcpSessionUpsertData): Promise<void> {
    const now = Date.now()
    const payload = {
      conversationId,
      agentId,
      sessionId: data.sessionId ?? null,
      workdir: data.workdir ?? null,
      status: data.status ?? 'idle',
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      createdAt: now,
      updatedAt: now
    }

    this.db
      .prepare(
        `
        INSERT INTO acp_sessions (
          conversation_id,
          agent_id,
          session_id,
          workdir,
          status,
          metadata,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conversation_id, agent_id) DO UPDATE SET
          session_id = excluded.session_id,
          workdir = excluded.workdir,
          status = excluded.status,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
      `
      )
      .run(
        payload.conversationId,
        payload.agentId,
        payload.sessionId,
        payload.workdir,
        payload.status,
        payload.metadata,
        payload.createdAt,
        payload.updatedAt
      )
  }

  async updateSessionId(
    conversationId: string,
    agentId: string,
    sessionId: string | null
  ): Promise<void> {
    this.updateColumns(conversationId, agentId, { session_id: sessionId })
  }

  async updateWorkdir(
    conversationId: string,
    agentId: string,
    workdir: string | null
  ): Promise<void> {
    this.updateColumns(conversationId, agentId, { workdir })
  }

  async updateStatus(
    conversationId: string,
    agentId: string,
    status: AgentSessionLifecycleStatus
  ): Promise<void> {
    this.updateColumns(conversationId, agentId, { status })
  }

  async deleteByConversation(conversationId: string): Promise<void> {
    this.db.prepare(`DELETE FROM acp_sessions WHERE conversation_id = ?`).run(conversationId)
  }

  async deleteByConversationAndAgent(conversationId: string, agentId: string): Promise<void> {
    this.db
      .prepare(`DELETE FROM acp_sessions WHERE conversation_id = ? AND agent_id = ?`)
      .run(conversationId, agentId)
  }

  private updateColumns(
    conversationId: string,
    agentId: string,
    data: Partial<Record<'session_id' | 'workdir' | 'status', string | null>>
  ): void {
    const columns = Object.keys(data)
    if (!columns.length) return

    const sets = columns.map((column) => `${column} = ?`)
    const values = columns.map((column) => (data as Record<string, string | null>)[column])

    this.db
      .prepare(
        `
        UPDATE acp_sessions
        SET ${sets.join(', ')}, updated_at = ?
        WHERE conversation_id = ? AND agent_id = ?
      `
      )
      .run(...values, Date.now(), conversationId, agentId)
  }

  private mapRow(row: AcpSessionDbRow): AcpSessionRow {
    let metadata: Record<string, unknown> | null = null
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata) as Record<string, unknown>
      } catch {
        metadata = null
      }
    }

    return {
      id: row.id,
      conversationId: row.conversation_id,
      agentId: row.agent_id,
      sessionId: row.session_id,
      workdir: row.workdir,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata
    }
  }
}
