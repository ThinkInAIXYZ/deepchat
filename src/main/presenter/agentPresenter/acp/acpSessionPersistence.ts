import { app } from 'electron'
import type {
  AcpSessionEntity,
  AgentSessionLifecycleStatus,
  ISQLitePresenter
} from '@shared/presenter'

export class AcpSessionPersistence {
  constructor(private readonly sqlitePresenter: ISQLitePresenter) {}

  async getSessionData(conversationId: string, agentId: string): Promise<AcpSessionEntity | null> {
    return this.sqlitePresenter.getAcpSession(conversationId, agentId)
  }

  async saveSessionData(
    conversationId: string,
    agentId: string,
    sessionId: string | null,
    workdir: string | null,
    status: AgentSessionLifecycleStatus,
    metadata: Record<string, unknown> | null
  ): Promise<void> {
    await this.sqlitePresenter.upsertAcpSession(conversationId, agentId, {
      sessionId,
      workdir,
      status,
      metadata
    })
  }

  async updateSessionId(
    conversationId: string,
    agentId: string,
    sessionId: string | null
  ): Promise<void> {
    await this.sqlitePresenter.updateAcpSessionId(conversationId, agentId, sessionId)
  }

  async updateWorkdir(
    conversationId: string,
    agentId: string,
    workdir: string | null
  ): Promise<void> {
    const existing = await this.getSessionData(conversationId, agentId)
    if (!existing) {
      await this.saveSessionData(conversationId, agentId, null, workdir, 'idle', null)
      return
    }
    await this.sqlitePresenter.updateAcpWorkdir(conversationId, agentId, workdir)
  }

  async updateStatus(
    conversationId: string,
    agentId: string,
    status: AgentSessionLifecycleStatus
  ): Promise<void> {
    await this.sqlitePresenter.updateAcpSessionStatus(conversationId, agentId, status)
  }

  async deleteSession(conversationId: string, agentId: string): Promise<void> {
    await this.sqlitePresenter.deleteAcpSession(conversationId, agentId)
  }

  async clearSession(conversationId: string, agentId: string): Promise<void> {
    await this.updateSessionId(conversationId, agentId, null)
    await this.updateStatus(conversationId, agentId, 'idle')
  }

  async getWorkdir(conversationId: string, agentId: string): Promise<string> {
    const record = await this.getSessionData(conversationId, agentId)
    return this.resolveWorkdir(record?.workdir)
  }

  resolveWorkdir(workdir?: string | null): string {
    if (workdir && workdir.trim().length > 0) {
      return workdir
    }
    return this.getDefaultWorkdir()
  }

  getDefaultWorkdir(): string {
    try {
      return app.getPath('home')
    } catch {
      return process.env.HOME || process.cwd()
    }
  }
}
