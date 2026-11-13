import { markStreamChanged, type StreamState } from './messageStream'
import { isContextWindowErrorLike } from './contextWindowError'

export const NO_MODEL_RESPONSE_ERROR = 'common.error.noModelResponse'
export const INCOMPLETE_PROVIDER_STREAM_ERROR =
  'Provider stream ended without a terminal stop event.'
export const INCOMPLETE_TOOL_USE_ERROR =
  'Provider requested tool use without a completed tool call.'
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
    markStreamChanged(state)
  }
}

export type ProviderTerminalDecision =
  | {
      type: 'complete'
      stopReason: 'complete' | 'max_tokens' | 'max_turn_requests'
    }
  | {
      type: 'error'
      error: string
      source: 'context' | 'empty' | 'provider'
      stopReason: 'context_window' | 'empty_response' | 'provider_error'
    }

export function resolveProviderTerminalDecision(state: StreamState): ProviderTerminalDecision {
  const stopReason = state.stopReason
  if (stopReason === 'error') {
    const streamErrorMessage = getLatestErrorMessage(state) ?? NO_MODEL_RESPONSE_ERROR
    if (isContextWindowErrorLike(streamErrorMessage)) {
      stripTrailingErrorBlock(state, streamErrorMessage)
      return {
        type: 'error',
        error: streamErrorMessage,
        source: 'context',
        stopReason: 'context_window'
      }
    }
    return {
      type: 'error',
      error: streamErrorMessage,
      source: 'provider',
      stopReason: 'provider_error'
    }
  }
  if (stopReason === null) {
    return {
      type: 'error',
      error: INCOMPLETE_PROVIDER_STREAM_ERROR,
      source: 'provider',
      stopReason: 'provider_error'
    }
  }
  if (state.blocks.length === 0) {
    return {
      type: 'error',
      error: NO_MODEL_RESPONSE_ERROR,
      source: 'empty',
      stopReason: 'empty_response'
    }
  }
  switch (stopReason) {
    case 'complete':
    case 'max_tokens':
    case 'max_turn_requests':
      return { type: 'complete', stopReason }
    case 'tool_use':
      return {
        type: 'error',
        error: INCOMPLETE_TOOL_USE_ERROR,
        source: 'provider',
        stopReason: 'provider_error'
      }
  }
  const unsupportedStopReason: never = stopReason
  throw new Error(`Unsupported provider stop reason: ${String(unsupportedStopReason)}`)
}
