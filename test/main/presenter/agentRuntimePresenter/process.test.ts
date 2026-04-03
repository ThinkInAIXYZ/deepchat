import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { ProcessParams } from '@/presenter/agentRuntimePresenter/types'
import { ToolOutputGuard } from '@/presenter/agentRuntimePresenter/toolOutputGuard'

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

vi.mock('@/presenter', () => ({
  presenter: {
    commandPermissionService: {
      extractCommandSignature: vi.fn().mockReturnValue('mock-signature'),
      approve: vi.fn()
    },
    filePermissionService: { approve: vi.fn() },
    settingsPermissionService: { approve: vi.fn() },
    mcpPresenter: {
      grantPermission: vi.fn().mockResolvedValue(undefined)
    }
  }
}))

import { processStream } from '@/presenter/agentRuntimePresenter/process'
import { eventBus } from '@/eventbus'

const DEFAULT_INTERLEAVED_REASONING = {
  preserveReasoningContent: false,
  forcedBySessionSetting: false,
  portraitInterleaved: false,
  reasoningSupported: false,
  providerDbSourceUrl: 'https://example.com/provider-db.json'
} as const

function createMockMessageStore() {
  return {
    addSearchResult: vi.fn(),
    getMessage: vi.fn().mockReturnValue(null),
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
  let tempHome: string | null = null
  let getPathSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    messageStore = createMockMessageStore()
  })

  afterEach(() => {
    vi.useRealTimers()
    getPathSpy?.mockRestore()
    getPathSpy = null
    if (tempHome) {
      return fs.rm(tempHome, { recursive: true, force: true }).then(() => {
        tempHome = null
      })
    }
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
      providerId: 'openai',
      modelId: 'gpt-4',
      modelConfig: {} as any,
      temperature: 0.7,
      maxTokens: 4096,
      interleavedReasoning: DEFAULT_INTERLEAVED_REASONING,
      permissionMode: 'full_access',
      toolOutputGuard: new ToolOutputGuard(),
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
    const finalMetadata = JSON.parse(
      (messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(finalMetadata.provider).toBe('openai')
    expect(finalMetadata.model).toBe('gpt-4')
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
      'stream:end',
      'all',
      expect.objectContaining({
        conversationId: 's1',
        messageId: 'm1',
        eventId: 'm1'
      })
    )
  })

  it('treats AbortError thrown before the first event as aborted without writing an error block', async () => {
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    const coreStream = vi.fn(async function* () {
      throw abortError
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({ coreStream })
    const promise = processStream(params)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toMatchObject({
      status: 'aborted',
      stopReason: 'user_stop',
      errorMessage: 'common.error.userCanceledGeneration'
    })
    expect(messageStore.setMessageError).not.toHaveBeenCalled()
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
    expect(eventBus.sendToRenderer).not.toHaveBeenCalledWith(
      'stream:error',
      'all',
      expect.anything()
    )
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

  it('offloads large tool results before the next provider call', async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-process-offload-'))
    getPathSpy = vi.spyOn(app, 'getPath').mockReturnValue(tempHome)

    let callCount = 0
    const longScreenshot = JSON.stringify({ data: 'x'.repeat(7000) })
    const coreStream = vi.fn(function () {
      callCount++
      if (callCount === 1) {
        return (async function* () {
          yield {
            type: 'tool_call_start',
            tool_call_id: 'function.cdp_send:11',
            tool_call_name: 'cdp_send'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'function.cdp_send:11',
            tool_call_arguments_complete: '{"method":"Page.captureScreenshot"}'
          } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      }
      return (async function* () {
        yield { type: 'text', content: 'Done' } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const toolPresenter = createMockToolPresenter({ cdp_send: longScreenshot })
    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('cdp_send')]
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    const secondCallMessages = (coreStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
    const toolResultMsg = secondCallMessages.find((m: any) => m.role === 'tool')
    expect(toolResultMsg.content).toContain('[Tool output offloaded]')
    expect(toolResultMsg.content).toMatch(/tool_function\.cdp_send_11(?:_[a-f0-9]+)?\.offload/)
    expect(toolResultMsg.content).not.toContain(':11.offload')
    expect(toolResultMsg.content).not.toContain(tempHome!)
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

  it('continues the next provider turn after downgrading an overflow tail tool result', async () => {
    let callCount = 0
    const toolPresenter = createMockToolPresenter()

    ;(toolPresenter.callTool as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        content: 'a'.repeat(60),
        rawData: { toolCallId: 'tc1', content: 'a'.repeat(60), isError: false }
      })
      .mockResolvedValueOnce({
        content: 'b'.repeat(4000),
        rawData: { toolCallId: 'tc2', content: 'b'.repeat(4000), isError: false }
      })

    const coreStream = vi.fn(function () {
      callCount++
      if (callCount === 1) {
        return (async function* () {
          yield {
            type: 'tool_call_start',
            tool_call_id: 'tc1',
            tool_call_name: 'read'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'tc1',
            tool_call_arguments_complete: '{"path":"a.txt"}'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_start',
            tool_call_id: 'tc2',
            tool_call_name: 'read'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'tc2',
            tool_call_arguments_complete: '{"path":"b.txt"}'
          } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      }

      return (async function* () {
        yield { type: 'text', content: 'Continued answer' } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('read')],
      modelConfig: { contextLength: 260 } as any,
      maxTokens: 32
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(coreStream).toHaveBeenCalledTimes(2)
    const secondCallMessages = (coreStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
    const toolMessages = secondCallMessages.filter((message: any) => message.role === 'tool')
    expect(toolMessages).toHaveLength(2)
    expect(toolMessages[0].content).toBe('a'.repeat(60))
    expect(toolMessages[1].content).toContain('remaining context window is too small')
    expect(messageStore.finalizeAssistantMessage).toHaveBeenCalled()
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

    expect(messageStore.setMessageError).toHaveBeenCalledWith(
      'm1',
      expect.any(Array),
      expect.any(String)
    )
    const abortMetadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(abortMetadata.provider).toBe('openai')
    expect(abortMetadata.model).toBe('gpt-4')
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
      'stream:error',
      'all',
      expect.objectContaining({
        conversationId: 's1',
        messageId: 'm1',
        eventId: 'm1',
        error: 'common.error.userCanceledGeneration'
      })
    )
  })

  it('does not finalize user-cancel twice when the message is already cancelled', async () => {
    const abortController = new AbortController()
    messageStore.getMessage.mockReturnValue({
      id: 'm1',
      role: 'assistant',
      status: 'error',
      content: JSON.stringify([
        {
          type: 'content',
          content: 'Partial',
          status: 'error',
          timestamp: Date.now()
        },
        {
          type: 'error',
          content: 'common.error.userCanceledGeneration',
          status: 'error',
          timestamp: Date.now()
        }
      ])
    })

    const coreStream = vi.fn(function () {
      return (async function* () {
        abortController.abort()
        yield { type: 'text', content: 'ignored' } as LLMCoreStreamEvent
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
    const result = await promise

    expect(result.status).toBe('aborted')
    expect(messageStore.setMessageError).not.toHaveBeenCalled()
    expect(eventBus.sendToRenderer).not.toHaveBeenCalledWith(
      'stream:error',
      'all',
      expect.objectContaining({
        conversationId: 's1',
        messageId: 'm1',
        eventId: 'm1',
        error: 'common.error.userCanceledGeneration'
      })
    )
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
    expect(messageStore.setMessageError).toHaveBeenCalled()
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
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

  it('context window error event is finalized as an error', async () => {
    const coreStream = vi.fn(function* () {
      yield {
        type: 'error',
        error_message: 'maximum context length exceeded'
      } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({ coreStream })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(messageStore.setMessageError).toHaveBeenCalled()
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
  })

  it('terminal tool output failure stops before the next provider call', async () => {
    const coreStream = vi.fn(function () {
      return (async function* () {
        yield {
          type: 'tool_call_start',
          tool_call_id: 'tc1',
          tool_call_name: 'cdp_send'
        } as LLMCoreStreamEvent
        yield {
          type: 'tool_call_end',
          tool_call_id: 'tc1',
          tool_call_arguments_complete: '{"method":"Page.captureScreenshot"}'
        } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const longScreenshot = JSON.stringify({ data: 'x'.repeat(7000) })
    const toolPresenter = createMockToolPresenter({ cdp_send: longScreenshot })
    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('cdp_send')],
      modelConfig: { contextLength: 1 } as any,
      maxTokens: 1
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.status).toBe('error')
    expect(result.terminalError).toContain('remaining context window is too small')
    expect(coreStream).toHaveBeenCalledTimes(1)
    expect(messageStore.setMessageError).toHaveBeenCalled()
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
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
      'stream:error',
      'all',
      expect.objectContaining({
        conversationId: 's1',
        messageId: 'm1',
        eventId: 'm1',
        error: 'Connection lost'
      })
    )
  })
})
