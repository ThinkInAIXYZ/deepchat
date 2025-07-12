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
  ChatMessage,
  ChatMessageContent,
  LLMAgentEventData
} from '../../../shared/presenter'
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
  UserMessageContent,
  UserMessageTextBlock,
  UserMessageMentionBlock,
  UserMessageCodeBlock
} from '@shared/chat'
import { approximateTokenSize } from 'tokenx'
import { generateSearchPrompt, SearchManager } from './searchManager'
import { getFileContext } from './fileContext'
import { ContentEnricher } from './contentEnricher'
import { CONVERSATION_EVENTS, STREAM_EVENTS, TAB_EVENTS } from '@/events'
import { DEFAULT_SETTINGS } from './const'

interface GeneratingMessageState {
  message: AssistantMessage
  conversationId: string
  startTime: number
  firstTokenTime: number | null
  promptTokens: number
  reasoningStartTime: number | null
  reasoningEndTime: number | null
  lastReasoningTime: number | null
  isSearching?: boolean
  isCancelled?: boolean
  totalUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    context_length: number
  }
}

export class ThreadPresenter implements IThreadPresenter {
  private sqlitePresenter: ISQLitePresenter
  private messageManager: MessageManager
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private searchManager: SearchManager
  private generatingMessages: Map<string, GeneratingMessageState> = new Map()
  public searchAssistantModel: MODEL_META | null = null
  public searchAssistantProviderId: string | null = null
  private searchingMessages: Set<string> = new Set()
  private activeConversationIds: Map<number, string> = new Map()
  private fetchThreadLength: number = 300

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

    // 监听Tab关闭事件，清理绑定关系
    eventBus.on(TAB_EVENTS.CLOSED, (tabId: number) => {
      if (this.activeConversationIds.has(tabId)) {
        this.activeConversationIds.delete(tabId)
        console.log(`ThreadPresenter: Cleaned up conversation binding for closed tab ${tabId}.`)
      }
    })
    eventBus.on(TAB_EVENTS.RENDERER_TAB_READY, () => {
      this.broadcastThreadListUpdate()
    })

    // 初始化时处理所有未完成的消息
    this.messageManager.initializeUnfinishedMessages()
  }

  /**
   * 新增：查找指定会话ID所在的Tab ID
   * @param conversationId 会话ID
   * @returns 如果找到，返回tabId，否则返回null
   */
  async findTabForConversation(conversationId: string): Promise<number | null> {
    for (const [tabId, activeId] of this.activeConversationIds.entries()) {
      if (activeId === conversationId) {
        // 验证该tab是否还真实存在
        const tabView = await presenter.tabPresenter.getTab(tabId)
        if (tabView && !tabView.webContents.isDestroyed()) {
          return tabId
        }
      }
    }
    return null
  }

  async handleLLMAgentError(msg: LLMAgentEventData) {
    const { eventId, error } = msg
    const state = this.generatingMessages.get(eventId)
    if (state) {
      await this.messageManager.handleMessageError(eventId, String(error))
      this.generatingMessages.delete(eventId)
    }
    eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, msg)
  }

  async handleLLMAgentEnd(msg: LLMAgentEventData) {
    const { eventId, userStop } = msg
    const state = this.generatingMessages.get(eventId)
    if (state) {
      console.log(`[ThreadPresenter] Handling LLM agent end for message: ${eventId}, userStop: ${userStop}`)
      
      // Check if there are any pending permission requests in THIS specific message
      const hasPendingPermissions = state.message.content.some(
        (block) => block.type === 'tool_call_permission' && block.status === 'pending'
      )
      
      console.log(`[ThreadPresenter] Message ${eventId} has pending permissions: ${hasPendingPermissions}`)
      
      // If there are pending permissions, don't finalize the message yet
      if (hasPendingPermissions) {
        console.log(`[ThreadPresenter] Keeping message ${eventId} in generating state due to pending permissions`)
        
        // Update only non-permission blocks to success
        // Keep tool_call blocks loading if they have associated permission requests
        state.message.content.forEach((block) => {
          if (block.type === 'tool_call_permission' && block.status === 'pending') {
            // Keep permission blocks pending
            console.log(`[ThreadPresenter] Keeping permission block pending for tool: ${block.tool_call?.name}`)
            return
          }
          if (block.type === 'tool_call') {
            // Check if this tool call has an associated permission request
            const hasAssociatedPermission = state.message.content.some(
              (permBlock) =>
                permBlock.type === 'tool_call_permission' &&
                permBlock.status === 'pending' &&
                permBlock.tool_call?.id === block.tool_call?.id
            )
            if (hasAssociatedPermission) {
              // Keep this tool call loading
              console.log(`[ThreadPresenter] Keeping tool call loading for: ${block.tool_call?.name}`)
              return
            }
          }
          // Set other blocks to success
          block.status = 'success'
        })
        // Don't delete from generatingMessages yet - keep it for permission handling
        await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
        return
      }
      
      console.log(`[ThreadPresenter] Finalizing message ${eventId} - no pending permissions`)
      
      // Normal completion flow when no pending permissions
      state.message.content.forEach((block) => {
        block.status = 'success'
      })
      // 计算completion tokens
      let completionTokens = 0
      if (state.totalUsage) {
        completionTokens = state.totalUsage.completion_tokens
      } else {
        for (const block of state.message.content) {
          if (
            block.type === 'content' ||
            block.type === 'reasoning_content' ||
            block.type === 'tool_call'
          ) {
            completionTokens += approximateTokenSize(block.content)
          }
        }
      }

      // 检查是否有内容块
      const hasContentBlock = state.message.content.some(
        (block) =>
          block.type === 'content' ||
          block.type === 'reasoning_content' ||
          block.type === 'tool_call' ||
          block.type === 'image'
      )

      // 如果没有内容块，添加错误信息
      if (!hasContentBlock && !userStop) {
        state.message.content.push({
          type: 'error',
          content: 'common.error.noModelResponse',
          status: 'error',
          timestamp: Date.now()
        })
      }

      const totalTokens = state.promptTokens + completionTokens
      const generationTime = Date.now() - (state.firstTokenTime ?? state.startTime)
      const tokensPerSecond = completionTokens / (generationTime / 1000)
      const contextUsage = state?.totalUsage?.context_length
        ? (totalTokens / state.totalUsage.context_length) * 100
        : 0

      // 如果有reasoning_content，记录结束时间
      const metadata: Partial<MESSAGE_METADATA> = {
        totalTokens,
        inputTokens: state.promptTokens,
        outputTokens: completionTokens,
        generationTime,
        firstTokenTime: state.firstTokenTime ? state.firstTokenTime - state.startTime : 0,
        tokensPerSecond,
        contextUsage
      }

      if (state.reasoningStartTime !== null && state.lastReasoningTime !== null) {
        metadata.reasoningStartTime = state.reasoningStartTime - state.startTime
        metadata.reasoningEndTime = state.lastReasoningTime - state.startTime
      }

      // 更新消息的usage信息
      await this.messageManager.updateMessageMetadata(eventId, metadata)
      await this.messageManager.updateMessageStatus(eventId, 'sent')
      await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
      this.generatingMessages.delete(eventId)

      // 检查是否需要总结标题
      const conversation = await this.sqlitePresenter.getConversation(state.conversationId)
      let titleUpdated = false
      if (conversation.is_new === 1) {
        try {
          // 注意：第二个参数直接传入 conversationId
          this.summaryTitles(undefined, state.conversationId).then((title) => {
            if (title) {
              // renameConversation 会更新标题和updatedAt，并广播
              this.renameConversation(state.conversationId, title).then(() => {
                titleUpdated = true
              })
            }
          })
        } catch (e) {
          console.error('Failed to summarize title in main process:', e)
        }
      }

      // 如果标题没有被更新（即不是新会话，或生成标题失败），
      // 我们仍然需要更新updatedAt并广播
      if (!titleUpdated) {
        this.sqlitePresenter
          .updateConversation(state.conversationId, {
            updatedAt: Date.now()
          })
          .then(() => {
            console.log('updated conv time', state.conversationId)
          })
        // 手动触发一次广播，因为这次更新没有经过其他会触发广播的方法
        await this.broadcastThreadListUpdate()
      }

      // --- 新增逻辑：广播消息生成完成事件 ---
      // 在所有数据库和状态更新完成后，获取最终的消息对象
      const finalMessage = await this.messageManager.getMessage(eventId)
      if (finalMessage) {
        // 该事件仅在主进程内部流通，用于通知其他监听者（如MCP会议主持人）
        eventBus.sendToMain(CONVERSATION_EVENTS.MESSAGE_GENERATED, {
          conversationId: finalMessage.conversationId,
          message: finalMessage
        })
      }
    }

    eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, msg)
  }

  async handleLLMAgentResponse(msg: LLMAgentEventData) {
    const currentTime = Date.now()
    const {
      eventId,
      content,
      reasoning_content,
      tool_call_id,
      tool_call_name,
      tool_call_params,
      tool_call_response,
      maximum_tool_calls_reached,
      tool_call_server_name,
      tool_call_server_icons,
      tool_call_server_description,
      tool_call_response_raw,
      tool_call,
      totalUsage,
      image_data
    } = msg
    const state = this.generatingMessages.get(eventId)
    if (state) {
      // 使用保护逻辑
      const finalizeLastBlock = () => {
        const lastBlock =
          state.message.content.length > 0
            ? state.message.content[state.message.content.length - 1]
            : undefined
        if (lastBlock) {
          // 只有当上一个块不是一个正在等待结果的工具调用时，才将其标记为成功
          if (!(lastBlock.type === 'tool_call' && lastBlock.status === 'loading')) {
            lastBlock.status = 'success'
          }
        }
      }

      // 记录第一个token的时间
      if (state.firstTokenTime === null && (content || reasoning_content)) {
        state.firstTokenTime = currentTime
        await this.messageManager.updateMessageMetadata(eventId, {
          firstTokenTime: currentTime - state.startTime
        })
      }
      if (totalUsage) {
        state.totalUsage = totalUsage
        state.promptTokens = totalUsage.prompt_tokens
      }

      // 处理工具调用达到最大次数的情况
      if (maximum_tool_calls_reached) {
        finalizeLastBlock() // 使用保护逻辑
        state.message.content.push({
          type: 'action',
          content: 'common.error.maximumToolCallsReached',
          status: 'success',
          timestamp: currentTime,
          action_type: 'maximum_tool_calls_reached',
          tool_call: {
            id: tool_call_id,
            name: tool_call_name,
            params: tool_call_params,
            server_name: tool_call_server_name,
            server_icons: tool_call_server_icons,
            server_description: tool_call_server_description
          },
          extra: {
            needContinue: true
          }
        })
        await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
        return
      }

      // 处理reasoning_content的时间戳
      if (reasoning_content) {
        if (state.reasoningStartTime === null) {
          state.reasoningStartTime = currentTime
          await this.messageManager.updateMessageMetadata(eventId, {
            reasoningStartTime: currentTime - state.startTime
          })
        }
        state.lastReasoningTime = currentTime
      }

      const lastBlock = state.message.content[state.message.content.length - 1]

      // 检查tool_call_response_raw中是否包含搜索结果
      if (tool_call_response_raw && tool_call === 'end') {
        try {
          // 检查返回的内容中是否有deepchat-webpage类型的资源
          // 确保content是数组才调用some方法
          const hasSearchResults = Array.isArray(tool_call_response_raw.content) && 
            tool_call_response_raw.content.some(
              (item: { type: string; resource?: { mimeType: string } }) =>
                item?.type === 'resource' &&
                item?.resource?.mimeType === 'application/deepchat-webpage'
            )

          if (hasSearchResults && Array.isArray(tool_call_response_raw.content)) {
            // 解析搜索结果
            const searchResults = tool_call_response_raw.content
              .filter(
                (item: {
                  type: string
                  resource?: { mimeType: string; text: string; uri?: string }
                }) =>
                  item.type === 'resource' &&
                  item.resource?.mimeType === 'application/deepchat-webpage'
              )
              .map((item: { resource: { text: string; uri?: string } }) => {
                try {
                  const blobContent = JSON.parse(item.resource.text) as {
                    title?: string
                    url?: string
                    content?: string
                    icon?: string
                  }
                  return {
                    title: blobContent.title || '',
                    url: blobContent.url || item.resource.uri || '',
                    content: blobContent.content || '',
                    description: blobContent.content || '',
                    icon: blobContent.icon || ''
                  }
                } catch (e) {
                  console.error('解析搜索结果失败:', e)
                  return null
                }
              })
              .filter(Boolean)

            if (searchResults.length > 0) {
              // 检查是否已经存在搜索块
              const existingSearchBlock =
                state.message.content.length > 0 && state.message.content[0].type === 'search'
                  ? state.message.content[0]
                  : null

              if (existingSearchBlock) {
                // 如果已经存在搜索块，更新其状态和总数
                existingSearchBlock.status = 'success'
                existingSearchBlock.timestamp = currentTime
                if (existingSearchBlock.extra) {
                  // 累加搜索结果数量
                  existingSearchBlock.extra.total =
                    (existingSearchBlock.extra.total || 0) + searchResults.length
                } else {
                  existingSearchBlock.extra = {
                    total: searchResults.length
                  }
                }
              } else {
                // 如果不存在搜索块，创建新的并添加到内容的最前面
                const searchBlock: AssistantMessageBlock = {
                  type: 'search',
                  content: '',
                  status: 'success',
                  timestamp: currentTime,
                  extra: {
                    total: searchResults.length
                  }
                }
                state.message.content.unshift(searchBlock)
              }

              // 保存搜索结果
              for (const result of searchResults) {
                await this.sqlitePresenter.addMessageAttachment(
                  eventId,
                  'search_result',
                  JSON.stringify(result)
                )
              }

              await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
            }
          }
        } catch (error) {
          console.error('处理搜索结果时出错:', error)
        }
      }

      // 处理工具调用
      if (tool_call) {
        if (tool_call === 'start') {
          // 创建新的工具调用块
          finalizeLastBlock() // 使用保护逻辑
          state.message.content.push({
            type: 'tool_call',
            content: '',
            status: 'loading',
            timestamp: currentTime,
            tool_call: {
              id: tool_call_id,
              name: tool_call_name,
              params: tool_call_params || '',
              server_name: tool_call_server_name,
              server_icons: tool_call_server_icons,
              server_description: tool_call_server_description
            }
          })
        } else if (tool_call === 'update') {
          // 更新工具调用参数
          const toolCallBlock = state.message.content.find(
            (block) =>
              block.type === 'tool_call' &&
              block.tool_call?.id === tool_call_id &&
              block.status === 'loading'
          )

          if (toolCallBlock && toolCallBlock.type === 'tool_call' && toolCallBlock.tool_call) {
            toolCallBlock.tool_call.params = tool_call_params || ''
          }
        } else if (tool_call === 'running') {
          // 工具调用正在执行
          const toolCallBlock = state.message.content.find(
            (block) =>
              block.type === 'tool_call' &&
              block.tool_call?.id === tool_call_id &&
              block.status === 'loading'
          )

          if (toolCallBlock && toolCallBlock.type === 'tool_call') {
            // 保持 loading 状态，但更新工具信息
            if (toolCallBlock.tool_call) {
              toolCallBlock.tool_call.params = tool_call_params || ''
              toolCallBlock.tool_call.server_name = tool_call_server_name
              toolCallBlock.tool_call.server_icons = tool_call_server_icons
              toolCallBlock.tool_call.server_description = tool_call_server_description
            }
          }
        } else if (tool_call === 'permission-required') {
          // 处理权限请求：创建权限请求块
          // 注意：不调用finalizeLastBlock，因为工具调用还没有完成，在等待权限
          
          // 从 msg 中获取权限请求信息
          const { permission_request } = msg
          
          state.message.content.push({
            type: 'tool_call_permission',
            content: typeof tool_call_response === 'string' ? tool_call_response : 'Permission required for this operation',
            status: 'pending',
            timestamp: currentTime,
            tool_call: {
              id: tool_call_id,
              name: tool_call_name,
              params: tool_call_params || '',
              server_name: tool_call_server_name,
              server_icons: tool_call_server_icons,
              server_description: tool_call_server_description
            },
            extra: {
              permissionType: permission_request?.permissionType || 'write',
              serverName: permission_request?.serverName || tool_call_server_name || '',
              toolName: permission_request?.toolName || tool_call_name || '',
              needsUserAction: true
            }
          })
        } else if (tool_call === 'end' || tool_call === 'error') {
          // 查找对应的工具调用块
          const toolCallBlock = state.message.content.find(
            (block) =>
              block.type === 'tool_call' &&
              ((tool_call_id && block.tool_call?.id === tool_call_id) ||
                block.tool_call?.name === tool_call_name) &&
              block.status === 'loading'
          )

          if (toolCallBlock && toolCallBlock.type === 'tool_call') {
            if (tool_call === 'error') {
              toolCallBlock.status = 'error'
              if (toolCallBlock.tool_call) {
                if (typeof tool_call_response === 'string') {
                  toolCallBlock.tool_call.response = tool_call_response || '执行失败'
                } else {
                  toolCallBlock.tool_call.response = JSON.stringify(tool_call_response)
                }
              }
            } else {
              toolCallBlock.status = 'success'
              if (toolCallBlock.tool_call) {
                if (typeof tool_call_response === 'string') {
                  toolCallBlock.tool_call.response = tool_call_response
                } else {
                  toolCallBlock.tool_call.response = JSON.stringify(tool_call_response)
                }
              }
            }
          }
        }
      } else if (image_data) {
        // 处理图像数据
        finalizeLastBlock() // 使用保护逻辑
        state.message.content.push({
          type: 'image',
          content: 'image',
          status: 'success',
          timestamp: currentTime,
          image_data: image_data
        })
      } else if (content) {
        // 处理普通内容
        if (lastBlock && lastBlock.type === 'content') {
          lastBlock.content += content
        } else {
          finalizeLastBlock() // 使用保护逻辑
          state.message.content.push({
            type: 'content',
            content: content,
            status: 'loading',
            timestamp: currentTime
          })
        }
      }

      // 处理推理内容
      if (reasoning_content) {
        if (lastBlock && lastBlock.type === 'reasoning_content') {
          lastBlock.content += reasoning_content
          if (lastBlock.reasoning_time) {
            lastBlock.reasoning_time.end = currentTime
          }
        } else {
          finalizeLastBlock() // 使用保护逻辑
          state.message.content.push({
            type: 'reasoning_content',
            content: reasoning_content,
            status: 'loading',
            reasoning_time: {
              start: currentTime,
              end: currentTime
            },
            timestamp: currentTime
          })
        }
      }

      // 更新消息内容
      await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
    }
    eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, msg)
  }

  setSearchAssistantModel(model: MODEL_META, providerId: string) {
    this.searchAssistantModel = model
    this.searchAssistantProviderId = providerId
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

  async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    await this.sqlitePresenter.renameConversation(conversationId, title)
    await this.broadcastThreadListUpdate() // 必须广播

    const conversation = await this.getConversation(conversationId)

    // 新增：找到与此 conversationId 关联的 tabId
    let tabId: number | undefined
    for (const [key, value] of this.activeConversationIds.entries()) {
      if (value === conversationId) {
        tabId = key
        break
      }
    }

    // 新增：发出事件通知UI更新标题
    if (tabId !== undefined) {
      const windowId = presenter.tabPresenter['tabWindowMap'].get(tabId)
      eventBus.sendToRenderer(TAB_EVENTS.TITLE_UPDATED, SendTarget.ALL_WINDOWS, {
        tabId,
        conversationId,
        title: conversation.title,
        windowId // 附带 windowId
      })
    }

    return conversation
  }

  async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {},
    tabId: number,
    options: { forceNewAndActivate?: boolean } = {} // 新增参数，允许强制创建新会话
  ): Promise<string> {
    console.log('createConversation', title, settings)

    const latestConversation = await this.getLatestConversation()

    // 只有在非强制模式下，才执行空会话的单例检查
    if (!options.forceNewAndActivate) {
      if (latestConversation) {
        const { list: messages } = await this.getMessages(latestConversation.id, 1, 1)
        if (messages.length === 0) {
          await this.setActiveConversation(latestConversation.id, tabId)
          return latestConversation.id
        }
      }
    }

    let defaultSettings = DEFAULT_SETTINGS
    if (latestConversation?.settings) {
      defaultSettings = { ...latestConversation.settings }
      defaultSettings.systemPrompt = ''
    }
    Object.keys(settings).forEach((key) => {
      if (settings[key] === undefined || settings[key] === null || settings[key] === '') {
        delete settings[key]
      }
    })
    const mergedSettings = { ...defaultSettings, ...settings }
    const defaultModelsSettings = this.configPresenter.getModelConfig(mergedSettings.modelId)
    if (defaultModelsSettings) {
      mergedSettings.maxTokens = defaultModelsSettings.maxTokens
      mergedSettings.contextLength = defaultModelsSettings.contextLength
      mergedSettings.temperature = defaultModelsSettings.temperature
    }
    if (settings.artifacts) {
      mergedSettings.artifacts = settings.artifacts
    }
    if (settings.maxTokens) {
      mergedSettings.maxTokens = settings.maxTokens
    }
    if (settings.temperature) {
      mergedSettings.temperature = settings.temperature
    }
    if (settings.contextLength) {
      mergedSettings.contextLength = settings.contextLength
    }
    if (settings.systemPrompt) {
      mergedSettings.systemPrompt = settings.systemPrompt
    }
    const conversationId = await this.sqlitePresenter.createConversation(title, mergedSettings)

    // 根据 forceNewAndActivate 标志决定激活行为
    if (options.forceNewAndActivate) {
      // 强制模式：直接为当前 tabId 激活新会话，不进行任何检查
      this.activeConversationIds.set(tabId, conversationId)
      eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
        conversationId,
        tabId
      })
    } else {
      // 默认模式：保持原有的、防止重复打开的激活逻辑
      await this.setActiveConversation(conversationId, tabId)
    }

    await this.broadcastThreadListUpdate() // 必须广播
    return conversationId
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.sqlitePresenter.deleteConversation(conversationId)

    // 作为兜底，确保所有与此会话相关的绑定都被移除
    for (const [tabId, activeId] of this.activeConversationIds.entries()) {
      if (activeId === conversationId) {
        this.activeConversationIds.delete(tabId)
      }
    }

    await this.broadcastThreadListUpdate() // 必须广播
  }

  async getConversation(conversationId: string): Promise<CONVERSATION> {
    return await this.sqlitePresenter.getConversation(conversationId)
  }

  async toggleConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, { is_pinned: pinned ? 1 : 0 })
    await this.broadcastThreadListUpdate() // 必须广播
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, { title })
    await this.broadcastThreadListUpdate() // 必须广播
  }

  async updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId)
    const mergedSettings = { ...conversation.settings }
    for (const key in settings) {
      if (settings[key] !== undefined) {
        mergedSettings[key] = settings[key]
      }
    }
    console.log('updateConversationSettings', mergedSettings)
    // 检查是否有 modelId 的变化
    if (settings.modelId && settings.modelId !== conversation.settings.modelId) {
      // 获取模型配置
      const modelConfig = this.configPresenter.getModelConfig(
        mergedSettings.modelId,
        mergedSettings.providerId
      )
      console.log('check model default config', modelConfig)
      if (modelConfig) {
        // 如果当前设置小于推荐值，则使用推荐值
        mergedSettings.maxTokens = modelConfig.maxTokens
        mergedSettings.contextLength = modelConfig.contextLength
      }
    }

    await this.sqlitePresenter.updateConversation(conversationId, { settings: mergedSettings })
    await this.broadcastThreadListUpdate() // 必须广播
  }

  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return await this.sqlitePresenter.getConversationList(page, pageSize)
  }

  async loadMoreThreads(): Promise<{ hasMore: boolean; total: number }> {
    // 获取会话总数
    const total = await this.sqlitePresenter.getConversationCount()

    // 检查是否还有更多会话可以加载
    const hasMore = this.fetchThreadLength < total

    if (hasMore) {
      // 增加 fetchThreadLength，每次增加 500
      this.fetchThreadLength = Math.min(this.fetchThreadLength + 300, total)

      // 广播更新的会话列表
      await this.broadcastThreadListUpdate()
    }

    return { hasMore: this.fetchThreadLength < total, total }
  }

  async setActiveConversation(conversationId: string, tabId: number): Promise<void> {
    // 【核心修正】由主进程负责全部决策（防重和自动切换逻辑）
    const existingTabId = await this.findTabForConversation(conversationId)

    // 如果会话已在其他Tab打开，并且不是当前Tab，则切换到那个Tab
    if (existingTabId !== null && existingTabId !== tabId) {
      console.log(
        `Conversation ${conversationId} is already open in tab ${existingTabId}. Switching to it.`
      )
      // 命令TabPresenter切换到已存在的Tab
      await presenter.tabPresenter.switchTab(existingTabId)
      // 注意：这里不应该再为 requesting tab (即 tabId) 设置 activeConversationId
      // 也不需要发送ACTIVATED事件，因为tab-session的绑定关系没有改变。
      // switchTab 自身会处理UI的激活。
      return
    }

    // 如果会话未在其他Tab打开，或者是请求激活当前Tab已绑定的会话，则正常执行绑定
    const conversation = await this.getConversation(conversationId)
    if (conversation) {
      // 检查当前Tab是否已经绑定了这个会话，避免不必要的事件广播
      if (this.activeConversationIds.get(tabId) === conversationId) {
        return // 状态未改变，无需操作
      }

      this.activeConversationIds.set(tabId, conversationId)
      // 广播事件，通知所有渲染进程UI更新
      eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
        conversationId,
        tabId
      })
    } else {
      throw new Error(`Conversation ${conversationId} not found`)
    }
  }

  async getActiveConversation(tabId: number): Promise<CONVERSATION | null> {
    const conversationId = this.activeConversationIds.get(tabId)
    if (!conversationId) {
      return null
    }
    return this.getConversation(conversationId)
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
    // 计算需要获取的消息数量（假设每条消息平均300字）
    let messageCount = Math.ceil(conversation.settings.contextLength / 300)
    if (messageCount < 2) {
      messageCount = 2
    }
    const messages = await this.messageManager.getContextMessages(conversationId, messageCount)

    // 确保消息列表以用户消息开始
    while (messages.length > 0 && messages[0].role !== 'user') {
      messages.shift()
    }

    return messages.map((msg) => {
      if (msg.role === 'user') {
        const newMsg = { ...msg }
        const msgContent = newMsg.content as UserMessageContent
        if (msgContent.content) {
          ;(newMsg.content as UserMessageContent).text = this.formatUserMessageContent(
            msgContent.content
          )
        }
        return newMsg
      } else {
        return msg
      }
    })
  }

  private formatUserMessageContent(
    msgContentBlock: (UserMessageTextBlock | UserMessageMentionBlock | UserMessageCodeBlock)[]
  ) {
    return msgContentBlock
      .map((block) => {
        if (block.type === 'mention') {
          if (block.category === 'resources') {
            return `@${block.content}`
          } else if (block.category === 'tools') {
            return `@${block.id}`
          } else if (block.category === 'files') {
            return `@${block.id}`
          } else if (block.category === 'prompts') {
            try {
              // 尝试解析prompt内容
              const promptData = JSON.parse(block.content)
              // 如果包含messages数组，尝试提取其中的文本内容
              if (promptData && Array.isArray(promptData.messages)) {
                const messageTexts = promptData.messages
                  .map((msg) => {
                    if (typeof msg.content === 'string') {
                      return msg.content
                    } else if (msg.content && msg.content.type === 'text') {
                      return msg.content.text
                    } else {
                      // 对于其他类型的内容（如图片等），返回空字符串或特定标记
                      return `[${msg.content?.type || 'content'}]`
                    }
                  })
                  .filter(Boolean)
                  .join('\n')
                return `@${block.id} <prompts>${messageTexts || block.content}</prompts>`
              }
            } catch (e) {
              // 如果解析失败，直接返回原始内容
              console.log('解析prompt内容失败:', e)
            }
            // 默认返回原内容
            return `@${block.id} <prompts>${block.content}</prompts>`
          }
          return `@${block.id}`
        } else if (block.type === 'text') {
          return block.content
        } else if (block.type === 'code') {
          return `\`\`\`${block.content}\`\`\``
        }
        return ''
      })
      .join('')
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
    const message = await this.messageManager.getMessage(messageId)
    if (!message) {
      throw new Error('找不到指定的消息')
    }

    const { list: messages } = await this.messageManager.getMessageThread(
      message.conversationId,
      1,
      limit * 2
    )

    // 找到目标消息在列表中的位置
    const targetIndex = messages.findIndex((msg) => msg.id === messageId)
    if (targetIndex === -1) {
      return [message]
    }

    // 返回目标消息之前的消息（包括目标消息）
    return messages.slice(Math.max(0, targetIndex - limit + 1), targetIndex + 1)
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

    // 检查是否已被取消
    this.throwIfCancelled(messageId)

    // 添加搜索加载状态
    const searchBlock: AssistantMessageBlock = {
      type: 'search',
      content: '',
      status: 'loading',
      timestamp: Date.now(),
      extra: {
        total: 0
      }
    }
    state.message.content.unshift(searchBlock)
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
            return `user: ${content.text}${getFileContext(content.files)}`
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
        this.searchManager.getActiveEngine().name
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
      searchBlock.extra = {
        total: results.length
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
            icon: result.icon || ''
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
  async getSearchResults(messageId: string): Promise<SearchResult[]> {
    const results = await this.sqlitePresenter.getMessageAttachments(messageId, 'search_result')
    return results.map((result) => JSON.parse(result.content) as SearchResult) ?? []
  }

  async startStreamCompletion(conversationId: string, queryMsgId?: string) {
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
        queryMsgId
      )

      const { providerId, modelId } = conversation.settings
      const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)
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
      const { finalContent, promptTokens } = await this.preparePromptContent(
        conversation,
        userContent,
        contextMessages,
        searchResults,
        urlResults,
        userMessage,
        vision,
        vision ? imageFiles : [],
        modelConfig.functionCall
      )

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
        maxTokens: currentMaxTokens
      } = currentConversation.settings

      const stream = this.llmProviderPresenter.startStreamCompletion(
        currentProviderId, // 使用最新的设置
        finalContent,
        currentModelId, // 使用最新的设置
        state.message.id,
        currentTemperature, // 使用最新的设置
        currentMaxTokens // 使用最新的设置
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
  async continueStreamCompletion(conversationId: string, queryMsgId: string) {
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
        state.message.id
      )

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 7. 准备提示内容
      const { providerId, modelId, temperature, maxTokens } = conversation.settings
      const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)

      const { finalContent, promptTokens } = await this.preparePromptContent(
        conversation,
        'continue',
        contextMessages,
        null, // 不进行搜索
        [], // 没有 URL 结果
        userMessage,
        false,
        [], // 没有图片文件
        modelConfig.functionCall
      )

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
        maxTokens
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
    queryMsgId?: string
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
      if (!queryMessage || !queryMessage.parentId) {
        throw new Error('找不到指定的消息')
      }
      userMessage = await this.getMessage(queryMessage.parentId)
      if (!userMessage) {
        throw new Error('找不到触发消息')
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

    // 处理 UserMessageMentionBlock
    if (userMessage.role === 'user') {
      const msgContent = userMessage.content as UserMessageContent
      if (msgContent.content && !msgContent.text) {
        msgContent.text = this.formatUserMessageContent(msgContent.content)
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
    const userContent = `
      ${
        userMessage.content.content
          ? this.formatUserMessageContent(userMessage.content.content)
          : userMessage.content.text
      }
      ${getFileContext(userMessage.content.files)}
    `

    // 从用户消息中提取并丰富URL内容
    const urlResults = await ContentEnricher.extractAndEnrichUrls(userMessage.content.text)

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

  // 准备提示内容
  private async preparePromptContent(
    conversation: CONVERSATION,
    userContent: string,
    contextMessages: Message[],
    searchResults: SearchResult[] | null,
    urlResults: SearchResult[],
    userMessage: Message,
    vision: boolean,
    imageFiles: MessageFile[],
    supportsFunctionCall: boolean
  ): Promise<{
    finalContent: ChatMessage[]
    promptTokens: number
  }> {
    const { systemPrompt, contextLength, artifacts } = conversation.settings

    const searchPrompt = searchResults ? generateSearchPrompt(userContent, searchResults) : ''
    const enrichedUserMessage =
      urlResults.length > 0
        ? '\n\n' + ContentEnricher.enrichUserMessageWithUrlContent(userContent, urlResults)
        : ''

    // 计算token数量
    const searchPromptTokens = searchPrompt ? approximateTokenSize(searchPrompt ?? '') : 0
    const systemPromptTokens = systemPrompt ? approximateTokenSize(systemPrompt ?? '') : 0
    const userMessageTokens = approximateTokenSize(userContent + enrichedUserMessage)
    const mcpTools = await presenter.mcpPresenter.getAllToolDefinitions()
    const mcpToolsTokens = mcpTools.reduce(
      (acc, tool) => acc + approximateTokenSize(JSON.stringify(tool)),
      0
    )
    // 计算剩余可用的上下文长度
    const reservedTokens =
      searchPromptTokens + systemPromptTokens + userMessageTokens + mcpToolsTokens
    const remainingContextLength = contextLength - reservedTokens

    // 选择合适的上下文消息
    const selectedContextMessages = this.selectContextMessages(
      contextMessages,
      userMessage,
      remainingContextLength
    )

    // 格式化消息
    const formattedMessages = this.formatMessagesForCompletion(
      selectedContextMessages,
      systemPrompt,
      artifacts,
      searchPrompt,
      userContent,
      enrichedUserMessage,
      imageFiles,
      vision,
      supportsFunctionCall
    )

    // 合并连续的相同角色消息
    const mergedMessages = this.mergeConsecutiveMessages(formattedMessages)

    // 计算prompt tokens
    let promptTokens = 0
    for (const msg of mergedMessages) {
      if (typeof msg.content === 'string') {
        promptTokens += approximateTokenSize(msg.content)
      } else {
        promptTokens +=
          approximateTokenSize(msg.content?.map((item) => item.text).join('') || '') +
          imageFiles.reduce((acc, file) => acc + file.token, 0)
      }
    }
    // console.log('preparePromptContent', mergedMessages, promptTokens)

    return { finalContent: mergedMessages, promptTokens }
  }

  // 选择上下文消息
  private selectContextMessages(
    contextMessages: Message[],
    userMessage: Message,
    remainingContextLength: number
  ): Message[] {
    if (remainingContextLength <= 0) {
      return []
    }

    const messages = contextMessages.filter((msg) => msg.id !== userMessage?.id).reverse()

    let currentLength = 0
    const selectedMessages: Message[] = []

    for (const msg of messages) {
      if (msg.status !== 'sent') {
        continue
      }
      const msgContent = msg.role === 'user' ? (msg.content as UserMessageContent) : null
      const msgText = msgContent
        ? msgContent.text ||
          (msgContent.content ? this.formatUserMessageContent(msgContent.content) : '')
        : ''

      const msgTokens = approximateTokenSize(
        msg.role === 'user'
          ? `${msgText}${getFileContext(msgContent?.files || [])}`
          : JSON.stringify(msg.content)
      )

      if (currentLength + msgTokens <= remainingContextLength) {
        // 如果是用户消息且有 content 但没有 text，添加 text
        if (msg.role === 'user') {
          const userMsgContent = msg.content as UserMessageContent
          if (userMsgContent.content && !userMsgContent.text) {
            userMsgContent.text = this.formatUserMessageContent(userMsgContent.content)
          }
        }

        selectedMessages.unshift(msg)
        currentLength += msgTokens
      } else {
        break
      }
    }
    while (selectedMessages.length > 0 && selectedMessages[0].role !== 'user') {
      selectedMessages.shift()
    }
    return selectedMessages
  }

  // 格式化消息用于完成
  private formatMessagesForCompletion(
    contextMessages: Message[],
    systemPrompt: string,
    artifacts: number,
    searchPrompt: string,
    userContent: string,
    enrichedUserMessage: string,
    imageFiles: MessageFile[],
    vision: boolean,
    supportsFunctionCall: boolean
  ): ChatMessage[] {
    const formattedMessages: ChatMessage[] = []

    // 添加上下文消息
    formattedMessages.push(
      ...this.addContextMessages(contextMessages, vision, supportsFunctionCall)
    )

    // 添加系统提示
    if (systemPrompt) {
      // formattedMessages.push(...this.addSystemPrompt(formattedMessages, systemPrompt, artifacts))
      formattedMessages.unshift({
        role: 'system',
        content: systemPrompt
      })
      // console.log('-------------> system prompt \n', systemPrompt, artifacts, formattedMessages)
    }

    // 添加当前用户消息
    let finalContent = searchPrompt || userContent

    if (enrichedUserMessage) {
      finalContent += enrichedUserMessage
    }

    if (artifacts === 1) {
      // formattedMessages.push({
      //   role: 'user',
      //   content: ARTIFACTS_PROMPT
      // })
      console.log('artifacts目前由mcp提供，此处为兼容性保留')
    }
    // 没有 vision 就不用塞进去了
    if (vision && imageFiles.length > 0) {
      formattedMessages.push(this.addImageFiles(finalContent, imageFiles))
    } else {
      formattedMessages.push({
        role: 'user',
        content: finalContent.trim()
      })
    }

    return formattedMessages
  }

  private addImageFiles(finalContent: string, imageFiles: MessageFile[]): ChatMessage {
    return {
      role: 'user',
      content: [
        ...imageFiles.map((file) => ({
          type: 'image_url' as const,
          image_url: { url: file.content, detail: 'auto' as const }
        })),
        { type: 'text' as const, text: finalContent.trim() }
      ]
    }
  }

  // 添加上下文消息
  private addContextMessages(
    contextMessages: Message[],
    vision: boolean,
    supportsFunctionCall: boolean
  ): ChatMessage[] {
    const resultMessages = [] as ChatMessage[]

    // 对于原生fc模型，支持正确的tool_call response history插入
    if (supportsFunctionCall) {
      contextMessages.forEach((msg) => {
        if (msg.role === 'user') {
          // 处理用户消息
          const msgContent = msg.content as UserMessageContent
          const msgText = msgContent.content
            ? this.formatUserMessageContent(msgContent.content)
            : msgContent.text
          const userContent = `${msgText}${getFileContext(msgContent.files)}`
          resultMessages.push({
            role: 'user',
            content: userContent
          })
        } else if (msg.role === 'assistant') {
          // 处理助手消息
          let afterSearch = false
          const assistantBlocks = msg.content as AssistantMessageBlock[]
          for (const subMsg of assistantBlocks) {
            if (
              subMsg.type === 'tool_call' &&
              subMsg?.tool_call?.id?.trim() &&
              subMsg?.tool_call?.name?.trim() &&
              subMsg?.tool_call?.params?.trim() &&
              subMsg?.tool_call?.response?.trim()
            ) {
              resultMessages.push({
                role: 'assistant',
                tool_calls: [
                  {
                    id: subMsg.tool_call.id,
                    type: 'function',
                    function: {
                      name: subMsg.tool_call.name,
                      arguments: subMsg.tool_call.params
                    }
                  }
                ]
              })
              resultMessages.push({
                role: 'tool',
                tool_call_id: subMsg.tool_call.id,
                content: subMsg.tool_call.response
              })
            } else if (subMsg.type === 'search') {
              // 删除强制搜索结果中遗留的[x]引文标记
              afterSearch = true
            } else if (subMsg.type === 'content') {
              // 删除强制搜索结果中遗留的[x]引文标记
              let content = subMsg.content ?? ''
              if (afterSearch) content = content.replace(/\[\d+\]/g, '')
              resultMessages.push({
                role: 'assistant',
                content: content
              })
              afterSearch = false
            }
          }
        }
      })
      return resultMessages
    } else {
      // 对于非原生fc模型，支持规范化prompt实现
      contextMessages.forEach((msg) => {
        if (msg.role === 'user') {
          // 处理用户消息
          const msgContent = msg.content as UserMessageContent
          const msgText = msgContent.content
            ? this.formatUserMessageContent(msgContent.content)
            : msgContent.text
          const userContent = `${msgText}${getFileContext(msgContent.files)}`
          resultMessages.push({
            role: 'user',
            content: userContent
          })
        } else if (msg.role === 'assistant') {
          // 处理助手消息
          const assistantBlocks = msg.content as AssistantMessageBlock[]
          // 提取文本内容块，同时将工具调用的响应内容提取出来
          let afterSearch = false
          const textContent = assistantBlocks
            .filter(
              (block) =>
                block.type === 'content' || block.type === 'search' || block.type === 'tool_call'
            )
            .map((block) => {
              if (block.type === 'search') {
                // 删除强制搜索结果中遗留的[x]引文标记
                afterSearch = true
                return ''
              } else if (block.type === 'content') {
                // 删除强制搜索结果中遗留的[x]引文标记
                let content = block.content ?? ''
                if (afterSearch) content = content.replace(/\[\d+\]/g, '')
                afterSearch = false
                return content
              } else if (
                block.type === 'tool_call' &&
                block.tool_call?.response &&
                block.tool_call?.params
              ) {
                let parsedParams
                let parsedResponse

                try {
                  parsedParams = JSON.parse(block.tool_call.params)
                } catch {
                  parsedParams = block.tool_call.params // 保留原字符串
                }

                try {
                  parsedResponse = JSON.parse(block.tool_call.response)
                } catch {
                  parsedResponse = block.tool_call.response // 保留原字符串
                }

                return (
                  '<function_call>' +
                  JSON.stringify({
                    function_call_record: {
                      name: block.tool_call.name,
                      arguments: parsedParams,
                      response: parsedResponse
                    }
                  }) +
                  '</function_call>'
                )
              } else {
                return '' // 若 tool_call 或 response、params 是 undefined 返回。只是便于调试而已，可以为空。
              }
            })
            .join('\n')

          // 查找图像块
          const imageBlocks = assistantBlocks.filter(
            (block) => block.type === 'image' && block.image_data
          )

          // 如果没有任何内容，则跳过此消息
          if (!textContent && imageBlocks.length === 0) {
            return
          }

          // 如果有图像，则使用复合内容格式
          if (vision && imageBlocks.length > 0) {
            const content: ChatMessageContent[] = []

            // 添加图像内容
            imageBlocks.forEach((block) => {
              if (block.image_data) {
                content.push({
                  type: 'image_url',
                  image_url: {
                    url: block.image_data.data,
                    detail: 'auto'
                  }
                })
              }
            })

            // 添加文本内容
            if (textContent) {
              content.push({
                type: 'text',
                text: textContent
              })
            }

            resultMessages.push({
              role: 'assistant',
              content: content
            })
          } else {
            // 仅有文本内容
            resultMessages.push({
              role: 'assistant',
              content: textContent
            })
          }
        }
      })

      return resultMessages
    }
  }

  // 合并连续的相同角色的content，但注意assistant下content不能跟tool_calls合并
  private mergeConsecutiveMessages(messages: ChatMessage[]): ChatMessage[] {
    if (!messages || messages.length === 0) {
      return []
    }

    const mergedResult: ChatMessage[] = []
    // 为第一条消息创建一个深拷贝并添加到结果数组
    mergedResult.push(JSON.parse(JSON.stringify(messages[0])))

    for (let i = 1; i < messages.length; i++) {
      // 为当前消息创建一个深拷贝
      const currentMessage = JSON.parse(JSON.stringify(messages[i])) as ChatMessage
      const lastPushedMessage = mergedResult[mergedResult.length - 1]

      let allowMessagePropertiesMerge = false // 标志是否允许消息属性（如content）合并

      // 步骤 1: 判断消息本身是否允许合并（基于role和tool_calls）
      if (lastPushedMessage.role === currentMessage.role) {
        if (currentMessage.role === 'assistant') {
          // Assistant消息: 仅当两条消息都【不】包含tool_calls时，才允许合并
          if (!lastPushedMessage.tool_calls && !currentMessage.tool_calls) {
            allowMessagePropertiesMerge = true
          }
        } else {
          // 其他角色 (user, system): 如果role相同，则允许合并
          allowMessagePropertiesMerge = true
        }
      }

      if (allowMessagePropertiesMerge) {
        // 步骤 2: 如果消息允许合并，尝试合并其 content 字段
        const LMC = lastPushedMessage.content // 上一条已推送消息的内容
        const CMC = currentMessage.content // 当前待处理消息的内容

        let newCombinedContent: string | ChatMessageContent[] | undefined = undefined
        let contentTypesCompatibleForMerging = false

        if (LMC === undefined && CMC === undefined) {
          newCombinedContent = undefined
          contentTypesCompatibleForMerging = true
        } else if (typeof LMC === 'string' && (typeof CMC === 'string' || CMC === undefined)) {
          // LMC是string, CMC是string或undefined
          const sLMC = LMC || ''
          const sCMC = CMC || ''
          if (sLMC && sCMC) newCombinedContent = `${sLMC}\n${sCMC}`
          else newCombinedContent = sLMC || sCMC // 保留有内容的一方
          if (newCombinedContent === '') newCombinedContent = undefined // 空字符串视为undefined
          contentTypesCompatibleForMerging = true
        } else if (Array.isArray(LMC) && (Array.isArray(CMC) || CMC === undefined)) {
          // LMC是数组, CMC是数组或undefined
          const arrLMC = LMC
          const arrCMC = CMC || [] // 如果CMC是undefined, 视为空数组进行合并
          newCombinedContent = [...arrLMC, ...arrCMC]
          if (newCombinedContent.length === 0) newCombinedContent = undefined // 空数组视为undefined
          contentTypesCompatibleForMerging = true
        } else if (LMC === undefined && CMC !== undefined) {
          // LMC是undefined, CMC有值 (string或array)
          newCombinedContent = CMC
          contentTypesCompatibleForMerging = true
        } else if (LMC !== undefined && CMC === undefined) {
          // LMC有值, CMC是undefined -> content保持LMC的值，无需改变
          newCombinedContent = LMC
          contentTypesCompatibleForMerging = true // 视为成功合并（当前消息内容被"吸收"）
        }
        // 如果LMC和CMC的类型不兼容 (例如一个是string, 另一个是array)，
        // contentTypesCompatibleForMerging 将保持 false

        if (contentTypesCompatibleForMerging) {
          lastPushedMessage.content = newCombinedContent
          // currentMessage 被成功合并，不需单独push
        } else {
          // 角色和tool_calls条件允许合并，但内容类型不兼容
          // 因此，不合并消息，将 currentMessage 作为新消息加入
          mergedResult.push(currentMessage)
        }
      } else {
        // 角色不同，或者 assistant 消息因 tool_calls 而不允许合并
        // 将 currentMessage 作为新消息加入
        mergedResult.push(currentMessage)
      }
    }

    return mergedResult
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
    return this.activeConversationIds.get(tabId) || null
  }

  private async getLatestConversation(): Promise<CONVERSATION | null> {
    const result = await this.getConversationList(1, 1)
    return result.list[0] || null
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
    const targetConversationId =
      conversationId ?? (tabId !== undefined ? this.activeConversationIds.get(tabId) : undefined)
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
    const messagesWithLength = messages
      .map((msg) => {
        if (msg.role === 'user') {
          return {
            message: msg,
            length:
              `${(msg.content as UserMessageContent).text}${getFileContext((msg.content as UserMessageContent).files)}`
                .length,
            formattedMessage: {
              role: 'user' as const,
              content: `${(msg.content as UserMessageContent).text}${getFileContext((msg.content as UserMessageContent).files)}`
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
    this.activeConversationIds.delete(tabId)
    eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, { tabId })
  }

  async clearAllMessages(conversationId: string): Promise<void> {
    await this.messageManager.clearAllMessages(conversationId)
    // 检查所有 tab 中的活跃会话
    for (const [, activeId] of this.activeConversationIds.entries()) {
      if (activeId === conversationId) {
        // 停止所有正在生成的消息
        await this.stopConversationGeneration(conversationId)
      }
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
   * @returns 新创建的会话ID
   */
  async forkConversation(
    targetConversationId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<CONVERSATION_SETTINGS>
  ): Promise<string> {
    try {
      // 1. 获取源会话信息
      const sourceConversation = await this.sqlitePresenter.getConversation(targetConversationId)
      if (!sourceConversation) {
        throw new Error('源会话不存在')
      }

      // 2. 创建新会话
      const newConversationId = await this.sqlitePresenter.createConversation(newTitle)

      // 更新会话设置
      if (settings || sourceConversation.settings) {
        await this.updateConversationSettings(
          newConversationId,
          settings || sourceConversation.settings
        )
      }

      // 更新is_new标志
      await this.sqlitePresenter.updateConversation(newConversationId, { is_new: 0 })

      // 3. 获取源会话中的消息历史
      const message = await this.messageManager.getMessage(targetMessageId)
      if (!message) {
        throw new Error('目标消息不存在')
      }

      // 获取目标消息之前的所有消息（包括目标消息）
      const messageHistory = await this.getMessageHistory(targetMessageId, 100)

      // 4. 直接操作数据库复制消息到新会话
      for (const msg of messageHistory) {
        // 只复制已发送成功的消息
        if (msg.status !== 'sent') {
          continue
        }

        // 获取消息序号
        const orderSeq = (await this.sqlitePresenter.getMaxOrderSeq(newConversationId)) + 1

        // 解析元数据
        const metadata: MESSAGE_METADATA = {
          totalTokens: msg.usage?.total_tokens || 0,
          generationTime: 0,
          firstTokenTime: 0,
          tokensPerSecond: 0,
          contextUsage: 0,
          inputTokens: msg.usage?.input_tokens || 0,
          outputTokens: msg.usage?.output_tokens || 0,
          ...(msg.model_id ? { model: msg.model_id } : {}),
          ...(msg.model_provider ? { provider: msg.model_provider } : {})
        }

        // 计算token数量
        const tokenCount = msg.usage?.total_tokens || 0

        // 内容处理（确保是字符串）
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)

        // 直接插入消息记录
        await this.sqlitePresenter.insertMessage(
          newConversationId, // 新会话ID
          content, // 内容
          msg.role, // 角色
          '', // 无父消息ID
          JSON.stringify(metadata), // 元数据
          orderSeq, // 序号
          tokenCount, // token数
          'sent', // 状态固定为sent
          0, // 不是上下文边界
          0 // 不是变体
        )
      }

      // 在所有数据库操作完成后，调用广播方法
      await this.broadcastThreadListUpdate()

      // 5. 触发会话创建事件
      return newConversationId
    } catch (error) {
      console.error('分支会话失败:', error)
      throw error
    }
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

  private async broadcastThreadListUpdate(): Promise<void> {
    // 1. 获取所有会话 (假设9999足够大)
    const result = await this.sqlitePresenter.getConversationList(1, this.fetchThreadLength)

    // 2. 对列表进行排序 (置顶优先, 然后按更新时间)
    result.list.sort((a, b) => {
      const aIsPinned = a.is_pinned === 1
      const bIsPinned = b.is_pinned === 1
      if (aIsPinned && !bIsPinned) return -1
      if (!aIsPinned && bIsPinned) return 1
      return b.updatedAt - a.updatedAt
    })

    // 3. 按日期分组
    const groupedThreads: Map<string, CONVERSATION[]> = new Map()
    result.list.forEach((conv) => {
      const date = new Date(conv.updatedAt).toISOString().split('T')[0]
      if (!groupedThreads.has(date)) {
        groupedThreads.set(date, [])
      }
      groupedThreads.get(date)!.push(conv)
    })
    const finalGroupedList = Array.from(groupedThreads.entries()).map(([dt, dtThreads]) => ({
      dt,
      dtThreads
    }))

    // 4. 广播这个格式化好的完整列表
    eventBus.sendToRenderer(
      CONVERSATION_EVENTS.LIST_UPDATED,
      SendTarget.ALL_WINDOWS,
      finalGroupedList
    )
  }

  // 权限响应处理方法
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
    
    const state = this.generatingMessages.get(messageId)
    if (!state) {
      // 尝试从已完成的消息中查找
      console.log(`[ThreadPresenter] Message ${messageId} not in generating state, checking if it's a completed message`)
      
      // 尝试直接更新消息内容
      try {
        const message = await this.messageManager.getMessage(messageId)
        if (message && message.role === 'assistant') {
          const content = message.content as AssistantMessageBlock[]
          const permissionBlock = content.find(
            block => block.type === 'tool_call_permission' && 
                     block.tool_call?.id === toolCallId
          )
          
          if (permissionBlock) {
            console.log(`[ThreadPresenter] Found permission block in completed message, updating status`)
            permissionBlock.status = granted ? 'granted' : 'denied'
            if (permissionBlock.extra) {
              permissionBlock.extra.needsUserAction = false
              if (granted) {
                permissionBlock.extra.grantedPermissions = permissionType
              }
            }
            
            await this.messageManager.editMessage(messageId, JSON.stringify(content))
            
            if (granted) {
              const serverName = permissionBlock?.extra?.serverName as string
              if (serverName) {
                console.log(`[ThreadPresenter] Granting permission for completed message: ${permissionType} for server: ${serverName}`)
                await presenter.mcpPresenter.grantPermission(serverName, permissionType, remember)
              }
            }
            
            console.log(`[ThreadPresenter] Permission response handled for completed message: ${messageId}`)
            return
          }
        }
      } catch (error) {
        console.error(`[ThreadPresenter] Failed to handle permission for completed message:`, error)
      }
      
      console.error(`[ThreadPresenter] Message not found in generating state: ${messageId}`)
      throw new Error('Message not found or not in generating state')
    }

    console.log(`[ThreadPresenter] Found generating state for message: ${messageId}`)

    // Update the permission block
    const permissionBlock = state.message.content.find(
      block => block.type === 'tool_call_permission' && 
               block.tool_call?.id === toolCallId
    )

    if (permissionBlock) {
      console.log(`[ThreadPresenter] Updating permission block status to: ${granted ? 'granted' : 'denied'}`)
      permissionBlock.status = granted ? 'granted' : 'denied'
      if (permissionBlock.extra) {
        permissionBlock.extra.needsUserAction = false
        if (granted) {
          permissionBlock.extra.grantedPermissions = permissionType
        }
      }
      
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))
    }

    if (granted) {
      // Grant permission in ToolManager
      const serverName = permissionBlock?.extra?.serverName as string
      if (serverName) {
        console.log(`[ThreadPresenter] Granting permission in ToolManager: ${permissionType} for server: ${serverName}`)
        await presenter.mcpPresenter.grantPermission(serverName, permissionType, remember)
      }
      
      // Continue the agent loop
      console.log(`[ThreadPresenter] Continuing with permission for tool: ${toolCallId}`)
      await this.continueWithPermission(messageId, toolCallId)
    } else {
      console.log(`[ThreadPresenter] Permission denied, ending generation for message: ${messageId}`)
      // Permission denied - end the generation for this message
      this.generatingMessages.delete(messageId)
      
      // Send final usage info and end event
      if (state.totalUsage) {
        eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
          eventId: messageId,
          totalUsage: state.totalUsage
        })
      }
      
      eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, {
        eventId: messageId,
        userStop: false
      })
    }
  }

  private async continueWithPermission(messageId: string, toolCallId: string): Promise<void> {
    console.log(`[ThreadPresenter] Starting continueWithPermission for message: ${messageId}, tool: ${toolCallId}`)
    
    const state = this.generatingMessages.get(messageId)
    if (!state) {
      console.error(`[ThreadPresenter] No generating state found for message: ${messageId}`)
      return
    }

    // Find the permission block for logging
    const permissionBlock = state.message.content.find(
      block => block.type === 'tool_call_permission' && 
               block.tool_call?.id === toolCallId
    )

    if (!permissionBlock?.tool_call) {
      console.error(`[ThreadPresenter] No permission block found for tool: ${toolCallId}`)
      return
    }

    console.log(`[ThreadPresenter] Permission granted, resuming agent loop for tool: ${permissionBlock.tool_call.name}`)

    // Since permission is now granted, simply resume the agent loop
    // The agent loop will re-execute the tool call with the new permissions
    try {
      await this.resumeStreamCompletion(state.conversationId, messageId)
    } catch (error) {
      console.error(`[ThreadPresenter] Failed to resume stream completion:`, error)
      await this.messageManager.handleMessageError(messageId, String(error))
    }
  }

  private async resumeStreamCompletion(conversationId: string, messageId: string): Promise<void> {
    const state = this.generatingMessages.get(messageId)
    if (!state) return

    try {
      // Get conversation and context for resuming
      const { conversation, contextMessages, userMessage } = await this.prepareConversationContext(
        conversationId,
        messageId
      )

      const { providerId, modelId, temperature, maxTokens } = conversation.settings
      const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)

      // Prepare the prompt content with all the context including the tool result
      const { finalContent } = await this.preparePromptContent(
        conversation,
        'continue',
        contextMessages,
        null,
        [],
        userMessage,
        false,
        [],
        modelConfig.functionCall
      )

      // Continue the agent loop
      const stream = this.llmProviderPresenter.startStreamCompletion(
        providerId,
        finalContent,
        modelId,
        messageId,
        temperature,
        maxTokens
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
      console.error('Failed to resume stream completion:', error)
      await this.messageManager.handleMessageError(messageId, String(error))
    }
  }
}
