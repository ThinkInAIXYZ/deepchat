import { type Ref } from 'vue'
import type { AssistantMessage, UserMessage, Message } from '@shared/chat'
import { usePresenter } from '@/composables/usePresenter'
import { useConversationCore } from '@/composables/chat/useConversationCore'
import { getCachedMessage, hasCachedMessage } from '@/lib/messageRuntimeCache'
import { useI18n } from 'vue-i18n'
import type { WorkingStatus } from '@/stores/chat'
import { useNotificationService } from '@/composables/notifications/useNotificationService'

/**
 * Stream message type definition
 */
export interface StreamMessage {
  eventId: string
  conversationId?: string
  parentId?: string
  is_variant?: boolean
  stream_kind?: 'init' | 'delta' | 'final'
  seq?: number
  content?: string
  reasoning_content?: string
  tool_call_id?: string
  tool_call_name?: string
  tool_call_params?: string
  tool_call_response?: string
  maximum_tool_calls_reached?: boolean
  tool_call_server_name?: string
  tool_call_server_icons?: string
  tool_call_server_description?: string
  tool_call_response_raw?: unknown
  tool_call?: 'start' | 'end' | 'error' | 'update' | 'running'
  totalUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  image_data?: {
    data: string
    mimeType: string
  }
  rate_limit?: {
    providerId: string
    qpsLimit: number
    currentQps: number
    queueLength: number
    estimatedWaitTime?: number
  }
}

/**
 * Helper function to finalize assistant message blocks
 */
function finalizeAssistantMessageBlocks(content: any[]) {
  for (const block of content) {
    if (block.status === 'loading') {
      block.status = 'success'
    }
  }
}

/**
 * Message streaming composable
 * Handles streaming message responses, updates, and errors
 */
export function useMessageStreaming(
  activeThreadId: Ref<string | null>,
  generatingThreadIds: Ref<Set<string>>,
  generatingMessagesCache: Ref<Map<string, { message: Message; threadId: string }>>,
  threadsWorkingStatus: Ref<Map<string, WorkingStatus>>,
  updateThreadWorkingStatus: (threadId: string, status: WorkingStatus) => void,
  enrichMessageWithExtra: (message: Message) => Promise<Message>,
  audioComposable: any,
  messageCacheComposable: any
) {
  const conversationCore = useConversationCore()
  const windowP = usePresenter('windowPresenter')
  const notificationService = useNotificationService()
  const { t } = useI18n()

  /**
   * Handle streaming response messages
   * Processes init, delta, and final stream events
   */
  const handleStreamResponse = (msg: StreamMessage) => {
    const { eventId, conversationId, parentId, is_variant, stream_kind } = msg

    // 非当前会话的消息直接忽略（性能优化）
    if (conversationId && conversationId !== activeThreadId.value) {
      return
    }

    // 处理 init 事件：创建骨架消息行
    if (stream_kind === 'init') {
      if (hasCachedMessage(eventId)) {
        return
      }

      const skeleton: AssistantMessage = {
        id: eventId,
        conversationId: conversationId ?? activeThreadId.value ?? '',
        parentId: parentId ?? '',
        role: 'assistant',
        content: [],
        timestamp: Date.now(),
        status: 'pending',
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
        avatar: '',
        name: '',
        model_name: '',
        model_id: '',
        model_provider: '',
        error: '',
        is_variant: Number(is_variant),
        variants: []
      }

      messageCacheComposable.cacheMessageForView(skeleton)
      if (!skeleton.is_variant) {
        messageCacheComposable.ensureMessageId(eventId)
      }

      return
    }

    // 从缓存中查找消息
    const cached = generatingMessagesCache.value.get(eventId)
    const fallbackCached = cached ? null : (getCachedMessage(eventId) as Message | null)
    const message = cached?.message ?? fallbackCached
    const msgThreadId = cached?.threadId ?? activeThreadId.value

    if (!message || message.role !== 'assistant') {
      return
    }

    const assistantMsg = message as AssistantMessage

    if (!Array.isArray(assistantMsg.content)) {
      return
    }

    // 处理工具调用达到最大次数的情况
    if (msg.maximum_tool_calls_reached) {
      finalizeAssistantMessageBlocks(assistantMsg.content)
      assistantMsg.content.push({
        type: 'action',
        content: 'common.error.maximumToolCallsReached',
        status: 'success',
        timestamp: Date.now(),
        action_type: 'maximum_tool_calls_reached',
        tool_call: {
          id: msg.tool_call_id,
          name: msg.tool_call_name,
          params: msg.tool_call_params,
          server_name: msg.tool_call_server_name,
          server_icons: msg.tool_call_server_icons,
          server_description: msg.tool_call_server_description
        },
        extra: {
          needContinue: true
        }
      })
    } else if (msg.tool_call) {
      // 处理工具调用事件
      if (msg.tool_call === 'start') {
        finalizeAssistantMessageBlocks(assistantMsg.content)
        audioComposable.playToolcallSound()
        assistantMsg.content.push({
          type: 'tool_call',
          content: '',
          status: 'loading',
          timestamp: Date.now(),
          tool_call: {
            id: msg.tool_call_id,
            name: msg.tool_call_name,
            params: msg.tool_call_params || '',
            server_name: msg.tool_call_server_name,
            server_icons: msg.tool_call_server_icons,
            server_description: msg.tool_call_server_description
          }
        })
      } else if (msg.tool_call === 'update') {
        const existingToolCallBlock = assistantMsg.content.find(
          (block) =>
            block.type === 'tool_call' &&
            ((msg.tool_call_id && block.tool_call?.id === msg.tool_call_id) ||
              block.tool_call?.name === msg.tool_call_name) &&
            block.status === 'loading'
        )
        if (existingToolCallBlock?.type === 'tool_call' && existingToolCallBlock.tool_call) {
          existingToolCallBlock.tool_call.params = msg.tool_call_params || ''
          if (msg.tool_call_server_name) {
            existingToolCallBlock.tool_call.server_name = msg.tool_call_server_name
          }
          if (msg.tool_call_server_icons) {
            existingToolCallBlock.tool_call.server_icons = msg.tool_call_server_icons
          }
          if (msg.tool_call_server_description) {
            existingToolCallBlock.tool_call.server_description = msg.tool_call_server_description
          }
        }
      } else if (msg.tool_call === 'running') {
        const existingToolCallBlock = assistantMsg.content.find(
          (block) =>
            block.type === 'tool_call' &&
            ((msg.tool_call_id && block.tool_call?.id === msg.tool_call_id) ||
              block.tool_call?.name === msg.tool_call_name) &&
            block.status === 'loading'
        )
        if (existingToolCallBlock?.type === 'tool_call') {
          existingToolCallBlock.status = 'loading'
          if (existingToolCallBlock.tool_call) {
            existingToolCallBlock.tool_call.params =
              msg.tool_call_params || existingToolCallBlock.tool_call.params
            if (msg.tool_call_server_name) {
              existingToolCallBlock.tool_call.server_name = msg.tool_call_server_name
            }
            if (msg.tool_call_server_icons) {
              existingToolCallBlock.tool_call.server_icons = msg.tool_call_server_icons
            }
            if (msg.tool_call_server_description) {
              existingToolCallBlock.tool_call.server_description = msg.tool_call_server_description
            }
          }
        } else {
          finalizeAssistantMessageBlocks(assistantMsg.content)
          assistantMsg.content.push({
            type: 'tool_call',
            content: '',
            status: 'loading',
            timestamp: Date.now(),
            tool_call: {
              id: msg.tool_call_id,
              name: msg.tool_call_name,
              params: msg.tool_call_params || '',
              server_name: msg.tool_call_server_name,
              server_icons: msg.tool_call_server_icons,
              server_description: msg.tool_call_server_description
            }
          })
        }
      } else if (msg.tool_call === 'end' || msg.tool_call === 'error') {
        const existingToolCallBlock = assistantMsg.content.find(
          (block) =>
            block.type === 'tool_call' &&
            ((msg.tool_call_id && block.tool_call?.id === msg.tool_call_id) ||
              block.tool_call?.name === msg.tool_call_name) &&
            block.status === 'loading'
        )
        if (existingToolCallBlock?.type === 'tool_call') {
          if (msg.tool_call === 'error') {
            existingToolCallBlock.status = 'error'
            if (existingToolCallBlock.tool_call) {
              existingToolCallBlock.tool_call.response =
                msg.tool_call_response || 'tool call failed'
            }
          } else {
            existingToolCallBlock.status = 'success'
            if (msg.tool_call_response && existingToolCallBlock.tool_call) {
              existingToolCallBlock.tool_call.response = msg.tool_call_response
            }
          }
        }
      }
    } else if (msg.image_data) {
      finalizeAssistantMessageBlocks(assistantMsg.content)
      assistantMsg.content.push({
        type: 'image',
        content: 'image',
        status: 'success',
        timestamp: Date.now(),
        image_data: {
          data: msg.image_data.data,
          mimeType: msg.image_data.mimeType
        }
      })
    } else if (msg.rate_limit) {
      finalizeAssistantMessageBlocks(assistantMsg.content)
      assistantMsg.content.push({
        type: 'action',
        content: 'chat.messages.rateLimitWaiting',
        status: 'loading',
        timestamp: Date.now(),
        action_type: 'rate_limit',
        extra: {
          providerId: msg.rate_limit.providerId,
          qpsLimit: msg.rate_limit.qpsLimit,
          currentQps: msg.rate_limit.currentQps,
          queueLength: msg.rate_limit.queueLength,
          estimatedWaitTime: msg.rate_limit.estimatedWaitTime ?? 0
        }
      })
    } else if (msg.content) {
      const lastContentBlock = assistantMsg.content[assistantMsg.content.length - 1]
      if (lastContentBlock?.type === 'content') {
        lastContentBlock.content += msg.content
      } else {
        assistantMsg.content.push({
          type: 'content',
          content: msg.content,
          status: 'loading',
          timestamp: Date.now()
        })
      }
      audioComposable.playTypewriterSound()
    }

    if (msg.reasoning_content) {
      const lastReasoningBlock = assistantMsg.content[assistantMsg.content.length - 1]
      if (lastReasoningBlock?.type === 'reasoning_content') {
        lastReasoningBlock.content += msg.reasoning_content
      } else {
        assistantMsg.content.push({
          type: 'reasoning_content',
          content: msg.reasoning_content,
          status: 'loading',
          timestamp: Date.now()
        })
      }
    }

    if (msg.totalUsage) {
      assistantMsg.usage = {
        ...assistantMsg.usage,
        total_tokens: msg.totalUsage.total_tokens,
        input_tokens: msg.totalUsage.prompt_tokens,
        output_tokens: msg.totalUsage.completion_tokens
      }
    }

    if (msgThreadId === activeThreadId.value) {
      messageCacheComposable.cacheMessageForView(assistantMsg)
      if (!assistantMsg.is_variant) {
        messageCacheComposable.ensureMessageId(assistantMsg.id)
      }

      if (assistantMsg.is_variant && assistantMsg.parentId) {
        const mainMessage = messageCacheComposable.findMainAssistantMessageByParentId(
          assistantMsg.parentId
        )
        if (mainMessage) {
          if (!mainMessage.variants) {
            mainMessage.variants = []
          }
          const variantIndex = mainMessage.variants.findIndex((v) => v.id === assistantMsg.id)
          if (variantIndex !== -1) {
            mainMessage.variants[variantIndex] = assistantMsg
          } else {
            mainMessage.variants.push(assistantMsg)
          }
          messageCacheComposable.cacheMessageForView(mainMessage)
          messageCacheComposable.ensureMessageId(mainMessage.id)
        }
      }
    }
  }

  /**
   * Handle stream end event
   * Finalizes the message and updates cache
   */
  const handleStreamEnd = async (msg: { eventId: string }) => {
    // 从缓存中移除消息
    const cached = generatingMessagesCache.value.get(msg.eventId)
    if (cached) {
      // 获取最新的消息并处理 extra 信息
      const updatedMessage = await conversationCore.getMessage(msg.eventId)
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      generatingMessagesCache.value.delete(msg.eventId)
      generatingThreadIds.value.delete(cached.threadId)
      generatingThreadIds.value = new Set(generatingThreadIds.value)

      // 设置会话的workingStatus为completed
      // 如果是当前活跃的会话，则直接从Map中移除
      if (activeThreadId.value === cached.threadId) {
        threadsWorkingStatus.value.delete(cached.threadId)
      } else {
        updateThreadWorkingStatus(cached.threadId, 'completed')
      }

      // 如果是变体消息，需要更新主消息
      if (enrichedMessage.is_variant && enrichedMessage.parentId) {
        // 获取主消息
        const mainMessage = await conversationCore.getMainMessageByParentId(
          cached.threadId,
          enrichedMessage.parentId
        )

        if (mainMessage) {
          const enrichedMainMessage = await enrichMessageWithExtra(mainMessage)
          // 如果是当前激活的会话，更新显示
          if (activeThreadId.value === cached.threadId) {
            messageCacheComposable.cacheMessageForView(
              enrichedMainMessage as AssistantMessage | UserMessage
            )
            messageCacheComposable.ensureMessageId(enrichedMainMessage.id)
          }
        }
      } else {
        // 如果是当前激活的会话，更新显示
        if (activeThreadId.value === cached.threadId) {
          messageCacheComposable.cacheMessageForView(
            enrichedMessage as AssistantMessage | UserMessage
          )
          messageCacheComposable.ensureMessageId(enrichedMessage.id)
        }
      }
    }
  }

  /**
   * Handle stream error event
   * Updates message with error status and sends notification
   */
  const handleStreamError = async (msg: { eventId: string }) => {
    // 从缓存中获取消息
    let cached = generatingMessagesCache.value.get(msg.eventId)
    let threadId = cached?.threadId

    // 如果缓存中没有，尝试从当前消息列表中查找对应的会话ID
    if (!threadId) {
      try {
        const foundMessage = await conversationCore.getMessage(msg.eventId)
        threadId = foundMessage.conversationId
      } catch (error) {
        console.warn('Failed to locate message thread for stream error:', error)
      }
    }

    if (threadId) {
      try {
        const updatedMessage = await conversationCore.getMessage(msg.eventId)
        const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

        if (enrichedMessage.is_variant && enrichedMessage.parentId) {
          // 处理变体消息的错误状态
          const mainMessage = messageCacheComposable.findMainAssistantMessageByParentId(
            enrichedMessage.parentId
          )
          if (mainMessage) {
            if (!mainMessage.variants) {
              mainMessage.variants = []
            }
            const variantIndex = mainMessage.variants.findIndex((v) => v.id === enrichedMessage.id)
            if (variantIndex !== -1) {
              mainMessage.variants[variantIndex] = enrichedMessage
            } else {
              mainMessage.variants.push(enrichedMessage)
            }
            messageCacheComposable.cacheMessageForView({ ...mainMessage })
            messageCacheComposable.ensureMessageId(mainMessage.id)
          }
        } else {
          // 非变体消息的原有错误处理逻辑
          messageCacheComposable.cacheMessageForView(
            enrichedMessage as AssistantMessage | UserMessage
          )
          messageCacheComposable.ensureMessageId(enrichedMessage.id)
        }

        const wid = window.api.getWindowId() || 0
        // 检查窗口是否聚焦，如果未聚焦则发送错误通知
        const isFocused = await windowP.isMainWindowFocused(wid)
        if (!isFocused) {
          // 获取错误信息
          let errorMessage = t('chat.notify.generationError')
          if (enrichedMessage && (enrichedMessage as AssistantMessage).content) {
            const assistantMsg = enrichedMessage as AssistantMessage
            // 查找错误信息块
            for (const block of assistantMsg.content) {
              if (block.status === 'error' && block.content) {
                errorMessage = block.content.substring(0, 20)
                if (block.content.length > 20) errorMessage += '...'
                break
              }
            }
          }

          // 发送错误通知
          await notificationService.showSystemNotification({
            id: `error-${msg.eventId}`,
            title: t('chat.notify.generationError'),
            body: errorMessage
          })
        }
      } catch (error) {
        console.error('Failed to load error message:', error)
      }

      generatingMessagesCache.value.delete(msg.eventId)
      generatingThreadIds.value.delete(threadId)
      // 设置会话的workingStatus为error
      // 如果是当前活跃的会话，则直接从Map中移除
      if (activeThreadId.value === threadId) {
        threadsWorkingStatus.value.delete(threadId)
      } else {
        updateThreadWorkingStatus(threadId, 'error')
      }
    }
  }

  return {
    handleStreamResponse,
    handleStreamEnd,
    handleStreamError
  }
}
