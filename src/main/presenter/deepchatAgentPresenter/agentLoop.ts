import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { MCPToolDefinition, ModelConfig } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { MCPToolCall, MCPContentItem } from '@shared/types/core/mcp'
import { handleStream, type StreamContext, type ToolCallResult } from './streamHandler'
import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'

const MAX_TOOL_CALLS = 128

export interface AgentLoopParams {
  messages: ChatMessage[]
  tools: MCPToolDefinition[]
  toolPresenter: IToolPresenter
  coreStream: (
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ) => AsyncGenerator<LLMCoreStreamEvent>
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  streamContext: StreamContext
}

function toolResponseToText(content: string | MCPContentItem[]): string {
  if (typeof content === 'string') return content
  return content
    .map((item) => {
      if (item.type === 'text') return item.text
      if (item.type === 'resource' && item.resource?.text) return item.resource.text
      return `[${item.type}]`
    })
    .join('\n')
}

function extractTextFromBlocks(blocks: AssistantMessageBlock[]): string {
  return blocks
    .filter((b) => b.type === 'content')
    .map((b) => b.content)
    .join('')
}

function buildToolCallsForMessage(
  toolCalls: ToolCallResult[]
): { id: string; type: 'function'; function: { name: string; arguments: string } }[] {
  return toolCalls.map((tc) => ({
    id: tc.id,
    type: 'function' as const,
    function: { name: tc.name, arguments: tc.arguments }
  }))
}

export async function agentLoop(params: AgentLoopParams): Promise<void> {
  const {
    messages: initialMessages,
    tools,
    toolPresenter,
    coreStream,
    modelId,
    modelConfig,
    temperature,
    maxTokens,
    streamContext
  } = params

  const conversationMessages = [...initialMessages]
  let toolCallCount = 0

  // Accumulated blocks across all loop iterations (stored in the single assistant message)
  let allBlocks: AssistantMessageBlock[] = []

  while (true) {
    // Pass accumulated blocks so handleStream appends to them
    const prevBlockCount = allBlocks.length
    const loopContext = { ...streamContext, initialBlocks: allBlocks }
    const stream = coreStream(
      conversationMessages,
      modelId,
      modelConfig,
      temperature,
      maxTokens,
      tools
    )

    const result = await handleStream(stream, loopContext)

    // handleStream returns all blocks (initialBlocks + new ones)
    allBlocks = result.blocks

    // Enrich tool_call blocks with server info from tool definitions
    for (const tc of result.toolCalls) {
      const toolDef = tools.find((t) => t.function.name === tc.name)
      if (toolDef) {
        const block = allBlocks.find((b) => b.type === 'tool_call' && b.tool_call?.id === tc.id)
        if (block?.tool_call) {
          block.tool_call.server_name = toolDef.server.name
          block.tool_call.server_icons = toolDef.server.icons
          block.tool_call.server_description = toolDef.server.description
        }
      }
    }

    // If not tool_use or no tool calls, we're done
    if (result.stopReason !== 'tool_use' || result.toolCalls.length === 0) {
      break
    }

    // Check max tool call limit
    if (toolCallCount + result.toolCalls.length > MAX_TOOL_CALLS) {
      console.log(
        `[AgentLoop] max tool calls reached (${toolCallCount + result.toolCalls.length} > ${MAX_TOOL_CALLS}), stopping`
      )
      // Finalize blocks and break
      for (const block of allBlocks) {
        if (block.status === 'pending') block.status = 'success'
      }
      streamContext.messageStore.finalizeAssistantMessage(
        streamContext.messageId,
        allBlocks,
        JSON.stringify({})
      )
      eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, {
        conversationId: streamContext.sessionId
      })
      break
    }

    // Check abort
    if (streamContext.abortSignal.aborted) {
      break
    }

    // Append assistant message with tool_calls to conversation for LLM context
    // Only extract text from blocks added in this iteration
    const iterationBlocks = allBlocks.slice(prevBlockCount)
    const assistantText = extractTextFromBlocks(iterationBlocks)
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: assistantText || undefined,
      tool_calls: buildToolCallsForMessage(result.toolCalls)
    }
    conversationMessages.push(assistantMessage)

    // Execute each tool call and append results
    for (const tc of result.toolCalls) {
      if (streamContext.abortSignal.aborted) break

      const toolDef = tools.find((t) => t.function.name === tc.name)
      const toolCall: MCPToolCall = {
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
        server: toolDef?.server
      }

      try {
        const { rawData } = await toolPresenter.callTool(toolCall)
        const responseText = toolResponseToText(rawData.content)

        // Append tool result to conversation for LLM context
        conversationMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: responseText
        })

        // Update the tool_call block with the response for renderer display
        updateToolCallBlock(allBlocks, tc.id, responseText, false)
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err)

        // Append error result to conversation
        conversationMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Error: ${errorText}`
        })

        updateToolCallBlock(allBlocks, tc.id, `Error: ${errorText}`, true)
      }

      toolCallCount++

      // Flush updated blocks to renderer after each tool execution
      eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
        conversationId: streamContext.sessionId,
        blocks: JSON.parse(JSON.stringify(allBlocks))
      })

      // Persist intermediate state to DB
      streamContext.messageStore.updateAssistantContent(streamContext.messageId, allBlocks)
    }

    // Continue the loop — coreStream will be called again with tool results
  }
}

function updateToolCallBlock(
  blocks: AssistantMessageBlock[],
  toolCallId: string,
  response: string,
  isError: boolean
): void {
  const block = blocks.find((b) => b.type === 'tool_call' && b.tool_call?.id === toolCallId)
  if (block?.tool_call) {
    block.tool_call.response = response
    block.status = isError ? 'error' : 'success'
  }
}
