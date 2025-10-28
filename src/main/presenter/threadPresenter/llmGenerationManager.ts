import { ISQLitePresenter, MESSAGE_METADATA, LLMAgentEventData } from '../../../shared/presenter'
import { MessageManager } from './messageManager'
import { ContentBufferManager } from './contentBufferManager'
import { ConversationLifecycleManager } from './conversationLifecycleManager'
import type { GeneratingMessageState } from './types'
import { eventBus, SendTarget } from '@/eventbus'
import { CONVERSATION_EVENTS, STREAM_EVENTS } from '@/events'
import { AssistantMessageBlock } from '@shared/chat'
import { approximateTokenSize } from 'tokenx'
import { nanoid } from 'nanoid'

interface LLMGenerationManagerOptions {
  sqlitePresenter: ISQLitePresenter
  messageManager: MessageManager
  contentBufferManager: ContentBufferManager
  conversationLifecycle: ConversationLifecycleManager
  generatingMessages: Map<string, GeneratingMessageState>
  searchingMessages: Set<string>
  summarizeConversationTitle: (conversationId: string) => Promise<string | undefined>
}

export class LLMGenerationManager {
  private sqlitePresenter: ISQLitePresenter
  private messageManager: MessageManager
  private contentBufferManager: ContentBufferManager
  private conversationLifecycle: ConversationLifecycleManager
  private generatingMessages: Map<string, GeneratingMessageState>
  private searchingMessages: Set<string>
  private summarizeConversationTitle: (conversationId: string) => Promise<string | undefined>

  constructor(options: LLMGenerationManagerOptions) {
    this.sqlitePresenter = options.sqlitePresenter
    this.messageManager = options.messageManager
    this.contentBufferManager = options.contentBufferManager
    this.conversationLifecycle = options.conversationLifecycle
    this.generatingMessages = options.generatingMessages
    this.searchingMessages = options.searchingMessages
    this.summarizeConversationTitle = options.summarizeConversationTitle
  }

  async handleLLMAgentError(msg: LLMAgentEventData): Promise<void> {
    const { eventId, error } = msg
    const state = this.generatingMessages.get(eventId)
    if (state) {
      if (state.adaptiveBuffer) {
        await this.contentBufferManager.flushAdaptiveBuffer(eventId)
      }

      this.contentBufferManager.cleanupContentBuffer(state)

      await this.messageManager.handleMessageError(eventId, String(error))
      this.generatingMessages.delete(eventId)
    }
    eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, msg)
  }

  async handleLLMAgentEnd(msg: LLMAgentEventData): Promise<void> {
    const { eventId, userStop } = msg
    const state = this.generatingMessages.get(eventId)
    if (state) {
      if (state.adaptiveBuffer) {
        await this.contentBufferManager.flushAdaptiveBuffer(eventId)
      }

      this.contentBufferManager.cleanupContentBuffer(state)

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
        return
      }

      await this.finalizeMessage(state, eventId, Boolean(userStop))
    }

    eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, msg)
  }

  async handleLLMAgentResponse(msg: LLMAgentEventData): Promise<void> {
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
      this.contentBufferManager.finalizeLastBlock(state)
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

            this.contentBufferManager.finalizeLastBlock(state)
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
        this.contentBufferManager.finalizeLastBlock(state)
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
        if (lastBlock && lastBlock.type === 'tool_call' && lastBlock.tool_call) {
          lastBlock.status = 'success'
        }

        this.contentBufferManager.finalizeLastBlock(state)
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
          }
        })

        this.searchingMessages.add(eventId)
        state.isSearching = true
      } else if (tool_call === 'permission-granted') {
        if (
          lastBlock &&
          lastBlock.type === 'action' &&
          lastBlock.action_type === 'tool_call_permission'
        ) {
          lastBlock.status = 'success'
          lastBlock.content = tool_call_response || ''
        }
      } else if (tool_call === 'permission-denied') {
        if (
          lastBlock &&
          lastBlock.type === 'action' &&
          lastBlock.action_type === 'tool_call_permission'
        ) {
          lastBlock.status = 'error'
          lastBlock.content = tool_call_response || ''
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
      }
    }

    if (image_data) {
      const imageBlock: AssistantMessageBlock = {
        type: 'image',
        status: 'success',
        timestamp: currentTime,
        content: image_data
      }
      state.message.content.push(imageBlock)
    }

    if (content) {
      if (!lastBlock || lastBlock.type !== 'content' || lastBlock.status !== 'loading') {
        this.contentBufferManager.finalizeLastBlock(state)
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
        this.contentBufferManager.finalizeLastBlock(state)
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
    const tokensPerSecond = completionTokens / (generationTime / 1000)
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
    const conversation = await this.conversationLifecycle.getConversation(state.conversationId)
    let titleUpdated = false

    if (conversation.is_new === 1) {
      try {
        this.summarizeConversationTitle(state.conversationId).then((title) => {
          if (title) {
            this.conversationLifecycle.renameConversation(state.conversationId, title).then(() => {
              titleUpdated = true
            })
          }
        })
      } catch (e) {
        console.error('Failed to summarize title in main process:', e)
      }
    }

    if (!titleUpdated) {
      await this.sqlitePresenter
        .updateConversation(state.conversationId, {
          updatedAt: Date.now()
        })
        .then(() => {
          console.log('updated conv time', state.conversationId)
        })
      await this.conversationLifecycle.broadcastThreadListUpdate()
    }
  }
}
