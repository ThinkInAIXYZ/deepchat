import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { IoParams, ProcessParams, ProcessResult, StreamState } from './types'
import { createState } from './types'
import { accumulate } from './accumulator'
import { startEcho } from './echo'
import { executeTools, finalize, finalizeError, finalizePaused } from './dispatch'

const MAX_TOOL_CALLS = 128
const UNKNOWN_CONTEXT_LIMIT = Number.MAX_SAFE_INTEGER
const CONTEXT_WINDOW_ERROR_PATTERNS = [
  'context length',
  'context window',
  'too many tokens',
  'prompt too long',
  'maximum context length',
  'reduce the length'
]
const USER_CANCELED_GENERATION_ERROR = 'common.error.userCanceledGeneration'
const NO_MODEL_RESPONSE_ERROR = 'common.error.noModelResponse'

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')
}

function isContextWindowErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return CONTEXT_WINDOW_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))
}

function getLatestErrorMessage(state: StreamState): string | null {
  for (let index = state.blocks.length - 1; index >= 0; index -= 1) {
    const block = state.blocks[index]
    if (block.type === 'error' && typeof block.content === 'string' && block.content.trim()) {
      return block.content
    }
  }
  return null
}

function stripTrailingErrorBlock(state: StreamState, message: string): void {
  const lastBlock = state.blocks[state.blocks.length - 1]
  if (lastBlock?.type === 'error' && lastBlock.content === message) {
    state.blocks.pop()
  }
}

function parseAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
  try {
    const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isTerminalPendingStatus(status: AssistantMessageBlock['status']): boolean {
  return status === 'pending' || status === 'loading'
}

function isUserCanceledAlreadyFinalized(io: IoParams): boolean {
  const message = io.messageStore.getMessage(io.messageId)
  if (!message || message.role !== 'assistant' || message.status !== 'error') {
    return false
  }

  const blocks = parseAssistantBlocks(message.content)
  if (blocks.length === 0) {
    return false
  }

  if (blocks.some((block) => isTerminalPendingStatus(block.status))) {
    return false
  }

  return blocks.some(
    (block) => block.type === 'error' && block.content === USER_CANCELED_GENERATION_ERROR
  )
}

function finalizeUserCanceledErrorIfNeeded(state: StreamState, io: IoParams): void {
  if (isUserCanceledAlreadyFinalized(io)) {
    return
  }

  finalizeError(state, io, USER_CANCELED_GENERATION_ERROR)
}

/**
 * Unified stream processor. Handles both simple completions and multi-turn
 * tool-calling loops in a single code path.
 */
export async function processStream(params: ProcessParams): Promise<ProcessResult> {
  const {
    messages,
    tools,
    toolPresenter,
    coreStream,
    providerId,
    modelId,
    modelConfig,
    temperature,
    maxTokens,
    interleavedReasoning,
    permissionMode,
    initialBlocks,
    hooks,
    io
  } = params

  const state = createState()
  state.metadata.provider = providerId
  state.metadata.model = modelId
  if (Array.isArray(initialBlocks) && initialBlocks.length > 0) {
    state.blocks = JSON.parse(JSON.stringify(initialBlocks)) as typeof state.blocks
  }
  const echo = startEcho(state, io)
  const conversationMessages = [...messages]
  let currentTools = [...tools]
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
        currentTools
      )

      // Reset per-iteration accumulator state
      state.completedToolCalls = []
      state.pendingToolCalls.clear()

      for await (const event of stream) {
        eventCount++
        if (io.abortSignal.aborted) {
          console.log(`[ProcessStream] aborted after ${eventCount} events`)
          echo.stop()
          finalizeUserCanceledErrorIfNeeded(state, io)
          return {
            status: 'aborted' as const,
            stopReason: 'user_stop',
            errorMessage: USER_CANCELED_GENERATION_ERROR,
            usage: buildUsageSnapshot(state)
          }
        }
        accumulate(state, event)
      }

      console.log(
        `[ProcessStream] stream iteration done reason=${state.stopReason} events=${eventCount} blocks=${state.blocks.length}`
      )

      // Break conditions: not tool_use, abort, no completed tool calls
      if (io.abortSignal.aborted) {
        finalizeUserCanceledErrorIfNeeded(state, io)
        return {
          status: 'aborted' as const,
          stopReason: 'user_stop',
          errorMessage: USER_CANCELED_GENERATION_ERROR,
          usage: buildUsageSnapshot(state)
        }
      }
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
        currentTools,
        toolPresenter!,
        modelId,
        interleavedReasoning,
        io,
        permissionMode,
        params.toolOutputGuard,
        modelConfig.contextLength > 0 ? modelConfig.contextLength : UNKNOWN_CONTEXT_LIMIT,
        maxTokens,
        hooks,
        providerId
      )
      toolCallCount += executed.executed
      echo.flush()

      if (executed.toolsChanged && params.refreshTools) {
        try {
          currentTools = await params.refreshTools()
        } catch (error) {
          console.warn('[ProcessStream] failed to refresh tools after skill activation:', error)
        }
      }

      if (executed.terminalError) {
        finalizeError(state, io, executed.terminalError)
        return {
          status: 'error' as const,
          terminalError: executed.terminalError,
          stopReason: 'error',
          errorMessage: executed.terminalError,
          usage: buildUsageSnapshot(state)
        }
      }

      if (executed.pendingInteractions.length > 0) {
        console.log(
          `[ProcessStream] paused for user interaction count=${executed.pendingInteractions.length}`
        )
        finalizePaused(state, io)
        return {
          status: 'paused' as const,
          pendingInteractions: executed.pendingInteractions
        }
      }

      // Check abort after tool execution
      if (io.abortSignal.aborted) {
        finalizeUserCanceledErrorIfNeeded(state, io)
        return {
          status: 'aborted' as const,
          stopReason: 'user_stop',
          errorMessage: USER_CANCELED_GENERATION_ERROR,
          usage: buildUsageSnapshot(state)
        }
      }
    }

    // Finalize
    if (io.abortSignal.aborted) {
      finalizeUserCanceledErrorIfNeeded(state, io)
      return {
        status: 'aborted' as const,
        stopReason: 'user_stop',
        errorMessage: USER_CANCELED_GENERATION_ERROR,
        usage: buildUsageSnapshot(state)
      }
    }
    if (state.stopReason === 'error') {
      const streamErrorMessage = getLatestErrorMessage(state)
      if (streamErrorMessage && isContextWindowErrorMessage(streamErrorMessage)) {
        stripTrailingErrorBlock(state, streamErrorMessage)
        finalizeError(state, io, streamErrorMessage)
        return {
          status: 'error' as const,
          terminalError: streamErrorMessage
        }
      }
    }
    if (state.blocks.length === 0) {
      finalizeError(state, io, NO_MODEL_RESPONSE_ERROR)
      return {
        status: 'error' as const,
        terminalError: NO_MODEL_RESPONSE_ERROR,
        stopReason: 'error',
        errorMessage: NO_MODEL_RESPONSE_ERROR,
        usage: buildUsageSnapshot(state)
      }
    }
    finalize(state, io)
    return {
      status: 'completed' as const,
      stopReason: 'complete',
      usage: buildUsageSnapshot(state)
    }
  } catch (err) {
    if (io.abortSignal.aborted || isAbortError(err)) {
      console.log(`[ProcessStream] aborted via exception after ${eventCount} events`)
      return {
        status: 'aborted' as const,
        stopReason: 'user_stop',
        errorMessage: USER_CANCELED_GENERATION_ERROR,
        usage: buildUsageSnapshot(state)
      }
    }
    console.error(`[ProcessStream] exception after ${eventCount} events:`, err)
    finalizeError(state, io, err)
    return {
      status: 'error' as const,
      stopReason: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      usage: buildUsageSnapshot(state)
    }
  } finally {
    echo.stop()
  }
}

function buildUsageSnapshot(state: StreamState): Record<string, number> {
  const usage: Record<string, number> = {}
  if (typeof state.metadata.totalTokens === 'number') {
    usage.totalTokens = state.metadata.totalTokens
  }
  if (typeof state.metadata.inputTokens === 'number') {
    usage.inputTokens = state.metadata.inputTokens
  }
  if (typeof state.metadata.outputTokens === 'number') {
    usage.outputTokens = state.metadata.outputTokens
  }
  if (typeof state.metadata.cachedInputTokens === 'number') {
    usage.cachedInputTokens = state.metadata.cachedInputTokens
  }
  if (typeof state.metadata.cacheWriteInputTokens === 'number') {
    usage.cacheWriteInputTokens = state.metadata.cacheWriteInputTokens
  }
  return usage
}
