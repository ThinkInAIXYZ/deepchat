import { presenter } from '@/presenter'
import type { AssistantMessage, AssistantMessageBlock } from '@shared/chat'
import type {
  ILlmProviderPresenter,
  IMCPPresenter,
  IToolPresenter,
  MCPToolDefinition,
  MCPToolResponse
} from '@shared/presenter'
import { buildPostToolExecutionContext, type PendingToolCall } from '../message/messageBuilder'
import type { GeneratingMessageState } from '../streaming/types'
import type { StreamGenerationHandler } from '../streaming/streamGenerationHandler'
import type { LLMEventHandler } from '../streaming/llmEventHandler'
import { BaseHandler, type ThreadHandlerContext } from '../../searchPresenter/handlers/baseHandler'
import { CommandPermissionService } from '../../permission/commandPermissionService'
import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'

// Permission level hierarchy: all > write > read
// 'command' is a special type that only matches itself
const PERMISSION_LEVELS: Record<string, number> = {
  all: 3,
  write: 2,
  read: 1,
  command: 0 // command only matches command (exact match required)
}

function isPermissionSufficient(granted: string, required: string): boolean {
  // Special case: command permission only applies to command-type permissions
  if (granted === 'command' || required === 'command') {
    return granted === required
  }
  return (PERMISSION_LEVELS[granted] || 0) >= (PERMISSION_LEVELS[required] || 0)
}

function canBatchUpdate(
  targetPermission: AssistantMessageBlock,
  grantedPermission: AssistantMessageBlock,
  grantedPermissionType: string
): boolean {
  if (targetPermission.status !== 'pending') return false
  if (targetPermission.action_type !== 'tool_call_permission') return false

  const targetServerName = targetPermission.extra?.serverName as string
  const grantedServerName = grantedPermission.extra?.serverName as string

  // Must be same server
  if (targetServerName !== grantedServerName) return false

  // CRITICAL FIX: Only batch the exact same tool call (same tool_call.id)
  // This ensures user approval of one tool doesn't auto-approve other tools from the same server
  if (targetPermission.tool_call?.id !== grantedPermission.tool_call?.id) return false

  // Check permission type hierarchy
  const targetPermissionType = (targetPermission.extra?.permissionType as string) || 'read'
  if (!isPermissionSufficient(grantedPermissionType, targetPermissionType)) return false

  // For special permission types, still require exact tool call matching (already checked above)
  const targetType = targetPermission.extra?.permissionType as string
  if (
    targetType === 'command' ||
    targetServerName === 'agent-filesystem' ||
    targetServerName === 'deepchat-settings'
  ) {
    // Additional safety: these types should never be batched across different tool calls
    return targetPermission.tool_call?.id === grantedPermission.tool_call?.id
  }

  return true
}

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

      const conversationId = message.conversationId

      // Step 1: Update permission blocks status (separate from resume)
      const { updatedCount, targetPermissionBlock } = await this.updatePermissionBlocks(
        messageId,
        toolCallId,
        granted,
        permissionType
      )

      console.log(`[PermissionHandler] Updated ${updatedCount} permission block(s)`)

      // Debug: if updatedCount is 0, print details
      if (updatedCount === 0) {
        const content = message.content as AssistantMessageBlock[]
        const pendingBlocks = content.filter(
          (b) =>
            b.type === 'action' &&
            b.action_type === 'tool_call_permission' &&
            b.status === 'pending'
        )
        console.log(
          '[PermissionHandler] Debug - All pending permission blocks:',
          pendingBlocks.map((b) => ({
            toolCallId: b.tool_call?.id,
            status: b.status,
            serverName: b.extra?.serverName
          }))
        )
        console.log('[PermissionHandler] Debug - Looking for toolCallId:', toolCallId)
      }

      // Step 2: Remove this permission from pending list (only if we actually updated something)
      if (updatedCount > 0) {
        presenter.sessionManager.removePendingPermission(conversationId, messageId, toolCallId)
      } else {
        console.warn(
          '[PermissionHandler] No permission blocks were updated, skipping removal from pending list'
        )
        // Still need to notify frontend to refresh in case there's a mismatch
        this.notifyFrontendPermissionUpdate(conversationId, messageId)
        return
      }

      // Step 3: Check if this is ACP permission (special handling)
      if (targetPermissionBlock) {
        const parsedPermissionRequest = this.parsePermissionRequest(targetPermissionBlock)
        const isAcpPermission = this.isAcpPermissionBlock(
          targetPermissionBlock,
          parsedPermissionRequest
        )

        if (isAcpPermission) {
          await this.handleAcpPermissionFlow(
            messageId,
            targetPermissionBlock,
            parsedPermissionRequest,
            granted
          )
          presenter.sessionManager.clearPendingPermission(conversationId)
          presenter.sessionManager.setStatus(conversationId, 'generating')
          return
        }
      }

      // Step 4: Handle specific permission types (command, agent-filesystem, deepchat-settings)
      if (targetPermissionBlock && permissionType === 'command') {
        if (granted) {
          const command = this.getCommandFromPermissionBlock(targetPermissionBlock)
          if (!command) {
            throw new Error(`Unable to extract command from permission block (${messageId})`)
          }
          const signature = this.commandPermissionHandler.extractCommandSignature(command)
          this.commandPermissionHandler.approve(conversationId, signature, remember)
        }
        // Continue to check for resume (don't return early)
      } else if (targetPermissionBlock && granted && permissionType !== 'command') {
        const serverName = targetPermissionBlock?.extra?.serverName as string
        if (!serverName) {
          throw new Error(`Server name not found in permission block (${messageId})`)
        }

        if (serverName === 'agent-filesystem') {
          const parsedPermissionRequest = this.parsePermissionRequest(targetPermissionBlock)
          const paths = this.getStringArrayFromObject(parsedPermissionRequest, 'paths')
          if (paths.length === 0) {
            console.warn('[PermissionHandler] Missing filesystem paths in permission request')
            // Mark as denied and continue
            await this.updatePermissionBlocks(messageId, toolCallId, false, permissionType)
          } else {
            presenter.filePermissionService?.approve(conversationId, paths, remember)
          }
        } else if (serverName === 'deepchat-settings') {
          const parsedPermissionRequest = this.parsePermissionRequest(targetPermissionBlock)
          const toolName =
            this.getStringFromObject(parsedPermissionRequest, 'toolName') ||
            this.getStringFromObject(
              targetPermissionBlock.extra as Record<string, unknown>,
              'toolName'
            )
          if (!toolName) {
            console.warn('[PermissionHandler] Missing tool name in settings permission request')
            await this.updatePermissionBlocks(messageId, toolCallId, false, permissionType)
          } else {
            presenter.settingsPermissionService?.approve(conversationId, toolName, remember)
          }
        } else {
          // MCP server permission
          try {
            await this.getMcpPresenter().grantPermission(
              serverName,
              permissionType,
              remember,
              conversationId
            )
            await this.waitForMcpServiceReady(serverName)
          } catch (error) {
            console.error('[PermissionHandler] Failed to grant MCP permission:', error)
            throw error
          }
        }
      }

      // Step 5: Check if there are still pending permissions in this message
      const hasPendingPermissions = await this.hasPendingPermissionsInMessage(messageId)
      if (hasPendingPermissions) {
        console.log(
          '[PermissionHandler] Still has pending permissions, waiting for all to be resolved'
        )
        // Notify frontend to refresh permission UI (show next pending permission)
        this.notifyFrontendPermissionUpdate(conversationId, messageId)
        return
      }

      // Step 6: All permissions resolved - try to acquire resume lock and execute
      const lockAcquired = presenter.sessionManager.acquirePermissionResumeLock(
        conversationId,
        messageId
      )
      if (!lockAcquired) {
        console.log('[PermissionHandler] Resume already in progress for this message, skipping')
        return
      }

      // Step 7: Resume tool execution (idempotent - only one resume per message)
      // Resume all resolved tool calls in this message (granted and denied handling)
      // CRITICAL: Lock is released inside resumeToolExecutionAfterPermissions (success or error)
      await this.resumeToolExecutionAfterPermissions(messageId, granted)
    } catch (error) {
      console.error('[PermissionHandler] Failed to handle permission response:', error)

      // CRITICAL: Ensure lock is released on error (belt-and-suspenders approach)
      try {
        const conversationId = await this.getConversationIdFromMessage(messageId)
        if (conversationId) {
          presenter.sessionManager.releasePermissionResumeLock(conversationId)
        }
      } catch (lockError) {
        console.warn('[PermissionHandler] Failed to release lock during error handling:', lockError)
      }

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

  /**
   * Update permission block(s) status
   * Returns the number of updated blocks and the target permission block
   */
  private async updatePermissionBlocks(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: string
  ): Promise<{ updatedCount: number; targetPermissionBlock: AssistantMessageBlock | undefined }> {
    const message = await this.ctx.messageManager.getMessage(messageId)
    if (!message || message.role !== 'assistant') {
      throw new Error(`Message not found or not assistant message (${messageId})`)
    }

    const content = message.content as AssistantMessageBlock[]
    const targetPermissionBlock = content.find(
      (block) =>
        block.type === 'action' &&
        block.action_type === 'tool_call_permission' &&
        block.tool_call?.id === toolCallId
    )

    if (!targetPermissionBlock) {
      throw new Error(
        `Permission block not found (messageId: ${messageId}, toolCallId: ${toolCallId})`
      )
    }

    let updatedCount = 0

    // Batch update: only update blocks that can be safely batched
    for (const block of content) {
      if (canBatchUpdate(block, targetPermissionBlock, permissionType)) {
        block.status = granted ? 'granted' : 'denied'
        if (block.extra) {
          block.extra.needsUserAction = false
          if (granted) {
            // Only store valid MCP permission types; 'command' is handled separately
            if (
              permissionType === 'read' ||
              permissionType === 'write' ||
              permissionType === 'all'
            ) {
              block.extra.grantedPermissions = permissionType
            }
          }
        }
        updatedCount++
      }
    }

    // Update generating state snapshot
    const generatingState = this.generatingMessages.get(messageId)
    if (generatingState) {
      for (let i = 0; i < generatingState.message.content.length; i++) {
        const block = generatingState.message.content[i]
        if (
          block.type === 'action' &&
          block.action_type === 'tool_call_permission' &&
          block.status === 'pending'
        ) {
          // Check if this block was updated in the main content
          const updatedBlock = content.find(
            (b) =>
              b.type === 'action' &&
              b.action_type === 'tool_call_permission' &&
              b.tool_call?.id === block.tool_call?.id
          )
          if (updatedBlock && updatedBlock.status !== 'pending') {
            generatingState.message.content[i] = {
              ...block,
              status: updatedBlock.status,
              extra: updatedBlock.extra
            }
          }
        }
      }
    }

    await this.ctx.messageManager.editMessage(messageId, JSON.stringify(content))

    return { updatedCount, targetPermissionBlock }
  }

  /**
   * Resume stream completion when no tools need to be executed
   */
  private async resumeStreamCompletion(conversationId: string, messageId: string): Promise<void> {
    // Use streamGenerationHandler's startStreamCompletion which handles the full context
    await this.streamGenerationHandler.startStreamCompletion(conversationId, messageId)
  }

  /**
   * Check if there are still pending permissions in the message
   */
  private async hasPendingPermissionsInMessage(messageId: string): Promise<boolean> {
    const message = await this.ctx.messageManager.getMessage(messageId)
    if (!message || message.role !== 'assistant') {
      return false
    }

    const content = message.content as AssistantMessageBlock[]
    return content.some(
      (block) =>
        block.type === 'action' &&
        block.action_type === 'tool_call_permission' &&
        block.status === 'pending'
    )
  }

  /**
   * Get conversation ID from message ID
   */
  private async getConversationIdFromMessage(messageId: string): Promise<string | null> {
    const message = await this.ctx.messageManager.getMessage(messageId)
    if (!message) {
      return null
    }
    return message.conversationId
  }

  /**
   * Resume tool execution after permission is granted
   * CRITICAL SECTION: Lock is held throughout the entire resume flow
   * - Early-exit checks prevent stale execution
   * - Synchronous flush before executing tools
   * - Lock released only at single exit point
   * - All tools executed atomically (no lock release between tools)
   */
  private async resumeToolExecutionAfterPermissions(
    messageId: string,
    _lastGranted: boolean,
    grantedToolCallId?: string
  ): Promise<void> {
    console.log(
      '[PermissionHandler] Resuming tool execution after permissions',
      messageId,
      'grantedToolCallId:',
      grantedToolCallId
    )

    const conversationId = await this.getConversationIdFromMessage(messageId)
    if (!conversationId) {
      throw new Error(`Message not found (${messageId})`)
    }

    // CRITICAL SECTION: Lock must be held throughout this entire method
    // Early-exit checks: Validate session state before proceeding
    const session = presenter.sessionManager.getSession(conversationId)
    if (!session) {
      console.warn('[PermissionHandler] Session not found, skipping resume:', conversationId)
      presenter.sessionManager.releasePermissionResumeLock(conversationId)
      return
    }

    // Verify the lock is still valid (same message)
    const currentLock = presenter.sessionManager.getPermissionResumeLock(conversationId)
    if (!currentLock || currentLock.messageId !== messageId) {
      console.warn(
        '[PermissionHandler] Lock mismatch or expired, skipping resume. Expected:',
        messageId,
        'Got:',
        currentLock?.messageId
      )
      // CRITICAL: Always release lock if we don't proceed - it was acquired in handlePermissionResponse
      if (currentLock) {
        presenter.sessionManager.releasePermissionResumeLock(conversationId)
      }
      return
    }

    // Ensure status is appropriate for tool execution
    // Transition from waiting_permission to generating since we're resuming
    const currentStatus = presenter.sessionManager.getStatus(conversationId)
    if (currentStatus === 'waiting_permission') {
      console.log('[PermissionHandler] Transitioning session from waiting_permission to generating')
      presenter.sessionManager.setStatus(conversationId, 'generating')
    } else if (currentStatus !== 'generating') {
      console.warn(
        '[PermissionHandler] Session status not suitable for resume. Status:',
        currentStatus
      )
      presenter.sessionManager.releasePermissionResumeLock(conversationId)
      return
    }

    try {
      // Step 1: Start the agent loop with pending permissions preservation
      // skipLockAcquisition: PermissionHandler already holds the lock
      await presenter.sessionManager.startLoop(conversationId, messageId, {
        preservePendingPermissions: true,
        skipLockAcquisition: true
      })

      // Step 2: Re-fetch message to get updated permission block statuses
      const updatedMessage = await this.ctx.messageManager.getMessage(messageId)
      if (!updatedMessage) {
        throw new Error(`Message not found after permission update (${messageId})`)
      }

      // Step 3: Get tool calls to execute
      const toolCallsToExecute = this.getToolCallsToExecute(
        updatedMessage.content as AssistantMessageBlock[],
        grantedToolCallId
      )

      if (toolCallsToExecute.length === 0) {
        console.log(
          '[PermissionHandler] No tool calls to execute, continuing with stream completion'
        )
        await this.resumeStreamCompletion(conversationId, messageId)
        // SINGLE EXIT POINT: Release lock
        presenter.sessionManager.releasePermissionResumeLock(conversationId)
        return
      }

      // Step 4: Set up generating state
      let state = this.generatingMessages.get(messageId)
      if (!state) {
        state = {
          message: updatedMessage as AssistantMessage,
          conversationId,
          startTime: Date.now(),
          firstTokenTime: null,
          promptTokens: 0,
          reasoningStartTime: null,
          reasoningEndTime: null,
          lastReasoningTime: null
        }
        this.generatingMessages.set(messageId, state)
      } else {
        // CRITICAL FIX: Sync state.message.content with database to ensure tool_call blocks
        // created by the frontend are available for processToolCallEnd to update
        state.message.content = (updatedMessage as AssistantMessage).content
      }

      // Step 5: SYNCHRONOUS FLUSH before executing tools
      // This ensures all pending UI updates are persisted to DB before tool execution
      await this.llmEventHandler.flushStreamUpdates(messageId)

      // Step 6: Execute tools sequentially (lock held throughout - NO RELEASE BETWEEN TOOLS)
      let hasNewPermissionRequest = false
      for (const toolCall of toolCallsToExecute) {
        const canContinue = await this.executeSingleToolCall(state, toolCall, conversationId)

        if (!canContinue) {
          // Permission required again - but we keep the lock until end of critical section
          hasNewPermissionRequest = true
          break
        }
      }

      // Step 7: Check if there are still pending permissions
      const stillHasPending = await this.hasPendingPermissionsInMessage(messageId)
      if (stillHasPending || hasNewPermissionRequest) {
        console.log(
          '[PermissionHandler] Tool(s) executed but more permissions pending, releasing lock and waiting'
        )
        // SINGLE EXIT POINT: Release lock
        presenter.sessionManager.releasePermissionResumeLock(conversationId)
        this.notifyFrontendPermissionUpdate(conversationId, messageId)
        return
      }

      // Step 8: All permissions resolved, continue with stream completion
      await this.continueAfterToolsExecuted(state, conversationId, messageId)
      // SINGLE EXIT POINT: Release lock after successful completion
      presenter.sessionManager.releasePermissionResumeLock(conversationId)
    } catch (error) {
      console.error('[PermissionHandler] Failed to resume tool execution:', error)
      this.generatingMessages.delete(messageId)

      try {
        const message = await this.ctx.messageManager.getMessage(messageId)
        if (message) {
          await this.ctx.messageManager.handleMessageError(messageId, String(error))
        }
      } catch (updateError) {
        console.error('[PermissionHandler] Failed to update message error status:', updateError)
      }

      // SINGLE EXIT POINT: Ensure lock is released on error
      presenter.sessionManager.releasePermissionResumeLock(conversationId)
      throw error
    }
  }

  /**
   * Get tool calls that should be executed
   * If specificToolCallId is provided, only returns that specific tool call
   * Otherwise returns all granted tool calls
   */
  private getToolCallsToExecute(
    content: AssistantMessageBlock[],
    specificToolCallId?: string
  ): PendingToolCall[] {
    const toolCalls: PendingToolCall[] = []

    for (const block of content) {
      if (block.type !== 'tool_call' || !block.tool_call) continue

      const toolCallId = block.tool_call.id
      if (!toolCallId) continue
      // Only resume unfinished tool calls.
      // Completed blocks (success/error) are historical records and must not be re-executed.
      if (block.status !== 'loading') continue

      // If specific tool call ID is specified, only process that one
      if (specificToolCallId && toolCallId !== specificToolCallId) {
        continue
      }

      // Find the associated permission block
      const permissionBlock = content.find(
        (b) =>
          b.type === 'action' &&
          b.action_type === 'tool_call_permission' &&
          b.tool_call?.id === toolCallId
      )

      // If there's a permission block, check its status
      if (permissionBlock) {
        if (permissionBlock.status === 'granted') {
          const pendingCall = this.buildPendingToolCallFromBlock(block)
          if (pendingCall) toolCalls.push(pendingCall)
        } else if (permissionBlock.status === 'denied') {
          // Denied - will generate error response later
          const pendingCall = this.buildPendingToolCallFromBlock(block)
          if (pendingCall) {
            toolCalls.push({ ...pendingCall, denied: true } as PendingToolCall)
          }
        }
        // If pending, skip (should not happen after permission resolution)
      } else {
        // No permission block needed - execute directly
        const pendingCall = this.buildPendingToolCallFromBlock(block)
        if (pendingCall) toolCalls.push(pendingCall)
      }
    }

    console.log(
      `[PermissionHandler] Found ${toolCalls.length} tool calls to execute` +
        (specificToolCallId ? ` (specific: ${specificToolCallId})` : ' (all granted)')
    )
    return toolCalls
  }

  private buildPendingToolCallFromBlock(block: AssistantMessageBlock): PendingToolCall | undefined {
    if (!block.tool_call) return undefined

    const { id, name, params } = block.tool_call
    if (!id || !name) {
      console.warn('[PermissionHandler] Incomplete tool call info:', block.tool_call)
      return undefined
    }

    return {
      id,
      name,
      params: params || '{}',
      serverName: block.tool_call.server_name,
      serverIcons: block.tool_call.server_icons,
      serverDescription: block.tool_call.server_description
    }
  }

  /**
   * Execute a single tool call
   * Returns false if permission is required again
   */
  private async executeSingleToolCall(
    state: GeneratingMessageState,
    toolCall: PendingToolCall,
    conversationId: string
  ): Promise<boolean> {
    // Check if this tool was denied
    const message = await this.ctx.messageManager.getMessage(state.message.id)
    const content = message.content as AssistantMessageBlock[]
    const permissionBlock = content.find(
      (b) =>
        b.type === 'action' &&
        b.action_type === 'tool_call_permission' &&
        b.tool_call?.id === toolCall.id
    )

    if (permissionBlock?.status === 'denied') {
      // Generate error response for denied tool
      await this.llmEventHandler.handleLLMAgentResponse({
        eventId: state.message.id,
        tool_call: 'error',
        tool_call_id: toolCall.id,
        tool_call_name: toolCall.name,
        tool_call_params: toolCall.params,
        tool_call_response: 'User denied the request.',
        tool_call_server_name: toolCall.serverName,
        tool_call_server_icons: toolCall.serverIcons,
        tool_call_server_description: toolCall.serverDescription
      } as any)
      return true
    }

    // Normal tool execution
    try {
      const { conversation } = await this.streamGenerationHandler.prepareConversationContext(
        conversationId,
        state.message.id
      )

      let toolDef: MCPToolDefinition | undefined
      try {
        const { chatMode, agentWorkspacePath } =
          await presenter.sessionManager.resolveWorkspaceContext(
            conversationId,
            conversation.settings.modelId
          )
        const toolDefinitions = await this.getToolPresenter().getAllToolDefinitions({
          enabledMcpTools: conversation.settings.enabledMcpTools,
          chatMode,
          supportsVision: false,
          agentWorkspacePath,
          conversationId
        })
        toolDef = toolDefinitions.find((definition) => {
          if (definition.function.name !== toolCall.name) return false
          if (toolCall.serverName) {
            return definition.server.name === toolCall.serverName
          }
          return true
        })
      } catch (error) {
        console.error('[PermissionHandler] Failed to load tool definitions:', error)
      }

      if (!toolDef) {
        console.warn('[PermissionHandler] Tool definition not found:', toolCall.name)
        return true // Continue with next tool
      }

      const resolvedServer = toolDef.server

      // Emit running state
      await this.llmEventHandler.handleLLMAgentResponse({
        eventId: state.message.id,
        tool_call: 'running',
        tool_call_id: toolCall.id,
        tool_call_name: toolCall.name,
        tool_call_params: toolCall.params,
        tool_call_server_name: resolvedServer?.name || toolCall.serverName,
        tool_call_server_icons: resolvedServer?.icons || toolCall.serverIcons,
        tool_call_server_description: resolvedServer?.description || toolCall.serverDescription
      } as any)

      // Execute tool
      let toolContent = ''
      let toolRawData: MCPToolResponse | null = null
      try {
        const toolCallResult = await this.getToolPresenter().callTool({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: toolCall.params
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
        console.error('[PermissionHandler] Failed to execute tool:', toolError)
        await this.llmEventHandler.handleLLMAgentResponse({
          eventId: state.message.id,
          tool_call: 'error',
          tool_call_id: toolCall.id,
          tool_call_name: toolCall.name,
          tool_call_params: toolCall.params,
          tool_call_response: toolError instanceof Error ? toolError.message : String(toolError),
          tool_call_server_name: resolvedServer?.name || toolCall.serverName,
          tool_call_server_icons: resolvedServer?.icons || toolCall.serverIcons,
          tool_call_server_description: resolvedServer?.description || toolCall.serverDescription
        } as any)
        return true // Continue with next tool
      }

      // Check if permission is required again
      if (toolRawData?.requiresPermission) {
        // Add this permission to pending list and set session status
        presenter.sessionManager.addPendingPermission(conversationId, {
          messageId: state.message.id,
          toolCallId: toolCall.id,
          permissionType:
            (toolRawData.permissionRequest?.permissionType as
              | 'read'
              | 'write'
              | 'all'
              | 'command') || 'read',
          payload: toolRawData.permissionRequest ?? {}
        })
        presenter.sessionManager.setStatus(conversationId, 'waiting_permission')

        await this.llmEventHandler.handleLLMAgentResponse({
          eventId: state.message.id,
          tool_call: 'permission-required',
          tool_call_id: toolCall.id,
          tool_call_name: toolCall.name,
          tool_call_params: toolCall.params,
          tool_call_server_name:
            toolRawData.permissionRequest?.serverName ||
            resolvedServer?.name ||
            toolCall.serverName,
          tool_call_server_icons: resolvedServer?.icons || toolCall.serverIcons,
          tool_call_server_description: resolvedServer?.description || toolCall.serverDescription,
          tool_call_response: toolContent,
          permission_request: toolRawData.permissionRequest
        } as any)
        return false // Stop execution, permission required
      }

      // Tool completed successfully
      await this.llmEventHandler.handleLLMAgentResponse({
        eventId: state.message.id,
        tool_call: 'end',
        tool_call_id: toolCall.id,
        tool_call_name: toolCall.name,
        tool_call_params: toolCall.params,
        tool_call_response: toolContent,
        tool_call_server_name: resolvedServer?.name || toolCall.serverName,
        tool_call_server_icons: resolvedServer?.icons || toolCall.serverIcons,
        tool_call_server_description: resolvedServer?.description || toolCall.serverDescription,
        tool_call_response_raw: toolRawData ?? undefined
      } as any)

      return true
    } catch (error) {
      console.error('[PermissionHandler] Error executing single tool call:', error)
      return true // Continue with next tool
    }
  }

  /**
   * Continue with model generation after all tools are executed
   */
  private async continueAfterToolsExecuted(
    _state: GeneratingMessageState,
    conversationId: string,
    messageId: string
  ): Promise<void> {
    // Simplified: use streamGenerationHandler which handles full context
    await this.streamGenerationHandler.startStreamCompletion(conversationId, messageId)
  }

  /**
   * Restart agent loop after permission is granted
   * UNIFIED FLOW: Uses resumeToolExecutionAfterPermissions for all cases
   */
  async restartAgentLoopAfterPermission(messageId: string, toolCallId?: string): Promise<void> {
    console.log('[PermissionHandler] Restarting agent loop after permission', messageId)

    try {
      const message = await this.ctx.messageManager.getMessage(messageId)
      if (!message) {
        throw new Error(`Message not found (${messageId})`)
      }

      // const conversationId = message.conversationId

      // Check server permissions for logging/debugging
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

      // UNIFIED FLOW: Use resumeToolExecutionAfterPermissions for all cases
      // This method handles:
      // 1. Setting up the generating state
      // 2. Finding and executing all granted tool calls
      // 3. Continuing with stream completion
      await this.resumeToolExecutionAfterPermissions(messageId, true)
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
      // Permission denied flow: skip lock acquisition (not part of permission resume critical section)
      await presenter.sessionManager.startLoop(conversationId, messageId, {
        preservePendingPermissions: true,
        skipLockAcquisition: true
      })
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

  /**
   * Notify frontend to refresh permission UI
   * Called when a permission is processed and there may be more pending permissions
   */
  private notifyFrontendPermissionUpdate(conversationId: string, messageId: string): void {
    try {
      const pendingPermissions = presenter.sessionManager.getPendingPermissions(conversationId)
      if (pendingPermissions && pendingPermissions.length > 0) {
        console.log('[PermissionHandler] Notifying frontend of permission update:', {
          conversationId,
          messageId,
          remainingCount: pendingPermissions.length,
          nextToolCallId: pendingPermissions[0].toolCallId
        })
        // Send event to all renderer windows to refresh permission UI
        // Frontend should listen to this event and refresh the permission display
        eventBus.sendToRenderer(STREAM_EVENTS.PERMISSION_UPDATED, SendTarget.ALL_WINDOWS, {
          conversationId,
          messageId,
          type: 'permission_update',
          pendingCount: pendingPermissions.length,
          nextPermission: pendingPermissions[0]
        })
      }
    } catch (error) {
      console.error('[PermissionHandler] Failed to notify frontend:', error)
    }
  }
}
