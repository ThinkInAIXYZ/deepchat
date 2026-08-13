import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import {
  TOOL_EXECUTION,
  type MCPToolDefinition
} from '@shared/types/mcp'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { ToolServicePort } from '@shared/types/tool'
import type { ProcessParams } from '@/agent/deepchat/runtime/types'
import { createState } from '@/agent/deepchat/runtime/types'
import { ToolOutputGuard } from '@/agent/deepchat/runtime/toolOutputGuard'
import {
  createToolExecutionPort,
  createToolResultPort
} from '@/agent/deepchat/runtime/toolAdapters'
import {
  bindActiveRequestContract,
  bindActiveRequestView,
  createLoopRun
} from '@/agent/deepchat/loop/loopRun'
import type { DeepChatLoopNotification } from '@/agent/deepchat/loop/ports'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { resolveToolOffloadPath } from '@/agent/shared/storage/sessionPaths'
import { createDeepSeekResponsesReplayProjector } from '@/provider/deepseekResponsesAdapter'
import { createDeepSeekReplayJson } from '../../../../fixtures/deepseekResponses'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())
const RUN_ID = '11111111-1111-4111-8111-111111111111'

vi.mock('@/events', () => ({
  STREAM_EVENTS: {
    RESPONSE: 'stream:response',
    END: 'stream:end',
    ERROR: 'stream:error'
  }
}))

import { accumulate } from '@/agent/deepchat/runtime/accumulator'
import {
  INCOMPLETE_PROVIDER_STREAM_ERROR,
  INCOMPLETE_TOOL_USE_ERROR,
  processStream,
  resolveProviderTerminalDecision
} from '@/agent/deepchat/runtime/process'
import { TRUNCATED_TOOL_CALL_ERROR } from '@/agent/deepchat/runtime/dispatch'
import { createOpaquePromptAssembly } from '@/agent/deepchat/resources/promptAssembly'
import {
  buildExecutionContract,
  buildExecutionContractBinding
} from '@/tape/domain/executionContract'

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

describe('provider terminal decisions', () => {
  it('rejects a provider stream that ends without a stop event', () => {
    expect(resolveProviderTerminalDecision(createState())).toEqual({
      type: 'error',
      error: INCOMPLETE_PROVIDER_STREAM_ERROR,
      source: 'provider',
      stopReason: 'provider_error'
    })
  })

  it('preserves max_turn_requests as a bounded completion', () => {
    const state = createState()
    accumulate(state, { type: 'text', content: 'partial response' })
    accumulate(state, { type: 'stop', stop_reason: 'max_turn_requests' })

    expect(resolveProviderTerminalDecision(state)).toEqual({
      type: 'complete',
      stopReason: 'max_turn_requests'
    })
  })

  it('rejects tool_use without a completed tool call', () => {
    const state = createState()
    accumulate(state, { type: 'text', content: 'calling a tool' })
    accumulate(state, { type: 'stop', stop_reason: 'tool_use' })

    expect(resolveProviderTerminalDecision(state)).toEqual({
      type: 'error',
      error: INCOMPLETE_TOOL_USE_ERROR,
      source: 'provider',
      stopReason: 'provider_error'
    })
  })

  it('rejects a non-canonical provider stop reason instead of treating it as complete', () => {
    const state = createState()
    accumulate(state, { type: 'text', content: 'partial response' })
    state.stopReason = 'end_turn' as any

    expect(() => resolveProviderTerminalDecision(state)).toThrow(
      'Unsupported provider stop reason: end_turn'
    )
  })
})

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
    execution: TOOL_EXECUTION.write,
    type: 'function',
    function: {
      name,
      description: `Tool ${name}`,
      parameters: { type: 'object', properties: {} }
    },
    server: { name: 'test-server', icons: '', description: 'Test server' }
  }
}

function makeRuntimeSkillResolution(content = '# Effective Skill body') {
  return {
    identity: {
      agentId: 'deepchat',
      sourceType: 'created' as const,
      sourceId: '/skills/deepchat-settings',
      skillName: 'deepchat-settings'
    },
    effectiveContent: content,
    builderVersion: 'builder-1',
    renderedManifestHash: 'a'.repeat(64),
    scriptInventoryHash: 'a'.repeat(64),
    executionPackage: {
      files: [],
      executables: [],
      runtimePolicy: { python: 'auto' as const, node: 'auto' as const },
      environmentBindingId: null
    }
  }
}

function createMockToolService(responses: Record<string, string> = {}): ToolServicePort {
  return {
    getAllToolDefinitions: vi.fn().mockResolvedValue([]),
    syncAgentToolContext: vi.fn(),
    callTool: vi.fn(async (request) => {
      const name = request.function.name
      const responseText = responses[name] ?? `result for ${name}`
      return {
        content: responseText,
        rawData: { toolCallId: request.id, content: responseText, isError: false }
      }
    }),
    preCheckToolPermission: vi.fn().mockResolvedValue(null),
    clearConversationToolMapping: vi.fn(),
    clearAgentPlanState: vi.fn(),
    buildToolSystemPrompt: vi.fn().mockReturnValue('')
  } as unknown as ToolServicePort
}

function createPostCallPermissionToolService(): ToolServicePort {
  const toolService = createMockToolService()
  ;(toolService.callTool as ReturnType<typeof vi.fn>).mockResolvedValue({
    content: 'permission required',
    rawData: {
      content: 'permission required',
      isError: true,
      requiresPermission: true,
      permissionRequest: {
        permissionType: 'write',
        description: 'Need permission to write the file',
        toolName: 'action',
        serverName: 'test-server',
        paths: ['output.txt']
      }
    }
  })
  return toolService
}

function makeStreamEvents(...events: LLMCoreStreamEvent[]): LLMCoreStreamEvent[] {
  return events
}

describe('processStream', () => {
  let messageStore: ReturnType<typeof createMockMessageStore>
  let tapeToolFactWriter: { appendToolFact: ReturnType<typeof vi.fn> }
  let executionJournalWriter: {
    commitDispatch: ReturnType<typeof vi.fn>
    commitToolOutcome: ReturnType<typeof vi.fn>
  }
  let commitRunTerminal: ReturnType<typeof vi.fn>
  let tempHome: string | null = null
  let homedirSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    messageStore = createMockMessageStore()
    commitRunTerminal = vi.fn()
    tapeToolFactWriter = {
      appendToolFact: vi.fn(async (input) => ({
        sessionId: input.sessionId,
        entryId: 1
      }))
    }
    executionJournalWriter = {
      commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
      commitToolOutcome: vi.fn(() => ({ sessionId: 's1', entryId: 2, created: true }))
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
    const toolService = createMockToolService()
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
          runId: RUN_ID,
          sessionId: toAppSessionId('s1'),
          messageId: 'm1',
          abortController,
          messages,
          streamState: createState(),
          resources: {
            toolDefinitions: tools,
            activeSkillNames: [],
            commandShell: POSIX_COMMAND_SHELL
          },
          initialRequestSeq: 1
        }),
      toolCatalog: {
        resolve: vi.fn().mockResolvedValue(tools)
      },
      toolExecution: createToolExecutionPort(toolService),
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
      commitRunTerminal,
      io: {
        messageStore,
        tapeToolFactWriter,
        executionJournalWriter,
        publishEvent: publishDeepchatEventMock,
        publishSessionUpdate: vi.fn()
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
    commitRunTerminal.mockImplementation(() => {
      order.push('journal:terminal')
    })
    messageStore.updateAssistantContent.mockImplementation(() => {
      order.push('message:update')
    })
    messageStore.finalizeAssistantMessage.mockImplementation(() => {
      order.push('message:complete')
    })
    messageStore.setMessageError.mockImplementation(() => {
      order.push('message:error')
    })
    tapeToolFactWriter.appendToolFact.mockImplementation(async (input) => {
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

  function createScriptedCoreStream(
    rounds: readonly (readonly LLMCoreStreamEvent[])[],
    providerInputs: ChatMessage[][] = [],
    onRoundComplete?: (roundIndex: number) => void
  ): ProcessParams['coreStream'] {
    let roundIndex = 0
    return vi.fn((messages: ChatMessage[]) => {
      const currentRoundIndex = roundIndex++
      const events = rounds[currentRoundIndex]
      if (!events) {
        throw new Error(`Missing scripted provider round ${currentRoundIndex + 1}`)
      }
      providerInputs.push(structuredClone(messages))
      return (async function* () {
        for (const event of events) {
          yield event
        }
        onRoundComplete?.(currentRoundIndex)
      })()
    }) as unknown as ProcessParams['coreStream']
  }

  it('persists normalized provider search results with the assistant message', async () => {
    const providerReplayJson = createDeepSeekReplayJson()
    const resultRow = {
      title: 'DeepChat',
      url: 'https://deepchat.thinkinai.xyz/',
      snippet: 'A privacy-first AI chat client.',
      rank: 0,
      searchId: 'ws_1'
    }
    const citationRow = {
      title: 'DeepChat Docs',
      url: 'https://deepchat.thinkinai.xyz/docs',
      rank: 1,
      searchId: 'ws_1'
    }
    const coreStream = vi.fn(async function* () {
      yield {
        type: 'provider_search',
        provider_search: {
          id: 'ws_1',
          action: { type: 'search', target: 'DeepChat' },
          label: 'DeepChat',
          provider: 'deepseek',
          results: [resultRow],
          providerReplayJson
        }
      } as LLMCoreStreamEvent
      yield {
        type: 'provider_url_source',
        provider_url_source: citationRow
      } as LLMCoreStreamEvent
      yield { type: 'text', content: 'DeepChat is an AI client.' } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
    })
    const params = createParams({ coreStream })

    await expect(processStream(params)).resolves.toMatchObject({ status: 'completed' })

    expect(messageStore.addSearchResult).toHaveBeenCalledTimes(2)
    expect(messageStore.addSearchResult).toHaveBeenNthCalledWith(1, {
      sessionId: params.run.sessionId,
      messageId: params.run.messageId,
      searchId: 'ws_1',
      rank: 0,
      result: resultRow
    })
    expect(messageStore.addSearchResult).toHaveBeenNthCalledWith(2, {
      sessionId: params.run.sessionId,
      messageId: params.run.messageId,
      searchId: 'ws_1',
      rank: 1,
      result: citationRow
    })
    expect(params.run.streamState.blocks).toEqual([
      expect.objectContaining({
        id: 'ws_1',
        type: 'search',
        status: 'success',
        extra: expect.objectContaining({
          total: 2,
          pages: [
            {
              title: 'DeepChat',
              url: 'https://deepchat.thinkinai.xyz/',
              content: 'A privacy-first AI chat client.'
            },
            {
              title: 'DeepChat Docs',
              url: 'https://deepchat.thinkinai.xyz/docs'
            }
          ],
          providerReplayJson
        })
      }),
      expect.objectContaining({
        type: 'content',
        content: 'DeepChat is an AI client.',
        status: 'success'
      })
    ])
  })

  it('replays provider search output before continuing a local tool round', async () => {
    const providerReplayJson = createDeepSeekReplayJson()
    let callCount = 0
    const coreStream = vi.fn(function () {
      callCount += 1
      if (callCount === 1) {
        return (async function* () {
          yield { type: 'text', content: 'Before search.' } as LLMCoreStreamEvent
          yield {
            type: 'provider_search',
            provider_search: {
              id: 'ws_1',
              action: { type: 'search', target: 'DeepChat' },
              label: 'DeepChat',
              provider: 'deepseek',
              results: [],
              providerReplayJson
            }
          } as LLMCoreStreamEvent
          yield { type: 'text', content: 'After search.' } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_start',
            tool_call_id: 'tc_1',
            tool_call_name: 'read_file'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'tc_1',
            tool_call_arguments_complete: '{"path":"README.md"}'
          } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      }

      return (async function* () {
        yield { type: 'text', content: 'Done' } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']
    const providerReplayProjector = createDeepSeekResponsesReplayProjector({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    })
    if (!providerReplayProjector) {
      throw new Error('Expected provider replay projector')
    }
    const params = createParams({
      coreStream,
      tools: [makeTool('read_file')],
      providerReplayProjector
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(coreStream).toHaveBeenCalledTimes(2)
    expect((coreStream as ReturnType<typeof vi.fn>).mock.calls[1][0]).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Before search.' },
      {
        role: 'assistant',
        provider_replay: { markerId: 'ws_1', payload: providerReplayJson }
      },
      {
        role: 'assistant',
        content: 'After search.',
        tool_calls: [
          {
            id: 'tc_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"README.md"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'tc_1', content: 'result for read_file' }
    ])
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
    const ERROR_TERMINAL_COMMIT_ORDER = [
      'journal:terminal',
      'message:error',
      'renderer:update',
      'renderer:error'
    ]
    const COMPLETED_TERMINAL_COMMIT_ORDER = [
      'journal:terminal',
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

      const params = createParams({ coreStream })
      const result = await processStream(params)

      expect(result.status).toBe('completed')
      expect(coreStream).toHaveBeenCalledTimes(1)
      expect(params.run.logicalRound).toBe(1)
      expect(params.run.requestSeq).toBe(1)
      expect(order).toEqual([
        'renderer:update',
        'message:update',
        'renderer:update',
        'message:update',
        'journal:terminal',
        'message:complete',
        'renderer:update',
        'renderer:complete'
      ])
      expect(commitRunTerminal).toHaveBeenCalledWith({
        outcome: 'completed',
        stopReason: 'complete'
      })
      expect(tapeToolFactWriter.appendToolFact).not.toHaveBeenCalled()
      expect(JSON.parse(messageStore.finalizeAssistantMessage.mock.calls[0][2])).toMatchObject({
        provider: 'openai',
        model: 'gpt-4'
      })
      expectDeepchatEvent('chat.stream.completed', {
        sessionId: 's1',
        messageId: 'm1',
        requestId: RUN_ID
      })
    })

    it('does not select a conflicting terminal when projection fails after commit', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      messageStore.finalizeAssistantMessage.mockImplementation(() => {
        order.push('message:complete')
        throw new Error('final write failed')
      })

      await expect(processStream(createParams())).rejects.toThrow('final write failed')
      expect(order).toEqual([
        'renderer:update',
        'message:update',
        'renderer:update',
        'message:update',
        'journal:terminal',
        'message:complete',
      ])
      expect(messageStore.finalizeAssistantMessage).toHaveBeenCalledTimes(1)
      expect(messageStore.setMessageError).not.toHaveBeenCalled()
      expect(commitRunTerminal).toHaveBeenCalledOnce()
      expect(tapeToolFactWriter.appendToolFact).not.toHaveBeenCalled()
    })

    it('prevents terminal transcript and renderer projection when the journal commit fails', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      commitRunTerminal.mockImplementation(() => {
        order.push('journal:terminal')
        throw new Error('journal unavailable')
      })

      await expect(processStream(createParams())).rejects.toThrow('journal unavailable')

      expect(order).toEqual([
        'renderer:update',
        'message:update',
        'renderer:update',
        'message:update',
        'journal:terminal'
      ])
      expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
      expect(messageStore.setMessageError).not.toHaveBeenCalled()
      expect(publishDeepchatEventMock).not.toHaveBeenCalledWith(
        'chat.stream.completed',
        expect.anything()
      )
      expect(publishDeepchatEventMock).not.toHaveBeenCalledWith(
        'chat.stream.failed',
        expect.anything()
      )
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
          toolExecution: createToolExecutionPort(createMockToolService({ action: 'ok' })),
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
        'journal:terminal',
        'message:complete',
        'renderer:update',
        'renderer:complete'
      ])
      expect(tapeToolFactWriter.appendToolFact).toHaveBeenCalledTimes(6)
      expect(
        tapeToolFactWriter.appendToolFact.mock.calls.map(([input]) => [
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

    it('keeps the tool loop fail-open when TapeToolFactWriter rejects a fact', async () => {
      tapeToolFactWriter.appendToolFact.mockRejectedValue(new Error('tape unavailable'))
      const coreStream = createToolThenCompleteStream('action')

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(createMockToolService({ action: 'ok' })),
          tools: [makeTool('action')]
        })
      )

      expect(result.status).toBe('completed')
      expect(coreStream).toHaveBeenCalledTimes(2)
      expect(tapeToolFactWriter.appendToolFact).toHaveBeenCalledTimes(1)
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
        'journal:terminal',
        'message:update',
        'renderer:update',
        'renderer:complete'
      ])
      expect(commitRunTerminal).toHaveBeenCalledWith({
        outcome: 'paused',
        stopReason: 'interaction'
      })
      expect(tapeToolFactWriter.appendToolFact).not.toHaveBeenCalled()
    })

    it('normalizes an inherited unresolved block before a later interaction pause', async () => {
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
        createParams({
          coreStream,
          tools: [makeTool('deepchat_question')],
          initialBlocks: [
            {
              type: 'tool_call',
              content: '',
              status: 'loading',
              timestamp: Date.now(),
              tool_call: {
                id: 'subagent-running',
                name: 'agent',
                params: '{}',
                response: ''
              }
            }
          ]
        })
      )

      expect(result.status).toBe('paused')
      expect(commitRunTerminal).toHaveBeenCalledOnce()
      expect(commitRunTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'paused', stopReason: 'interaction' })
      )
      const finalPauseCall = messageStore.updateAssistantContent.mock.calls.findLast(
        (call) => typeof call[2] === 'string'
      )
      expect(finalPauseCall?.[1][0]).toMatchObject({ type: 'tool_call', status: 'error' })
      expect(order.indexOf('journal:terminal')).toBeLessThan(order.lastIndexOf('message:update'))
    })

    it('accounts for executed tools before pausing a mixed tool batch', async () => {
      const coreStream = vi.fn(async function* () {
        yield {
          type: 'tool_call_start',
          tool_call_id: 'action-1',
          tool_call_name: 'action'
        } as LLMCoreStreamEvent
        yield {
          type: 'tool_call_end',
          tool_call_id: 'action-1',
          tool_call_arguments_complete: '{}'
        } as LLMCoreStreamEvent
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
      const toolService = createMockToolService({ action: 'ok' })

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(toolService),
          tools: [makeTool('action'), makeTool('deepchat_question')]
        })
      )

      expect(result).toMatchObject({
        status: 'paused',
        pendingInteractions: [expect.objectContaining({ toolCallId: 'question-1' })]
      })
      expect(toolService.callTool).toHaveBeenCalledOnce()
      const finalPauseCall = messageStore.updateAssistantContent.mock.calls.findLast(
        (call) => typeof call[2] === 'string'
      )
      expect(finalPauseCall).toBeDefined()
      expect(JSON.parse(finalPauseCall?.[2])).toMatchObject({
        providerRounds: 1,
        toolCalls: 1,
        runOutcome: 'paused',
        runStopReason: 'interaction'
      })
    })

    it('carries the active request contract to tool dispatch by exact reference', async () => {
      const tools = [makeTool('action')]
      const run = createLoopRun({
        runId: RUN_ID,
        sessionId: toAppSessionId('s1'),
        messageId: 'm1',
        abortController: new AbortController(),
        messages: [{ role: 'user', content: 'Hello' }],
        streamState: createState(),
        resources: {
          toolDefinitions: tools,
          activeSkillNames: [],
          commandShell: POSIX_COMMAND_SHELL
        },
        initialRequestSeq: 1
      })
      const executionContract = {
        request: {
          sessionId: run.sessionId,
          messageId: run.messageId,
          runId: run.runId,
          requestSeq: 1
        }
      } as any
      bindActiveRequestContract(run, 1, executionContract)
      bindActiveRequestView(run, {
        requestSeq: 1,
        manifestHash: 'a'.repeat(64),
        tapeIncarnationId: 'incarnation-1'
      })
      const toolService = createMockToolService({ action: 'ok' })

      await processStream(
        createParams({
          run,
          coreStream: createToolThenCompleteStream('action'),
          toolExecution: createToolExecutionPort(toolService),
          tools
        })
      )

      expect(toolService.callTool).toHaveBeenCalled()
      expect((toolService.callTool as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({
        runId: RUN_ID,
        messageId: 'm1',
        requestSeq: 1,
        manifestHash: 'a'.repeat(64),
        tapeIncarnationId: 'incarnation-1',
        executionContract
      })
      expect(
        (toolService.callTool as ReturnType<typeof vi.fn>).mock.calls[0][1].executionContract
      ).toBe(executionContract)
    })

    it('keeps the exact request contract and a durable View binding across permission pause', async () => {
      const tools = [{ ...makeTool('action'), source: 'agent' as const }]
      const run = createLoopRun({
        runId: RUN_ID,
        sessionId: toAppSessionId('s1'),
        messageId: 'm1',
        abortController: new AbortController(),
        messages: [{ role: 'user', content: 'Hello' }],
        streamState: createState(),
        resources: {
          toolDefinitions: tools,
          activeSkillNames: [],
          commandShell: POSIX_COMMAND_SHELL
        },
        initialRequestSeq: 1
      })
      const promptAssembly = createOpaquePromptAssembly('System prompt')
      const executionContract = buildExecutionContract({
        request: {
          sessionId: run.sessionId,
          messageId: run.messageId,
          runId: run.runId,
          requestSeq: 1
        },
        promptAssembly,
        providerMessages: [
          { role: 'system', content: promptAssembly.prompt },
          { role: 'user', content: 'Hello' }
        ],
        tools,
        providerId: 'openai',
        modelId: 'gpt-4',
        modelConfig: {} as any,
        temperature: 0.7,
        maxTokens: 4096,
        workspace: { kind: 'runtime_default' },
        maxSubagentDepth: 0,
        dynamicControlSnapshot: {
          permissionMode: 'default',
          requestAdmitted: true,
          cancellationRequested: false
        },
        assemblerVersion: 'test-v1'
      })
      bindActiveRequestContract(run, 1, executionContract)

      const result = await processStream(
        createParams({
          run,
          coreStream: createToolRoundStream('action'),
          toolExecution: createToolExecutionPort(createPostCallPermissionToolService()),
          tools,
          permissionMode: 'default'
        })
      )

      expect(result.status).toBe('paused')
      expect(result.toolBatchExecutionState?.executionContract).toBe(executionContract)
      const finalPauseCall = messageStore.updateAssistantContent.mock.calls.findLast(
        (call) => typeof call[2] === 'string'
      )
      expect(finalPauseCall).toBeDefined()
      const permissionBlock = finalPauseCall?.[1].find(
        (block) => block.action_type === 'tool_call_permission'
      )
      expect(permissionBlock).toBeDefined()
      expect(JSON.parse(permissionBlock?.extra?.executionContractBinding as string)).toEqual(
        buildExecutionContractBinding(executionContract)
      )
    })

    it('counts a post-call permission tool before persisting pause', async () => {
      const toolService = createPostCallPermissionToolService()

      const result = await processStream(
        createParams({
          coreStream: createToolRoundStream('action'),
          toolExecution: createToolExecutionPort(toolService),
          tools: [makeTool('action')],
          permissionMode: 'default'
        })
      )

      expect(result).toMatchObject({
        status: 'paused',
        pendingInteractions: [expect.objectContaining({ origin: 'post-call-permission' })]
      })
      expect(result.toolBatchExecutionState?.executionContract).toBeUndefined()
      expect(toolService.callTool).toHaveBeenCalledOnce()
      const finalPauseCall = messageStore.updateAssistantContent.mock.calls.findLast(
        (call) => typeof call[2] === 'string'
      )
      expect(finalPauseCall).toBeDefined()
      const permissionBlock = finalPauseCall?.[1].find(
        (block) => block.action_type === 'tool_call_permission'
      )
      expect(permissionBlock?.extra?.executionContractBinding).toBeUndefined()
      expect(JSON.parse(finalPauseCall?.[2])).toMatchObject({
        providerRounds: 1,
        toolCalls: 1,
        runOutcome: 'paused',
        runStopReason: 'interaction'
      })
    })

    it('enforces the global tool-call cap after a post-call permission pause', async () => {
      const pausedToolService = createPostCallPermissionToolService()

      const pausedResult = await processStream(
        createParams({
          coreStream: createToolRoundStream('action'),
          toolExecution: createToolExecutionPort(pausedToolService),
          tools: [makeTool('action')],
          permissionMode: 'default',
          initialAccounting: { providerRounds: 0, toolCalls: 127 }
        })
      )

      expect(pausedResult).toMatchObject({ status: 'paused' })
      const finalPauseCall = messageStore.updateAssistantContent.mock.calls.findLast(
        (call) => typeof call[2] === 'string'
      )
      expect(finalPauseCall).toBeDefined()
      const pausedMetadata = JSON.parse(finalPauseCall?.[2])
      expect(pausedMetadata).toMatchObject({
        toolCalls: 128,
        runOutcome: 'paused',
        runStopReason: 'interaction'
      })

      const resumedToolService = createMockToolService({ action: 'should not run' })
      const resumedResult = await processStream(
        createParams({
          coreStream: createToolRoundStream('action'),
          toolExecution: createToolExecutionPort(resumedToolService),
          tools: [makeTool('action')],
          initialAccounting: pausedMetadata
        })
      )

      expect(resumedResult).toMatchObject({ status: 'completed', stopReason: 'max_tool_calls' })
      expect(resumedToolService.callTool).not.toHaveBeenCalled()
      expect(
        JSON.parse(messageStore.finalizeAssistantMessage.mock.calls.at(-1)?.[2])
      ).toMatchObject({
        toolCalls: 128,
        runOutcome: 'completed',
        runStopReason: 'max_tool_calls'
      })
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
        'journal:terminal',
        'message:error',
        'renderer:update',
        'renderer:error'
      ])
      expect(commitRunTerminal).toHaveBeenCalledWith({
        outcome: 'error',
        stopReason: 'provider_error',
        errorMessage: 'Connection lost'
      })
      expect(messageStore.setMessageError).toHaveBeenCalled()
      expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
      expect(tapeToolFactWriter.appendToolFact).not.toHaveBeenCalled()
      expectDeepchatEvent('chat.stream.failed', {
        sessionId: 's1',
        messageId: 'm1',
        requestId: RUN_ID,
        error: 'Connection lost'
      })
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
        'journal:terminal',
        'message:error',
        'renderer:update',
        'renderer:error'
      ])
      expect(commitRunTerminal).toHaveBeenCalledWith({
        outcome: 'aborted',
        stopReason: 'user_stop',
        errorMessage: 'common.error.userCanceledGeneration'
      })
      expect(abortController.signal.aborted).toBe(true)
      const abortMetadata = JSON.parse(messageStore.setMessageError.mock.calls[0][2])
      expect(abortMetadata).toMatchObject({ provider: 'openai', model: 'gpt-4' })
      expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
      expect(tapeToolFactWriter.appendToolFact).not.toHaveBeenCalled()
      expectDeepchatEvent('chat.stream.failed', {
        sessionId: 's1',
        messageId: 'm1',
        requestId: RUN_ID,
        error: 'common.error.userCanceledGeneration'
      })
    })

    it('persists the executed batch before a max-provider-round terminal error', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const coreStream = createToolRoundStream('action')

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(createMockToolService({ action: 'ok' })),
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
      expect(tapeToolFactWriter.appendToolFact).toHaveBeenCalledTimes(2)
    })

    it('does not snapshot an oversized tool batch that never executes', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const toolService = createMockToolService({ action: 'ok' })
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
          toolExecution: createToolExecutionPort(toolService),
          tools: [makeTool('action')]
        })
      )

      expect(result).toMatchObject({ status: 'completed', stopReason: 'max_tool_calls' })
      expect(order).toEqual([
        'renderer:update',
        'message:update',
        'renderer:update',
        'message:update',
        ...COMPLETED_TERMINAL_COMMIT_ORDER
      ])
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(tapeToolFactWriter.appendToolFact).not.toHaveBeenCalled()
    })

    it('persists a terminal tool-output error before the failed projection', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const longOutput = JSON.stringify({ data: 'x'.repeat(7000) })
      const coreStream = createToolRoundStream('cdp_send', '{"method":"Page.captureScreenshot"}')

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(createMockToolService({ cdp_send: longOutput })),
          tools: [makeTool('cdp_send')],
          modelConfig: { contextLength: 1 } as any,
          maxTokens: 1
        })
      )

      expect(result.status).toBe('error')
      expect(result.terminalError).toContain('remaining context window is too small')
      expect(order).toEqual([...TOOL_ROUND_COMMIT_ORDER, ...ERROR_TERMINAL_COMMIT_ORDER])
      expect(coreStream).toHaveBeenCalledTimes(1)
      expect(messageStore.setMessageError).toHaveBeenCalled()
      expect(tapeToolFactWriter.appendToolFact).toHaveBeenCalledTimes(2)
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
      expect(tapeToolFactWriter.appendToolFact).not.toHaveBeenCalled()
    })

    it('persists the completed tool batch before a post-tool abort', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const abortController = new AbortController()
      const toolService = createMockToolService()
      ;(toolService.callTool as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        abortController.abort()
        return {
          content: 'ok',
          rawData: { toolCallId: 'tc1', content: 'ok', isError: false }
        }
      })

      const result = await processStream(
        createParams({
          coreStream: createToolRoundStream('action'),
          toolExecution: createToolExecutionPort(toolService),
          tools: [makeTool('action')],
          abortController
        })
      )

      expect(result.status).toBe('aborted')
      expect(order).toEqual([...TOOL_ROUND_COMMIT_ORDER, ...ERROR_TERMINAL_COMMIT_ORDER])
      expect(toolService.callTool).toHaveBeenCalledTimes(1)
      expect(messageStore.setMessageError).toHaveBeenCalled()
      expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
      expect(tapeToolFactWriter.appendToolFact).toHaveBeenCalledTimes(2)
    })

    it('keeps a tool-local AbortError as a tool failure while the run remains active', async () => {
      let providerRound = 0
      const coreStream = vi.fn(() => {
        providerRound += 1
        if (providerRound === 1) {
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
        }
        return (async function* () {
          yield { type: 'text', content: 'Recovered' } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
        })()
      }) as unknown as ProcessParams['coreStream']
      const timeoutError = new Error('Model request timed out')
      timeoutError.name = 'AbortError'
      const toolService = createMockToolService()
      ;(toolService.callTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(timeoutError)

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(toolService),
          tools: [makeTool('action')]
        })
      )

      expect(result).toMatchObject({ status: 'completed', stopReason: 'complete' })
      expect(messageStore.setMessageError).not.toHaveBeenCalled()
      expect(messageStore.finalizeAssistantMessage.mock.calls.at(-1)?.[1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_call',
            status: 'error',
            tool_call: expect.objectContaining({ response: 'Error: Model request timed out' })
          })
        ])
      )
      expect(tapeToolFactWriter.appendToolFact).toHaveBeenCalledTimes(2)
    })

    it('persists the completed batch before settling for pending input', async () => {
      const order: string[] = []
      observeCommitOrder(order)
      const shouldYieldForPendingInput = vi.fn(() => true)
      const coreStream = createToolRoundStream('action')

      const result = await processStream(
        createParams({
          coreStream,
          toolExecution: createToolExecutionPort(createMockToolService({ action: 'ok' })),
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
      expect(tapeToolFactWriter.appendToolFact).toHaveBeenCalledTimes(2)
    })
  })

  describe('truncated tool call recovery', () => {
    it('rejects the local batch in source order and recovers on the next provider round', async () => {
      const providerInputs: ChatMessage[][] = []
      const notifications: DeepChatLoopNotification[] = []
      const coreStream = createScriptedCoreStream(
        [
          [
            {
              type: 'usage',
              usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
            },
            {
              type: 'tool_call_start',
              tool_call_id: 'local-complete',
              tool_call_name: 'read',
              provider_options: { openai: { itemId: 'item-local' } }
            },
            {
              type: 'tool_call_end',
              tool_call_id: 'local-complete',
              tool_call_arguments_complete: '{"path":"README.md"}'
            },
            {
              type: 'tool_call_start',
              tool_call_id: 'provider-pending',
              tool_call_name: 'web_search',
              tool_call_execution_owner: 'provider'
            },
            {
              type: 'tool_call_chunk',
              tool_call_id: 'provider-pending',
              tool_call_arguments_chunk: '{"query":"deepchat"}'
            },
            {
              type: 'tool_call_start',
              tool_call_id: 'local-pending',
              tool_call_name: 'exec',
              provider_options: { openai: { itemId: 'item-pending' } }
            },
            {
              type: 'tool_call_chunk',
              tool_call_id: 'local-pending',
              tool_call_arguments_chunk: '{"command":"pnpm test'
            },
            { type: 'stop', stop_reason: 'max_tokens' }
          ],
          [
            {
              type: 'usage',
              usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }
            },
            { type: 'text', content: 'Recovered safely' },
            { type: 'stop', stop_reason: 'complete' }
          ]
        ],
        providerInputs
      )
      const toolService = createMockToolService()
      ;(toolService.preCheckToolPermission as ReturnType<typeof vi.fn>).mockResolvedValue({
        needsPermission: true,
        permissionType: 'write',
        description: 'Should never be requested'
      })
      const controls = {
        autoGrantPermission: vi.fn(),
        reviewToolPermission: vi.fn(),
        activateSkill: vi.fn().mockResolvedValue([])
      }
      const params = createParams({
        coreStream,
        toolExecution: createToolExecutionPort(toolService),
        tools: [makeTool('read'), makeTool('exec')],
        permissionMode: 'auto_approve',
        controls,
        notificationObserver: {
          isObserved: () => true,
          notify: (notification) => notifications.push(structuredClone(notification))
        }
      })

      const result = await processStream(params)

      expect(result).toMatchObject({
        status: 'completed',
        stopReason: 'complete',
        usage: { inputTokens: 6, outputTokens: 4, totalTokens: 10 }
      })
      expect(coreStream).toHaveBeenCalledTimes(2)
      expect(providerInputs).toHaveLength(2)
      const recoveryAssistant = providerInputs[1].find(
        (message) => message.role === 'assistant' && message.tool_calls?.length
      )
      expect(recoveryAssistant?.tool_calls).toEqual([
        {
          id: 'local-complete',
          type: 'function',
          function: { name: 'read', arguments: '{"path":"README.md"}' },
          provider_options: { openai: { itemId: 'item-local' } }
        },
        {
          id: 'local-pending',
          type: 'function',
          function: { name: 'exec', arguments: '{"command":"pnpm test' },
          provider_options: { openai: { itemId: 'item-pending' } }
        }
      ])
      expect(
        providerInputs[1]
          .filter((message) => message.role === 'tool')
          .map((message) => [message.tool_call_id, message.content])
      ).toEqual([
        ['local-complete', TRUNCATED_TOOL_CALL_ERROR],
        ['local-pending', TRUNCATED_TOOL_CALL_ERROR]
      ])
      const toolBlocks = params.run.streamState.blocks.filter((block) => block.type === 'tool_call')
      expect(toolBlocks).toEqual([
        expect.objectContaining({
          status: 'error',
          extra: expect.objectContaining({ toolCallSkippedReason: 'max_tokens' }),
          tool_call: expect.objectContaining({
            id: 'local-complete',
            response: TRUNCATED_TOOL_CALL_ERROR
          })
        }),
        expect.objectContaining({
          status: 'error',
          extra: expect.objectContaining({ toolCallIncompleteReason: 'max_tokens' }),
          tool_call: expect.objectContaining({ id: 'provider-pending', response: '' })
        }),
        expect.objectContaining({
          status: 'error',
          extra: expect.objectContaining({ toolCallSkippedReason: 'max_tokens' }),
          tool_call: expect.objectContaining({
            id: 'local-pending',
            response: TRUNCATED_TOOL_CALL_ERROR
          })
        })
      ])
      expect(toolService.preCheckToolPermission).not.toHaveBeenCalled()
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(controls.autoGrantPermission).not.toHaveBeenCalled()
      expect(controls.reviewToolPermission).not.toHaveBeenCalled()
      expect(controls.activateSkill).not.toHaveBeenCalled()
      expect(notifications.map((notification) => notification.event)).toEqual([
        'PostToolUseFailure',
        'PostToolUseFailure'
      ])
      expect(
        notifications.map((notification) =>
          notification.event === 'PostToolUseFailure' ? notification.tool.callId : null
        )
      ).toEqual(['local-complete', 'local-pending'])
      expect(params.run.streamState.metadata).toMatchObject({
        providerRounds: 2,
        toolCalls: 0,
        inputTokens: 6,
        outputTokens: 4,
        totalTokens: 10
      })
      expect(params.run.streamState.metadata.noProgressToolLoop).toBeUndefined()
      const tapeFacts = tapeToolFactWriter.appendToolFact.mock.calls.map(([input]) => ({
        source: input.provenance.source,
        sourceId: input.provenance.sourceId
      }))
      for (const callId of ['local-complete', 'local-pending']) {
        expect(tapeFacts).toEqual(
          expect.arrayContaining([
            { source: 'tool_call', sourceId: `m1:${callId}` },
            { source: 'tool_result', sourceId: `m1:${callId}` }
          ])
        )
      }
      expect(tapeFacts).not.toContainEqual({
        source: 'tool_result',
        sourceId: 'm1:provider-pending'
      })
    })

    it('settles a second truncated batch and stops without a third provider request', async () => {
      const providerInputs: ChatMessage[][] = []
      const coreStream = createScriptedCoreStream(
        [
          [
            {
              type: 'tool_call_start',
              tool_call_id: 'tc-first',
              tool_call_name: 'action'
            },
            {
              type: 'tool_call_chunk',
              tool_call_id: 'tc-first',
              tool_call_arguments_chunk: '{"round":1'
            },
            { type: 'stop', stop_reason: 'max_tokens' }
          ],
          [
            {
              type: 'tool_call_start',
              tool_call_id: 'tc-first',
              tool_call_name: 'action'
            },
            {
              type: 'tool_call_chunk',
              tool_call_id: 'tc-first',
              tool_call_arguments_chunk: '{"round":2'
            },
            { type: 'stop', stop_reason: 'max_tokens' }
          ]
        ],
        providerInputs
      )
      const toolService = createMockToolService()
      const params = createParams({
        coreStream,
        toolExecution: createToolExecutionPort(toolService),
        tools: [makeTool('action')]
      })

      const result = await processStream(params)

      expect(result).toMatchObject({ status: 'completed', stopReason: 'max_tokens' })
      expect(coreStream).toHaveBeenCalledTimes(2)
      expect(providerInputs).toHaveLength(2)
      expect(
        providerInputs[1].find((message) => message.role === 'tool' && message.tool_call_id === 'tc-first')
      ).toMatchObject({ content: TRUNCATED_TOOL_CALL_ERROR })
      expect(params.run.messages.filter((message) => message.role === 'tool')).toEqual([
        { role: 'tool', tool_call_id: 'tc-first', content: TRUNCATED_TOOL_CALL_ERROR },
        { role: 'tool', tool_call_id: 'tc-first', content: TRUNCATED_TOOL_CALL_ERROR }
      ])
      expect(
        params.run.streamState.blocks.filter(
          (block) => block.type === 'tool_call' && block.tool_call?.id === 'tc-first'
        )
      ).toEqual([
        expect.objectContaining({
          status: 'error',
          extra: expect.objectContaining({ toolCallSkippedReason: 'max_tokens' }),
          tool_call: expect.objectContaining({ params: '{"round":1' })
        }),
        expect.objectContaining({
          status: 'error',
          extra: expect.objectContaining({ toolCallSkippedReason: 'max_tokens' }),
          tool_call: expect.objectContaining({ params: '{"round":2' })
        })
      ])
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(params.run.streamState.metadata).toMatchObject({ providerRounds: 2, toolCalls: 0 })
      expect(params.run.streamState.metadata.noProgressToolLoop).toBeUndefined()
    })

    it('keeps plain-text max_tokens terminal without starting recovery', async () => {
      const coreStream = createScriptedCoreStream([
        [
          { type: 'text', content: 'Partial answer' },
          { type: 'stop', stop_reason: 'max_tokens' }
        ]
      ])
      const params = createParams({ coreStream })

      const result = await processStream(params)

      expect(result).toMatchObject({ status: 'completed', stopReason: 'max_tokens' })
      expect(coreStream).toHaveBeenCalledTimes(1)
      expect(params.run.messages).toEqual([{ role: 'user', content: 'Hello' }])
      expect(params.run.streamState.metadata).toMatchObject({ providerRounds: 1, toolCalls: 0 })
    })

    it('does not recover or synthesize results for a provider-owned truncated call', async () => {
      const coreStream = createScriptedCoreStream([
        [
          {
            type: 'tool_call_start',
            tool_call_id: 'provider-only',
            tool_call_name: 'web_search',
            tool_call_execution_owner: 'provider'
          },
          {
            type: 'tool_call_chunk',
            tool_call_id: 'provider-only',
            tool_call_arguments_chunk: '{"query":"deepchat"}'
          },
          { type: 'stop', stop_reason: 'max_tokens' }
        ]
      ])
      const toolService = createMockToolService()
      const params = createParams({
        coreStream,
        toolExecution: createToolExecutionPort(toolService),
        tools: [makeTool('web_search')]
      })

      const result = await processStream(params)

      expect(result).toMatchObject({ status: 'completed', stopReason: 'max_tokens' })
      expect(coreStream).toHaveBeenCalledTimes(1)
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(params.run.messages).toEqual([{ role: 'user', content: 'Hello' }])
      expect(params.run.streamState.blocks[0]).toMatchObject({
        status: 'error',
        extra: { toolCallIncompleteReason: 'max_tokens' },
        tool_call: { id: 'provider-only', response: '' }
      })
      expect(params.run.streamState.pendingToolCalls.size).toBe(0)
    })

    it('does not synthesize results for structurally unclosable calls', async () => {
      const coreStream = createScriptedCoreStream([
        [
          { type: 'tool_call_start', tool_call_id: ' ', tool_call_name: 'action' },
          { type: 'tool_call_start', tool_call_id: 'duplicate', tool_call_name: 'action' },
          { type: 'tool_call_start', tool_call_id: 'duplicate', tool_call_name: 'action' },
          { type: 'stop', stop_reason: 'max_tokens' }
        ]
      ])
      const params = createParams({ coreStream, tools: [makeTool('action')] })

      const result = await processStream(params)

      expect(result).toMatchObject({ status: 'completed', stopReason: 'max_tokens' })
      expect(coreStream).toHaveBeenCalledTimes(1)
      expect(params.run.messages).toEqual([{ role: 'user', content: 'Hello' }])
      expect(params.run.streamState.pendingToolCalls.size).toBe(0)
      expect(params.run.streamState.blocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 'error',
            extra: { toolCallIncompleteReason: 'max_tokens' }
          })
        ])
      )
      expect(
        params.run.streamState.blocks.filter(
          (block) => block.type === 'tool_call' && block.extra?.toolCallIncompleteReason === 'max_tokens'
        )
      ).toHaveLength(3)
    })

    it('settles the rejection before yielding to pending input', async () => {
      const coreStream = createScriptedCoreStream([
        [
          { type: 'tool_call_start', tool_call_id: 'tc1', tool_call_name: 'action' },
          {
            type: 'tool_call_end',
            tool_call_id: 'tc1',
            tool_call_arguments_complete: '{}'
          },
          { type: 'stop', stop_reason: 'max_tokens' }
        ],
        [{ type: 'stop', stop_reason: 'complete' }]
      ])
      const shouldYieldForPendingInput = vi.fn(() => true)
      const toolService = createMockToolService()
      const params = createParams({
        coreStream,
        toolExecution: createToolExecutionPort(toolService),
        tools: [makeTool('action')],
        shouldYieldForPendingInput
      })

      const result = await processStream(params)

      expect(result).toMatchObject({ status: 'completed', stopReason: 'pending_input' })
      expect(coreStream).toHaveBeenCalledTimes(1)
      expect(shouldYieldForPendingInput).toHaveBeenCalledTimes(1)
      expect(params.run.messages.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'tc1',
        content: TRUNCATED_TOOL_CALL_ERROR
      })
      expect(tapeToolFactWriter.appendToolFact).toHaveBeenCalledTimes(2)
    })

    it('settles the rejection before honoring a post-stream abort', async () => {
      const abortController = new AbortController()
      const coreStream = createScriptedCoreStream(
        [
          [
            { type: 'tool_call_start', tool_call_id: 'tc1', tool_call_name: 'action' },
            {
              type: 'tool_call_chunk',
              tool_call_id: 'tc1',
              tool_call_arguments_chunk: '{"value":'
            },
            { type: 'stop', stop_reason: 'max_tokens' }
          ]
        ],
        [],
        () => abortController.abort()
      )
      const toolService = createMockToolService()
      const params = createParams({
        coreStream,
        toolExecution: createToolExecutionPort(toolService),
        tools: [makeTool('action')],
        abortController
      })

      const result = await processStream(params)

      expect(result).toMatchObject({ status: 'aborted', stopReason: 'user_stop' })
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(params.run.messages.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'tc1',
        content: TRUNCATED_TOOL_CALL_ERROR
      })
      expect(tapeToolFactWriter.appendToolFact).toHaveBeenCalledTimes(2)
      expect(messageStore.setMessageError).toHaveBeenCalled()
    })

    it('settles the rejection before a provider-round cap prevents recovery', async () => {
      const coreStream = createScriptedCoreStream([
        [
          { type: 'tool_call_start', tool_call_id: 'tc1', tool_call_name: 'action' },
          {
            type: 'tool_call_end',
            tool_call_id: 'tc1',
            tool_call_arguments_complete: '{}'
          },
          { type: 'stop', stop_reason: 'max_tokens' }
        ]
      ])
      const params = createParams({
        coreStream,
        tools: [makeTool('action')],
        maxProviderRounds: 1
      })

      const result = await processStream(params)

      expect(result).toMatchObject({ status: 'error', stopReason: 'max_turns' })
      expect(coreStream).toHaveBeenCalledTimes(1)
      expect(params.run.messages.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'tc1',
        content: TRUNCATED_TOOL_CALL_ERROR
      })
      expect(tapeToolFactWriter.appendToolFact).toHaveBeenCalledTimes(2)
    })

    it('stops on a terminal fitting failure without requesting recovery', async () => {
      const coreStream = createScriptedCoreStream([
        [
          { type: 'tool_call_start', tool_call_id: 'tc1', tool_call_name: 'read' },
          {
            type: 'tool_call_chunk',
            tool_call_id: 'tc1',
            tool_call_arguments_chunk: '{"path":"'
          },
          { type: 'stop', stop_reason: 'max_tokens' }
        ]
      ])
      const toolService = createMockToolService()
      const params = createParams({
        coreStream,
        toolExecution: createToolExecutionPort(toolService),
        tools: [makeTool('read')],
        modelConfig: { contextLength: 1 } as any,
        maxTokens: 1
      })

      const result = await processStream(params)

      expect(result).toMatchObject({ status: 'error', stopReason: 'tool_error' })
      expect(result.terminalError).toContain('remaining context window is too small')
      expect(coreStream).toHaveBeenCalledTimes(1)
      expect(toolService.callTool).not.toHaveBeenCalled()
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
          commandSignature: 'cmd:dir',
          shellProfile: 'cmd',
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
        commandSignature: 'cmd:dir',
        shellProfile: 'cmd',
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

  it('records a provider AbortError as an error while the abort signal remains inactive', async () => {
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    const coreStream = vi.fn(async function* () {
      yield {
        type: 'usage',
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
          cached_tokens: 3,
          cache_write_tokens: 2
        }
      } as LLMCoreStreamEvent
      throw abortError
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({ coreStream })
    const promise = processStream(params)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toMatchObject({
      status: 'error',
      stopReason: 'provider_error',
      errorMessage: 'Aborted'
    })
    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      cachedInputTokens: 3,
      cacheWriteInputTokens: 2
    })
    expect(messageStore.setMessageError).toHaveBeenCalledOnce()
    const metadata = JSON.parse(messageStore.setMessageError.mock.calls.at(-1)?.[2])
    expect(metadata).toMatchObject({
      runOutcome: 'error',
      runStopReason: 'provider_error',
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      cachedInputTokens: 3,
      cacheWriteInputTokens: 2,
      providerRounds: 1,
      toolCalls: 0
    })
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
    expectDeepchatEvent('chat.stream.failed', {
      requestId: RUN_ID,
      sessionId: 's1',
      messageId: 'm1',
      error: 'Aborted'
    })
    expect(commitRunTerminal).toHaveBeenCalledWith({
      outcome: 'error',
      stopReason: 'provider_error',
      errorMessage: 'Aborted'
    })
  })

  it('accounts for usage delivered while the run cancellation is settling', async () => {
    const abortController = new AbortController()
    const usageEvent = {
      type: 'usage',
      usage: {
        prompt_tokens: 13,
        completion_tokens: 2,
        total_tokens: 15,
        cached_tokens: 5
      }
    } as const
    const coreStream = vi.fn(async function* () {
      abortController.abort()
      yield usageEvent
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(createParams({ abortController, coreStream }))

    expect(result).toMatchObject({
      status: 'aborted',
      usage: {
        inputTokens: 13,
        outputTokens: 2,
        totalTokens: 15,
        cachedInputTokens: 5
      }
    })
    const metadata = JSON.parse(messageStore.setMessageError.mock.calls.at(-1)?.[2])
    expect(metadata).toMatchObject({
      inputTokens: 13,
      outputTokens: 2,
      totalTokens: 15,
      cachedInputTokens: 5,
      runOutcome: 'aborted'
    })
  })

  it('accounts for a tool that started before result normalization was aborted', async () => {
    const abortController = new AbortController()
    const coreStream = vi.fn(async function* () {
      yield {
        type: 'tool_call_start',
        tool_call_id: 'tc-aborted',
        tool_call_name: 'action'
      } as LLMCoreStreamEvent
      yield {
        type: 'tool_call_end',
        tool_call_id: 'tc-aborted',
        tool_call_arguments_complete: '{}'
      } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']
    const toolService = createMockToolService({ action: 'raw result' })
    const toolResults = createToolResultPort({
      outputGuard: new ToolOutputGuard(),
      normalize: async () => {
        abortController.abort()
        return 'normalized result'
      }
    })

    const result = await processStream(
      createParams({
        abortController,
        coreStream,
        toolExecution: createToolExecutionPort(toolService),
        toolResults,
        tools: [makeTool('action')]
      })
    )

    expect(result).toMatchObject({ status: 'aborted', stopReason: 'user_stop' })
    expect(toolService.callTool).toHaveBeenCalledOnce()
    expect(JSON.parse(messageStore.setMessageError.mock.calls.at(-1)?.[2])).toMatchObject({
      providerRounds: 1,
      toolCalls: 1,
      runOutcome: 'aborted',
      runStopReason: 'user_stop'
    })
  })

  it('accumulates resumed accounting across provider and tool rounds', async () => {
    let callCount = 0
    const coreStream = vi.fn(function () {
      callCount++
      if (callCount === 1) {
        return (async function* () {
          yield {
            type: 'usage',
            usage: {
              prompt_tokens: 2,
              completion_tokens: 3,
              total_tokens: 5,
              cached_tokens: 1,
              cache_write_tokens: 2
            }
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_start',
            tool_call_id: 'tc-resumed',
            tool_call_name: 'action'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'tc-resumed',
            tool_call_arguments_complete: '{}'
          } as LLMCoreStreamEvent
          yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
        })()
      }

      return (async function* () {
        yield {
          type: 'usage',
          usage: {
            prompt_tokens: 4,
            completion_tokens: 5,
            total_tokens: 9,
            cached_tokens: 2,
            cache_write_tokens: 3
          }
        } as LLMCoreStreamEvent
        yield { type: 'text', content: 'Done' } as LLMCoreStreamEvent
        yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
      })()
    }) as unknown as ProcessParams['coreStream']
    const toolService = createMockToolService({ action: 'ok' })

    const result = await processStream(
      createParams({
        coreStream,
        toolExecution: createToolExecutionPort(toolService),
        tools: [makeTool('action')],
        initialAccounting: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          cachedInputTokens: 3,
          cacheWriteInputTokens: 4,
          providerRounds: 2,
          toolCalls: 3,
          generationTime: 1000,
          firstTokenTime: 100
        }
      })
    )

    expect(result).toMatchObject({
      status: 'completed',
      usage: {
        inputTokens: 16,
        outputTokens: 28,
        totalTokens: 44,
        cachedInputTokens: 6,
        cacheWriteInputTokens: 9
      }
    })
    expect(toolService.callTool).toHaveBeenCalledOnce()
    const metadata = JSON.parse(messageStore.finalizeAssistantMessage.mock.calls.at(-1)?.[2])
    expect(metadata).toMatchObject({
      inputTokens: 16,
      outputTokens: 28,
      totalTokens: 44,
      cachedInputTokens: 6,
      cacheWriteInputTokens: 9,
      providerRounds: 4,
      toolCalls: 4,
      generationTime: 1000,
      firstTokenTime: 100,
      tokensPerSecond: 28,
      runOutcome: 'completed',
      runStopReason: 'complete'
    })
  })

  it('counts one logical round regardless of internal provider attempt handling', async () => {
    const internalProviderWork = vi.fn()
    const coreStream = vi.fn(async function* () {
      internalProviderWork()
      internalProviderWork()
      yield { type: 'text', content: 'done' } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(
      createParams({
        coreStream,
        maxProviderRounds: 1
      })
    )

    expect(result).toMatchObject({
      status: 'completed',
      stopReason: 'complete'
    })
    expect(coreStream).toHaveBeenCalledOnce()
    expect(internalProviderWork).toHaveBeenCalledTimes(2)
    const metadata = JSON.parse(messageStore.finalizeAssistantMessage.mock.calls.at(-1)?.[2])
    expect(metadata).toMatchObject({
      providerRounds: 1,
      toolCalls: 0,
      runOutcome: 'completed',
      runStopReason: 'complete'
    })
  })

  it('does not enter coreStream when resumed provider accounting already reached the cap', async () => {
    const coreStream = vi.fn(async function* () {
      yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(
      createParams({
        coreStream,
        initialAccounting: { providerRounds: 1, toolCalls: 0 },
        maxProviderRounds: 1
      })
    )

    expect(result).toMatchObject({
      status: 'error',
      stopReason: 'max_turns',
      errorMessage: 'Maximum agent turns exceeded (1).'
    })
    expect(coreStream).not.toHaveBeenCalled()
    expect(JSON.parse(messageStore.setMessageError.mock.calls.at(-1)?.[2])).toMatchObject({
      providerRounds: 1,
      toolCalls: 0,
      runOutcome: 'error',
      runStopReason: 'max_turns'
    })
  })

  it('restores the persisted provider-round cap after an interaction pause', async () => {
    const pauseCoreStream = vi.fn(async function* () {
      yield {
        type: 'tool_call_start',
        tool_call_id: 'question-provider-cap',
        tool_call_name: 'deepchat_question'
      } as LLMCoreStreamEvent
      yield {
        type: 'tool_call_end',
        tool_call_id: 'question-provider-cap',
        tool_call_arguments_complete: JSON.stringify({
          question: 'Continue?',
          options: [{ label: 'Yes' }, { label: 'No' }]
        })
      } as LLMCoreStreamEvent
      yield { type: 'stop', stop_reason: 'tool_use' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const pausedResult = await processStream(
      createParams({
        coreStream: pauseCoreStream,
        tools: [makeTool('deepchat_question')],
        maxProviderRounds: 1
      })
    )

    expect(pausedResult).toMatchObject({ status: 'paused' })
    const finalPauseCall = messageStore.updateAssistantContent.mock.calls.findLast(
      (call) => typeof call[2] === 'string'
    )
    expect(finalPauseCall).toBeDefined()
    const pausedMetadata = JSON.parse(finalPauseCall?.[2])
    expect(pausedMetadata).toMatchObject({
      maxProviderRounds: 1,
      providerRounds: 1,
      runOutcome: 'paused',
      runStopReason: 'interaction'
    })

    const resumedCoreStream = vi.fn(async function* () {
      yield { type: 'stop', stop_reason: 'complete' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']
    const resumedResult = await processStream(
      createParams({
        coreStream: resumedCoreStream,
        initialAccounting: pausedMetadata
      })
    )

    expect(resumedResult).toMatchObject({
      status: 'error',
      stopReason: 'max_turns',
      errorMessage: 'Maximum agent turns exceeded (1).'
    })
    expect(resumedCoreStream).not.toHaveBeenCalled()
    expect(JSON.parse(messageStore.setMessageError.mock.calls.at(-1)?.[2])).toMatchObject({
      maxProviderRounds: 1,
      providerRounds: 1,
      runOutcome: 'error',
      runStopReason: 'max_turns'
    })
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

    const toolService = createMockToolService({ get_weather: 'Sunny, 72F' })
    const params = createParams({
      coreStream,
      toolExecution: createToolExecutionPort(toolService),
      tools: [makeTool('get_weather')],
      onConversationMessagesChange: (messages) => {
        liveMessages = messages
      }
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(coreStream).toHaveBeenCalledTimes(2)
    expect(params.run.logicalRound).toBe(2)
    expect(toolService.callTool).toHaveBeenCalledTimes(1)
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
    const toolService = createMockToolService({ get_weather: 'Sunny, 72F' })
    const params = createParams({
      coreStream: createToolThenCompleteStream('get_weather'),
      toolExecution: createToolExecutionPort(toolService),
      tools: [makeTool('get_weather')],
      notificationObserver: {
        isObserved: () => true,
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
    const toolService = createMockToolService({ get_weather: 'Sunny, 72F' })

    try {
      const result = await processStream(
        createParams({
          coreStream: createToolThenCompleteStream('get_weather'),
          toolExecution: createToolExecutionPort(toolService),
          tools: [makeTool('get_weather')],
          notificationObserver: {
            isObserved: () => true,
            notify: () => {
              throw new Error('observer failed')
            }
          }
        })
      )

      expect(result.status).toBe('completed')
      expect(toolService.callTool).toHaveBeenCalledTimes(1)
      expect(warning).toHaveBeenCalledTimes(2)
    } finally {
      warning.mockRestore()
    }
  })

  it('assembles no notification for an unobserved event', async () => {
    const notify = vi.fn()
    const isObserved = vi.fn((event: DeepChatLoopNotification['event']) => event !== 'PreToolUse')
    const toolService = createMockToolService({ get_weather: 'Sunny, 72F' })

    const result = await processStream(
      createParams({
        coreStream: createToolThenCompleteStream('get_weather'),
        toolExecution: createToolExecutionPort(toolService),
        tools: [makeTool('get_weather')],
        notificationObserver: { isObserved, notify }
      })
    )

    expect(result.status).toBe('completed')
    expect(isObserved.mock.calls.map(([event]) => event)).toEqual(['PreToolUse', 'PostToolUse'])
    expect(notify.mock.calls.map(([notification]) => notification.event)).toEqual(['PostToolUse'])
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
    const toolService = createMockToolService({ get_weather: 'Sunny' })
    ;(toolService.callTool as ReturnType<typeof vi.fn>).mockImplementation(async (request) => {
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
      toolExecution: createToolExecutionPort(toolService),
      tools: [makeTool('get_weather')],
      onFirstProviderRoundReady
    })

    await processStream(params)

    expect(onFirstProviderRoundReady).toHaveBeenCalledTimes(1)
    expect(order.indexOf('flush')).toBeLessThan(order.indexOf('ready'))
    expect(order.indexOf('ready')).toBeLessThan(order.indexOf('tool'))
    expect(coreStream).toHaveBeenCalledTimes(2)
    expect(toolService.callTool).toHaveBeenCalledTimes(1)
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
    const toolService = createMockToolService({ get_weather: 'Sunny, 72F' })
    const params = createParams({
      coreStream,
      toolExecution: createToolExecutionPort(toolService),
      tools: [makeTool('get_weather')],
      shouldYieldForPendingInput
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(coreStream).toHaveBeenCalledTimes(1)
    expect(toolService.callTool).toHaveBeenCalledTimes(1)
    expect(shouldYieldForPendingInput).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      status: 'completed',
      stopReason: 'pending_input'
    })

    const finalizedBlocks = (messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][1]
    expect(finalizedBlocks[0].tool_call.response).toBe('Sunny, 72F')
  })

  it('refreshes tools without replacing the system prompt after skill_view activates a skill', async () => {
    let callCount = 0
    const skillResolution = makeRuntimeSkillResolution()
    const toolService = {
      ...createMockToolService(),
      callTool: vi
        .fn()
        .mockImplementationOnce(async (request, options) => {
          options?.commitDispatch?.({
            toolName: request.function.name,
            toolSource: 'agent',
            normalizedArguments: { name: 'deepchat-settings' },
            target: { serverName: 'agent-skills', originalName: 'skill_view' }
          })
          return {
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
                activatedSkill: 'deepchat-settings',
                skillContext: {
                  agentId: 'deepchat',
                  sourceType: 'created',
                  sourceId: '/skills/deepchat-settings',
                  skillName: 'deepchat-settings'
                },
                skillResolution
              }
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
    } as unknown as ToolServicePort
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
    const commitRuntimeSkillView = vi.fn().mockResolvedValue(undefined)

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
          expect(messages[0]).toEqual({ role: 'user', content: 'Hello' })
          expect(messages).toContainEqual(
            expect.objectContaining({
              role: 'tool',
              tool_call_id: 'tc1',
              content: expect.stringContaining('deepchat-settings')
            })
          )
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
      toolExecution: createToolExecutionPort(toolService),
      toolCatalog: { resolve: resolveTools },
      tools: [makeTool('skill_view')],
      controls: {
        activateSkill,
        getActiveSkillNames,
        commitRuntimeSkillView
      }
    })
    const initialPromptAssembly = params.run.resources.promptAssembly

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(activateSkill).toHaveBeenCalledWith('deepchat-settings')
    expect(getActiveSkillNames).toHaveBeenCalled()
    expect(resolveTools).toHaveBeenCalledTimes(1)
    expect(resolveTools).toHaveBeenCalledWith({
      activeSkillNames: ['deepchat-settings'],
      failClosed: true
    })
    expect(commitRuntimeSkillView).toHaveBeenCalledBefore(activateSkill)
    expect(coreStream).toHaveBeenCalledTimes(3)
    expect(toolService.callTool).toHaveBeenCalledTimes(2)
    expect(params.run.resources.promptAssembly).toBe(initialPromptAssembly)
  })

  it('does not start another provider request when post-activation tool refresh fails', async () => {
    const skillResolution = makeRuntimeSkillResolution()
    const responseText = JSON.stringify({
      success: true,
      name: 'deepchat-settings',
      content: '# Effective Skill body',
      activatedForMessage: true,
      activationScope: 'message',
      activationEvidenceVersion: 1
    })
    const toolService = {
      ...createMockToolService(),
      callTool: vi.fn().mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: { name: 'deepchat-settings' },
          target: { serverName: 'agent-skills', originalName: 'skill_view' }
        })
        return {
          content: responseText,
          rawData: {
            toolCallId: request.id,
            content: responseText,
            isError: false,
            toolResult: {
              activationApplied: true,
              activationSource: 'skill_md',
              activatedSkill: 'deepchat-settings',
              skillContext: {
                agentId: 'deepchat',
                sourceType: 'created',
                sourceId: '/skills/deepchat-settings',
                skillName: 'deepchat-settings'
              },
              skillResolution
            }
          }
        }
      })
    } as unknown as ToolServicePort
    const activeSkillNames: string[] = []
    const activateSkill = vi.fn(async (skillName: string) => {
      activeSkillNames.push(skillName)
      return [...activeSkillNames]
    })
    const coreStream = vi.fn(function () {
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
    }) as unknown as ProcessParams['coreStream']
    const resolveTools = vi.fn().mockRejectedValue(new Error('catalog unavailable'))
    const params = createParams({
      coreStream,
      toolExecution: createToolExecutionPort(toolService),
      toolCatalog: { resolve: resolveTools },
      tools: [makeTool('skill_view')],
      shouldYieldForPendingInput: () => true,
      controls: {
        activateSkill,
        getActiveSkillNames: () => [...activeSkillNames],
        commitRuntimeSkillView: vi.fn().mockResolvedValue(undefined)
      }
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toMatchObject({
      status: 'error',
      stopReason: 'provider_error',
      errorMessage: 'catalog unavailable'
    })

    expect(activateSkill).toHaveBeenCalledOnce()
    expect(resolveTools).toHaveBeenCalledWith({
      activeSkillNames: ['deepchat-settings'],
      failClosed: true
    })
    expect(coreStream).toHaveBeenCalledOnce()
  })

  it('does not refresh tools after linked-file skill_view reads', async () => {
    let callCount = 0
    const toolService = {
      ...createMockToolService(),
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
    } as unknown as ToolServicePort
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
      toolExecution: createToolExecutionPort(toolService),
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

    const toolService = createMockToolService({ cdp_send: longScreenshot })
    const params = createParams({
      coreStream,
      toolExecution: createToolExecutionPort(toolService),
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

  it('preserves completed-call order for multiple tools in one turn', async () => {
    let callCount = 0
    const toolService = createMockToolService({
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
            type: 'tool_call_start',
            tool_call_id: 'tc2',
            tool_call_name: 'get_time'
          } as LLMCoreStreamEvent
          yield {
            type: 'tool_call_end',
            tool_call_id: 'tc2',
            tool_call_arguments_complete: '{}'
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
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({
      coreStream,
      toolExecution: createToolExecutionPort(toolService),
      tools: [makeTool('get_weather'), makeTool('get_time')]
    })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    await promise

    expect(toolService.callTool).toHaveBeenCalledTimes(2)
    expect(
      (toolService.callTool as ReturnType<typeof vi.fn>).mock.calls.map(
        ([request]) => request.function.name
      )
    ).toEqual(['get_time', 'get_weather'])
    expect(coreStream).toHaveBeenCalledTimes(2)
  })

  it('continues the next provider turn after downgrading an overflow tail tool result', async () => {
    let callCount = 0
    const toolService = createMockToolService()

    ;(toolService.callTool as ReturnType<typeof vi.fn>)
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
      toolExecution: createToolExecutionPort(toolService),
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

  it('passes reasoning_content back after each interleaved tool-call loop', async () => {
    let callCount = 0
    const toolService = createMockToolService({ get_weather: 'Sunny' })

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
      toolExecution: createToolExecutionPort(toolService),
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
      requestId: RUN_ID
    })
  })

  it('publishes a terminal plan event when the max tool calls limit stops the loop', async () => {
    const finalWrites: any[] = []
    messageStore.finalizeAssistantMessage.mockImplementation((_messageId, blocks) => {
      finalWrites.push(structuredClone(blocks))
    })
    let callCount = 0
    const toolService = createMockToolService({ action: 'done' })

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
      toolExecution: createToolExecutionPort(toolService),
      tools: [makeTool('action')],
      initialAccounting: { providerRounds: 0, toolCalls: 128 }
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
    const abortController = new AbortController()
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    const coreStream = vi.fn(async function* () {
      yield {
        type: 'plan',
        plan: [{ step: 'Current work', status: 'in_progress' }],
        revision: 1,
        updatedAt: '2026-05-18T00:00:00.000Z'
      } as LLMCoreStreamEvent
      abortController.abort(abortError)
      throw abortError
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(createParams({ coreStream, abortController }))

    expect(result).toMatchObject({
      status: 'aborted',
      stopReason: 'user_stop',
      errorMessage: 'common.error.userCanceledGeneration'
    })
    expect(messageStore.updateAssistantContent).not.toHaveBeenCalled()
    expect(messageStore.setMessageError).toHaveBeenCalledWith(
      'm1',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          content: 'common.error.userCanceledGeneration',
          status: 'error'
        })
      ]),
      expect.any(String)
    )
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
    expect(JSON.parse(messageStore.setMessageError.mock.calls.at(-1)?.[2])).toMatchObject({
      runOutcome: 'aborted',
      runStopReason: 'user_stop',
      providerRounds: 1,
      toolCalls: 0
    })
    expectDeepchatEvent('chat.plan.updated', {
      sessionId: 's1',
      messageId: 'm1',
      terminalReason: 'aborted'
    })
  })

  it('persists finalized narrative blocks when AbortError is thrown after text and plan events', async () => {
    const abortController = new AbortController()
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
      abortController.abort(abortError)
      throw abortError
    }) as unknown as ProcessParams['coreStream']

    const result = await processStream(createParams({ coreStream, abortController }))

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
          content: 'common.error.userCanceledGeneration',
          status: 'error'
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

  it('stream error event → finalizeError', async () => {
    const coreStream = vi.fn(function* () {
      yield { type: 'text', content: 'Partial' } as LLMCoreStreamEvent
      yield { type: 'error', error_message: 'Rate limit exceeded' } as LLMCoreStreamEvent
    }) as unknown as ProcessParams['coreStream']

    const params = createParams({ coreStream })

    const promise = processStream(params)
    await vi.runAllTimersAsync()
    const result = await promise

    // Generic provider error events finalize as errors (not success-shaped complete).
    expect(result).toMatchObject({
      status: 'error',
      stopReason: 'provider_error',
      errorMessage: 'Rate limit exceeded'
    })
    expect(messageStore.setMessageError).toHaveBeenCalled()
    expect(messageStore.finalizeAssistantMessage).not.toHaveBeenCalled()
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
})
