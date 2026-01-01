import type { ISessionPresenter } from './interface'
import type { SessionManager } from './session/sessionManager'
import type { TabManager } from './tab/tabManager'
import type { ConversationPersister } from './persistence/conversationPersister'
import type { MessagePersister } from './persistence/messagePersister'
import type { AgentLoopHandler } from './loop/agentLoopHandler'
import type { ToolCallCenter } from './tool/toolCallCenter'
import type { IToolPresenter } from '@shared/presenter'
import type { IConfigPresenter } from '@shared/presenter'
import type { Session, SessionRuntime, SessionStatus, CreateSessionParams } from './types'
import type { Message, AssistantMessage } from '@shared/chat'
import type { CONVERSATION_SETTINGS, SQLITE_MESSAGE } from '@shared/presenter'

interface SessionPresenterDependencies {
  sessionManager: SessionManager
  tabManager: TabManager
  conversationPersister: ConversationPersister
  messagePersister: MessagePersister
  agentLoopHandler: AgentLoopHandler
  toolCallCenter: ToolCallCenter
  configPresenter: IConfigPresenter
  toolPresenter: IToolPresenter
}

export class SessionPresenter implements ISessionPresenter {
  private readonly sessionManager: SessionManager
  private readonly tabManager: TabManager
  private readonly conversationPersister: ConversationPersister
  private readonly messagePersister: MessagePersister
  private readonly agentLoopHandler: AgentLoopHandler
  private readonly toolCallCenter: ToolCallCenter
  private readonly configPresenter: IConfigPresenter

  constructor(dependencies: SessionPresenterDependencies) {
    this.sessionManager = dependencies.sessionManager
    this.tabManager = dependencies.tabManager
    this.conversationPersister = dependencies.conversationPersister
    this.messagePersister = dependencies.messagePersister
    this.agentLoopHandler = dependencies.agentLoopHandler
    this.toolCallCenter = dependencies.toolCallCenter
    this.configPresenter = dependencies.configPresenter
  }

  // === Session Lifecycle ===

  async createSession(params: CreateSessionParams): Promise<string> {
    const settings = this.mergeWithDefaultSettings(params.settings || {})
    const conversationId = await this.conversationPersister.createConversation(
      params.title,
      settings
    )
    await this.sessionManager.createSession({ id: conversationId, ...params, settings })
    return conversationId
  }

  async getSession(sessionId: string): Promise<Session> {
    return await this.sessionManager.getSession(sessionId)
  }

  async getSessionList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; sessions: Session[] }> {
    const result = await this.conversationPersister.getConversationList(page, pageSize)
    const sessions = await Promise.all(
      result.list.map((conv) => this.sessionManager.getSession(conv.id))
    )
    return { total: result.total, sessions }
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.conversationPersister.renameConversation(sessionId, title)
    const session = await this.sessionManager.getSession(sessionId)
    session.config.title = title
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.conversationPersister.deleteConversation(sessionId)
    this.tabManager.unbindAllForSession(sessionId)
    this.sessionManager.deleteSession(sessionId)
  }

  async toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    await this.conversationPersister.toggleConversationPinned(sessionId, pinned)
    const session = await this.sessionManager.getSession(sessionId)
    session.config.isPinned = pinned
  }

  async updateSessionSettings(
    sessionId: string,
    settings: Partial<Session['config']>
  ): Promise<void> {
    await this.conversationPersister.updateConversation(sessionId, settings as any)
    await this.sessionManager.updateSessionConfig(sessionId, settings)
  }

  async forkSession(
    targetSessionId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<Session['config']>,
    selectedVariantsMap?: Record<string, string>
  ): Promise<string> {
    await this.deleteMessage(targetMessageId)
    await this.updateSessionSettings(targetSessionId, {
      title: newTitle,
      ...(settings || {}),
      selectedVariantsMap
    })
    return targetSessionId
  }

  // === Session-Tab Binding ===

  async bindToTab(sessionId: string, tabId: number): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId)
    await this.tabManager.bindToTab(sessionId, tabId, session.bindings.windowType || 'main')
  }

  async unbindFromTab(tabId: number): Promise<void> {
    await this.tabManager.unbindFromTab(tabId)
  }

  async activateSession(tabId: number, sessionId: string): Promise<void> {
    await this.tabManager.activateSession(tabId, sessionId)
  }

  async getActiveSession(tabId: number): Promise<Session | null> {
    const sessionId = this.tabManager.getBoundSession(tabId)
    if (!sessionId) return null
    return await this.sessionManager.getSession(sessionId)
  }

  async findTabForSession(
    sessionId: string,
    preferredWindowType?: 'main' | 'floating'
  ): Promise<number | null> {
    return await this.tabManager.findTabForSession(sessionId, preferredWindowType)
  }

  // === Message ===

  async sendMessage(
    _sessionId: string,
    _content: string,
    _tabId?: number,
    _selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage | null> {
    throw new Error('sendMessage not implemented yet')
  }

  async editMessage(messageId: string, content: string): Promise<Message> {
    throw new Error('editMessage not implemented yet')
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.messagePersister.deleteMessage(messageId)
  }

  async retryMessage(messageId: string): Promise<Message> {
    throw new Error('retryMessage not implemented yet')
  }

  async getMessage(messageId: string): Promise<Message> {
    const sqliteMessage = await this.messagePersister.getMessage(messageId)
    if (!sqliteMessage) {
      throw new Error(`Message ${messageId} not found`)
    }
    return this.transformToUIMessage(sqliteMessage)
  }

  async getMessageVariants(messageId: string): Promise<Message[]> {
    const variants = await this.messagePersister.getMessageVariants(messageId)
    return variants.map((v) => this.transformToUIMessage(v))
  }

  async getMessageThread(
    sessionId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; messages: Message[] }> {
    throw new Error('getMessageThread not implemented yet')
  }

  async updateMessageStatus(
    messageId: string,
    status: 'pending' | 'generating' | 'sent' | 'error'
  ): Promise<void> {
    const sqliteStatus = status === 'generating' ? 'pending' : status
    await this.messagePersister.updateMessage(messageId, { status: sqliteStatus })
  }

  async updateMessageMetadata(messageId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.messagePersister.updateMessage(messageId, { metadata: JSON.stringify(metadata) })
  }

  async getContextMessages(sessionId: string, messageCount: number): Promise<Message[]> {
    throw new Error('getContextMessages not implemented yet')
  }

  async getLastUserMessage(sessionId: string): Promise<Message | null> {
    const sqliteMessage = await this.messagePersister.getLastUserMessage(sessionId)
    return sqliteMessage ? this.transformToUIMessage(sqliteMessage) : null
  }

  // === Loop Control ===

  async continueLoop(
    _sessionId: string,
    _messageId: string,
    _selectedVariantsMap?: Record<string, string>
  ): Promise<void> {
    throw new Error('continueLoop not implemented yet')
  }

  async cancelLoop(_sessionId: string, _messageId: string): Promise<void> {
    throw new Error('cancelLoop not implemented yet')
  }

  async startLoop(sessionId: string, messageId: string): Promise<void> {
    await this.sessionManager.startLoop(sessionId, messageId)
  }

  async updateRuntime(sessionId: string, updates: Partial<SessionRuntime>): Promise<void> {
    await this.sessionManager.updateRuntime(sessionId, updates)
  }

  async setStatus(sessionId: string, status: SessionStatus): Promise<void> {
    this.sessionManager.setStatus(sessionId, status)
    return Promise.resolve()
  }

  async incrementToolCallCount(sessionId: string): Promise<void> {
    this.sessionManager.incrementToolCallCount(sessionId)
    return Promise.resolve()
  }

  // === Permission ===

  async handlePermissionResponse(
    _messageId: string,
    _toolCallId: string,
    _granted: boolean,
    _permissionType: 'read' | 'write' | 'all' | 'command',
    _remember?: boolean
  ): Promise<void> {
    throw new Error('handlePermissionResponse not implemented yet')
  }

  // === Utility ===

  async translateText(_sessionId: string, _text: string, _tabId: number): Promise<string> {
    throw new Error('translateText not implemented yet')
  }

  async exportSession(_sessionId: string, _format: 'markdown' | 'html' | 'txt'): Promise<string> {
    throw new Error('exportSession not implemented yet')
  }

  async previewMessages(
    _sessionId: string,
    _messageCount: number,
    _contextLength: number,
    _includeImages: boolean
  ): Promise<{ messages: Message[]; totalTokens: number }> {
    throw new Error('previewMessages not implemented yet')
  }

  // === Private Helper Methods ===

  private mergeWithDefaultSettings(
    settings: Partial<CONVERSATION_SETTINGS>
  ): CONVERSATION_SETTINGS {
    return {
      chatMode: settings.chatMode ?? 'chat',
      maxTokens: settings.maxTokens ?? 4096,
      temperature: settings.temperature ?? 0.7,
      contextLength: settings.contextLength ?? 8192,
      systemPrompt: settings.systemPrompt ?? '',
      providerId: settings.providerId ?? '',
      modelId: settings.modelId ?? '',
      artifacts: settings.artifacts ?? 0,
      ...settings
    }
  }

  private transformToUIMessage(sqliteMessage: SQLITE_MESSAGE): Message {
    const content = this.parseMessageContent(sqliteMessage.content as any, sqliteMessage.role)

    return {
      id: sqliteMessage.id,
      role: sqliteMessage.role,
      content: content as any,
      timestamp: sqliteMessage.created_at,
      avatar: '',
      name: '',
      model_name: '',
      model_id: '',
      model_provider: '',
      status: sqliteMessage.status,
      error: '',
      usage: {
        context_usage: 0,
        tokens_per_second: 0,
        total_tokens: 0,
        generation_time: 0,
        first_token_time: 0,
        reasoning_start_time: 0,
        reasoning_end_time: 0,
        input_tokens: 0,
        output_tokens: 0
      },
      conversationId: sqliteMessage.conversation_id,
      is_variant: sqliteMessage.is_variant
    }
  }

  private parseMessageContent(rawContent: string | any, role: string): any {
    // If already parsed and an array, return as-is
    if (Array.isArray(rawContent)) {
      return rawContent
    }

    // If it's already an object (not string), return as-is
    if (rawContent && typeof rawContent === 'object') {
      return rawContent
    }

    // For assistant role, try to parse JSON blocks
    if (role === 'assistant') {
      try {
        const parsed = JSON.parse(rawContent)
        if (Array.isArray(parsed)) {
          return parsed
        }
      } catch {
        // Not valid JSON, wrap in content block
      }
      return [{ type: 'content', content: rawContent, status: 'success', timestamp: Date.now() }]
    }

    // For user role, create UserMessageContent
    return {
      text: rawContent,
      files: [],
      links: [],
      think: false,
      search: false
    }
  }
}
