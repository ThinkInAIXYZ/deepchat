import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { DeepChatMessageStore } from '@/presenter/deepchatAgentPresenter/messageStore'

// Mock eventBus before importing handleStream
vi.mock('@/eventbus', () => ({
  eventBus: { sendToRenderer: vi.fn() },
  SendTarget: { ALL_WINDOWS: 'all' }
}))

vi.mock('@/events', () => ({
  STREAM_EVENTS: {
    RESPONSE: 'stream:response',
    END: 'stream:end',
    ERROR: 'stream:error'
  }
}))

import { handleStream, type StreamContext } from '@/presenter/deepchatAgentPresenter/streamHandler'
import { eventBus } from '@/eventbus'

function createMockMessageStore(): DeepChatMessageStore {
  return {
    updateAssistantContent: vi.fn(),
    finalizeAssistantMessage: vi.fn(),
    setMessageError: vi.fn()
  } as unknown as DeepChatMessageStore
}

async function* createStream(events: LLMCoreStreamEvent[]): AsyncGenerator<LLMCoreStreamEvent> {
  for (const event of events) {
    yield event
  }
}

function createContext(overrides?: Partial<StreamContext>): StreamContext {
  return {
    sessionId: 's1',
    messageId: 'm1',
    messageStore: createMockMessageStore(),
    abortSignal: new AbortController().signal,
    ...overrides
  }
}

describe('streamHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accumulates text events into content blocks', async () => {
    const context = createContext()
    const stream = createStream([
      { type: 'text', content: 'Hello ' },
      { type: 'text', content: 'world' },
      { type: 'stop', stop_reason: 'end_turn' }
    ])

    await handleStream(stream, context)

    // finalizeAssistantMessage should be called with accumulated blocks
    const finalizeCall = (context.messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0]
    expect(finalizeCall[0]).toBe('m1')
    const blocks = finalizeCall[1]
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('content')
    expect(blocks[0].content).toBe('Hello world')
    expect(blocks[0].status).toBe('success')
  })

  it('accumulates reasoning events into reasoning_content blocks', async () => {
    const context = createContext()
    const stream = createStream([
      { type: 'reasoning', reasoning_content: 'Thinking...' },
      { type: 'reasoning', reasoning_content: ' more thoughts' },
      { type: 'text', content: 'Answer' },
      { type: 'stop', stop_reason: 'end_turn' }
    ])

    await handleStream(stream, context)

    const blocks = (context.messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][1]
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('reasoning_content')
    expect(blocks[0].content).toBe('Thinking... more thoughts')
    expect(blocks[1].type).toBe('content')
    expect(blocks[1].content).toBe('Answer')
  })

  it('handles usage events and stores metadata', async () => {
    const context = createContext()
    const stream = createStream([
      { type: 'text', content: 'Hi' },
      { type: 'usage', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      { type: 'stop', stop_reason: 'end_turn' }
    ])

    await handleStream(stream, context)

    const metadataStr = (context.messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][2]
    const metadata = JSON.parse(metadataStr)
    expect(metadata.inputTokens).toBe(10)
    expect(metadata.outputTokens).toBe(5)
    expect(metadata.totalTokens).toBe(15)
  })

  it('handles error events from the stream', async () => {
    const context = createContext()
    const stream = createStream([
      { type: 'text', content: 'Partial' },
      { type: 'error', error_message: 'Rate limit exceeded' }
    ])

    await handleStream(stream, context)

    const errorCall = (context.messageStore.setMessageError as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(errorCall[0]).toBe('m1')
    const blocks = errorCall[1]
    // Should have content block (marked error) + error block
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    const errorBlock = blocks.find((b: any) => b.type === 'error')
    expect(errorBlock.content).toBe('Rate limit exceeded')
    expect(errorBlock.status).toBe('error')

    // Content block should also be marked error
    const contentBlock = blocks.find((b: any) => b.type === 'content')
    expect(contentBlock.status).toBe('error')

    // STREAM_EVENTS.ERROR should be emitted
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith('stream:error', 'all', {
      conversationId: 's1',
      error: 'Rate limit exceeded'
    })
  })

  it('handles stream exceptions (thrown errors)', async () => {
    const context = createContext()

    async function* failingStream(): AsyncGenerator<LLMCoreStreamEvent> {
      yield { type: 'text', content: 'Start' } as LLMCoreStreamEvent
      throw new Error('Connection lost')
    }

    await handleStream(failingStream(), context)

    expect(context.messageStore.setMessageError).toHaveBeenCalled()
    const blocks = (context.messageStore.setMessageError as ReturnType<typeof vi.fn>).mock
      .calls[0][1]
    const errorBlock = blocks.find((b: any) => b.type === 'error')
    expect(errorBlock.content).toBe('Connection lost')
  })

  it('handles abort signal cancellation', async () => {
    const abortController = new AbortController()
    const context = createContext({ abortSignal: abortController.signal })

    async function* slowStream(): AsyncGenerator<LLMCoreStreamEvent> {
      yield { type: 'text', content: 'First' } as LLMCoreStreamEvent
      // Abort before next event
      abortController.abort()
      yield { type: 'text', content: 'Second' } as LLMCoreStreamEvent
    }

    await handleStream(slowStream(), context)

    expect(context.messageStore.setMessageError).toHaveBeenCalled()
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith('stream:error', 'all', {
      conversationId: 's1',
      error: 'Generation cancelled'
    })
  })

  it('emits STREAM_EVENTS.END on successful stop', async () => {
    const context = createContext()
    const stream = createStream([
      { type: 'text', content: 'Done' },
      { type: 'stop', stop_reason: 'end_turn' }
    ])

    await handleStream(stream, context)

    expect(eventBus.sendToRenderer).toHaveBeenCalledWith('stream:end', 'all', {
      conversationId: 's1'
    })
  })

  it('emits STREAM_EVENTS.RESPONSE with blocks on renderer flush', async () => {
    const context = createContext()
    const stream = createStream([
      { type: 'text', content: 'Hello' },
      { type: 'stop', stop_reason: 'end_turn' }
    ])

    await handleStream(stream, context)

    // After stop, a final flushToRenderer is called
    const responseCalls = (eventBus.sendToRenderer as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: any[]) => c[0] === 'stream:response'
    )
    expect(responseCalls.length).toBeGreaterThanOrEqual(1)
    expect(responseCalls[0][2].conversationId).toBe('s1')
    expect(responseCalls[0][2].blocks).toBeDefined()
  })

  it('handles stream that ends without explicit stop event', async () => {
    const context = createContext()
    const stream = createStream([{ type: 'text', content: 'No stop event' }])

    await handleStream(stream, context)

    // Should still finalize
    expect(context.messageStore.finalizeAssistantMessage).toHaveBeenCalled()
    const blocks = (context.messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][1]
    expect(blocks[0].status).toBe('success')
  })

  it('batched DB flush is triggered by timer', async () => {
    const context = createContext()

    // Create a stream that yields events with delays
    let resolveYield: (() => void) | null = null

    async function* timedStream(): AsyncGenerator<LLMCoreStreamEvent> {
      yield { type: 'text', content: 'chunk1' } as LLMCoreStreamEvent
      // Wait for timer to fire
      await new Promise<void>((r) => {
        resolveYield = r
      })
      yield { type: 'stop', stop_reason: 'end_turn' } as LLMCoreStreamEvent
    }

    const promise = handleStream(timedStream(), context)

    // Advance past DB flush interval (600ms)
    await vi.advanceTimersByTimeAsync(650)

    // DB should have been flushed
    expect(context.messageStore.updateAssistantContent).toHaveBeenCalled()

    // Resolve the stream
    resolveYield?.()
    await promise
  })
})
