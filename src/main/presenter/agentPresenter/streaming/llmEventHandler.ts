import { eventBus, SendTarget } from '@/eventbus'
import { CONVERSATION_EVENTS, STREAM_EVENTS } from '@/events'
import type { AssistantMessageBlock } from '@shared/chat'
import { finalizeAssistantMessageBlocks } from '@shared/chat/messageBlocks'
import type { LLMAgentEventData, MESSAGE_METADATA } from '@shared/presenter'
import { approximateTokenSize } from 'tokenx'
import { presenter } from '@/presenter'
import type { MessageManager } from '../../sessionPresenter/managers/messageManager'
import type { GeneratingMessageState } from './types'
import type { ContentBufferHandler } from './contentBufferHandler'
import type { ToolCallHandler } from '../loop/toolCallHandler'
import type { StreamUpdateScheduler } from './streamUpdateScheduler'

type ConversationUpdateHandler = (state: GeneratingMessageState) => Promise<void>

type HookErrorSnapshot = {
  error: { message: string; stack?: string }
  usage?: Record<string, number> | null
  conversationId?: string
  providerId?: string
  modelId?: string
}

export class LLMEventHandler {
  private readonly generatingMessages: Map<string, GeneratingMessageState>
  private readonly searchingMessages: Set<string>
  private readonly messageManager: MessageManager
  private readonly contentBufferHandler: ContentBufferHandler
  private readonly toolCallHandler: ToolCallHandler
  private readonly streamUpdateScheduler: StreamUpdateScheduler
  private readonly onConversationUpdated?: ConversationUpdateHandler
  private readonly errorByEventId: Map<string, HookErrorSnapshot> = new Map()

  constructor(options: {
    generatingMessages: Map<string, GeneratingMessageState>
    searchingMessages: Set<string>
    messageManager: MessageManager
    contentBufferHandler: ContentBufferHandler
    toolCallHandler: ToolCallHandler
    streamUpdateScheduler: StreamUpdateScheduler
    onConversationUpdated?: ConversationUpdateHandler
  }) {
    this.generatingMessages = options.generatingMessages
    this.searchingMessages = options.searchingMessages
    this.messageManager = options.messageManager
    this.contentBufferHandler = options.contentBufferHandler
    this.toolCallHandler = options.toolCallHandler
    this.streamUpdateScheduler = options.streamUpdateScheduler
    this.onConversationUpdated = options.onConversationUpdated
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
      maximum_tool_calls_reached,
      tool_call_server_name,
      tool_call_server_icons,
      tool_call_server_description,
      tool_call_response_raw,
      tool_call,
      question_request,
      question_error,
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
        extra: { needContinue: true }
      })
      this.streamUpdateScheduler.enqueueDelta(
        eventId,
        state.conversationId,
        state.message.parentId,
        Boolean(state.message.is_variant),
        state.tabId,
        {},
        state.message.content
      )
      return
    }

    if (question_error) {
      this.finalizeLastBlock(state)
      state.message.content.push({
        type: 'error',
        content: question_error,
        status: 'error',
        timestamp: currentTime
      })
    }

    if (reasoning_content) {
      if (state.reasoningStartTime === null) {
        state.reasoningStartTime = currentTime
        await this.messageManager.updateMessageMetadata(eventId, {
          reasoningStartTime: currentTime - state.startTime
        })
      }
      state.lastReasoningTime = currentTime
      // Update reasoningEndTime in metadata for real-time display
      await this.messageManager.updateMessageMetadata(eventId, {
        reasoningEndTime: currentTime - state.startTime
      })
    }

    const lastBlock = state.message.content[state.message.content.length - 1]

    if (tool_call_response_raw && tool_call === 'end') {
      await this.toolCallHandler.processSearchResultsFromToolCall(state, msg, currentTime)
      await this.toolCallHandler.processMcpUiResourcesFromToolCall(state, msg, currentTime)
    }

    const shouldSkipToolCall =
      tool_call && tool_call_name === 'question' && tool_call !== 'question-required'
    const isAcpProvider = state.message.model_provider === 'acp'

    if (tool_call && !shouldSkipToolCall) {
      if (isAcpProvider) {
        try {
          if (tool_call === 'start') {
            presenter.hooksNotifications.dispatchEvent('PreToolUse', {
              conversationId: state.conversationId,
              messageId: eventId,
              providerId: state.message.model_provider,
              modelId: state.message.model_id,
              tool: {
                callId: tool_call_id,
                name: tool_call_name,
                params: tool_call_params
              }
            })
          }
          if (tool_call === 'end') {
            presenter.hooksNotifications.dispatchEvent('PostToolUse', {
              conversationId: state.conversationId,
              messageId: eventId,
              providerId: state.message.model_provider,
              modelId: state.message.model_id,
              tool: {
                callId: tool_call_id,
                name: tool_call_name,
                params: tool_call_params,
                response: msg.tool_call_response ? String(msg.tool_call_response) : undefined
              }
            })
          }
          if (tool_call === 'error') {
            presenter.hooksNotifications.dispatchEvent('PostToolUseFailure', {
              conversationId: state.conversationId,
              messageId: eventId,
              providerId: state.message.model_provider,
              modelId: state.message.model_id,
              tool: {
                callId: tool_call_id,
                name: tool_call_name,
                params: tool_call_params,
                error: msg.tool_call_response ? String(msg.tool_call_response) : undefined
              }
            })
          }
        } catch (error) {
          console.warn('[LLMEventHandler] Failed to dispatch ACP tool hooks:', error)
        }
      }

      switch (tool_call) {
        case 'start':
          presenter.sessionManager.incrementToolCallCount(state.conversationId)
          await this.toolCallHandler.processToolCallStart(state, msg, currentTime)
          break
        case 'update':
        case 'running':
          await this.toolCallHandler.processToolCallUpdate(state, msg)
          break
        case 'permission-required':
          presenter.sessionManager.updateRuntime(state.conversationId, {
            pendingPermission: {
              toolCallId: tool_call_id || '',
              permissionType:
                (msg.permission_request?.permissionType as 'read' | 'write' | 'all' | 'command') ||
                'read',
              payload: msg.permission_request ?? {}
            }
          })
          presenter.sessionManager.setStatus(state.conversationId, 'waiting_permission')
          try {
            presenter.hooksNotifications.dispatchEvent('PermissionRequest', {
              conversationId: state.conversationId,
              messageId: eventId,
              providerId: state.message.model_provider,
              modelId: state.message.model_id,
              tool: {
                callId: tool_call_id,
                name: tool_call_name,
                params: tool_call_params
              },
              permission: msg.permission_request ?? null
            })
          } catch (error) {
            console.warn('[LLMEventHandler] Failed to dispatch PermissionRequest hook:', error)
          }
          await this.toolCallHandler.processToolCallPermission(state, msg, currentTime)
          break
        case 'question-required':
          presenter.sessionManager.updateRuntime(state.conversationId, {
            pendingQuestion: {
              messageId: eventId,
              toolCallId: tool_call_id || ''
            }
          })
          presenter.sessionManager.setStatus(state.conversationId, 'waiting_question')
          await this.toolCallHandler.processQuestionRequest(state, msg, currentTime)
          break
        case 'permission-granted':
        case 'permission-denied':
        case 'continue':
          await this.toolCallHandler.processToolCallPermission(state, msg, currentTime)
          break
        case 'error':
          await this.toolCallHandler.processToolCallError(state, msg)
          break
        case 'end':
          await this.toolCallHandler.processToolCallEnd(state, msg)
          break
        default:
          break
      }
    }

    if (image_data?.data) {
      const rawData = image_data.data ?? ''
      let normalizedData = rawData
      let normalizedMimeType = image_data.mimeType?.trim() ?? ''

      if (
        rawData.startsWith('imgcache://') ||
        rawData.startsWith('http://') ||
        rawData.startsWith('https://')
      ) {
        normalizedMimeType = 'deepchat/image-url'
      } else if (rawData.startsWith('data:image/')) {
        const match = rawData.match(/^data:([^;]+);base64,(.*)$/)
        if (match?.[1] && match?.[2]) {
          normalizedMimeType = match[1]
          normalizedData = match[2]
        }
      } else if (!normalizedMimeType) {
        normalizedMimeType = 'image/png'
      }

      const imageBlock: AssistantMessageBlock = {
        type: 'image',
        status: 'success',
        timestamp: currentTime,
        content: 'image',
        image_data: {
          data: normalizedData,
          mimeType: normalizedMimeType
        }
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
      // Re-get lastBlock in case new blocks were added above
      const currentLastBlock = state.message.content[state.message.content.length - 1]
      if (!currentLastBlock || currentLastBlock.type !== 'reasoning_content') {
        this.finalizeLastBlock(state)
        const reasoningStartTime = currentTime
        state.message.content.push({
          type: 'reasoning_content',
          content: reasoning_content || '',
          status: 'loading',
          timestamp: currentTime,
          reasoning_time: {
            start: reasoningStartTime,
            end: currentTime
          }
        })
      } else if (currentLastBlock.type === 'reasoning_content') {
        currentLastBlock.content += reasoning_content
        // Update reasoning_time.end in real-time during streaming
        if (currentLastBlock.reasoning_time) {
          currentLastBlock.reasoning_time.end = currentTime
        } else {
          const reasoningStartTime = currentLastBlock.timestamp ?? currentTime
          currentLastBlock.reasoning_time = {
            start: reasoningStartTime,
            end: currentTime
          }
        }
      }
    }

    const delta: Partial<LLMAgentEventData> = {}
    if (content) delta.content = content
    if (reasoning_content) {
      delta.reasoning_content = reasoning_content
      // Get the current reasoning_time from the last reasoning_content block
      const lastBlock = state.message.content[state.message.content.length - 1]
      if (lastBlock?.type === 'reasoning_content' && lastBlock.reasoning_time) {
        delta.reasoning_time = lastBlock.reasoning_time
      }
    }
    if (image_data) delta.image_data = image_data
    if (totalUsage) delta.totalUsage = totalUsage

    if (tool_call && !shouldSkipToolCall) {
      delta.tool_call = tool_call
      delta.tool_call_id = tool_call_id
      delta.tool_call_name = tool_call_name
      delta.tool_call_params = tool_call_params
      delta.tool_call_response = msg.tool_call_response
      delta.tool_call_server_name = tool_call_server_name
      delta.tool_call_server_icons = tool_call_server_icons
      delta.tool_call_server_description = tool_call_server_description
      delta.tool_call_response_raw = tool_call_response_raw
      if (msg.permission_request !== undefined) {
        delta.permission_request = msg.permission_request
      }
      if (question_request !== undefined) {
        delta.question_request = question_request
      }
    }

    if (question_error) {
      delta.question_error = question_error
    }

    this.streamUpdateScheduler.enqueueDelta(
      eventId,
      state.conversationId,
      state.message.parentId,
      Boolean(state.message.is_variant),
      state.tabId,
      delta,
      state.message.content
    )
  }

  async handleLLMAgentError(msg: LLMAgentEventData): Promise<void> {
    const { eventId, error } = msg
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    const state = this.generatingMessages.get(eventId)
    const errorSnapshot: HookErrorSnapshot = {
      error: errorStack ? { message: errorMessage, stack: errorStack } : { message: errorMessage },
      usage: state?.totalUsage,
      conversationId: state?.conversationId,
      providerId: state?.message.model_provider,
      modelId: state?.message.model_id
    }

    if (!errorSnapshot.conversationId) {
      try {
        const message = await this.messageManager.getMessage(eventId)
        errorSnapshot.conversationId = message.conversationId
        errorSnapshot.providerId = errorSnapshot.providerId ?? message.model_provider
        errorSnapshot.modelId = errorSnapshot.modelId ?? message.model_id
      } catch {
        // ignore
      }
    }

    this.errorByEventId.set(eventId, errorSnapshot)

    if (state) {
      if (state.adaptiveBuffer) {
        await this.contentBufferHandler.flushAdaptiveBuffer(eventId)
      }

      this.contentBufferHandler.cleanupContentBuffer(state)
    }

    // Flush stream buffers before persisting error to avoid stale snapshot overwrites.
    await this.streamUpdateScheduler.flushAll(eventId, 'final')

    await this.messageManager.handleMessageError(eventId, errorMessage)

    if (state) {
      this.generatingMessages.delete(eventId)
      presenter.sessionManager.setStatus(state.conversationId, 'error')
      presenter.sessionManager.clearPendingPermission(state.conversationId)
      presenter.sessionManager.clearPendingQuestion(state.conversationId)
    } else {
      const message = await this.messageManager.getMessage(eventId)
      if (message) {
        presenter.sessionManager.setStatus(message.conversationId, 'error')
        presenter.sessionManager.clearPendingPermission(message.conversationId)
        presenter.sessionManager.clearPendingQuestion(message.conversationId)
      }
    }

    this.searchingMessages.delete(eventId)
    eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, msg)
  }

  async handleLLMAgentEnd(msg: LLMAgentEventData): Promise<void> {
    const { eventId, userStop } = msg
    const state = this.generatingMessages.get(eventId)
    const errorSnapshot = this.errorByEventId.get(eventId)

    if (state) {
      if (state.adaptiveBuffer) {
        await this.contentBufferHandler.flushAdaptiveBuffer(eventId)
      }

      this.contentBufferHandler.cleanupContentBuffer(state)

      const hasPendingPermissions = state.message.content.some(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'tool_call_permission' &&
          block.status === 'pending'
      )
      const hasPendingQuestions = state.message.content.some(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'question_request' &&
          block.status === 'pending'
      )

      if (hasPendingPermissions || hasPendingQuestions) {
        state.message.content.forEach((block) => {
          if (
            !(
              block.type === 'action' &&
              (block.action_type === 'tool_call_permission' ||
                block.action_type === 'question_request')
            ) &&
            block.status === 'loading'
          ) {
            if (block.type !== 'tool_call') {
              block.status = 'success'
            }
          }
        })
        this.streamUpdateScheduler.enqueueDelta(
          eventId,
          state.conversationId,
          state.message.parentId,
          Boolean(state.message.is_variant),
          state.tabId,
          {},
          state.message.content
        )
        if (hasPendingQuestions) {
          // Question tool ends the assistant message even when waiting for user input.
          await this.messageManager.updateMessageStatus(eventId, 'sent')
        }
        this.searchingMessages.delete(eventId)
        presenter.sessionManager.setStatus(state.conversationId, 'waiting_permission')
        if (!hasPendingPermissions) {
          presenter.sessionManager.setStatus(state.conversationId, 'waiting_question')
        }
        await this.streamUpdateScheduler.flushAll(eventId, 'final')
        this.generatingMessages.delete(eventId)
        eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, msg)
        this.errorByEventId.delete(eventId)
        return
      }

      await this.finalizeMessage(state, eventId, Boolean(userStop))
      presenter.sessionManager.setStatus(state.conversationId, 'idle')
      presenter.sessionManager.clearPendingPermission(state.conversationId)
      presenter.sessionManager.clearPendingQuestion(state.conversationId)
    }

    const stopReason = errorSnapshot ? 'error' : userStop ? 'user_stop' : 'complete'
    const stopPayload = {
      reason: stopReason,
      userStop: Boolean(userStop)
    }
    const usage = state?.totalUsage ?? errorSnapshot?.usage ?? null
    const errorInfo = errorSnapshot?.error ?? null
    let conversationId = state?.conversationId ?? errorSnapshot?.conversationId
    let providerId = state?.message.model_provider ?? errorSnapshot?.providerId
    let modelId = state?.message.model_id ?? errorSnapshot?.modelId

    if (!conversationId) {
      try {
        const message = await this.messageManager.getMessage(eventId)
        conversationId = message.conversationId
        providerId = providerId ?? message.model_provider
        modelId = modelId ?? message.model_id
      } catch {
        // ignore
      }
    }

    try {
      try {
        presenter.hooksNotifications.dispatchEvent('Stop', {
          conversationId,
          providerId,
          modelId,
          stop: stopPayload
        })
      } catch (error) {
        console.warn('[LLMEventHandler] Failed to dispatch Stop hook:', error)
      }
      try {
        presenter.hooksNotifications.dispatchEvent('SessionEnd', {
          conversationId,
          providerId,
          modelId,
          stop: stopPayload,
          usage,
          error: errorInfo
        })
      } catch (error) {
        console.warn('[LLMEventHandler] Failed to dispatch SessionEnd hook:', error)
      }
    } finally {
      this.errorByEventId.delete(eventId)
    }

    await this.streamUpdateScheduler.flushAll(eventId, 'final')
    this.searchingMessages.delete(eventId)
    eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, msg)
  }

  async finalizeMessage(
    state: GeneratingMessageState,
    eventId: string,
    userStop: boolean
  ): Promise<void> {
    state.message.content.forEach((block) => {
      if (
        block.type === 'action' &&
        (block.action_type === 'tool_call_permission' || block.action_type === 'question_request')
      ) {
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

    if (this.onConversationUpdated) {
      await this.onConversationUpdated(state)
    }

    const finalMessage = await this.messageManager.getMessage(eventId)
    if (finalMessage) {
      eventBus.sendToMain(CONVERSATION_EVENTS.MESSAGE_GENERATED, {
        conversationId: finalMessage.conversationId,
        message: finalMessage
      })
    }
  }

  finalizeLastBlock(state: GeneratingMessageState): void {
    finalizeAssistantMessageBlocks(state.message.content)
  }
}
