import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'
import type { AssistantMessage, AssistantMessageBlock } from '@shared/chat'
import type {
  ILlmProviderPresenter,
  IMCPPresenter,
  MCPToolDefinition,
  MCPToolResponse
} from '@shared/presenter'
import {
  buildContinueToolCallContext,
  buildPostToolExecutionContext,
  type PendingToolCall
} from '../utils/promptBuilder'
import type { GeneratingMessageState } from '../types'
import type { StreamGenerationHandler } from './streamGenerationHandler'
import type { LLMEventHandler } from './llmEventHandler'
import { BaseHandler, type ThreadHandlerContext } from './baseHandler'

export class PermissionHandler extends BaseHandler {
  private readonly generatingMessages: Map<string, GeneratingMessageState>
  private readonly llmProviderPresenter: ILlmProviderPresenter
  private readonly getMcpPresenter: () => IMCPPresenter
  private readonly streamGenerationHandler: StreamGenerationHandler
  private readonly llmEventHandler: LLMEventHandler

  constructor(
    context: ThreadHandlerContext,
    options: {
      generatingMessages: Map<string, GeneratingMessageState>
      llmProviderPresenter: ILlmProviderPresenter
      getMcpPresenter: () => IMCPPresenter
      streamGenerationHandler: StreamGenerationHandler
      llmEventHandler: LLMEventHandler
    }
  ) {
    super(context)
    this.generatingMessages = options.generatingMessages
    this.llmProviderPresenter = options.llmProviderPresenter
    this.getMcpPresenter = options.getMcpPresenter
    this.streamGenerationHandler = options.streamGenerationHandler
    this.llmEventHandler = options.llmEventHandler
    this.assertDependencies()
  }

  private assertDependencies(): void {
    void this.generatingMessages
    void this.llmProviderPresenter
    void this.getMcpPresenter
    void this.streamGenerationHandler
    void this.llmEventHandler
  }

  async handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all',
    remember: boolean = true
  ): Promise<void> {
    console.log('[PermissionHandler] Handling permission response', {
      messageId,
      toolCallId,
      granted,
      permissionType,
      remember
    })

    try {
      const message = await this.ctx.messageManager.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        throw new Error(`Message not found or not assistant message (${messageId})`)
      }

      const content = message.content as AssistantMessageBlock[]
      const permissionBlock = content.find(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'tool_call_permission' &&
          block.tool_call?.id === toolCallId
      )

      if (!permissionBlock) {
        throw new Error(
          `Permission block not found (messageId: ${messageId}, toolCallId: ${toolCallId})`
        )
      }

      const parsedPermissionRequest = this.parsePermissionRequest(permissionBlock)
      const isAcpPermission = this.isAcpPermissionBlock(permissionBlock, parsedPermissionRequest)

      permissionBlock.status = granted ? 'granted' : 'denied'
      if (permissionBlock.extra) {
        permissionBlock.extra.needsUserAction = false
        if (granted) {
          permissionBlock.extra.grantedPermissions = permissionType
        }
      }

      const generatingState = this.generatingMessages.get(messageId)
      if (generatingState) {
        const permissionIndex = generatingState.message.content.findIndex(
          (block) =>
            block.type === 'action' &&
            block.action_type === 'tool_call_permission' &&
            block.tool_call?.id === toolCallId
        )

        if (permissionIndex !== -1) {
          const statePermissionBlock = generatingState.message.content[permissionIndex]
          generatingState.message.content[permissionIndex] = {
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
          generatingState.message.content = content.map((block) => ({
            ...block,
            extra: block.extra ? { ...block.extra } : undefined,
            tool_call: block.tool_call ? { ...block.tool_call } : undefined
          }))
        }
      }

      await this.ctx.messageManager.editMessage(messageId, JSON.stringify(content))

      if (isAcpPermission) {
        await this.handleAcpPermissionFlow(
          messageId,
          permissionBlock,
          parsedPermissionRequest,
          granted
        )
        return
      }

      if (granted) {
        const serverName = permissionBlock?.extra?.serverName as string
        if (!serverName) {
          throw new Error(`Server name not found in permission block (${messageId})`)
        }

        try {
          await this.getMcpPresenter().grantPermission(serverName, permissionType, remember)
          await this.waitForMcpServiceReady(serverName)
        } catch (error) {
          permissionBlock.status = 'error'
          await this.ctx.messageManager.editMessage(messageId, JSON.stringify(content))
          throw error
        }

        await this.restartAgentLoopAfterPermission(messageId)
      } else {
        await this.continueAfterPermissionDenied(messageId)
      }
    } catch (error) {
      console.error('[PermissionHandler] Failed to handle permission response:', error)

      try {
        const message = await this.ctx.messageManager.getMessage(messageId)
        if (message) {
          await this.ctx.messageManager.handleMessageError(messageId, String(error))
        }
      } catch (updateError) {
        console.error('[PermissionHandler] Failed to update message status:', updateError)
      }

      throw error
    }
  }

  async restartAgentLoopAfterPermission(messageId: string): Promise<void> {
    console.log('[PermissionHandler] Restarting agent loop after permission', messageId)

    try {
      const message = await this.ctx.messageManager.getMessage(messageId)
      if (!message) {
        throw new Error(`Message not found (${messageId})`)
      }

      const conversationId = message.conversationId
      const content = message.content as AssistantMessageBlock[]
      const permissionBlock = content.find(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'tool_call_permission' &&
          block.status === 'granted'
      )

      if (!permissionBlock) {
        throw new Error(`No granted permission block found (${messageId})`)
      }

      if (permissionBlock?.extra?.serverName) {
        try {
          const servers = await this.ctx.configPresenter.getMcpServers()
          const serverConfig = servers[permissionBlock.extra.serverName as string]
          console.log('[PermissionHandler] Server permissions:', serverConfig?.autoApprove || [])
        } catch (configError) {
          console.warn('[PermissionHandler] Failed to verify server permissions:', configError)
        }
      }

      const state = this.generatingMessages.get(messageId)
      if (state) {
        if (state.pendingToolCall) {
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
        pendingToolCall: this.findPendingToolCallAfterPermission(assistantMessage.content)
      })

      await this.streamGenerationHandler.startStreamCompletion(conversationId, messageId)
    } catch (error) {
      console.error('[PermissionHandler] Failed to restart agent loop:', error)
      this.generatingMessages.delete(messageId)

      try {
        await this.ctx.messageManager.handleMessageError(messageId, String(error))
      } catch (updateError) {
        console.error('[PermissionHandler] Failed to update message error status:', updateError)
      }

      throw error
    }
  }

  async continueAfterPermissionDenied(messageId: string): Promise<void> {
    console.log('[PermissionHandler] Continuing after permission denied', messageId)

    try {
      const message = await this.ctx.messageManager.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        throw new Error(`Message not found or not assistant (${messageId})`)
      }

      const conversationId = message.conversationId
      const content = message.content as AssistantMessageBlock[]
      const deniedPermissionBlock = content.find(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'tool_call_permission' &&
          block.status === 'denied'
      )

      if (!deniedPermissionBlock?.tool_call) {
        console.warn('[PermissionHandler] No denied permission block for', messageId)
        return
      }

      const toolCall = deniedPermissionBlock.tool_call
      const errorMessage = `Tool execution failed: Permission denied by user for ${
        toolCall.name || 'this tool'
      }`

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

      let state = this.generatingMessages.get(messageId)
      if (!state) {
        state = {
          message: message as AssistantMessage,
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

      state.pendingToolCall = undefined

      const { conversation, contextMessages, userMessage } =
        await this.streamGenerationHandler.prepareConversationContext(conversationId, messageId)

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

      const modelConfig = this.ctx.configPresenter.getModelConfig(modelId, providerId)
      const completedToolCall = {
        id: toolCall.id || '',
        name: toolCall.name || '',
        params: toolCall.params || '',
        response: errorMessage,
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
        searchStrategy,
        conversation.id
      )

      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.llmEventHandler.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.llmEventHandler.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.llmEventHandler.handleLLMAgentEnd(msg)
        }
      }
    } catch (error) {
      console.error('[PermissionHandler] Failed to continue after permission denied:', error)
      this.generatingMessages.delete(messageId)

      try {
        await this.ctx.messageManager.handleMessageError(messageId, String(error))
      } catch (updateError) {
        console.error('[PermissionHandler] Failed to update message error status:', updateError)
      }

      throw error
    }
  }

  async resumeStreamCompletion(conversationId: string, messageId: string): Promise<void> {
    const state = this.generatingMessages.get(messageId)
    if (!state) {
      await this.streamGenerationHandler.startStreamCompletion(conversationId, undefined)
      return
    }

    try {
      const conversation = await this.ctx.sqlitePresenter.getConversation(conversationId)
      if (!conversation) {
        throw new Error(`Conversation not found (${conversationId})`)
      }

      const pendingToolCall = this.findPendingToolCallAfterPermission(state.message.content)
      if (!pendingToolCall) {
        await this.streamGenerationHandler.startStreamCompletion(conversationId, messageId)
        return
      }

      const { contextMessages, userMessage } =
        await this.streamGenerationHandler.prepareConversationContext(conversationId, messageId)

      const modelConfig = this.ctx.configPresenter.getModelConfig(
        conversation.settings.modelId,
        conversation.settings.providerId
      )

      const finalContent = await buildContinueToolCallContext({
        conversation,
        contextMessages,
        userMessage,
        pendingToolCall,
        modelConfig
      })

      const stream = this.llmProviderPresenter.startStreamCompletion(
        conversation.settings.providerId,
        finalContent,
        conversation.settings.modelId,
        messageId,
        conversation.settings.temperature,
        conversation.settings.maxTokens,
        conversation.settings.enabledMcpTools,
        conversation.settings.thinkingBudget,
        conversation.settings.reasoningEffort,
        conversation.settings.verbosity,
        conversation.settings.enableSearch,
        conversation.settings.forcedSearch,
        conversation.settings.searchStrategy,
        conversationId
      )

      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.llmEventHandler.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.llmEventHandler.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.llmEventHandler.handleLLMAgentEnd(msg)
        }
      }
    } catch (error) {
      console.error('[PermissionHandler] Failed to resume stream completion:', error)
      this.generatingMessages.delete(messageId)

      try {
        await this.ctx.messageManager.handleMessageError(messageId, String(error))
      } catch (updateError) {
        console.error('[PermissionHandler] Failed to update message error status:', updateError)
      }

      throw error
    }
  }

  async resumeAfterPermissionWithPendingToolCall(
    state: GeneratingMessageState,
    message: AssistantMessage,
    conversationId: string
  ): Promise<void> {
    const pendingToolCall = state.pendingToolCall
    if (!pendingToolCall || !pendingToolCall.id || !pendingToolCall.name) {
      await this.resumeStreamCompletion(conversationId, message.id)
      return
    }

    try {
      const { conversation, contextMessages, userMessage } =
        await this.streamGenerationHandler.prepareConversationContext(conversationId, message.id)

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

      const modelConfig = this.ctx.configPresenter.getModelConfig(modelId, providerId)
      if (!modelConfig) {
        await this.resumeStreamCompletion(conversationId, message.id)
        return
      }

      let toolDef: MCPToolDefinition | undefined
      try {
        const toolDefinitions = await this.getMcpPresenter().getAllToolDefinitions(enabledMcpTools)
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
        console.error('[PermissionHandler] Failed to load tool definitions:', error)
      }

      if (!toolDef) {
        await this.resumeStreamCompletion(conversationId, message.id)
        return
      }

      await this.llmEventHandler.handleLLMAgentResponse({
        eventId: message.id,
        tool_call: 'running',
        tool_call_id: pendingToolCall.id,
        tool_call_name: pendingToolCall.name,
        tool_call_params: pendingToolCall.params,
        tool_call_server_name: toolDef.server.name,
        tool_call_server_icons: toolDef.server.icons,
        tool_call_server_description: toolDef.server.description
      } as any)

      let toolContent = ''
      let toolRawData: MCPToolResponse | null = null
      try {
        const toolCallResult = await this.getMcpPresenter().callTool({
          id: pendingToolCall.id,
          type: 'function',
          function: {
            name: pendingToolCall.name,
            arguments: pendingToolCall.params
          },
          server: toolDef.server
        })
        toolContent = toolCallResult.content
        toolRawData = toolCallResult.rawData
      } catch (toolError) {
        console.error('[PermissionHandler] Failed to execute pending tool call:', toolError)
        await this.llmEventHandler.handleLLMAgentResponse({
          eventId: message.id,
          tool_call: 'error',
          tool_call_id: pendingToolCall.id,
          tool_call_name: pendingToolCall.name,
          tool_call_params: pendingToolCall.params,
          tool_call_response: toolError instanceof Error ? toolError.message : String(toolError),
          tool_call_server_name: toolDef.server.name,
          tool_call_server_icons: toolDef.server.icons,
          tool_call_server_description: toolDef.server.description
        } as any)
        throw toolError
      }

      if (toolRawData?.requiresPermission) {
        await this.llmEventHandler.handleLLMAgentResponse({
          eventId: message.id,
          tool_call: 'permission-required',
          tool_call_id: pendingToolCall.id,
          tool_call_name: pendingToolCall.name,
          tool_call_params: pendingToolCall.params,
          tool_call_server_name: toolRawData.permissionRequest?.serverName || toolDef.server.name,
          tool_call_server_icons: toolDef.server.icons,
          tool_call_server_description: toolDef.server.description,
          tool_call_response: toolContent,
          permission_request: toolRawData.permissionRequest
        } as any)
        return
      }

      await this.llmEventHandler.handleLLMAgentResponse({
        eventId: message.id,
        tool_call: 'end',
        tool_call_id: pendingToolCall.id,
        tool_call_name: pendingToolCall.name,
        tool_call_params: pendingToolCall.params,
        tool_call_response: toolContent,
        tool_call_server_name: toolDef.server.name,
        tool_call_server_icons: toolDef.server.icons,
        tool_call_server_description: toolDef.server.description,
        tool_call_response_raw: toolRawData ?? undefined
      } as any)

      state.pendingToolCall = undefined

      const finalContent = await buildPostToolExecutionContext({
        conversation,
        contextMessages,
        userMessage,
        currentAssistantMessage: state.message,
        completedToolCall: {
          ...pendingToolCall,
          response: toolContent
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
        searchStrategy,
        conversation.id
      )

      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.llmEventHandler.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.llmEventHandler.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.llmEventHandler.handleLLMAgentEnd(msg)
        }
      }
    } catch (error) {
      console.error('[PermissionHandler] Failed to resume pending tool call:', error)
      this.generatingMessages.delete(message.id)

      try {
        await this.ctx.messageManager.handleMessageError(message.id, String(error))
      } catch (updateError) {
        console.error('[PermissionHandler] Failed to update message error status:', updateError)
      }

      throw error
    }
  }

  async waitForMcpServiceReady(serverName: string, maxWaitTime: number = 3000): Promise<void> {
    const startTime = Date.now()
    const checkInterval = 100

    return new Promise((resolve) => {
      const checkReady = async () => {
        try {
          const isRunning = await this.getMcpPresenter().isServerRunning(serverName)
          if (isRunning) {
            setTimeout(() => resolve(), 200)
            return
          }

          if (Date.now() - startTime > maxWaitTime) {
            console.warn('[PermissionHandler] Timeout waiting for MCP service', serverName)
            resolve()
            return
          }

          setTimeout(checkReady, checkInterval)
        } catch (error) {
          console.error('[PermissionHandler] Error checking MCP service status:', error)
          resolve()
        }
      }

      checkReady()
    })
  }

  findPendingToolCallAfterPermission(
    content: AssistantMessageBlock[]
  ): PendingToolCall | undefined {
    const grantedPermissionBlock = content.find(
      (block) =>
        block.type === 'action' &&
        block.action_type === 'tool_call_permission' &&
        block.status === 'granted'
    )

    if (!grantedPermissionBlock?.tool_call) {
      return undefined
    }

    const { id, name, params } = grantedPermissionBlock.tool_call
    if (!id || !name || !params) {
      console.warn(
        '[PermissionHandler] Incomplete tool call info:',
        grantedPermissionBlock.tool_call
      )
      return undefined
    }

    return {
      id,
      name,
      params,
      serverName: grantedPermissionBlock.tool_call.server_name,
      serverIcons: grantedPermissionBlock.tool_call.server_icons,
      serverDescription: grantedPermissionBlock.tool_call.server_description
    }
  }

  private parsePermissionRequest(block: AssistantMessageBlock): Record<string, unknown> | null {
    const raw = this.getExtraString(block, 'permissionRequest')
    if (!raw) {
      return null
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch (error) {
      console.warn('[PermissionHandler] Failed to parse permissionRequest payload:', error)
      return null
    }
  }

  private isAcpPermissionBlock(
    block: AssistantMessageBlock,
    permissionRequest: Record<string, unknown> | null
  ): boolean {
    const providerIdFromExtra = this.getExtraString(block, 'providerId')
    const providerIdFromPayload = this.getStringFromObject(permissionRequest, 'providerId')
    return providerIdFromExtra === 'acp' || providerIdFromPayload === 'acp'
  }

  private async handleAcpPermissionFlow(
    messageId: string,
    block: AssistantMessageBlock,
    permissionRequest: Record<string, unknown> | null,
    granted: boolean
  ): Promise<void> {
    const requestId =
      this.getExtraString(block, 'permissionRequestId') ||
      this.getStringFromObject(permissionRequest, 'requestId')

    if (!requestId) {
      throw new Error(`Missing ACP permission request identifier for message ${messageId}`)
    }

    await this.ctx.llmProviderPresenter.resolveAgentPermission(requestId, granted)
  }

  private getExtraString(block: AssistantMessageBlock, key: string): string | undefined {
    const extraValue = block.extra?.[key]
    return typeof extraValue === 'string' ? extraValue : undefined
  }

  private getStringFromObject(
    source: Record<string, unknown> | null,
    key: string
  ): string | undefined {
    if (!source) {
      return undefined
    }
    const value = source[key]
    return typeof value === 'string' ? value : undefined
  }
}
