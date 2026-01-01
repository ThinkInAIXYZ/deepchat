import type { ISessionPresenter } from './interface'
import type { SessionManager } from './session/sessionManager'
import type { TabManager } from './tab/tabManager'
import type { ConversationPersister } from './persistence/conversationPersister'
import type { MessagePersister } from './persistence/messagePersister'
import type { AgentLoopHandler } from './loop/agentLoopHandler'
import type { ToolCallCenter } from './tool/toolCallCenter'
import type { IToolPresenter, ILlmProviderPresenter } from '@shared/presenter'
import type { IConfigPresenter } from '@shared/presenter'
import type { Session, SessionRuntime, SessionStatus, CreateSessionParams } from './types'
import type { Message, AssistantMessage } from '@shared/chat'
import type { CONVERSATION_SETTINGS, SQLITE_MESSAGE } from '@shared/presenter'
import { LoopOrchestrator } from './loop/loopOrchestrator'
import { preparePromptContent } from './message/messageBuilder'

interface SessionPresenterDependencies {
  sessionManager: SessionManager
  tabManager: TabManager
  conversationPersister: ConversationPersister
  messagePersister: MessagePersister
  agentLoopHandler: AgentLoopHandler
  toolCallCenter: ToolCallCenter
  configPresenter: IConfigPresenter
  toolPresenter: IToolPresenter
  llmProviderPresenter: ILlmProviderPresenter
}

interface SessionState {
  isGenerating: boolean
  abortController: AbortController
}

export class SessionPresenter implements ISessionPresenter {
  private readonly sessionManager: SessionManager
  private readonly tabManager: TabManager
  private readonly conversationPersister: ConversationPersister
  private readonly messagePersister: MessagePersister
  private readonly agentLoopHandler: AgentLoopHandler
  private readonly toolCallCenter: ToolCallCenter
  private readonly configPresenter: IConfigPresenter
  private readonly llmProviderPresenter: ILlmProviderPresenter

  private readonly activeLoops: Map<string, SessionState> = new Map()
  private readonly loopOrchestrator: LoopOrchestrator

  constructor(dependencies: SessionPresenterDependencies) {
    this.sessionManager = dependencies.sessionManager
    this.tabManager = dependencies.tabManager
    this.conversationPersister = dependencies.conversationPersister
    this.messagePersister = dependencies.messagePersister
    this.agentLoopHandler = dependencies.agentLoopHandler
    this.toolCallCenter = dependencies.toolCallCenter
    this.configPresenter = dependencies.configPresenter
    this.llmProviderPresenter = dependencies.llmProviderPresenter

    this.loopOrchestrator = new LoopOrchestrator({
      handleLLMAgentResponse: async (msg) => {
        this.handleLLMAgentResponse(msg)
      },
      handleLLMAgentError: async (msg) => {
        this.handleLLMAgentError(msg)
      },
      handleLLMAgentEnd: async (msg) => {
        await this.handleLLMAgentEnd(msg)
      }
    })
  }

  private async handleLLMAgentResponse(msg: any): Promise<void> {
    console.log('[SessionPresenter] LLM response:', msg.eventId, msg.content?.substring(0, 100))
    if (msg.eventId && msg.content) {
      await this.messagePersister.updateMessage(msg.eventId, {
        content: JSON.stringify([
          { type: 'content', content: msg.content, status: 'success', timestamp: Date.now() }
        ])
      })
    }
  }

  private async handleLLMAgentError(msg: any): Promise<void> {
    console.error('[SessionPresenter] LLM error:', msg.eventId, msg.error)
    if (msg.eventId) {
      await this.messagePersister.updateMessage(msg.eventId, {
        status: 'error'
      })
    }
    this.activeLoops.delete(msg.eventId)
    await this.sessionManager.setStatus(msg.eventId, 'idle')
  }

  private async handleLLMAgentEnd(msg: any): Promise<void> {
    console.log('[SessionPresenter] LLM end:', msg.eventId)
    const sessionState = this.activeLoops.get(msg.eventId)
    if (sessionState) {
      this.activeLoops.delete(msg.eventId)
    }
    if (msg.eventId) {
      await this.messagePersister.updateMessage(msg.eventId, {
        status: 'sent'
      })
    }
    await this.sessionManager.setStatus(msg.eventId, 'idle')
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
    sessionId: string,
    content: string,
    _tabId?: number,
    _selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage | null> {
    const session = await this.sessionManager.getSession(sessionId)

    // Create user message
    const userMessageId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    await this.messagePersister.insertMessage(
      sessionId,
      content,
      'user',
      '',
      JSON.stringify({
        contextUsage: 0,
        totalTokens: 0,
        generationTime: 0,
        firstTokenTime: 0,
        tokensPerSecond: 0,
        inputTokens: 0,
        outputTokens: 0,
        model: session.config.modelId,
        provider: session.config.providerId
      }),
      0,
      0,
      'sent',
      0,
      0
    )

    // Create assistant message stub
    const assistantMessageId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    await this.messagePersister.insertMessage(
      sessionId,
      '[]',
      'assistant',
      userMessageId,
      JSON.stringify({
        contextUsage: 0,
        totalTokens: 0,
        generationTime: 0,
        firstTokenTime: 0,
        tokensPerSecond: 0,
        inputTokens: 0,
        outputTokens: 0
      }),
      0,
      0,
      'pending',
      0,
      0
    )

    // Start loop and create abort controller
    await this.startLoop(sessionId, assistantMessageId)
    const abortController = new AbortController()
    this.activeLoops.set(sessionId, {
      isGenerating: true,
      abortController
    })

    try {
      // Get conversation/settings from Session
      const conversation = await this.conversationPersister.getConversation(sessionId)
      if (!conversation) {
        throw new Error(`Conversation not found: ${sessionId}`)
      }

      const {
        providerId,
        modelId,
        temperature,
        maxTokens,
        enabledMcpTools,
        thinkingBudget,
        reasoningEffort,
        verbosity,
        enableSearch,
        forcedSearch,
        searchStrategy
      } = conversation.settings

      // Get recent context messages
      const allMessages = await this.messagePersister.queryMessages(sessionId)
      const recentMessages = allMessages.slice(-10).map((msg) => this.transformToUIMessage(msg))

      // Build minimal userMessage object for preparePromptContent
      const userMessage: Message = {
        id: userMessageId,
        role: 'user' as const,
        content: { text: content, files: [], links: [], think: false, search: false },
        timestamp: Date.now(),
        avatar: '',
        name: '',
        model_name: modelId,
        model_id: modelId,
        model_provider: providerId,
        status: 'sent',
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
        conversationId: sessionId,
        is_variant: 0
      }

      // Prepare prompt content (build context messages, system prompt, etc.)
      const { finalContent } = await preparePromptContent({
        conversation,
        userContent: content,
        contextMessages: recentMessages,
        searchResults: null,
        urlResults: [],
        userMessage,
        vision: false,
        imageFiles: [],
        supportsFunctionCall: session.config.supportsFunctionCall || false
      })

      // Start stream completion
      const stream = this.llmProviderPresenter.startStreamCompletion(
        providerId,
        finalContent,
        modelId,
        assistantMessageId,
        temperature,
        maxTokens,
        enabledMcpTools,
        thinkingBudget,
        reasoningEffort,
        verbosity,
        enableSearch,
        forcedSearch,
        searchStrategy,
        sessionId
      )

      // Consume the stream through LoopOrchestrator
      await this.loopOrchestrator.consume(stream)

      const assistantMessage = (await this.getMessage(assistantMessageId)) as AssistantMessage
      return assistantMessage
    } catch (error) {
      console.error('[SessionPresenter] Error in sendMessage:', error)
      await this.messagePersister.updateMessage(assistantMessageId, { status: 'error' })
      this.activeLoops.delete(sessionId)
      await this.sessionManager.setStatus(sessionId, 'idle')
      return null
    }
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
    sessionId: string,
    messageId: string,
    _selectedVariantsMap?: Record<string, string>
  ): Promise<void> {
    await this.sessionManager.startLoop(sessionId, messageId)
    const abortController = new AbortController()
    this.activeLoops.set(sessionId, {
      isGenerating: true,
      abortController
    })
  }

  async cancelLoop(sessionId: string, messageId: string): Promise<void> {
    const sessionState = this.activeLoops.get(sessionId)
    if (sessionState) {
      sessionState.abortController.abort()
      this.activeLoops.delete(sessionId)
    }
    await this.sessionManager.setStatus(sessionId, 'idle')
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
