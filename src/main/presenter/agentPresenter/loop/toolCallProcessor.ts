import {
  ChatMessage,
  LLMAgentEvent,
  MCPToolCall,
  MCPToolDefinition,
  MCPToolResponse,
  ModelConfig
} from '@shared/presenter'
import fs from 'fs/promises'
import path from 'path'
import { isNonRetryableError } from './errorClassification'
import { resolveToolOffloadPath } from '../../sessionPresenter/sessionPaths'
import { parseQuestionToolArgs, QUESTION_TOOL_NAME } from '../tools/questionTool'
import { presenter } from '@/presenter'

interface ToolCallProcessorOptions {
  getAllToolDefinitions: (context: ToolCallExecutionContext) => Promise<MCPToolDefinition[]>
  callTool: (request: MCPToolCall) => Promise<{ content: unknown; rawData: MCPToolResponse }>
  preCheckToolPermission?: (request: MCPToolCall) => Promise<PermissionRequestPayload | null>
  onToolCallFinished?: (info: {
    toolName: string
    toolCallId: string
    toolServerName?: string
    conversationId?: string
    status: 'success' | 'error' | 'permission'
  }) => void
}

interface ToolCallExecutionContext {
  eventId: string
  toolCalls: Array<{ id: string; name: string; arguments: string }>
  enabledMcpTools?: string[]
  conversationMessages: ChatMessage[]
  modelConfig: ModelConfig
  providerId?: string
  abortSignal: AbortSignal
  currentToolCallCount: number
  maxToolCalls: number
  conversationId?: string
}

interface ToolCallProcessResult {
  toolCallCount: number
  needContinueConversation: boolean
}

interface ToolCall {
  id: string
  name: string
  arguments: string
}

type PermissionType = 'read' | 'write' | 'all' | 'command'

interface CommandInfoPayload {
  command: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  suggestion: string
  signature?: string
  baseCommand?: string
}

interface PermissionRequestPayload {
  needsPermission: true
  toolName: string
  serverName: string
  permissionType: PermissionType
  description: string
  command?: string
  commandSignature?: string
  commandInfo?: CommandInfoPayload
  paths?: string[]
  providerId?: string
  requestId?: string
  sessionId?: string
  agentId?: string
  agentName?: string
  conversationId?: string
  rememberable?: boolean
  [key: string]: unknown
}

interface PermissionRequestInfo {
  toolCall: ToolCall
  serverName: string
  serverIcons?: string
  serverDescription?: string
  payload: PermissionRequestPayload
}

const TOOL_OUTPUT_OFFLOAD_THRESHOLD = 5000
const TOOL_OUTPUT_PREVIEW_LENGTH = 1024
const QUESTION_ERROR_KEY = 'common.error.invalidQuestionRequest'

// Tools that require offload when output exceeds threshold
// Tools not in this list will never trigger offload (e.g., read has its own pagination)
const TOOLS_REQUIRING_OFFLOAD = new Set(['exec', 'ls', 'find', 'grep', 'yo_browser_cdp_send'])

export class ToolCallProcessor {
  constructor(private readonly options: ToolCallProcessorOptions) {}

  async *process(
    context: ToolCallExecutionContext
  ): AsyncGenerator<LLMAgentEvent, ToolCallProcessResult, void> {
    let toolCallCount = context.currentToolCallCount
    let needContinueConversation = context.toolCalls.length > 0
    const shouldDispatchToolHooks = context.providerId === 'acp'

    let toolDefinitions = await this.options.getAllToolDefinitions(context)

    // Step 1: Pre-check all tool permissions in batch
    // If any tool requires permission, we pause and request permission for all at once
    const permissionCheckResult = await this.batchPreCheckPermissions(context, toolDefinitions)

    if (permissionCheckResult.hasPendingPermissions) {
      // Yield permission request event for all tools that need permission
      for (const permissionRequest of permissionCheckResult.permissionRequests) {
        const permissionPayload = {
          ...permissionRequest.payload,
          toolName: permissionRequest.toolCall.name,
          serverName: permissionRequest.serverName,
          permissionType: permissionRequest.payload.permissionType,
          description: permissionRequest.payload.description,
          conversationId: permissionRequest.payload.conversationId ?? context.conversationId,
          // Mark this as part of a batch
          isBatchPermission: true,
          totalInBatch: permissionCheckResult.permissionRequests.length
        }

        yield {
          type: 'response',
          data: {
            eventId: context.eventId,
            tool_call: 'permission-required',
            tool_call_id: permissionRequest.toolCall.id,
            tool_call_name: permissionRequest.toolCall.name,
            tool_call_params: permissionRequest.toolCall.arguments,
            tool_call_server_name: permissionRequest.serverName,
            tool_call_server_icons: permissionRequest.serverIcons,
            tool_call_server_description: permissionRequest.serverDescription,
            tool_call_response: permissionRequest.payload.description,
            permission_request: permissionPayload
          }
        }
      }

      // Stop here and wait for user to grant permissions
      // The loop will be restarted after permissions are granted
      needContinueConversation = false
      return {
        toolCallCount,
        needContinueConversation
      }
    }

    const resolveToolDefinition = async (
      toolName: string
    ): Promise<MCPToolDefinition | undefined> => {
      const match = toolDefinitions.find((tool) => tool.function.name === toolName)
      if (match) return match
      toolDefinitions = await this.options.getAllToolDefinitions(context)
      return toolDefinitions.find((tool) => tool.function.name === toolName)
    }

    for (const [index, toolCall] of context.toolCalls.entries()) {
      if (context.abortSignal.aborted) break

      if (toolCallCount >= context.maxToolCalls) {
        console.warn('Max tool calls reached during execution phase for event:', context.eventId)
        yield {
          type: 'response',
          data: {
            eventId: context.eventId,
            maximum_tool_calls_reached: true,
            tool_call_id: toolCall.id,
            tool_call_name: toolCall.name
          }
        }

        needContinueConversation = false
        break
      }

      toolCallCount++

      const toolDef = await resolveToolDefinition(toolCall.name)

      if (!toolDef) {
        console.error(`Tool definition not found for ${toolCall.name}. Skipping execution.`)
        const errorMsg = `Tool definition for ${toolCall.name} not found.`
        yield {
          type: 'response',
          data: {
            eventId: context.eventId,
            tool_call: 'error',
            tool_call_id: toolCall.id,
            tool_call_name: toolCall.name,
            tool_call_response: errorMsg
          }
        }

        context.conversationMessages.push({
          role: 'user',
          content: `Error: ${errorMsg}`
        })
        continue
      }

      const notifyToolCallFinished = (status: 'success' | 'error' | 'permission') => {
        if (!this.options.onToolCallFinished) return
        try {
          this.options.onToolCallFinished({
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            toolServerName: toolDef.server?.name,
            conversationId: context.conversationId,
            status
          })
        } catch (error) {
          console.warn('[ToolCallProcessor] onToolCallFinished handler failed:', error)
        }
      }

      const mcpToolInput: MCPToolCall = {
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: toolCall.arguments
        },
        server: toolDef.server,
        conversationId: context.conversationId
      }

      if (toolCall.name === QUESTION_TOOL_NAME) {
        const isStandalone = context.toolCalls.length === 1
        const isLast = index === context.toolCalls.length - 1
        if (!isStandalone || !isLast) {
          notifyToolCallFinished('error')
          this.appendToolError(
            context.conversationMessages,
            context.modelConfig,
            toolCall,
            'Question tool must be the only tool call in a turn.'
          )
          yield {
            type: 'response',
            data: {
              eventId: context.eventId,
              question_error: QUESTION_ERROR_KEY,
              tool_call_id: toolCall.id,
              tool_call_name: toolCall.name
            }
          }
          continue
        }

        const parsedQuestion = parseQuestionToolArgs(toolCall.arguments || '')
        if (!parsedQuestion.success) {
          notifyToolCallFinished('error')
          this.appendToolError(
            context.conversationMessages,
            context.modelConfig,
            toolCall,
            `Invalid question tool arguments: ${parsedQuestion.error}`
          )
          yield {
            type: 'response',
            data: {
              eventId: context.eventId,
              question_error: QUESTION_ERROR_KEY,
              tool_call_id: toolCall.id,
              tool_call_name: toolCall.name
            }
          }
          continue
        }

        notifyToolCallFinished('success')
        yield {
          type: 'response',
          data: {
            eventId: context.eventId,
            tool_call: 'question-required',
            tool_call_id: toolCall.id,
            tool_call_name: toolCall.name,
            tool_call_params: toolCall.arguments,
            tool_call_server_name: toolDef.server.name,
            tool_call_server_icons: toolDef.server.icons,
            tool_call_server_description: toolDef.server.description,
            question_request: parsedQuestion.data
          }
        }

        needContinueConversation = false
        break
      }

      yield {
        type: 'response',
        data: {
          eventId: context.eventId,
          tool_call: 'running',
          tool_call_id: toolCall.id,
          tool_call_name: toolCall.name,
          tool_call_params: toolCall.arguments,
          tool_call_server_name: toolDef.server.name,
          tool_call_server_icons: toolDef.server.icons,
          tool_call_server_description: toolDef.server.description
        }
      }

      try {
        if (shouldDispatchToolHooks) {
          try {
            presenter.hooksNotifications.dispatchEvent('PreToolUse', {
              conversationId: context.conversationId,
              tool: {
                callId: toolCall.id,
                name: toolCall.name,
                params: toolCall.arguments
              }
            })
          } catch (error) {
            console.warn('[ToolCallProcessor] Failed to dispatch PreToolUse hook:', error)
          }
        }

        const toolResponse = await this.options.callTool(mcpToolInput)
        const requiresPermission = Boolean(toolResponse.rawData?.requiresPermission)

        if (requiresPermission) {
          notifyToolCallFinished('permission')
          console.log(
            `[Agent Loop] Permission required for tool ${toolCall.name}, creating permission request`
          )

          yield {
            type: 'response',
            data: {
              eventId: context.eventId,
              tool_call: 'permission-required',
              tool_call_id: toolCall.id,
              tool_call_name: toolCall.name,
              tool_call_params: toolCall.arguments,
              tool_call_server_name: toolResponse.rawData.permissionRequest?.serverName,
              tool_call_server_icons: toolDef.server.icons,
              tool_call_server_description: toolDef.server.description,
              tool_call_response: toolResponse.content,
              permission_request: toolResponse.rawData.permissionRequest
            }
          }

          needContinueConversation = false
          break
        }

        notifyToolCallFinished('success')

        if (context.abortSignal.aborted) break

        const supportsFunctionCall = context.modelConfig?.functionCall || false

        const toolContent = this.stringifyToolContent(toolResponse.content)
        const toolContentForModel = await this.offloadToolContentIfNeeded(
          toolContent,
          toolCall.id,
          context.conversationId,
          toolCall.name
        )

        if (shouldDispatchToolHooks) {
          try {
            presenter.hooksNotifications.dispatchEvent('PostToolUse', {
              conversationId: context.conversationId,
              tool: {
                callId: toolCall.id,
                name: toolCall.name,
                params: toolCall.arguments,
                response: toolContent
              }
            })
          } catch (error) {
            console.warn('[ToolCallProcessor] Failed to dispatch PostToolUse hook:', error)
          }
        }

        if (supportsFunctionCall) {
          this.appendNativeFunctionCallMessages(context.conversationMessages, toolCall, {
            content: toolContentForModel
          })

          yield {
            type: 'response',
            data: {
              eventId: context.eventId,
              tool_call: 'end',
              tool_call_id: toolCall.id,
              tool_call_response: toolContentForModel,
              tool_call_name: toolCall.name,
              tool_call_params: toolCall.arguments,
              tool_call_server_name: toolDef.server.name,
              tool_call_server_icons: toolDef.server.icons,
              tool_call_server_description: toolDef.server.description,
              tool_call_response_raw: toolResponse.rawData
            }
          }
        } else {
          this.appendLegacyFunctionCallMessages(context.conversationMessages, toolCall, {
            content: toolContentForModel
          })

          yield {
            type: 'response',
            data: {
              eventId: context.eventId,
              tool_call: 'end',
              tool_call_id: toolCall.id,
              tool_call_response: toolContentForModel,
              tool_call_name: toolCall.name,
              tool_call_params: toolCall.arguments,
              tool_call_server_name: toolDef.server.name,
              tool_call_server_icons: toolDef.server.icons,
              tool_call_server_description: toolDef.server.description,
              tool_call_response_raw: toolResponse.rawData
            }
          }
        }
      } catch (toolError) {
        notifyToolCallFinished('error')
        if (context.abortSignal.aborted) break

        console.error(
          `Tool execution error for ${toolCall.name} (event ${context.eventId}):`,
          toolError
        )
        const errorMessage = toolError instanceof Error ? toolError.message : String(toolError)

        if (shouldDispatchToolHooks) {
          try {
            presenter.hooksNotifications.dispatchEvent('PostToolUseFailure', {
              conversationId: context.conversationId,
              tool: {
                callId: toolCall.id,
                name: toolCall.name,
                params: toolCall.arguments,
                error: errorMessage
              }
            })
          } catch (error) {
            console.warn('[ToolCallProcessor] Failed to dispatch PostToolUseFailure hook:', error)
          }
        }

        // Check if error is non-retryable (should stop the loop)
        const errorForClassification: Error | string =
          toolError instanceof Error ? toolError : String(toolError)
        const isNonRetryable = isNonRetryableError(errorForClassification)

        this.appendToolError(
          context.conversationMessages,
          context.modelConfig,
          toolCall,
          errorMessage
        )

        yield {
          type: 'response',
          data: {
            eventId: context.eventId,
            tool_call: 'error',
            tool_call_id: toolCall.id,
            tool_call_name: toolCall.name,
            tool_call_params: toolCall.arguments,
            tool_call_response: errorMessage,
            tool_call_server_name: toolDef.server.name,
            tool_call_server_icons: toolDef.server.icons,
            tool_call_server_description: toolDef.server.description
          }
        }

        // If error is non-retryable, stop the loop
        // Otherwise, keep needContinueConversation = true (default) to let LLM decide
        if (isNonRetryable) {
          needContinueConversation = false
          break
        }
        // For retryable errors, continue the loop (needContinueConversation remains true)
      }
    }

    return {
      toolCallCount,
      needContinueConversation
    }
  }

  private appendNativeFunctionCallMessages(
    conversationMessages: ChatMessage[],
    toolCall: { id: string; name: string; arguments: string },
    toolResponse: { content: unknown }
  ): void {
    const lastAssistantMsg = conversationMessages.findLast(
      (message) => message.role === 'assistant'
    )
    if (lastAssistantMsg) {
      if (!lastAssistantMsg.tool_calls) lastAssistantMsg.tool_calls = []
      lastAssistantMsg.tool_calls.push({
        function: {
          arguments: toolCall.arguments,
          name: toolCall.name
        },
        id: toolCall.id,
        type: 'function'
      })
    } else {
      conversationMessages.push({
        role: 'assistant',
        tool_calls: [
          {
            function: {
              arguments: toolCall.arguments,
              name: toolCall.name
            },
            id: toolCall.id,
            type: 'function'
          }
        ]
      })
    }

    const toolContent = this.stringifyToolContent(toolResponse.content)
    conversationMessages.push({
      role: 'tool',
      content: toolContent,
      tool_call_id: toolCall.id
    })
  }

  private appendLegacyFunctionCallMessages(
    conversationMessages: ChatMessage[],
    toolCall: { id: string; name: string; arguments: string },
    toolResponse: { content: unknown; rawData?: unknown }
  ): void {
    const formattedToolRecordText =
      '<function_call>' +
      JSON.stringify({
        function_call_record: {
          name: toolCall.name,
          arguments: toolCall.arguments,
          response: toolResponse.content
        }
      }) +
      '</function_call>'

    let lastAssistantMessage = conversationMessages.findLast(
      (message) => message.role === 'assistant'
    )

    if (lastAssistantMessage) {
      if (typeof lastAssistantMessage.content === 'string') {
        lastAssistantMessage.content += formattedToolRecordText + '\n'
      } else if (Array.isArray(lastAssistantMessage.content)) {
        lastAssistantMessage.content.push({
          type: 'text',
          text: formattedToolRecordText + '\n'
        })
      } else {
        lastAssistantMessage.content = [{ type: 'text', text: formattedToolRecordText + '\n' }]
      }
    } else {
      conversationMessages.push({
        role: 'assistant',
        content: [{ type: 'text', text: formattedToolRecordText + '\n' }]
      })
    }

    const userPromptText =
      '以上是你刚执行的工具调用及其响应信息，已帮你插入，请仔细阅读工具响应，并继续你的回答。'
    conversationMessages.push({
      role: 'user',
      content: [{ type: 'text', text: userPromptText }]
    })
  }

  private async offloadToolContentIfNeeded(
    content: string,
    toolCallId: string,
    conversationId?: string,
    toolName?: string
  ): Promise<string> {
    // Only offload tools in the whitelist
    if (toolName && !TOOLS_REQUIRING_OFFLOAD.has(toolName)) {
      return content
    }

    if (content.length <= TOOL_OUTPUT_OFFLOAD_THRESHOLD) return content
    if (!conversationId) return content

    const filePath = resolveToolOffloadPath(conversationId, toolCallId)
    if (!filePath) return content
    const sessionDir = path.dirname(filePath)

    try {
      await fs.mkdir(sessionDir, { recursive: true })
      await fs.writeFile(filePath, content, 'utf-8')
    } catch (error) {
      console.warn('[ToolCallProcessor] Failed to offload tool output:', error)
      return content
    }

    const preview = content.slice(0, TOOL_OUTPUT_PREVIEW_LENGTH)
    return this.buildToolOutputStub(content.length, preview, filePath)
  }

  private buildToolOutputStub(totalLength: number, preview: string, filePath: string): string {
    return [
      '[Tool output offloaded]',
      `Total characters: ${totalLength}`,
      `Full output saved to: ${filePath}`,
      `first ${preview.length} chars:`,
      preview
    ].join('\n')
  }

  private appendToolError(
    conversationMessages: ChatMessage[],
    modelConfig: ModelConfig,
    toolCall: { id: string; name: string; arguments: string },
    errorMessage: string
  ): void {
    if (modelConfig?.functionCall) {
      // For native function-calling models, ensure every tool error is still paired
      // with a preceding assistant message that declares the tool_call in tool_calls.
      const toolCallEntry = {
        id: toolCall.id,
        type: 'function' as const,
        function: {
          name: toolCall.name,
          arguments: toolCall.arguments
        }
      }

      let lastAssistantMessage = conversationMessages.findLast(
        (message) => message.role === 'assistant'
      )

      if (lastAssistantMessage) {
        if (!lastAssistantMessage.tool_calls) {
          lastAssistantMessage.tool_calls = []
        }
        lastAssistantMessage.tool_calls.push(toolCallEntry)
      } else {
        // Extremely defensive fallback – create a synthetic assistant message
        // so the OpenAI API still sees a valid tool_calls declaration.
        lastAssistantMessage = {
          role: 'assistant',
          tool_calls: [toolCallEntry]
        }
        conversationMessages.push(lastAssistantMessage)
      }

      conversationMessages.push({
        role: 'tool',
        content: `The tool call with ID ${toolCall.id} and name ${toolCall.name} failed to execute: ${errorMessage}`,
        tool_call_id: toolCall.id
      })
      return
    }

    const formattedErrorText = `编号为 ${toolCall.id} 的工具 ${toolCall.name} 调用执行失败: ${errorMessage}`
    let lastAssistantMessage = conversationMessages.findLast(
      (message) => message.role === 'assistant'
    )
    if (lastAssistantMessage) {
      if (typeof lastAssistantMessage.content === 'string') {
        lastAssistantMessage.content += '\n' + formattedErrorText + '\n'
      } else if (Array.isArray(lastAssistantMessage.content)) {
        lastAssistantMessage.content.push({
          type: 'text',
          text: '\n' + formattedErrorText + '\n'
        })
      } else {
        lastAssistantMessage.content = [{ type: 'text', text: '\n' + formattedErrorText + '\n' }]
      }
    } else {
      conversationMessages.push({
        role: 'assistant',
        content: [{ type: 'text', text: formattedErrorText + '\n' }]
      })
    }

    const userPromptText =
      '以上是你刚调用的工具及其执行的错误信息，已帮你插入，请根据情况继续回答或重新尝试。'
    conversationMessages.push({
      role: 'user',
      content: [{ type: 'text', text: userPromptText }]
    })
  }

  private stringifyToolContent(content: unknown): string {
    return typeof content === 'string' ? content : JSON.stringify(content)
  }

  /**
   * Batch pre-check permissions for all tool calls
   * Returns info about tools that need permission, or empty if all have permission
   */
  private async batchPreCheckPermissions(
    context: ToolCallExecutionContext,
    toolDefinitions: MCPToolDefinition[]
  ): Promise<{
    hasPendingPermissions: boolean
    permissionRequests: PermissionRequestInfo[]
  }> {
    // If no permission pre-check function provided, skip batch check
    if (!this.options.preCheckToolPermission) {
      return { hasPendingPermissions: false, permissionRequests: [] }
    }

    const permissionRequests: PermissionRequestInfo[] = []
    const toolNameToDefMap = new Map(toolDefinitions.map((t) => [t.function.name, t]))

    for (const toolCall of context.toolCalls) {
      const toolDef = toolNameToDefMap.get(toolCall.name)
      if (!toolDef) continue

      // Skip question tool for permission check
      if (toolCall.name === QUESTION_TOOL_NAME) continue

      const mcpToolInput: MCPToolCall = {
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: toolCall.arguments
        },
        server: toolDef.server,
        conversationId: context.conversationId
      }

      try {
        const permissionResult = await this.options.preCheckToolPermission(mcpToolInput)
        if (permissionResult) {
          const permissionPayload: PermissionRequestPayload = {
            ...permissionResult,
            toolName: permissionResult.toolName || toolCall.name,
            serverName: permissionResult.serverName || toolDef.server.name,
            permissionType: permissionResult.permissionType,
            description: permissionResult.description
          }

          // Preserve the full permission payload (paths and custom fields included)
          permissionRequests.push({
            toolCall,
            serverName: permissionPayload.serverName,
            serverIcons: toolDef.server?.icons,
            serverDescription: toolDef.server?.description,
            payload: permissionPayload
          })
        }
      } catch (error) {
        console.warn(
          `[ToolCallProcessor] Failed to pre-check permission for ${toolCall.name}:`,
          error
        )
        // If pre-check fails, we'll let the actual execution handle it
      }
    }

    return {
      hasPendingPermissions: permissionRequests.length > 0,
      permissionRequests
    }
  }
}
