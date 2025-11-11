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
  MCPToolResponse,
  MCPToolDefinition,
  ChatMessage,
  LLMAgentEventData
} from '@shared/presenter'
import { ModelType } from '@shared/model'
import { presenter } from '@/presenter'
import { MessageManager } from './messageManager'
import { eventBus, SendTarget } from '@/eventbus'
import {
  AssistantMessage,
  Message,
  AssistantMessageBlock,
  SearchEngineTemplate,
  UserMessage,
  MessageFile,
  UserMessageContent
} from '@shared/chat'
import { SearchManager } from './searchManager'
import { ContentEnricher } from './contentEnricher'
import { STREAM_EVENTS, TAB_EVENTS } from '@/events'
import { nanoid } from 'nanoid'
import {
  buildUserMessageContext,
  formatUserMessageContent,
  getNormalizedUserMessageText
} from './messageContent'
import {
  preparePromptContent,
  buildContinueToolCallContext,
  buildPostToolExecutionContext
} from './promptBuilder'
import {
  buildConversationExportContent,
  generateExportFilename,
  ConversationExportFormat
} from './conversationExporter'
import type { GeneratingMessageState } from './types'
import { ContentBufferHandler } from './handlers/contentBufferHandler'
import { ToolCallHandler } from './handlers/toolCallHandler'
import { LLMEventHandler } from './handlers/llmEventHandler'
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
      const assistantMessage = await this.generateAIResponse(conversationId, message.id)
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

  private async generateAIResponse(conversationId: string, userMessageId: string) {
    try {
      const triggerMessage = await this.messageManager.getMessage(userMessageId)
      if (!triggerMessage) {
        throw new Error('找不到触发消息')
      }

      await this.messageManager.updateMessageStatus(userMessageId, 'sent')

      const conversation = await this.getConversation(conversationId)
      const { providerId, modelId } = conversation.settings
      const assistantMessage = (await this.messageManager.sendMessage(
        conversationId,
        JSON.stringify([]),
        'assistant',
        userMessageId,
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
      )) as AssistantMessage

      return assistantMessage
    } catch (error) {
      await this.messageManager.updateMessageStatus(userMessageId, 'error')
      console.error('生成 AI 响应失败:', error)
      throw error
    }
  }

  async getMessage(messageId: string): Promise<Message> {
    return await this.messageManager.getMessage(messageId)
  }

  /**
   * 获取指定消息之前的历史消息
   * @param messageId 消息ID
   * @param limit 限制返回的消息数量
   * @returns 历史消息列表，按时间正序排列
   */
  private async getMessageHistory(messageId: string, limit: number = 100): Promise<Message[]> {
    return this.messageManager.getMessageHistory(messageId, limit)
  }

  private async rewriteUserSearchQuery(
    query: string,
    contextMessages: string,
    conversationId: string,
    searchEngine: string
  ): Promise<string> {
    const rewritePrompt = `
    你非常擅长于使用搜索引擎去获取最新的数据,你的目标是在充分理解用户的问题后，进行全面的网络搜索搜集必要的信息，首先你要提取并优化搜索的查询内容

    现在时间：${new Date().toISOString()}
    正在使用的搜索引擎：${searchEngine}

    请遵循以下规则重写搜索查询：
    1. 根据用户的问题和上下文，重写应该进行搜索的关键词
    2. 如果需要使用时间，则根据当前时间给出需要查询的具体时间日期信息
    3. 生成的查询关键词要选择合适的语言，考虑用户的问题类型使用最适合的语言进行搜索，例如某些问题应该保持用户的问题语言，而有一些则更适合翻译成英语或其他语言
    4. 保持查询简洁，通常不超过3个关键词, 最多不要超过5个关键词，参考当前搜索引擎的查询习惯重写关键字

    直接返回优化后的搜索词，不要有任何额外说明。
    如果你觉得用户的问题不需要进行搜索，请直接返回"无须搜索"。

    如下是之前对话的上下文：
    <context_messages>
    ${contextMessages}
    </context_messages>
    如下是用户的问题：
    <user_question>
    ${query}
    </user_question>
    `
    const conversation = await this.getConversation(conversationId)
    if (!conversation) {
      return query
    }
    console.log('rewriteUserSearchQuery', query, contextMessages, conversation.id)
    const { providerId, modelId } = conversation.settings
    try {
      const rewrittenQuery = await this.llmProviderPresenter.generateCompletion(
        this.searchAssistantProviderId || providerId,
        [
          {
            role: 'user',
            content: rewritePrompt
          }
        ],
        this.searchAssistantModel?.id || modelId
      )
      return rewrittenQuery.trim() || query
    } catch (error) {
      console.error('重写搜索查询失败:', error)
      return query
    }
  }

  /**
   * 检查消息是否已被取消
   * @param messageId 消息ID
   * @returns 是否已被取消
   */
  private isMessageCancelled(messageId: string): boolean {
    const state = this.generatingMessages.get(messageId)
    return !state || state.isCancelled === true
  }

  /**
   * 如果消息已被取消，则抛出错误
   * @param messageId 消息ID
   */
  private throwIfCancelled(messageId: string): void {
    if (this.isMessageCancelled(messageId)) {
      throw new Error('common.error.userCanceledGeneration')
    }
  }

  private async startStreamSearch(
    conversationId: string,
    messageId: string,
    query: string
  ): Promise<SearchResult[]> {
    const state = this.generatingMessages.get(messageId)
    if (!state) {
      throw new Error('找不到生成状态')
    }

    const activeEngine = this.searchManager.getActiveEngine()
    const labelValue = 'web_search'
    const engineId = activeEngine?.id ?? labelValue
    const engineName = activeEngine?.name ?? engineId

    // 检查是否已被取消
    this.throwIfCancelled(messageId)

    const searchId = nanoid()
    // 添加搜索加载状态
    const searchBlock: AssistantMessageBlock = {
      id: searchId,
      type: 'search',
      content: '',
      status: 'loading',
      timestamp: Date.now(),
      extra: {
        total: 0,
        searchId,
        pages: [],
        label: labelValue,
        name: labelValue,
        engine: engineName,
        provider: engineName
      }
    }
    this.llmEventHandler.finalizeLastBlock(state)
    state.message.content.push(searchBlock)
    await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))
    // 标记消息为搜索状态
    state.isSearching = true
    this.searchingMessages.add(messageId)
    try {
      // 获取历史消息用于上下文
      const contextMessages = await this.getContextMessages(conversationId)
      // 检查是否已被取消
      this.throwIfCancelled(messageId)

      const formattedContext = contextMessages
        .map((msg) => {
          if (msg.role === 'user') {
            const content = msg.content as UserMessageContent
            const userContext = buildUserMessageContext(content)
            return `user: ${userContext}`
          } else if (msg.role === 'assistant') {
            let finalContent = 'assistant: '
            const content = msg.content as AssistantMessageBlock[]
            content.forEach((block) => {
              if (block.type === 'content') {
                finalContent += block.content + '\n'
              }
              if (block.type === 'search') {
                finalContent += `search-result: ${JSON.stringify(block.extra)}`
              }
              if (block.type === 'tool_call') {
                finalContent += `tool_call: ${JSON.stringify(block.tool_call)}`
              }
              if (block.type === 'image') {
                finalContent += `image: ${block.image_data?.data}`
              }
            })
            return finalContent
          } else {
            return JSON.stringify(msg.content)
          }
        })
        .join('\n')

      // 检查是否已被取消
      this.throwIfCancelled(messageId)

      // 重写搜索查询
      searchBlock.status = 'optimizing'
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))
      console.log('optimizing')

      const optimizedQuery = await this.rewriteUserSearchQuery(
        query,
        formattedContext,
        conversationId,
        engineName
      ).catch((err) => {
        console.error('重写搜索查询失败:', err)
        return query
      })

      // 如果不需要搜索，直接返回空结果
      if (optimizedQuery.includes('无须搜索')) {
        searchBlock.status = 'success'
        searchBlock.content = ''
        await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))
        state.isSearching = false
        this.searchingMessages.delete(messageId)
        return []
      }

      // 检查是否已被取消
      this.throwIfCancelled(messageId)

      // 更新搜索状态为阅读中
      searchBlock.status = 'reading'
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      // 开始搜索
      const results = await this.searchManager.search(conversationId, optimizedQuery)

      // 检查是否已被取消
      this.throwIfCancelled(messageId)

      searchBlock.status = 'loading'
      const pages = results
        .filter((item) => item && (item.icon || item.favicon))
        .slice(0, 6)
        .map((item) => ({
          url: item?.url || '',
          icon: item?.icon || item?.favicon || ''
        }))
      const previousExtra = searchBlock.extra ?? {}
      searchBlock.extra = {
        ...previousExtra,
        total: results.length,
        pages
      }
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      // 保存搜索结果
      for (const result of results) {
        // 检查是否已被取消
        this.throwIfCancelled(messageId)

        await this.sqlitePresenter.addMessageAttachment(
          messageId,
          'search_result',
          JSON.stringify({
            title: result.title,
            url: result.url,
            content: result.content || '',
            description: result.description || '',
            icon: result.icon || result.favicon || '',
            rank: typeof result.rank === 'number' ? result.rank : undefined,
            searchId
          })
        )
      }

      // 检查是否已被取消
      this.throwIfCancelled(messageId)

      // 更新搜索状态为成功
      searchBlock.status = 'success'
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      // 标记消息搜索完成
      state.isSearching = false
      this.searchingMessages.delete(messageId)

      return results
    } catch (error) {
      // 标记消息搜索完成
      state.isSearching = false
      this.searchingMessages.delete(messageId)

      // 更新搜索状态为错误
      searchBlock.status = 'error'
      searchBlock.content = String(error)
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      if (String(error).includes('userCanceledGeneration')) {
        // 如果是取消操作导致的错误，确保搜索窗口关闭
        this.searchManager.stopSearch(state.conversationId)
      }

      return []
    }
  }

  private async getLastUserMessage(conversationId: string): Promise<Message | null> {
    return await this.messageManager.getLastUserMessage(conversationId)
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
  ) {
    const state = this.findGeneratingState(conversationId)
    if (!state) {
      console.warn('未找到状态，conversationId:', conversationId)
      return
    }
    try {
      // 设置消息未取消
      state.isCancelled = false

      // 1. 获取上下文信息
      const { conversation, userMessage, contextMessages } = await this.prepareConversationContext(
        conversationId,
        queryMsgId,
        selectedVariantsMap
      )

      const { providerId, modelId } = conversation.settings
      const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)
      if (!modelConfig) {
        throw new Error(`Model config not found for provider ${providerId} and model ${modelId}`)
      }
      const { vision } = modelConfig || {}
      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 2. 处理用户消息内容
      const { userContent, urlResults, imageFiles } = await this.processUserMessageContent(
        userMessage as UserMessage
      )

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 3. 处理搜索（如果需要）
      let searchResults: SearchResult[] | null = null
      if ((userMessage.content as UserMessageContent).search) {
        try {
          searchResults = await this.startStreamSearch(
            conversationId,
            state.message.id,
            userContent
          )
          // 检查是否已被取消
          this.throwIfCancelled(state.message.id)
        } catch (error) {
          // 如果是用户取消导致的错误，不继续后续步骤
          if (String(error).includes('userCanceledGeneration')) {
            return
          }
          // 其他错误继续处理（搜索失败不应影响生成）
          console.error('搜索过程中出错:', error)
        }
      }

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 4. 准备提示内容
      const { finalContent, promptTokens } = await preparePromptContent({
        conversation,
        userContent,
        contextMessages,
        searchResults,
        urlResults,
        userMessage,
        vision: Boolean(vision),
        imageFiles: vision ? imageFiles : [],
        supportsFunctionCall: modelConfig.functionCall,
        modelType: modelConfig.type
      })

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 5. 更新生成状态
      await this.updateGenerationState(state, promptTokens)

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)
      // 6. 启动流式生成

      // 重新获取最新的会话设置，以防在之前的 await 期间发生变化
      const currentConversation = await this.getConversation(conversationId)
      const {
        providerId: currentProviderId,
        modelId: currentModelId,
        temperature: currentTemperature,
        maxTokens: currentMaxTokens,
        enabledMcpTools: currentEnabledMcpTools,
        thinkingBudget: currentThinkingBudget,
        reasoningEffort: currentReasoningEffort,
        verbosity: currentVerbosity,
        enableSearch: currentEnableSearch,
        forcedSearch: currentForcedSearch,
        searchStrategy: currentSearchStrategy
      } = currentConversation.settings
      const stream = this.llmProviderPresenter.startStreamCompletion(
        currentProviderId, // 使用最新的设置
        finalContent,
        currentModelId, // 使用最新的设置
        state.message.id,
        currentTemperature, // 使用最新的设置
        currentMaxTokens, // 使用最新的设置
        currentEnabledMcpTools,
        currentThinkingBudget,
        currentReasoningEffort,
        currentVerbosity,
        currentEnableSearch,
        currentForcedSearch,
        currentSearchStrategy
      )
      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.handleLLMAgentEnd(msg)
        }
      }
    } catch (error) {
      // 检查是否是取消错误
      if (String(error).includes('userCanceledGeneration')) {
        console.log('消息生成已被用户取消')
        return
      }

      console.error('流式生成过程中出错:', error)
      await this.messageManager.handleMessageError(state.message.id, String(error))
      throw error
    }
  }
  async continueStreamCompletion(
    conversationId: string,
    queryMsgId: string,
    selectedVariantsMap?: Record<string, string>
  ) {
    const state = this.findGeneratingState(conversationId)
    if (!state) {
      console.warn('未找到状态，conversationId:', conversationId)
      return
    }

    try {
      // 设置消息未取消
      state.isCancelled = false

      // 1. 获取需要继续的消息
      const queryMessage = await this.messageManager.getMessage(queryMsgId)
      if (!queryMessage) {
        throw new Error('找不到指定的消息')
      }

      // 2. 解析最后一个 action block
      const content = queryMessage.content as AssistantMessageBlock[]
      const lastActionBlock = content.filter((block) => block.type === 'action').pop()

      if (!lastActionBlock || lastActionBlock.type !== 'action') {
        throw new Error('找不到最后的 action block')
      }

      // 3. 检查是否是 maximum_tool_calls_reached
      let toolCallResponse: { content: string; rawData: MCPToolResponse } | null = null
      const toolCall = lastActionBlock.tool_call

      if (lastActionBlock.action_type === 'maximum_tool_calls_reached' && toolCall) {
        // 设置 needContinue 为 0（false）
        if (lastActionBlock.extra) {
          lastActionBlock.extra = {
            ...lastActionBlock.extra,
            needContinue: false
          }
        }
        await this.messageManager.editMessage(queryMsgId, JSON.stringify(content))

        // 4. 检查工具调用参数
        if (!toolCall.id || !toolCall.name || !toolCall.params) {
          // 参数不完整就跳过，然后继续执行即可
          console.warn('工具调用参数不完整')
        } else {
          // 5. 调用工具获取结果
          toolCallResponse = await presenter.mcpPresenter.callTool({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: toolCall.params
            },
            server: {
              name: toolCall.server_name || '',
              icons: toolCall.server_icons || '',
              description: toolCall.server_description || ''
            }
          })
        }
      }

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 6. 获取上下文信息
      const { conversation, contextMessages, userMessage } = await this.prepareConversationContext(
        conversationId,
        state.message.id,
        selectedVariantsMap
      )

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 7. 准备提示内容
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
      const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)

      const { finalContent, promptTokens } = await preparePromptContent({
        conversation,
        userContent: 'continue',
        contextMessages,
        searchResults: null, // 不进行搜索
        urlResults: [], // 没有 URL 结果
        userMessage,
        vision: false,
        imageFiles: [], // 没有图片文件
        supportsFunctionCall: modelConfig.functionCall,
        modelType: modelConfig.type
      })

      // 8. 更新生成状态
      await this.updateGenerationState(state, promptTokens)

      // 9. 如果有工具调用结果，发送工具调用结果事件
      if (toolCallResponse && toolCall) {
        // console.log('toolCallResponse', toolCallResponse)
        eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
          eventId: state.message.id,
          content: '',
          tool_call: 'start',
          tool_call_id: toolCall.id,
          tool_call_name: toolCall.name,
          tool_call_params: toolCall.params,
          tool_call_response: toolCallResponse.content,
          tool_call_server_name: toolCall.server_name,
          tool_call_server_icons: toolCall.server_icons,
          tool_call_server_description: toolCall.server_description
        })
        eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
          eventId: state.message.id,
          content: '',
          tool_call: 'running',
          tool_call_id: toolCall.id,
          tool_call_name: toolCall.name,
          tool_call_params: toolCall.params,
          tool_call_response: toolCallResponse.content,
          tool_call_server_name: toolCall.server_name,
          tool_call_server_icons: toolCall.server_icons,
          tool_call_server_description: toolCall.server_description
        })
        eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
          eventId: state.message.id,
          content: '',
          tool_call: 'end',
          tool_call_id: toolCall.id,
          tool_call_response: toolCallResponse.content,
          tool_call_name: toolCall.name,
          tool_call_params: toolCall.params,
          tool_call_server_name: toolCall.server_name,
          tool_call_server_icons: toolCall.server_icons,
          tool_call_server_description: toolCall.server_description,
          tool_call_response_raw: toolCallResponse.rawData
        })
      }

      // 10. 启动流式生成
      const stream = this.llmProviderPresenter.startStreamCompletion(
        providerId,
        finalContent,
        modelId,
        state.message.id,
        temperature,
        maxTokens,
        enabledMcpTools,
        thinkingBudget,
        reasoningEffort,
        verbosity,
        enableSearch,
        forcedSearch,
        searchStrategy
      )
      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.handleLLMAgentEnd(msg)
        }
      }
    } catch (error) {
      // 检查是否是取消错误
      if (String(error).includes('userCanceledGeneration')) {
        console.log('消息生成已被用户取消')
        return
      }

      console.error('继续生成过程中出错:', error)
      await this.messageManager.handleMessageError(state.message.id, String(error))
      throw error
    }
  }

  // 查找特定会话的生成状态
  private findGeneratingState(conversationId: string): GeneratingMessageState | null {
    return (
      Array.from(this.generatingMessages.values()).find(
        (state) => state.conversationId === conversationId
      ) || null
    )
  }

  // 准备会话上下文
  private async prepareConversationContext(
    conversationId: string,
    queryMsgId?: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<{
    conversation: CONVERSATION
    userMessage: Message
    contextMessages: Message[]
  }> {
    const conversation = await this.getConversation(conversationId)
    let contextMessages: Message[] = []
    let userMessage: Message | null = null

    if (queryMsgId) {
      // 处理指定消息ID的情况
      const queryMessage = await this.getMessage(queryMsgId)
      if (!queryMessage) {
        throw new Error('找不到指定的消息')
      }

      // 修复：根据消息类型确定如何获取用户消息
      if (queryMessage.role === 'user') {
        // 如果 queryMessage 就是用户消息，直接使用
        userMessage = queryMessage
      } else if (queryMessage.role === 'assistant') {
        // 如果 queryMessage 是助手消息，获取它的 parentId（用户消息）
        if (!queryMessage.parentId) {
          throw new Error('助手消息缺少 parentId')
        }
        userMessage = await this.getMessage(queryMessage.parentId)
        if (!userMessage) {
          throw new Error('找不到触发消息')
        }
      } else {
        throw new Error('不支持的消息类型')
      }

      contextMessages = await this.getMessageHistory(
        userMessage.id,
        conversation.settings.contextLength
      )
    } else {
      // 获取最新的用户消息
      userMessage = await this.getLastUserMessage(conversationId)
      if (!userMessage) {
        throw new Error('找不到用户消息')
      }
      contextMessages = await this.getContextMessages(conversationId)
    }

    // 在获取原始 contextMessages 列表之后，但在将其传递给 LLM 上下文筛选和格式化函数之前，
    // 插入核心“变体内容和元数据替换”逻辑。
    if (selectedVariantsMap && Object.keys(selectedVariantsMap).length > 0) {
      contextMessages = contextMessages.map((msg) => {
        if (msg.role === 'assistant' && selectedVariantsMap[msg.id] && msg.variants) {
          const selectedVariantId = selectedVariantsMap[msg.id]
          const selectedVariant = msg.variants.find((v) => v.id === selectedVariantId)

          if (selectedVariant) {
            // 创建一个新的 Message 对象副本，并用变体的内容和元数据替换
            // 使用深拷贝以避免意外修改原始对象
            const newMsg = JSON.parse(JSON.stringify(msg))
            newMsg.content = selectedVariant.content
            newMsg.usage = selectedVariant.usage
            newMsg.model_id = selectedVariant.model_id
            newMsg.model_provider = selectedVariant.model_provider
            // 返回修改后的副本
            return newMsg
          }
          // 防御性代码：如果找不到变体，则静默回退到使用原始主消息
        }
        // 对于非助手消息或没有选择变体的助手消息，返回原始消息
        return msg
      })
    }

    // 处理 UserMessageMentionBlock
    if (userMessage.role === 'user') {
      const msgContent = userMessage.content as UserMessageContent
      if (msgContent.content && !msgContent.text) {
        msgContent.text = formatUserMessageContent(msgContent.content)
      }
    }

    // 任何情况都使用最新配置
    const webSearchEnabled = this.configPresenter.getSetting('input_webSearch') as boolean
    const thinkEnabled = this.configPresenter.getSetting('input_deepThinking') as boolean
    ;(userMessage.content as UserMessageContent).search = webSearchEnabled
    ;(userMessage.content as UserMessageContent).think = thinkEnabled
    return { conversation, userMessage, contextMessages }
  }

  // 处理用户消息内容
  private async processUserMessageContent(userMessage: UserMessage): Promise<{
    userContent: string
    urlResults: SearchResult[]
    imageFiles: MessageFile[] // 图片文件列表
  }> {
    // 处理文本内容
    const userContent = buildUserMessageContext(userMessage.content)

    // 从用户消息中提取并丰富URL内容
    const normalizedText = getNormalizedUserMessageText(userMessage.content)
    const urlResults = await ContentEnricher.extractAndEnrichUrls(normalizedText)

    // 提取图片文件

    const imageFiles =
      userMessage.content.files?.filter((file) => {
        // 根据文件类型、MIME类型或扩展名过滤图片文件
        const isImage =
          file.mimeType.startsWith('data:image') ||
          /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(file.name || '')
        return isImage
      }) || []

    return { userContent, urlResults, imageFiles }
  }

  // 更新生成状态
  private async updateGenerationState(
    state: GeneratingMessageState,
    promptTokens: number
  ): Promise<void> {
    // 更新生成状态
    this.generatingMessages.set(state.message.id, {
      ...state,
      startTime: Date.now(),
      firstTokenTime: null,
      promptTokens
    })

    // 更新消息的usage信息
    await this.messageManager.updateMessageMetadata(state.message.id, {
      totalTokens: promptTokens,
      generationTime: 0,
      firstTokenTime: 0,
      tokensPerSecond: 0
    })
  }

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
    const userMessage = await this.messageManager.getMessage(userMessageId)
    if (!userMessage || userMessage.role !== 'user') {
      throw new Error('Can only regenerate based on user messages.')
    }

    const conversation = await this.getConversation(conversationId)
    const { providerId, modelId } = conversation.settings

    const assistantMessage = (await this.messageManager.sendMessage(
      conversationId,
      JSON.stringify([]),
      'assistant',
      userMessageId,
      false,
      {
        totalTokens: 0,
        generationTime: 0,
        firstTokenTime: 0,
        tokensPerSecond: 0,
        contextUsage: 0,
        inputTokens: 0,
        outputTokens: 0,
        model: modelId,
        provider: providerId
      }
    )) as AssistantMessage

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

    this.startStreamCompletion(conversationId, userMessageId, selectedVariantsMap).catch((e) => {
      console.error('Failed to start regeneration from user message:', e)
    })

    return assistantMessage
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
    const activeId = tabId !== undefined ? this.getActiveConversationIdSync(tabId) : null
    const targetConversationId = conversationId ?? activeId ?? undefined
    if (!targetConversationId) {
      throw new Error('找不到当前对话')
    }
    const conversation = await this.getConversation(targetConversationId)
    if (!conversation) {
      throw new Error('找不到当前对话')
    }
    let summaryProviderId = conversation.settings.providerId
    const modelId = this.searchAssistantModel?.id
    summaryProviderId = this.searchAssistantProviderId || conversation.settings.providerId
    const messages = await this.getContextMessages(conversation.id)
    const selectedVariantsMap = conversation.settings.selectedVariantsMap || {}
    const variantAwareMessages = messages.map((msg) => {
      if (msg.role === 'assistant' && selectedVariantsMap[msg.id] && msg.variants) {
        const selectedVariantId = selectedVariantsMap[msg.id]
        const selectedVariant = msg.variants.find((v) => v.id === selectedVariantId)

        if (selectedVariant) {
          const newMsg = JSON.parse(JSON.stringify(msg))
          newMsg.content = selectedVariant.content
          newMsg.usage = selectedVariant.usage
          newMsg.model_id = selectedVariant.model_id
          newMsg.model_provider = selectedVariant.model_provider
          newMsg.model_name = selectedVariant.model_name
          return newMsg
        }
      }
      return msg
    })
    const messagesWithLength = variantAwareMessages
      .map((msg) => {
        if (msg.role === 'user') {
          const userContent = msg.content as UserMessageContent
          const serializedContent = buildUserMessageContext(userContent)
          return {
            message: msg,
            length: serializedContent.length,
            formattedMessage: {
              role: 'user' as const,
              content: serializedContent
            }
          }
        } else {
          const content = (msg.content as AssistantMessageBlock[])
            .filter((block) => block.type === 'content')
            .map((block) => block.content)
            .join('\n')
          return {
            message: msg,
            length: content.length,
            formattedMessage: {
              role: 'assistant' as const,
              content: content
            }
          }
        }
      })
      .filter((item) => item.formattedMessage.content.length > 0)
    const title = await this.llmProviderPresenter.summaryTitles(
      messagesWithLength.map((item) => item.formattedMessage),
      summaryProviderId || conversation.settings.providerId,
      modelId || conversation.settings.modelId
    )
    console.log('-------------> title \n', title)
    let cleanedTitle = title.replace(/<think>.*?<\/think>/g, '').trim()
    cleanedTitle = cleanedTitle.replace(/^<think>/, '').trim()
    console.log('-------------> cleanedTitle \n', cleanedTitle)
    return cleanedTitle
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
    try {
      let conversation = await this.getActiveConversation(tabId)
      if (!conversation) {
        // 创建一个临时对话用于翻译
        const defaultProvider = this.configPresenter.getDefaultProviders()[0]
        const models = await this.llmProviderPresenter.getModelList(defaultProvider.id)
        const defaultModel = models[0]
        const conversationId = await this.createConversation(
          '临时翻译对话',
          {
            modelId: defaultModel.id,
            providerId: defaultProvider.id
          },
          tabId
        )
        conversation = await this.getConversation(conversationId)
      }

      const { providerId, modelId } = conversation.settings
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            '你是一个翻译助手。请将用户输入的文本翻译成中文。只返回翻译结果，不要添加任何其他内容。'
        },
        {
          role: 'user',
          content: text
        }
      ]

      let translatedText = ''
      const stream = this.llmProviderPresenter.startStreamCompletion(
        providerId,
        messages,
        modelId,
        'translate-' + Date.now(),
        0.3,
        1000
      )

      for await (const event of stream) {
        if (event.type === 'response') {
          const msg = event.data as LLMAgentEventData
          if (msg.content) {
            translatedText += msg.content
          }
        } else if (event.type === 'error') {
          const msg = event.data as { eventId: string; error: string }
          throw new Error(msg.error || '翻译失败')
        }
      }

      return translatedText.trim()
    } catch (error) {
      console.error('翻译失败:', error)
      throw error
    }
  }

  // AI询问
  async askAI(text: string, tabId: number): Promise<string> {
    try {
      let conversation = await this.getActiveConversation(tabId)
      if (!conversation) {
        // 创建一个临时对话用于AI询问
        const defaultProvider = this.configPresenter.getDefaultProviders()[0]
        const models = await this.llmProviderPresenter.getModelList(defaultProvider.id)
        const defaultModel = models[0]
        const conversationId = await this.createConversation(
          '临时AI对话',
          {
            modelId: defaultModel.id,
            providerId: defaultProvider.id
          },
          tabId
        )
        conversation = await this.getConversation(conversationId)
      }

      const { providerId, modelId } = conversation.settings
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: '你是一个AI助手。请简洁地回答用户的问题。'
        },
        {
          role: 'user',
          content: text
        }
      ]

      let aiAnswer = ''
      const stream = this.llmProviderPresenter.startStreamCompletion(
        providerId,
        messages,
        modelId,
        'ask-ai-' + Date.now(),
        0.7,
        1000
      )

      for await (const event of stream) {
        if (event.type === 'response') {
          const msg = event.data as LLMAgentEventData
          if (msg.content) {
            aiAnswer += msg.content
          }
        } else if (event.type === 'error') {
          const msg = event.data as { eventId: string; error: string }
          throw new Error(msg.error || 'AI回答失败')
        }
      }

      return aiAnswer.trim()
    } catch (error) {
      console.error('AI询问失败:', error)
      throw error
    }
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
    try {
      // 获取会话信息
      const conversation = await this.getConversation(conversationId)
      if (!conversation) {
        throw new Error('会话不存在')
      }

      // 获取所有消息
      const { list: messages } = await this.getMessages(conversationId, 1, 10000)

      // 过滤掉未发送成功的消息
      const validMessages = messages.filter((msg) => msg.status === 'sent')

      // 应用变体选择
      const selectedVariantsMap = conversation.settings.selectedVariantsMap || {}
      const variantAwareMessages = validMessages.map((msg) => {
        if (msg.role === 'assistant' && selectedVariantsMap[msg.id] && msg.variants) {
          const selectedVariantId = selectedVariantsMap[msg.id]
          const selectedVariant = msg.variants.find((v) => v.id === selectedVariantId)

          if (selectedVariant) {
            const newMsg = JSON.parse(JSON.stringify(msg))
            newMsg.content = selectedVariant.content
            newMsg.usage = selectedVariant.usage
            newMsg.model_id = selectedVariant.model_id
            newMsg.model_provider = selectedVariant.model_provider
            newMsg.model_name = selectedVariant.model_name
            return newMsg
          }
        }
        return msg
      })

      // 生成文件名
      const filename = generateExportFilename(format)
      const content = buildConversationExportContent(conversation, variantAwareMessages, format)

      return { filename, content }
    } catch (error) {
      console.error('Failed to export conversation:', error)
      throw error
    }
  }

  // 权限响应处理方法 - 重新设计为基于消息数据的流程
  async handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all',
    remember: boolean = true
  ): Promise<void> {
    console.log(`[ThreadPresenter] Handling permission response:`, {
      messageId,
      toolCallId,
      granted,
      permissionType,
      remember
    })

    try {
      // 1. 获取消息并更新权限块状态
      const message = await this.messageManager.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        const errorMsg = `Message not found or not an assistant message (messageId: ${messageId})`
        console.error(`[ThreadPresenter] ${errorMsg}`)
        throw new Error(errorMsg)
      }

      const content = message.content as AssistantMessageBlock[]
      const permissionBlock = content.find(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'tool_call_permission' &&
          block.tool_call?.id === toolCallId
      )

      if (!permissionBlock) {
        const errorMsg = `Permission block not found (messageId: ${messageId}, toolCallId: ${toolCallId})`
        console.error(`[ThreadPresenter] ${errorMsg}`)
        console.error(
          `[ThreadPresenter] Available blocks:`,
          content.map((block) => ({
            type: block.type,
            toolCallId: block.tool_call?.id
          }))
        )
        throw new Error(errorMsg)
      }

      console.log(
        `[ThreadPresenter] Found permission block for tool: ${permissionBlock.tool_call?.name}`
      )

      // 2. 更新权限块状态
      permissionBlock.status = granted ? 'granted' : 'denied'
      if (permissionBlock.extra) {
        permissionBlock.extra.needsUserAction = false
        if (granted) {
          permissionBlock.extra.grantedPermissions = permissionType
        }
      }

      // 2.1 同步内存中的生成状态，避免后续覆盖数据库中的授权结果
      const generatingState = this.generatingMessages.get(messageId)
      if (generatingState) {
        const statePermissionBlockIndex = generatingState.message.content.findIndex(
          (block) =>
            block.type === 'action' &&
            block.action_type === 'tool_call_permission' &&
            block.tool_call?.id === toolCallId
        )

        if (statePermissionBlockIndex !== -1) {
          const statePermissionBlock = generatingState.message.content[statePermissionBlockIndex]
          generatingState.message.content[statePermissionBlockIndex] = {
            ...statePermissionBlock,
            ...permissionBlock,
            extra: permissionBlock.extra
              ? {
                  ...permissionBlock.extra
                }
              : undefined,
            tool_call: permissionBlock.tool_call
              ? {
                  ...permissionBlock.tool_call
                }
              : undefined
          }
        } else {
          console.warn(
            `[ThreadPresenter] Permission block not found in generating state, synchronizing snapshot`
          )
          generatingState.message.content = content.map((block) => ({
            ...block,
            extra: block.extra
              ? {
                  ...block.extra
                }
              : undefined,
            tool_call: block.tool_call
              ? {
                  ...block.tool_call
                }
              : undefined
          }))
        }
      }

      // 3. 保存消息更新
      await this.messageManager.editMessage(messageId, JSON.stringify(content))
      console.log(`[ThreadPresenter] Updated permission block status to: ${permissionBlock.status}`)

      if (granted) {
        // 4. 权限授予流程
        const serverName = permissionBlock?.extra?.serverName as string
        if (!serverName) {
          const errorMsg = `Server name not found in permission block (messageId: ${messageId})`
          console.error(`[ThreadPresenter] ${errorMsg}`)
          throw new Error(errorMsg)
        }

        console.log(
          `[ThreadPresenter] Granting permission: ${permissionType} for server: ${serverName}`
        )
        console.log(
          `[ThreadPresenter] Waiting for permission configuration to complete before restarting agent loop...`
        )

        try {
          // 等待权限配置完成
          await presenter.mcpPresenter.grantPermission(serverName, permissionType, remember)
          console.log(`[ThreadPresenter] Permission granted successfully`)

          // 等待MCP服务重启完成
          console.log(
            `[ThreadPresenter] Permission configuration completed, waiting for MCP service restart...`
          )
          await this.waitForMcpServiceReady(serverName)

          console.log(
            `[ThreadPresenter] MCP service ready, now restarting agent loop for message: ${messageId}`
          )
        } catch (permissionError) {
          console.error(`[ThreadPresenter] Failed to grant permission:`, permissionError)
          // 权限授予失败，将状态更新为错误
          permissionBlock.status = 'error'
          await this.messageManager.editMessage(messageId, JSON.stringify(content))
          throw permissionError
        }

        // 5. 现在重启agent loop
        await this.restartAgentLoopAfterPermission(messageId)
      } else {
        console.log(
          `[ThreadPresenter] Permission denied, continuing generation with error context for message: ${messageId}`
        )
        // 6. 权限被拒绝 - 继续agent loop，将拒绝信息作为工具调用失败结果
        await this.continueAfterPermissionDenied(messageId)
      }
    } catch (error) {
      console.error(`[ThreadPresenter] Failed to handle permission response:`, error)

      // 确保消息状态正确更新
      try {
        const message = await this.messageManager.getMessage(messageId)
        if (message) {
          await this.messageManager.handleMessageError(messageId, String(error))
        }
      } catch (updateError) {
        console.error(`[ThreadPresenter] Failed to update message error status:`, updateError)
      }

      throw error
    }
  }

  // 重新启动agent loop (权限授予后)
  private async restartAgentLoopAfterPermission(messageId: string): Promise<void> {
    console.log(
      `[ThreadPresenter] Restarting agent loop after permission for message: ${messageId}`
    )

    try {
      // 获取消息和会话信息
      const message = await this.messageManager.getMessage(messageId)
      if (!message) {
        const errorMsg = `Message not found (messageId: ${messageId})`
        console.error(`[ThreadPresenter] ${errorMsg}`)
        throw new Error(errorMsg)
      }

      const conversationId = message.conversationId
      console.log(`[ThreadPresenter] Found message in conversation: ${conversationId}`)

      // 验证权限是否生效 - 获取最新的服务器配置
      const content = message.content as AssistantMessageBlock[]
      const permissionBlock = content.find(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'tool_call_permission' &&
          block.status === 'granted'
      )

      if (!permissionBlock) {
        const errorMsg = `No granted permission block found (messageId: ${messageId})`
        console.error(`[ThreadPresenter] ${errorMsg}`)
        console.error(
          `[ThreadPresenter] Available blocks:`,
          content.map((block) => ({
            type: block.type,
            status: block.status,
            toolCallId: block.tool_call?.id
          }))
        )
        throw new Error(errorMsg)
      }

      if (permissionBlock?.extra?.serverName) {
        console.log(
          `[ThreadPresenter] Verifying permission is active for server: ${permissionBlock.extra.serverName}`
        )
        try {
          const servers = await this.configPresenter.getMcpServers()
          const serverConfig = servers[permissionBlock.extra.serverName as string]
          console.log(
            `[ThreadPresenter] Current server permissions:`,
            serverConfig?.autoApprove || []
          )
        } catch (configError) {
          console.warn(`[ThreadPresenter] Failed to verify server permissions:`, configError)
        }
      }

      // 如果消息还在generating状态，直接继续
      const state = this.generatingMessages.get(messageId)
      if (state) {
        console.log(`[ThreadPresenter] Message still in generating state, resuming from memory`)
        if (state.pendingToolCall) {
          console.log(
            `[ThreadPresenter] Pending tool call detected after permission grant, executing tool before resuming`
          )
          await this.resumeAfterPermissionWithPendingToolCall(
            state,
            message as AssistantMessage,
            conversationId
          )
        } else {
          await this.resumeStreamCompletion(conversationId, messageId)
        }
        return
      }

      // 否则重新启动完整的agent loop
      console.log(`[ThreadPresenter] Message not in generating state, starting fresh agent loop`)

      // 重新创建生成状态
      const assistantMessage = message as AssistantMessage

      this.generatingMessages.set(messageId, {
        message: assistantMessage,
        conversationId,
        startTime: Date.now(),
        firstTokenTime: null,
        promptTokens: 0,
        reasoningStartTime: null,
        reasoningEndTime: null,
        lastReasoningTime: null,
        pendingToolCall: this.findPendingToolCallAfterPermission(content) || undefined
      })

      console.log(`[ThreadPresenter] Created new generating state for message: ${messageId}`)

      // 启动新的流式完成
      await this.startStreamCompletion(conversationId, messageId)
    } catch (error) {
      console.error(`[ThreadPresenter] Failed to restart agent loop:`, error)

      // 确保清理生成状态
      this.generatingMessages.delete(messageId)

      try {
        await this.messageManager.handleMessageError(messageId, String(error))
      } catch (updateError) {
        console.error(`[ThreadPresenter] Failed to update message error status:`, updateError)
      }

      throw error
    }
  }

  // 权限被拒绝后继续生成，将拒绝信息作为工具调用失败告知LLM
  private async continueAfterPermissionDenied(messageId: string): Promise<void> {
    console.log(`[ThreadPresenter] Continuing generation after permission denied: ${messageId}`)

    try {
      const message = await this.messageManager.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        const errorMsg = `Message not found or not an assistant message (messageId: ${messageId})`
        console.error(`[ThreadPresenter] ${errorMsg}`)
        throw new Error(errorMsg)
      }

      const conversationId = message.conversationId
      const content = message.content as AssistantMessageBlock[]

      // 查找被拒绝的权限块
      const deniedPermissionBlock = content.find(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'tool_call_permission' &&
          block.status === 'denied'
      )

      if (!deniedPermissionBlock?.tool_call) {
        console.warn(`[ThreadPresenter] No denied permission block found for message: ${messageId}`)
        return
      }

      const toolCall = deniedPermissionBlock.tool_call

      // 构建工具调用失败的响应消息
      const errorMessage = `Tool execution failed: Permission denied by user for ${toolCall.name || 'this tool'}`

      console.log(`[ThreadPresenter] Notifying LLM about permission denial: ${errorMessage}`)

      // 发送工具调用失败事件给renderer
      eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
        eventId: messageId,
        tool_call: 'end',
        tool_call_id: toolCall.id,
        tool_call_name: toolCall.name,
        tool_call_params: toolCall.params,
        tool_call_response: errorMessage,
        tool_call_server_name: toolCall.server_name,
        tool_call_server_icons: toolCall.server_icons,
        tool_call_server_description: toolCall.server_description
      })

      // 获取或创建生成状态
      let state = this.generatingMessages.get(messageId)
      if (!state) {
        // 重新创建生成状态
        const assistantMessage = message as AssistantMessage
        state = {
          message: assistantMessage,
          conversationId,
          startTime: Date.now(),
          firstTokenTime: null,
          promptTokens: 0,
          reasoningStartTime: null,
          reasoningEndTime: null,
          lastReasoningTime: null
        }
        this.generatingMessages.set(messageId, state)
      }

      // 清除pending tool call（如果有）
      state.pendingToolCall = undefined

      // 获取会话和上下文
      const { conversation, contextMessages, userMessage } = await this.prepareConversationContext(
        conversationId,
        messageId
      )

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

      const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)

      // 将 snake_case 转换为 camelCase 并构建包含工具调用失败信息的上下文
      const completedToolCall = {
        id: toolCall.id || '',
        name: toolCall.name || '',
        params: toolCall.params || '',
        response: errorMessage,
        // 注意：从 snake_case 转换为 camelCase
        serverName: toolCall.server_name,
        serverIcons: toolCall.server_icons,
        serverDescription: toolCall.server_description
      }

      const finalContent = await buildPostToolExecutionContext({
        conversation,
        contextMessages,
        userMessage,
        currentAssistantMessage: state.message,
        completedToolCall,
        modelConfig
      })

      console.log(
        `[ThreadPresenter] Restarting agent loop with tool failure context for message: ${messageId}`
      )

      // 继续agent loop
      const stream = this.llmProviderPresenter.startStreamCompletion(
        providerId,
        finalContent,
        modelId,
        messageId,
        temperature,
        maxTokens,
        enabledMcpTools,
        thinkingBudget,
        reasoningEffort,
        verbosity,
        enableSearch,
        forcedSearch,
        searchStrategy
      )

      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.handleLLMAgentEnd(msg)
        }
      }

      console.log(`[ThreadPresenter] Successfully continued after permission denial: ${messageId}`)
    } catch (error) {
      console.error(`[ThreadPresenter] Failed to continue after permission denial:`, error)

      // 清理生成状态
      this.generatingMessages.delete(messageId)

      try {
        await this.messageManager.handleMessageError(messageId, String(error))
      } catch (updateError) {
        console.error(`[ThreadPresenter] Failed to update message error status:`, updateError)
      }

      throw error
    }
  }

  // 恢复流式完成 (用于内存状态存在的情况)
  private async resumeStreamCompletion(conversationId: string, messageId: string): Promise<void> {
    const state = this.generatingMessages.get(messageId)
    if (!state) {
      console.log(
        `[ThreadPresenter] No generating state found for ${messageId}, starting fresh agent loop`
      )
      await this.startStreamCompletion(conversationId)
      return
    }

    try {
      console.log(`[ThreadPresenter] Resuming stream completion for message: ${messageId}`)

      // 关键修复：重新构建上下文，确保包含被中断的工具调用信息
      const conversation = await this.getConversation(conversationId)
      if (!conversation) {
        const errorMsg = `Conversation not found (conversationId: ${conversationId})`
        console.error(`[ThreadPresenter] ${errorMsg}`)
        throw new Error(errorMsg)
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
      const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)

      if (!modelConfig) {
        console.warn(
          `[ThreadPresenter] Model config not found for ${modelId} (${providerId}), using default`
        )
      }

      // 查找被权限中断的工具调用
      const pendingToolCall = this.findPendingToolCallAfterPermission(state.message.content)

      if (!pendingToolCall) {
        console.warn(
          `[ThreadPresenter] No pending tool call found after permission grant, using normal context`
        )
        // 如果没有找到待执行的工具调用，使用正常流程
        await this.startStreamCompletion(conversationId, messageId)
        return
      }

      console.log(
        `[ThreadPresenter] Found pending tool call: ${pendingToolCall.name} with ID: ${pendingToolCall.id}`
      )

      // 获取对话上下文（基于助手消息，它会自动找到相应的用户消息）
      const { contextMessages, userMessage } = await this.prepareConversationContext(
        conversationId,
        messageId // 使用助手消息ID，让prepareConversationContext自动解析
      )

      console.log(
        `[ThreadPresenter] Prepared conversation context with ${contextMessages.length} messages`
      )

      // 构建专门的继续执行上下文
      const finalContent = await buildContinueToolCallContext({
        conversation,
        contextMessages,
        userMessage,
        pendingToolCall,
        modelConfig
      })

      console.log(`[ThreadPresenter] Built continue context for tool: ${pendingToolCall.name}`)

      // Continue the agent loop with the correct context
      const stream = this.llmProviderPresenter.startStreamCompletion(
        providerId,
        finalContent,
        modelId,
        messageId,
        temperature,
        maxTokens,
        enabledMcpTools,
        thinkingBudget,
        reasoningEffort,
        verbosity,
        enableSearch,
        forcedSearch,
        searchStrategy
      )

      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.handleLLMAgentEnd(msg)
        }
      }
    } catch (error) {
      console.error('[ThreadPresenter] Failed to resume stream completion:', error)

      // 确保清理生成状态
      this.generatingMessages.delete(messageId)

      try {
        await this.messageManager.handleMessageError(messageId, String(error))
      } catch (updateError) {
        console.error(`[ThreadPresenter] Failed to update message error status:`, updateError)
      }

      throw error
    }
  }

  private async resumeAfterPermissionWithPendingToolCall(
    state: GeneratingMessageState,
    message: AssistantMessage,
    conversationId: string
  ): Promise<void> {
    const pendingToolCall = state.pendingToolCall
    if (!pendingToolCall || !pendingToolCall.id || !pendingToolCall.name) {
      console.warn(
        `[ThreadPresenter] Pending tool call data missing, falling back to standard resume`
      )
      await this.resumeStreamCompletion(conversationId, message.id)
      return
    }

    try {
      const { conversation, contextMessages, userMessage } = await this.prepareConversationContext(
        conversationId,
        message.id
      )

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

      const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)
      if (!modelConfig) {
        console.warn(
          `[ThreadPresenter] Model config not found for ${modelId} (${providerId}), falling back to standard resume`
        )
        await this.resumeStreamCompletion(conversationId, message.id)
        return
      }

      let toolDef: MCPToolDefinition | undefined
      try {
        const toolDefinitions = await presenter.mcpPresenter.getAllToolDefinitions(enabledMcpTools)
        toolDef = toolDefinitions.find((definition) => {
          if (definition.function.name !== pendingToolCall.name) {
            return false
          }
          if (pendingToolCall.serverName) {
            return definition.server.name === pendingToolCall.serverName
          }
          return true
        })
      } catch (error) {
        console.error('[ThreadPresenter] Failed to load tool definitions:', error)
      }

      if (!toolDef) {
        console.warn(
          `[ThreadPresenter] Tool definition not found for ${pendingToolCall.name}, falling back to standard resume`
        )
        await this.resumeStreamCompletion(conversationId, message.id)
        return
      }

      const resolvedToolDef = toolDef as MCPToolDefinition

      await this.handleLLMAgentResponse({
        eventId: message.id,
        tool_call: 'running',
        tool_call_id: pendingToolCall.id,
        tool_call_name: pendingToolCall.name,
        tool_call_params: pendingToolCall.params,
        tool_call_server_name: resolvedToolDef.server.name,
        tool_call_server_icons: resolvedToolDef.server.icons,
        tool_call_server_description: resolvedToolDef.server.description
      })

      let toolContent = ''
      let toolRawData: MCPToolResponse | null = null
      try {
        const toolCallResult = await presenter.mcpPresenter.callTool({
          id: pendingToolCall.id,
          type: 'function',
          function: {
            name: pendingToolCall.name,
            arguments: pendingToolCall.params
          },
          server: resolvedToolDef.server
        })
        toolContent = toolCallResult.content
        toolRawData = toolCallResult.rawData
      } catch (toolError) {
        console.error('[ThreadPresenter] Failed to execute pending tool call:', toolError)
        await this.handleLLMAgentResponse({
          eventId: message.id,
          tool_call: 'error',
          tool_call_id: pendingToolCall.id,
          tool_call_name: pendingToolCall.name,
          tool_call_params: pendingToolCall.params,
          tool_call_response: toolError instanceof Error ? toolError.message : String(toolError),
          tool_call_server_name: resolvedToolDef.server.name,
          tool_call_server_icons: resolvedToolDef.server.icons,
          tool_call_server_description: resolvedToolDef.server.description
        })
        throw toolError
      }

      if (toolRawData?.requiresPermission) {
        console.warn(
          `[ThreadPresenter] Tool ${pendingToolCall.name} still requires permission after grant`
        )
        await this.handleLLMAgentResponse({
          eventId: message.id,
          tool_call: 'permission-required',
          tool_call_id: pendingToolCall.id,
          tool_call_name: pendingToolCall.name,
          tool_call_params: pendingToolCall.params,
          tool_call_server_name:
            toolRawData.permissionRequest?.serverName || resolvedToolDef.server.name,
          tool_call_server_icons: resolvedToolDef.server.icons,
          tool_call_server_description: resolvedToolDef.server.description,
          tool_call_response: toolContent,
          permission_request: toolRawData.permissionRequest
        })
        // A new permission request will trigger a new handling flow
        return
      }

      const serializedResponse = toolContent

      await this.handleLLMAgentResponse({
        eventId: message.id,
        tool_call: 'end',
        tool_call_id: pendingToolCall.id,
        tool_call_name: pendingToolCall.name,
        tool_call_params: pendingToolCall.params,
        tool_call_response: serializedResponse,
        tool_call_server_name: resolvedToolDef.server.name,
        tool_call_server_icons: resolvedToolDef.server.icons,
        tool_call_server_description: resolvedToolDef.server.description,
        tool_call_response_raw: toolRawData ?? undefined
      })

      state.pendingToolCall = undefined

      const finalContent = await buildPostToolExecutionContext({
        conversation,
        contextMessages,
        userMessage,
        currentAssistantMessage: state.message,
        completedToolCall: {
          ...pendingToolCall,
          response: serializedResponse
        },
        modelConfig
      })

      const stream = this.llmProviderPresenter.startStreamCompletion(
        providerId,
        finalContent,
        modelId,
        message.id,
        temperature,
        maxTokens,
        enabledMcpTools,
        thinkingBudget,
        reasoningEffort,
        verbosity,
        enableSearch,
        forcedSearch,
        searchStrategy
      )

      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.handleLLMAgentEnd(msg)
        }
      }
    } catch (error) {
      console.error(
        '[ThreadPresenter] Failed to resume after permission with pending tool call:',
        error
      )

      this.generatingMessages.delete(message.id)

      try {
        await this.messageManager.handleMessageError(message.id, String(error))
      } catch (updateError) {
        console.error(`[ThreadPresenter] Failed to update message error status:`, updateError)
      }

      throw error
    }
  }

  // 等待MCP服务重启完成并准备就绪
  private async waitForMcpServiceReady(
    serverName: string,
    maxWaitTime: number = 3000
  ): Promise<void> {
    console.log(`[ThreadPresenter] Waiting for MCP service ${serverName} to be ready...`)

    const startTime = Date.now()
    const checkInterval = 100 // 100ms

    return new Promise((resolve) => {
      const checkReady = async () => {
        try {
          // 检查服务是否正在运行
          const isRunning = await presenter.mcpPresenter.isServerRunning(serverName)

          if (isRunning) {
            // 服务正在运行，再等待一下确保完全初始化
            setTimeout(() => {
              console.log(`[ThreadPresenter] MCP service ${serverName} is ready`)
              resolve()
            }, 200)
            return
          }

          // 检查是否超时
          if (Date.now() - startTime > maxWaitTime) {
            console.warn(
              `[ThreadPresenter] Timeout waiting for MCP service ${serverName} to be ready`
            )
            resolve() // 超时也继续，避免阻塞
            return
          }

          // 继续等待
          setTimeout(checkReady, checkInterval)
        } catch (error) {
          console.error(`[ThreadPresenter] Error checking MCP service status:`, error)
          resolve() // 出错也继续，避免阻塞
        }
      }

      checkReady()
    })
  }

  // 查找权限授予后待执行的工具调用
  private findPendingToolCallAfterPermission(
    content: AssistantMessageBlock[]
  ): { id: string; name: string; params: string } | null {
    // 查找已授权的权限块
    const grantedPermissionBlock = content.find(
      (block) =>
        block.type === 'action' &&
        block.action_type === 'tool_call_permission' &&
        block.status === 'granted'
    )

    if (!grantedPermissionBlock?.tool_call) {
      return null
    }

    const { id, name, params } = grantedPermissionBlock.tool_call
    if (!id || !name || !params) {
      console.warn(
        `[ThreadPresenter] Incomplete tool call info in permission block:`,
        grantedPermissionBlock.tool_call
      )
      return null
    }

    return { id, name, params }
  }

  /**
   * Get request preview for debugging (DEV mode only)
   * Reconstructs the request parameters that would be sent to the provider
   */
  async getMessageRequestPreview(messageId: string): Promise<unknown> {
    try {
      // Get message and conversation
      const message = await this.sqlitePresenter.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        throw new Error('Message not found or not an assistant message')
      }

      const conversation = await this.sqlitePresenter.getConversation(message.conversation_id)
      const {
        providerId: defaultProviderId,
        modelId: defaultModelId,
        temperature,
        maxTokens,
        enabledMcpTools
      } = conversation.settings

      // Parse metadata to get model_provider and model_id
      let messageMetadata: MESSAGE_METADATA | null = null
      try {
        messageMetadata = JSON.parse(message.metadata) as MESSAGE_METADATA
      } catch (e) {
        console.warn('Failed to parse message metadata:', e)
      }

      const effectiveProviderId = messageMetadata?.provider || defaultProviderId
      const effectiveModelId = messageMetadata?.model || defaultModelId

      // Get user message (parent of assistant message)
      const userMessageSqlite = await this.sqlitePresenter.getMessage(message.parent_id || '')
      if (!userMessageSqlite) {
        throw new Error('User message not found')
      }

      // Convert SQLITE_MESSAGE to Message type
      const userMessage = this.messageManager['convertToMessage'](userMessageSqlite)

      // Get context messages using getMessageHistory
      const contextMessages = await this.getMessageHistory(
        userMessage.id,
        conversation.settings.contextLength
      )

      // Prepare prompt content (reconstruct what was sent)
      let modelConfig = this.configPresenter.getModelConfig(effectiveModelId, effectiveProviderId)
      if (!modelConfig) {
        modelConfig = this.configPresenter.getModelConfig(defaultModelId, defaultProviderId)
      }

      if (!modelConfig) {
        throw new Error(
          `Model config not found for provider ${effectiveProviderId} and model ${effectiveModelId}`
        )
      }

      const supportsFunctionCall = modelConfig?.functionCall ?? false
      const visionEnabled = modelConfig?.vision ?? false

      // Extract user content from userMessage
      let userContent = ''
      if (typeof userMessage.content === 'string') {
        userContent = userMessage.content
      } else if (
        userMessage.content &&
        typeof userMessage.content === 'object' &&
        'text' in userMessage.content
      ) {
        userContent = userMessage.content.text || ''
      }

      const { finalContent } = await preparePromptContent({
        conversation,
        userContent,
        contextMessages,
        searchResults: null,
        urlResults: [],
        userMessage,
        vision: visionEnabled,
        imageFiles: [],
        supportsFunctionCall,
        modelType: ModelType.Chat
      })

      // Get MCP tools
      let mcpTools: MCPToolDefinition[] = []
      try {
        const toolDefinitions = await presenter.mcpPresenter.getAllToolDefinitions(enabledMcpTools)
        if (Array.isArray(toolDefinitions)) {
          mcpTools = toolDefinitions
        }
      } catch (error) {
        console.warn('Failed to load MCP tool definitions for preview', error)
      }

      // Get provider and request preview
      const provider = this.llmProviderPresenter.getProviderInstance(effectiveProviderId)
      if (!provider) {
        throw new Error(`Provider ${effectiveProviderId} not found`)
      }

      // Type assertion for provider instance
      const providerInstance = provider as {
        getRequestPreview: (
          messages: ChatMessage[],
          modelId: string,
          modelConfig: unknown,
          temperature: number,
          maxTokens: number,
          mcpTools: MCPToolDefinition[]
        ) => Promise<{
          endpoint: string
          headers: Record<string, string>
          body: unknown
        }>
      }

      try {
        const preview = await providerInstance.getRequestPreview(
          finalContent,
          effectiveModelId,
          modelConfig,
          temperature,
          maxTokens,
          mcpTools
        )

        // Redact sensitive information
        const { redactRequestPreview } = await import('@/lib/redact')
        const redacted = redactRequestPreview({
          headers: preview.headers,
          body: preview.body
        })

        return {
          providerId: effectiveProviderId,
          modelId: effectiveModelId,
          endpoint: preview.endpoint,
          headers: redacted.headers,
          body: redacted.body,
          mayNotMatch: true // Always mark as potentially inconsistent since we're reconstructing
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('not implemented')) {
          return {
            notImplemented: true,
            providerId: effectiveProviderId,
            modelId: effectiveModelId
          }
        }
        throw error
      }
    } catch (error) {
      console.error('[ThreadPresenter] getMessageRequestPreview failed:', error)
      throw error
    }
  }
}
