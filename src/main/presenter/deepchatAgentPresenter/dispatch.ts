import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { MCPToolCall, MCPContentItem } from '@shared/types/core/mcp'
import type { StreamState, IoParams } from './types'
import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'

// ---- Private helpers ----

function extractTextFromBlocks(blocks: AssistantMessageBlock[]): string {
  return blocks
    .filter((b) => b.type === 'content')
    .map((b) => b.content)
    .join('')
}

function extractReasoningFromBlocks(blocks: AssistantMessageBlock[]): string {
  return blocks
    .filter((b) => b.type === 'reasoning_content')
    .map((b) => b.content)
    .join('')
}

function requiresReasoningField(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return (
    lower.includes('deepseek-reasoner') ||
    lower.includes('kimi-k2-thinking') ||
    lower.includes('glm-4.7')
  )
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

// ---- Public API ----

/**
 * Execute completed tool calls: build the assistant message, call each tool,
 * update blocks, and flush to renderer + DB after each execution.
 * Returns the number of tool calls executed.
 */
export async function executeTools(
  state: StreamState,
  conversation: ChatMessage[],
  prevBlockCount: number,
  tools: MCPToolDefinition[],
  toolPresenter: IToolPresenter,
  modelId: string,
  io: IoParams
): Promise<number> {
  // Enrich tool_call blocks with server info from tool definitions
  for (const tc of state.completedToolCalls) {
    const toolDef = tools.find((t) => t.function.name === tc.name)
    if (toolDef) {
      const block = state.blocks.find((b) => b.type === 'tool_call' && b.tool_call?.id === tc.id)
      if (block?.tool_call) {
        block.tool_call.server_name = toolDef.server.name
        block.tool_call.server_icons = toolDef.server.icons
        block.tool_call.server_description = toolDef.server.description
      }
    }
  }

  // Build assistant message from this iteration's blocks
  const iterationBlocks = state.blocks.slice(prevBlockCount)
  const assistantText = extractTextFromBlocks(iterationBlocks)
  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: assistantText,
    tool_calls: state.completedToolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments }
    }))
  }

  // Interleaved thinking for reasoning models
  if (requiresReasoningField(modelId)) {
    const reasoning = extractReasoningFromBlocks(iterationBlocks)
    if (reasoning) {
      assistantMessage.reasoning_content = reasoning
    }
  }

  conversation.push(assistantMessage)

  let executed = 0

  // Execute each tool call
  for (const tc of state.completedToolCalls) {
    if (io.abortSignal.aborted) break

    const toolDef = tools.find((t) => t.function.name === tc.name)
    const toolCall: MCPToolCall = {
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
      server: toolDef?.server,
      conversationId: io.sessionId
    }

    try {
      const { rawData } = await toolPresenter.callTool(toolCall)
      const responseText = toolResponseToText(rawData.content)

      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: responseText
      })

      updateToolCallBlock(state.blocks, tc.id, responseText, false)
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)

      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: `Error: ${errorText}`
      })

      updateToolCallBlock(state.blocks, tc.id, `Error: ${errorText}`, true)
    }

    executed++

    // Flush updated blocks to renderer after each tool execution
    eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
      conversationId: io.sessionId,
      eventId: io.messageId,
      messageId: io.messageId,
      blocks: JSON.parse(JSON.stringify(state.blocks))
    })

    // Persist intermediate state to DB
    io.messageStore.updateAssistantContent(io.messageId, state.blocks)
  }

  return executed
}

/**
 * Finalize a successful stream: mark blocks as success, compute metadata, persist.
 */
export function finalize(state: StreamState, io: IoParams): void {
  for (const block of state.blocks) {
    if (block.status === 'pending') block.status = 'success'
  }

  const endTime = Date.now()
  state.metadata.generationTime = endTime - state.startTime
  if (state.firstTokenTime !== null) {
    state.metadata.firstTokenTime = state.firstTokenTime - state.startTime
  }
  if (state.metadata.outputTokens && state.metadata.generationTime > 0) {
    state.metadata.tokensPerSecond = Math.round(
      (state.metadata.outputTokens / state.metadata.generationTime) * 1000
    )
  }

  io.messageStore.finalizeAssistantMessage(
    io.messageId,
    state.blocks,
    JSON.stringify(state.metadata)
  )
  eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
    conversationId: io.sessionId,
    eventId: io.messageId,
    messageId: io.messageId,
    blocks: JSON.parse(JSON.stringify(state.blocks))
  })
  eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, {
    conversationId: io.sessionId,
    eventId: io.messageId,
    messageId: io.messageId
  })
}

/**
 * Finalize after an error: push error block, mark blocks as error, persist.
 */
export function finalizeError(state: StreamState, io: IoParams, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorBlock: AssistantMessageBlock = {
    type: 'error',
    content: errorMessage,
    status: 'error',
    timestamp: Date.now()
  }
  state.blocks.push(errorBlock)

  for (const block of state.blocks) {
    if (block.status === 'pending') block.status = 'error'
  }

  io.messageStore.setMessageError(io.messageId, state.blocks)
  eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
    conversationId: io.sessionId,
    eventId: io.messageId,
    messageId: io.messageId,
    blocks: JSON.parse(JSON.stringify(state.blocks))
  })
  eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
    conversationId: io.sessionId,
    eventId: io.messageId,
    messageId: io.messageId,
    error: errorMessage
  })
}
