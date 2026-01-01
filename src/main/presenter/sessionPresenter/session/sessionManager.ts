import type { IConfigPresenter } from '@shared/presenter'
import type {
  Session,
  SessionStatus,
  SessionRuntime,
  WorkspaceContext,
  SessionConfig
} from '../types'

export interface SessionManagerOptions {
  configPresenter: IConfigPresenter
  conversationPersister: any
}

export class SessionManager {
  private sessions: Map<string, Session>

  constructor(private readonly options: SessionManagerOptions) {
    this.sessions = new Map()
  }

  getSessionSync(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null
  }

  async getSession(sessionId: string): Promise<Session> {
    const existing = this.sessions.get(sessionId)
    const now = Date.now()

    if (existing) {
      existing.updatedAt = now
      existing.runtime = this.ensureRuntime(existing.runtime)
      return existing
    }

    throw new Error(`Session ${sessionId} not found. Use createSession first.`)
  }

  async createSession(conversation: any): Promise<Session> {
    const existing = this.sessions.get(conversation.id)

    if (existing) {
      return existing
    }

    const config = this.buildSessionConfig(conversation)
    const context = await this.buildWorkspaceContext(config, conversation)

    const session: Session = {
      sessionId: conversation.id,
      status: 'idle',
      config,
      bindings: {
        tabId: null,
        windowId: null,
        windowType: null
      },
      runtime: {
        toolCallCount: 0,
        userStopRequested: false
      },
      context,
      createdAt: conversation.createdAt,
      updatedAt: Date.now()
    }

    this.sessions.set(conversation.id, session)
    return session
  }

  startLoop(sessionId: string, messageId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    session.status = 'generating'
    session.updatedAt = Date.now()

    const runtime = this.ensureRuntime(session.runtime)
    runtime.loopId = messageId
    runtime.currentMessageId = messageId
    runtime.toolCallCount = 0
    runtime.userStopRequested = false
    runtime.pendingPermission = undefined
  }

  setStatus(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.status = status
    session.updatedAt = Date.now()
  }

  updateRuntime(sessionId: string, updates: Partial<SessionRuntime>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const runtime = this.ensureRuntime(session.runtime)
    session.runtime = { ...runtime, ...updates }
    session.updatedAt = Date.now()
  }

  incrementToolCallCount(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const runtime = this.ensureRuntime(session.runtime)
    runtime.toolCallCount = (runtime.toolCallCount ?? 0) + 1
    session.updatedAt = Date.now()
  }

  clearPendingPermission(sessionId: string): void {
    this.updateRuntime(sessionId, { pendingPermission: undefined })
  }

  updateContext(sessionId: string, context: Partial<WorkspaceContext>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.context = { ...session.context, ...context }
    session.updatedAt = Date.now()
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  async updateSessionConfig(sessionId: string, updates: Partial<Session['config']>): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.config = { ...session.config, ...updates }
    session.updatedAt = Date.now()

    const context = await this.buildWorkspaceContext(session.config, { settings: session.config })
    session.context = { ...session.context, ...context }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values())
  }

  private buildSessionConfig(conversation: any): SessionConfig {
    const { providerId, modelId, settings } = conversation
    const modelConfig = this.options.configPresenter.getModelConfig(modelId, providerId)

    return {
      sessionId: conversation.id,
      title: conversation.title,
      providerId,
      modelId,
      chatMode: settings.chatMode ?? 'chat',
      systemPrompt: settings.systemPrompt || '',
      maxTokens: settings.maxTokens,
      temperature: settings.temperature,
      contextLength: settings.contextLength,
      supportsVision: modelConfig?.vision ?? false,
      supportsFunctionCall: modelConfig?.functionCall ?? false,
      thinkingBudget: settings.thinkingBudget ?? modelConfig?.thinkingBudget,
      reasoningEffort: settings.reasoningEffort ?? modelConfig?.reasoningEffort,
      verbosity: settings.verbosity,
      enableSearch: settings.enableSearch,
      forcedSearch: settings.forcedSearch,
      searchStrategy: settings.searchStrategy,
      enabledMcpTools: settings.enabledMcpTools,
      agentWorkspacePath: settings.agentWorkspacePath ?? null,
      acpWorkdirMap: settings.acpWorkdirMap,
      selectedVariantsMap: settings.selectedVariantsMap,
      isPinned: conversation.is_pinned === 1
    }
  }

  private async buildWorkspaceContext(
    config: SessionConfig,
    conversation: any
  ): Promise<WorkspaceContext> {
    const context: WorkspaceContext = {
      resolvedChatMode: config.chatMode,
      agentWorkspacePath: null
    }

    if (config.chatMode === 'agent') {
      let workspacePath = config.agentWorkspacePath

      if (!workspacePath) {
        workspacePath = await this.getDefaultAgentWorkspacePath(conversation.id)
      }

      context.agentWorkspacePath = workspacePath
    } else if (config.chatMode === 'acp agent') {
      const acpWorkdir = config.acpWorkdirMap?.[config.modelId]
      context.agentWorkspacePath = acpWorkdir ?? null
      context.acpWorkdirMap = config.acpWorkdirMap
    }

    return context
  }

  private getDefaultAgentWorkspacePath(_conversationId: string): Promise<string> {
    throw new Error('getDefaultAgentWorkspacePath not implemented')
  }

  private ensureRuntime(runtime?: SessionRuntime): NonNullable<SessionRuntime> {
    if (!runtime) {
      return {
        toolCallCount: 0,
        userStopRequested: false
      }
    } else {
      if (runtime.toolCallCount === undefined) {
        runtime.toolCallCount = 0
      }
      if (runtime.userStopRequested === undefined) {
        runtime.userStopRequested = false
      }
      return runtime as NonNullable<SessionRuntime>
    }
  }
}
