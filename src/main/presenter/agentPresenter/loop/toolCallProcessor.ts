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
import { app } from 'electron'
import { isNonRetryableError } from './errorClassification'

interface ToolCallProcessorOptions {
  getAllToolDefinitions: (context: ToolCallExecutionContext) => Promise<MCPToolDefinition[]>
  callTool: (request: MCPToolCall) => Promise<{ content: unknown; rawData: MCPToolResponse }>
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
  abortSignal: AbortSignal
  currentToolCallCount: number
  maxToolCalls: number
  conversationId?: string
}

interface ToolCallProcessResult {
  toolCallCount: number
  needContinueConversation: boolean
}

const TOOL_OUTPUT_OFFLOAD_THRESHOLD = 3000
const TOOL_OUTPUT_PREVIEW_LENGTH = 1024

export class ToolCallProcessor {
  constructor(private readonly options: ToolCallProcessorOptions) {}

  async *process(
    context: ToolCallExecutionContext
  ): AsyncGenerator<LLMAgentEvent, ToolCallProcessResult, void> {
    let toolCallCount = context.currentToolCallCount
    let needContinueConversation = context.toolCalls.length > 0

    let toolDefinitions = await this.options.getAllToolDefinitions(context)

    const resolveToolDefinition = async (
      toolName: string
    ): Promise<MCPToolDefinition | undefined> => {
      const match = toolDefinitions.find((tool) => tool.function.name === toolName)
      if (match) return match
      toolDefinitions = await this.options.getAllToolDefinitions(context)
      return toolDefinitions.find((tool) => tool.function.name === toolName)
    }

    for (const toolCall of context.toolCalls) {
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
          context.conversationId
        )

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
    conversationId?: string
  ): Promise<string> {
    if (content.length <= TOOL_OUTPUT_OFFLOAD_THRESHOLD) return content
    if (!conversationId) return content

    const sessionDir = this.resolveSessionDir(conversationId)
    if (!sessionDir) return content

    const safeToolCallId = toolCallId.replace(/[\\/]/g, '_')
    const filePath = path.join(sessionDir, `tool_${safeToolCallId}.offload`)

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

  private resolveSessionDir(conversationId: string): string | null {
    if (!conversationId.trim()) return null
    const sessionsRoot = path.resolve(app.getPath('home'), '.deepchat', 'sessions')
    const resolvedSessionDir = path.resolve(sessionsRoot, conversationId)
    const rootWithSeparator = sessionsRoot.endsWith(path.sep)
      ? sessionsRoot
      : `${sessionsRoot}${path.sep}`
    if (resolvedSessionDir !== sessionsRoot && !resolvedSessionDir.startsWith(rootWithSeparator)) {
      return null
    }
    return resolvedSessionDir
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
}
