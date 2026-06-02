import { app } from 'electron'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type {
  CONVERSATION_SETTINGS,
  AcpTurnFinishPayload,
  AcpTurnStartPayload,
  AcpSessionEntity,
  AgentSessionLifecycleStatus,
  ISQLitePresenter
} from '@shared/presenter'

export interface AcpRemoteSessionSyncInput {
  agentId: string
  agentName: string
  providerId: string
  workdir: string
  sessions: schema.SessionInfo[]
}

export interface AcpRemoteSessionSyncItem {
  sessionId: string
  conversationId: string
  status: 'imported' | 'updated' | 'skipped'
  title?: string | null
}

export interface AcpRemoteSessionSyncResult {
  imported: number
  updated: number
  skipped: number
  sessions: AcpRemoteSessionSyncItem[]
}

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

  async mergeMetadata(
    conversationId: string,
    agentId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const existing = await this.getSessionData(conversationId, agentId)
    await this.saveSessionData(
      conversationId,
      agentId,
      existing?.sessionId ?? null,
      existing?.workdir ?? null,
      existing?.status ?? 'idle',
      {
        ...existing?.metadata,
        ...metadata
      }
    )
  }

  async syncRemoteSessions(input: AcpRemoteSessionSyncInput): Promise<AcpRemoteSessionSyncResult> {
    const now = new Date().toISOString()
    const result: AcpRemoteSessionSyncResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      sessions: []
    }

    for (const remoteSession of input.sessions) {
      if (!remoteSession.sessionId) {
        result.skipped += 1
        result.sessions.push({
          sessionId: '',
          conversationId: '',
          status: 'skipped',
          title: remoteSession.title
        })
        continue
      }

      const sessionWorkdir = this.resolveRemoteSessionWorkdir(remoteSession, input.workdir)
      const metadata = this.buildRemoteSessionMetadata(input.agentName, remoteSession, now)
      const existing = await this.sqlitePresenter.getAcpSessionByAgentAndSessionId(
        input.agentId,
        remoteSession.sessionId
      )

      if (existing) {
        const existingSync = this.getRecord(existing.metadata?.acpSync)
        await this.saveSessionData(
          existing.conversationId,
          input.agentId,
          remoteSession.sessionId,
          sessionWorkdir,
          existing.status ?? 'idle',
          {
            ...existing.metadata,
            ...metadata,
            acpSync: {
              ...existingSync,
              lastSyncedAt: now,
              source: 'session/list'
            }
          }
        )
        result.updated += 1
        result.sessions.push({
          sessionId: remoteSession.sessionId,
          conversationId: existing.conversationId,
          status: 'updated',
          title: remoteSession.title
        })
        continue
      }

      const conversationId = await this.sqlitePresenter.createConversation(
        this.buildRemoteSessionTitle(input.agentName, remoteSession),
        this.buildConversationSettings(input.providerId, input.agentId, sessionWorkdir)
      )
      await this.saveSessionData(
        conversationId,
        input.agentId,
        remoteSession.sessionId,
        sessionWorkdir,
        'idle',
        {
          ...metadata,
          acpSync: {
            importedAt: now,
            lastSyncedAt: now,
            source: 'session/list'
          }
        }
      )
      result.imported += 1
      result.sessions.push({
        sessionId: remoteSession.sessionId,
        conversationId,
        status: 'imported',
        title: remoteSession.title
      })
    }

    return result
  }

  async deleteSession(conversationId: string, agentId: string): Promise<void> {
    await this.sqlitePresenter.deleteAcpSession(conversationId, agentId)
  }

  async clearSession(conversationId: string, agentId: string): Promise<void> {
    await this.updateStatus(conversationId, agentId, 'idle')
  }

  async startTurn(input: AcpTurnStartPayload): Promise<void> {
    await this.sqlitePresenter.startAcpTurn(input)
  }

  async finishTurn(input: AcpTurnFinishPayload): Promise<void> {
    await this.sqlitePresenter.finishAcpTurn(input)
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

  private resolveRemoteSessionWorkdir(session: schema.SessionInfo, fallback: string): string {
    return session.cwd?.trim() || fallback
  }

  private buildConversationSettings(
    providerId: string,
    agentId: string,
    workdir: string
  ): Partial<CONVERSATION_SETTINGS> {
    return {
      providerId,
      modelId: agentId,
      chatMode: 'acp agent',
      agentWorkspacePath: workdir,
      acpWorkdirMap: {
        [agentId]: workdir
      }
    }
  }

  private buildRemoteSessionTitle(agentName: string, session: schema.SessionInfo): string {
    const title = session.title?.trim()
    if (title) return title

    const shortSessionId =
      session.sessionId.length > 12 ? session.sessionId.slice(0, 12) : session.sessionId
    return `${agentName} ${shortSessionId}`
  }

  private buildRemoteSessionMetadata(
    agentName: string,
    session: schema.SessionInfo,
    syncedAt: string
  ): Record<string, unknown> {
    return {
      agentName,
      remoteSession: {
        protocol: 'acp',
        sessionId: session.sessionId,
        cwd: session.cwd,
        title: session.title ?? null,
        updatedAt: session.updatedAt ?? null,
        meta: session._meta ?? null,
        syncedAt
      }
    }
  }

  private getRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }
}
