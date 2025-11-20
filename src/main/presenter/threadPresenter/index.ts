import {
  IThreadPresenter,
  CONVERSATION,
  CONVERSATION_SETTINGS,
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  MESSAGE_METADATA,
  SearchResult,
  MODEL_META,
  ISQLitePresenter,
  IConfigPresenter,
  ILlmProviderPresenter,
  LLMAgentEventData,
  AcpWorkdirInfo
} from '@shared/presenter'
import { presenter } from '@/presenter'
import { MessageManager } from './managers/messageManager'
import { eventBus } from '@/eventbus'
import { AssistantMessage, Message, SearchEngineTemplate } from '@shared/chat'
import { SearchManager } from './managers/searchManager'
import { TAB_EVENTS } from '@/events'
import { ConversationExportFormat } from './exporters/conversationExporter'
import type { GeneratingMessageState } from './types'
import { ContentBufferHandler } from './handlers/contentBufferHandler'
import { ToolCallHandler } from './handlers/toolCallHandler'
import { LLMEventHandler } from './handlers/llmEventHandler'
import { SearchHandler } from './handlers/searchHandler'
import { StreamGenerationHandler } from './handlers/streamGenerationHandler'
import { PermissionHandler } from './handlers/permissionHandler'
import { UtilityHandler } from './handlers/utilityHandler'
import type { ThreadHandlerContext } from './handlers/baseHandler'
import { ConversationManager, type CreateConversationOptions } from './managers/conversationManager'

export class ThreadPresenter implements IThreadPresenter {
  private sqlitePresenter: ISQLitePresenter
  private messageManager: MessageManager
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private searchManager: SearchManager
  private conversationManager: ConversationManager
  private contentBufferHandler: ContentBufferHandler
  private toolCallHandler: ToolCallHandler
  private llmEventHandler: LLMEventHandler
  private searchHandler: SearchHandler
  private streamGenerationHandler: StreamGenerationHandler
  private permissionHandler: PermissionHandler
  private utilityHandler: UtilityHandler
  private generatingMessages: Map<string, GeneratingMessageState> = new Map()
  private activeConversationIds: Map<number, string> = new Map()
  public searchAssistantModel: MODEL_META | null = null
  public searchAssistantProviderId: string | null = null
  private searchingMessages: Set<string> = new Set()

  constructor(
    sqlitePresenter: ISQLitePresenter,
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter
  ) {
    this.sqlitePresenter = sqlitePresenter
    this.messageManager = new MessageManager(sqlitePresenter)
    this.llmProviderPresenter = llmProviderPresenter
    this.searchManager = new SearchManager()
    this.configPresenter = configPresenter
    this.conversationManager = new ConversationManager({
      sqlitePresenter,
      configPresenter,
      messageManager: this.messageManager,
      activeConversationIds: this.activeConversationIds
    })
    this.contentBufferHandler = new ContentBufferHandler({
      generatingMessages: this.generatingMessages,
      messageManager: this.messageManager
    })
    this.toolCallHandler = new ToolCallHandler({
      messageManager: this.messageManager,
      sqlitePresenter,
      searchingMessages: this.searchingMessages
    })
    this.llmEventHandler = new LLMEventHandler({
      generatingMessages: this.generatingMessages,
      searchingMessages: this.searchingMessages,
      messageManager: this.messageManager,
      contentBufferHandler: this.contentBufferHandler,
      toolCallHandler: this.toolCallHandler,
      onConversationUpdated: (state) => this.handleConversationUpdates(state)
    })

    const handlerContext: ThreadHandlerContext = {
      sqlitePresenter,
      messageManager: this.messageManager,
      llmProviderPresenter: this.llmProviderPresenter,
      configPresenter: this.configPresenter,
      searchManager: this.searchManager
    }

    this.searchHandler = new SearchHandler(handlerContext, {
      generatingMessages: this.generatingMessages,
      searchingMessages: this.searchingMessages,
      getSearchAssistantModel: () => this.searchAssistantModel,
      getSearchAssistantProviderId: () => this.searchAssistantProviderId
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
      streamGenerationHandler: this.streamGenerationHandler,
      llmEventHandler: this.llmEventHandler
    })

    this.utilityHandler = new UtilityHandler(handlerContext, {
      conversationManager: this.conversationManager,
      streamGenerationHandler: this.streamGenerationHandler,
      getSearchAssistantModel: () => this.searchAssistantModel,
      getSearchAssistantProviderId: () => this.searchAssistantProviderId
    })

    // 监听Tab关闭事件，清理绑定关系
    eventBus.on(TAB_EVENTS.CLOSED, (tabId: number) => {
      const activeConversationId = this.getActiveConversationIdSync(tabId)
      if (activeConversationId) {
        this.clearActiveConversation(tabId, { notify: true })
        console.log(`ThreadPresenter: Cleaned up conversation binding for closed tab ${tabId}.`)
      }
    })
    eventBus.on(TAB_EVENTS.RENDERER_TAB_READY, () => {
      this.broadcastThreadListUpdate()
    })

    // 初始化时处理所有未完成的消息
    this.messageManager.initializeUnfinishedMessages()
  }

  setSearchAssistantModel(model: MODEL_META, providerId: string): void {
    this.searchAssistantModel = model
    this.searchAssistantProviderId = providerId
  }

  /**
   * 新增：查找指定会话ID所在的Tab ID
   * @param conversationId 会话ID
   * @returns 如果找到，返回tabId，否则返回null
   */
  async findTabForConversation(conversationId: string): Promise<number | null> {
    return this.conversationManager.findTabForConversation(conversationId)
  }

  async handleLLMAgentError(msg: LLMAgentEventData) {
    await this.llmEventHandler.handleLLMAgentError(msg)
  }

  async handleLLMAgentEnd(msg: LLMAgentEventData) {
    await this.llmEventHandler.handleLLMAgentEnd(msg)
  }

  async handleLLMAgentResponse(msg: LLMAgentEventData) {
    await this.llmEventHandler.handleLLMAgentResponse(msg)
  }

  private async handleConversationUpdates(state: GeneratingMessageState): Promise<void> {
    const conversation = await this.getConversation(state.conversationId)

    if (conversation.is_new === 1) {
      try {
        const title = await this.summaryTitles(undefined, state.conversationId)
        if (title) {
          await this.renameConversation(state.conversationId, title)
          return
        }
      } catch (error) {
        console.error('[ThreadPresenter] Failed to summarize title', {
          conversationId: state.conversationId,
          err: error
        })
      }
    }

    await this.sqlitePresenter.updateConversation(state.conversationId, {
      updatedAt: Date.now()
    })
    await this.broadcastThreadListUpdate()
  }

  async getSearchEngines(): Promise<SearchEngineTemplate[]> {
    return this.searchManager.getEngines()
  }
  async getActiveSearchEngine(): Promise<SearchEngineTemplate> {
    return this.searchManager.getActiveEngine()
  }
  async setActiveSearchEngine(engineId: string): Promise<void> {
    await this.searchManager.setActiveEngine(engineId)
  }

  /**
   * 测试当前选择的搜索引擎
   * @param query 测试搜索的关键词，默认为"天气"
   * @returns 测试是否成功打开窗口
   */
  async testSearchEngine(query: string = '天气'): Promise<boolean> {
    return await this.searchManager.testSearch(query)
  }

  /**
   * 设置搜索引擎
   * @param engineId 搜索引擎ID
   * @returns 是否设置成功
   */
  async setSearchEngine(engineId: string): Promise<boolean> {
    try {
      return await this.searchManager.setActiveEngine(engineId)
    } catch (error) {
      console.error('设置搜索引擎失败:', error)
      return false
    }
  }

  getActiveConversationIdSync(tabId: number): string | null {
    return this.conversationManager.getActiveConversationIdSync(tabId)
  }

  getTabsByConversation(conversationId: string): number[] {
    return this.conversationManager.getTabsByConversation(conversationId)
  }

  clearActiveConversation(tabId: number, options: { notify?: boolean } = {}): void {
    this.conversationManager.clearActiveConversation(tabId, options)
  }

  clearConversationBindings(conversationId: string): void {
    this.conversationManager.clearConversationBindings(conversationId)
  }

  async setActiveConversation(conversationId: string, tabId: number): Promise<void> {
    await this.conversationManager.setActiveConversation(conversationId, tabId)
  }

  async getActiveConversation(tabId: number): Promise<CONVERSATION | null> {
    return this.conversationManager.getActiveConversation(tabId)
  }

  async getConversation(conversationId: string): Promise<CONVERSATION> {
    return this.conversationManager.getConversation(conversationId)
  }

  async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {},
    tabId: number,
    options: CreateConversationOptions = {}
  ): Promise<string> {
    return this.conversationManager.createConversation(title, settings, tabId, options)
  }

  async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    return this.conversationManager.renameConversation(conversationId, title)
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.conversationManager.deleteConversation(conversationId)
  }

  async toggleConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    await this.conversationManager.toggleConversationPinned(conversationId, pinned)
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.conversationManager.updateConversationTitle(conversationId, title)
  }

  async updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void> {
    await this.conversationManager.updateConversationSettings(conversationId, settings)
  }

  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return this.conversationManager.getConversationList(page, pageSize)
  }

  async loadMoreThreads(): Promise<{ hasMore: boolean; total: number }> {
    return this.conversationManager.loadMoreThreads()
  }

  async broadcastThreadListUpdate(): Promise<void> {
    await this.conversationManager.broadcastThreadListUpdate()
  }

  async getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: Message[] }> {
    return await this.messageManager.getMessageThread(conversationId, page, pageSize)
  }

  async getContextMessages(conversationId: string): Promise<Message[]> {
    const conversation = await this.getConversation(conversationId)
    let messageCount = Math.ceil(conversation.settings.contextLength / 300)
    if (messageCount < 2) {
      messageCount = 2
    }
    return this.messageManager.getContextMessages(conversationId, messageCount)
  }

  async clearContext(conversationId: string): Promise<void> {
    await this.sqlitePresenter.runTransaction(async () => {
      const conversation = await this.getConversation(conversationId)
      if (conversation) {
        await this.sqlitePresenter.deleteAllMessages()
      }
    })
  }
  /**
   *
   * @param conversationId
   * @param content
   * @param role
   * @returns 如果是user的消息，返回ai生成的message，否则返回空
   */
  async sendMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE
  ): Promise<AssistantMessage | null> {
    const conversation = await this.getConversation(conversationId)
    const { providerId, modelId } = conversation.settings
    console.log('sendMessage', conversation)
    const message = await this.messageManager.sendMessage(
      conversationId,
      content,
      role,
      '',
      false,
      {
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
    )
    if (role === 'user') {
      const assistantMessage = await this.streamGenerationHandler.generateAIResponse(
        conversationId,
        message.id
      )
      this.generatingMessages.set(assistantMessage.id, {
        message: assistantMessage,
        conversationId,
        startTime: Date.now(),
        firstTokenTime: null,
        promptTokens: 0,
        reasoningStartTime: null,
        reasoningEndTime: null,
        lastReasoningTime: null
      })

      // 检查是否是新会话的第一条消息
      const { list: messages } = await this.getMessages(conversationId, 1, 2)
      if (messages.length === 1) {
        // 更新会话的 is_new 标志位
        await this.sqlitePresenter.updateConversation(conversationId, {
          is_new: 0,
          updatedAt: Date.now()
        })
      } else {
        await this.sqlitePresenter.updateConversation(conversationId, {
          updatedAt: Date.now()
        })
      }

      // 因为handleLLMAgentEnd会处理会话列表广播，所以此处不用广播

      return assistantMessage
    }

    return null
  }

  async getMessage(messageId: string): Promise<Message> {
    return await this.messageManager.getMessage(messageId)
  }

  // 从数据库获取搜索结果
  async getSearchResults(messageId: string, searchId?: string): Promise<SearchResult[]> {
    const results = await this.sqlitePresenter.getMessageAttachments(messageId, 'search_result')
    const parsed =
      results
        .map((result) => {
          try {
            return JSON.parse(result.content) as SearchResult
          } catch (error) {
            console.warn('解析搜索结果附件失败:', error)
            return null
          }
        })
        .filter((item): item is SearchResult => item !== null) ?? []

    if (searchId) {
      const filtered = parsed.filter((item) => item.searchId === searchId)
      if (filtered.length > 0) {
        return filtered
      }
      // 历史数据兼容：如果没有匹配的 searchId，则回退到没有 searchId 的结果
      const legacyResults = parsed.filter((item) => !item.searchId)
      if (legacyResults.length > 0) {
        return legacyResults
      }
    }

    return parsed
  }

  async startStreamCompletion(
    conversationId: string,
    queryMsgId?: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void> {
    await this.streamGenerationHandler.startStreamCompletion(
      conversationId,
      queryMsgId,
      selectedVariantsMap
    )
  }
  async continueStreamCompletion(
    conversationId: string,
    queryMsgId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void> {
    await this.streamGenerationHandler.continueStreamCompletion(
      conversationId,
      queryMsgId,
      selectedVariantsMap
    )
  }

  // 查找特定会话的生成状态
  async editMessage(messageId: string, content: string): Promise<Message> {
    return await this.messageManager.editMessage(messageId, content)
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.messageManager.deleteMessage(messageId)
  }

  async retryMessage(messageId: string): Promise<AssistantMessage> {
    const message = await this.messageManager.getMessage(messageId)
    if (message.role !== 'assistant') {
      throw new Error('只能重试助手消息')
    }

    const userMessage = await this.messageManager.getMessage(message.parentId || '')
    if (!userMessage) {
      throw new Error('找不到对应的用户消息')
    }
    const conversation = await this.getConversation(message.conversationId)
    const { providerId, modelId } = conversation.settings
    const assistantMessage = await this.messageManager.retryMessage(messageId, {
      totalTokens: 0,
      generationTime: 0,
      firstTokenTime: 0,
      tokensPerSecond: 0,
      contextUsage: 0,
      inputTokens: 0,
      outputTokens: 0,
      model: modelId,
      provider: providerId
    })

    // 初始化生成状态
    this.generatingMessages.set(assistantMessage.id, {
      message: assistantMessage as AssistantMessage,
      conversationId: message.conversationId,
      startTime: Date.now(),
      firstTokenTime: null,
      promptTokens: 0,
      reasoningStartTime: null,
      reasoningEndTime: null,
      lastReasoningTime: null
    })

    return assistantMessage as AssistantMessage
  }

  async regenerateFromUserMessage(
    conversationId: string,
    userMessageId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage> {
    return this.streamGenerationHandler.regenerateFromUserMessage(
      conversationId,
      userMessageId,
      selectedVariantsMap
    )
  }

  async getMessageVariants(messageId: string): Promise<Message[]> {
    return await this.messageManager.getMessageVariants(messageId)
  }

  async updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void> {
    await this.messageManager.updateMessageStatus(messageId, status)
  }

  async updateMessageMetadata(
    messageId: string,
    metadata: Partial<MESSAGE_METADATA>
  ): Promise<void> {
    await this.messageManager.updateMessageMetadata(messageId, metadata)
  }

  async markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void> {
    await this.messageManager.markMessageAsContextEdge(messageId, isEdge)
  }

  async getActiveConversationId(tabId: number): Promise<string | null> {
    return this.conversationManager.getActiveConversationIdSync(tabId)
  }

  getGeneratingMessageState(messageId: string): GeneratingMessageState | null {
    return this.generatingMessages.get(messageId) || null
  }

  getConversationGeneratingMessages(conversationId: string): AssistantMessage[] {
    return Array.from(this.generatingMessages.values())
      .filter((state) => state.conversationId === conversationId)
      .map((state) => state.message)
  }

  async stopMessageGeneration(messageId: string): Promise<void> {
    const state = this.generatingMessages.get(messageId)
    if (state) {
      // 设置统一的取消标志
      state.isCancelled = true

      // 刷新剩余缓冲内容
      if (state.adaptiveBuffer) {
        await this.contentBufferHandler.flushAdaptiveBuffer(messageId)
      }

      // 清理缓冲相关资源
      this.contentBufferHandler.cleanupContentBuffer(state)

      // 标记消息不再处于搜索状态
      if (state.isSearching) {
        this.searchingMessages.delete(messageId)

        // 停止搜索窗口
        await this.searchManager.stopSearch(state.conversationId)
      }

      // 添加用户取消的消息块
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

      // 更新消息状态和内容
      await this.messageManager.updateMessageStatus(messageId, 'error')
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      // 停止流式生成
      await this.llmProviderPresenter.stopStream(messageId)

      // 清理生成状态
      this.generatingMessages.delete(messageId)
    }
  }

  async stopConversationGeneration(conversationId: string): Promise<void> {
    const messageIds = Array.from(this.generatingMessages.entries())
      .filter(([, state]) => state.conversationId === conversationId)
      .map(([messageId]) => messageId)

    await Promise.all(messageIds.map((messageId) => this.stopMessageGeneration(messageId)))
  }

  async summaryTitles(tabId?: number, conversationId?: string): Promise<string> {
    return this.utilityHandler.summaryTitles(tabId, conversationId)
  }

  async clearActiveThread(tabId: number): Promise<void> {
    this.clearActiveConversation(tabId, { notify: true })
  }

  async clearAllMessages(conversationId: string): Promise<void> {
    await this.messageManager.clearAllMessages(conversationId)
    // 检查所有 tab 中的活跃会话
    const tabs = this.getTabsByConversation(conversationId)
    if (tabs.length > 0) {
      await this.stopConversationGeneration(conversationId)
    }
  }

  async getMessageExtraInfo(messageId: string, type: string): Promise<Record<string, unknown>[]> {
    const attachments = await this.sqlitePresenter.getMessageAttachments(messageId, type)
    return attachments.map((attachment) => JSON.parse(attachment.content))
  }

  async getMainMessageByParentId(
    conversationId: string,
    parentId: string
  ): Promise<Message | null> {
    const message = await this.messageManager.getMainMessageByParentId(conversationId, parentId)
    if (!message) {
      return null
    }
    return message
  }

  destroy() {
    this.searchManager.destroy()
  }

  /**
   * 创建会话的分支
   * @param targetConversationId 源会话ID
   * @param targetMessageId 目标消息ID（截止到该消息的所有消息将被复制）
   * @param newTitle 新会话标题
   * @param settings 新会话设置
   * @param selectedVariantsMap 选定的变体映射表 (可选)
   * @returns 新创建的会话ID
   */
  async forkConversation(
    targetConversationId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<CONVERSATION_SETTINGS>,
    selectedVariantsMap?: Record<string, string>
  ): Promise<string> {
    return this.conversationManager.forkConversation(
      targetConversationId,
      targetMessageId,
      newTitle,
      settings,
      selectedVariantsMap
    )
  }

  // 翻译文本
  async translateText(text: string, tabId: number): Promise<string> {
    return this.utilityHandler.translateText(text, tabId)
  }

  // AI询问
  async askAI(text: string, tabId: number): Promise<string> {
    return this.utilityHandler.askAI(text, tabId)
  }

  /**
   * 导出会话内容
   * @param conversationId 会话ID
   * @param format 导出格式 ('markdown' | 'html' | 'txt')
   * @returns 包含文件名和内容的对象
   */
  async exportConversation(
    conversationId: string,
    format: ConversationExportFormat = 'markdown'
  ): Promise<{
    filename: string
    content: string
  }> {
    return this.utilityHandler.exportConversation(conversationId, format)
  }

  async handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all',
    remember: boolean = true
  ): Promise<void> {
    await this.permissionHandler.handlePermissionResponse(
      messageId,
      toolCallId,
      granted,
      permissionType,
      remember
    )
  }

  // 等待MCP服务重启完成并准备就绪

  // 查找权限授予后待执行的工具调用

  /**
   * Get request preview for debugging (DEV mode only)
   * Reconstructs the request parameters that would be sent to the provider
   */
  async getMessageRequestPreview(messageId: string): Promise<unknown> {
    return this.utilityHandler.getMessageRequestPreview(messageId)
  }

  async getAcpWorkdir(conversationId: string, agentId: string): Promise<AcpWorkdirInfo> {
    return this.llmProviderPresenter.getAcpWorkdir(conversationId, agentId)
  }

  async setAcpWorkdir(
    conversationId: string,
    agentId: string,
    workdir: string | null
  ): Promise<void> {
    await this.llmProviderPresenter.setAcpWorkdir(conversationId, agentId, workdir)
  }
}
