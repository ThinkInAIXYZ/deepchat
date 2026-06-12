import { app } from 'electron'
import * as fs from 'fs'
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
  private readonly remoteSessionSyncLocks = new Map<string, Promise<void>>()
  private readonly metadataMergeLocks = new Map<string, Promise<void>>()

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
    await this.withKeyLock(this.metadataMergeLocks, `${conversationId}::${agentId}`, async () => {
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
    })
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

      const item = await this.withRemoteSessionSyncLock(
        input.agentId,
        remoteSession.sessionId,
        () => this.syncRemoteSession(input, remoteSession, now)
      )

      result[item.status] += 1
      result.sessions.push(item)
    }

    return result
  }

  private async syncRemoteSession(
    input: AcpRemoteSessionSyncInput,
    remoteSession: schema.SessionInfo,
    syncedAt: string
  ): Promise<AcpRemoteSessionSyncItem> {
    const sessionWorkdir = this.resolveRemoteSessionWorkdir(remoteSession, input.workdir)
    const metadata = this.buildRemoteSessionMetadata(input.agentName, remoteSession, syncedAt)
    const existing = await this.sqlitePresenter.getAcpSessionByAgentAndSessionId(
      input.agentId,
      remoteSession.sessionId
    )

    if (existing) {
      return this.updateRemoteSessionLink(
        input,
        remoteSession,
        existing,
        sessionWorkdir,
        metadata,
        syncedAt
      )
    }

    const conversationId = await this.sqlitePresenter.createConversation(
      this.buildRemoteSessionTitle(input.agentName, remoteSession),
      this.buildConversationSettings(input.providerId, input.agentId, sessionWorkdir)
    )

    try {
      await this.saveSessionData(
        conversationId,
        input.agentId,
        remoteSession.sessionId,
        sessionWorkdir,
        'idle',
        {
          ...metadata,
          acpSync: {
            importedAt: syncedAt,
            lastSyncedAt: syncedAt,
            source: 'session/list'
          }
        }
      )
    } catch (error) {
      const concurrentExisting = await this.sqlitePresenter.getAcpSessionByAgentAndSessionId(
        input.agentId,
        remoteSession.sessionId
      )
      if (!concurrentExisting) {
        await this.deleteConversationSilently(conversationId)
        throw error
      }

      await this.deleteConversationSilently(conversationId)
      return this.updateRemoteSessionLink(
        input,
        remoteSession,
        concurrentExisting,
        sessionWorkdir,
        metadata,
        syncedAt
      )
    }

    return {
      sessionId: remoteSession.sessionId,
      conversationId,
      status: 'imported',
      title: remoteSession.title
    }
  }

  private async updateRemoteSessionLink(
    input: AcpRemoteSessionSyncInput,
    remoteSession: schema.SessionInfo,
    existing: AcpSessionEntity,
    syncedWorkdir: string,
    metadata: Record<string, unknown>,
    syncedAt: string
  ): Promise<AcpRemoteSessionSyncItem> {
    const existingSync = this.getRecord(existing.metadata?.acpSync)
    const existingWorkdir = this.resolveExistingSessionWorkdir(existing.workdir, syncedWorkdir)
    await this.saveSessionData(
      existing.conversationId,
      input.agentId,
      remoteSession.sessionId,
      existingWorkdir,
      existing.status ?? 'idle',
      {
        ...existing.metadata,
        ...metadata,
        acpSync: {
          ...existingSync,
          lastSyncedAt: syncedAt,
          source: 'session/list'
        }
      }
    )

    return {
      sessionId: remoteSession.sessionId,
      conversationId: existing.conversationId,
      status: 'updated',
      title: remoteSession.title
    }
  }

  private async withRemoteSessionSyncLock<T>(
    agentId: string,
    sessionId: string,
    task: () => Promise<T>
  ): Promise<T> {
    return this.withKeyLock(this.remoteSessionSyncLocks, `${agentId}::${sessionId}`, task)
  }

  private async withKeyLock<T>(
    locks: Map<string, Promise<void>>,
    key: string,
    task: () => Promise<T>
  ): Promise<T> {
    const previous = locks.get(key)
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const next = previous ? previous.catch(() => undefined).then(() => current) : current
    locks.set(key, next)

    if (previous) {
      await previous.catch(() => undefined)
    }

    try {
      return await task()
    } finally {
      release()
      if (locks.get(key) === next) {
        locks.delete(key)
      }
    }
  }

  private async deleteConversationSilently(conversationId: string): Promise<void> {
    try {
      await this.sqlitePresenter.deleteConversation(conversationId)
    } catch (error) {
      console.warn(
        `[ACP] Failed to delete duplicate imported conversation ${conversationId}:`,
        error
      )
    }
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
    if (workdir && this.isWorkdirUsable(workdir)) {
      return workdir.trim()
    }
    return this.getDefaultWorkdir()
  }

  isWorkdirUsable(workdir?: string | null): boolean {
    const trimmed = workdir?.trim()
    if (!trimmed) return false

    try {
      return Boolean(fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory())
    } catch {
      return false
    }
  }

  getDefaultWorkdir(): string {
    try {
      const home = app.getPath('home')
      if (this.isWorkdirUsable(home)) {
        return home
      }
    } catch {
      // fall through to process fallbacks
    }

    if (this.isWorkdirUsable(process.env.HOME)) {
      return process.env.HOME as string
    }

    return process.cwd()
  }

  private resolveRemoteSessionWorkdir(session: schema.SessionInfo, fallback: string): string {
    if (this.isWorkdirUsable(session.cwd)) {
      return session.cwd.trim()
    }
    return this.resolveWorkdir(fallback)
  }

  private resolveExistingSessionWorkdir(
    existingWorkdir: string | null | undefined,
    syncedWorkdir: string
  ): string {
    const trimmed = existingWorkdir?.trim()
    if (trimmed && this.isWorkdirUsable(trimmed)) {
      return trimmed
    }
    return syncedWorkdir
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
