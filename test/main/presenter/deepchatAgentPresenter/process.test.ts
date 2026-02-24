import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { ProcessParams } from '@/presenter/deepchatAgentPresenter/types'

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

import { processStream } from '@/presenter/deepchatAgentPresenter/process'
import { eventBus } from '@/eventbus'

function createMockMessageStore() {
  return {
    updateAssistantContent: vi.fn(),
    finalizeAssistantMessage: vi.fn(),
    setMessageError: vi.fn()
  } as any
}

function makeTool(name: string): MCPToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: `Tool ${name}`,
      parameters: { type: 'object', properties: {} }
    },
    server: { name: 'test-server', icons: '', description: 'Test server' }
  }
}

function createMockToolPresenter(responses: Record<string, string> = {}): IToolPresenter {
  return {
    getAllToolDefinitions: vi.fn().mockResolvedValue([]),
    callTool: vi.fn(async (request) => {
      const name = request.function.name
      const responseText = responses[name] ?? `result for ${name}`
      return {
        content: responseText,
        rawData: { toolCallId: request.id, content: responseText, isError: false }
      }
    }),
    buildToolSystemPrompt: vi.fn().mockReturnValue('')
  } as unknown as IToolPresenter
}

function makeStreamEvents(...events: LLMCoreStreamEvent[]): LLMCoreStreamEvent[] {
  return events
}

describe('processStream', () => {
  let messageStore: ReturnType<typeof createMockMessageStore>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    messageStore = createMockMessageStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createParams(overrides: Partial<ProcessParams> = {}): ProcessParams {
    const tools: MCPToolDefinition[] = []
    const toolPresenter = createMockToolPresenter()

    const coreStream = vi.fn(function* () {
      yield* makeStreamEvents(
        { type: 'text', content: 'Hello' },
        { type: 'stop', stop_reason: 'complete' }
      )
    }) as unknown as ProcessParams['coreStream']

    return {
      messages: [{ role: 'user', content: 'Hello' }],
      tools,
      toolPresenter,
      coreStream,
      modelId: 'gpt-4',
      modelConfig: {} as any,
      temperature: 0.7,
      maxTokens: 4096,
      io: {
        sessionId: 's1',
        messageId: 'm1',
        messageStore,
        abortSignal: new AbortController().signal
      },
      ...overrides
    }
  }

  it('no tools → single stream, finalize', async () => {
    const params = createParams()
    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(params.coreStream).toHaveBeenCalledTimes(1)
    expect(messageStore.finalizeAssistantMessage).toHaveBeenCalled()
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith('stream:end', 'all', {
      conversationId: 's1'
    })
  })

  it('single tool call → loop once, finalize', async () => {
    let callCount = 0
    const coreStream = vi.fn(function () {
      callCount++
      if (callCount === 1) {
        return (async function* () {
          yield {
            type: 'tool_call_start',
            tool_call_id: 'tc1',
            tool_call_name: 'get_weather'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'tc1',
            tool_call_arguments_complete: '{}'
          } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      } else {
        return (async function* () {
          yield { type: 'text', content: 'The weather is sunny.' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as ProcessParams['coreStream']

    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny, 72F' })
    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('get_weather')]
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(coreStream).toHaveBeenCalledTimes(2)
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(1)
    expect(messageStore.finalizeAssistantMessage).toHaveBeenCalled()

    // Second call should have tool result in messages
    const secondCallMessages = (coreStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
    const toolResultMsg = secondCallMessages.find((m: any) => m.role === 'tool')
    expect(toolResultMsg).toBeDefined()
    expect(toolResultMsg.content).toBe('Sunny, 72F')
  })

  it('multiple tool calls in one turn', async () => {
    let callCount = 0
    const toolPresenter = createMockToolPresenter({
      get_weather: 'Sunny',
      get_time: '3:00 PM'
    })

    const coreStream = vi.fn(function () {
      callCount++
      if (callCount === 1) {
        return (async function* () {
          yield {
            type: 'tool_call_start',
            tool_call_id: 'tc1',
            tool_call_name: 'get_weather'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'tc1',
            tool_call_arguments_complete: '{}'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_start',
            tool_call_id: 'tc2',
            tool_call_name: 'get_time'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'tc2',
            tool_call_arguments_complete: '{}'
          } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      } else {
        return (async function* () {
          yield { type: 'text', content: 'Done' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('get_weather'), makeTool('get_time')]
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(toolPresenter.callTool).toHaveBeenCalledTimes(2)
    expect(coreStream).toHaveBeenCalledTimes(2)
  })

  it('multi-turn tool loop', async () => {
    let callCount = 0
    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny' })

    const coreStream = vi.fn(function () {
      callCount++
      if (callCount <= 2) {
        return (async function* () {
          yield {
            type: 'tool_call_start',
            tool_call_id: `tc${callCount}`,
            tool_call_name: 'get_weather'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: `tc${callCount}`,
            tool_call_arguments_complete: `{"round":${callCount}}`
          } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      } else {
        return (async function* () {
          yield { type: 'text', content: 'Final answer' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('get_weather')]
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(coreStream).toHaveBeenCalledTimes(3)
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(2)
  })

  it('max tool calls limit', async () => {
    let callCount = 0
    const toolPresenter = createMockToolPresenter({ action: 'done' })

    const coreStream = vi.fn(function () {
      callCount++
      return (async function* () {
        yield {
          type: 'tool_call_start',
          tool_call_id: `tc${callCount}`,
          tool_call_name: 'action'
        } as LLMCoreStreamEvent
        yield {
          type: 'tool_call_end',
          tool_call_id: `tc${callCount}`,
          tool_call_arguments_complete: '{}'
        } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('action')]
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(
      (toolPresenter.callTool as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBeLessThanOrEqual(128)
    expect((coreStream as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(129)
  })

  it('abort during stream', async () => {
    const abortController = new AbortController()

    const coreStream = vi.fn(function () {
      return (async function* () {
        yield { type: 'text', content: 'First' } as LLMCoreStreamEvent
        abortController.abort()
        yield { type: 'text', content: 'Second' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      io: {
        sessionId: 's1',
        messageId: 'm1',
        messageStore,
        abortSignal: abortController.signal
      }
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(messageStore.setMessageError).toHaveBeenCalled()
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith('stream:error', 'all', {
      conversationId: 's1',
      error: 'Generation cancelled'
    })
  })

  it('abort during tool execution', async () => {
    const abortController = new AbortController()
    let callCount = 0
    const toolPresenter = createMockToolPresenter()

    ;(toolPresenter.callTool as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      abortController.abort()
      return { content: 'ok', rawData: { toolCallId: 'tc1', content: 'ok', isError: false } }
    })

    const coreStream = vi.fn(function () {
      callCount++
      if (callCount === 1) {
        return (async function* () {
          yield {
            type: 'tool_call_start',
            tool_call_id: 'tc1',
            tool_call_name: 'action'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'tc1',
            tool_call_arguments_complete: '{}'
          } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      } else {
        return (async function* () {
          yield { type: 'text', content: 'Should not reach' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('action')],
      io: {
        sessionId: 's1',
        messageId: 'm1',
        messageStore,
        abortSignal: abortController.signal
      }
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(toolPresenter.callTool).toHaveBeenCalledTimes(1)
    // Should still finalize (abort detected after executeTools, before next loop)
    expect(messageStore.finalizeAssistantMessage).toHaveBeenCalled()
  })

  it('stream error event → finalizeError', async () => {
    const coreStream = vi.fn(function* () {
      yield { type: 'text', content: 'Partial' } as LLMCoreStreamEvent
      yield { type: 'error', error_message: 'Rate limit exceeded' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({ coreStream })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    // Error event is accumulated into blocks, stop_reason becomes 'error'.
    // Since stop_reason != 'tool_use', it breaks out and calls finalize.
    // The error block was already accumulated by the accumulator.
    // finalize marks remaining pending blocks as success.
    // This matches the v2 behavior where error events from the stream
    // still lead to finalization (blocks contain the error block).
    expect(messageStore.finalizeAssistantMessage).toHaveBeenCalled()
  })

  it('stream exception → catch finalizeError', async () => {
    const coreStream = vi.fn(function () {
      return (async function* () {
        yield { type: 'text', content: 'Start' } as LLMCoreStreamEvent
        throw new Error('Connection lost')
      })()
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({ coreStream })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(messageStore.setMessageError).toHaveBeenCalled()
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith('stream:error', 'all', {
      conversationId: 's1',
      error: 'Connection lost'
    })
  })
})
