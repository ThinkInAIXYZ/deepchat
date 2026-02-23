import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { AssistantMessageBlock, MessageMetadata } from '@shared/types/agent-interface'
import type { DeepChatMessageStore } from './messageStore'
import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'

const RENDERER_FLUSH_INTERVAL = 120
const DB_FLUSH_INTERVAL = 600

export interface StreamContext {
  sessionId: string
  messageId: string
  messageStore: DeepChatMessageStore
  abortSignal: AbortSignal
  /** Blocks from previous agent loop iterations — handleStream appends to these */
  initialBlocks?: AssistantMessageBlock[]
}

export interface ToolCallResult {
  id: string
  name: string
  arguments: string
  serverName?: string
  serverIcons?: string
  serverDescription?: string
}

export interface StreamResult {
  stopReason: 'complete' | 'tool_use' | 'error' | 'abort' | 'max_tokens'
  toolCalls: ToolCallResult[]
  blocks: AssistantMessageBlock[]
}

export async function handleStream(
  stream: AsyncGenerator<LLMCoreStreamEvent>,
  context: StreamContext
): Promise<StreamResult> {
  const { sessionId, messageId, messageStore, abortSignal } = context

  const blocks: AssistantMessageBlock[] = [...(context.initialBlocks ?? [])]
  const metadata: MessageMetadata = {}
  const startTime = Date.now()
  let firstTokenTime: number | null = null

  // Tool call accumulation
  const pendingToolCalls = new Map<
    string,
    { name: string; arguments: string; blockIndex: number }
  >()
  const completedToolCalls: ToolCallResult[] = []

  let rendererDirty = false
  let dbDirty = false

  // Batched flush timers
  const rendererTimer = setInterval(() => {
    if (rendererDirty) {
      flushToRenderer()
      rendererDirty = false
    }
  }, RENDERER_FLUSH_INTERVAL)

  const dbTimer = setInterval(() => {
    if (dbDirty) {
      flushToDb()
      dbDirty = false
    }
  }, DB_FLUSH_INTERVAL)

  function flushToRenderer(): void {
    eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
      conversationId: sessionId,
      blocks: JSON.parse(JSON.stringify(blocks))
    })
  }

  function flushToDb(): void {
    try {
      messageStore.updateAssistantContent(messageId, blocks)
    } catch (err) {
      console.error('Failed to flush stream content to DB:', err)
    }
  }

  function getCurrentBlock(type: 'content' | 'reasoning_content'): AssistantMessageBlock {
    const last = blocks[blocks.length - 1]
    if (last && last.type === type && last.status === 'pending') {
      return last
    }
    const block: AssistantMessageBlock = {
      type,
      content: '',
      status: 'pending',
      timestamp: Date.now()
    }
    blocks.push(block)
    return block
  }

  function cleanup(): void {
    clearInterval(rendererTimer)
    clearInterval(dbTimer)
  }

  // Map stop_reason from LLM events to our StreamResult stopReason
  function mapStopReason(
    reason: string
  ): 'complete' | 'tool_use' | 'error' | 'abort' | 'max_tokens' {
    switch (reason) {
      case 'tool_use':
        return 'tool_use'
      case 'max_tokens':
        return 'max_tokens'
      case 'error':
        return 'error'
      default:
        return 'complete'
    }
  }

  console.log(`[StreamHandler] start session=${sessionId} message=${messageId}`)
  let eventCount = 0
  let stopReason: StreamResult['stopReason'] = 'complete'

  try {
    for await (const event of stream) {
      eventCount++
      if (abortSignal.aborted) {
        console.log(`[StreamHandler] aborted after ${eventCount} events`)
        cleanup()
        // When called from agent loop (initialBlocks set), let the caller handle
        // finalization. Only finalize/emit when running standalone.
        if (!context.initialBlocks) {
          for (const block of blocks) {
            if (block.status === 'pending') block.status = 'error'
          }
          messageStore.setMessageError(messageId, blocks)
          eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
            conversationId: sessionId,
            error: 'Generation cancelled'
          })
        }
        return { stopReason: 'abort', toolCalls: completedToolCalls, blocks }
      }

      switch (event.type) {
        case 'text': {
          if (firstTokenTime === null) firstTokenTime = Date.now()
          const block = getCurrentBlock('content')
          block.content += event.content
          rendererDirty = true
          dbDirty = true
          break
        }
        case 'reasoning': {
          if (firstTokenTime === null) firstTokenTime = Date.now()
          const block = getCurrentBlock('reasoning_content')
          block.content += event.reasoning_content
          rendererDirty = true
          dbDirty = true
          break
        }
        case 'tool_call_start': {
          const toolBlock: AssistantMessageBlock = {
            type: 'tool_call',
            content: '',
            status: 'pending',
            timestamp: Date.now(),
            tool_call: {
              id: event.tool_call_id,
              name: event.tool_call_name,
              params: '',
              response: ''
            }
          }
          blocks.push(toolBlock)
          pendingToolCalls.set(event.tool_call_id, {
            name: event.tool_call_name,
            arguments: '',
            blockIndex: blocks.length - 1
          })
          rendererDirty = true
          dbDirty = true
          break
        }
        case 'tool_call_chunk': {
          const pending = pendingToolCalls.get(event.tool_call_id)
          if (pending) {
            pending.arguments += event.tool_call_arguments_chunk
            // Update the block's tool_call params for renderer
            const block = blocks[pending.blockIndex]
            if (block?.tool_call) {
              block.tool_call.params = pending.arguments
            }
            rendererDirty = true
            dbDirty = true
          }
          break
        }
        case 'tool_call_end': {
          const pending = pendingToolCalls.get(event.tool_call_id)
          if (pending) {
            // Use complete arguments if provided, otherwise use accumulated chunks
            const finalArgs = event.tool_call_arguments_complete ?? pending.arguments
            pending.arguments = finalArgs
            // Update block params
            const block = blocks[pending.blockIndex]
            if (block?.tool_call) {
              block.tool_call.params = finalArgs
            }
            completedToolCalls.push({
              id: event.tool_call_id,
              name: pending.name,
              arguments: finalArgs
            })
            pendingToolCalls.delete(event.tool_call_id)
            rendererDirty = true
            dbDirty = true
          }
          break
        }
        case 'usage': {
          metadata.inputTokens = event.usage.prompt_tokens
          metadata.outputTokens = event.usage.completion_tokens
          metadata.totalTokens = event.usage.total_tokens
          break
        }
        case 'stop': {
          stopReason = mapStopReason(event.stop_reason)
          console.log(
            `[StreamHandler] stop received reason=${event.stop_reason} after ${eventCount} events, ${blocks.length} blocks, ${Date.now() - startTime}ms`
          )

          // If tool_use, don't finalize — the agent loop will continue
          if (stopReason === 'tool_use') {
            cleanup()
            flushToRenderer()
            return { stopReason, toolCalls: completedToolCalls, blocks }
          }

          // Finalize all pending blocks
          for (const block of blocks) {
            if (block.status === 'pending') block.status = 'success'
          }

          const endTime = Date.now()
          metadata.generationTime = endTime - startTime
          if (firstTokenTime !== null) {
            metadata.firstTokenTime = firstTokenTime - startTime
          }
          if (metadata.outputTokens && metadata.generationTime > 0) {
            metadata.tokensPerSecond = Math.round(
              (metadata.outputTokens / metadata.generationTime) * 1000
            )
          }

          cleanup()
          messageStore.finalizeAssistantMessage(messageId, blocks, JSON.stringify(metadata))
          flushToRenderer()
          eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, {
            conversationId: sessionId
          })
          return { stopReason, toolCalls: completedToolCalls, blocks }
        }
        case 'error': {
          console.log(`[StreamHandler] error event: ${event.error_message}`)
          const errorBlock: AssistantMessageBlock = {
            type: 'error',
            content: event.error_message,
            status: 'error',
            timestamp: Date.now()
          }
          blocks.push(errorBlock)

          // Mark other pending blocks as error
          for (const block of blocks) {
            if (block.status === 'pending') block.status = 'error'
          }

          cleanup()
          if (!context.initialBlocks) {
            messageStore.setMessageError(messageId, blocks)
            eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
              conversationId: sessionId,
              error: event.error_message
            })
          }
          flushToRenderer()
          return { stopReason: 'error', toolCalls: completedToolCalls, blocks }
        }
        // v2 ignores: permission, image_data, rate_limit
        default:
          break
      }
    }

    // Stream ended without explicit stop event — finalize anyway
    for (const block of blocks) {
      if (block.status === 'pending') block.status = 'success'
    }
    cleanup()
    metadata.generationTime = Date.now() - startTime
    messageStore.finalizeAssistantMessage(messageId, blocks, JSON.stringify(metadata))
    flushToRenderer()
    eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, {
      conversationId: sessionId
    })
    return { stopReason, toolCalls: completedToolCalls, blocks }
  } catch (err) {
    console.error(`[StreamHandler] exception after ${eventCount} events:`, err)
    cleanup()

    const errorMessage = err instanceof Error ? err.message : String(err)
    const errorBlock: AssistantMessageBlock = {
      type: 'error',
      content: errorMessage,
      status: 'error',
      timestamp: Date.now()
    }
    blocks.push(errorBlock)

    for (const block of blocks) {
      if (block.status === 'pending') block.status = 'error'
    }

    if (!context.initialBlocks) {
      messageStore.setMessageError(messageId, blocks)
      eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
        conversationId: sessionId,
        error: errorMessage
      })
    }
    flushToRenderer()
    return { stopReason: 'error', toolCalls: completedToolCalls, blocks }
  }
}
