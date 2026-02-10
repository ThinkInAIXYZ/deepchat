import { presenter } from '@/presenter'
import type { AssistantMessage, AssistantMessageBlock } from '@shared/chat'
import type {
  ILlmProviderPresenter,
  IMCPPresenter,
  IToolPresenter,
  MCPToolDefinition,
  MCPToolResponse
} from '@shared/presenter'
import {
  buildContinueToolCallContext,
  buildPostToolExecutionContext,
  type PendingToolCall
} from '../message/messageBuilder'
import type { GeneratingMessageState } from '../streaming/types'
import type { StreamGenerationHandler } from '../streaming/streamGenerationHandler'
import type { LLMEventHandler } from '../streaming/llmEventHandler'
import { BaseHandler, type ThreadHandlerContext } from '../../searchPresenter/handlers/baseHandler'
import { CommandPermissionService } from '../../permission/commandPermissionService'

export class PermissionHandler extends BaseHandler {
  private readonly generatingMessages: Map<string, GeneratingMessageState>
  private readonly llmProviderPresenter: ILlmProviderPresenter
  private readonly getMcpPresenter: () => IMCPPresenter
  private readonly getToolPresenter: () => IToolPresenter
  private readonly streamGenerationHandler: StreamGenerationHandler
  private readonly llmEventHandler: LLMEventHandler
  private readonly commandPermissionHandler: CommandPermissionService

  constructor(
    context: ThreadHandlerContext,
    options: {
      generatingMessages: Map<string, GeneratingMessageState>
      llmProviderPresenter: ILlmProviderPresenter
      getMcpPresenter: () => IMCPPresenter
      getToolPresenter: () => IToolPresenter
      streamGenerationHandler: StreamGenerationHandler
      llmEventHandler: LLMEventHandler
      commandPermissionHandler: CommandPermissionService
    }
  ) {
    super(context)
    this.generatingMessages = options.generatingMessages
    this.llmProviderPresenter = options.llmProviderPresenter
    this.getMcpPresenter = options.getMcpPresenter
    this.getToolPresenter = options.getToolPresenter
    this.streamGenerationHandler = options.streamGenerationHandler
    this.llmEventHandler = options.llmEventHandler
    this.commandPermissionHandler = options.commandPermissionHandler
    this.assertDependencies()
  }

  private assertDependencies(): void {
    void this.generatingMessages
    void this.llmProviderPresenter
    void this.getMcpPresenter
    void this.getToolPresenter
    void this.streamGenerationHandler
    void this.llmEventHandler
    void this.commandPermissionHandler
  }

  async handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all' | 'command',
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

      // Get server name for batch permission updates
      const serverName = permissionBlock?.extra?.serverName as string

      // Batch update: update all pending permission blocks for the same server
      const updatedPermissionIds: string[] = []
      for (const block of content) {
        if (
          block.type === 'action' &&
          block.action_type === 'tool_call_permission' &&
          block.status === 'pending' &&
          block.extra?.serverName === serverName
        ) {
          block.status = granted ? 'granted' : 'denied'
          if (block.extra) {
            block.extra.needsUserAction = false
            if (granted) {
              block.extra.grantedPermissions = permissionType
            }
          }
          if (block.tool_call?.id) {
            updatedPermissionIds.push(block.tool_call.id)
          }
        }
      }

      console.log(
        `[PermissionHandler] Batch updated ${updatedPermissionIds.length} permission blocks for server '${serverName}':`,
        updatedPermissionIds
      )

      const generatingState = this.generatingMessages.get(messageId)
      if (generatingState) {
        for (let i = 0; i < generatingState.message.content.length; i++) {
          const block = generatingState.message.content[i]
          if (
            block.type === 'action' &&
            block.action_type === 'tool_call_permission' &&
            block.status === 'pending' &&
            block.extra?.serverName === serverName
          ) {
            generatingState.message.content[i] = {
              ...block,
              status: granted ? 'granted' : 'denied',
              extra: block.extra
                ? {
                    ...block.extra,
                    needsUserAction: false,
                    ...(granted && { grantedPermissions: permissionType })
                  }
                : undefined
            }
          }
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
        presenter.sessionManager.clearPendingPermission(message.conversationId)
        presenter.sessionManager.setStatus(message.conversationId, 'generating')
        return
      }

      if (permissionType === 'command') {
        if (granted) {
          const conversationId = message.conversationId
          const command = this.getCommandFromPermissionBlock(permissionBlock)
          if (!command) {
            throw new Error(`Unable to extract command from permission block (${messageId})`)
          }
          const signature = this.commandPermissionHandler.extractCommandSignature(command)
          this.commandPermissionHandler.approve(conversationId, signature, remember)
          await this.restartAgentLoopAfterPermission(messageId, toolCallId)
        } else {
          await this.continueAfterPermissionDenied(messageId, permissionBlock)
        }
        return
      }

      if (granted) {
        const serverName = permissionBlock?.extra?.serverName as string
        if (!serverName) {
          throw new Error(`Server name not found in permission block (${messageId})`)
        }

        if (serverName === 'agent-filesystem') {
          const paths = this.getStringArrayFromObject(parsedPermissionRequest, 'paths')
          if (paths.length === 0) {
            console.warn('[PermissionHandler] Missing filesystem paths in permission request')
            await this.continueAfterPermissionDenied(messageId, permissionBlock)
            return
          }
          presenter.filePermissionService?.approve(message.conversationId, paths, remember)
          await this.restartAgentLoopAfterPermission(messageId, toolCallId)
          return
        }

        if (serverName === 'deepchat-settings') {
          const toolName =
            this.getStringFromObject(parsedPermissionRequest, 'toolName') ||
            this.getStringFromObject(permissionBlock.extra as Record<string, unknown>, 'toolName')
          if (!toolName) {
            console.warn('[PermissionHandler] Missing tool name in settings permission request')
            await this.continueAfterPermissionDenied(messageId, permissionBlock)
            return
          }
          presenter.settingsPermissionService?.approve(message.conversationId, toolName, remember)
          await this.restartAgentLoopAfterPermission(messageId, toolCallId)
          return
        }

        try {
          await this.getMcpPresenter().grantPermission(
            serverName,
            permissionType,
            remember,
            message.conversationId
          )
          await this.waitForMcpServiceReady(serverName)
        } catch (error) {
          permissionBlock.status = 'error'
          await this.ctx.messageManager.editMessage(messageId, JSON.stringify(content))
          throw error
        }

        await this.restartAgentLoopAfterPermission(messageId, toolCallId)
      } else {
        await this.continueAfterPermissionDenied(messageId, permissionBlock)
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

  async restartAgentLoopAfterPermission(messageId: string, toolCallId?: string): Promise<void> {
    console.log('[PermissionHandler] Restarting agent loop after permission', messageId)

    try {
      const message = await this.ctx.messageManager.getMessage(messageId)
      if (!message) {
        throw new Error(`Message not found (${messageId})`)
      }

      const conversationId = message.conversationId
      await presenter.sessionManager.startLoop(conversationId, messageId)
      const content = message.content as AssistantMessageBlock[]

      const permissionBlock = content.find(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'tool_call_permission' &&
          block.tool_call?.id === toolCallId
      )

      if (permissionBlock?.extra?.serverName) {
        try {
          const servers = await this.ctx.configPresenter.getMcpServers()
          const serverConfig = servers[permissionBlock.extra.serverName as string]
          console.log('[PermissionHandler] Server permissions:', serverConfig?.autoApprove || [])
        } catch (configError) {
          console.warn('[PermissionHandler] Failed to verify server permissions:', configError)
        }
      }

      if (!permissionBlock) {
        console.warn('[PermissionHandler] Granted permission block missing; continuing', messageId)
      }

      const pendingToolCallFromPermission =
        this.buildPendingToolCallFromPermissionBlock(permissionBlock)
      const pendingToolCallFromId = toolCallId
        ? this.buildPendingToolCallFromToolCallId(content, toolCallId)
        : undefined
      const fallbackPendingToolCall =
        pendingToolCallFromPermission ??
        pendingToolCallFromId ??
        this.findPendingToolCallAfterPermission(content)

      // Find all granted pending tool calls for batch execution
      const allPendingToolCalls = this.findAllPendingToolCallsAfterPermission(content)
      const firstPendingToolCall = allPendingToolCalls[0] ?? fallbackPendingToolCall

      const state = this.generatingMessages.get(messageId)
      if (state) {
        if (!state.pendingToolCall && firstPendingToolCall) {
          state.pendingToolCall = firstPendingToolCall
        }
        if (state.pendingToolCall) {
          await this.resumeAfterPermissionWithPendingToolCall(
            state,
            message as AssistantMessage,
            conversationId,
            allPendingToolCalls.slice(1)
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
        pendingToolCall: firstPendingToolCall
      })

      if (firstPendingToolCall) {
        const newState = this.generatingMessages.get(messageId)!
        await this.resumeAfterPermissionWithPendingToolCall(
          newState,
          message as AssistantMessage,
          conversationId,
          allPendingToolCalls.slice(1)
        )
      } else {
        await this.streamGenerationHandler.startStreamCompletion(conversationId, messageId)
      }
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

  async continueAfterPermissionDenied(
    messageId: string,
    resolvedPermissionBlock?: AssistantMessageBlock
  ): Promise<void> {
    console.log('[PermissionHandler] Continuing after permission denied', messageId)

    try {
      const message = await this.ctx.messageManager.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        throw new Error(`Message not found or not assistant (${messageId})`)
      }

      const conversationId = message.conversationId
      await presenter.sessionManager.startLoop(conversationId, messageId)
      const content = message.content as AssistantMessageBlock[]
      const deniedPermissionBlock =
        resolvedPermissionBlock ||
        content.find(
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
      const errorMessage = 'User denied the request.'

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

      await this.llmEventHandler.handleLLMAgentResponse({
        eventId: messageId,
        tool_call: 'error',
        tool_call_id: toolCall.id,
        tool_call_name: toolCall.name,
        tool_call_params: toolCall.params,
        tool_call_response: errorMessage,
        tool_call_server_name: toolCall.server_name,
        tool_call_server_icons: toolCall.server_icons,
        tool_call_server_description: toolCall.server_description
      } as any)

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
      await presenter.sessionManager.startLoop(conversationId, messageId)
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
    conversationId: string,
    remainingToolCalls: PendingToolCall[] = []
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
        const { chatMode, agentWorkspacePath } =
          await presenter.sessionManager.resolveWorkspaceContext(
            conversationId,
            conversation.settings.modelId
          )
        const toolDefinitions = await this.getToolPresenter().getAllToolDefinitions({
          enabledMcpTools,
          chatMode,
          supportsVision: false,
          agentWorkspacePath,
          conversationId
        })
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

      const resolvedServer = toolDef?.server
      await this.llmEventHandler.handleLLMAgentResponse({
        eventId: message.id,
        tool_call: 'running',
        tool_call_id: pendingToolCall.id,
        tool_call_name: pendingToolCall.name,
        tool_call_params: pendingToolCall.params,
        tool_call_server_name: resolvedServer?.name || pendingToolCall.serverName,
        tool_call_server_icons: resolvedServer?.icons || pendingToolCall.serverIcons,
        tool_call_server_description:
          resolvedServer?.description || pendingToolCall.serverDescription
      } as any)

      let toolContent = ''
      let toolRawData: MCPToolResponse | null = null
      try {
        const toolCallResult = await this.getToolPresenter().callTool({
          id: pendingToolCall.id,
          type: 'function',
          function: {
            name: pendingToolCall.name,
            arguments: pendingToolCall.params
          },
          server: resolvedServer,
          conversationId
        })
        toolContent =
          typeof toolCallResult.content === 'string'
            ? toolCallResult.content
            : JSON.stringify(toolCallResult.content)
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
          tool_call_server_name: resolvedServer?.name || pendingToolCall.serverName,
          tool_call_server_icons: resolvedServer?.icons || pendingToolCall.serverIcons,
          tool_call_server_description:
            resolvedServer?.description || pendingToolCall.serverDescription
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
          tool_call_server_name:
            toolRawData.permissionRequest?.serverName ||
            resolvedServer?.name ||
            pendingToolCall.serverName,
          tool_call_server_icons: resolvedServer?.icons || pendingToolCall.serverIcons,
          tool_call_server_description:
            resolvedServer?.description || pendingToolCall.serverDescription,
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
        tool_call_server_name: resolvedServer?.name || pendingToolCall.serverName,
        tool_call_server_icons: resolvedServer?.icons || pendingToolCall.serverIcons,
        tool_call_server_description:
          resolvedServer?.description || pendingToolCall.serverDescription,
        tool_call_response_raw: toolRawData ?? undefined
      } as any)

      state.pendingToolCall = undefined

      // Check if there are remaining tool calls to execute in batch
      if (remainingToolCalls.length > 0) {
        console.log(
          `[PermissionHandler] Continuing with ${remainingToolCalls.length} remaining tool calls in batch`
        )
        state.pendingToolCall = remainingToolCalls[0]
        await this.resumeAfterPermissionWithPendingToolCall(
          state,
          message,
          conversationId,
          remainingToolCalls.slice(1)
        )
        return
      }

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

    return this.buildPendingToolCallFromPermissionBlock(grantedPermissionBlock)
  }

  /**
   * Find all granted pending tool calls after permission is granted
   * This supports batch execution of multiple tool calls that were all authorized
   */
  findAllPendingToolCallsAfterPermission(content: AssistantMessageBlock[]): PendingToolCall[] {
    const grantedBlocks: AssistantMessageBlock[] = []

    for (const block of content) {
      if (
        block.type === 'action' &&
        block.action_type === 'tool_call_permission' &&
        block.status === 'granted'
      ) {
        grantedBlocks.push(block)
      }
    }

    // Build pending calls maintaining original order
    const pendingCalls: PendingToolCall[] = []
    for (const block of grantedBlocks) {
      const pendingCall = this.buildPendingToolCallFromPermissionBlock(block)
      if (pendingCall) {
        pendingCalls.push(pendingCall)
      }
    }

    console.log(
      `[PermissionHandler] Found ${pendingCalls.length} granted pending tool calls for batch execution`
    )
    return pendingCalls
  }

  private buildPendingToolCallFromPermissionBlock(
    block?: AssistantMessageBlock
  ): PendingToolCall | undefined {
    if (!block?.tool_call) {
      return undefined
    }

    const { id, name, params } = block.tool_call
    if (!id || !name || !params) {
      console.warn('[PermissionHandler] Incomplete tool call info:', block.tool_call)
      return undefined
    }

    return {
      id,
      name,
      params,
      serverName: block.tool_call.server_name,
      serverIcons: block.tool_call.server_icons,
      serverDescription: block.tool_call.server_description
    }
  }

  private buildPendingToolCallFromToolCallId(
    content: AssistantMessageBlock[],
    toolCallId: string
  ): PendingToolCall | undefined {
    const toolCallBlock = content.find(
      (block) => block.type === 'tool_call' && block.tool_call?.id === toolCallId
    )

    if (!toolCallBlock || toolCallBlock.type !== 'tool_call' || !toolCallBlock.tool_call) {
      return undefined
    }

    const { id, name, params } = toolCallBlock.tool_call
    if (!id || !name || !params) {
      console.warn('[PermissionHandler] Incomplete tool call info:', toolCallBlock.tool_call)
      return undefined
    }

    return {
      id,
      name,
      params,
      serverName: toolCallBlock.tool_call.server_name,
      serverIcons: toolCallBlock.tool_call.server_icons,
      serverDescription: toolCallBlock.tool_call.server_description
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

  private getStringArrayFromObject(source: Record<string, unknown> | null, key: string): string[] {
    if (!source) return []
    const value = source[key]
    if (!Array.isArray(value)) return []
    return value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
    )
  }

  private getCommandFromPermissionBlock(block: AssistantMessageBlock): string | undefined {
    const extraCommandInfo = this.getExtraString(block, 'commandInfo')
    if (extraCommandInfo) {
      try {
        const parsed = JSON.parse(extraCommandInfo) as { command?: string }
        if (parsed?.command) {
          return parsed.command
        }
      } catch (error) {
        console.warn('[PermissionHandler] Failed to parse commandInfo:', error)
      }
    }

    const permissionRequest = this.parsePermissionRequest(block)
    const commandFromRequest = this.getStringFromObject(permissionRequest, 'command')
    if (commandFromRequest) {
      return commandFromRequest
    }

    const commandInfoFromRequest = permissionRequest?.commandInfo
    if (commandInfoFromRequest && typeof commandInfoFromRequest === 'object') {
      const commandValue = (commandInfoFromRequest as { command?: unknown }).command
      if (typeof commandValue === 'string') {
        return commandValue
      }
    }

    const params = block.tool_call?.params
    if (typeof params === 'string' && params.trim()) {
      try {
        const parsed = JSON.parse(params) as { command?: string }
        if (typeof parsed.command === 'string') {
          return parsed.command
        }
      } catch {
        // Ignore parse errors; fall through to return undefined.
      }
    }

    console.warn('[PermissionHandler] No command found in permission block')
    return undefined
  }
}
