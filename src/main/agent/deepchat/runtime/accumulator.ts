import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { ChatMessageProviderOptions } from '@shared/types/core/chat-message'
import type { StreamState } from './types'

export function commitRoundUsage(state: StreamState): void {
  const roundUsage = state.roundUsage
  if (!roundUsage) {
    return
  }

  state.metadata.inputTokens = (state.metadata.inputTokens ?? 0) + roundUsage.inputTokens
  state.metadata.outputTokens = (state.metadata.outputTokens ?? 0) + roundUsage.outputTokens
  state.metadata.totalTokens = (state.metadata.totalTokens ?? 0) + roundUsage.totalTokens
  if (typeof roundUsage.cachedInputTokens === 'number') {
    state.metadata.cachedInputTokens =
      (state.metadata.cachedInputTokens ?? 0) + roundUsage.cachedInputTokens
  }
  if (typeof roundUsage.cacheWriteInputTokens === 'number') {
    state.metadata.cacheWriteInputTokens =
      (state.metadata.cacheWriteInputTokens ?? 0) + roundUsage.cacheWriteInputTokens
  }
  state.roundUsage = null
}

export function finalizeTrailingPendingNarrativeBlocks(blocks: AssistantMessageBlock[]): boolean {
  const last = blocks[blocks.length - 1]
  if (
    !last ||
    last.status !== 'pending' ||
    (last.type !== 'content' && last.type !== 'reasoning_content')
  ) {
    return false
  }

  last.status = 'success'
  return true
}

function getCurrentBlock(
  blocks: AssistantMessageBlock[],
  type: 'content' | 'reasoning_content',
  providerOptions?: ChatMessageProviderOptions
): AssistantMessageBlock {
  const providerOptionsJson = serializeProviderOptions(providerOptions)
  const last = blocks[blocks.length - 1]
  if (
    last &&
    last.status === 'pending' &&
    (last.type === 'content' || last.type === 'reasoning_content')
  ) {
    const lastProviderOptionsJson =
      typeof last.extra?.providerOptionsJson === 'string'
        ? last.extra.providerOptionsJson
        : undefined

    if (last.type === type && lastProviderOptionsJson === providerOptionsJson) {
      return last
    }

    last.status = 'success'
  }

  const block: AssistantMessageBlock = {
    type,
    content: '',
    status: 'pending',
    timestamp: Date.now(),
    ...(providerOptionsJson ? { extra: { providerOptionsJson } } : {})
  }
  blocks.push(block)
  return block
}

function serializeProviderOptions(
  providerOptions?: ChatMessageProviderOptions
): string | undefined {
  if (!providerOptions) {
    return undefined
  }

  return JSON.stringify(providerOptions)
}

function updateReasoningMetadata(state: StreamState, start: number, end: number): void {
  const relativeStart = Math.max(0, start - state.startTime)
  const relativeEnd = Math.max(0, end - state.startTime)

  if (state.metadata.reasoningStartTime === undefined) {
    state.metadata.reasoningStartTime = relativeStart
  }
  state.metadata.reasoningEndTime = relativeEnd
}

/**
 * Apply a single stream event to the accumulator state.
 * Pure block mutations only — no I/O, no finalization, no emit.
 */
export function accumulate(state: StreamState, event: LLMCoreStreamEvent): void {
  switch (event.type) {
    case 'text': {
      if (state.firstTokenTime === null) state.firstTokenTime = Date.now()
      const block = getCurrentBlock(state.blocks, 'content', event.provider_options)
      block.content += event.content
      state.dirty = true
      break
    }
    case 'reasoning': {
      const currentTime = Date.now()
      if (state.firstTokenTime === null) state.firstTokenTime = currentTime
      const block = getCurrentBlock(state.blocks, 'reasoning_content', event.provider_options)
      block.content += event.reasoning_content
      if (
        typeof block.reasoning_time !== 'object' ||
        block.reasoning_time === null ||
        typeof block.reasoning_time.start !== 'number' ||
        typeof block.reasoning_time.end !== 'number'
      ) {
        block.reasoning_time = {
          start: currentTime,
          end: currentTime
        }
      } else {
        block.reasoning_time.end = currentTime
      }
      const reasoningTime = block.reasoning_time as { start: number; end: number }
      updateReasoningMetadata(state, reasoningTime.start, reasoningTime.end)
      state.dirty = true
      break
    }
    case 'plan': {
      if (finalizeTrailingPendingNarrativeBlocks(state.blocks)) {
        state.dirty = true
      }
      const revision = event.revision ?? (state.latestAgentPlanSnapshot?.revision ?? 0) + 1
      state.latestAgentPlanSnapshot = {
        sessionId: '',
        plan: event.plan,
        ...(event.explanation ? { explanation: event.explanation } : {}),
        revision,
        updatedAt: event.updatedAt ?? new Date().toISOString(),
        ...(event.terminalReason ? { terminalReason: event.terminalReason } : {})
      }
      break
    }
    case 'tool_call_start': {
      finalizeTrailingPendingNarrativeBlocks(state.blocks)
      const providerOptionsJson = serializeProviderOptions(event.provider_options)
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
        },
        ...(providerOptionsJson ? { extra: { providerOptionsJson } } : {})
      }
      state.blocks.push(toolBlock)
      state.pendingToolCalls.set(event.tool_call_id, {
        name: event.tool_call_name,
        arguments: '',
        blockIndex: state.blocks.length - 1,
        executionOwner: event.tool_call_execution_owner ?? 'deepchat',
        providerOptions: event.provider_options
      })
      state.dirty = true
      break
    }
    case 'tool_call_chunk': {
      const pending = state.pendingToolCalls.get(event.tool_call_id)
      if (pending) {
        pending.arguments += event.tool_call_arguments_chunk
        if (!pending.providerOptions && event.provider_options) {
          pending.providerOptions = event.provider_options
        }
        const block = state.blocks[pending.blockIndex]
        if (block?.tool_call) {
          block.tool_call.params = pending.arguments
          if (event.provider_options) {
            block.extra = {
              ...block.extra,
              providerOptionsJson: serializeProviderOptions(event.provider_options)
            }
          }
        }
        state.dirty = true
      }
      break
    }
    case 'tool_call_end': {
      const pending = state.pendingToolCalls.get(event.tool_call_id)
      if (pending) {
        const finalArgs = event.tool_call_arguments_complete ?? pending.arguments
        const providerOptions = event.provider_options ?? pending.providerOptions
        pending.arguments = finalArgs
        const block = state.blocks[pending.blockIndex]
        if (block?.tool_call) {
          block.tool_call.params = finalArgs
          if (event.tool_call_response !== undefined) {
            block.tool_call.response = event.tool_call_response
          }
          if (event.tool_call_status) {
            block.status = event.tool_call_status
          }
          block.extra = {
            ...block.extra,
            toolCallArgsComplete: true,
            ...(providerOptions
              ? { providerOptionsJson: serializeProviderOptions(providerOptions) }
              : {})
          }
        }
        if (pending.executionOwner === 'deepchat') {
          state.completedToolCalls.push({
            id: event.tool_call_id,
            name: pending.name,
            arguments: finalArgs,
            ...(providerOptions ? { providerOptions } : {})
          })
        }
        state.pendingToolCalls.delete(event.tool_call_id)
        state.dirty = true
      }
      break
    }
    case 'image_data': {
      finalizeTrailingPendingNarrativeBlocks(state.blocks)
      if (state.firstTokenTime === null) state.firstTokenTime = Date.now()
      const block: AssistantMessageBlock = {
        type: 'image',
        status: 'success',
        timestamp: Date.now(),
        image_data: {
          data: event.image_data.data,
          mimeType: event.image_data.mimeType
        }
      }
      state.blocks.push(block)
      state.dirty = true
      break
    }
    case 'usage': {
      // Providers may emit more than one cumulative usage snapshot for a request. Keep only the
      // latest snapshot for this provider round; processStream commits it once before the next round.
      state.roundUsage = {
        inputTokens: event.usage.prompt_tokens,
        outputTokens: event.usage.completion_tokens,
        totalTokens: event.usage.total_tokens,
        cachedInputTokens: event.usage.cached_tokens,
        cacheWriteInputTokens: event.usage.cache_write_tokens
      }
      break
    }
    case 'stop': {
      // Keep an explicit stream error terminal reason even if the provider later emits a
      // generic complete stop after the error event.
      if (state.stopReason !== 'error') {
        state.stopReason = event.stop_reason
      }
      break
    }
    case 'error': {
      finalizeTrailingPendingNarrativeBlocks(state.blocks)
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
