import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { AgentsTable } from './tables/agents'
import { AcpSessionsTable, type AcpSessionUpsertData } from './tables/acpSessions'
import { AcpTurnsTable, type AcpTurnStatus } from './tables/acpTurns'
import type { AcpSessionEntity } from '@shared/types/acp'
import type { AgentSessionLifecycleStatus } from '@shared/types/acp'
import { AgentCatalogSettingsTable } from '../acp/catalog/data/settingsTable'

export class AgentDatabase {
  constructor(private readonly connection: DatabaseConnectionProvider) {}

  getDatabase() {
    return this.connection.getDatabase()
  }

  get agentsTable() {
    return new AgentsTable(this.getDatabase())
  }

  get acpSessionsTable() {
    return new AcpSessionsTable(this.getDatabase())
  }

  get acpTurnsTable() {
    return new AcpTurnsTable(this.getDatabase())
  }

  get catalogSettingsTable() {
    return new AgentCatalogSettingsTable(this.getDatabase())
  }

  async getAcpSession(conversationId: string, agentId: string): Promise<AcpSessionEntity | null> {
    const row = await this.acpSessionsTable.getByConversationAndAgent(conversationId, agentId)
    return row ? (row as AcpSessionEntity) : null
  }

  async getAcpSessionByAgentAndSessionId(
    agentId: string,
    sessionId: string
  ): Promise<AcpSessionEntity | null> {
    const row = await this.acpSessionsTable.getByAgentAndSessionId(agentId, sessionId)
    return row ? (row as AcpSessionEntity) : null
  }

  async upsertAcpSession(
    conversationId: string,
    agentId: string,
    data: AcpSessionUpsertData
  ): Promise<void> {
    await this.acpSessionsTable.upsert(conversationId, agentId, data)
  }

  async updateAcpSessionId(
    conversationId: string,
    agentId: string,
    sessionId: string | null
  ): Promise<void> {
    await this.acpSessionsTable.updateSessionId(conversationId, agentId, sessionId)
  }

  async updateAcpWorkdir(
    conversationId: string,
    agentId: string,
    workdir: string | null
  ): Promise<void> {
    await this.acpSessionsTable.updateWorkdir(conversationId, agentId, workdir)
  }

  async updateAcpSessionStatus(
    conversationId: string,
    agentId: string,
    status: AgentSessionLifecycleStatus
  ): Promise<void> {
    await this.acpSessionsTable.updateStatus(conversationId, agentId, status)
  }

  async deleteAcpSessions(conversationId: string): Promise<void> {
    await this.acpSessionsTable.deleteByConversation(conversationId)
  }

  async deleteAcpSession(conversationId: string, agentId: string): Promise<void> {
    await this.acpSessionsTable.deleteByConversationAndAgent(conversationId, agentId)
  }

  async startAcpTurn(input: {
    id: string
    acpSessionId: string
    conversationId: string
    userMessageId?: string | null
    startedAt: number
  }): Promise<void> {
    this.acpTurnsTable.start(input)
  }

  async finishAcpTurn(input: {
    id: string
    status: Exclude<AcpTurnStatus, 'active'>
    stopReason?: string | null
    completedAt: number
  }): Promise<void> {
    this.acpTurnsTable.finish(input)
  }

  async migrateAcpAgentReferences(aliasMap: Record<string, string>): Promise<void> {
    const entries = Object.entries(aliasMap).filter(([from, to]) => from && to && from !== to)
    if (entries.length === 0) return

    const db = this.getDatabase()
    const hasTable = (tableName: string): boolean =>
      Boolean(
        db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName)
      )
    const hasColumn = (tableName: string, columnName: string): boolean =>
      hasTable(tableName) &&
      (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).some(
        (row) => row.name === columnName
      )

    db.transaction(() => {
      const hasNewSessions = hasTable('new_sessions')
      const hasAcpSessions = hasTable('acp_sessions')
      const hasDeepchatSessionModelRef =
        hasTable('deepchat_sessions') &&
        hasColumn('deepchat_sessions', 'provider_id') &&
        hasColumn('deepchat_sessions', 'model_id')

      for (const [from, to] of entries) {
        if (hasNewSessions) {
          db.prepare('UPDATE new_sessions SET agent_id = ? WHERE agent_id = ?').run(to, from)
        }
        if (hasAcpSessions) {
          db.prepare(
            `DELETE FROM acp_sessions
               WHERE agent_id = ?
                 AND EXISTS (
                   SELECT 1 FROM acp_sessions AS existing
                   WHERE existing.conversation_id = acp_sessions.conversation_id
                     AND existing.agent_id = ?
                 )`
          ).run(from, to)
          db.prepare('UPDATE acp_sessions SET agent_id = ? WHERE agent_id = ?').run(to, from)
        }
        if (hasDeepchatSessionModelRef) {
          db.prepare(
            `UPDATE deepchat_sessions SET model_id = ?
               WHERE provider_id = 'acp' AND model_id = ?`
          ).run(to, from)
        }
      }
    })()
  }
}
