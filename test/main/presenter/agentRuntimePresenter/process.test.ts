import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/presenter'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { ProcessParams } from '@/presenter/agentRuntimePresenter/types'
import { createState } from '@/presenter/agentRuntimePresenter/types'
import { ToolOutputGuard } from '@/presenter/agentRuntimePresenter/toolOutputGuard'
import {
  createToolExecutionPort,
  createToolResultPort
} from '@/presenter/agentRuntimePresenter/toolAdapters'
import { createLoopRun } from '@/agent/deepchat/loop/loopRun'
import type { DeepChatLoopNotification } from '@/agent/deepchat/loop/ports'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { resolveToolOffloadPath } from '@/agent/shared/storage/sessionPaths'

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
  let tapeRecorder: { appendToolFact: ReturnType<typeof vi.fn> }
  let tempHome: string | null = null
  let homedirSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    messageStore = createMockMessageStore()
    tapeRecorder = {
      appendToolFact: vi.fn(async (input) => ({
        sessionId: input.sessionId,
        entryId: 1
      }))
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    homedirSpy?.mockRestore()
    homedirSpy = null
    if (tempHome) {
      return fs.rm(tempHome, { recursive: true, force: true }).then(() => {
        tempHome = null
      })
    }
  })

  function createParams(
    overrides: Partial<ProcessParams> & {
      messages?: ChatMessage[]
      tools?: MCPToolDefinition[]
      abortController?: AbortController
    } = {}
  ): ProcessParams {
    const {
      messages = [{ role: 'user' as const, content: 'Hello' }],
      tools = [],
      abortController = new AbortController(),
      run: providedRun,
      ...processOverrides
    } = overrides
    const toolPresenter = createMockToolPresenter()
    const toolOutputGuard = new ToolOutputGuard()

    const coreStream = vi.fn(function* () {
      yield* makeStreamEvents(
        { type: 'text', content: 'Hello' },
        { type: 'stop', stop_reason: 'complete' }
      )
    }) as unknown as ProcessParams['coreStream']

    const params: ProcessParams = {
      run:
        providedRun ??
        createLoopRun({
          runId: 'req-1',
          sessionId: toAppSessionId('s1'),
          messageId: 'm1',
          abortController,
          messages,
          streamState: createState(),
          resources: { toolDefinitions: tools, activeSkillNames: [] }
        }),
      toolCatalog: {
        resolve: vi.fn().mockResolvedValue(tools)
      },
      toolExecution: createToolExecutionPort(toolPresenter),
      toolResults: createToolResultPort({
        outputGuard: toolOutputGuard,
        normalize: async ({ content }) => content
      }),
      coreStream,
      providerId: 'openai',
      modelId: 'gpt-4',
      modelConfig: {} as any,
      temperature: 0.7,
      maxTokens: 4096,
      interleavedReasoning: DEFAULT_INTERLEAVED_REASONING,
      permissionMode: 'full_access',
      io: {
        messageStore,
        tapeRecorder
      },
      ...processOverrides
    }
    messageStore.getMessage.mockImplementation((messageId: string) => ({
      id: messageId,
      sessionId: params.run.sessionId,
      orderSeq: 1,
      role: 'assistant',
      content: JSON.stringify(params.run.streamState.blocks),
      status: 'pending',
      isContextEdge: false,
      metadata: '{}',
      traceCount: 0,
      createdAt: 1,
      updatedAt: 1
    }))
    return params
  }

  function observeCommitOrder(order: string[]): void {
    messageStore.updateAssistantContent.mockImplementation(() => {
      order.push('message:update')
    })
    messageStore.finalizeAssistantMessage.mockImplementation(() => {
      order.push('message:complete')
    })
    messageStore.setMessageError.mockImplementation(() => {
      order.push('message:error')
    })
    tapeRecorder.appendToolFact.mockImplementation(async (input) => {
      order.push(`tape:${input.provenance.source}`)
      return { sessionId: input.sessionId, entryId: 1 }
    })
    publishDeepchatEventMock.mockImplementation((eventName: string) => {
      if (eventName === 'chat.stream.updated') {
        order.push('renderer:update')
      } else if (eventName === 'chat.stream.completed') {
        order.push('renderer:complete')
      } else if (eventName === 'chat.stream.failed') {
        order.push('renderer:error')
      }
    })
  }

  function createToolThenCompleteStream(toolName: string): ProcessParams['coreStream'] {
    let callCount = 0
    return vi.fn(function () {
      callCount++
      if (callCount === 1) {
        return (async function* () {
          yield {
            type: 'tool_call_start',
            tool_call_id: 'tc1',
            tool_call_name: toolName
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
  }

  it('no tools → single stream, finalize', async () => {
    const params = createParams()
    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(params.coreStream).toHaveBeenCalledTimes(1)
    expect(params.run.providerRoundCount).toBe(1)
    expect(params.run.requestSeq).toBe(0)
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

  describe('fixed lifecycle commits', () => {
    const TOOL_ROUND_COMMIT_ORDER = [
      'renderer:update',
      'message:update',
      'renderer:update',
      'message:update',
      'renderer:update',
      'message:update',
      'tape:tool_call',
      'tape:tool_result'
    ]
    const ERROR_TERMINAL_COMMIT_ORDER = ['message:error', 'renderer:update', 'renderer:error']
    const COMPLETED_TERMINAL_COMMIT_ORDER = [
      'message:complete',
      'renderer:update',
      'renderer:complete'
    ]

    function createToolRoundStream(toolName: string, args = '{}'): ProcessParams['coreStream'] {
      return vi.fn(async function* () {
        yield {
          type: 'tool_call_start',
          tool_call_id: 'tc1',
          tool_call_name: toolName
        } as LLMCoreStreamEvent
        yield {
          type: 'tool_call_end',
          tool_call_id: 'tc1',
          tool_call_arguments_complete: args
        } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
      }) as unknown as ProcessParams['coreStream']
    }

    it('keeps the normal output and terminal commit order without tool Tape snapshots', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const coreStream = vi.fn(async function* () {
        yield { type: 'text', content: 'One' } as LLMCoreStreamEvent
        yield { type: 'text', content: ' two' } as LLMCoreStreamEvent
        yield { type: 'text', content: ' three' } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
      }) as unknown as ProcessParams['coreStream']

      const result = await processStream(createParams({ coreStream }))

      expect(result.status).toBe('completed')
      expect(order).toEqual([
        'renderer:update',
        'message:update',
        'renderer:update',
        'message:update',
        'message:complete',
        'renderer:update',
        'renderer:complete'
      ])
      expect(tapeRecorder.appendToolFact).not.toHaveBeenCalled()
    })

    it('keeps the legacy error fallback inside one settlement stage invocation', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      messageStore.finalizeAssistantMessage.mockImplementation(() => {
        order.push('message:complete')
        throw new Error('final write failed')
      })

      const result = await processStream(createParams())

      expect(result).toMatchObject({
        status: 'error',
        errorMessage: 'final write failed'
      })
      expect(order).toEqual([
        'renderer:update',
        'message:update',
        'renderer:update',
        'message:update',
        'message:complete',
        ...ERROR_TERMINAL_COMMIT_ORDER
      ])
      expect(messageStore.finalizeAssistantMessage).toHaveBeenCalledTimes(1)
      expect(messageStore.setMessageError).toHaveBeenCalledTimes(1)
      expect(tapeRecorder.appendToolFact).not.toHaveBeenCalled()
    })

    it('persists each tool round before entering the next provider round', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      let providerRound = 0
      const coreStream = vi.fn(() => {
        providerRound += 1
        if (providerRound <= 2) {
          const toolCallId = `tc${providerRound}`
          return (async function* () {
            yield {
              type: 'tool_call_start',
              tool_call_id: toolCallId,
              tool_call_name: 'action'
            } as LLMCoreStreamEvent
            yield {
              type: 'tool_call_end',
              tool_call_id: toolCallId,
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

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(createMockToolPresenter({ action: 'ok' })),
          tools: [makeTool('action')]
        })
      )

      expect(result.status).toBe('completed')
      expect(order).toEqual([
        'renderer:update',
        'message:update',
        'renderer:update',
        'message:update',
        'renderer:update',
        'message:update',
        'tape:tool_call',
        'tape:tool_result',
        'renderer:update',
        'message:update',
        'tape:tool_call',
        'tape:tool_result',
        'tape:tool_call',
        'tape:tool_result',
        'message:complete',
        'renderer:update',
        'renderer:complete'
      ])
      expect(tapeRecorder.appendToolFact).toHaveBeenCalledTimes(6)
      expect(
        tapeRecorder.appendToolFact.mock.calls.map(([input]) => [
          input.provenance.source,
          input.provenance.sourceId,
          input.provenance.sequence
        ])
      ).toEqual([
        ['tool_call', 'm1:tc1', 0],
        ['tool_result', 'm1:tc1', 0],
        ['tool_call', 'm1:tc1', 0],
        ['tool_result', 'm1:tc1', 0],
        ['tool_call', 'm1:tc2', 1],
        ['tool_result', 'm1:tc2', 1]
      ])
    })

    it('keeps the tool loop fail-open when TapeRecorder rejects a fact', async () => {
      tapeRecorder.appendToolFact.mockRejectedValue(new Error('tape unavailable'))
      const coreStream = createToolThenCompleteStream('action')

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(createMockToolPresenter({ action: 'ok' })),
          tools: [makeTool('action')]
        })
      )

      expect(result.status).toBe('completed')
      expect(coreStream).toHaveBeenCalledTimes(2)
      expect(tapeRecorder.appendToolFact).toHaveBeenCalledTimes(1)
    })

    it('persists a paused tool round before its terminal projection', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const coreStream = vi.fn(async function* () {
        yield {
          type: 'tool_call_start',
          tool_call_id: 'question-1',
          tool_call_name: 'deepchat_question'
        } as LLMCoreStreamEvent
        yield {
          type: 'tool_call_end',
          tool_call_id: 'question-1',
          tool_call_arguments_complete: JSON.stringify({
            question: 'Continue?',
            options: [{ label: 'Yes' }, { label: 'No' }]
          })
        } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
      }) as unknown as ProcessParams['coreStream']

      const result = await processStream(
        createParams({ coreStream, tools: [makeTool('deepchat_question')] })
      )

      expect(result.status).toBe('paused')
      expect(result.pendingInteractions).toEqual([
        expect.objectContaining({
          origin: 'question',
          order: 0,
          toolCallId: 'question-1'
        })
      ])
      expect(result.toolBatchExecutionState).toEqual({
        callOrder: ['question-1'],
        invokedCallIds: [],
        committedResultCallIds: [],
        pendingInteractionCallIds: ['question-1']
      })
      expect(order).toEqual([
        'renderer:update',
        'message:update',
        'renderer:update',
        'message:update',
        'renderer:update',
        'message:update',
        'message:update',
        'renderer:update',
        'renderer:complete'
      ])
      expect(tapeRecorder.appendToolFact).not.toHaveBeenCalled()
    })

    it('settles a thrown provider error without a tool Tape snapshot', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const coreStream = vi.fn(async function* () {
        yield { type: 'text', content: 'Partial' } as LLMCoreStreamEvent
        throw new Error('Connection lost')
      }) as unknown as ProcessParams['coreStream']

      const result = await processStream(createParams({ coreStream }))

      expect(result.status).toBe('error')
      expect(order).toEqual([
        'renderer:update',
        'message:update',
        'message:error',
        'renderer:update',
        'renderer:error'
      ])
      expect(tapeRecorder.appendToolFact).not.toHaveBeenCalled()
    })

    it('settles an in-stream abort without a tool Tape snapshot', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const abortController = new AbortController()
      const coreStream = vi.fn(async function* () {
        yield { type: 'text', content: 'Partial' } as LLMCoreStreamEvent
        abortController.abort()
        yield { type: 'text', content: 'Ignored' } as LLMCoreStreamEvent
      }) as unknown as ProcessParams['coreStream']

      const result = await processStream(createParams({ coreStream, abortController }))

      expect(result.status).toBe('aborted')
      expect(order).toEqual([
        'renderer:update',
        'message:update',
        'message:error',
        'renderer:update',
        'renderer:error'
      ])
      expect(tapeRecorder.appendToolFact).not.toHaveBeenCalled()
    })

    it('persists the executed batch before a max-provider-round terminal error', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const coreStream = createToolRoundStream('action')

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(createMockToolPresenter({ action: 'ok' })),
          tools: [makeTool('action')],
          maxProviderRounds: 1
        })
      )

      expect(result).toMatchObject({
        status: 'error',
        stopReason: 'max_turns'
      })
      expect(order).toEqual([...TOOL_ROUND_COMMIT_ORDER, ...ERROR_TERMINAL_COMMIT_ORDER])
      expect(coreStream).toHaveBeenCalledTimes(1)
      expect(tapeRecorder.appendToolFact).toHaveBeenCalledTimes(2)
    })

    it('does not snapshot an oversized tool batch that never executes', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const toolPresenter = createMockToolPresenter({ action: 'ok' })
      const coreStream = vi.fn(async function* () {
        for (let index = 0; index < 129; index += 1) {
          yield {
            type: 'tool_call_start',
            tool_call_id: `tc${index}`,
            tool_call_name: 'action'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: `tc${index}`,
            tool_call_arguments_complete: '{}'
          } as LLMCoreStreamEvent
        }
        yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
      }) as unknown as ProcessParams['coreStream']

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(toolPresenter),
          tools: [makeTool('action')]
        })
      )

      expect(result).toMatchObject({ status: 'completed', stopReason: 'complete' })
      expect(order).toEqual([
        'renderer:update',
        'message:update',
        'renderer:update',
        'message:update',
        ...COMPLETED_TERMINAL_COMMIT_ORDER
      ])
      expect(toolPresenter.callTool).not.toHaveBeenCalled()
      expect(tapeRecorder.appendToolFact).not.toHaveBeenCalled()
    })

    it('persists a terminal tool-output error before the failed projection', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const longOutput = JSON.stringify({ data: 'x'.repeat(7000) })
      const coreStream = createToolRoundStream('cdp_send', '{"method":"Page.captureScreenshot"}')

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(createMockToolPresenter({ cdp_send: longOutput })),
          tools: [makeTool('cdp_send')],
          modelConfig: { contextLength: 1 } as any,
          maxTokens: 1
        })
      )

      expect(result.status).toBe('error')
      expect(order).toEqual([...TOOL_ROUND_COMMIT_ORDER, ...ERROR_TERMINAL_COMMIT_ORDER])
      expect(tapeRecorder.appendToolFact).toHaveBeenCalledTimes(2)
    })

    it('settles a post-stream abort without a tool Tape snapshot', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const abortController = new AbortController()
      const coreStream = vi.fn(async function* () {
        yield { type: 'text', content: 'Partial' } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        abortController.abort()
      }) as unknown as ProcessParams['coreStream']

      const result = await processStream(createParams({ coreStream, abortController }))

      expect(result.status).toBe('aborted')
      expect(order).toEqual(['renderer:update', 'message:update', ...ERROR_TERMINAL_COMMIT_ORDER])
      expect(tapeRecorder.appendToolFact).not.toHaveBeenCalled()
    })

    it('persists the completed tool batch before a post-tool abort', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const abortController = new AbortController()
      const toolPresenter = createMockToolPresenter()
      ;(toolPresenter.callTool as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        abortController.abort()
        return {
          content: 'ok',
          rawData: { toolCallId: 'tc1', content: 'ok', isError: false }
        }
      })

      const result = await processStream(
        createParams({
          coreStream: createToolRoundStream('action'),
          toolExecution: createToolExecutionPort(toolPresenter),
          tools: [makeTool('action')],
          abortController
        })
      )

      expect(result.status).toBe('aborted')
      expect(order).toEqual([...TOOL_ROUND_COMMIT_ORDER, ...ERROR_TERMINAL_COMMIT_ORDER])
      expect(tapeRecorder.appendToolFact).toHaveBeenCalledTimes(2)
    })

    it('persists the completed batch before settling for pending input', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const shouldYieldForPendingInput = vi.fn(() => true)
      const coreStream = createToolRoundStream('action')

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(createMockToolPresenter({ action: 'ok' })),
          tools: [makeTool('action')],
          shouldYieldForPendingInput
        })
      )

      expect(result).toMatchObject({
        status: 'completed',
        stopReason: 'pending_input'
      })
      expect(order).toEqual([...TOOL_ROUND_COMMIT_ORDER, ...COMPLETED_TERMINAL_COMMIT_ORDER])
      expect(coreStream).toHaveBeenCalledTimes(1)
      expect(tapeRecorder.appendToolFact).toHaveBeenCalledTimes(2)
    })
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
      controls: { onStreamingProviderPermission }
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
    expect(publishDeepchatEventMock).not.toHaveBeenCalledWith(
      'chat.stream.failed',
      expect.anything()
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
      toolExecution: createToolExecutionPort(toolPresenter),
      tools: [makeTool('get_weather')],
      onConversationMessagesChange: (messages) => {
        liveMessages = messages
      }
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(coreStream).toHaveBeenCalledTimes(2)
    expect(params.run.providerRoundCount).toBe(2)
    expect(toolPresenter.callTool).toHaveBeenCalledTimes(1)
    expect(messageStore.finalizeAssistantMessage).toHaveBeenCalled()

    // Second call should have tool result in messages
    const secondCallMessages = (coreStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
    const toolResultMsg = secondCallMessages.find((m: any) => m.role === 'tool')
    expect(liveMessages).toBe(secondCallMessages)
    expect(toolResultMsg).toBeDefined()
    expect(toolResultMsg.content).toBe('Sunny, 72F')
  })

  it('notifies in tool order with detached committed snapshots', async () => {
    const notifications: DeepChatLoopNotification[] = []
    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny, 72F' })
    const params = createParams({
      coreStream: createToolThenCompleteStream('get_weather'),
      toolExecution: createToolExecutionPort(toolPresenter),
      tools: [makeTool('get_weather')],
      notificationObserver: {
        notify: (notification) => {
          notifications.push(structuredClone(notification))
          ;(notification.tool as { name?: string; response?: string }).name = 'observer-mutated'
          ;(notification.tool as { name?: string; response?: string }).response = 'observer-mutated'
        }
      }
    })

    const result = await processStream(params)

    expect(result.status).toBe('completed')
    expect(notifications).toEqual([
      {
        event: 'PreToolUse',
        tool: { callId: 'tc1', name: 'get_weather', params: '{}' }
      },
      {
        event: 'PostToolUse',
        tool: {
          callId: 'tc1',
          name: 'get_weather',
          params: '{}',
          response: 'Sunny, 72F'
        }
      }
    ])
    expect(params.run.streamState.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_call',
          tool_call: expect.objectContaining({
            name: 'get_weather',
            response: 'Sunny, 72F'
          })
        })
      ])
    )
  })

  it('keeps the terminal outcome when a notification observer throws synchronously', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny, 72F' })

    try {
      const result = await processStream(
        createParams({
          coreStream: createToolThenCompleteStream('get_weather'),
          toolExecution: createToolExecutionPort(toolPresenter),
          tools: [makeTool('get_weather')],
          notificationObserver: {
            notify: () => {
              throw new Error('observer failed')
            }
          }
        })
      )

      expect(result.status).toBe('completed')
      expect(toolPresenter.callTool).toHaveBeenCalledTimes(1)
      expect(warning).toHaveBeenCalledTimes(2)
    } finally {
      warning.mockRestore()
    }
  })

  it('does not await rejected or never-settling notification observers', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let releaseObserver!: () => void
    const neverSettlingUntilReleased = new Promise<void>((resolve) => {
      releaseObserver = resolve
    })
    const rejectedThenable = {
      then: (_resolve: unknown, reject?: (reason: unknown) => unknown) => {
        reject?.(new Error('observer rejected'))
      }
    } as unknown as PromiseLike<void>
    const notify = vi.fn((notification: DeepChatLoopNotification) =>
      notification.event === 'PreToolUse' ? neverSettlingUntilReleased : rejectedThenable
    )
    const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny, 72F' })
    const processPromise = processStream(
      createParams({
        coreStream: createToolThenCompleteStream('get_weather'),
        toolExecution: createToolExecutionPort(toolPresenter),
        tools: [makeTool('get_weather')],
        notificationObserver: { notify }
      })
    )
    let settled = false
    void processPromise.then(() => {
      settled = true
    })

    try {
      await vi.runAllTimersAsync()
      await Promise.resolve()

      expect(notify.mock.calls.map(([notification]) => notification.event)).toEqual([
        'PreToolUse',
        'PostToolUse'
      ])
      expect(settled).toBe(true)
    } finally {
      releaseObserver()
    }

    const result = await processPromise
    await Promise.resolve()
    expect(result.status).toBe('completed')
    expect(warning).toHaveBeenCalledTimes(1)
    warning.mockRestore()
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
      toolExecution: createToolExecutionPort(toolPresenter),
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
    expect(params.run.providerRoundCount).toBe(2)
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
      toolExecution: createToolExecutionPort(toolPresenter),
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
      toolExecution: createToolExecutionPort(toolPresenter),
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
    const resolveTools = vi
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
      toolExecution: createToolExecutionPort(toolPresenter),
      toolCatalog: { resolve: resolveTools },
      tools: [makeTool('skill_view')],
      refreshSystemPrompt,
      controls: {
        activateSkill,
        getActiveSkillNames
      }
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(activateSkill).toHaveBeenCalledWith('deepchat-settings')
    expect(getActiveSkillNames).toHaveBeenCalled()
    expect(resolveTools).toHaveBeenCalledTimes(1)
    expect(resolveTools).toHaveBeenCalledWith({ activeSkillNames: ['deepchat-settings'] })
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
    const resolveTools = vi.fn().mockResolvedValue([makeTool('deepchat_settings_set_theme')])

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
      toolExecution: createToolExecutionPort(toolPresenter),
      toolCatalog: { resolve: resolveTools },
      tools: [makeTool('skill_view')]
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(resolveTools).not.toHaveBeenCalled()
    expect(coreStream).toHaveBeenCalledTimes(2)
  })

  it('offloads large tool results before the next provider call', async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-process-offload-'))
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempHome)

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
      toolExecution: createToolExecutionPort(toolPresenter),
      tools: [makeTool('cdp_send')]
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    const secondCallMessages = (coreStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
    const toolResultMsg = secondCallMessages.find((m: any) => m.role === 'tool')
    const offloadPath = resolveToolOffloadPath('s1', 'function.cdp_send:11')
    expect(toolResultMsg.content).toContain('[Tool output offloaded]')
    expect(toolResultMsg.content).toContain(`Offload file: ${offloadPath}`)
    expect(toolResultMsg.content).not.toContain(':11.offload')
    await expect(fs.readFile(offloadPath!, 'utf-8')).resolves.toBe(longScreenshot)
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
      toolExecution: createToolExecutionPort(toolPresenter),
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
      toolExecution: createToolExecutionPort(toolPresenter),
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
      toolExecution: createToolExecutionPort(toolPresenter),
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
      toolExecution: createToolExecutionPort(toolPresenter),
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
      toolExecution: createToolExecutionPort(toolPresenter),
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
          tool_call_arguments_complete: '{}'
        } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      toolExecution: createToolExecutionPort(toolPresenter),
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
    expect(messageStore.updateAssistantContent).not.toHaveBeenCalled()
    expect(messageStore.setMessageError).not.toHaveBeenCalled()
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
    expect(messageStore.setMessageError).not.toHaveBeenCalled()
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
    expect(messageStore.updateAssistantContent).toHaveBeenLastCalledWith(
      'm1',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'content',
          content: 'Partial answer',
          status: 'success'
        })
      ])
    )
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
        yield { type: 'text', content: 'First' } as LLMCoreStreamEvent
        abortController.abort()
        yield { type: 'text', content: 'Second' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      abortController
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(params.run.abortController).toBe(abortController)
    expect(params.run.abortController.signal.aborted).toBe(true)
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
    expectDeepchatEvent('chat.stream.failed', {
      sessionId: 's1',
      messageId: 'm1',
      requestId: 'req-1',
      error: 'common.error.userCanceledGeneration'
    })
  })

  it('does not finalize user-cancel twice when the message is already cancelled', async () => {
    const abortController = new AbortController()
    const coreStream = vi.fn(function () {
      return (async function* () {
        abortController.abort()
        yield { type: 'text', content: 'ignored' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      abortController
    })
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
      toolExecution: createToolExecutionPort(toolPresenter),
      tools: [makeTool('action')],
      abortController
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
      toolExecution: createToolExecutionPort(toolPresenter),
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
    expectDeepchatEvent('chat.stream.failed', {
      sessionId: 's1',
      messageId: 'm1',
      requestId: 'req-1',
      error: 'Connection lost'
    })
  })
})
