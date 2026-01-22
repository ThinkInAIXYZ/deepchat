import type {
  CONVERSATION,
  IAgentPresenter,
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
import type { SearchPresenter } from '../searchPresenter'
import type { SearchManager } from '../searchPresenter/managers/searchManager'
import type { ThreadHandlerContext } from '../searchPresenter/handlers/baseHandler'
import { SearchHandler } from '../searchPresenter/handlers/searchHandler'
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

type AgentPresenterDependencies = {
  sessionPresenter: ISessionPresenter
  sessionManager: SessionManager
  sqlitePresenter: ISQLitePresenter
  llmProviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter
  searchPresenter: SearchPresenter
  commandPermissionService: CommandPermissionService
  messageManager?: MessageManager
}

export class AgentPresenter implements IAgentPresenter {
  private sessionPresenter: ISessionPresenter
  private sessionManager: SessionManager
  private sqlitePresenter: ISQLitePresenter
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private searchPresenter: SearchPresenter
  private searchManager: SearchManager
  private messageManager: MessageManager
  private commandPermissionService: CommandPermissionService
  private generatingMessages: Map<string, GeneratingMessageState> = new Map()
  private searchingMessages: Set<string> = new Set()
  private contentBufferHandler: ContentBufferHandler
  private toolCallHandler: ToolCallHandler
  private llmEventHandler: LLMEventHandler
  private searchHandler: SearchHandler
  private streamGenerationHandler: StreamGenerationHandler
  private permissionHandler: PermissionHandler
  private utilityHandler: UtilityHandler
  private streamUpdateScheduler: StreamUpdateScheduler

  constructor(options: AgentPresenterDependencies) {
    this.sessionPresenter = options.sessionPresenter
    this.sessionManager = options.sessionManager
    this.sqlitePresenter = options.sqlitePresenter
    this.llmProviderPresenter = options.llmProviderPresenter
    this.configPresenter = options.configPresenter
    this.searchPresenter = options.searchPresenter
    this.searchManager = options.searchPresenter.getSearchManager()
    this.messageManager = options.messageManager ?? new MessageManager(options.sqlitePresenter)
    this.commandPermissionService = options.commandPermissionService

    this.streamUpdateScheduler = new StreamUpdateScheduler({
      messageManager: this.messageManager
    })

    const handlerContext: ThreadHandlerContext = {
      sqlitePresenter: this.sqlitePresenter,
      messageManager: this.messageManager,
      llmProviderPresenter: this.llmProviderPresenter,
      configPresenter: this.configPresenter,
      searchManager: this.searchManager
    }

    this.contentBufferHandler = new ContentBufferHandler({
      generatingMessages: this.generatingMessages,
      streamUpdateScheduler: this.streamUpdateScheduler
    })

    this.toolCallHandler = new ToolCallHandler({
      sqlitePresenter: this.sqlitePresenter,
      searchingMessages: this.searchingMessages,
      commandPermissionHandler: this.commandPermissionService,
      streamUpdateScheduler: this.streamUpdateScheduler
    })

    this.llmEventHandler = new LLMEventHandler({
      generatingMessages: this.generatingMessages,
      searchingMessages: this.searchingMessages,
      messageManager: this.messageManager,
      contentBufferHandler: this.contentBufferHandler,
      toolCallHandler: this.toolCallHandler,
      streamUpdateScheduler: this.streamUpdateScheduler,
      onConversationUpdated: (state) => this.handleConversationUpdates(state)
    })

    this.searchHandler = new SearchHandler(handlerContext, {
      generatingMessages: this.generatingMessages,
      searchingMessages: this.searchingMessages,
      getSearchAssistantModel: () => this.searchPresenter.getSearchAssistantModel(),
      getSearchAssistantProviderId: () => this.searchPresenter.getSearchAssistantProviderId()
    })

    this.streamGenerationHandler = new StreamGenerationHandler(handlerContext, {
      searchHandler: this.searchHandler,
      generatingMessages: this.generatingMessages,
      llmEventHandler: this.llmEventHandler
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
      streamGenerationHandler: this.streamGenerationHandler,
      getSearchAssistantModel: () => this.searchPresenter.getSearchAssistantModel(),
      getSearchAssistantProviderId: () => this.searchPresenter.getSearchAssistantProviderId()
    })

    // Legacy IPC surface: dynamic proxy for ISessionPresenter methods.
    this.bindSessionPresenterMethods()
  }

  async sendMessage(
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
        eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
          eventId: assistantMessage.id,
          error: errorMessage
        })
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
        eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
          eventId: assistantMessage.id,
          error: errorMessage
        })
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
        eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
          eventId: assistantMessage.id,
          error: errorMessage
        })
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

    if (state.isSearching) {
      this.searchingMessages.delete(messageId)
      await this.searchManager.stopSearch(state.conversationId)
    }

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
}
