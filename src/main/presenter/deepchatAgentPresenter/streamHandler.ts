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
}

export async function handleStream(
  stream: AsyncGenerator<LLMCoreStreamEvent>,
  context: StreamContext
): Promise<void> {
  const { sessionId, messageId, messageStore, abortSignal } = context

  const blocks: AssistantMessageBlock[] = []
  const metadata: MessageMetadata = {}
  const startTime = Date.now()
  let firstTokenTime: number | null = null

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

  console.log(`[StreamHandler] start session=${sessionId} message=${messageId}`)
  let eventCount = 0

  try {
    for await (const event of stream) {
      eventCount++
      if (abortSignal.aborted) {
        console.log(`[StreamHandler] aborted after ${eventCount} events`)
        cleanup()
        // Mark blocks as error on abort
        for (const block of blocks) {
          if (block.status === 'pending') block.status = 'error'
        }
        messageStore.setMessageError(messageId, blocks)
        eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
          conversationId: sessionId,
          error: 'Generation cancelled'
        })
        return
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
        case 'usage': {
          metadata.inputTokens = event.usage.prompt_tokens
          metadata.outputTokens = event.usage.completion_tokens
          metadata.totalTokens = event.usage.total_tokens
          break
        }
        case 'stop': {
          console.log(
            `[StreamHandler] stop received after ${eventCount} events, ${blocks.length} blocks, ${Date.now() - startTime}ms`
          )
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
          return
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
          messageStore.setMessageError(messageId, blocks)
          flushToRenderer()
          eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
            conversationId: sessionId,
            error: event.error_message
          })
          return
        }
        // v0 ignores: tool_call_start, tool_call_chunk, tool_call_end, permission, image_data, rate_limit
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

    messageStore.setMessageError(messageId, blocks)
    flushToRenderer()
    eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
      conversationId: sessionId,
      error: errorMessage
    })
  }
}
