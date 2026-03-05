import { describe, it, expect, beforeEach } from 'vitest'
import { accumulate } from '@/presenter/deepchatAgentPresenter/accumulator'
import { createState } from '@/presenter/deepchatAgentPresenter/types'
import type { StreamState } from '@/presenter/deepchatAgentPresenter/types'

describe('accumulate', () => {
  let state: StreamState

  beforeEach(() => {
    state = createState()
  })

  it('coalesces text events into a single content block', () => {
    accumulate(state, { type: 'text', content: 'Hello ' })
    accumulate(state, { type: 'text', content: 'world' })

    expect(state.blocks).toHaveLength(1)
    expect(state.blocks[0].type).toBe('content')
    expect(state.blocks[0].content).toBe('Hello world')
    expect(state.blocks[0].status).toBe('pending')
  })

  it('coalesces reasoning events into a single reasoning_content block', () => {
    accumulate(state, { type: 'reasoning', reasoning_content: 'Think ' })
    accumulate(state, { type: 'reasoning', reasoning_content: 'more' })

    expect(state.blocks).toHaveLength(1)
    expect(state.blocks[0].type).toBe('reasoning_content')
    expect(state.blocks[0].content).toBe('Think more')
  })

  it('creates separate blocks for different types', () => {
    accumulate(state, { type: 'reasoning', reasoning_content: 'Thinking...' })
    accumulate(state, { type: 'text', content: 'Answer' })

    expect(state.blocks).toHaveLength(2)
    expect(state.blocks[0].type).toBe('reasoning_content')
    expect(state.blocks[1].type).toBe('content')
  })

  it('handles tool_call_start → push block and pending', () => {
    accumulate(state, {
      type: 'tool_call_start',
      tool_call_id: 'tc1',
      tool_call_name: 'get_weather'
    })

    expect(state.blocks).toHaveLength(1)
    expect(state.blocks[0].type).toBe('tool_call')
    expect(state.blocks[0].tool_call).toEqual({
      id: 'tc1',
      name: 'get_weather',
      params: '',
      response: ''
    })
    expect(state.pendingToolCalls.size).toBe(1)
  })

  it('handles tool_call_chunk → accumulates arguments', () => {
    accumulate(state, {
      type: 'tool_call_start',
      tool_call_id: 'tc1',
      tool_call_name: 'search'
    })
    accumulate(state, {
      type: 'tool_call_chunk',
      tool_call_id: 'tc1',
      tool_call_arguments_chunk: '{"q":'
    })
    accumulate(state, {
      type: 'tool_call_chunk',
      tool_call_id: 'tc1',
      tool_call_arguments_chunk: '"test"}'
    })

    expect(state.blocks[0].tool_call!.params).toBe('{"q":"test"}')
  })

  it('handles tool_call_end → moves to completedToolCalls', () => {
    accumulate(state, {
      type: 'tool_call_start',
      tool_call_id: 'tc1',
      tool_call_name: 'search'
    })
    accumulate(state, {
      type: 'tool_call_chunk',
      tool_call_id: 'tc1',
      tool_call_arguments_chunk: '{"q":"test"}'
    })
    accumulate(state, { type: 'tool_call_end', tool_call_id: 'tc1' })

    expect(state.pendingToolCalls.size).toBe(0)
    expect(state.completedToolCalls).toHaveLength(1)
    expect(state.completedToolCalls[0]).toEqual({
      id: 'tc1',
      name: 'search',
      arguments: '{"q":"test"}'
    })
  })

  it('tool_call_end with complete args overrides accumulated chunks', () => {
    accumulate(state, {
      type: 'tool_call_start',
      tool_call_id: 'tc1',
      tool_call_name: 'search'
    })
    accumulate(state, {
      type: 'tool_call_chunk',
      tool_call_id: 'tc1',
      tool_call_arguments_chunk: 'partial'
    })
    accumulate(state, {
      type: 'tool_call_end',
      tool_call_id: 'tc1',
      tool_call_arguments_complete: '{"q":"full"}'
    })

    expect(state.completedToolCalls[0].arguments).toBe('{"q":"full"}')
    expect(state.blocks[0].tool_call!.params).toBe('{"q":"full"}')
  })

  it('usage sets metadata', () => {
    accumulate(state, {
      type: 'usage',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    })

    expect(state.metadata.inputTokens).toBe(10)
    expect(state.metadata.outputTokens).toBe(5)
    expect(state.metadata.totalTokens).toBe(15)
  })

  it('stop sets stopReason', () => {
    accumulate(state, { type: 'stop', stop_reason: 'tool_use' })
    expect(state.stopReason).toBe('tool_use')

    state.stopReason = 'complete'
    accumulate(state, { type: 'stop', stop_reason: 'max_tokens' })
    expect(state.stopReason).toBe('max_tokens')
  })

  it('error pushes error block and marks pending blocks as error', () => {
    accumulate(state, { type: 'text', content: 'Partial' })
    accumulate(state, { type: 'error', error_message: 'Rate limit' })

    expect(state.blocks).toHaveLength(2)
    expect(state.blocks[0].status).toBe('error')
    expect(state.blocks[1].type).toBe('error')
    expect(state.blocks[1].content).toBe('Rate limit')
    expect(state.blocks[1].status).toBe('error')
    expect(state.stopReason).toBe('error')
  })

  it('sets dirty flag on block mutations', () => {
    expect(state.dirty).toBe(false)

    accumulate(state, { type: 'text', content: 'hi' })
    expect(state.dirty).toBe(true)

    state.dirty = false
    accumulate(state, {
      type: 'usage',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    })
    // usage does not set dirty (no block mutation)
    expect(state.dirty).toBe(false)
  })

  it('sets firstTokenTime once on first text event', () => {
    expect(state.firstTokenTime).toBeNull()

    accumulate(state, { type: 'text', content: 'a' })
    const first = state.firstTokenTime

    expect(first).not.toBeNull()

    accumulate(state, { type: 'text', content: 'b' })
    expect(state.firstTokenTime).toBe(first)
  })

  it('sets firstTokenTime on first reasoning event', () => {
    accumulate(state, { type: 'reasoning', reasoning_content: 'think' })
    expect(state.firstTokenTime).not.toBeNull()
  })

  it('ignores unknown event types', () => {
    const blocksBefore = state.blocks.length
    accumulate(state, { type: 'permission', permission: {} } as any)
    expect(state.blocks.length).toBe(blocksBefore)
  })
})
