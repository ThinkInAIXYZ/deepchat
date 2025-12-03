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
import { AcpSessionPersistence } from './acpSessionPersistence'

interface AcpSessionManagerOptions {
  providerId: string
  processManager: AcpProcessManager
  sessionPersistence: AcpSessionPersistence
}

interface SessionHooks {
  onSessionUpdate: SessionNotificationHandler
  onPermission: PermissionResolver
}

export interface AcpSessionRecord extends AgentSessionState {
  connection: ClientSideConnectionType
  detachHandlers: Array<() => void>
  workdir: string
  availableModes?: Array<{ id: string; name: string; description: string }>
  currentModeId?: string
  availableCommands?: Array<{ name: string; description: string }>
}

export class AcpSessionManager {
  private readonly providerId: string
  private readonly processManager: AcpProcessManager
  private readonly sessionPersistence: AcpSessionPersistence
  private readonly sessionsByConversation = new Map<string, AcpSessionRecord>()
  private readonly sessionsById = new Map<string, AcpSessionRecord>()
  private readonly pendingSessions = new Map<string, Promise<AcpSessionRecord>>()

  constructor(options: AcpSessionManagerOptions) {
    this.providerId = options.providerId
    this.processManager = options.processManager
    this.sessionPersistence = options.sessionPersistence

    app.on('before-quit', () => {
      void this.clearAllSessions()
    })
  }

  async getOrCreateSession(
    conversationId: string,
    agent: AcpAgentConfig,
    hooks: SessionHooks,
    workdir?: string | null
  ): Promise<AcpSessionRecord> {
    const resolvedWorkdir = this.sessionPersistence.resolveWorkdir(workdir)
    const existing = this.sessionsByConversation.get(conversationId)
    if (existing && existing.agentId === agent.id && existing.workdir === resolvedWorkdir) {
      // Reuse existing session, but update hooks for new conversation turn
      // Clean up old handlers
      existing.detachHandlers.forEach((dispose) => {
        try {
          dispose()
        } catch (error) {
          console.warn('[ACP] Failed to dispose old session handler:', error)
        }
      })
      // Register new handlers
      existing.detachHandlers = this.attachSessionHooks(agent.id, existing.sessionId, hooks)
      existing.workdir = resolvedWorkdir
      return existing
    }
    if (existing) {
      await this.clearSession(conversationId)
    }

    const inflight = this.pendingSessions.get(conversationId)
    if (inflight) {
      return inflight
    }

    const createPromise = this.createSession(conversationId, agent, hooks, resolvedWorkdir)
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

  getSession(conversationId: string): AcpSessionRecord | null {
    return this.sessionsByConversation.get(conversationId) ?? null
  }

  getSessionById(sessionId: string): AcpSessionRecord | null {
    return this.sessionsById.get(sessionId) ?? null
  }

  listSessions(): AcpSessionRecord[] {
    return Array.from(this.sessionsByConversation.values())
  }

  async clearSessionsByAgent(agentId: string): Promise<void> {
    const targets = Array.from(this.sessionsByConversation.entries()).filter(
      ([, session]) => session.agentId === agentId
    )
    await Promise.allSettled(targets.map(([conversationId]) => this.clearSession(conversationId)))
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

    await this.sessionPersistence.clearSession(conversationId, session.agentId)
  }

  async clearAllSessions(): Promise<void> {
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
    hooks: SessionHooks,
    workdir: string
  ): Promise<AcpSessionRecord> {
    const handle = await this.processManager.getConnection(agent)
    const session = await this.initializeSession(handle, agent, workdir)
    const detachListeners = this.attachSessionHooks(agent.id, session.sessionId, hooks)

    // Register session workdir for fs/terminal operations
    this.processManager.registerSessionWorkdir(session.sessionId, workdir)

    void this.sessionPersistence
      .saveSessionData(conversationId, agent.id, session.sessionId, workdir, 'active', {
        agentName: agent.name
      })
      .catch((error) => {
        console.warn('[ACP] Failed to persist session metadata:', error)
      })

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
      detachHandlers: detachListeners,
      workdir,
      availableModes: session.availableModes,
      currentModeId: session.currentModeId
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
    agent: AcpAgentConfig,
    workdir: string
  ): Promise<{
    sessionId: string
    availableModes?: Array<{ id: string; name: string; description: string }>
    currentModeId?: string
  }> {
    try {
      const response = await handle.connection.newSession({
        cwd: workdir,
        mcpServers: []
      })

      // Extract modes from response if available
      const modes = response.modes

      return {
        sessionId: response.sessionId,
        availableModes: modes?.availableModes?.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description ?? ''
        })),
        currentModeId: modes?.currentModeId
      }
    } catch (error) {
      console.error(`[ACP] Failed to create session for agent ${agent.id}:`, error)
      throw error
    }
  }
}
