import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { DeepChatMessageStore } from '@/presenter/deepchatAgentPresenter/messageStore'

// Mock eventBus before importing agentLoop
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

import { agentLoop, type AgentLoopParams } from '@/presenter/deepchatAgentPresenter/agentLoop'
import { eventBus } from '@/eventbus'

function createMockMessageStore(): DeepChatMessageStore {
  return {
    updateAssistantContent: vi.fn(),
    finalizeAssistantMessage: vi.fn(),
    setMessageError: vi.fn()
  } as unknown as DeepChatMessageStore
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
        rawData: {
          toolCallId: request.id,
          content: responseText,
          isError: false
        }
      }
    }),
    buildToolSystemPrompt: vi.fn().mockReturnValue('')
  } as unknown as IToolPresenter
}

function makeStreamEvents(...events: LLMCoreStreamEvent[]): LLMCoreStreamEvent[] {
  return events
}

describe('agentLoop', () => {
  let messageStore: DeepChatMessageStore

  beforeEach(() => {
    vi.clearAllMocks()
    messageStore = createMockMessageStore()
  })

  function createParams(overrides: Partial<AgentLoopParams> = {}): AgentLoopParams {
    const tools = [makeTool('get_weather')]
    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny, 72F' })

    // Default: simple text response with no tool use
    let callCount = 0
    const coreStream = vi.fn(function* () {
      callCount++
      if (callCount === 1) {
        yield* makeStreamEvents(
          { type: 'text', content: 'Hello' },
          { type: 'stop', stop_reason: 'complete' }
        )
      }
    }) as unknown as AgentLoopParams['coreStream']

    return {
      messages: [{ role: 'user', content: 'Hello' }],
      tools,
      toolPresenter,
      coreStream,
      modelId: 'gpt-4',
      modelConfig: {},
      temperature: 0.7,
      maxTokens: 4096,
      streamContext: {
        sessionId: 's1',
        messageId: 'm1',
        messageStore,
        abortSignal: new AbortController().signal
      },
      ...overrides
    }
  }

  it('no tool calls - single coreStream call, no loop', async () => {
    const coreStream = vi.fn(function* () {
      yield { type: 'text', content: 'Just text' } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
    }) as unknown as AgentLoopParams['coreStream']

    const params = createParams({ coreStream, tools: [] })
    await agentLoop(params)

    expect(coreStream).toHaveBeenCalledTimes(1)
    expect(params.toolPresenter.callTool).not.toHaveBeenCalled()
  })

  it('single tool call - loop executes tool, re-calls coreStream, gets final answer', async () => {
    let callCount = 0
    const coreStream = vi.fn(function () {
      callCount++
      if (callCount === 1) {
        // First call: LLM requests a tool
        return (async function* () {
          yield {
            type: 'tool_call_start',
            tool_call_id: 'tc1',
            tool_call_name: 'get_weather'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_chunk',
            tool_call_id: 'tc1',
            tool_call_arguments_chunk: '{"city":"SF"}'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'tc1'
          } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      } else {
        // Second call: LLM gives final answer after receiving tool result
        return (async function* () {
          yield { type: 'text', content: 'The weather is sunny.' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as AgentLoopParams['coreStream']

    const params = createParams({ coreStream })
    await agentLoop(params)

    // coreStream called twice: initial + after tool result
    expect(coreStream).toHaveBeenCalledTimes(2)

    // Tool was called
    expect(params.toolPresenter.callTool).toHaveBeenCalledTimes(1)
    expect(params.toolPresenter.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'tc1',
        function: { name: 'get_weather', arguments: '{"city":"SF"}' }
      })
    )

    // Second coreStream call should include tool result in messages
    const secondCallMessages = (coreStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
    expect(secondCallMessages.length).toBeGreaterThan(1)
    // Should have the original user message, assistant with tool_calls, and tool result
    const toolResultMsg = secondCallMessages.find((m: any) => m.role === 'tool')
    expect(toolResultMsg).toBeDefined()
    expect(toolResultMsg.tool_call_id).toBe('tc1')
    expect(toolResultMsg.content).toBe('Sunny, 72F')
  })

  it('multiple tool calls in one turn - all executed, results appended', async () => {
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
    }) as unknown as AgentLoopParams['coreStream']

    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('get_weather'), makeTool('get_time')]
    })
    await agentLoop(params)

    expect(toolPresenter.callTool).toHaveBeenCalledTimes(2)
    expect(coreStream).toHaveBeenCalledTimes(2)

    // Second call messages should have both tool results
    const secondCallMessages = (coreStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
    const toolResults = secondCallMessages.filter((m: any) => m.role === 'tool')
    expect(toolResults).toHaveLength(2)
    expect(toolResults[0].content).toBe('Sunny')
    expect(toolResults[1].content).toBe('3:00 PM')
  })

  it('multi-turn tool loop - LLM calls tools twice before final answer', async () => {
    let callCount = 0
    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny' })

    const coreStream = vi.fn(function () {
      callCount++
      if (callCount <= 2) {
        // First two calls: LLM requests tools
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
        // Third call: final answer
        return (async function* () {
          yield { type: 'text', content: 'Final answer' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as AgentLoopParams['coreStream']

    const params = createParams({ coreStream, toolPresenter })
    await agentLoop(params)

    expect(coreStream).toHaveBeenCalledTimes(3)
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(2)
  })

  it('max tool calls limit - loop stops at limit', async () => {
    // We'll simulate a loop that wants 200+ tool calls
    let callCount = 0
    const toolPresenter = createMockToolPresenter({ action: 'done' })

    const coreStream = vi.fn(function () {
      callCount++
      // Always request a tool
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
    }) as unknown as AgentLoopParams['coreStream']

    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('action')]
    })
    await agentLoop(params)

    // Should stop at 128 tool calls (MAX_TOOL_CALLS)
    expect(
      (toolPresenter.callTool as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBeLessThanOrEqual(128)
    // And coreStream should not be called more than 129 times (128 loops + 1 that triggers the limit)
    expect((coreStream as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(129)
  })

  it('abort signal - loop stops mid-execution', async () => {
    const abortController = new AbortController()
    let callCount = 0
    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny' })

    // Make callTool abort on first call
    ;(toolPresenter.callTool as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      abortController.abort()
      return {
        content: 'Sunny',
        rawData: { toolCallId: 'tc1', content: 'Sunny', isError: false }
      }
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
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      } else {
        return (async function* () {
          yield { type: 'text', content: 'Should not get here' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as AgentLoopParams['coreStream']

    const params = createParams({
      coreStream,
      toolPresenter,
      streamContext: {
        sessionId: 's1',
        messageId: 'm1',
        messageStore,
        abortSignal: abortController.signal
      }
    })
    await agentLoop(params)

    // Tool was called once, then abort kicked in
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(1)
    // coreStream may be called twice (abort is detected inside handleStream on the second call)
    // but the loop should not continue further
    expect((coreStream as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('tool execution error - error text appended as tool result', async () => {
    let callCount = 0
    const toolPresenter = createMockToolPresenter()
    ;(toolPresenter.callTool as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Tool failed')
    )

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
          yield { type: 'text', content: 'Tool error handled' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as AgentLoopParams['coreStream']

    const params = createParams({ coreStream, toolPresenter })
    await agentLoop(params)

    // Second coreStream call should include error in tool result
    const secondCallMessages = (coreStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
    const toolResult = secondCallMessages.find((m: any) => m.role === 'tool')
    expect(toolResult.content).toBe('Error: Tool failed')
  })

  it('flushes blocks to renderer after each tool execution', async () => {
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
          yield { type: 'text', content: 'Done' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as AgentLoopParams['coreStream']

    const params = createParams({ coreStream })
    await agentLoop(params)

    // After tool execution, there should be a RESPONSE event with updated blocks
    const responseCalls = (eventBus.sendToRenderer as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: any[]) => c[0] === 'stream:response'
    )
    expect(responseCalls.length).toBeGreaterThanOrEqual(1)

    // DB should also be updated
    expect(messageStore.updateAssistantContent).toHaveBeenCalled()
  })

  it('accumulates blocks across loop iterations', async () => {
    let callCount = 0
    const coreStream = vi.fn(function () {
      callCount++
      if (callCount === 1) {
        // First iteration: text + tool call
        return (async function* () {
          yield { type: 'text', content: 'Checking...' } as LLMCoreStreamEvent
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
        // Second iteration: final answer
        return (async function* () {
          yield { type: 'text', content: 'The weather is sunny.' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as AgentLoopParams['coreStream']

    const params = createParams({ coreStream })
    await agentLoop(params)

    // The final RESPONSE event should have blocks from both iterations:
    // iteration 1: content("Checking...") + tool_call(tc1)
    // iteration 2: content("The weather is sunny.")
    const responseCalls = (eventBus.sendToRenderer as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: any[]) => c[0] === 'stream:response'
    )
    // Last response should have all blocks
    const lastResponse = responseCalls[responseCalls.length - 1]
    const blocks = lastResponse[2].blocks
    expect(blocks.length).toBe(3) // content + tool_call + content
    expect(blocks[0].type).toBe('content')
    expect(blocks[0].content).toBe('Checking...')
    expect(blocks[1].type).toBe('tool_call')
    expect(blocks[2].type).toBe('content')
    expect(blocks[2].content).toBe('The weather is sunny.')
  })

  it('enriches tool_call blocks with server info from tool definitions', async () => {
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
          yield { type: 'text', content: 'Done' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as AgentLoopParams['coreStream']

    const params = createParams({ coreStream })
    await agentLoop(params)

    // After tool execution, the tool_call block should have server info.
    // The enrichment happens after handleStream returns, so look at later
    // response events (from the agentLoop flush, not handleStream's own flush).
    const responseCalls = (eventBus.sendToRenderer as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: any[]) => c[0] === 'stream:response'
    )
    // Find the LAST response that has a tool_call block (post-enrichment)
    const toolBlockResponses = responseCalls.filter((c: any[]) => {
      const blocks = c[2].blocks
      return blocks.some((b: any) => b.type === 'tool_call')
    })
    expect(toolBlockResponses.length).toBeGreaterThanOrEqual(1)
    const lastToolBlockResponse = toolBlockResponses[toolBlockResponses.length - 1]
    const toolBlock = lastToolBlockResponse[2].blocks.find((b: any) => b.type === 'tool_call')
    expect(toolBlock.tool_call.server_name).toBe('test-server')
    expect(toolBlock.tool_call.server_description).toBe('Test server')
  })

  it('passes server property to callTool for routing', async () => {
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
          yield { type: 'text', content: 'Done' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    }) as unknown as AgentLoopParams['coreStream']

    const params = createParams({ coreStream })
    await agentLoop(params)

    // callTool should receive the server property from tool definitions
    expect(params.toolPresenter.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        server: { name: 'test-server', icons: '', description: 'Test server' }
      })
    )
  })
})
