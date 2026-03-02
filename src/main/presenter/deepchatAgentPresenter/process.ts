import type { ProcessParams } from './types'
import { createState } from './types'
import { accumulate } from './accumulator'
import { startEcho } from './echo'
import { executeTools, finalize, finalizeError } from './dispatch'
import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'

const MAX_TOOL_CALLS = 128

/**
 * Unified stream processor. Handles both simple completions and multi-turn
 * tool-calling loops in a single code path.
 */
export async function processStream(params: ProcessParams): Promise<void> {
  const {
    messages,
    tools,
    toolPresenter,
    coreStream,
    modelId,
    modelConfig,
    temperature,
    maxTokens,
    io
  } = params

  const state = createState()
  const echo = startEcho(state, io)
  const conversationMessages = [...messages]
  let toolCallCount = 0

  console.log(`[ProcessStream] start session=${io.sessionId} message=${io.messageId}`)
  let eventCount = 0

  try {
    while (true) {
      const prevBlockCount = state.blocks.length

      const stream = coreStream(
        conversationMessages,
        modelId,
        modelConfig,
        temperature,
        maxTokens,
        tools
      )

      // Reset per-iteration accumulator state
      state.completedToolCalls = []
      state.pendingToolCalls.clear()

      for await (const event of stream) {
        eventCount++
        if (io.abortSignal.aborted) {
          console.log(`[ProcessStream] aborted after ${eventCount} events`)
          echo.stop()
          for (const block of state.blocks) {
            if (block.status === 'pending') block.status = 'error'
          }
          io.messageStore.setMessageError(io.messageId, state.blocks)
          eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
            conversationId: io.sessionId,
            eventId: io.messageId,
            messageId: io.messageId,
            error: 'Generation cancelled'
          })
          return
        }
        accumulate(state, event)
      }

      console.log(
        `[ProcessStream] stream iteration done reason=${state.stopReason} events=${eventCount} blocks=${state.blocks.length}`
      )

      // Break conditions: not tool_use, abort, no completed tool calls
      if (io.abortSignal.aborted) break
      if (state.stopReason !== 'tool_use') break
      if (state.completedToolCalls.length === 0) break

      // Check max tool call limit
      if (toolCallCount + state.completedToolCalls.length > MAX_TOOL_CALLS) {
        console.log(
          `[ProcessStream] max tool calls reached (${toolCallCount + state.completedToolCalls.length} > ${MAX_TOOL_CALLS}), stopping`
        )
        break
      }

      // Execute tools and continue loop (toolPresenter is guaranteed non-null here
      // because completedToolCalls > 0 means tools were requested, which requires
      // tools.length > 0, which requires toolPresenter to be non-null)
      const executed = await executeTools(
        state,
        conversationMessages,
        prevBlockCount,
        tools,
        toolPresenter!,
        modelId,
        io
      )
      toolCallCount += executed
      echo.flush()

      // Check abort after tool execution
      if (io.abortSignal.aborted) break
    }

    // Finalize
    finalize(state, io)
  } catch (err) {
    console.error(`[ProcessStream] exception after ${eventCount} events:`, err)
    finalizeError(state, io, err)
  } finally {
    echo.stop()
  }
}
