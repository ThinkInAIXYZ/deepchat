import type {
  CONVERSATION,
  IAgentPresenter,
  IConfigPresenter,
  ILlmProviderPresenter,
  ISessionPresenter,
  ISQLitePresenter,
  MESSAGE_METADATA
} from '@shared/presenter'
import type { AssistantMessage, AssistantMessageBlock, UserMessageContent } from '@shared/chat'
import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'
import { presenter } from '@/presenter'
import type { SessionContextResolved } from './session/sessionContext'
import type { SessionManager } from './session/sessionManager'
import { MessageManager } from '../sessionPresenter/managers/messageManager'
import type { ThreadHandlerContext } from './types/handlerContext'
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
  commandPermissionService: CommandPermissionService
  messageManager?: MessageManager
}

export class AgentPresenter implements IAgentPresenter {
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
      onConversationUpdated: (state) => this.handleConversationUpdates(state)
    })

    this.streamGenerationHandler = new StreamGenerationHandler(handlerContext, {
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
      createConversation: (title, settings, tabId) =>
        this.sessionPresenter.createConversation(title, settings, tabId),
      streamGenerationHandler: this.streamGenerationHandler
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
    try {
      const promptPreview = this.extractUserMessageText(content)
      presenter.hooksNotifications.dispatchEvent('UserPromptSubmit', {
        conversationId: agentId,
        messageId: userMessage.id,
        promptPreview,
        providerId: conversation.settings.providerId,
        modelId: conversation.settings.modelId
      })
    } catch (error) {
      console.warn('[AgentPresenter] Failed to dispatch UserPromptSubmit hook:', error)
    }

    try {
      await this.resolvePendingQuestionIfNeeded(agentId, userMessage.id, content)
    } catch (error) {
      console.warn('[AgentPresenter] Failed to auto-resolve pending question:', error)
    }

    const assistantMessage = await this.streamGenerationHandler.generateAIResponse(
      agentId,
      userMessage.id
    )

    this.trackGeneratingMessage(assistantMessage, agentId, tabId)
    await this.updateConversationAfterUserMessage(agentId)
    // Normal flow: skip lock acquisition (lock is only for permission resume)
    await this.sessionManager.startLoop(agentId, assistantMessage.id, { skipLockAcquisition: true })

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
    // Normal flow: skip lock acquisition (lock is only for permission resume)
    await this.sessionManager.startLoop(agentId, assistantMessage.id, { skipLockAcquisition: true })

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

  async cleanupConversation(conversationId: string): Promise<void> {
    for (const [messageId, state] of this.generatingMessages) {
      if (state.conversationId === conversationId) {
        await this.stopMessageGeneration(messageId)
        break
      }
    }

    this.sessionManager.removeSession(conversationId)

    try {
      await this.llmProviderPresenter.clearAcpSession(conversationId)
    } catch (error) {
      console.warn('[AgentPresenter] Failed to clear ACP session:', error)
    }
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
    // Normal flow: skip lock acquisition (lock is only for permission resume)
    await this.sessionManager.startLoop(message.conversationId, assistantMessage.id, {
      skipLockAcquisition: true
    })

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

  async resolveQuestion(
    messageId: string,
    toolCallId: string,
    answerText: string,
    answerMessageId?: string
  ): Promise<void> {
    await this.handleQuestionResolution(messageId, toolCallId, {
      resolution: 'replied',
      answerText,
      answerMessageId
    })
  }

  async rejectQuestion(messageId: string, toolCallId: string): Promise<void> {
    await this.handleQuestionResolution(messageId, toolCallId, {
      resolution: 'rejected'
    })
  }

  async getMessageRequestPreview(agentId: string, messageId?: string): Promise<unknown> {
    if (!messageId) {
      return null
    }
    await this.logResolvedIfEnabled(agentId)
    return this.utilityHandler.getMessageRequestPreview(messageId)
  }

  private async handleQuestionResolution(
    messageId: string,
    toolCallId: string,
    payload: {
      resolution: 'replied' | 'rejected'
      answerText?: string
      answerMessageId?: string
    }
  ): Promise<void> {
    if (!messageId || !toolCallId) {
      return
    }

    const message = await this.messageManager.getMessage(messageId)
    if (!message || message.role !== 'assistant') {
      throw new Error(`Message not found or not assistant (${messageId})`)
    }

    const content = message.content as AssistantMessageBlock[]
    const questionBlock = content.find(
      (block) =>
        block.type === 'action' &&
        block.action_type === 'question_request' &&
        block.tool_call?.id === toolCallId
    )

    if (!questionBlock) {
      throw new Error(
        `Question block not found (messageId: ${messageId}, toolCallId: ${toolCallId})`
      )
    }

    if (questionBlock.status !== 'pending') {
      return
    }

    const isReplied = payload.resolution === 'replied'
    questionBlock.status = isReplied ? 'success' : 'denied'
    questionBlock.extra = {
      ...questionBlock.extra,
      needsUserAction: false,
      questionResolution: payload.resolution,
      ...(isReplied && payload.answerText ? { answerText: payload.answerText } : {}),
      ...(isReplied && payload.answerMessageId ? { answerMessageId: payload.answerMessageId } : {})
    }

    const generatingState = this.generatingMessages.get(messageId)
    if (generatingState) {
      const questionIndex = generatingState.message.content.findIndex(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'question_request' &&
          block.tool_call?.id === toolCallId
      )
      if (questionIndex !== -1) {
        const stateBlock = generatingState.message.content[questionIndex]
        generatingState.message.content[questionIndex] = {
          ...stateBlock,
          ...questionBlock,
          extra: questionBlock.extra ? { ...questionBlock.extra } : undefined,
          tool_call: questionBlock.tool_call ? { ...questionBlock.tool_call } : undefined
        }
      }
    }

    await this.messageManager.editMessage(messageId, JSON.stringify(content))
    if (message.status === 'pending') {
      await this.messageManager.updateMessageStatus(messageId, 'sent')
    }
    presenter.sessionManager.clearPendingQuestion(message.conversationId)
    presenter.sessionManager.setStatus(message.conversationId, 'idle')
  }

  private async resolvePendingQuestionIfNeeded(
    conversationId: string,
    userMessageId: string,
    rawContent: string
  ): Promise<void> {
    const session = await this.sessionManager.getSession(conversationId)
    const pendingQuestion = session.runtime?.pendingQuestion
    if (!pendingQuestion?.messageId || !pendingQuestion.toolCallId) {
      return
    }

    const answerText = this.extractUserMessageText(rawContent)
    if (!answerText.trim()) {
      return
    }

    await this.handleQuestionResolution(pendingQuestion.messageId, pendingQuestion.toolCallId, {
      resolution: 'replied',
      answerText,
      answerMessageId: userMessageId
    })
  }

  private extractUserMessageText(rawContent: string): string {
    if (!rawContent) return ''
    try {
      const parsed = JSON.parse(rawContent) as UserMessageContent
      if (typeof parsed.text === 'string') {
        return parsed.text
      }
      if (Array.isArray(parsed.content)) {
        return parsed.content.map((block) => block.content || '').join('')
      }
    } catch (error) {
      console.warn('[AgentPresenter] Failed to parse user message content:', error)
    }
    return rawContent
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
        const title = await this.sessionPresenter.generateTitle(state.conversationId)
        await this.sessionPresenter.renameConversation(state.conversationId, title)
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
    this.sessionManager.clearPendingQuestion(state.conversationId)
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
