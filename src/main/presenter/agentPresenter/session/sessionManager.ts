import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { IConfigPresenter, ISessionPresenter } from '@shared/presenter'
import type { AssistantMessageBlock } from '@shared/chat'
import type {
  PendingPermission,
  SessionContext,
  SessionContextResolved,
  SessionStatus
} from './sessionContext'
import { resolveSessionContext } from './sessionResolver'

type WorkspaceContext = {
  chatMode: 'agent' | 'acp agent'
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
        userStopRequested: false
      }
    }
    this.sessions.set(agentId, session)
    await this.hydratePendingQuestion(session)
    return session
  }

  async resolveSession(agentId: string): Promise<SessionContextResolved> {
    const conversation = await this.options.sessionPresenter.getConversation(agentId)
    const fallbackChatMode = this.options.configPresenter.getSetting('input_chatMode') as
      | 'agent'
      | 'acp agent'
      | undefined
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
    } else if (resolved.chatMode === 'acp agent') {
      const modelId = conversation.settings.modelId
      resolved.agentWorkspacePath =
        modelId && conversation.settings.acpWorkdirMap
          ? (conversation.settings.acpWorkdirMap[modelId] ?? null)
          : null
      resolved.acpWorkdirMap = conversation.settings.acpWorkdirMap
    } else {
      resolved.agentWorkspacePath = null
    }

    return resolved
  }

  async resolveWorkspaceContext(
    conversationId?: string,
    modelId?: string
  ): Promise<WorkspaceContext> {
    if (!conversationId) {
      const fallbackChatMode =
        (this.options.configPresenter.getSetting('input_chatMode') as
          | 'agent'
          | 'acp agent'
          | undefined) ?? 'agent'
      return { chatMode: fallbackChatMode, agentWorkspacePath: null }
    }

    try {
      const session = await this.getSession(conversationId)
      const resolved = session.resolved
      if (resolved.chatMode === 'acp agent') {
        const resolvedModelId = modelId ?? resolved.modelId
        const map = resolved.acpWorkdirMap
        const agentWorkspacePath = resolvedModelId && map ? (map[resolvedModelId] ?? null) : null
        return { chatMode: resolved.chatMode, agentWorkspacePath }
      }

      return {
        chatMode: resolved.chatMode,
        agentWorkspacePath: resolved.agentWorkspacePath ?? null
      }
    } catch (error) {
      console.warn('[SessionManager] Failed to resolve workspace context:', error)
      const fallbackChatMode =
        (this.options.configPresenter.getSetting('input_chatMode') as
          | 'agent'
          | 'acp agent'
          | undefined) ?? 'agent'
      return { chatMode: fallbackChatMode, agentWorkspacePath: null }
    }
  }

  async startLoop(
    agentId: string,
    messageId: string,
    options?: { preservePendingPermissions?: boolean; skipLockAcquisition?: boolean }
  ): Promise<void> {
    const session = await this.getSession(agentId)
    session.status = 'generating'
    session.updatedAt = Date.now()
    const runtime = this.ensureRuntime(session)
    runtime.loopId = messageId
    runtime.currentMessageId = messageId
    runtime.toolCallCount = 0
    runtime.userStopRequested = false

    // CRITICAL: Acquire permission resume lock BEFORE clearing pending permissions
    // This ensures atomic state transition during permission resume flow
    // skipLockAcquisition is used when PermissionHandler already holds the lock
    if (!options?.skipLockAcquisition) {
      const hasExistingLock = this.acquirePermissionResumeLock(agentId, messageId)
      if (!hasExistingLock) {
        console.warn(
          `[SessionManager] Lock already exists for message ${messageId}, skipping startLoop initialization`
        )
        return
      }
    }

    // CRITICAL: Only clear pending permissions if not preserving them
    // This is essential for multi-tool permission scenarios where we need to
    // execute one tool while waiting for approval of others
    if (!options?.preservePendingPermissions) {
      runtime.pendingPermission = undefined
      runtime.pendingPermissions = undefined
    }
    runtime.pendingQuestion = undefined

    // Note: lock is held via permissionResumeLock, will be released in PermissionHandler
    // after all tools in this resume batch are processed
  }

  setStatus(agentId: string, status: SessionStatus): void {
    const session = this.sessions.get(agentId)
    if (!session) return
    session.status = status
    session.updatedAt = Date.now()
  }

  getStatus(agentId: string): SessionStatus | null {
    const session = this.sessions.get(agentId)
    if (!session) return null
    return session.status
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
    this.updateRuntime(agentId, { pendingPermission: undefined, pendingPermissions: undefined })
  }

  clearPendingQuestion(agentId: string): void {
    this.updateRuntime(agentId, { pendingQuestion: undefined })
  }

  addPendingPermission(agentId: string, permission: PendingPermission): void {
    const session = this.sessions.get(agentId)
    if (!session) return
    const runtime = this.ensureRuntime(session)
    if (!runtime.pendingPermissions) {
      runtime.pendingPermissions = []
    }
    const existingIndex = runtime.pendingPermissions.findIndex(
      (p) => p.messageId === permission.messageId && p.toolCallId === permission.toolCallId
    )
    if (existingIndex >= 0) {
      runtime.pendingPermissions[existingIndex] = permission
    } else {
      runtime.pendingPermissions.push(permission)
    }
    runtime.pendingPermission = runtime.pendingPermissions[0]
    session.updatedAt = Date.now()
  }

  removePendingPermission(agentId: string, messageId: string, toolCallId: string): void {
    const session = this.sessions.get(agentId)
    if (!session) return
    const runtime = this.ensureRuntime(session)
    if (runtime.pendingPermissions) {
      runtime.pendingPermissions = runtime.pendingPermissions.filter(
        (p) => !(p.messageId === messageId && p.toolCallId === toolCallId)
      )
      runtime.pendingPermission = runtime.pendingPermissions[0]
    }
    session.updatedAt = Date.now()
  }

  getPendingPermissions(agentId: string): PendingPermission[] | undefined {
    const session = this.sessions.get(agentId)
    if (!session) return undefined
    const runtime = this.ensureRuntime(session)
    return runtime.pendingPermissions
  }

  hasPendingPermissions(agentId: string, messageId?: string): boolean {
    const pendingPerms = this.getPendingPermissions(agentId)
    if (!pendingPerms || pendingPerms.length === 0) return false
    if (messageId) {
      return pendingPerms.some((p) => p.messageId === messageId)
    }
    return true
  }

  acquirePermissionResumeLock(agentId: string, messageId: string): boolean {
    const session = this.sessions.get(agentId)
    if (!session) return false
    const runtime = this.ensureRuntime(session)
    if (runtime.permissionResumeLock?.messageId === messageId) {
      return false
    }
    runtime.permissionResumeLock = { messageId, startedAt: Date.now() }
    session.updatedAt = Date.now()
    return true
  }

  releasePermissionResumeLock(agentId: string): void {
    this.updateRuntime(agentId, { permissionResumeLock: undefined })
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

  getPermissionResumeLock(agentId: string): { messageId: string; startedAt: number } | undefined {
    const session = this.sessions.get(agentId)
    if (!session) return undefined
    const runtime = this.ensureRuntime(session)
    return runtime.permissionResumeLock
  }

  /**
   * Remove a session and clean up all pending state.
   * Critical for preventing stale permission data from affecting new sessions.
   */
  removeSession(agentId: string): void {
    const session = this.sessions.get(agentId)
    if (session?.runtime) {
      // Clear pending permissions to prevent stale data
      session.runtime.pendingPermissions = undefined
      session.runtime.pendingPermission = undefined
      // Clear permission resume lock
      session.runtime.permissionResumeLock = undefined
      // Clear pending question
      session.runtime.pendingQuestion = undefined
    }
    this.sessions.delete(agentId)
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
