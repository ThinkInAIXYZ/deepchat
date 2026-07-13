import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { ProcessParams } from '@/presenter/agentRuntimePresenter/types'
import { ToolOutputGuard } from '@/presenter/agentRuntimePresenter/toolOutputGuard'
import { NoProgressToolLoopGuard } from '@/presenter/agentRuntimePresenter/noProgressToolLoopGuard'
import { ToolPresenter } from '@/presenter/toolPresenter'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

vi.mock('@/eventbus', () => ({
  eventBus: {}
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

function expectDeepchatEvent(eventName: string, payload: Record<string, unknown>): void {
  expect(publishDeepchatEventMock).toHaveBeenCalledWith(eventName, expect.objectContaining(payload))
}

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
    setMessageError: vi.fn(),
    appendAssistantToolFactsSnapshot: vi.fn()
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
  let homeDirSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    messageStore = createMockMessageStore()
  })

  afterEach(() => {
    vi.useRealTimers()
    homeDirSpy?.mockRestore()
    homeDirSpy = null
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
        requestId: 'req-1',
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
    expectDeepchatEvent('chat.stream.completed', {
      sessionId: 's1',
      messageId: 'm1',
      requestId: 'req-1'
    })
  })

  it('uses the latest cumulative usage snapshot within one provider round', async () => {
    const coreStream = vi.fn(async function* () {
      yield {
        type: 'usage',
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
      } as LLMCoreStreamEvent
      yield {
        type: 'usage',
        usage: {
          prompt_tokens: 6,
          completion_tokens: 3,
          total_tokens: 9,
          cached_tokens: 2
        }
      } as LLMCoreStreamEvent
      yield { type: 'text', content: 'Done' } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const resultPromise = processStream(createParams({ coreStream }))
    await vi.runAllTimersAsync()
    const result = await resultPromise

    const metadata = JSON.parse(
      (messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        runId: 'req-1',
        runOutcome: 'completed',
        runStopReason: 'complete',
        inputTokens: 6,
        outputTokens: 3,
        totalTokens: 9,
        cachedInputTokens: 2,
        providerRounds: 1,
        toolCalls: 0
      })
    )
    expect(result.usage).toEqual(
      expect.objectContaining({ inputTokens: 6, outputTokens: 3, totalTokens: 9 })
    )
  })

  it('accumulates usage and execution counts across provider tool rounds', async () => {
    let round = 0
    const toolPresenter = createMockToolPresenter({ read: 'file contents' })
    const coreStream = vi.fn(function () {
      round += 1
      if (round === 1) {
        return (async function* () {
          yield {
            type: 'usage',
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_start',
            tool_call_id: 'tc1',
            tool_call_name: 'read'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'tc1',
            tool_call_arguments_complete: '{"path":"README.md"}'
          } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      }

      return (async function* () {
        yield {
          type: 'usage',
          usage: {
            prompt_tokens: 20,
            completion_tokens: 5,
            total_tokens: 25,
            cache_write_tokens: 4
          }
        } as LLMCoreStreamEvent
        yield { type: 'text', content: 'Finished' } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const resultPromise = processStream(
      createParams({ coreStream, toolPresenter, tools: [makeTool('read')] })
    )
    await vi.runAllTimersAsync()
    const result = await resultPromise

    const metadata = JSON.parse(
      (messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        runId: 'req-1',
        runOutcome: 'completed',
        runStopReason: 'complete',
        inputTokens: 30,
        outputTokens: 7,
        totalTokens: 37,
        cacheWriteInputTokens: 4,
        providerRounds: 2,
        toolCalls: 1
      })
    )
    expect(result.usage).toEqual(
      expect.objectContaining({ inputTokens: 30, outputTokens: 7, totalTokens: 37 })
    )
  })

  it('persists paused usage and resumes accounting from the persisted baseline', async () => {
    const permissionStream = vi.fn(async function* () {
      yield {
        type: 'usage',
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
      } as LLMCoreStreamEvent
      yield {
        type: 'tool_call_start',
        tool_call_id: 'tc-write',
        tool_call_name: 'write'
      } as LLMCoreStreamEvent
      yield {
        type: 'tool_call_end',
        tool_call_id: 'tc-write',
        tool_call_arguments_complete: '{"path":"result.txt","content":"ok"}'
      } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']
    const toolPresenter = createMockToolPresenter()
    ;(toolPresenter as any).preCheckToolPermission = vi.fn(async () => ({
      needsPermission: true,
      toolName: 'write',
      serverName: 'test-server',
      permissionType: 'write',
      description: 'Allow writing result.txt'
    }))

    const pausedResult = await processStream(
      createParams({
        coreStream: permissionStream,
        toolPresenter,
        tools: [makeTool('write')],
        permissionMode: 'ask_user'
      })
    )

    expect(pausedResult.status).toBe('paused')
    const pausedMetadata = JSON.parse(
      (messageStore.updateAssistantContent as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2]
    )
    expect(pausedMetadata).toEqual(
      expect.objectContaining({
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        providerRounds: 1,
        toolCalls: 0,
        runOutcome: 'paused',
        runStopReason: 'interaction'
      })
    )

    const resumeStream = vi.fn(async function* () {
      yield {
        type: 'usage',
        usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 }
      } as LLMCoreStreamEvent
      yield { type: 'text', content: 'Resumed' } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']
    await processStream(
      createParams({
        coreStream: resumeStream,
        initialAccounting: pausedMetadata
      })
    )

    const resumedMetadata = JSON.parse(
      (messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2]
    )
    expect(resumedMetadata).toEqual(
      expect.objectContaining({
        inputTokens: 30,
        outputTokens: 5,
        totalTokens: 35,
        providerRounds: 2,
        toolCalls: 0,
        runOutcome: 'completed',
        runStopReason: 'complete'
      })
    )
  })

  it('flushes ACP provider permission blocks immediately and keeps live permission updates mutable', async () => {
    let releaseStream: (() => void) | null = null
    let commitDecision: ((granted: boolean) => void) | null = null
    const coreStream = vi.fn(async function* () {
      yield {
        type: 'tool_call_start',
        tool_call_id: 'tc1',
        tool_call_name: 'Terminal'
      } as LLMCoreStreamEvent
      yield {
        type: 'tool_call_chunk',
        tool_call_id: 'tc1',
        tool_call_arguments_chunk: '{"command":"dir"}'
      } as LLMCoreStreamEvent
      yield {
        type: 'permission',
        permission: {
          providerId: 'acp',
          requestId: 'req-acp-1',
          tool_call_id: 'tc1',
          tool_call_name: 'Terminal',
          tool_call_params: '{"command":"dir"}',
          description: 'components.messageBlockPermissionRequest.description.command',
          permissionType: 'command',
          server_name: 'Claude Agent',
          command: 'dir',
          commandSignature: 'dir',
          paths: ['C:/tmp/a.txt', '', 123 as unknown as string],
          commandInfo: {
            command: 'dir',
            riskLevel: 'medium',
            suggestion: 'Review before running.',
            signature: 'dir',
            baseCommand: 'dir'
          },
          metadata: { rememberable: false }
        }
      } as LLMCoreStreamEvent
      await new Promise<void>((resolve) => {
        releaseStream = resolve
      })
      yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const onStreamingProviderPermission = vi.fn(
      (_permission, _tool, resolvePermission: (granted: boolean) => void) => {
        commitDecision = resolvePermission
      }
    )
    const params = createParams({
      providerId: 'acp',
      modelId: 'claude-code-acp',
      coreStream,
      hooks: { onStreamingProviderPermission }
    })

    const promise = processStream(params)
    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()
    await Promise.resolve()

    expect(onStreamingProviderPermission).toHaveBeenCalledTimes(1)
    expect(messageStore.updateAssistantContent).toHaveBeenCalled()

    const pendingBlocks = (messageStore.updateAssistantContent as ReturnType<typeof vi.fn>).mock
      .calls[0][1]
    expect(pendingBlocks[0].type).toBe('tool_call')
    expect(pendingBlocks[1]).toEqual(
      expect.objectContaining({
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        extra: expect.objectContaining({
          providerId: 'acp',
          permissionRequestId: 'req-acp-1',
          permissionType: 'command',
          needsUserAction: true,
          rememberable: false
        })
      })
    )
    expect(JSON.parse(pendingBlocks[1].extra.permissionRequest)).toEqual(
      expect.objectContaining({
        providerId: 'acp',
        requestId: 'req-acp-1',
        permissionType: 'command',
        command: 'dir',
        commandSignature: 'dir',
        paths: ['C:/tmp/a.txt'],
        commandInfo: {
          command: 'dir',
          riskLevel: 'medium',
          suggestion: 'Review before running.',
          signature: 'dir',
          baseCommand: 'dir'
        }
      })
    )

    expect(commitDecision).not.toBeNull()
    commitDecision?.(true)

    const grantedBlocks = (messageStore.updateAssistantContent as ReturnType<typeof vi.fn>).mock
      .calls[1][1]
    expect(grantedBlocks[1].status).toBe('granted')
    expect(grantedBlocks[1].extra.needsUserAction).toBe(false)
    expect(grantedBlocks[1].extra.grantedPermissions).toBe('command')

    releaseStream?.()
    await vi.runAllTimersAsync()
    await promise
  })

  it('settles AbortError thrown before the first event through the stream-owned terminal path', async () => {
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
    expect(messageStore.setMessageError).toHaveBeenCalledWith(
      'm1',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          content: 'common.error.userCanceledGeneration'
        })
      ]),
      expect.any(String)
    )
    expect(
      JSON.parse((messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2])
    ).toEqual(
      expect.objectContaining({
        runOutcome: 'aborted',
        runStopReason: 'user_stop',
        providerRounds: 1,
        toolCalls: 0
      })
    )
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
    expectDeepchatEvent('chat.stream.failed', {
      sessionId: 's1',
      messageId: 'm1',
      error: 'common.error.userCanceledGeneration'
    })
  })

  it('does not count an explicitly tracked provider round when local preflight fails first', async () => {
    const coreStream = vi.fn(async function* () {
      throw new Error('maximum context length exceeded before provider request')
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(
      createParams({ coreStream, coreStreamReportsProviderStart: true })
    )

    expect(result).toMatchObject({ status: 'error', stopReason: 'context_window' })
    const metadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        runOutcome: 'error',
        runStopReason: 'context_window',
        providerRounds: 0,
        toolCalls: 0
      })
    )
  })

  it('counts an explicitly tracked provider round before a first-event provider failure', async () => {
    const coreStream = vi.fn(async function* (...args: Parameters<ProcessParams['coreStream']>) {
      args[6]?.()
      throw new Error('provider connection failed')
    }) as unknown as ProcessParams['coreStream']

    await processStream(createParams({ coreStream, coreStreamReportsProviderStart: true }))

    const metadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        runOutcome: 'error',
        runStopReason: 'provider_error',
        providerRounds: 1,
        toolCalls: 0
      })
    )
  })

  it('enforces the provider-round limit across explicitly tracked internal retries', async () => {
    const coreStream = vi.fn(async function* (...args: Parameters<ProcessParams['coreStream']>) {
      args[6]?.()
      args[6]?.()
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(
      createParams({ coreStream, coreStreamReportsProviderStart: true, maxProviderRounds: 1 })
    )

    expect(result).toMatchObject({
      status: 'error',
      stopReason: 'max_turns',
      errorMessage: 'Maximum agent turns exceeded (1).'
    })
    const metadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        runOutcome: 'error',
        runStopReason: 'max_turns',
        providerRounds: 1,
        toolCalls: 0
      })
    )
  })

  it('single tool call → loop once, finalize', async () => {
    let callCount = 0
    let liveMessages: any[] | null = null
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
      tools: [makeTool('get_weather')],
      onConversationMessagesChange: (messages) => {
        liveMessages = messages
      }
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
    expect(liveMessages).toBe(secondCallMessages)
    expect(toolResultMsg).toBeDefined()
    expect(toolResultMsg.content).toBe('Sunny, 72F')
  })

  it('stops before exceeding max provider rounds', async () => {
    const coreStream = vi.fn(function () {
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
    }) as unknown as ProcessParams['coreStream']
    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny, 72F' })
    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('get_weather')],
      maxProviderRounds: 1
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toMatchObject({
      status: 'error',
      stopReason: 'max_turns',
      errorMessage: 'Maximum agent turns exceeded (1).'
    })
    expect(coreStream).toHaveBeenCalledTimes(1)
    const metadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        providerRounds: 1,
        toolCalls: 1,
        runOutcome: 'error',
        runStopReason: 'max_turns'
      })
    )
  })

  it('signals first provider round after flushing without blocking tool loop', async () => {
    const order: string[] = []
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
      }

      return (async function* () {
        yield { type: 'text', content: 'Done' } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    messageStore.updateAssistantContent.mockImplementation(() => {
      order.push('flush')
    })
    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny' })
    ;(toolPresenter.callTool as ReturnType<typeof vi.fn>).mockImplementation(async (request) => {
      order.push('tool')
      return {
        content: `result for ${request.function.name}`,
        rawData: {
          toolCallId: request.id,
          content: `result for ${request.function.name}`,
          isError: false
        }
      }
    })
    const onFirstProviderRoundReady = vi.fn(() => {
      order.push('ready')
      return new Promise(() => {})
    }) as unknown as () => void

    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('get_weather')],
      onFirstProviderRoundReady
    })

    await processStream(params)

    expect(onFirstProviderRoundReady).toHaveBeenCalledTimes(1)
    expect(order.indexOf('flush')).toBeLessThan(order.indexOf('ready'))
    expect(order.indexOf('ready')).toBeLessThan(order.indexOf('tool'))
    expect(coreStream).toHaveBeenCalledTimes(2)
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(1)
  })

  it('yields after completed tool calls when a pending input should run next', async () => {
    const coreStream = vi.fn(() =>
      (async function* () {
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
    ) as unknown as ProcessParams['coreStream']

    const shouldYieldForPendingInput = vi.fn(() => true)
    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny, 72F' })
    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('get_weather')],
      shouldYieldForPendingInput
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(coreStream).toHaveBeenCalledTimes(1)
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(1)
    expect(shouldYieldForPendingInput).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      status: 'completed',
      stopReason: 'pending_input'
    })

    const finalizedBlocks = (messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][1]
    expect(finalizedBlocks[0].tool_call.response).toBe('Sunny, 72F')
  })

  it('refreshes tools and system prompt for the next loop iteration after skill_view activates a skill', async () => {
    let callCount = 0
    const toolPresenter = {
      ...createMockToolPresenter(),
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          content:
            '{"success":true,"name":"deepchat-settings","isPinned":false,"activeForCurrentMessage":true,"activatedForMessage":true,"activationScope":"message"}',
          rawData: {
            toolCallId: 'tc1',
            content:
              '{"success":true,"name":"deepchat-settings","isPinned":false,"activeForCurrentMessage":true,"activatedForMessage":true,"activationScope":"message"}',
            isError: false,
            toolResult: {
              activationApplied: true,
              activationSource: 'skill_md',
              activatedSkill: 'deepchat-settings'
            }
          }
        })
        .mockResolvedValueOnce({
          content: '{"ok":true}',
          rawData: {
            toolCallId: 'tc2',
            content: '{"ok":true}',
            isError: false
          }
        })
    } as unknown as IToolPresenter
    const activeSkillNames: string[] = []
    const activateSkill = vi.fn(async (skillName: string) => {
      if (!activeSkillNames.includes(skillName)) {
        activeSkillNames.push(skillName)
      }
      return [...activeSkillNames]
    })
    const getActiveSkillNames = vi.fn(() => [...activeSkillNames])
    const refreshTools = vi
      .fn()
      .mockResolvedValue([makeTool('skill_view'), makeTool('deepchat_settings_set_theme')])
    const refreshSystemPrompt = vi.fn().mockResolvedValue('refreshed skill prompt')

    const coreStream = vi.fn(
      function (messages, _modelId, _modelConfig, _temperature, _maxTokens, tools) {
        callCount++
        if (callCount === 1) {
          expect(tools.map((tool) => tool.function.name)).toEqual(['skill_view'])
          return (async function* () {
            yield {
              type: 'tool_call_start',
              tool_call_id: 'tc1',
              tool_call_name: 'skill_view'
            } as LLMCoreStreamEvent
            yield {
              type: 'tool_call_end',
              tool_call_id: 'tc1',
              tool_call_arguments_complete: '{"name":"deepchat-settings"}'
            } as LLMCoreStreamEvent
            yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
          })()
        }
        if (callCount === 2) {
          expect(messages[0]).toEqual({ role: 'system', content: 'refreshed skill prompt' })
          expect(tools.map((tool) => tool.function.name)).toEqual([
            'skill_view',
            'deepchat_settings_set_theme'
          ])
          return (async function* () {
            yield {
              type: 'tool_call_start',
              tool_call_id: 'tc2',
              tool_call_name: 'deepchat_settings_set_theme'
            } as LLMCoreStreamEvent
            yield {
              type: 'tool_call_end',
              tool_call_id: 'tc2',
              tool_call_arguments_complete: '{"theme":"dark"}'
            } as LLMCoreStreamEvent
            yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
          })()
        }
        return (async function* () {
          yield { type: 'text', content: 'Done' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    ) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('skill_view')],
      refreshTools,
      refreshSystemPrompt,
      hooks: {
        activateSkill,
        getActiveSkillNames
      }
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(activateSkill).toHaveBeenCalledWith('deepchat-settings')
    expect(getActiveSkillNames).toHaveBeenCalled()
    expect(refreshTools).toHaveBeenCalledTimes(1)
    expect(refreshTools).toHaveBeenCalledWith(['deepchat-settings'])
    expect(refreshSystemPrompt).toHaveBeenCalledTimes(1)
    expect(refreshSystemPrompt).toHaveBeenCalledWith(
      ['deepchat-settings'],
      [
        expect.objectContaining({ function: expect.objectContaining({ name: 'skill_view' }) }),
        expect.objectContaining({
          function: expect.objectContaining({ name: 'deepchat_settings_set_theme' })
        })
      ]
    )
    expect(coreStream).toHaveBeenCalledTimes(3)
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(2)
  })

  it('does not refresh tools after linked-file skill_view reads', async () => {
    let callCount = 0
    const toolPresenter = {
      ...createMockToolPresenter(),
      callTool: vi.fn().mockResolvedValue({
        content:
          '{"success":true,"name":"deepchat-settings","filePath":"references/guide.md","isPinned":false}',
        rawData: {
          toolCallId: 'tc1',
          content:
            '{"success":true,"name":"deepchat-settings","filePath":"references/guide.md","isPinned":false}',
          isError: false,
          toolResult: {
            activationApplied: false,
            activationSource: 'file'
          }
        }
      })
    } as unknown as IToolPresenter
    const refreshTools = vi.fn().mockResolvedValue([makeTool('deepchat_settings_set_theme')])

    const coreStream = vi.fn(
      function (_messages, _modelId, _modelConfig, _temperature, _maxTokens, tools) {
        callCount++
        if (callCount === 1) {
          expect(tools.map((tool) => tool.function.name)).toEqual(['skill_view'])
          return (async function* () {
            yield {
              type: 'tool_call_start',
              tool_call_id: 'tc1',
              tool_call_name: 'skill_view'
            } as LLMCoreStreamEvent
            yield {
              type: 'tool_call_end',
              tool_call_id: 'tc1',
              tool_call_arguments_complete:
                '{"name":"deepchat-settings","file_path":"references/guide.md"}'
            } as LLMCoreStreamEvent
            yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
          })()
        }
        expect(tools.map((tool) => tool.function.name)).toEqual(['skill_view'])
        return (async function* () {
          yield { type: 'text', content: 'Done' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }
    ) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('skill_view')],
      refreshTools
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(refreshTools).not.toHaveBeenCalled()
    expect(coreStream).toHaveBeenCalledTimes(2)
  })

  it('offloads large tool results before the next provider call', async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-process-offload-'))
    homeDirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempHome)

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

  it('passes reasoning_content back after each interleaved tool-call loop', async () => {
    let callCount = 0
    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny' })

    const coreStream = vi.fn(function () {
      callCount++
      const round = callCount
      if (round <= 2) {
        return (async function* () {
          yield {
            type: 'reasoning',
            reasoning_content: `Think ${round}`
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_start',
            tool_call_id: `tc${round}`,
            tool_call_name: 'get_weather'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: `tc${round}`,
            tool_call_arguments_complete: `{"round":${round}}`
          } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      }

      return (async function* () {
        yield { type: 'text', content: 'Final answer' } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      toolPresenter,
      tools: [makeTool('get_weather')],
      interleavedReasoning: {
        ...DEFAULT_INTERLEAVED_REASONING,
        preserveReasoningContent: true,
        portraitInterleaved: true
      }
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(coreStream).toHaveBeenCalledTimes(3)
    const secondCallMessages = (coreStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
    const firstAssistantMessage = secondCallMessages.find(
      (message: any) => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'tc1'
    )
    expect(firstAssistantMessage.reasoning_content).toBe('Think 1')

    const thirdCallMessages = (coreStream as ReturnType<typeof vi.fn>).mock.calls[2][0]
    const toolCallAssistantMessages = thirdCallMessages.filter(
      (message: any) => message.role === 'assistant' && message.tool_calls?.length
    )
    expect(toolCallAssistantMessages.map((message: any) => message.reasoning_content)).toEqual([
      'Think 1',
      'Think 2'
    ])
  })

  it('asks the provider to change strategy after two identical tool batches', async () => {
    let round = 0
    const providerInputs: any[][] = []
    const toolPresenter = createMockToolPresenter({ read: 'unchanged contents' })
    const coreStream = vi.fn(function (messages) {
      providerInputs.push(structuredClone(messages))
      round += 1
      if (round === 3) {
        return (async function* () {
          yield { type: 'text', content: 'Final answer' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }

      const args =
        round === 1
          ? '{"path":"README.md","options":{"line":1,"context":2}}'
          : '{"options":{"context":2,"line":1},"path":"README.md"}'
      return (async function* () {
        yield {
          type: 'tool_call_start',
          tool_call_id: `tc${round}`,
          tool_call_name: 'read'
        } as LLMCoreStreamEvent
        yield {
          type: 'tool_call_end',
          tool_call_id: `tc${round}`,
          tool_call_arguments_complete: args
        } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(
      createParams({ coreStream, toolPresenter, tools: [makeTool('read')] })
    )

    expect(result).toMatchObject({ status: 'completed', stopReason: 'complete' })
    expect(coreStream).toHaveBeenCalledTimes(3)
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(2)
    expect(
      providerInputs[1]
        .filter((message) => message.role === 'tool')
        .some((message) => String(message.content).includes('agent_no_progress'))
    ).toBe(false)
    const correctedToolMessages = providerInputs[2].filter(
      (message) => message.role === 'tool' && String(message.content).includes('agent_no_progress')
    )
    expect(correctedToolMessages).toHaveLength(1)
    expect(correctedToolMessages[0].content).toContain('unchanged contents')
    expect(correctedToolMessages[0].content).toContain('Change strategy or finalize')
  })

  it('terminates after four identical tool batches without a fifth provider call', async () => {
    let round = 0
    const toolPresenter = createMockToolPresenter({ action: 'still unchanged' })
    const coreStream = vi.fn(function () {
      round += 1
      return (async function* () {
        if (round === 1) {
          yield {
            type: 'plan',
            plan: [{ step: 'Keep trying', status: 'in_progress' }],
            revision: 1,
            updatedAt: '2026-07-13T00:00:00.000Z'
          } as LLMCoreStreamEvent
        }
        yield {
          type: 'tool_call_start',
          tool_call_id: `tc${round}`,
          tool_call_name: 'action'
        } as LLMCoreStreamEvent
        yield {
          type: 'tool_call_end',
          tool_call_id: `tc${round}`,
          tool_call_arguments_complete: '{}'
        } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(
      createParams({ coreStream, toolPresenter, tools: [makeTool('action')] })
    )

    expect(result).toMatchObject({
      status: 'error',
      stopReason: 'no_progress',
      terminalError: 'Agent stopped after four identical tool batches produced no progress.'
    })
    expect(coreStream).toHaveBeenCalledTimes(4)
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(4)
    expect(messageStore.setMessageError).toHaveBeenCalled()
    const noProgressMetadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(noProgressMetadata).toEqual(
      expect.objectContaining({ runOutcome: 'error', runStopReason: 'no_progress' })
    )
    expectDeepchatEvent('chat.plan.updated', {
      sessionId: 's1',
      messageId: 'm1',
      terminalReason: 'max_steps'
    })
  })

  it('preserves the no-progress streak across a permission pause and resume', async () => {
    const guard = new NoProgressToolLoopGuard()
    let snapshot = guard.observe(
      [{ id: 'tc1', name: 'read', arguments: '{"path":"README.md"}' }],
      [{ role: 'tool', tool_call_id: 'tc1', content: 'unchanged contents' }]
    ).snapshot
    snapshot = guard.observe(
      [{ id: 'tc2', name: 'read', arguments: '{"path":"README.md"}' }],
      [{ role: 'tool', tool_call_id: 'tc2', content: 'unchanged contents' }]
    ).snapshot
    snapshot = guard.observe(
      [{ id: 'tc3', name: 'read', arguments: '{"path":"README.md"}' }],
      [{ role: 'tool', tool_call_id: 'tc3', content: 'unchanged contents' }]
    ).snapshot
    const coreStream = vi.fn(async function* () {
      yield { type: 'text', content: 'must not run' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(
      createParams({
        messages: [
          { role: 'user', content: 'Inspect README.md' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'tc4',
                type: 'function',
                function: { name: 'read', arguments: '{"path":"README.md"}' }
              }
            ]
          },
          { role: 'tool', tool_call_id: 'tc4', content: 'unchanged contents' }
        ],
        coreStream,
        initialAccounting: {
          runOutcome: 'paused',
          noProgressToolLoop: snapshot,
          providerRounds: 3,
          toolCalls: 3
        }
      })
    )

    expect(result).toMatchObject({ status: 'error', stopReason: 'no_progress' })
    expect(coreStream).not.toHaveBeenCalled()
    const metadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        runOutcome: 'error',
        runStopReason: 'no_progress',
        providerRounds: 3,
        toolCalls: 3,
        noProgressToolLoop: expect.objectContaining({ repeatedBatchCount: 4 })
      })
    )
  })

  it('resets repeated-batch detection when arguments or normalized results change', async () => {
    const argsByRound = ['{}', '{}', '{"cursor":1}', '{}', '{}', '{}', '{}']
    const resultsByCall = ['stable', 'stable', 'stable', 'stable', 'changed', 'stable', 'stable']
    let round = 0
    let toolCall = 0
    const providerInputs: any[][] = []
    const toolPresenter = {
      ...createMockToolPresenter(),
      callTool: vi.fn(async (request) => {
        const content = resultsByCall[toolCall++]
        return {
          content,
          rawData: { toolCallId: request.id, content, isError: false }
        }
      })
    } as unknown as IToolPresenter
    const coreStream = vi.fn(function (messages) {
      providerInputs.push(structuredClone(messages))
      round += 1
      if (round > argsByRound.length) {
        return (async function* () {
          yield { type: 'text', content: 'Finished after progress' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }

      const args = argsByRound[round - 1]
      return (async function* () {
        yield {
          type: 'tool_call_start',
          tool_call_id: `tc${round}`,
          tool_call_name: 'action'
        } as LLMCoreStreamEvent
        yield {
          type: 'tool_call_end',
          tool_call_id: `tc${round}`,
          tool_call_arguments_complete: args
        } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(
      createParams({ coreStream, toolPresenter, tools: [makeTool('action')] })
    )

    expect(result).toMatchObject({ status: 'completed', stopReason: 'complete' })
    expect(coreStream).toHaveBeenCalledTimes(8)
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(7)
    expect(
      providerInputs
        .at(-1)
        .filter(
          (message) =>
            message.role === 'tool' && String(message.content).includes('agent_no_progress')
        )
    ).toHaveLength(2)
  })

  it('preserves max_tokens as the completed stop reason', async () => {
    const coreStream = vi.fn(async function* () {
      yield {
        type: 'usage',
        usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 }
      } as LLMCoreStreamEvent
      yield { type: 'text', content: 'Truncated answer' } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'max_tokens' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(createParams({ coreStream }))

    expect(result).toMatchObject({
      status: 'completed',
      stopReason: 'max_tokens',
      usage: { inputTokens: 11, outputTokens: 4, totalTokens: 15 }
    })
    expect(messageStore.setMessageError).not.toHaveBeenCalled()
    const metadata = JSON.parse(
      (messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        runOutcome: 'completed',
        runStopReason: 'max_tokens',
        totalTokens: 15
      })
    )
  })

  it('preserves max_tool_calls when the 128-call limit stops the loop', async () => {
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
          tool_call_arguments_complete: `{"iteration":${callCount}}`
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
    const result = await promise

    expect(result).toMatchObject({ status: 'completed', stopReason: 'max_tool_calls' })
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(128)
    expect(coreStream).toHaveBeenCalledTimes(129)
    const finalizedBlocks = (messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][1]
    expect(finalizedBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_call',
          status: 'error',
          tool_call: expect.objectContaining({
            id: 'tc129',
            response: expect.stringContaining('maximum tool-call limit')
          }),
          extra: expect.objectContaining({ toolCallSkippedReason: 'max_tool_calls' })
        })
      ])
    )
    const metadata = JSON.parse(
      (messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        runOutcome: 'completed',
        runStopReason: 'max_tool_calls',
        providerRounds: 129,
        toolCalls: 128
      })
    )
  })

  it('completes a plan-only stream without writing an error or plan block', async () => {
    const finalWrites: any[] = []
    messageStore.finalizeAssistantMessage.mockImplementation((_messageId, blocks) => {
      finalWrites.push(structuredClone(blocks))
    })
    const coreStream = vi.fn(async function* () {
      yield {
        type: 'plan',
        plan: [{ step: 'Inspect runtime state', status: 'in_progress' }],
        revision: 1,
        updatedAt: '2026-05-18T00:00:00.000Z'
      } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(createParams({ coreStream }))

    expect(result).toMatchObject({
      status: 'completed',
      stopReason: 'complete'
    })
    expect(messageStore.setMessageError).not.toHaveBeenCalled()
    expect(messageStore.finalizeAssistantMessage).toHaveBeenCalledWith('m1', [], expect.any(String))
    expect(finalWrites.at(-1)?.some((block: { type: string }) => block.type === 'plan')).toBe(false)
    expectDeepchatEvent('chat.plan.updated', {
      sessionId: 's1',
      messageId: 'm1',
      revision: 1
    })
    expectDeepchatEvent('chat.stream.completed', {
      sessionId: 's1',
      messageId: 'm1',
      requestId: 'req-1'
    })
  })

  it('publishes a terminal plan event when the max tool calls limit stops the loop', async () => {
    const finalWrites: any[] = []
    messageStore.finalizeAssistantMessage.mockImplementation((_messageId, blocks) => {
      finalWrites.push(structuredClone(blocks))
    })
    let callCount = 0
    const toolPresenter = createMockToolPresenter({ action: 'done' })

    const coreStream = vi.fn(function () {
      callCount++
      return (async function* () {
        if (callCount === 1) {
          yield {
            type: 'plan',
            plan: [{ step: 'Keep looping', status: 'in_progress' }],
            revision: 1,
            updatedAt: '2026-05-18T00:00:00.000Z'
          } as LLMCoreStreamEvent
        }
        yield {
          type: 'tool_call_start',
          tool_call_id: `tc${callCount}`,
          tool_call_name: 'action'
        } as LLMCoreStreamEvent
        yield {
          type: 'tool_call_end',
          tool_call_id: `tc${callCount}`,
          tool_call_arguments_complete: `{"iteration":${callCount}}`
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

    expect(finalWrites.at(-1)?.some((block: { type: string }) => block.type === 'plan')).toBe(false)
    expectDeepchatEvent('chat.plan.updated', {
      sessionId: 's1',
      messageId: 'm1',
      terminalReason: 'max_steps'
    })
  })

  it('publishes an aborted terminal marker when AbortError is thrown after a plan event', async () => {
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    const coreStream = vi.fn(async function* () {
      yield {
        type: 'usage',
        usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 }
      } as LLMCoreStreamEvent
      yield {
        type: 'plan',
        plan: [{ step: 'Current work', status: 'in_progress' }],
        revision: 1,
        updatedAt: '2026-05-18T00:00:00.000Z'
      } as LLMCoreStreamEvent
      throw abortError
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(createParams({ coreStream }))

    expect(result).toMatchObject({
      status: 'aborted',
      stopReason: 'user_stop',
      errorMessage: 'common.error.userCanceledGeneration'
    })
    const abortMetadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2]
    )
    expect(abortMetadata).toEqual(
      expect.objectContaining({
        runId: 'req-1',
        runOutcome: 'aborted',
        runStopReason: 'user_stop',
        totalTokens: 9,
        providerRounds: 1,
        toolCalls: 0
      })
    )
    expect(messageStore.setMessageError).toHaveBeenCalledWith(
      'm1',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          content: 'common.error.userCanceledGeneration'
        })
      ]),
      expect.any(String)
    )
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
    expectDeepchatEvent('chat.plan.updated', {
      sessionId: 's1',
      messageId: 'm1',
      terminalReason: 'aborted'
    })
  })

  it('persists finalized narrative blocks when AbortError is thrown after text and plan events', async () => {
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    const coreStream = vi.fn(async function* () {
      yield { type: 'text', content: 'Partial answer' } as LLMCoreStreamEvent
      yield {
        type: 'plan',
        plan: [{ step: 'Current work', status: 'in_progress' }],
        revision: 1,
        updatedAt: '2026-05-18T00:00:00.000Z'
      } as LLMCoreStreamEvent
      throw abortError
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(createParams({ coreStream }))

    expect(result).toMatchObject({
      status: 'aborted',
      stopReason: 'user_stop',
      errorMessage: 'common.error.userCanceledGeneration'
    })
    expect(messageStore.setMessageError).toHaveBeenCalledWith(
      'm1',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'content',
          content: 'Partial answer',
          status: 'success'
        }),
        expect.objectContaining({
          type: 'error',
          content: 'common.error.userCanceledGeneration'
        })
      ]),
      expect.any(String)
    )
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
    expectDeepchatEvent('chat.plan.updated', {
      sessionId: 's1',
      messageId: 'm1',
      terminalReason: 'aborted'
    })
  })

  it('abort during stream', async () => {
    const abortController = new AbortController()

    const coreStream = vi.fn(function () {
      return (async function* () {
        yield {
          type: 'usage',
          usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 }
        } as LLMCoreStreamEvent
        abortController.abort()
        yield { type: 'text', content: 'Ignored' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      io: {
        sessionId: 's1',
        requestId: 'req-1',
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
    expect(abortMetadata).toEqual(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4',
        totalTokens: 9,
        providerRounds: 1,
        runOutcome: 'aborted',
        runStopReason: 'user_stop'
      })
    )
    expectDeepchatEvent('chat.stream.failed', {
      sessionId: 's1',
      messageId: 'm1',
      requestId: 'req-1',
      error: 'common.error.userCanceledGeneration'
    })
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
        requestId: 'req-1',
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
    expect(publishDeepchatEventMock).not.toHaveBeenCalledWith(
      'chat.stream.failed',
      expect.objectContaining({
        sessionId: 's1',
        messageId: 'm1',
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
        requestId: 'req-1',
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
      yield {
        type: 'usage',
        usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 }
      } as LLMCoreStreamEvent
      yield { type: 'text', content: 'Partial' } as LLMCoreStreamEvent
      yield { type: 'error', error_message: 'Rate limit exceeded' } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({ coreStream })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toMatchObject({
      status: 'error',
      stopReason: 'provider_error',
      terminalError: 'Rate limit exceeded',
      errorMessage: 'Rate limit exceeded',
      usage: { inputTokens: 8, outputTokens: 1, totalTokens: 9 }
    })
    expect(messageStore.setMessageError).toHaveBeenCalled()
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
    const metadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        runOutcome: 'error',
        runStopReason: 'provider_error',
        totalTokens: 9
      })
    )
    expectDeepchatEvent('chat.stream.failed', {
      sessionId: 's1',
      messageId: 'm1',
      requestId: 'req-1',
      error: 'Rate limit exceeded'
    })
    expect(publishDeepchatEventMock).not.toHaveBeenCalledWith(
      'chat.stream.completed',
      expect.anything()
    )
  })

  it('returns the persisted reason and usage for a context window error event', async () => {
    const coreStream = vi.fn(function* () {
      yield {
        type: 'usage',
        usage: { prompt_tokens: 20, completion_tokens: 1, total_tokens: 21 }
      } as LLMCoreStreamEvent
      yield {
        type: 'error',
        error_message: 'maximum context length exceeded'
      } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({ coreStream })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toMatchObject({
      status: 'error',
      stopReason: 'context_window',
      terminalError: 'maximum context length exceeded',
      errorMessage: 'maximum context length exceeded',
      usage: { inputTokens: 20, outputTokens: 1, totalTokens: 21 }
    })
    expect(messageStore.setMessageError).toHaveBeenCalled()
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
    const metadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        runOutcome: 'error',
        runStopReason: 'context_window',
        inputTokens: 20,
        outputTokens: 1,
        totalTokens: 21
      })
    )
  })

  it('classifies a thrown context window failure and preserves observed usage', async () => {
    const coreStream = vi.fn(function () {
      return (async function* () {
        yield {
          type: 'usage',
          usage: { prompt_tokens: 19, completion_tokens: 2, total_tokens: 21 }
        } as LLMCoreStreamEvent
        throw new Error('maximum context length exceeded while sending request')
      })()
    }) as unknown as ProcessParams['coreStream']

    const promise = processStream(createParams({ coreStream }))
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toMatchObject({
      status: 'error',
      stopReason: 'context_window',
      terminalError: 'maximum context length exceeded while sending request',
      errorMessage: 'maximum context length exceeded while sending request',
      usage: { inputTokens: 19, outputTokens: 2, totalTokens: 21 }
    })
    const metadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        runOutcome: 'error',
        runStopReason: 'context_window',
        inputTokens: 19,
        outputTokens: 2,
        totalTokens: 21
      })
    )
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

    expect(result).toMatchObject({ status: 'error', stopReason: 'tool_error' })
    expect(result.terminalError).toContain('remaining context window is too small')
    expect(coreStream).toHaveBeenCalledTimes(1)
    expect(messageStore.setMessageError).toHaveBeenCalled()
    expect(
      JSON.parse((messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2])
    ).toEqual(expect.objectContaining({ runOutcome: 'error', runStopReason: 'tool_error' }))
  })

  it('propagates turn cancellation through ToolPresenter to an in-flight MCP call', async () => {
    const abortController = new AbortController()
    let markMcpCallStarted: (() => void) | undefined
    const mcpCallStarted = new Promise<void>((resolve) => {
      markMcpCallStarted = resolve
    })
    const mcpPresenter = {
      callTool: vi.fn((_request, options?: { signal?: AbortSignal }) => {
        markMcpCallStarted?.()
        return new Promise((_, reject) => {
          const signal = options?.signal
          if (!signal) {
            reject(new Error('Missing MCP abort signal'))
            return
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })
    }
    const toolPresenter = new ToolPresenter({
      mcpPresenter: mcpPresenter as any,
      configPresenter: {} as any,
      agentToolRuntime: {} as any
    })
    ;(toolPresenter as any).mapper.registerTool('slow_mcp', 'mcp')

    const coreStream = vi.fn(async function* () {
      yield {
        type: 'tool_call_start',
        tool_call_id: 'tc-slow',
        tool_call_name: 'slow_mcp'
      } as LLMCoreStreamEvent
      yield {
        type: 'tool_call_end',
        tool_call_id: 'tc-slow',
        tool_call_arguments_complete: '{}'
      } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']
    const resultPromise = processStream(
      createParams({
        coreStream,
        toolPresenter,
        tools: [makeTool('slow_mcp')],
        io: {
          sessionId: 's1',
          requestId: 'req-1',
          messageId: 'm1',
          messageStore,
          abortSignal: abortController.signal
        }
      })
    )

    await mcpCallStarted
    abortController.abort()
    const result = await resultPromise

    expect(result).toMatchObject({ status: 'aborted', stopReason: 'user_stop' })
    expect(mcpPresenter.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 's1' }),
      expect.objectContaining({ signal: abortController.signal })
    )
    expect(coreStream).toHaveBeenCalledTimes(1)
  })

  it('stream exception → catch finalizeError', async () => {
    const coreStream = vi.fn(function () {
      return (async function* () {
        yield {
          type: 'usage',
          usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 }
        } as LLMCoreStreamEvent
        yield { type: 'text', content: 'Start' } as LLMCoreStreamEvent
        throw new Error('Connection lost')
      })()
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({ coreStream })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(messageStore.setMessageError).toHaveBeenCalled()
    const metadata = JSON.parse(
      (messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
    )
    expect(metadata).toEqual(
      expect.objectContaining({
        totalTokens: 9,
        providerRounds: 1,
        toolCalls: 0,
        runOutcome: 'error',
        runStopReason: 'provider_error'
      })
    )
    expectDeepchatEvent('chat.stream.failed', {
      sessionId: 's1',
      messageId: 'm1',
      requestId: 'req-1',
      error: 'Connection lost'
    })
  })
})
