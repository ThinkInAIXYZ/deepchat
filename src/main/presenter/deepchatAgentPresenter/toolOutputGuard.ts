import fs from 'fs/promises'
import path from 'path'
import { approximateTokenSize } from 'tokenx'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import { resolveToolOffloadPath } from '@/lib/agentRuntime/sessionPaths'
import { estimateMessagesTokens } from './contextBuilder'

const TOOL_OUTPUT_OFFLOAD_THRESHOLD = 5000
const TOOL_OUTPUT_PREVIEW_LENGTH = 1024
const TOOLS_REQUIRING_OFFLOAD = new Set(['exec', 'ls', 'find', 'grep', 'cdp_send'])

type ToolMessageUpdateMode = 'append' | 'replace'

export type PreparedToolOutputResult =
  | {
      kind: 'ok'
      content: string
      offloaded: boolean
      offloadPath?: string
    }
  | {
      kind: 'tool_error'
      message: string
    }

export type ToolOutputGuardResult =
  | {
      kind: 'ok'
      content: string
      offloaded: boolean
      offloadPath?: string
    }
  | {
      kind: 'tool_error'
      message: string
    }
  | {
      kind: 'terminal_error'
      message: string
    }

interface PrepareToolOutputParams {
  sessionId: string
  toolCallId: string
  toolName: string
  rawContent: string
}

interface GuardToolOutputParams extends PrepareToolOutputParams {
  conversationMessages: ChatMessage[]
  toolDefinitions: MCPToolDefinition[]
  contextLength: number
  maxTokens: number
}

interface ContextBudgetParams {
  conversationMessages: ChatMessage[]
  toolDefinitions: MCPToolDefinition[]
  contextLength: number
  maxTokens: number
}

interface FitToolErrorParams extends ContextBudgetParams {
  toolCallId: string
  toolName: string
  errorMessage: string
  mode?: ToolMessageUpdateMode
}

export class ToolOutputGuard {
  async prepareToolOutput(params: PrepareToolOutputParams): Promise<PreparedToolOutputResult> {
    const { sessionId, toolCallId, toolName, rawContent } = params

    if (!this.requiresOffload(toolName) || rawContent.length <= TOOL_OUTPUT_OFFLOAD_THRESHOLD) {
      return {
        kind: 'ok',
        content: rawContent,
        offloaded: false,
        offloadPath: undefined
      }
    }

    const filePath = resolveToolOffloadPath(sessionId, toolCallId)
    if (!filePath) {
      return {
        kind: 'tool_error',
        message: this.buildOffloadFailureMessage(toolCallId, toolName)
      }
    }

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, rawContent, 'utf-8')
    } catch (error) {
      console.warn('[ToolOutputGuard] Failed to offload tool output:', error)
      return {
        kind: 'tool_error',
        message: this.buildOffloadFailureMessage(toolCallId, toolName)
      }
    }

    return {
      kind: 'ok',
      content: this.buildOffloadStub(rawContent, filePath),
      offloaded: true,
      offloadPath: filePath
    }
  }

  async guardToolOutput(params: GuardToolOutputParams): Promise<ToolOutputGuardResult> {
    const prepared = await this.prepareToolOutput(params)
    if (prepared.kind === 'tool_error') {
      return this.fitToolError({
        ...params,
        errorMessage: prepared.message
      })
    }

    const nextMessages = this.withToolMessage(
      params.conversationMessages,
      params.toolCallId,
      prepared.content,
      'append'
    )
    if (
      this.hasContextBudget({
        conversationMessages: nextMessages,
        toolDefinitions: params.toolDefinitions,
        contextLength: params.contextLength,
        maxTokens: params.maxTokens
      })
    ) {
      return prepared
    }

    const overflowResult = this.fitToolError({
      ...params,
      errorMessage: this.buildContextOverflowMessage(params.toolCallId, params.toolName)
    })
    await this.cleanupOffloadedOutput(prepared.offloadPath)
    return overflowResult
  }

  hasContextBudget(params: ContextBudgetParams): boolean {
    const { conversationMessages, toolDefinitions, contextLength, maxTokens } = params
    const toolDefinitionTokens = toolDefinitions.reduce(
      (total, tool) => total + approximateTokenSize(JSON.stringify(tool)),
      0
    )
    return (
      estimateMessagesTokens(conversationMessages) +
        toolDefinitionTokens +
        Math.max(0, Math.floor(maxTokens)) <=
      contextLength
    )
  }

  fitToolError(params: FitToolErrorParams): ToolOutputGuardResult {
    const mode = params.mode ?? 'append'
    const errorMessages = this.withToolMessage(
      params.conversationMessages,
      params.toolCallId,
      params.errorMessage,
      mode
    )
    if (
      this.hasContextBudget({
        conversationMessages: errorMessages,
        toolDefinitions: params.toolDefinitions,
        contextLength: params.contextLength,
        maxTokens: params.maxTokens
      })
    ) {
      return {
        kind: 'tool_error',
        message: params.errorMessage
      }
    }
    return {
      kind: 'terminal_error',
      message: this.buildTerminalErrorMessage(params.toolCallId, params.toolName)
    }
  }

  replaceToolMessageContent(
    conversationMessages: ChatMessage[],
    toolCallId: string,
    content: string
  ): ChatMessage[] {
    return this.withToolMessage(conversationMessages, toolCallId, content, 'replace')
  }

  async cleanupOffloadedOutput(offloadPath?: string): Promise<void> {
    if (!offloadPath) {
      return
    }

    try {
      await fs.rm(offloadPath, { force: true })
    } catch (error) {
      console.warn('[ToolOutputGuard] Failed to delete offloaded tool output:', error)
    }
  }

  buildContextOverflowMessage(toolCallId: string, toolName: string): string {
    return `The tool call with ID ${toolCallId} and name ${toolName} could not be injected into the conversation because the remaining context window is insufficient. Treat this tool call as failed and continue without its result.`
  }

  private requiresOffload(toolName: string): boolean {
    return TOOLS_REQUIRING_OFFLOAD.has(toolName)
  }

  private withToolMessage(
    conversationMessages: ChatMessage[],
    toolCallId: string,
    content: string,
    mode: ToolMessageUpdateMode
  ): ChatMessage[] {
    if (mode === 'replace') {
      let replaced = false
      const nextMessages = conversationMessages.map((message) => {
        if (replaced || message.role !== 'tool' || message.tool_call_id !== toolCallId) {
          return message
        }
        replaced = true
        return {
          ...message,
          content
        }
      })
      if (replaced) {
        return nextMessages
      }
      return [
        ...nextMessages,
        {
          role: 'tool',
          tool_call_id: toolCallId,
          content
        }
      ]
    }

    return [
      ...conversationMessages,
      {
        role: 'tool',
        tool_call_id: toolCallId,
        content
      }
    ]
  }

  private buildOffloadStub(rawContent: string, filePath: string): string {
    const preview = rawContent.slice(0, TOOL_OUTPUT_PREVIEW_LENGTH)
    return [
      '[Tool output offloaded]',
      `Total characters: ${rawContent.length}`,
      `Offload file: ${path.basename(filePath)}`,
      `first ${preview.length} chars:`,
      preview
    ].join('\n')
  }

  private buildOffloadFailureMessage(toolCallId: string, toolName: string): string {
    return `The tool call with ID ${toolCallId} and name ${toolName} produced a large result, but offloading that result to disk failed. Treat this tool call as failed and continue without its result.`
  }

  private buildTerminalErrorMessage(toolCallId: string, toolName: string): string {
    return `The tool call with ID ${toolCallId} and name ${toolName} failed because the remaining context window is too small to continue this turn.`
  }
}
