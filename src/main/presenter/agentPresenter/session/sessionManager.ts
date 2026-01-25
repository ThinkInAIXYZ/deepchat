import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { IConfigPresenter, ISessionPresenter } from '@shared/presenter'
import type { SessionContext, SessionContextResolved, SessionStatus } from './sessionContext'
import { resolveSessionContext } from './sessionResolver'

type WorkspaceContext = {
  chatMode: 'agent'
  agentWorkspacePath: string | null
}

interface SessionManagerOptions {
  configPresenter: IConfigPresenter
  sessionPresenter: ISessionPresenter
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionContext>()
  private readonly options: SessionManagerOptions

  constructor(options: SessionManagerOptions) {
    this.options = options
  }

  /**
   * Sessions are keyed by agentId (conversationId in agent/chat flows).
   * ACP sessions use AcpSessionManager with separate ACP session IDs.
   */
  getSessionSync(agentId: string): SessionContext | null {
    return this.sessions.get(agentId) ?? null
  }

  /** Resolves (or creates) the session keyed by agentId/conversationId. */
  async getSession(agentId: string): Promise<SessionContext> {
    const existing = this.sessions.get(agentId)
    const resolved = await this.resolveSession(agentId)
    const now = Date.now()

    if (existing) {
      existing.resolved = resolved
      existing.updatedAt = now
      this.ensureRuntime(existing)
      return existing
    }

    const session: SessionContext = {
      sessionId: agentId,
      agentId,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      resolved,
      runtime: {
        toolCallCount: 0,
        userStopRequested: false
      }
    }
    this.sessions.set(agentId, session)
    return session
  }

  async resolveSession(agentId: string): Promise<SessionContextResolved> {
    const conversation = await this.options.sessionPresenter.getConversation(agentId)
    const rawFallbackChatMode = this.options.configPresenter.getSetting('input_chatMode') as
      | 'chat'
      | 'agent'
      | undefined
    const fallbackChatMode = rawFallbackChatMode === 'chat' ? 'agent' : rawFallbackChatMode
    const modelConfig = this.options.configPresenter.getModelDefaultConfig(
      conversation.settings.modelId,
      conversation.settings.providerId
    )

    const resolved = resolveSessionContext({
      settings: conversation.settings,
      fallbackChatMode,
      modelConfig
    })

    if (resolved.chatMode === 'agent') {
      resolved.agentWorkspacePath = await this.resolveAgentWorkspacePath(
        agentId,
        conversation.settings.agentWorkspacePath ?? null
      )
    } else {
      resolved.agentWorkspacePath = null
    }

    return resolved
  }

  async resolveWorkspaceContext(conversationId?: string): Promise<WorkspaceContext> {
    if (!conversationId) {
      const rawFallbackChatMode = this.options.configPresenter.getSetting('input_chatMode') as
        | 'chat'
        | 'agent'
        | undefined
      const fallbackChatMode =
        (rawFallbackChatMode === 'chat' ? 'agent' : rawFallbackChatMode) ?? 'agent'
      return { chatMode: fallbackChatMode, agentWorkspacePath: null }
    }

    try {
      const session = await this.getSession(conversationId)
      const resolved = session.resolved

      const normalizedChatMode = resolved.chatMode === 'chat' ? 'agent' : resolved.chatMode
      return {
        chatMode: normalizedChatMode,
        agentWorkspacePath: resolved.agentWorkspacePath ?? null
      }
    } catch (error) {
      console.warn('[SessionManager] Failed to resolve workspace context:', error)
      const rawFallbackChatMode = this.options.configPresenter.getSetting('input_chatMode') as
        | 'chat'
        | 'agent'
        | undefined
      const fallbackChatMode =
        (rawFallbackChatMode === 'chat' ? 'agent' : rawFallbackChatMode) ?? 'agent'
      return { chatMode: fallbackChatMode, agentWorkspacePath: null }
    }
  }

  async startLoop(agentId: string, messageId: string): Promise<void> {
    const session = await this.getSession(agentId)
    session.status = 'generating'
    session.updatedAt = Date.now()
    const runtime = this.ensureRuntime(session)
    runtime.loopId = messageId
    runtime.currentMessageId = messageId
    runtime.toolCallCount = 0
    runtime.userStopRequested = false
    runtime.pendingPermission = undefined
  }

  setStatus(agentId: string, status: SessionStatus): void {
    const session = this.sessions.get(agentId)
    if (!session) return
    session.status = status
    session.updatedAt = Date.now()
  }

  updateRuntime(agentId: string, updates: Partial<SessionContext['runtime']>): void {
    const session = this.sessions.get(agentId)
    if (!session) return
    const runtime = this.ensureRuntime(session)
    session.runtime = { ...runtime, ...updates }
    session.updatedAt = Date.now()
  }

  incrementToolCallCount(agentId: string): void {
    const session = this.sessions.get(agentId)
    if (!session) return
    const runtime = this.ensureRuntime(session)
    runtime.toolCallCount = (runtime.toolCallCount ?? 0) + 1
    session.updatedAt = Date.now()
  }

  clearPendingPermission(agentId: string): void {
    this.updateRuntime(agentId, { pendingPermission: undefined })
  }

  private ensureRuntime(session: SessionContext): NonNullable<SessionContext['runtime']> {
    if (!session.runtime) {
      session.runtime = {
        toolCallCount: 0,
        userStopRequested: false
      }
    } else {
      if (session.runtime.toolCallCount === undefined) {
        session.runtime.toolCallCount = 0
      }
      if (session.runtime.userStopRequested === undefined) {
        session.runtime.userStopRequested = false
      }
    }
    return session.runtime
  }

  private async resolveAgentWorkspacePath(
    conversationId: string | null,
    currentPath: string | null
  ): Promise<string | null> {
    const trimmedPath = currentPath?.trim()
    if (trimmedPath) return trimmedPath

    const fallback = await this.getDefaultAgentWorkspacePath(conversationId)
    if (conversationId && fallback) {
      try {
        await this.options.sessionPresenter.updateConversationSettings(conversationId, {
          agentWorkspacePath: fallback
        })
      } catch (error) {
        console.warn('[SessionManager] Failed to persist agent workspace path:', error)
      }
    }
    return fallback
  }

  private async getDefaultAgentWorkspacePath(conversationId?: string | null): Promise<string> {
    const tempRoot = path.join(app.getPath('temp'), 'deepchat-agent', 'workspaces')
    try {
      await fs.promises.mkdir(tempRoot, { recursive: true })
    } catch (error) {
      console.warn(
        '[SessionManager] Failed to create default workspace root, using system temp:',
        error
      )
      return app.getPath('temp')
    }

    if (!conversationId) {
      return tempRoot
    }

    const workspaceDir = path.join(tempRoot, conversationId)
    try {
      await fs.promises.mkdir(workspaceDir, { recursive: true })
      return workspaceDir
    } catch (error) {
      console.warn(
        '[SessionManager] Failed to create conversation workspace, using root temp workspace:',
        error
      )
      return tempRoot
    }
  }
}
