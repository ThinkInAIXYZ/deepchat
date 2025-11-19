import { app } from 'electron'
import type { AcpAgentConfig } from '@shared/presenter'
import type { AgentSessionState } from './types'
import type {
  AcpProcessManager,
  AcpProcessHandle,
  PermissionResolver,
  SessionNotificationHandler
} from './acpProcessManager'
import type { ClientSideConnection as ClientSideConnectionType } from '@agentclientprotocol/sdk'

interface AcpSessionManagerOptions {
  providerId: string
  processManager: AcpProcessManager
}

interface SessionHooks {
  onSessionUpdate: SessionNotificationHandler
  onPermission: PermissionResolver
}

interface ManagedSession extends AgentSessionState {
  connection: ClientSideConnectionType
  detachHandlers: Array<() => void>
}

export class AcpSessionManager {
  private readonly providerId: string
  private readonly processManager: AcpProcessManager
  private readonly sessionsByConversation = new Map<string, ManagedSession>()
  private readonly sessionsById = new Map<string, ManagedSession>()
  private readonly pendingSessions = new Map<string, Promise<ManagedSession>>()

  constructor(options: AcpSessionManagerOptions) {
    this.providerId = options.providerId
    this.processManager = options.processManager

    app.on('before-quit', () => {
      void this.clearAll()
    })
  }

  async getOrCreateSession(
    conversationId: string,
    agent: AcpAgentConfig,
    hooks: SessionHooks
  ): Promise<ManagedSession> {
    const existing = this.sessionsByConversation.get(conversationId)
    if (existing && existing.agentId === agent.id) {
      return existing
    }
    if (existing && existing.agentId !== agent.id) {
      await this.clearSession(conversationId)
    }

    const inflight = this.pendingSessions.get(conversationId)
    if (inflight) {
      return inflight
    }

    const createPromise = this.createSession(conversationId, agent, hooks)
    this.pendingSessions.set(conversationId, createPromise)
    try {
      const session = await createPromise
      this.sessionsByConversation.set(conversationId, session)
      this.sessionsById.set(session.sessionId, session)
      return session
    } finally {
      this.pendingSessions.delete(conversationId)
    }
  }

  getSession(conversationId: string): ManagedSession | null {
    return this.sessionsByConversation.get(conversationId) ?? null
  }

  getSessionById(sessionId: string): ManagedSession | null {
    return this.sessionsById.get(sessionId) ?? null
  }

  async clearSession(conversationId: string): Promise<void> {
    const session = this.sessionsByConversation.get(conversationId)
    if (!session) return

    this.sessionsByConversation.delete(conversationId)
    this.sessionsById.delete(session.sessionId)
    session.detachHandlers.forEach((dispose) => {
      try {
        dispose()
      } catch (error) {
        console.warn('[ACP] Failed to dispose session handler:', error)
      }
    })

    this.processManager.clearSession(session.sessionId)

    try {
      await session.connection.cancel({ sessionId: session.sessionId })
    } catch (error) {
      console.warn(`[ACP] Failed to cancel session ${session.sessionId}:`, error)
    }
  }

  async clearAll(): Promise<void> {
    const clears = Array.from(this.sessionsByConversation.keys()).map((conversationId) =>
      this.clearSession(conversationId)
    )
    await Promise.allSettled(clears)
    this.sessionsByConversation.clear()
    this.sessionsById.clear()
    this.pendingSessions.clear()
  }

  private async createSession(
    conversationId: string,
    agent: AcpAgentConfig,
    hooks: SessionHooks
  ): Promise<ManagedSession> {
    const handle = await this.processManager.getConnection(agent)
    const session = await this.initializeSession(handle, agent)
    const detachListeners = this.attachSessionHooks(agent.id, session.sessionId, hooks)

    return {
      ...session,
      providerId: this.providerId,
      agentId: agent.id,
      conversationId,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: { agentName: agent.name },
      connection: handle.connection,
      detachHandlers: detachListeners
    }
  }

  private attachSessionHooks(
    agentId: string,
    sessionId: string,
    hooks: SessionHooks
  ): Array<() => void> {
    const detachUpdate = this.processManager.registerSessionListener(
      agentId,
      sessionId,
      hooks.onSessionUpdate
    )
    const detachPermission = this.processManager.registerPermissionResolver(
      agentId,
      sessionId,
      hooks.onPermission
    )
    return [detachUpdate, detachPermission]
  }

  private async initializeSession(
    handle: AcpProcessHandle,
    agent: AcpAgentConfig
  ): Promise<{ sessionId: string }> {
    try {
      const response = await handle.connection.newSession({
        cwd: process.cwd(),
        mcpServers: []
      })
      return { sessionId: response.sessionId }
    } catch (error) {
      console.error(`[ACP] Failed to create session for agent ${agent.id}:`, error)
      throw error
    }
  }
}
