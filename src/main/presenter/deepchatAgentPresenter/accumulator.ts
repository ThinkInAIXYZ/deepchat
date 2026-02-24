import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { StreamState } from './types'

function getCurrentBlock(
  blocks: AssistantMessageBlock[],
  type: 'content' | 'reasoning_content'
): AssistantMessageBlock {
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

/**
 * Apply a single stream event to the accumulator state.
 * Pure block mutations only — no I/O, no finalization, no emit.
 */
export function accumulate(state: StreamState, event: LLMCoreStreamEvent): void {
  switch (event.type) {
    case 'text': {
      if (state.firstTokenTime === null) state.firstTokenTime = Date.now()
      const block = getCurrentBlock(state.blocks, 'content')
      block.content += event.content
      state.dirty = true
      break
    }
    case 'reasoning': {
      if (state.firstTokenTime === null) state.firstTokenTime = Date.now()
      const block = getCurrentBlock(state.blocks, 'reasoning_content')
      block.content += event.reasoning_content
      state.dirty = true
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
      state.blocks.push(toolBlock)
      state.pendingToolCalls.set(event.tool_call_id, {
        name: event.tool_call_name,
        arguments: '',
        blockIndex: state.blocks.length - 1
      })
      state.dirty = true
      break
    }
    case 'tool_call_chunk': {
      const pending = state.pendingToolCalls.get(event.tool_call_id)
      if (pending) {
        pending.arguments += event.tool_call_arguments_chunk
        const block = state.blocks[pending.blockIndex]
        if (block?.tool_call) {
          block.tool_call.params = pending.arguments
        }
        state.dirty = true
      }
      break
    }
    case 'tool_call_end': {
      const pending = state.pendingToolCalls.get(event.tool_call_id)
      if (pending) {
        const finalArgs = event.tool_call_arguments_complete ?? pending.arguments
        pending.arguments = finalArgs
        const block = state.blocks[pending.blockIndex]
        if (block?.tool_call) {
          block.tool_call.params = finalArgs
        }
        state.completedToolCalls.push({
          id: event.tool_call_id,
          name: pending.name,
          arguments: finalArgs
        })
        state.pendingToolCalls.delete(event.tool_call_id)
        state.dirty = true
      }
      break
    }
    case 'usage': {
      state.metadata.inputTokens = event.usage.prompt_tokens
      state.metadata.outputTokens = event.usage.completion_tokens
      state.metadata.totalTokens = event.usage.total_tokens
      break
    }
    case 'stop': {
      state.stopReason = mapStopReason(event.stop_reason)
      break
    }
    case 'error': {
      const errorBlock: AssistantMessageBlock = {
        type: 'error',
        content: event.error_message,
        status: 'error',
        timestamp: Date.now()
      }
      state.blocks.push(errorBlock)
      for (const block of state.blocks) {
        if (block.status === 'pending') block.status = 'error'
      }
      state.stopReason = 'error'
      state.dirty = true
      break
    }
    default:
      break
  }
}

function mapStopReason(reason: string): 'complete' | 'tool_use' | 'error' | 'abort' | 'max_tokens' {
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
