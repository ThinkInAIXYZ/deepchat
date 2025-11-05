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
import { CONVERSATION_EVENTS, STREAM_EVENTS, TAB_EVENTS } from '@/events'
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
import { finalizeAssistantMessageBlocks } from '@shared/chat/messageBlocks'
import { approximateTokenSize } from 'tokenx'
import { DEFAULT_SETTINGS } from './const'

export interface CreateConversationOptions {
  forceNewAndActivate?: boolean
}

export class ThreadPresenter implements IThreadPresenter {
  private sqlitePresenter: ISQLitePresenter
  private messageManager: MessageManager
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private searchManager: SearchManager
  private generatingMessages: Map<string, GeneratingMessageState> = new Map()
  private activeConversationIds: Map<number, string> = new Map()
  private fetchThreadLength = 300
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
    for (const [tabId, activeId] of this.activeConversationIds.entries()) {
      if (activeId === conversationId) {
        try {
          const tabView = await presenter.tabPresenter.getTab(tabId)
          if (tabView && !tabView.webContents.isDestroyed()) {
            return tabId
          }
        } catch (error) {
          console.error('Error finding tab for conversation:', error)
        }
      }
    }
    return null
  }

  async handleLLMAgentError(msg: LLMAgentEventData) {
    const { eventId, error } = msg
    const state = this.generatingMessages.get(eventId)
    if (state) {
      if (state.adaptiveBuffer) {
        await this.flushAdaptiveBuffer(eventId)
      }

      this.cleanupContentBuffer(state)

      await this.messageManager.handleMessageError(eventId, String(error))
      this.generatingMessages.delete(eventId)
    }
    this.searchingMessages.delete(eventId)
    eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, msg)
  }

  async handleLLMAgentEnd(msg: LLMAgentEventData) {
    const { eventId, userStop } = msg
    const state = this.generatingMessages.get(eventId)
    if (state) {
      if (state.adaptiveBuffer) {
        await this.flushAdaptiveBuffer(eventId)
      }

      this.cleanupContentBuffer(state)

      const hasPendingPermissions = state.message.content.some(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'tool_call_permission' &&
          block.status === 'pending'
      )

      if (hasPendingPermissions) {
        state.message.content.forEach((block) => {
          if (
            !(block.type === 'action' && block.action_type === 'tool_call_permission') &&
            block.status === 'loading'
          ) {
            block.status = 'success'
          }
        })
        await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
        this.searchingMessages.delete(eventId)
        return
      }

      await this.finalizeMessage(state, eventId, Boolean(userStop))
    }

    this.searchingMessages.delete(eventId)
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
      permission_request,
      totalUsage,
      image_data
    } = msg
    const state = this.generatingMessages.get(eventId)
    if (!state) {
      return
    }

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

    if (maximum_tool_calls_reached) {
      this.finalizeLastBlock(state)
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

    if (tool_call_response_raw && tool_call === 'end') {
      try {
        const hasSearchResults =
          Array.isArray(tool_call_response_raw.content) &&
          tool_call_response_raw.content.some(
            (item: { type: string; resource?: { mimeType: string } }) =>
              item?.type === 'resource' &&
              item?.resource?.mimeType === 'application/deepchat-webpage'
          )

        if (hasSearchResults && Array.isArray(tool_call_response_raw.content)) {
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
            const searchId = nanoid()
            const pages = searchResults
              .filter((item) => item && (item.icon || item.favicon))
              .slice(0, 6)
              .map((item) => ({
                url: item?.url ?? '',
                icon: item?.icon || item?.favicon || ''
              }))

            const searchBlock: AssistantMessageBlock = {
              id: searchId,
              type: 'search',
              content: '',
              status: 'success',
              timestamp: currentTime,
              extra: {
                total: searchResults.length,
                searchId,
                pages,
                label: tool_call_name || 'web_search',
                name: tool_call_name || 'web_search',
                engine: tool_call_server_name || undefined,
                provider: tool_call_server_name || undefined
              }
            }

            this.finalizeLastBlock(state)
            state.message.content.push(searchBlock)

            for (const result of searchResults) {
              await this.sqlitePresenter.addMessageAttachment(
                eventId,
                'search_result',
                JSON.stringify({
                  title: result?.title || '',
                  url: result?.url || '',
                  content: result?.content || '',
                  description: result?.description || '',
                  icon: result?.icon || result?.favicon || '',
                  rank: typeof result?.rank === 'number' ? result.rank : undefined,
                  searchId
                })
              )
            }

            await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
          }
        }
      } catch (error) {
        console.error('处理搜索结果时出错:', error)
      }
    }

    if (tool_call) {
      if (tool_call === 'start') {
        this.finalizeLastBlock(state)
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
        const toolCallBlock = state.message.content.find(
          (block) =>
            block.type === 'tool_call' &&
            block.tool_call?.id === tool_call_id &&
            block.status === 'loading'
        )

        if (toolCallBlock && toolCallBlock.type === 'tool_call') {
          if (toolCallBlock.tool_call) {
            toolCallBlock.tool_call.params = tool_call_params || ''
            toolCallBlock.tool_call.server_name = tool_call_server_name
            toolCallBlock.tool_call.server_icons = tool_call_server_icons
            toolCallBlock.tool_call.server_description = tool_call_server_description
          }
        }
      } else if (tool_call === 'permission-required') {
        // Define allowed permission types
        const ALLOWED_PERMISSION_TYPES = ['read', 'write', 'all'] as const
        type PermissionType = (typeof ALLOWED_PERMISSION_TYPES)[number]

        // Validate and sanitize permission type
        let permissionType: PermissionType = 'read' // Default to 'read' for safety
        const requestedType = permission_request?.permissionType

        if (typeof requestedType === 'string') {
          const normalizedType = requestedType.toLowerCase()
          if (ALLOWED_PERMISSION_TYPES.includes(normalizedType as PermissionType)) {
            permissionType = normalizedType as PermissionType
          } else {
            console.warn(
              `[ThreadPresenter] Invalid permission type received: "${requestedType}". Defaulting to "read". Allowed types: ${ALLOWED_PERMISSION_TYPES.join(', ')}`
            )
          }
        } else if (requestedType !== undefined) {
          console.warn(
            `[ThreadPresenter] Permission type is not a string: ${typeof requestedType}. Defaulting to "read".`
          )
        }

        const extra: Record<string, string | number | object[] | boolean> = {
          needsUserAction: true,
          permissionType
        }

        const serverName = permission_request?.serverName || tool_call_server_name
        if (serverName) {
          extra.serverName = serverName
        }

        const toolName = permission_request?.toolName || tool_call_name
        if (toolName) {
          extra.toolName = toolName
        }

        if (permission_request) {
          extra.permissionRequest = JSON.stringify(permission_request)
        }

        if (lastBlock && lastBlock.type === 'tool_call' && lastBlock.tool_call) {
          lastBlock.status = 'success'
        }

        this.finalizeLastBlock(state)
        const permissionExtra: Record<string, string | boolean> = {
          needsUserAction: true
        }

        if (permission_request?.permissionType) {
          permissionExtra.permissionType = permission_request.permissionType
        }
        if (permission_request) {
          permissionExtra.permissionRequest = JSON.stringify(permission_request)
          if (permission_request.toolName) {
            permissionExtra.toolName = permission_request.toolName
          }
          if (permission_request.serverName) {
            permissionExtra.serverName = permission_request.serverName
          }
        } else {
          if (tool_call_name) {
            permissionExtra.toolName = tool_call_name
          }
          if (tool_call_server_name) {
            permissionExtra.serverName = tool_call_server_name
          }
        }

        state.message.content.push({
          type: 'action',
          content: tool_call_response || '',
          status: 'pending',
          timestamp: currentTime,
          action_type: 'tool_call_permission',
          tool_call: {
            id: tool_call_id,
            name: tool_call_name,
            params: tool_call_params || '',
            server_name: tool_call_server_name,
            server_icons: tool_call_server_icons,
            server_description: tool_call_server_description
          },
          extra: permissionExtra
        })

        if (state) {
          state.pendingToolCall = {
            id: tool_call_id || '',
            name: tool_call_name || '',
            params: tool_call_params || '',
            serverName: tool_call_server_name,
            serverIcons: tool_call_server_icons,
            serverDescription: tool_call_server_description
          }
        }

        this.searchingMessages.add(eventId)
        state.isSearching = true
      } else if (tool_call === 'permission-granted') {
        if (
          lastBlock &&
          lastBlock.type === 'action' &&
          lastBlock.action_type === 'tool_call_permission'
        ) {
          lastBlock.status = 'granted'
          lastBlock.content = tool_call_response || ''
          if (lastBlock.extra) {
            lastBlock.extra.needsUserAction = false
            if (
              !lastBlock.extra.grantedPermissions &&
              typeof lastBlock.extra.permissionType === 'string'
            ) {
              lastBlock.extra.grantedPermissions = lastBlock.extra.permissionType
            }
          }
        }
        this.searchingMessages.delete(eventId)
        state.isSearching = false
        if (state) {
          state.pendingToolCall = {
            id: tool_call_id || '',
            name: tool_call_name || '',
            params: tool_call_params || '',
            serverName: tool_call_server_name,
            serverIcons: tool_call_server_icons,
            serverDescription: tool_call_server_description
          }
        }
      } else if (tool_call === 'permission-denied') {
        if (
          lastBlock &&
          lastBlock.type === 'action' &&
          lastBlock.action_type === 'tool_call_permission'
        ) {
          lastBlock.status = 'denied'
          lastBlock.content = tool_call_response || ''
          if (lastBlock.extra) {
            lastBlock.extra.needsUserAction = false
          }
        }
        this.searchingMessages.delete(eventId)
        state.isSearching = false
        if (state) {
          state.pendingToolCall = undefined
        }
      } else if (tool_call === 'continue') {
        if (
          lastBlock &&
          lastBlock.type === 'action' &&
          lastBlock.action_type === 'tool_call_permission'
        ) {
          lastBlock.status = 'success'
        }
      } else if (tool_call === 'end') {
        const toolCallBlock = state.message.content.find(
          (block) =>
            block.type === 'tool_call' &&
            block.tool_call?.id === tool_call_id &&
            block.status === 'loading'
        )

        if (toolCallBlock && toolCallBlock.type === 'tool_call') {
          toolCallBlock.status = 'success'
          if (toolCallBlock.tool_call) {
            toolCallBlock.tool_call.response = tool_call_response || ''
          }
        }

        if (
          lastBlock &&
          lastBlock.type === 'action' &&
          lastBlock.action_type === 'tool_call_permission'
        ) {
          lastBlock.status = 'success'
        }
        this.searchingMessages.delete(eventId)
        state.isSearching = false
        if (state) {
          state.pendingToolCall = undefined
        }
      }
    }

    if (image_data?.data) {
      const rawData = image_data.data ?? ''
      let normalizedData = rawData
      let normalizedMimeType = image_data.mimeType?.trim() ?? ''

      // Handle URLs (imgcache://, http://, https://)
      if (
        rawData.startsWith('imgcache://') ||
        rawData.startsWith('http://') ||
        rawData.startsWith('https://')
      ) {
        normalizedMimeType = 'deepchat/image-url'
      }
      // Handle data URIs: extract base64 content and mime type
      else if (rawData.startsWith('data:image/')) {
        const match = rawData.match(/^data:([^;]+);base64,(.*)$/)
        if (match?.[1] && match?.[2]) {
          normalizedMimeType = match[1]
          normalizedData = match[2]
        }
      }
      // Fallback to image/png if no mime type is provided
      else if (!normalizedMimeType) {
        normalizedMimeType = 'image/png'
      }

      const normalizedImageData = {
        data: normalizedData,
        mimeType: normalizedMimeType
      }
      const imageBlock: AssistantMessageBlock = {
        type: 'image',
        status: 'success',
        timestamp: currentTime,
        content: 'image',
        image_data: normalizedImageData
      }
      state.message.content.push(imageBlock)
    }

    if (content) {
      if (!lastBlock || lastBlock.type !== 'content' || lastBlock.status !== 'loading') {
        this.finalizeLastBlock(state)
        state.message.content.push({
          type: 'content',
          content: content || '',
          status: 'loading',
          timestamp: currentTime
        })
      } else if (lastBlock.type === 'content') {
        lastBlock.content += content
      }
    }

    if (reasoning_content) {
      if (!lastBlock || lastBlock.type !== 'reasoning_content') {
        this.finalizeLastBlock(state)
        state.message.content.push({
          type: 'reasoning_content',
          content: reasoning_content || '',
          status: 'loading',
          timestamp: currentTime
        })
      } else if (lastBlock.type === 'reasoning_content') {
        lastBlock.content += reasoning_content
      }
    }

    await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
  }

  private finalizeLastBlock(state: GeneratingMessageState): void {
    finalizeAssistantMessageBlocks(state.message.content)
  }

  private async finalizeMessage(
    state: GeneratingMessageState,
    eventId: string,
    userStop: boolean
  ): Promise<void> {
    state.message.content.forEach((block) => {
      if (block.type === 'action' && block.action_type === 'tool_call_permission') {
        return
      }
      block.status = 'success'
    })

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

    const hasContentBlock = state.message.content.some(
      (block) =>
        block.type === 'content' ||
        block.type === 'reasoning_content' ||
        block.type === 'tool_call' ||
        block.type === 'image'
    )

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
    const safeMs = Math.max(1, generationTime)
    const tokensPerSecond = completionTokens / (safeMs / 1000)
    const contextUsage = state?.totalUsage?.context_length
      ? (totalTokens / state.totalUsage.context_length) * 100
      : 0

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

    await this.messageManager.updateMessageMetadata(eventId, metadata)
    await this.messageManager.updateMessageStatus(eventId, 'sent')
    await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
    this.generatingMessages.delete(eventId)
    this.searchingMessages.delete(eventId)

    await this.handleConversationUpdates(state)

    const finalMessage = await this.messageManager.getMessage(eventId)
    if (finalMessage) {
      eventBus.sendToMain(CONVERSATION_EVENTS.MESSAGE_GENERATED, {
        conversationId: finalMessage.conversationId,
        message: finalMessage
      })
    }
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

  private cleanupContentBuffer(state: GeneratingMessageState): void {
    if (state.flushTimeout) {
      clearTimeout(state.flushTimeout)
      state.flushTimeout = undefined
    }
    if (state.throttleTimeout) {
      clearTimeout(state.throttleTimeout)
      state.throttleTimeout = undefined
    }
    state.adaptiveBuffer = undefined
    state.lastRendererUpdateTime = undefined
  }

  private async flushAdaptiveBuffer(eventId: string): Promise<void> {
    const state = this.generatingMessages.get(eventId)
    if (!state?.adaptiveBuffer) return

    const buffer = state.adaptiveBuffer
    const now = Date.now()

    if (state.flushTimeout) {
      clearTimeout(state.flushTimeout)
      state.flushTimeout = undefined
    }

    try {
      if (buffer.content && buffer.sentPosition < buffer.content.length) {
        const newContent = buffer.content.slice(buffer.sentPosition)
        if (newContent) {
          await this.processBufferedContent(state, eventId, newContent, now)
          buffer.sentPosition = buffer.content.length
        }
      }
    } catch (error) {
      console.error('[ContentBuffer] ERROR flushing adaptive buffer', {
        eventId,
        err: error
      })
      throw error
    } finally {
      state.adaptiveBuffer = undefined
    }
  }

  private async processBufferedContent(
    state: GeneratingMessageState,
    eventId: string,
    content: string,
    currentTime: number
  ): Promise<void> {
    const buffer = state.adaptiveBuffer

    if (buffer?.isLargeContent) {
      await this.processLargeContentAsynchronously(state, eventId, content, currentTime)
      return
    }

    await this.processNormalContent(state, eventId, content, currentTime)
  }

  private async processLargeContentAsynchronously(
    state: GeneratingMessageState,
    eventId: string,
    content: string,
    currentTime: number
  ): Promise<void> {
    const buffer = state.adaptiveBuffer
    if (!buffer) return

    buffer.isProcessing = true

    try {
      const chunks = this.splitLargeContent(content)
      const totalChunks = chunks.length

      console.log(
        `[ThreadPresenter] Processing ${totalChunks} chunks asynchronously for ${content.length} bytes`
      )

      const lastBlock = state.message.content[state.message.content.length - 1]
      let contentBlock: any

      if (lastBlock && lastBlock.type === 'content') {
        contentBlock = lastBlock
      } else {
        this.finalizeLastBlock(state)
        contentBlock = {
          type: 'content',
          content: '',
          status: 'loading',
          timestamp: currentTime
        }
        state.message.content.push(contentBlock)
      }

      const batchSize = 5
      for (let batchStart = 0; batchStart < chunks.length; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, chunks.length)
        const batch = chunks.slice(batchStart, batchEnd)

        const batchContent = batch.join('')
        contentBlock.content += batchContent

        await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))

        const eventData: any = {
          eventId,
          content: batchContent,
          chunkInfo: {
            current: batchEnd,
            total: totalChunks,
            isLargeContent: true,
            batchSize: batch.length
          }
        }

        eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, eventData)

        if (batchEnd < chunks.length) {
          await new Promise((resolve) => setImmediate(resolve))
        }
      }

      console.log(`[ThreadPresenter] Completed processing ${totalChunks} chunks`)
    } catch (error) {
      console.error('[ThreadPresenter] Error in processLargeContentAsynchronously:', error)
    } finally {
      buffer.isProcessing = false
    }
  }

  private async processNormalContent(
    state: GeneratingMessageState,
    eventId: string,
    content: string,
    currentTime: number
  ): Promise<void> {
    const lastBlock = state.message.content[state.message.content.length - 1]

    if (lastBlock && lastBlock.type === 'content') {
      lastBlock.content += content
    } else {
      this.finalizeLastBlock(state)
      state.message.content.push({
        type: 'content',
        content: content,
        status: 'loading',
        timestamp: currentTime
      })
    }

    await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
  }

  private splitLargeContent(content: string): string[] {
    const chunks: string[] = []
    let maxChunkSize = 4096

    if (content.includes('data:image/')) {
      maxChunkSize = 512
    }

    if (content.length > 50000) {
      maxChunkSize = Math.min(maxChunkSize, 256)
    }

    for (let i = 0; i < content.length; i += maxChunkSize) {
      chunks.push(content.slice(i, i + maxChunkSize))
    }

    return chunks
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
    return this.activeConversationIds.get(tabId) || null
  }

  getTabsByConversation(conversationId: string): number[] {
    return Array.from(this.activeConversationIds.entries())
      .filter(([, id]) => id === conversationId)
      .map(([tabId]) => tabId)
  }

  clearActiveConversation(tabId: number, options: { notify?: boolean } = {}): void {
    if (!this.activeConversationIds.has(tabId)) {
      return
    }
    this.activeConversationIds.delete(tabId)
    if (options.notify) {
      eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, { tabId })
    }
  }

  clearConversationBindings(conversationId: string): void {
    for (const [tabId, activeId] of this.activeConversationIds.entries()) {
      if (activeId === conversationId) {
        this.activeConversationIds.delete(tabId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, {
          tabId
        })
      }
    }
  }

  private async getTabWindowType(tabId: number): Promise<'floating' | 'main' | 'unknown'> {
    try {
      const tabView = await presenter.tabPresenter.getTab(tabId)
      if (!tabView) {
        return 'unknown'
      }
      const windowId = presenter.tabPresenter.getTabWindowId(tabId)
      return windowId ? 'main' : 'floating'
    } catch (error) {
      console.error('Error determining tab window type:', error)
      return 'unknown'
    }
  }

  async setActiveConversation(conversationId: string, tabId: number): Promise<void> {
    const existingTabId = await this.findTabForConversation(conversationId)

    if (existingTabId !== null && existingTabId !== tabId) {
      console.log(
        `Conversation ${conversationId} is already open in tab ${existingTabId}. Switching to it.`
      )
      const currentTabType = await this.getTabWindowType(tabId)
      const existingTabType = await this.getTabWindowType(existingTabId)

      if (currentTabType !== existingTabType) {
        this.activeConversationIds.delete(existingTabId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, {
          tabId: existingTabId
        })
        this.activeConversationIds.set(tabId, conversationId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
          conversationId,
          tabId
        })
        return
      }

      await presenter.tabPresenter.switchTab(existingTabId)
      return
    }

    const conversation = await this.getConversation(conversationId)
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`)
    }

    if (this.activeConversationIds.get(tabId) === conversationId) {
      return
    }

    this.activeConversationIds.set(tabId, conversationId)
    eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
      conversationId,
      tabId
    })
  }

  async getActiveConversation(tabId: number): Promise<CONVERSATION | null> {
    const conversationId = this.activeConversationIds.get(tabId)
    if (!conversationId) {
      return null
    }
    return this.getConversation(conversationId)
  }

  async getConversation(conversationId: string): Promise<CONVERSATION> {
    return await this.sqlitePresenter.getConversation(conversationId)
  }

  async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {},
    tabId: number,
    options: CreateConversationOptions = {}
  ): Promise<string> {
    let latestConversation: CONVERSATION | null = null

    try {
      latestConversation = await this.getLatestConversation()

      if (!options.forceNewAndActivate && latestConversation) {
        const { list: messages } = await this.messageManager.getMessageThread(
          latestConversation.id,
          1,
          1
        )
        if (messages.length === 0) {
          await this.setActiveConversation(latestConversation.id, tabId)
          return latestConversation.id
        }
      }

      let defaultSettings = DEFAULT_SETTINGS
      if (latestConversation?.settings) {
        defaultSettings = { ...latestConversation.settings }
        defaultSettings.systemPrompt = ''
        defaultSettings.reasoningEffort = undefined
        defaultSettings.enableSearch = undefined
        defaultSettings.forcedSearch = undefined
        defaultSettings.searchStrategy = undefined
      }

      const sanitizedSettings: Partial<CONVERSATION_SETTINGS> = { ...settings }
      Object.keys(sanitizedSettings).forEach((key) => {
        const typedKey = key as keyof CONVERSATION_SETTINGS
        const value = sanitizedSettings[typedKey]
        if (value === undefined || value === null || value === '') {
          delete sanitizedSettings[typedKey]
        }
      })

      const mergedSettings = { ...defaultSettings }
      const previewSettings = { ...mergedSettings, ...sanitizedSettings }

      const defaultModelsSettings = this.configPresenter.getModelConfig(
        previewSettings.modelId,
        previewSettings.providerId
      )

      if (defaultModelsSettings) {
        if (defaultModelsSettings.maxTokens !== undefined) {
          mergedSettings.maxTokens = defaultModelsSettings.maxTokens
        }
        if (defaultModelsSettings.contextLength !== undefined) {
          mergedSettings.contextLength = defaultModelsSettings.contextLength
        }
        mergedSettings.temperature = defaultModelsSettings.temperature ?? 0.7
        if (
          sanitizedSettings.thinkingBudget === undefined &&
          defaultModelsSettings.thinkingBudget !== undefined
        ) {
          mergedSettings.thinkingBudget = defaultModelsSettings.thinkingBudget
        }
      }

      Object.assign(mergedSettings, sanitizedSettings)

      if (mergedSettings.temperature === undefined || mergedSettings.temperature === null) {
        mergedSettings.temperature = defaultModelsSettings?.temperature ?? 0.7
      }

      const conversationId = await this.sqlitePresenter.createConversation(title, mergedSettings)

      if (options.forceNewAndActivate) {
        this.activeConversationIds.set(tabId, conversationId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
          conversationId,
          tabId
        })
      } else {
        await this.setActiveConversation(conversationId, tabId)
      }

      await this.broadcastThreadListUpdate()
      return conversationId
    } catch (error) {
      console.error('ThreadPresenter: Failed to create conversation', {
        title,
        tabId,
        options,
        latestConversationId: latestConversation?.id,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      })
      throw error
    }
  }

  async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    await this.sqlitePresenter.renameConversation(conversationId, title)
    await this.broadcastThreadListUpdate()

    const conversation = await this.getConversation(conversationId)

    let tabId: number | undefined
    for (const [key, value] of this.activeConversationIds.entries()) {
      if (value === conversationId) {
        tabId = key
        break
      }
    }

    if (tabId !== undefined) {
      const windowId = presenter.tabPresenter.getTabWindowId(tabId)
      eventBus.sendToRenderer(TAB_EVENTS.TITLE_UPDATED, SendTarget.ALL_WINDOWS, {
        tabId,
        conversationId,
        title: conversation.title,
        windowId
      })
    }

    return conversation
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.sqlitePresenter.deleteConversation(conversationId)
    this.clearConversationBindings(conversationId)
    await this.broadcastThreadListUpdate()
  }

  async toggleConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, { is_pinned: pinned ? 1 : 0 })
    await this.broadcastThreadListUpdate()
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, { title })
    await this.broadcastThreadListUpdate()
  }

  async updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId)
    const mergedSettings = { ...conversation.settings }

    const sanitizedOverrides = Object.fromEntries(
      Object.entries(settings).filter(([, value]) => value !== undefined)
    ) as Partial<CONVERSATION_SETTINGS>
    Object.assign(mergedSettings, sanitizedOverrides)

    const modelChanged =
      (settings.modelId !== undefined && settings.modelId !== conversation.settings.modelId) ||
      (settings.providerId !== undefined &&
        settings.providerId !== conversation.settings.providerId)

    if (modelChanged) {
      const modelConfig = this.configPresenter.getModelConfig(
        mergedSettings.modelId,
        mergedSettings.providerId
      )
      if (modelConfig) {
        mergedSettings.maxTokens = modelConfig.maxTokens
        mergedSettings.contextLength = modelConfig.contextLength
      }
    }

    await this.sqlitePresenter.updateConversation(conversationId, { settings: mergedSettings })
    await this.broadcastThreadListUpdate()
  }

  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return await this.sqlitePresenter.getConversationList(page, pageSize)
  }

  async loadMoreThreads(): Promise<{ hasMore: boolean; total: number }> {
    const total = await this.sqlitePresenter.getConversationCount()
    const hasMore = this.fetchThreadLength < total

    if (hasMore) {
      this.fetchThreadLength = Math.min(this.fetchThreadLength + 300, total)
      await this.broadcastThreadListUpdate()
    }

    return { hasMore: this.fetchThreadLength < total, total }
  }

  async broadcastThreadListUpdate(): Promise<void> {
    const result = await this.sqlitePresenter.getConversationList(1, this.fetchThreadLength)

    const pinnedConversations: CONVERSATION[] = []
    const normalConversations: CONVERSATION[] = []

    result.list.forEach((conv) => {
      if (conv.is_pinned === 1) {
        pinnedConversations.push(conv)
      } else {
        normalConversations.push(conv)
      }
    })

    pinnedConversations.sort((a, b) => b.updatedAt - a.updatedAt)
    normalConversations.sort((a, b) => b.updatedAt - a.updatedAt)

    const groupedThreads: Map<string, CONVERSATION[]> = new Map()

    if (pinnedConversations.length > 0) {
      groupedThreads.set('Pinned', pinnedConversations)
    }

    normalConversations.forEach((conv) => {
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

    eventBus.sendToRenderer(
      CONVERSATION_EVENTS.LIST_UPDATED,
      SendTarget.ALL_WINDOWS,
      finalGroupedList
    )
  }

  private async getLatestConversation(): Promise<CONVERSATION | null> {
    const result = await this.getConversationList(1, 1)
    return result.list[0] || null
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
    this.finalizeLastBlock(state)
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
    return this.getActiveConversationIdSync(tabId)
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
        await this.flushAdaptiveBuffer(messageId)
      }

      // 清理缓冲相关资源
      this.cleanupContentBuffer(state)

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
    try {
      // 1. 获取源会话信息
      const sourceConversation = await this.sqlitePresenter.getConversation(targetConversationId)
      if (!sourceConversation) {
        throw new Error('源会话不存在')
      }

      // 2. 创建新会话
      const newConversationId = await this.sqlitePresenter.createConversation(newTitle)

      const newSettings = { ...(settings || sourceConversation.settings) }
      newSettings.selectedVariantsMap = {} // 确保新会话不继承变体选择
      await this.updateConversationSettings(newConversationId, newSettings)

      await this.sqlitePresenter.updateConversation(newConversationId, { is_new: 0 })

      // 3.1. 获取完整的、未截断的会话历史（只包含主消息）
      const { list: fullHistory } = await this.messageManager.getMessageThread(
        targetConversationId,
        1,
        99999 // 使用一个足够大的数字确保获取全部历史
      )

      // 3.2. 获取用户点击的目标消息对象
      const targetMessage = await this.messageManager.getMessage(targetMessageId)
      if (!targetMessage) {
        throw new Error('目标消息不存在')
      }

      // 3.3. 确定目标消息所属的“主消息”ID
      let mainTargetId: string | null = null
      if (targetMessage.is_variant) {
        // 如果是变体，则通过其 parentId（指向用户消息）找到其主消息
        if (!targetMessage.parentId) {
          throw new Error('变体消息缺少 parentId，无法定位主消息')
        }
        const mainMessage = await this.messageManager.getMainMessageByParentId(
          targetConversationId,
          targetMessage.parentId
        )
        mainTargetId = mainMessage ? mainMessage.id : null
      } else {
        // 如果本身就是主消息
        mainTargetId = targetMessage.id
      }

      if (!mainTargetId) {
        throw new Error('无法确定用于分叉的历史记录目标主消息ID')
      }

      // 3.4. 在完整历史中找到主消息的索引
      const forkEndIndex = fullHistory.findIndex((msg) => msg.id === mainTargetId)
      if (forkEndIndex === -1) {
        throw new Error('目标主消息在会话历史中未找到，无法分叉。')
      }

      // 3.5. 截取从开始到目标主消息（包括）的正确历史记录
      const messageHistory = fullHistory.slice(0, forkEndIndex + 1)

      // 4. 创建消息ID映射表，用于维护父子关系
      const messageIdMap = new Map<string, string>() // 旧消息ID -> 新消息ID
      const messagesToProcess: Array<{ msg: any; orderSeq: number }> = []

      for (const msg of messageHistory) {
        if (msg.status !== 'sent') {
          continue
        }
        const orderSeq = (await this.sqlitePresenter.getMaxOrderSeq(newConversationId)) + 1
        messagesToProcess.push({ msg, orderSeq })
      }

      // 5. 按顺序插入所有消息，先不设置父ID
      for (const { msg, orderSeq } of messagesToProcess) {
        let finalMsg = msg
        // 当循环到我们关心的主消息时，检查 selectedVariantsMap
        if (msg.role === 'assistant' && selectedVariantsMap && selectedVariantsMap[msg.id]) {
          const selectedVariantId = selectedVariantsMap[msg.id]
          const variant = msg.variants?.find((v) => v.id === selectedVariantId)
          if (variant) {
            finalMsg = variant // 使用选定的变体对象进行复制
          }
        }

        const metadata: MESSAGE_METADATA = {
          totalTokens: finalMsg.usage?.total_tokens || 0,
          generationTime: 0,
          firstTokenTime: 0,
          tokensPerSecond: 0,
          contextUsage: 0,
          inputTokens: finalMsg.usage?.input_tokens || 0,
          outputTokens: finalMsg.usage?.output_tokens || 0,
          ...(finalMsg.model_id ? { model: finalMsg.model_id } : {}),
          ...(finalMsg.model_provider ? { provider: finalMsg.model_provider } : {})
        }

        const tokenCount = finalMsg.usage?.total_tokens || 0
        const content =
          typeof finalMsg.content === 'string' ? finalMsg.content : JSON.stringify(finalMsg.content)

        const newMessageId = await this.sqlitePresenter.insertMessage(
          newConversationId,
          content,
          finalMsg.role,
          '',
          JSON.stringify(metadata),
          orderSeq,
          tokenCount,
          'sent',
          0,
          0
        )
        messageIdMap.set(msg.id, newMessageId)
      }

      // 6. 更新所有消息的父ID，恢复正确的父子关系
      for (const { msg } of messagesToProcess) {
        if (msg.parentId && msg.parentId !== '') {
          const newMessageId = messageIdMap.get(msg.id)
          const newParentId = messageIdMap.get(msg.parentId)
          if (newMessageId && newParentId) {
            await this.sqlitePresenter.updateMessageParentId(newMessageId, newParentId)
          }
        }
      }

      // 7. 在所有数据库操作完成后，调用广播方法
      await this.broadcastThreadListUpdate()

      // 8. 触发会话创建事件
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
}
