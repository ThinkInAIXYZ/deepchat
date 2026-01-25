import type {
  CONVERSATION,
  IConfigPresenter,
  ILlmProviderPresenter,
  ISessionPresenter,
  ISQLitePresenter,
  MESSAGE_METADATA
} from '@shared/presenter'
import type { AssistantMessage } from '@shared/chat'
import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'
import { presenter } from '@/presenter'
import type { SessionContextResolved } from './session/sessionContext'
import type { SessionManager } from './session/sessionManager'
import type { ThreadHandlerContext } from './baseHandler'
import { MessageManager } from '../sessionPresenter/managers/messageManager'
import { CommandPermissionService } from '../permission/commandPermissionService'
import { ContentBufferHandler } from './streaming/contentBufferHandler'
import { LLMEventHandler } from './streaming/llmEventHandler'
import { StreamGenerationHandler } from './streaming/streamGenerationHandler'
import type { GeneratingMessageState } from './streaming/types'
import { StreamUpdateScheduler } from './streaming/streamUpdateScheduler'
import { ToolCallHandler } from './loop/toolCallHandler'
import { PermissionHandler } from './permission/permissionHandler'
import { UtilityHandler } from './utility/utilityHandler'
import type {
  IAgentPresenter as IAgenticAgentPresenter,
  SessionInfo,
  MessageContent,
  SessionConfig,
  LoadContext,
  AgenticEventEmitter
} from '../agenticPresenter/types'
import { agenticPresenter } from '../agenticPresenter'
import { normalizeAndEmit } from './normalizer'

type AgentPresenterDependencies = {
  sessionPresenter: ISessionPresenter
  sessionManager: SessionManager
  sqlitePresenter: ISQLitePresenter
  llmProviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter
  commandPermissionService: CommandPermissionService
  messageManager?: MessageManager
}

export class AgentPresenter {
  // Note: This class implements both ILegacyAgentPresenter (via sendMessageLegacy + alias)
  // and IAgenticPresenter (via sendMessage with MessageContent parameter)
  // The backward compatibility alias is set in the constructor
  // Agentic Unified Layer - agent identifier
  readonly agentId = 'deepchat.default'
  private sessionPresenter: ISessionPresenter
  private sessionManager: SessionManager
  private sqlitePresenter: ISQLitePresenter
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private messageManager: MessageManager
  private commandPermissionService: CommandPermissionService
  private generatingMessages: Map<string, GeneratingMessageState> = new Map()
  private contentBufferHandler: ContentBufferHandler
  private toolCallHandler: ToolCallHandler
  private llmEventHandler: LLMEventHandler
  private streamGenerationHandler: StreamGenerationHandler
  private permissionHandler: PermissionHandler
  private utilityHandler: UtilityHandler
  private streamUpdateScheduler: StreamUpdateScheduler
  // Emitter provider callback (injected by AgenticPresenter during registration)
  private emitterProvider: (sessionId: string) => AgenticEventEmitter | undefined = () => undefined

  constructor(options: AgentPresenterDependencies) {
    this.sessionPresenter = options.sessionPresenter
    this.sessionManager = options.sessionManager
    this.sqlitePresenter = options.sqlitePresenter
    this.llmProviderPresenter = options.llmProviderPresenter
    this.configPresenter = options.configPresenter
    this.messageManager = options.messageManager ?? new MessageManager(options.sqlitePresenter)
    this.commandPermissionService = options.commandPermissionService

    this.streamUpdateScheduler = new StreamUpdateScheduler({
      messageManager: this.messageManager
    })

    const handlerContext: ThreadHandlerContext = {
      sqlitePresenter: this.sqlitePresenter,
      messageManager: this.messageManager,
      llmProviderPresenter: this.llmProviderPresenter,
      configPresenter: this.configPresenter
    }

    this.contentBufferHandler = new ContentBufferHandler({
      generatingMessages: this.generatingMessages,
      streamUpdateScheduler: this.streamUpdateScheduler
    })

    this.toolCallHandler = new ToolCallHandler({
      sqlitePresenter: this.sqlitePresenter,
      commandPermissionHandler: this.commandPermissionService,
      streamUpdateScheduler: this.streamUpdateScheduler
    })

    this.llmEventHandler = new LLMEventHandler({
      generatingMessages: this.generatingMessages,
      messageManager: this.messageManager,
      contentBufferHandler: this.contentBufferHandler,
      toolCallHandler: this.toolCallHandler,
      streamUpdateScheduler: this.streamUpdateScheduler,
      onConversationUpdated: (state) => this.handleConversationUpdates(state),
      getEmitter: (conversationId) => this.getEmitter(conversationId)
    })

    this.streamGenerationHandler = new StreamGenerationHandler(handlerContext, {
      generatingMessages: this.generatingMessages,
      llmEventHandler: this.llmEventHandler,
      getEmitter: (conversationId) => this.getEmitter(conversationId)
    })

    this.permissionHandler = new PermissionHandler(handlerContext, {
      generatingMessages: this.generatingMessages,
      llmProviderPresenter: this.llmProviderPresenter,
      getMcpPresenter: () => presenter.mcpPresenter,
      getToolPresenter: () => presenter.toolPresenter,
      streamGenerationHandler: this.streamGenerationHandler,
      llmEventHandler: this.llmEventHandler,
      commandPermissionHandler: this.commandPermissionService
    })

    this.utilityHandler = new UtilityHandler(handlerContext, {
      getActiveConversation: (tabId) => this.sessionPresenter.getActiveConversation(tabId),
      getActiveConversationId: (tabId) => this.sessionPresenter.getActiveConversationId(tabId),
      getConversation: (conversationId) => this.sessionPresenter.getConversation(conversationId),
      createConversation: (title, settings, tabId) =>
        this.sessionPresenter.createConversation(title, settings, tabId),
      streamGenerationHandler: this.streamGenerationHandler
    })

    // Legacy IPC surface: dynamic proxy for ISessionPresenter methods.
    this.bindSessionPresenterMethods()

    // Backward compatibility: Alias sendMessageLegacy as sendMessage for legacy interface
    // This allows existing code to call sendMessage(agentId, content, tabId) while the class
    // also implements IAgenticPresenter.sendMessage(sessionId, content)
    ;(this as any).sendMessage = this.sendMessageLegacy.bind(this)

    // Agentic Unified Layer - Register with AgenticPresenter
    // Use type assertion since we implement IAgenticPresenter methods but with different internal names
    agenticPresenter.registerAgent(this as unknown as IAgenticAgentPresenter)
  }

  /**
   * Legacy sendMessage implementation (renamed to avoid conflict with agentic sendMessage)
   * Handles the old interface: sendMessage(agentId, content, tabId, selectedVariantsMap)
   * Kept for backward compatibility - aliased as `sendMessage` via bindSessionPresenterMethods
   */
  async sendMessageLegacy(
    agentId: string,
    content: string,
    tabId?: number,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage | null> {
    await this.logResolvedIfEnabled(agentId)

    const conversation = await this.sessionPresenter.getConversation(agentId)
    const userMessage = await this.messageManager.sendMessage(
      agentId,
      content,
      'user',
      '',
      false,
      this.buildMessageMetadata(conversation)
    )

    const assistantMessage = await this.streamGenerationHandler.generateAIResponse(
      agentId,
      userMessage.id
    )

    this.trackGeneratingMessage(assistantMessage, agentId, tabId)
    await this.updateConversationAfterUserMessage(agentId)
    await this.sessionManager.startLoop(agentId, assistantMessage.id)

    void this.streamGenerationHandler
      .startStreamCompletion(agentId, assistantMessage.id, selectedVariantsMap)
      .catch((error) => {
        console.error('[AgentPresenter] Failed to start stream completion:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        const emitter = this.getEmitter(agentId)
        if (emitter) {
          normalizeAndEmit(
            STREAM_EVENTS.ERROR as keyof typeof STREAM_EVENTS,
            { eventId: assistantMessage.id, error: errorMessage },
            agentId,
            emitter
          )
        } else {
          eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
            eventId: assistantMessage.id,
            error: errorMessage
          })
        }
      })

    return assistantMessage
  }

  async continueLoop(
    agentId: string,
    messageId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage | null> {
    await this.logResolvedIfEnabled(agentId)

    const assistantMessage = await this.createContinueMessage(agentId)
    if (!assistantMessage) {
      return null
    }

    this.trackGeneratingMessage(assistantMessage, agentId)
    await this.updateConversationAfterUserMessage(agentId)
    await this.sessionManager.startLoop(agentId, assistantMessage.id)

    void this.streamGenerationHandler
      .continueStreamCompletion(agentId, messageId, selectedVariantsMap)
      .catch((error) => {
        console.error('[AgentPresenter] Failed to continue stream completion:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        const emitter = this.getEmitter(agentId)
        if (emitter) {
          normalizeAndEmit(
            STREAM_EVENTS.ERROR as keyof typeof STREAM_EVENTS,
            { eventId: assistantMessage.id, error: errorMessage },
            agentId,
            emitter
          )
        } else {
          eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
            eventId: assistantMessage.id,
            error: errorMessage
          })
        }
      })

    return assistantMessage
  }

  async cancelLoop(messageId: string): Promise<void> {
    try {
      const message = await this.sessionPresenter.getMessage(messageId)
      if (message) {
        this.sessionManager.updateRuntime(message.conversationId, { userStopRequested: true })
        this.sessionManager.setStatus(message.conversationId, 'paused')
      }
    } catch (error) {
      console.warn('[AgentPresenter] Failed to update session state for cancel:', error)
    }
    await this.stopMessageGeneration(messageId)
  }

  async retryMessage(
    messageId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage> {
    const message = await this.messageManager.getMessage(messageId)
    if (message.role !== 'assistant') {
      throw new Error('只能重试助手消息')
    }

    const userMessage = await this.messageManager.getMessage(message.parentId || '')
    if (!userMessage) {
      throw new Error('找不到对应的用户消息')
    }

    const conversation = await this.sessionPresenter.getConversation(message.conversationId)
    const assistantMessage = (await this.messageManager.retryMessage(
      messageId,
      this.buildMessageMetadata(conversation)
    )) as AssistantMessage

    this.trackGeneratingMessage(assistantMessage, message.conversationId)
    await this.sessionManager.startLoop(message.conversationId, assistantMessage.id)

    void this.streamGenerationHandler
      .startStreamCompletion(message.conversationId, messageId, selectedVariantsMap)
      .catch((error) => {
        console.error('[AgentPresenter] Failed to retry stream completion:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        const emitter = this.getEmitter(message.conversationId)
        if (emitter) {
          normalizeAndEmit(
            STREAM_EVENTS.ERROR as keyof typeof STREAM_EVENTS,
            { eventId: assistantMessage.id, error: errorMessage },
            message.conversationId,
            emitter
          )
        } else {
          eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
            eventId: assistantMessage.id,
            error: errorMessage
          })
        }
      })

    return assistantMessage
  }

  async regenerateFromUserMessage(
    agentId: string,
    userMessageId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage> {
    await this.logResolvedIfEnabled(agentId)
    return this.streamGenerationHandler.regenerateFromUserMessage(
      agentId,
      userMessageId,
      selectedVariantsMap
    )
  }

  async translateText(text: string, tabId: number): Promise<string> {
    return this.utilityHandler.translateText(text, tabId)
  }

  async askAI(text: string, tabId: number): Promise<string> {
    return this.utilityHandler.askAI(text, tabId)
  }

  async handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all' | 'command',
    remember?: boolean
  ): Promise<void> {
    await this.permissionHandler.handlePermissionResponse(
      messageId,
      toolCallId,
      granted,
      permissionType,
      remember
    )
  }

  async getMessageRequestPreview(agentId: string, messageId?: string): Promise<unknown> {
    if (!messageId) {
      return null
    }
    await this.logResolvedIfEnabled(agentId)
    return this.utilityHandler.getMessageRequestPreview(messageId)
  }

  private buildMessageMetadata(conversation: CONVERSATION): MESSAGE_METADATA {
    const { providerId, modelId } = conversation.settings
    return {
      contextUsage: 0,
      totalTokens: 0,
      generationTime: 0,
      firstTokenTime: 0,
      tokensPerSecond: 0,
      inputTokens: 0,
      outputTokens: 0,
      model: modelId,
      provider: providerId
    }
  }

  private trackGeneratingMessage(
    message: AssistantMessage,
    conversationId: string,
    tabId?: number
  ): void {
    this.generatingMessages.set(message.id, {
      message,
      conversationId,
      startTime: Date.now(),
      firstTokenTime: null,
      promptTokens: 0,
      reasoningStartTime: null,
      reasoningEndTime: null,
      lastReasoningTime: null,
      tabId
    })
  }

  private async updateConversationAfterUserMessage(conversationId: string): Promise<void> {
    const { list: messages } = await this.messageManager.getMessageThread(conversationId, 1, 2)
    if (messages.length === 1) {
      await this.sqlitePresenter.updateConversation(conversationId, {
        is_new: 0,
        updatedAt: Date.now()
      })
      return
    }

    await this.sqlitePresenter.updateConversation(conversationId, {
      updatedAt: Date.now()
    })
  }

  private async createContinueMessage(agentId: string): Promise<AssistantMessage> {
    const continuePayload = JSON.stringify({
      text: 'continue',
      files: [],
      links: [],
      search: false,
      think: false,
      continue: true
    })

    const conversation = await this.sessionPresenter.getConversation(agentId)
    const userMessage = await this.messageManager.sendMessage(
      agentId,
      continuePayload,
      'user',
      '',
      false,
      this.buildMessageMetadata(conversation)
    )

    return this.streamGenerationHandler.generateAIResponse(agentId, userMessage.id)
  }

  private async handleConversationUpdates(state: GeneratingMessageState): Promise<void> {
    const conversation = await this.sessionPresenter.getConversation(state.conversationId)

    if (conversation.is_new === 1) {
      try {
        this.sessionPresenter
          .generateTitle(state.conversationId)
          .then((title) => {
            return this.sessionPresenter.renameConversation(state.conversationId, title)
          })
          .then(() => {
            console.log('title updated')
          })
      } catch (error) {
        console.error('[AgentPresenter] Failed to summarize title', {
          conversationId: state.conversationId,
          err: error
        })
      }
    }

    await this.sqlitePresenter.updateConversation(state.conversationId, {
      updatedAt: Date.now()
    })

    const sessionPresenter = this.sessionPresenter as unknown as {
      broadcastThreadListUpdate?: () => Promise<void>
    }
    if (sessionPresenter.broadcastThreadListUpdate) {
      await sessionPresenter.broadcastThreadListUpdate()
    }
  }

  private async stopMessageGeneration(messageId: string): Promise<void> {
    const state = this.generatingMessages.get(messageId)
    if (!state) {
      return
    }

    this.sessionManager.updateRuntime(state.conversationId, { userStopRequested: true })
    this.sessionManager.setStatus(state.conversationId, 'paused')
    this.sessionManager.clearPendingPermission(state.conversationId)
    state.isCancelled = true

    if (state.adaptiveBuffer) {
      await this.contentBufferHandler.flushAdaptiveBuffer(messageId)
    }

    this.contentBufferHandler.cleanupContentBuffer(state)

    state.message.content.forEach((block) => {
      if (
        block.status === 'loading' ||
        block.status === 'reading' ||
        block.status === 'optimizing'
      ) {
        block.status = 'success'
      }
    })

    state.message.content.push({
      type: 'error',
      content: 'common.error.userCanceledGeneration',
      status: 'cancel',
      timestamp: Date.now()
    })

    await this.messageManager.updateMessageStatus(messageId, 'error')
    await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))
    await this.llmProviderPresenter.stopStream(messageId)

    this.generatingMessages.delete(messageId)
  }

  // ==========================================================================
  // Emitter Management - For Agentic Unified Layer
  // ==========================================================================

  /**
   * Get or create an event emitter for a conversation (session)
   * @param conversationId - The conversation ID to get emitter for
   * @returns The emitter, or undefined if not in agentic mode
   */
  getEmitter(conversationId: string): AgenticEventEmitter | undefined {
    return this.emitterProvider(conversationId)
  }

  /**
   * Set the emitter provider callback (called by AgenticPresenter during registration)
   * @param provider - The provider callback function
   */
  setEmitterProvider(provider: (sessionId: string) => AgenticEventEmitter | undefined): void {
    this.emitterProvider = provider
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private shouldLogResolved(): boolean {
    return import.meta.env.VITE_AGENT_PRESENTER_DEBUG === '1'
  }

  private async logResolvedIfEnabled(agentId: string): Promise<void> {
    if (!this.shouldLogResolved()) {
      return
    }
    try {
      const resolved = await this.resolveSession(agentId)
      console.log('[AgentPresenter] SessionContext.resolved', { agentId, resolved })
    } catch (error) {
      console.warn('[AgentPresenter] Failed to resolve session context', { agentId, error })
    }
  }

  private async resolveSession(agentId: string): Promise<SessionContextResolved> {
    const session = await this.sessionManager.getSession(agentId)
    return session.resolved
  }

  private bindSessionPresenterMethods(): void {
    const sessionPresenter = this.sessionPresenter as unknown as Record<string, unknown>
    const sessionProto = Object.getPrototypeOf(sessionPresenter) as Record<string, unknown>
    for (const key of Object.getOwnPropertyNames(sessionProto)) {
      if (key === 'constructor') continue
      if (key in this) continue
      const value = sessionPresenter[key]
      if (typeof value === 'function') {
        ;(this as Record<string, unknown>)[key] = value.bind(this.sessionPresenter)
      }
    }
  }

  // ==========================================================================
  // Agentic Unified Layer - IAgenticPresenter Implementation
  // ==========================================================================

  // Session-level mode storage (permission policy: strict/balanced/permissive)
  private sessionModes = new Map<string, string>()

  /**
   * Create a new session (conversation) for DeepChat agent
   * sessionId maps to conversationId in SQLite
   */
  async createSession(config: SessionConfig): Promise<string> {
    const tabId = await presenter.tabPresenter.getActiveTabId(
      presenter.windowPresenter.getFocusedWindow()?.id ?? 0
    )
    if (tabId == null) {
      throw new Error('No active tab to create session')
    }

    // Convert SessionConfig to conversation settings
    const settings: Partial<CONVERSATION['settings']> = {}
    if (config.modelId) {
      const parts = config.modelId.split(':')
      settings.providerId = parts.length === 2 ? parts[0] : undefined
      settings.modelId = parts.length === 2 ? parts[1] : config.modelId
    }

    // Create conversation via SessionPresenter
    const conversationId = await this.sessionPresenter.createConversation(
      'New Chat',
      settings,
      tabId
    )

    // Store modeId in session state if provided
    if (config.modeId) {
      this.sessionModes.set(conversationId, config.modeId)
    }

    // Note: SESSION_CREATED event is emitted by AgenticPresenter.createSession

    return conversationId // sessionId = conversationId for DeepChat
  }

  /**
   * Get session information
   */
  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const conversation = await this.sqlitePresenter.getConversation(sessionId)
    if (!conversation) {
      return null
    }

    const sessionContext = this.sessionManager.getSessionSync(sessionId)
    const { providerId, modelId } = conversation.settings

    // Get available models from config
    const models = this.configPresenter.getProviderModels(providerId)
    const availableModels = models.map((model) => ({
      id: `${providerId}:${model.id}`,
      name: model.name,
      description: model.description
    }))

    // Map session status to agentic status
    // 'waiting_permission' maps to 'paused'
    const statusMap: Record<string, 'idle' | 'generating' | 'paused' | 'error'> = {
      idle: 'idle',
      generating: 'generating',
      paused: 'paused',
      waiting_permission: 'paused',
      error: 'error'
    }

    return {
      sessionId: conversation.id,
      agentId: this.agentId,
      status: statusMap[sessionContext?.status ?? 'idle'] ?? 'idle',
      availableModes: [
        { id: 'strict', name: 'Strict', description: 'All operations require user confirmation' },
        {
          id: 'balanced',
          name: 'Balanced',
          description: 'Read operations auto-allow, write/delete require confirmation'
        },
        {
          id: 'permissive',
          name: 'Permissive',
          description: 'Most operations auto-allow, only dangerous operations require confirmation'
        }
      ],
      availableModels,
      currentModeId: this.sessionModes.get(sessionId),
      currentModelId: modelId,
      capabilities: {
        supportsVision: this.configPresenter.getModelConfig(modelId, providerId)?.vision ?? false,
        supportsTools: true,
        supportsModes: true
      }
    }
  }

  /**
   * Load an existing session (conversation history from SQLite)
   */
  async loadSession(sessionId: string, _context: LoadContext): Promise<void> {
    const conversation = await this.sqlitePresenter.getConversation(sessionId)
    if (!conversation) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // For DeepChat, loading is implicit - messages are fetched from SQLite on demand
    // The renderer will call getMessageThread to load messages
    // context.maxHistory and context.includeSystemMessages are handled by getMessageThread
    // Note: SESSION_UPDATED event is emitted by AgenticPresenter if needed
  }

  /**
   * Close a session (conversation)
   */
  async closeSession(sessionId: string): Promise<void> {
    const tabId = await this.sessionPresenter.findTabForConversation(sessionId)
    if (tabId !== null) {
      // Use clearActiveThread which is the correct method
      await this.sessionPresenter.clearActiveThread(tabId)
    }

    // Clear command permissions for the conversation
    this.commandPermissionService.clearConversation(sessionId)
    presenter.filePermissionService?.clearConversation(sessionId)
    presenter.settingsPermissionService?.clearConversation(sessionId)

    // Clear session mode
    this.sessionModes.delete(sessionId)

    // Note: Emitter cleanup and SESSION_CLOSED event are emitted by AgenticPresenter.closeSession
  }

  /**
   * Send a message to the agent (Agentic Unified Layer)
   * Implements IAgenticPresenter.sendMessage(sessionId, content)
   * This overloads the legacy sendMessage(agentId, content, tabId, ...) method
   */
  async sendMessage(sessionId: string, content: MessageContent): Promise<void> {
    const tabId = await this.sessionPresenter.findTabForConversation(sessionId)
    if (tabId == null) {
      throw new Error(`Session not active: ${sessionId}`)
    }

    // Convert MessageContent to text format
    const text = content.text ?? ''

    // Use the legacy sendMessage implementation
    await this.sendMessageLegacy(sessionId, text, tabId)
  }

  /**
   * Cancel a message
   */
  async cancelMessage(_sessionId: string, messageId: string): Promise<void> {
    await this.cancelLoop(messageId)
  }

  /**
   * Set the model for a session
   */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    const parts = modelId.split(':')
    const providerId = parts.length === 2 ? parts[0] : undefined
    const actualModelId = parts.length === 2 ? parts[1] : modelId

    const settings: Partial<CONVERSATION['settings']> = {
      providerId,
      modelId: actualModelId
    }

    await this.sessionPresenter.updateConversationSettings(sessionId, settings)

    // Note: SESSION_UPDATED event is emitted by AgenticPresenter if needed
  }

  /**
   * Set the mode (permission policy) for a session
   */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    // Store modeId in session state
    this.sessionModes.set(sessionId, modeId)

    // Note: SESSION_UPDATED event is emitted by AgenticPresenter if needed
    // The mode affects permission handling, which is implemented
    // in CommandPermissionService and FilePermissionService
  }
}
