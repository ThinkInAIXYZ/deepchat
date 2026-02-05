import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { IConfigPresenter, ISessionPresenter } from '@shared/presenter'
import type { AssistantMessageBlock } from '@shared/chat'
import type { SessionContext, SessionContextResolved, SessionStatus } from './sessionContext'
import { resolveSessionContext } from './sessionResolver'

type WorkspaceContext = {
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
      await this.hydratePendingQuestion(existing)
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
        userStopRequested: false,
        activeSkills: []
      }
    }
    this.sessions.set(agentId, session)
    await this.hydratePendingQuestion(session)
    return session
  }

  async resolveSession(agentId: string): Promise<SessionContextResolved> {
    const conversation = await this.options.sessionPresenter.getConversation(agentId)
    const modelConfig = this.options.configPresenter.getModelDefaultConfig(
      conversation.settings.modelId,
      conversation.settings.providerId
    )

    const resolved = resolveSessionContext({
      settings: conversation.settings,
      modelConfig
    })

    resolved.agentWorkspacePath = await this.resolveAgentWorkspacePath(
      agentId,
      conversation.settings.agentWorkspacePath ?? null
    )

    return resolved
  }

  async resolveWorkspaceContext(conversationId?: string): Promise<WorkspaceContext> {
    if (!conversationId) {
      return { agentWorkspacePath: null }
    }

    try {
      const session = await this.getSession(conversationId)
      const resolved = session.resolved

      return {
        agentWorkspacePath: resolved.agentWorkspacePath ?? null
      }
    } catch (error) {
      console.warn('[SessionManager] Failed to resolve workspace context:', error)
      return { agentWorkspacePath: null }
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
    runtime.pendingQuestion = undefined
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

  clearPendingQuestion(agentId: string): void {
    this.updateRuntime(agentId, { pendingQuestion: undefined })
  }

  private ensureRuntime(session: SessionContext): NonNullable<SessionContext['runtime']> {
    if (!session.runtime) {
      session.runtime = {
        toolCallCount: 0,
        userStopRequested: false,
        activeSkills: []
      }
    } else {
      if (session.runtime.toolCallCount === undefined) {
        session.runtime.toolCallCount = 0
      }
      if (session.runtime.userStopRequested === undefined) {
        session.runtime.userStopRequested = false
      }
      if (session.runtime.activeSkills === undefined) {
        session.runtime.activeSkills = []
      }
    }
    return session.runtime
  }

  private async hydratePendingQuestion(session: SessionContext): Promise<void> {
    const runtime = this.ensureRuntime(session)
    if (runtime.pendingQuestionInitialized) return
    runtime.pendingQuestionInitialized = true
    if (runtime.pendingQuestion) return

    try {
      const lastAssistant = await this.options.sessionPresenter.getLastAssistantMessage(
        session.agentId
      )
      if (!lastAssistant || lastAssistant.role !== 'assistant') {
        return
      }

      const blocks = lastAssistant.content as AssistantMessageBlock[]
      if (!Array.isArray(blocks) || blocks.length === 0) {
        return
      }

      const pendingQuestionBlock = [...blocks].reverse().find((block) => {
        if (
          block.type !== 'action' ||
          block.action_type !== 'question_request' ||
          block.status !== 'pending'
        ) {
          return false
        }
        if (block.extra && block.extra.needsUserAction === false) {
          return false
        }
        return Boolean(block.tool_call?.id)
      })

      const toolCallId = pendingQuestionBlock?.tool_call?.id
      if (!toolCallId) return

      runtime.pendingQuestion = {
        messageId: lastAssistant.id,
        toolCallId
      }
      session.status = 'waiting_question'
      session.updatedAt = Date.now()
    } catch (error) {
      console.warn('[SessionManager] Failed to hydrate pending question:', error)
    }
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
