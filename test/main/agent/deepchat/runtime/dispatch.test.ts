import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type {
  InterleavedReasoningConfig,
  IoParams,
  PendingToolInteraction,
  ProcessControlCollaborators,
  ProcessInternalDiagnostics,
  StreamState
} from '@/agent/deepchat/runtime/types'
import { createState } from '@/agent/deepchat/runtime/types'
import {
  estimateMessagesTokens,
  estimateToolDefinitionTokens
} from '@/agent/deepchat/runtime/contextBuilder'
import {
  TOOL_EXECUTION,
  type MCPToolDefinition,
  type ToolExecutionContract
} from '@shared/types/mcp'
import type { ToolServicePort } from '@shared/types/tool'
import type { AssistantMessageBlock, PermissionMode } from '@shared/types/agent-interface'
import type { ChatMessageProviderReplayProjector } from '@shared/types/core/chat-message'
import { ToolOutputGuard } from '@/agent/deepchat/runtime/toolOutputGuard'
import {
  createToolExecutionPort,
  createToolResultPort
} from '@/agent/deepchat/runtime/toolAdapters'
import type {
  DeepChatLoopToolNotification,
  ToolExecutionOptions,
  ToolExecutionPreCheckOptions,
  ToolResultPort
} from '@/agent/deepchat/loop/ports'
import type { LoopRunRequestToolSurfaceBinding } from '@/agent/deepchat/loop/loopRun'
import { QUESTION_TOOL_NAME } from '@/tool/agentTools/questionTool'
import {
  IMAGE_GENERATE_TOOL_NAME,
  IMAGE_GENERATION_TOOL_SERVER_NAME
} from '@shared/agentImageGenerationTool'
import { resolveToolOffloadPath } from '@/agent/shared/storage/sessionPaths'
import { createDeepSeekResponsesReplayProjector } from '@/provider/deepseekResponsesAdapter'
import type {
  ExecutionJournalWriter,
  NestedExecutionJournalWriter
} from '@/tape/ports/capabilities'
import { ExecutionJournalError } from '@/tape/domain/executionJournal'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'
import {
  TOOL_SEARCH_AGENT_TOOL_NAME,
  TOOL_SEARCH_AGENT_TOOL_SERVER_NAME
} from '@shared/agentTools'
import {
  MAX_TOOL_SURFACE_SEARCH_CALLS_PER_BATCH,
  assertIssuedToolSurfaceExecutionContext,
  assertToolSurfaceAllowsDispatch,
  buildCanonicalToolCatalog,
  buildToolSurfaceDeferredDispatchBinding,
  createPolicySelectedToolSurfaceRun,
  type ToolSurfaceShadowPolicy
} from '@/agent/deepchat/runtime/toolSurface'
import {
  buildProgrammaticToolCapabilityV1,
  createProgrammaticToolSurfaceRunControllerV1,
  markProgrammaticToolCapabilityProvenanceCommitted
} from '@/agent/deepchat/runtime/programmaticToolSurface'
import {
  bindToolSurfaceCanaryRunEvidence,
  createToolSurfaceCanaryRunEvidenceRecorder
} from '@/agent/deepchat/runtime/toolSurfaceCanaryDiagnostics'
import type {
  ProgrammaticToolParentRegistration,
  ProgrammaticToolParentRegistry
} from '@/cli/programmaticToolParentRegistry'
import type { ArmedAgentCliProgrammaticToken } from '@/cli/agentTokenAuthority'
import { ProgrammaticCommandLaunchError } from '@/tool/agentTools/agentBashHandler'
import { prepareProgrammaticExecParent } from '@/agent/deepchat/runtime/programmaticExecParent'
import { CODE_MODE_TOOL_SERVER_NAME } from '@shared/codeModeProtocol'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())
const PROGRAMMATIC_EXEC_ARGUMENTS = JSON.stringify({
  command: 'deepchat tool call',
  stdin: JSON.stringify({ target: 'remote_search', arguments: {} })
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

vi.mock('@/events', () => ({
  STREAM_EVENTS: {
    RESPONSE: 'stream:response',
    END: 'stream:end',
    ERROR: 'stream:error'
  }
}))

import {
  finalize,
  finalizeError,
  finalizePaused,
  persistAbortExceptionPlanState,
  settleToolBatch as settleToolBatchInternal,
  TRUNCATED_TOOL_CALL_ERROR,
  type ToolBatchDisposition
} from '@/agent/deepchat/runtime/dispatch'
import type { EchoHandle } from '@/agent/deepchat/runtime/echo'
import { accumulate } from '@/agent/deepchat/runtime/accumulator'

function createIo(overrides?: Partial<IoParams>): IoParams {
  return {
    sessionId: 's1',
    requestId: 'req-1',
    messageId: 'm1',
    providerId: 'acp',
    modelId: 'dimcode',
    messageStore: {
      addSearchResult: vi.fn(),
      updateAssistantContent: vi.fn(),
      finalizeAssistantMessage: vi.fn(),
      setMessageError: vi.fn()
    } as any,
    abortSignal: new AbortController().signal,
    publishEvent: publishDeepchatEventMock,
    publishSessionUpdate: vi.fn(),
    ...overrides
  }
}

function makeTool(
  name: string,
  execution: ToolExecutionContract = TOOL_EXECUTION.write
): MCPToolDefinition {
  return {
    execution,
    type: 'function',
    function: {
      name,
      description: `Tool ${name}`,
      parameters: { type: 'object', properties: {} }
    },
    server: { name: 'test-server', icons: 'icon', description: 'Test server' }
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

function makeRuntimeSkillToolResult(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    activationApplied: true,
    activationSource: 'skill_md',
    activatedSkill: 'deepchat-settings',
    skillContext: {
      agentId: 'deepchat',
      sourceType: 'created',
      sourceId: '/skills/deepchat-settings',
      skillName: 'deepchat-settings'
    },
    skillResolution: makeRuntimeSkillResolution(),
    ...overrides
  }
}

function makeAgentTool(
  name: string,
  execution: ToolExecutionContract = TOOL_EXECUTION.write
): MCPToolDefinition {
  return {
    ...makeTool(name, execution),
    source: 'agent',
    ...(name === 'skill_view'
      ? {
          server: {
            name: 'agent-skills',
            icons: '',
            description: 'Agent Skills management'
          }
        }
      : name === TOOL_SEARCH_AGENT_TOOL_NAME
      ? {
          server: {
            name: TOOL_SEARCH_AGENT_TOOL_SERVER_NAME,
            icons: '',
            description: 'Tool Surface discovery'
          }
        }
      : {})
  }
}

function makeAgentImageGenerationTool(): MCPToolDefinition {
  return {
    ...makeAgentTool(IMAGE_GENERATE_TOOL_NAME),
    server: {
      name: IMAGE_GENERATION_TOOL_SERVER_NAME,
      icons: 'icon',
      description: 'Agent image generation tools'
    }
  }
}

function createDispatchToolSurfaceBinding(
  definitions: readonly MCPToolDefinition[],
  coreToolNames = definitions.map((definition) => definition.function.name)
): {
  readonly tools: MCPToolDefinition[]
  readonly binding: LoopRunRequestToolSurfaceBinding
  readonly catalog: ReturnType<typeof buildCanonicalToolCatalog>
} {
  const toolSearchDefinition = makeAgentTool(
    TOOL_SEARCH_AGENT_TOOL_NAME,
    TOOL_EXECUTION.read.parallel
  )
  const catalog = buildCanonicalToolCatalog(definitions)
  const policy: ToolSurfaceShadowPolicy = {
    policyVersion: 'dispatch-test-v1',
    enterToolCount: 1,
    exitToolCount: 0,
    enterEstimatedInputTokens: 1,
    exitEstimatedInputTokens: 0,
    maxInitialToolCount: definitions.length + 1,
    maxInitialDefinitionTokens: 100_000,
    activationReserveToolCount: 0,
    activationReserveDefinitionTokens: 0,
    maxActivationCandidatesPerBatch: 8,
    maxActivationCandidateDefinitionTokensPerBatch: 10_000,
    maxActivationBatchesPerRun: 4,
    maxAppendedTargetsPerRun: 8,
    toolSearchDefinitionTokens: buildCanonicalToolCatalog([toolSearchDefinition]).definitionTokens,
    toolSearchPromptTokens: 0
  }
  const selected = createPolicySelectedToolSurfaceRun({
    ceilingDefinitions: definitions,
    initialEligibleDefinitions: definitions,
    toolSearchDefinition,
    policy,
    coreStableTargetKeys: catalog.entries
      .filter((entry) => coreToolNames.includes(entry.target.providerVisibleName))
      .map((entry) => entry.stableTargetKey)
  })
  const snapshot = selected.controller.build({
    request: {
      sessionId: 's1',
      messageId: 'm1',
      runId: '11111111-1111-4111-8111-111111111111',
      requestSeq: 1
    },
    eligibleDefinitions: definitions,
    toolSearchAvailable: true
  })
  selected.controller.admit(snapshot)
  const releaseActivationCandidates = vi.fn(selected.controller.stageActivationBatch)
  return {
    tools: snapshot.toolDefinitions as MCPToolDefinition[],
    catalog,
    binding: Object.freeze({
      requestSeq: 1,
      snapshot,
      releaseActivationCandidates
    })
  }
}

function createDispatchProgrammaticToolSurfaceBinding(): {
  readonly tools: MCPToolDefinition[]
  readonly binding: LoopRunRequestToolSurfaceBinding
  readonly capability: ReturnType<typeof buildProgrammaticToolCapabilityV1>
} {
  const exec = {
    ...makeAgentTool('exec'),
    server: {
      name: 'agent-filesystem',
      icons: '',
      description: 'Agent FileSystem tools'
    }
  }
  const remote = {
    ...makeTool('remote_search', TOOL_EXECUTION.read.parallel),
    source: 'mcp' as const,
    server: {
      name: 'test-server',
      id: '22222222-2222-4222-8222-222222222222',
      icons: 'icon',
      description: 'Test server',
      configGeneration: 1,
      bindingHash: 'a'.repeat(64)
    },
    raw: {
      name: 'remote_search',
      inputSchema: { type: 'object', properties: {} }
    }
  }
  const controller = createProgrammaticToolSurfaceRunControllerV1({
    ceilingDefinitions: [exec, remote],
    providerActiveDefinitions: [exec],
    policyVersion: 'dispatch-programmatic-v1'
  })
  const snapshot = controller.build({
    request: {
      sessionId: 's1',
      messageId: 'm1',
      runId: '11111111-1111-4111-8111-111111111111',
      requestSeq: 1
    },
    eligibleDefinitions: [exec, remote]
  })
  controller.admit(snapshot)
  const capability = buildProgrammaticToolCapabilityV1({
    snapshot,
    taskContractContext: null,
    ceilings: {
      maxToolEffect: 'write',
      workspace: { kind: 'runtime_default' },
      maxSubagentDepth: 0
    },
    quotas: {
      maxChildren: 4,
      maxBatchSteps: 4,
      maxInputBytes: 4_096,
      maxOutputBytes: 8_192,
      maxDurationMs: 30_000
    }
  })
  markProgrammaticToolCapabilityProvenanceCommitted(capability, snapshot)
  return {
    tools: snapshot.toolDefinitions as MCPToolDefinition[],
    capability,
    binding: Object.freeze({
      requestSeq: 1,
      snapshot,
      programmaticCapability: capability,
      releaseActivationCandidates: vi.fn()
    })
  }
}

function createProgrammaticParentStub(
  order: string[],
  options: Readonly<{
    armError?: Error
    completedResult?: Readonly<{ responseText: string; isError: boolean }>
    settleError?: Error
  }> = {}
): Readonly<{
  parents: Pick<ProgrammaticToolParentRegistry, 'prepare'>
  armOuterDispatch: ReturnType<typeof vi.fn>
  takeArmedToken: ReturnType<typeof vi.fn>
  takeCompletedInvocationResult: ReturnType<typeof vi.fn>
  cancelBeforeOuterDispatch: ReturnType<typeof vi.fn>
  settleProcessFailure: ReturnType<typeof vi.fn>
  settleOuterOutcome: ReturnType<typeof vi.fn>
}> {
  let armed = false
  const armedToken = {
    token: 'p'.repeat(43),
    conversationId: 's1',
    programmaticOperation: {
      command: { domain: 'tool', verb: 'call' },
      operation: { sessionId: 's1' }
    }
  } as unknown as ArmedAgentCliProgrammaticToken
  const armOuterDispatch = vi.fn(() => {
    order.push('arm')
    if (options.armError) throw options.armError
    armed = true
    return armedToken
  })
  const takeArmedToken = vi.fn(() => {
    if (!armed) throw new Error('not armed')
    armed = false
    order.push('take-token')
    return armedToken
  })
  const takeCompletedInvocationResult = vi.fn(() => {
    if (!options.completedResult) throw new Error('no authoritative result')
    order.push('take-result')
    return options.completedResult
  })
  const cancelBeforeOuterDispatch = vi.fn(() => order.push('cancel'))
  const settleProcessFailure = vi.fn((input: { responseText: string }) => {
    order.push('parent-t2')
    return {
      result: options.completedResult ?? { responseText: input.responseText, isError: true },
      receipt: { sessionId: 's1', entryId: 2, created: true }
    }
  })
  const settleOuterOutcome = vi.fn(() => {
    if (options.settleError) throw options.settleError
    order.push('parent-t2')
    return { sessionId: 's1', entryId: 3, created: true }
  })
  const prepare = vi.fn(
    (
      input: Parameters<ProgrammaticToolParentRegistry['prepare']>[0]
    ): ProgrammaticToolParentRegistration => {
      order.push('prepare')
      input.assertAuthorityActive()
      return {
        operation: input.binding.operation,
        armOuterDispatch,
        takeArmedToken,
        takeCompletedInvocationResult,
        cancelBeforeOuterDispatch,
        settleProcessFailure,
        settleOuterOutcome
      }
    }
  )
  return {
    parents: { prepare },
    armOuterDispatch,
    takeArmedToken,
    takeCompletedInvocationResult,
    cancelBeforeOuterDispatch,
    settleProcessFailure,
    settleOuterOutcome
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
        rawData: {
          toolCallId: request.id,
          content: responseText,
          isError: false
        }
      }
    }),
    preCheckToolPermission: vi.fn().mockResolvedValue(null),
    assertToolSurfaceAuthority: vi.fn(),
    clearConversationToolMapping: vi.fn(),
    clearAgentPlanState: vi.fn(),
    buildToolSystemPrompt: vi.fn().mockReturnValue('')
  } as unknown as ToolServicePort
}

const DEFAULT_INTERLEAVED_REASONING: InterleavedReasoningConfig = {
  preserveReasoningContent: false,
  forcedBySessionSetting: false,
  portraitInterleaved: false,
  reasoningSupported: false,
  providerDbSourceUrl: 'https://example.com/provider-db.json'
}

type TestHooks = Partial<ProcessControlCollaborators & ProcessInternalDiagnostics> & {
  onPreToolUse?: (tool: DeepChatLoopToolNotification) => void
  onPostToolUse?: (tool: DeepChatLoopToolNotification) => void
  onPostToolUseFailure?: (tool: DeepChatLoopToolNotification) => void
  onPermissionRequest?: (
    permission: Readonly<Record<string, unknown>>,
    tool: DeepChatLoopToolNotification
  ) => void
  resultNormalizer?: ToolResultPort['normalize']
  providerReplayProjector?: ChatMessageProviderReplayProjector
  executionJournal?: Pick<ExecutionJournalWriter, 'commitDispatch' | 'commitToolOutcome'> &
    Partial<NestedExecutionJournalWriter>
  toolSurface?: LoopRunRequestToolSurfaceBinding
  programmaticToolParents?: Pick<ProgrammaticToolParentRegistry, 'prepare'>
}

function expectDeepchatEvent(eventName: string, payload: Record<string, unknown>): void {
  expect(publishDeepchatEventMock).toHaveBeenCalledWith(eventName, expect.objectContaining(payload))
}

async function settleToolBatch(
  state: StreamState,
  conversation: any[],
  prevBlockCount: number,
  tools: MCPToolDefinition[],
  toolService: ToolServicePort,
  modelId: string,
  io: IoParams,
  permissionMode: PermissionMode,
  toolOutputGuard: ToolOutputGuard,
  contextLength: number,
  maxTokens: number,
  hooks?: TestHooks,
  providerId?: string,
  interleavedReasoning: InterleavedReasoningConfig = DEFAULT_INTERLEAVED_REASONING,
  rendererFlushHandle?: Pick<EchoHandle, 'flush' | 'schedule' | 'rescheduleRenderer'>,
  disposition: ToolBatchDisposition = { kind: 'execute' }
) {
  const toolExecution = createToolExecutionPort(toolService)!
  const toolResults = createToolResultPort({
    outputGuard: toolOutputGuard,
    normalize: hooks?.resultNormalizer ?? (async ({ content }) => content)
  })
  const flushHandle =
    rendererFlushHandle ??
    ({
      flush: vi.fn(() => {
        publishDeepchatEventMock('chat.stream.updated', {
          kind: 'snapshot',
          requestId: io.requestId,
          sessionId: io.sessionId,
          messageId: io.messageId,
          updatedAt: Date.now(),
          blocks: state.blocks
        })
        io.messageStore.updateAssistantContent(io.messageId, state.blocks)
      }),
      schedule: vi.fn(() => {
        publishDeepchatEventMock('chat.stream.updated', {
          kind: 'snapshot',
          requestId: io.requestId,
          sessionId: io.sessionId,
          messageId: io.messageId,
          updatedAt: Date.now(),
          blocks: state.blocks
        })
        io.messageStore.updateAssistantContent(io.messageId, state.blocks)
      }),
      rescheduleRenderer: vi.fn(() => {
        publishDeepchatEventMock('chat.stream.updated', {
          kind: 'snapshot',
          requestId: io.requestId,
          sessionId: io.sessionId,
          messageId: io.messageId,
          updatedAt: Date.now(),
          blocks: state.blocks
        })
        io.messageStore.updateAssistantContent(io.messageId, state.blocks)
      })
    } satisfies Pick<EchoHandle, 'flush' | 'schedule' | 'rescheduleRenderer'>)
  const executionJournal = hooks?.executionJournal ?? {
    commitDispatch: vi.fn(() => ({ sessionId: io.sessionId, entryId: 1, created: true })),
    commitToolOutcome: vi.fn(() => ({ sessionId: io.sessionId, entryId: 2, created: true }))
  }

  return settleToolBatchInternal({
    state,
    conversation,
    prevBlockCount,
    toolCalls: state.completedToolCalls,
    disposition,
    tools,
    toolExecution,
    modelId,
    interleavedReasoning,
    io,
    permissionMode,
    toolResults,
    contextLength,
    maxTokens,
    executionJournal,
    operationScope: {
      runId: '11111111-1111-4111-8111-111111111111',
      requestSeq: 1
    },
    toolSurface: hooks?.toolSurface,
    programmaticToolParents: hooks?.programmaticToolParents,
    commandShell: POSIX_COMMAND_SHELL,
    rendererFlushHandle: flushHandle,
    providerReplayProjector: hooks?.providerReplayProjector,
    collaborators: {
      notificationObserver: hooks
        ? {
            isObserved: () => true,
            notify: (notification) => {
              if (notification.event === 'PreToolUse') {
                hooks.onPreToolUse?.(notification.tool)
              } else if (notification.event === 'PostToolUse') {
                hooks.onPostToolUse?.(notification.tool)
              } else if (notification.event === 'PostToolUseFailure') {
                hooks.onPostToolUseFailure?.(notification.tool)
              } else {
                hooks.onPermissionRequest?.(notification.permission, notification.tool)
              }
            }
          }
        : undefined,
      controls: hooks,
      diagnostics: hooks
    },
    providerId
  })
}

describe('dispatch', () => {
  let state: StreamState
  let io: IoParams
  let tempHome: string | null = null
  let homedirSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    state = createState()
    io = createIo()
  })

  afterEach(async () => {
    homedirSpy?.mockRestore()
    homedirSpy = null
    if (tempHome) {
      await fs.rm(tempHome, { recursive: true, force: true })
      tempHome = null
    }
  })

  describe('settleToolBatch', () => {
    it.each([
      { mode: 'serial', execution: TOOL_EXECUTION.write },
      { mode: 'parallel', execution: TOOL_EXECUTION.read.parallel }
    ])('binds exact Tool Surface context and assistant ordinals in $mode batches', async ({ execution }) => {
      const definitions = [
        makeAgentTool('first', execution),
        makeAgentTool('second', execution),
        makeAgentTool('hidden-first', TOOL_EXECUTION.read.parallel),
        makeAgentTool('hidden-second', TOOL_EXECUTION.read.parallel)
      ]
      const { tools, binding, catalog } = createDispatchToolSurfaceBinding(definitions, [
        'first',
        'second'
      ])
      const entryByName = new Map(
        catalog.entries.map((entry) => [entry.target.providerVisibleName, entry])
      )
      const toolService = createMockToolService()
      const contexts = new Map<string, ToolExecutionOptions['toolSurfaceContext']>()
      vi.mocked(toolService.preCheckToolPermission).mockImplementation(async (_request, options) => {
        const preCheckOptions = options as ToolExecutionPreCheckOptions
        expect(preCheckOptions.toolSurfaceSnapshot).toBe(binding.snapshot)
        expect(preCheckOptions.messageId).toBe(io.messageId)
        expect(preCheckOptions.runId).toBe(binding.snapshot.request.runId)
        expect(preCheckOptions.requestSeq).toBe(binding.snapshot.request.requestSeq)
        return null
      })
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        const executionOptions = options as ToolExecutionOptions | undefined
        const context = executionOptions?.toolSurfaceContext
        contexts.set(request.id, context)
        expect(executionOptions?.toolSurfaceSnapshot).toBe(binding.snapshot)
        executionOptions?.commitDispatch({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: request.function.name }
        })
        const hiddenEntry = entryByName.get(request.id === 'tc0' ? 'hidden-first' : 'hidden-second')!
        executionOptions?.registerOutcomeProjection?.(() =>
          context?.submitActivationCandidates([
            {
              ...binding.snapshot.request,
              stableTargetKey: hiddenEntry.stableTargetKey,
              canonicalToolDefinitionHash: hiddenEntry.canonicalToolDefinitionHash,
              toolCallOrdinalWithinBatch: context.toolCallOrdinalWithinBatch,
              resultRank: 0
            }
          ])
        )
        return {
          content: request.function.name,
          rawData: {
            toolCallId: request.id,
            content: request.function.name,
            isError: false
          }
        }
      })
      const conversation = [{ role: 'user' as const, content: 'Use both tools' }]
      for (const index of [0, 1]) {
        state.blocks.push({
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: {
            id: `tc${index}`,
            name: TOOL_SEARCH_AGENT_TOOL_NAME,
            params: '{}',
            response: ''
          }
        })
        state.completedToolCalls.push({
          id: `tc${index}`,
          name: TOOL_SEARCH_AGENT_TOOL_NAME,
          arguments: '{}'
        })
      }

      const settled = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32_000,
        1_024,
        { toolSurface: binding },
        'openai'
      )

      expect(contexts.size).toBe(2)
      expect(toolService.preCheckToolPermission).not.toHaveBeenCalled()
      for (const index of [0, 1]) {
        const context = contexts.get(`tc${index}`)
        expect(context?.snapshot).toBe(binding.snapshot)
        expect(context?.toolCallOrdinalWithinBatch).toBe(index)
        expect(typeof context?.submitActivationCandidates).toBe('function')
        expect(Object.isFrozen(context)).toBe(true)
        expect(() => assertIssuedToolSurfaceExecutionContext(context)).not.toThrow()
      }
      expect(binding.releaseActivationCandidates).not.toHaveBeenCalled()
      expect(
        settled.toolSurfaceActivationCandidates.map((candidate) => candidate.stableTargetKey)
      ).toEqual([
        entryByName.get('hidden-first')!.stableTargetKey,
        entryByName.get('hidden-second')!.stableTargetKey
      ])
      const firstContext = contexts.get('tc0')!
      const hiddenFirst = entryByName.get('hidden-first')!
      expect(() =>
        firstContext.submitActivationCandidates([
          {
            ...binding.snapshot.request,
            stableTargetKey: hiddenFirst.stableTargetKey,
            canonicalToolDefinitionHash: hiddenFirst.canonicalToolDefinitionHash,
            toolCallOrdinalWithinBatch: 0,
            resultRank: 0
          }
        ])
      ).toThrow(/no longer active/)
    })

    it('bounds parallel ToolSearch work while preserving earliest candidate order', async () => {
      const definitions = [makeAgentTool('hidden', TOOL_EXECUTION.read.parallel)]
      const { tools, binding, catalog } = createDispatchToolSurfaceBinding(definitions, [])
      const hiddenEntry = catalog.entries.find(
        (entry) => entry.target.providerVisibleName === 'hidden'
      )!
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        const executionOptions = options as ToolExecutionOptions
        const context = executionOptions.toolSurfaceContext!
        executionOptions.commitDispatch({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: request.function.name }
        })
        executionOptions.registerOutcomeProjection?.(() =>
          context.submitActivationCandidates([
            {
              ...binding.snapshot.request,
              stableTargetKey: hiddenEntry.stableTargetKey,
              canonicalToolDefinitionHash: hiddenEntry.canonicalToolDefinitionHash,
              toolCallOrdinalWithinBatch: context.toolCallOrdinalWithinBatch,
              resultRank: 0
            }
          ])
        )
        return {
          content: 'found',
          rawData: { toolCallId: request.id, content: 'found', isError: false }
        }
      })
      const toolCallCount = MAX_TOOL_SURFACE_SEARCH_CALLS_PER_BATCH + 1
      for (let index = 0; index < toolCallCount; index += 1) {
        state.blocks.push({
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: {
            id: `search-${index}`,
            name: TOOL_SEARCH_AGENT_TOOL_NAME,
            params: '{}',
            response: ''
          }
        })
        state.completedToolCalls.push({
          id: `search-${index}`,
          name: TOOL_SEARCH_AGENT_TOOL_NAME,
          arguments: '{}'
        })
      }

      const settled = await settleToolBatch(
        state,
        [{ role: 'user', content: 'Find a tool' }],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32_000,
        1_024,
        { toolSurface: binding },
        'openai'
      )

      expect(toolService.callTool).toHaveBeenCalledTimes(MAX_TOOL_SURFACE_SEARCH_CALLS_PER_BATCH)
      expect(state.blocks.at(-1)?.tool_call?.response).toContain(
        `more than ${MAX_TOOL_SURFACE_SEARCH_CALLS_PER_BATCH} ToolSearch calls`
      )
      expect(settled.toolSurfaceActivationCandidates).toEqual([
        expect.objectContaining({ toolCallOrdinalWithinBatch: 0, resultRank: 0 })
      ])
    })

    it('rejects a same-batch guessed ToolSearch target before permission policy', async () => {
      const hidden = makeAgentTool('hidden', TOOL_EXECUTION.read.parallel)
      const { tools, binding, catalog } = createDispatchToolSurfaceBinding([hidden], [])
      const hiddenEntry = catalog.entries.find(
        (entry) => entry.target.providerVisibleName === hidden.function.name
      )!
      const toolService = createMockToolService()
      const staleDefinitions = [...tools, hidden]
      vi.mocked(toolService.assertToolSurfaceAuthority).mockImplementation((request) => {
        assertToolSurfaceAllowsDispatch(
          binding.snapshot,
          binding.snapshot.request,
          request.function.name,
          staleDefinitions.find(
            (definition) => definition.function.name === request.function.name
          )
        )
      })
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        const executionOptions = options as ToolExecutionOptions
        const context = executionOptions.toolSurfaceContext!
        executionOptions.commitDispatch({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: request.function.name }
        })
        executionOptions.registerOutcomeProjection?.(() =>
          context.submitActivationCandidates([
            {
              ...binding.snapshot.request,
              stableTargetKey: hiddenEntry.stableTargetKey,
              canonicalToolDefinitionHash: hiddenEntry.canonicalToolDefinitionHash,
              toolCallOrdinalWithinBatch: context.toolCallOrdinalWithinBatch,
              resultRank: 0
            }
          ])
        )
        return {
          content: 'found',
          rawData: { toolCallId: request.id, content: 'found', isError: false }
        }
      })
      for (const [id, name] of [
        ['search', TOOL_SEARCH_AGENT_TOOL_NAME],
        ['guess', hidden.function.name]
      ] as const) {
        state.blocks.push({
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: { id, name, params: '{}', response: '' }
        })
        state.completedToolCalls.push({ id, name, arguments: '{}' })
      }

      const settled = await settleToolBatch(
        state,
        [{ role: 'user', content: 'Find and use a tool' }],
        0,
        // Exercise the authority boundary even if a stale caller accidentally retains the hidden
        // definition beside the exact snapshot definitions.
        staleDefinitions,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32_000,
        1_024,
        { toolSurface: binding },
        'openai'
      )

      expect(toolService.preCheckToolPermission).not.toHaveBeenCalled()
      expect(toolService.callTool).toHaveBeenCalledOnce()
      expect(toolService.callTool).toHaveBeenCalledWith(
        expect.objectContaining({ function: expect.objectContaining({ name: TOOL_SEARCH_AGENT_TOOL_NAME }) }),
        expect.anything()
      )
      expect(settled.toolSurfaceActivationCandidates).toEqual([
        expect.objectContaining({
          stableTargetKey: hiddenEntry.stableTargetKey,
          toolCallOrdinalWithinBatch: 0
        })
      ])
      expect(state.blocks.find((block) => block.tool_call?.id === 'guess')).toMatchObject({
        status: 'error',
        tool_call: { response: 'Error: Tool is not available in the current session: hidden' }
      })
    })

    it('revokes ToolSearch contexts and discards candidates when settlement fails', async () => {
      const definitions = [makeAgentTool('hidden', TOOL_EXECUTION.read.parallel)]
      const { tools, binding, catalog } = createDispatchToolSurfaceBinding(definitions, [])
      const hiddenEntry = catalog.entries.find(
        (entry) => entry.target.providerVisibleName === 'hidden'
      )!
      const toolService = createMockToolService()
      let issuedContext: ToolExecutionOptions['toolSurfaceContext']
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        const executionOptions = options as ToolExecutionOptions
        issuedContext = executionOptions.toolSurfaceContext
        executionOptions.commitDispatch({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: request.function.name }
        })
        executionOptions.registerOutcomeProjection?.(() =>
          issuedContext?.submitActivationCandidates([
            {
              ...binding.snapshot.request,
              stableTargetKey: hiddenEntry.stableTargetKey,
              canonicalToolDefinitionHash: hiddenEntry.canonicalToolDefinitionHash,
              toolCallOrdinalWithinBatch: 0,
              resultRank: 0
            }
          ])
        )
        return {
          content: 'found',
          rawData: { toolCallId: request.id, content: 'found', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc0',
          name: TOOL_SEARCH_AGENT_TOOL_NAME,
          params: '{}',
          response: ''
        }
      })
      state.completedToolCalls.push({
        id: 'tc0',
        name: TOOL_SEARCH_AGENT_TOOL_NAME,
        arguments: '{}'
      })
      const toolOutputGuard = new ToolOutputGuard()
      vi.spyOn(toolOutputGuard, 'fitToolBatchOutputs').mockRejectedValue(
        new Error('transcript settlement failed')
      )

      await expect(
        settleToolBatch(
          state,
          [{ role: 'user', content: 'Find a tool' }],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          toolOutputGuard,
          32_000,
          1_024,
          { toolSurface: binding },
          'openai'
        )
      ).rejects.toThrow('transcript settlement failed')
      expect(binding.releaseActivationCandidates).not.toHaveBeenCalled()
      expect(() => issuedContext?.submitActivationCandidates([])).toThrow(/no longer active/)
    })

    it('discards ToolSearch candidates when output fitting downgrades the result', async () => {
      const definitions = [makeAgentTool('hidden', TOOL_EXECUTION.read.parallel)]
      const { tools, binding, catalog } = createDispatchToolSurfaceBinding(definitions, [])
      const hiddenEntry = catalog.entries.find(
        (entry) => entry.target.providerVisibleName === 'hidden'
      )!
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        const executionOptions = options as ToolExecutionOptions
        const context = executionOptions.toolSurfaceContext!
        executionOptions.commitDispatch({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: request.function.name }
        })
        executionOptions.registerOutcomeProjection?.(() =>
          context.submitActivationCandidates([
            {
              ...binding.snapshot.request,
              stableTargetKey: hiddenEntry.stableTargetKey,
              canonicalToolDefinitionHash: hiddenEntry.canonicalToolDefinitionHash,
              toolCallOrdinalWithinBatch: 0,
              resultRank: 0
            }
          ])
        )
        return {
          content: 'found',
          rawData: { toolCallId: request.id, content: 'found', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc0',
          name: TOOL_SEARCH_AGENT_TOOL_NAME,
          params: '{}',
          response: ''
        }
      })
      state.completedToolCalls.push({
        id: 'tc0',
        name: TOOL_SEARCH_AGENT_TOOL_NAME,
        arguments: '{}'
      })
      const toolOutputGuard = new ToolOutputGuard()
      vi.spyOn(toolOutputGuard, 'fitToolBatchOutputs').mockImplementation(async ({ results }) => ({
        kind: 'ok',
        results: results.map((result) => ({
          ...result,
          responseText: 'Tool output could not fit.',
          contextResponseText: '',
          isError: true,
          downgraded: true
        }))
      }))

      const settled = await settleToolBatch(
        state,
        [{ role: 'user', content: 'Find a tool' }],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        toolOutputGuard,
        32_000,
        1_024,
        { toolSurface: binding },
        'openai'
      )

      expect(settled).toMatchObject({ type: 'completed', toolSurfaceActivationCandidates: [] })
      expect(state.blocks[0]).toMatchObject({ status: 'error' })
      expect(binding.releaseActivationCandidates).not.toHaveBeenCalled()
    })

    it('records settled MCP quality before provider output fitting fails', async () => {
      const definitions = [
        {
          ...makeTool('remote_read', TOOL_EXECUTION.read.parallel),
          source: 'mcp' as const,
          server: {
            name: 'test-server',
            id: '22222222-2222-4222-8222-222222222222',
            icons: 'icon',
            description: 'Test server',
            configGeneration: 1,
            bindingHash: 'a'.repeat(64)
          },
          raw: { name: 'remote_read', inputSchema: { type: 'object', properties: {} } }
        }
      ]
      const { tools, binding } = createDispatchToolSurfaceBinding(definitions)
      const evidence = createToolSurfaceCanaryRunEvidenceRecorder()
      bindToolSurfaceCanaryRunEvidence(binding.snapshot, evidence)
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        const executionOptions = options as ToolExecutionOptions
        executionOptions.commitDispatch({
          toolName: request.function.name,
          toolSource: 'mcp',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: request.function.name }
        })
        return {
          content: 'remote result',
          rawData: { toolCallId: request.id, content: 'remote result', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc0',
          name: 'remote_read',
          params: '{}',
          response: ''
        }
      })
      state.completedToolCalls.push({ id: 'tc0', name: 'remote_read', arguments: '{}' })
      const toolOutputGuard = new ToolOutputGuard()
      vi.spyOn(toolOutputGuard, 'fitToolBatchOutputs').mockRejectedValue(
        new Error('transcript settlement failed')
      )

      await expect(
        settleToolBatch(
          state,
          [{ role: 'user', content: 'Read remotely' }],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          toolOutputGuard,
          32_000,
          1_024,
          { toolSurface: binding },
          'openai'
        )
      ).rejects.toThrow('transcript settlement failed')

      expect(evidence.snapshot().quality).toEqual({
        settledToolResults: 1,
        successfulSettledToolResults: 1,
        failedSettledToolResults: 0
      })
    })

    it('rejects a stale Tool Surface batch binding before tool execution', async () => {
      const definitions = [makeAgentTool('read', TOOL_EXECUTION.read.parallel)]
      const { tools, binding } = createDispatchToolSurfaceBinding(definitions)
      const toolService = createMockToolService()
      state.completedToolCalls = [{ id: 'tc1', name: 'read', arguments: '{}' }]

      await expect(
        settleToolBatch(
          state,
          [{ role: 'user', content: 'Read' }],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32_000,
          1_024,
          { toolSurface: Object.freeze({ ...binding, requestSeq: 2 }) },
          'openai'
        )
      ).rejects.toThrow(/request-scoped Tool Surface binding/)
      expect(toolService.callTool).not.toHaveBeenCalled()
    })

    it('persists a call-bound Tool Surface binding before a permission pause', async () => {
      const { tools, binding } = createDispatchToolSurfaceBinding([
        makeAgentTool('write_file', TOOL_EXECUTION.write)
      ])
      const toolService = createMockToolService()
      vi.mocked(toolService.preCheckToolPermission).mockResolvedValue({
        needsPermission: true,
        requiresUserConfirmation: true,
        permissionType: 'write',
        description: 'Need write permission'
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc-write', name: 'write_file', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc-write', name: 'write_file', arguments: '{}' }]

      const settled = await settleToolBatch(
        state,
        [{ role: 'user', content: 'Write' }],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'default',
        new ToolOutputGuard(),
        32_000,
        1_024,
        { toolSurface: binding },
        'openai'
      )

      const expectedBinding = buildToolSurfaceDeferredDispatchBinding({
        snapshot: binding.snapshot,
        toolCallId: 'tc-write',
        toolName: 'write_file',
        contractBearing: false
      })
      expect(settled).toMatchObject({
        type: 'paused',
        interactions: [{ toolSurfaceBinding: expectedBinding }]
      })
      const action = state.blocks.find((block) => block.action_type === 'tool_call_permission')
      expect(JSON.parse(action?.extra?.toolSurfaceBinding as string)).toEqual(expectedBinding)
      expect(toolService.callTool).not.toHaveBeenCalled()
    })

    it('builds assistant message, calls tools, updates blocks', async () => {
      const tools = [makeAgentTool('get_weather')]
      const toolService = createMockToolService({ get_weather: 'Sunny, 72F' })
      const conversation = [{ role: 'user' as const, content: 'Hello' }]

      // Simulate accumulator having produced a tool_call block
      state.blocks.push({
        type: 'content',
        content: 'Checking weather...',
        status: 'pending',
        timestamp: Date.now()
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'get_weather', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'get_weather', arguments: '{}' }]

      const executed = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        undefined,
        'openai'
      )

      expect(executed.executed).toBe(1)
      expect(toolService.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tc1',
          function: { name: 'get_weather', arguments: '{}' },
          server: tools[0].server,
          conversationId: 's1',
          providerId: 'openai'
        }),
        expect.objectContaining({
          signal: expect.any(Object),
          commandShell: POSIX_COMMAND_SHELL
        })
      )

      // Conversation should have assistant + tool messages
      expect(conversation).toHaveLength(3)
      expect(conversation[1].role).toBe('assistant')
      expect(conversation[2].role).toBe('tool')
      expect(conversation[2].content).toBe('Sunny, 72F')

      // Block should be updated with response
      const toolBlock = state.blocks.find((b) => b.type === 'tool_call')
      expect(toolBlock!.tool_call!.response).toBe('Sunny, 72F')
      expect(toolBlock!.status).toBe('success')
      expect(toolBlock!.extra?.toolSource).toBe('agent')
    })

    it('commits dispatched tool outcomes before projecting them', async () => {
      const tools = [makeTool('mutate')]
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Change it' }]
      const order: string[] = []
      const commitDispatch = vi.fn(() => {
        order.push('t1')
        return { sessionId: 's1', entryId: 1, created: true }
      })
      const commitToolOutcome = vi.fn(() => {
        order.push('t2')
        expect(conversation).toHaveLength(2)
        expect(state.blocks[0].tool_call?.response).toBe('')
        return { sessionId: 's1', entryId: 2, created: true }
      })
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'mcp',
          normalizedArguments: { value: 1 },
          target: { serverName: 'test-server', originalName: 'mutate' }
        })
        order.push('target')
        options?.registerOutcomeProjection?.(() => order.push('ui'))
        return {
          content: 'changed',
          rawData: { toolCallId: request.id, content: 'changed', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'mutate', params: '{"value":1}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'mutate', arguments: '{"value":1}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        { executionJournal: { commitDispatch, commitToolOutcome } },
        'openai'
      )

      expect(order).toEqual(['t1', 'target', 't2', 'ui'])
      expect(commitDispatch).toHaveBeenCalledWith({
        sessionId: 's1',
        messageId: 'm1',
        operation: {
          runId: '11111111-1111-4111-8111-111111111111',
          requestSeq: 1,
          providerToolCallId: 'tc1'
        },
        toolName: 'mutate',
        toolSource: 'mcp',
        normalizedArguments: { value: 1 },
        target: { serverName: 'test-server', originalName: 'mutate' }
      })
      expect(commitToolOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 's1',
          messageId: 'm1',
          responseText: 'changed',
          isError: false
        })
      )
      expect(conversation.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'tc1',
        content: 'changed'
      })
    })

    it('binds Code Mode child journal facts to the outer provider tool call', async () => {
      const tools = [makeTool('run_code')]
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Run code' }]
      const order: string[] = []
      const commitDispatch = vi.fn(() => {
        order.push('outer-dispatch')
        return { sessionId: 's1', entryId: 1, created: true }
      })
      const commitNestedDispatch = vi.fn(() => {
        order.push('child-dispatch')
        return { sessionId: 's1', entryId: 2, created: true }
      })
      const commitNestedToolOutcome = vi.fn(() => {
        order.push('child-outcome')
        return { sessionId: 's1', entryId: 3, created: true }
      })
      const commitToolOutcome = vi.fn(() => {
        order.push('outer-outcome')
        return { sessionId: 's1', entryId: 4, created: true }
      })
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: { code: 'return true' },
          target: { serverName: 'agent-code-mode', originalName: 'run_code' }
        })
        options?.commitNestedDispatch?.({
          childOrdinal: 0,
          toolName: 'exec',
          toolSource: 'agent',
          normalizedArguments: { command: 'pwd' },
          target: { serverName: 'agent-filesystem', originalName: 'exec' },
          definitionHash: 'a'.repeat(64),
          capabilityHash: 'b'.repeat(64)
        })
        options?.commitNestedToolOutcome?.({
          childOrdinal: 0,
          responseText: '/workspace',
          isError: false
        })
        return {
          content: 'done',
          rawData: { toolCallId: request.id, content: 'done', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc-code', name: 'run_code', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc-code', name: 'run_code', arguments: '{}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-5.6',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          executionJournal: {
            commitDispatch,
            commitNestedDispatch,
            commitNestedToolOutcome,
            commitToolOutcome
          }
        },
        'openai'
      )

      expect(order).toEqual([
        'outer-dispatch',
        'child-dispatch',
        'child-outcome',
        'outer-outcome'
      ])
      expect(commitNestedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 's1',
          messageId: 'm1',
          operation: {
            kind: 'nested',
            runId: '11111111-1111-4111-8111-111111111111',
            requestSeq: 1,
            providerToolCallId: 'tc-code',
            childOrdinal: 0
          },
          toolName: 'exec',
          normalizedArguments: { command: 'pwd' }
        })
      )
      expect(commitNestedToolOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: expect.objectContaining({
            kind: 'nested',
            providerToolCallId: 'tc-code',
            childOrdinal: 0
          }),
          responseText: '/workspace',
          isError: false
        })
      )
    })

    it('rejects Programmatic exec authority outside CLI Programmatic mode', () => {
      const { tools, capability } = createDispatchProgrammaticToolSurfaceBinding()
      const native = createDispatchToolSurfaceBinding(tools)
      const parent = createProgrammaticParentStub([])

      expect(() =>
        prepareProgrammaticExecParent({
          toolName: 'exec',
          argumentsJson: PROGRAMMATIC_EXEC_ARGUMENTS,
          operation: {
            runId: '11111111-1111-4111-8111-111111111111',
            requestSeq: 1,
            providerToolCallId: 'tc-exec'
          },
          sessionId: 's1',
          messageId: 'm1',
          permissionMode: 'full_access',
          toolSurfaceSnapshot: native.binding.snapshot,
          capability,
          parents: parent.parents
        })
      ).toThrow('Programmatic Tool exec requires a CLI Programmatic Tool Surface')
      expect(parent.parents.prepare).not.toHaveBeenCalled()
    })

    it('rejects Programmatic exec operation identity that conflicts with its request', () => {
      const { binding, capability } = createDispatchProgrammaticToolSurfaceBinding()
      const parent = createProgrammaticParentStub([])

      expect(() =>
        prepareProgrammaticExecParent({
          toolName: 'exec',
          argumentsJson: PROGRAMMATIC_EXEC_ARGUMENTS,
          operation: {
            runId: '11111111-1111-4111-8111-111111111111',
            requestSeq: 1,
            providerToolCallId: 'tc-exec',
            sessionId: 'another-session'
          } as Parameters<typeof prepareProgrammaticExecParent>[0]['operation'],
          sessionId: 's1',
          messageId: 'm1',
          permissionMode: 'full_access',
          toolSurfaceSnapshot: binding.snapshot,
          capability,
          parents: parent.parents
        })
      ).toThrow('Programmatic Tool exec operation identity does not match its request')
      expect(parent.parents.prepare).not.toHaveBeenCalled()
    })

    it('arms a Programmatic exec only after outer T1 and passes its exact parent authority', async () => {
      const { tools, binding } = createDispatchProgrammaticToolSurfaceBinding()
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Call it' }]
      const order: string[] = []
      const parent = createProgrammaticParentStub(order)
      const commitDispatch = vi.fn(() => {
        order.push('outer-t1')
        return { sessionId: 's1', entryId: 1, created: true }
      })
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        order.push('tool-service')
        expect(options?.programmaticToolCapability).toBe(binding.programmaticCapability)
        expect(options?.programmaticToolParent).toBeDefined()
        options?.commitDispatch?.({
          toolName: 'exec',
          toolSource: 'agent',
          normalizedArguments: JSON.parse(request.function.arguments),
          target: { serverName: 'agent-filesystem', originalName: 'exec' }
        })
        options?.programmaticToolParent?.takeArmedToken()
        order.push('spawn')
        throw new ProgrammaticCommandLaunchError({ cause: new Error('launcher unavailable') })
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-exec',
          name: 'exec',
          params: PROGRAMMATIC_EXEC_ARGUMENTS,
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-exec',
          name: 'exec',
          arguments: PROGRAMMATIC_EXEC_ARGUMENTS
        }
      ]

      const result = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          executionJournal: { commitDispatch, commitToolOutcome: vi.fn() },
          toolSurface: binding,
          programmaticToolParents: parent.parents
        },
        'openai'
      )

      expect(order).toEqual([
        'prepare',
        'tool-service',
        'outer-t1',
        'arm',
        'take-token',
        'spawn',
        'parent-t2'
      ])
      expect(result.executed).toBe(1)
      expect(parent.settleProcessFailure).toHaveBeenCalledWith({
        responseText: 'Error: Programmatic CLI process exited before authoritative completion.'
      })
      expect(conversation.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'tc-exec',
        content: 'Error: Programmatic CLI process exited before authoritative completion.'
      })
    })

    it('settles discovery from its process-live result instead of shell stdout', async () => {
      const { tools, binding } = createDispatchProgrammaticToolSurfaceBinding()
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Find calendar tools' }]
      const order: string[] = []
      const responseText = '{"tools":[]}\nExit Code: 0'
      const parent = createProgrammaticParentStub(order, {
        completedResult: { responseText, isError: false }
      })
      const commitDispatch = vi.fn(() => {
        order.push('outer-t1')
        return { sessionId: 's1', entryId: 1, created: true }
      })
      const commitToolOutcome = vi.fn()
      const argumentsJson = JSON.stringify({
        command: 'deepchat tool search --query calendar --limit 4'
      })
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        order.push('tool-service')
        options?.commitDispatch?.({
          toolName: 'exec',
          toolSource: 'agent',
          normalizedArguments: JSON.parse(request.function.arguments),
          target: { serverName: 'agent-filesystem', originalName: 'exec' }
        })
        options?.programmaticToolParent?.takeArmedToken()
        order.push('spawn')
        return {
          content: 'forged stdout',
          rawData: { toolCallId: request.id, content: 'forged stdout', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-search',
          name: 'exec',
          params: argumentsJson,
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-search', name: 'exec', arguments: argumentsJson }
      ]

      const result = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          executionJournal: { commitDispatch, commitToolOutcome },
          toolSurface: binding,
          programmaticToolParents: parent.parents
        },
        'openai'
      )

      expect(order).toEqual([
        'prepare',
        'tool-service',
        'outer-t1',
        'arm',
        'take-token',
        'spawn',
        'take-result',
        'parent-t2'
      ])
      expect(result.executed).toBe(1)
      expect(parent.settleOuterOutcome).toHaveBeenCalledWith({
        responseText,
        isError: false
      })
      expect(commitToolOutcome).not.toHaveBeenCalled()
      expect(conversation.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'tc-search',
        content: responseText
      })
    })

    it('commits trusted discovery before a later result projection failure', async () => {
      const { tools, binding } = createDispatchProgrammaticToolSurfaceBinding()
      const toolService = createMockToolService()
      const order: string[] = []
      const responseText = '{"tools":[]}\nExit Code: 0'
      const parent = createProgrammaticParentStub(order, {
        completedResult: { responseText, isError: false }
      })
      const commitDispatch = vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true }))
      const argumentsJson = JSON.stringify({
        command: 'deepchat tool search --query calendar'
      })
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: 'exec',
          toolSource: 'agent',
          normalizedArguments: JSON.parse(request.function.arguments),
          target: { serverName: 'agent-filesystem', originalName: 'exec' }
        })
        options?.programmaticToolParent?.takeArmedToken()
        return {
          content: 'untrusted stdout',
          rawData: { toolCallId: request.id, content: 'untrusted stdout', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-search-projection',
          name: 'exec',
          params: argumentsJson,
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-search-projection', name: 'exec', arguments: argumentsJson }
      ]

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            executionJournal: { commitDispatch, commitToolOutcome: vi.fn() },
            toolSurface: binding,
            programmaticToolParents: parent.parents,
            resultNormalizer: async () => {
              throw new Error('projection failed')
            }
          },
          'openai'
        )
      ).rejects.toMatchObject({ name: 'CommittedToolOutcomeProjectionError' })

      expect(parent.settleOuterOutcome).toHaveBeenCalledWith({
        responseText,
        isError: false
      })
      expect(order.at(-1)).toBe('parent-t2')
    })

    it('propagates discovery outcome persistence failure without projecting a CLI result', async () => {
      const { tools, binding } = createDispatchProgrammaticToolSurfaceBinding()
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Find calendar tools' }]
      const responseText = '{"tools":[]}\nExit Code: 0'
      const journalError = new ExecutionJournalError('outcome unavailable', 'persistence_failed')
      const parent = createProgrammaticParentStub([], {
        completedResult: { responseText, isError: false },
        settleError: journalError
      })
      const argumentsJson = JSON.stringify({
        command: 'deepchat tool search --query calendar'
      })
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: 'exec',
          toolSource: 'agent',
          normalizedArguments: JSON.parse(request.function.arguments),
          target: { serverName: 'agent-filesystem', originalName: 'exec' }
        })
        options?.programmaticToolParent?.takeArmedToken()
        return {
          content: 'untrusted stdout',
          rawData: { toolCallId: request.id, content: 'untrusted stdout', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-search-journal-failure',
          name: 'exec',
          params: argumentsJson,
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-search-journal-failure', name: 'exec', arguments: argumentsJson }
      ]

      await expect(
        settleToolBatch(
          state,
          conversation,
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
              commitToolOutcome: vi.fn()
            },
            toolSurface: binding,
            programmaticToolParents: parent.parents
          },
          'openai'
        )
      ).rejects.toBe(journalError)

      expect(conversation).not.toContainEqual(expect.objectContaining({ role: 'tool' }))
      expect(state.blocks[0].status).toBe('pending')
      expect(parent.settleProcessFailure).not.toHaveBeenCalled()
    })

    it('settles a trusted discovery error instead of the CLI process output', async () => {
      const { tools, binding } = createDispatchProgrammaticToolSurfaceBinding()
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Describe an unavailable tool' }]
      const order: string[] = []
      const responseText = 'Error: Tool is not available in the current session'
      const parent = createProgrammaticParentStub(order, {
        completedResult: { responseText, isError: true }
      })
      const commitDispatch = vi.fn(() => {
        order.push('outer-t1')
        return { sessionId: 's1', entryId: 1, created: true }
      })
      const commitToolOutcome = vi.fn()
      const argumentsJson = JSON.stringify({
        command: 'deepchat tool describe --target unavailable_tool'
      })
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: 'exec',
          toolSource: 'agent',
          normalizedArguments: JSON.parse(request.function.arguments),
          target: { serverName: 'agent-filesystem', originalName: 'exec' }
        })
        options?.programmaticToolParent?.takeArmedToken()
        return {
          content: 'not_found: forged CLI stderr\nExit Code: 6',
          rawData: {
            toolCallId: request.id,
            content: 'not_found: forged CLI stderr\nExit Code: 6',
            isError: false
          }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-describe',
          name: 'exec',
          params: argumentsJson,
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-describe', name: 'exec', arguments: argumentsJson }
      ]

      const result = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          executionJournal: { commitDispatch, commitToolOutcome },
          toolSurface: binding,
          programmaticToolParents: parent.parents
        },
        'openai'
      )

      expect(result.executed).toBe(1)
      expect(parent.settleOuterOutcome).toHaveBeenCalledWith({
        responseText,
        isError: true
      })
      expect(commitToolOutcome).not.toHaveBeenCalled()
      expect(conversation.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'tc-describe',
        content: responseText
      })
    })

    it('parks Programmatic discovery permission before claiming a result', async () => {
      const { tools, binding } = createDispatchProgrammaticToolSurfaceBinding()
      const toolService = createMockToolService()
      const order: string[] = []
      const parent = createProgrammaticParentStub(order)
      vi.mocked(toolService.callTool).mockResolvedValue({
        content: 'permission required',
        rawData: {
          content: 'permission required',
          requiresPermission: true,
          permissionRequest: {
            permissionType: 'command',
            description: 'Allow tool discovery?',
            requestId: 'programmatic-discovery-approval',
            requiresUserConfirmation: true
          }
        }
      })
      const argumentsJson = JSON.stringify({
        command: 'deepchat tool search --query calendar'
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-search-permission',
          name: 'exec',
          params: argumentsJson,
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-search-permission', name: 'exec', arguments: argumentsJson }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          executionJournal: { commitDispatch: vi.fn(), commitToolOutcome: vi.fn() },
          toolSurface: binding,
          programmaticToolParents: parent.parents
        },
        'openai'
      )

      expect(result.type).toBe('paused')
      expect(result.type === 'paused' ? result.interactions[0]?.permission : null).toMatchObject({
        requestId: 'programmatic-discovery-approval',
        requiresUserConfirmation: true
      })
      expect(order).toEqual(['prepare', 'cancel'])
      expect(parent.takeCompletedInvocationResult).not.toHaveBeenCalled()
      expect(parent.settleProcessFailure).not.toHaveBeenCalled()
    })

    it('does not arm or invoke Programmatic exec when outer T1 is not newly created', async () => {
      const { tools, binding } = createDispatchProgrammaticToolSurfaceBinding()
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Call it' }]
      const order: string[] = []
      const parent = createProgrammaticParentStub(order)
      const target = vi.fn()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: 'exec',
          toolSource: 'agent',
          normalizedArguments: JSON.parse(request.function.arguments),
          target: { serverName: 'agent-filesystem', originalName: 'exec' }
        })
        target()
        return {
          content: 'unexpected',
          rawData: { toolCallId: request.id, content: 'unexpected', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-exec',
          name: 'exec',
          params: PROGRAMMATIC_EXEC_ARGUMENTS,
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-exec',
          name: 'exec',
          arguments: PROGRAMMATIC_EXEC_ARGUMENTS
        }
      ]

      await expect(
        settleToolBatch(
          state,
          conversation,
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: false })),
              commitToolOutcome: vi.fn()
            },
            toolSurface: binding,
            programmaticToolParents: parent.parents
          },
          'openai'
        )
      ).rejects.toMatchObject({ code: 'duplicate_dispatch' })

      expect(order).toEqual(['prepare', 'cancel'])
      expect(parent.armOuterDispatch).not.toHaveBeenCalled()
      expect(target).not.toHaveBeenCalled()
    })

    it('settles a known outer error when View revocation prevents arming after T1', async () => {
      const { tools, binding } = createDispatchProgrammaticToolSurfaceBinding()
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Call it' }]
      const order: string[] = []
      const parent = createProgrammaticParentStub(order, { armError: new Error('View revoked') })
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        try {
          options?.commitDispatch?.({
            toolName: 'exec',
            toolSource: 'agent',
            normalizedArguments: JSON.parse(request.function.arguments),
            target: { serverName: 'agent-filesystem', originalName: 'exec' }
          })
        } catch (error) {
          throw new ProgrammaticCommandLaunchError({ cause: error })
        }
        return {
          content: 'unexpected',
          rawData: { toolCallId: request.id, content: 'unexpected', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-exec',
          name: 'exec',
          params: PROGRAMMATIC_EXEC_ARGUMENTS,
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-exec',
          name: 'exec',
          arguments: PROGRAMMATIC_EXEC_ARGUMENTS
        }
      ]

      const result = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          executionJournal: {
            commitDispatch: vi.fn(() => {
              order.push('outer-t1')
              return { sessionId: 's1', entryId: 1, created: true }
            }),
            commitToolOutcome: vi.fn()
          },
          toolSurface: binding,
          programmaticToolParents: parent.parents
        },
        'openai'
      )

      expect(order).toEqual(['prepare', 'outer-t1', 'arm', 'parent-t2'])
      expect(result.executed).toBe(1)
      expect(parent.takeArmedToken).not.toHaveBeenCalled()
    })

    it('cancels an inert Programmatic parent when execution fails before outer T1', async () => {
      const { tools, binding } = createDispatchProgrammaticToolSurfaceBinding()
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Call it' }]
      const order: string[] = []
      const parent = createProgrammaticParentStub(order)
      vi.mocked(toolService.callTool).mockRejectedValue(new Error('pre-dispatch validation failed'))
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-exec',
          name: 'exec',
          params: PROGRAMMATIC_EXEC_ARGUMENTS,
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-exec',
          name: 'exec',
          arguments: PROGRAMMATIC_EXEC_ARGUMENTS
        }
      ]

      const result = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          executionJournal: {
            commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
            commitToolOutcome: vi.fn()
          },
          toolSurface: binding,
          programmaticToolParents: parent.parents
        },
        'openai'
      )

      expect(result.executed).toBe(1)
      expect(order).toEqual(['prepare', 'cancel'])
      expect(parent.armOuterDispatch).not.toHaveBeenCalled()
    })

    it('commits each parallel outcome without waiting for slower siblings', async () => {
      const tools = [
        makeTool('fast', TOOL_EXECUTION.read.parallel),
        makeTool('slow', TOOL_EXECUTION.read.parallel)
      ]
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Inspect both' }]
      const slowResult = createDeferred<void>()
      const commitDispatch = vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true }))
      const commitToolOutcome = vi.fn(() => ({ sessionId: 's1', entryId: 2, created: true }))
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'mcp',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: request.function.name }
        })
        if (request.function.name === 'slow') {
          await slowResult.promise
        }
        return {
          content: `${request.function.name}-result`,
          rawData: {
            toolCallId: request.id,
            content: `${request.function.name}-result`,
            isError: false
          }
        }
      })
      state.blocks.push(
        ...['fast', 'slow'].map((name) => ({
          type: 'tool_call' as const,
          content: '',
          status: 'pending' as const,
          timestamp: Date.now(),
          tool_call: { id: `tc-${name}`, name, params: '{}', response: '' }
        }))
      )
      state.completedToolCalls = ['fast', 'slow'].map((name) => ({
        id: `tc-${name}`,
        name,
        arguments: '{}'
      }))

      const settling = settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        { executionJournal: { commitDispatch, commitToolOutcome } },
        'openai'
      )

      await vi.waitFor(() => expect(commitDispatch).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(commitToolOutcome).toHaveBeenCalledTimes(1))
      expect(commitToolOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: expect.objectContaining({ providerToolCallId: 'tc-fast' })
        })
      )
      expect(conversation).toHaveLength(2)

      slowResult.resolve()
      await settling
      expect(commitToolOutcome).toHaveBeenCalledTimes(2)
      expect(conversation).toHaveLength(4)
    })

    it('propagates an invalid pre-dispatch fact without invoking its target', async () => {
      const tools = [
        makeTool('invalid', TOOL_EXECUTION.read.parallel),
        makeTool('valid', TOOL_EXECUTION.read.parallel)
      ]
      const toolService = createMockToolService()
      const validTarget = vi.fn()
      const invalidTarget = vi.fn()
      const conversation: any[] = [{ role: 'user', content: 'Run both' }]
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'mcp',
          normalizedArguments:
            request.function.name === 'invalid' ? { value: Number.POSITIVE_INFINITY } : {},
          target: { serverName: 'test-server', originalName: request.function.name }
        })
        if (request.function.name === 'invalid') invalidTarget()
        else validTarget()
        return {
          content: `${request.function.name}-result`,
          rawData: {
            toolCallId: request.id,
            content: `${request.function.name}-result`,
            isError: false
          }
        }
      })
      state.blocks.push(
        ...['invalid', 'valid'].map((name) => ({
          type: 'tool_call' as const,
          content: '',
          status: 'pending' as const,
          timestamp: Date.now(),
          tool_call: { id: `tc-${name}`, name, params: '{}', response: '' }
        }))
      )
      state.completedToolCalls = ['invalid', 'valid'].map((name) => ({
        id: `tc-${name}`,
        name,
        arguments: '{}'
      }))
      const commitDispatch = vi.fn((input) => {
        if (input.toolName === 'invalid') {
          throw new ExecutionJournalError(
            'normalizedArguments must be JSON serializable.',
            'invalid_fact'
          )
        }
        return { sessionId: 's1', entryId: 1, created: true }
      })

      await expect(
        settleToolBatch(
          state,
          conversation,
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            executionJournal: {
              commitDispatch,
              commitToolOutcome: vi.fn(() => ({ sessionId: 's1', entryId: 2, created: true }))
            }
          },
          'openai'
        )
      ).rejects.toThrow('normalizedArguments must be JSON serializable')

      expect(invalidTarget).not.toHaveBeenCalled()
      expect(validTarget).toHaveBeenCalledOnce()
      expect(conversation).toHaveLength(2)
      expect(conversation[0]).toEqual({ role: 'user', content: 'Run both' })
      expect(conversation[1]).toMatchObject({
        role: 'assistant',
        tool_calls: expect.arrayContaining([
          expect.objectContaining({ id: 'tc-invalid' }),
          expect.objectContaining({ id: 'tc-valid' })
        ])
      })
      expect(conversation).not.toContainEqual(expect.objectContaining({ role: 'tool' }))
    })

    it('keeps a dispatched result unprojected when its outcome commit fails', async () => {
      const tools = [makeTool('mutate')]
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Change it' }]
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'mcp',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: 'mutate' }
        })
        return {
          content: 'changed',
          rawData: { toolCallId: request.id, content: 'changed', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'mutate', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'mutate', arguments: '{}' }]
      const journalError = new ExecutionJournalError('outcome unavailable', 'persistence_failed')

      await expect(
        settleToolBatch(
          state,
          conversation,
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
              commitToolOutcome: vi.fn(() => {
                throw journalError
              })
            }
          },
          'openai'
        )
      ).rejects.toBe(journalError)

      expect(conversation).toHaveLength(2)
      expect(state.blocks[0].tool_call?.response).toBe('')
      expect(state.blocks[0].status).toBe('pending')
    })

    it('treats an existing outcome receipt as corruption before projection', async () => {
      const tools = [makeTool('mutate')]
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Change it' }]
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'mcp',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: 'mutate' }
        })
        return {
          content: 'changed',
          rawData: { toolCallId: request.id, content: 'changed', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'mutate', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'mutate', arguments: '{}' }]

      await expect(
        settleToolBatch(
          state,
          conversation,
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
              commitToolOutcome: vi.fn(() => ({ sessionId: 's1', entryId: 2, created: false }))
            }
          },
          'openai'
        )
      ).rejects.toMatchObject({ code: 'conflicting_fact' })

      expect(conversation).toHaveLength(2)
      expect(state.blocks[0].tool_call?.response).toBe('')
    })

    it('commits a known target failure before projecting the tool error', async () => {
      const tools = [makeTool('mutate')]
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Change it' }]
      const commitToolOutcome = vi.fn(() => ({ sessionId: 's1', entryId: 2, created: true }))
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'mcp',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: 'mutate' }
        })
        throw new Error('target failed')
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'mutate', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'mutate', arguments: '{}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          executionJournal: {
            commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
            commitToolOutcome
          }
        },
        'openai'
      )

      expect(commitToolOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          responseText: 'Error: target failed',
          isError: true
        })
      )
      expect(conversation.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'tc1',
        content: 'Error: target failed'
      })
    })

    it('commits and fails closed when permission is returned after dispatch', async () => {
      const tools = [makeTool('mutate')]
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Change it' }]
      const commitToolOutcome = vi.fn(() => ({ sessionId: 's1', entryId: 2, created: true }))
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'mcp',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: 'mutate' }
        })
        return {
          content: 'permission required',
          rawData: {
            toolCallId: request.id,
            content: 'permission required',
            isError: true,
            requiresPermission: true,
            permissionRequest: {
              permissionType: 'write',
              description: 'Need write permission'
            }
          }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'mutate', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'mutate', arguments: '{}' }]

      await expect(
        settleToolBatch(
          state,
          conversation,
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
              commitToolOutcome
            }
          },
          'openai'
        )
      ).rejects.toMatchObject({ code: 'invalid_fact' })

      expect(commitToolOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          responseText: 'Error: Tool mutate requested permission after dispatch.',
          isError: true
        })
      )
      expect(conversation).toHaveLength(2)
      expect(state.blocks[0].status).toBe('pending')
      expect(state.blocks[0].tool_call?.response).toBe('')
    })

    it('prevents invocation when the dispatch identity was already claimed', async () => {
      const tools = [makeTool('mutate')]
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Change it' }]
      const target = vi.fn()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'mcp',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: 'mutate' }
        })
        target()
        return {
          content: 'changed',
          rawData: { toolCallId: request.id, content: 'changed', isError: false }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'mutate', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'mutate', arguments: '{}' }]

      await expect(
        settleToolBatch(
          state,
          conversation,
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: false })),
              commitToolOutcome: vi.fn()
            }
          },
          'openai'
        )
      ).rejects.toMatchObject({ code: 'duplicate_dispatch' })

      expect(target).not.toHaveBeenCalled()
      expect(conversation).toHaveLength(2)
    })

    it('skips damaged provider replay while continuing the tool round', async () => {
      const tools = [makeAgentTool('get_weather')]
      const toolService = createMockToolService({ get_weather: 'Sunny' })
      const conversation: any[] = [{ role: 'user', content: 'Hello' }]
      const providerReplayProjector = createDeepSeekResponsesReplayProjector({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com/v1'
      })
      if (!providerReplayProjector) throw new Error('Expected provider replay projector')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      state.blocks.push(
        {
          id: 'ws_1',
          type: 'search',
          status: 'success',
          timestamp: Date.now(),
          extra: { providerReplayJson: '{' }
        },
        {
          type: 'tool_call',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: { id: 'tc1', name: 'get_weather', params: '{}', response: '' }
        }
      )
      state.completedToolCalls = [{ id: 'tc1', name: 'get_weather', arguments: '{}' }]

      const result = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'deepseek-v4-flash',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        { providerReplayProjector },
        'deepseek'
      )

      expect(result.executed).toBe(1)
      expect(conversation.some((message) => message.provider_replay)).toBe(false)
      expect(warn).toHaveBeenCalledWith(
        '[DeepSeekResponsesAdapter] Ignoring invalid persisted Web Search replay:',
        expect.any(Error)
      )
      warn.mockRestore()
    })

    it('rejects an output-truncated batch atomically without tool side effects', async () => {
      const calls = [
        {
          id: 'tc-question',
          name: QUESTION_TOOL_NAME,
          arguments: '{"question":"',
          providerOptions: { openai: { itemId: 'item-question' } }
        },
        { id: 'tc-skill', name: 'skill_view', arguments: '{"skill":"draft"}' }
      ]
      const tools = calls.map((call) => makeAgentTool(call.name))
      const toolService = createMockToolService()
      const conversation: any[] = [{ role: 'user', content: 'Continue' }]
      const hooks = {
        autoGrantPermission: vi.fn(),
        reviewToolPermission: vi.fn(),
        activateSkill: vi.fn(),
        onPreToolUse: vi.fn(),
        onPostToolUse: vi.fn(),
        onPostToolUseFailure: vi.fn(),
        onPermissionRequest: vi.fn()
      }
      state.completedToolCalls = calls
      state.blocks.push(
        ...calls.map((call) => ({
          type: 'tool_call' as const,
          content: '',
          status: 'pending' as const,
          timestamp: Date.now(),
          tool_call: {
            id: call.id,
            name: call.name,
            params: call.arguments,
            response: ''
          },
          ...(call.providerOptions
            ? { extra: { providerOptionsJson: JSON.stringify(call.providerOptions) } }
            : {})
        }))
      )

      const result = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'auto_approve',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks,
        'openai',
        DEFAULT_INTERLEAVED_REASONING,
        undefined,
        { kind: 'reject', reason: 'output_truncated' }
      )

      expect(result).toMatchObject({
        type: 'completed',
        executed: 0,
        toolsChanged: false,
        executionState: {
          callOrder: ['tc-question', 'tc-skill'],
          invokedCallIds: [],
          committedResultCallIds: ['tc-question', 'tc-skill'],
          pendingInteractionCallIds: []
        }
      })
      expect(conversation).toEqual([
        { role: 'user', content: 'Continue' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-question',
              type: 'function',
              function: { name: QUESTION_TOOL_NAME, arguments: '{"question":"' },
              provider_options: { openai: { itemId: 'item-question' } }
            },
            {
              id: 'tc-skill',
              type: 'function',
              function: { name: 'skill_view', arguments: '{"skill":"draft"}' }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'tc-question', content: TRUNCATED_TOOL_CALL_ERROR },
        { role: 'tool', tool_call_id: 'tc-skill', content: TRUNCATED_TOOL_CALL_ERROR }
      ])
      expect(state.blocks).toEqual(
        calls.map((call) =>
          expect.objectContaining({
            type: 'tool_call',
            status: 'error',
            extra: expect.objectContaining({ toolCallSkippedReason: 'max_tokens' }),
            tool_call: expect.objectContaining({
              id: call.id,
              name: call.name,
              params: call.arguments,
              response: TRUNCATED_TOOL_CALL_ERROR
            })
          })
        )
      )
      expect(toolService.preCheckToolPermission).not.toHaveBeenCalled()
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(hooks.autoGrantPermission).not.toHaveBeenCalled()
      expect(hooks.reviewToolPermission).not.toHaveBeenCalled()
      expect(hooks.activateSkill).not.toHaveBeenCalled()
      expect(hooks.onPreToolUse).not.toHaveBeenCalled()
      expect(hooks.onPostToolUse).not.toHaveBeenCalled()
      expect(hooks.onPermissionRequest).not.toHaveBeenCalled()
      expect(hooks.onPostToolUseFailure.mock.calls.map(([tool]) => tool.callId)).toEqual([
        'tc-question',
        'tc-skill'
      ])
    })

    it('surfaces a terminal fitting error after rejecting a truncated batch', async () => {
      const toolService = createMockToolService()
      const hooks = {
        onPreToolUse: vi.fn(),
        onPostToolUseFailure: vi.fn()
      }
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'read', params: '{"path":"', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'read', arguments: '{"path":"' }]

      const result = await settleToolBatch(
        state,
        [],
        0,
        [makeAgentTool('read')],
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        1,
        1,
        hooks,
        'openai',
        DEFAULT_INTERLEAVED_REASONING,
        undefined,
        { kind: 'reject', reason: 'output_truncated' }
      )

      expect(result.terminalError).toContain('remaining context window is too small')
      expect(result.executionState).toEqual({
        callOrder: ['tc1'],
        invokedCallIds: [],
        committedResultCallIds: ['tc1'],
        pendingInteractionCallIds: []
      })
      expect(toolService.preCheckToolPermission).not.toHaveBeenCalled()
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(hooks.onPreToolUse).not.toHaveBeenCalled()
      expect(hooks.onPostToolUseFailure).toHaveBeenCalledTimes(1)
      expect(state.blocks[0]).toMatchObject({
        status: 'error',
        extra: { toolCallSkippedReason: 'max_tokens' },
        tool_call: { response: expect.stringContaining('remaining context window is too small') }
      })
    })

    it('settles a reused call id against the current provider round', async () => {
      const previousRoundBlock: AssistantMessageBlock = {
        type: 'tool_call',
        content: '',
        status: 'success',
        timestamp: Date.now(),
        tool_call: {
          id: 'reused-call-id',
          name: 'read',
          params: '{"path":"complete.txt"}',
          response: 'previous result',
          server_name: 'previous-server'
        }
      }
      state.blocks.push(previousRoundBlock)
      const prevBlockCount = state.blocks.length
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'reused-call-id',
          name: 'read',
          params: '{"path":"',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'reused-call-id', name: 'read', arguments: '{"path":"' }
      ]

      await settleToolBatch(
        state,
        [],
        prevBlockCount,
        [makeAgentTool('read')],
        createMockToolService(),
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        undefined,
        'openai',
        DEFAULT_INTERLEAVED_REASONING,
        undefined,
        { kind: 'reject', reason: 'output_truncated' }
      )

      expect(state.blocks[0]).toMatchObject({
        status: 'success',
        tool_call: {
          id: 'reused-call-id',
          params: '{"path":"complete.txt"}',
          response: 'previous result',
          server_name: 'previous-server'
        }
      })
      expect(state.blocks[0].extra).toBeUndefined()
      expect(state.blocks[1]).toMatchObject({
        status: 'error',
        extra: { toolCallSkippedReason: 'max_tokens' },
        tool_call: {
          id: 'reused-call-id',
          params: '{"path":"',
          response: TRUNCATED_TOOL_CALL_ERROR
        }
      })
    })

    it('rejects calls missing from the current session tool definitions', async () => {
      const tools = [makeAgentTool('read')]
      const toolService = createMockToolService()
      const conversation: any[] = []
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'exec', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'exec', arguments: '{}' }]

      const outcome = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(outcome.executed).toBe(1)
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(conversation.find((message: any) => message.role === 'tool')?.content).toBe(
        'Error: Tool is not available in the current session: exec'
      )
      expect(state.blocks.find((block) => block.type === 'tool_call')?.status).toBe('error')
    })

    it('publishes plan update events without inserting plan blocks into messages', async () => {
      const tools = [makeAgentTool('update_plan')]
      const snapshot = {
        sessionId: 's1',
        toolCallId: 'tc-plan',
        explanation: 'Repository inspected',
        plan: [
          { step: 'Inspect runtime', status: 'completed' as const },
          { step: 'Render checklist', status: 'in_progress' as const }
        ],
        revision: 1,
        updatedAt: '2026-05-18T00:00:00.000Z'
      }
      const toolService = {
        ...createMockToolService(),
        callTool: vi.fn(async (_request, options) => {
          options?.onProgress?.({
            kind: 'agent_plan',
            toolCallId: 'tc-plan',
            snapshot
          })
          return {
            content: '{}',
            rawData: {
              toolCallId: 'tc-plan',
              content: '{}',
              isError: false
            }
          }
        })
      } as unknown as ToolServicePort
      const conversation = [{ role: 'user' as const, content: 'Plan this' }]

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc-plan', name: 'update_plan', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc-plan', name: 'update_plan', arguments: '{}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        undefined,
        'openai'
      )

      const toolBlock = state.blocks.find((block) => block.type === 'tool_call')

      expect(state.blocks.some((block) => block.type === 'plan')).toBe(false)
      expect(toolBlock?.extra?.internalTool).toBe(true)
      expect(state.latestAgentPlanSnapshot).toMatchObject({
        sessionId: 's1',
        messageId: 'm1',
        toolCallId: 'tc-plan',
        plan: snapshot.plan,
        explanation: 'Repository inspected',
        revision: 1,
        updatedAt: snapshot.updatedAt
      })

      const planEventCall = publishDeepchatEventMock.mock.calls.find(
        ([eventName]) => eventName === 'chat.plan.updated'
      )
      expect(planEventCall?.[1]).toMatchObject({
        sessionId: 's1',
        messageId: 'm1',
        toolCallId: 'tc-plan',
        plan: snapshot.plan,
        explanation: 'Repository inspected',
        revision: 1,
        updatedAt: snapshot.updatedAt
      })
    })

    it('publishes successive plan revisions without creating plan blocks', async () => {
      const tools = [makeAgentTool('update_plan')]
      const snapshots = [
        {
          sessionId: 's1',
          toolCallId: 'tc-plan',
          plan: [{ step: 'Inspect runtime', status: 'in_progress' as const }],
          revision: 1,
          updatedAt: '2026-05-18T00:00:00.000Z'
        },
        {
          sessionId: 's1',
          toolCallId: 'tc-plan',
          plan: [
            { step: 'Inspect runtime', status: 'completed' as const },
            { step: 'Write tests', status: 'in_progress' as const }
          ],
          revision: 2,
          updatedAt: '2026-05-18T00:00:01.000Z'
        }
      ]
      const toolService = {
        ...createMockToolService(),
        callTool: vi.fn(async (_request, options) => {
          for (const snapshot of snapshots) {
            options?.onProgress?.({
              kind: 'agent_plan',
              toolCallId: 'tc-plan',
              snapshot
            })
          }
          return {
            content: '{}',
            rawData: {
              toolCallId: 'tc-plan',
              content: '{}',
              isError: false
            }
          }
        })
      } as unknown as ToolServicePort
      const conversation = [{ role: 'user' as const, content: 'Plan this' }]

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc-plan', name: 'update_plan', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc-plan', name: 'update_plan', arguments: '{}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        undefined,
        'openai'
      )

      expect(state.blocks.some((block) => block.type === 'plan')).toBe(false)
      expect(state.latestAgentPlanSnapshot).toMatchObject({
        plan: snapshots[1].plan,
        revision: 2,
        updatedAt: snapshots[1].updatedAt
      })
      const planEventCalls = publishDeepchatEventMock.mock.calls.filter(
        ([eventName]) => eventName === 'chat.plan.updated'
      )
      expect(planEventCalls).toHaveLength(2)
      expect(planEventCalls.map(([, payload]) => payload.revision)).toEqual([1, 2])
    })

    it('ignores agent plan progress from parallel read-only tool batches', async () => {
      const tools = [makeAgentTool('read', TOOL_EXECUTION.read.parallel)]
      const toolService = {
        ...createMockToolService(),
        callTool: vi.fn(async (request, options) => {
          options?.onProgress?.({
            kind: 'agent_plan',
            toolCallId: request.id,
            snapshot: {
              sessionId: 's1',
              toolCallId: request.id,
              plan: [{ step: 'Subagent-only progress', status: 'in_progress' }],
              revision: 1,
              updatedAt: '2026-05-18T00:00:00.000Z'
            }
          })
          return {
            content: '{}',
            rawData: {
              toolCallId: request.id,
              content: '{}',
              isError: false
            }
          }
        })
      } as unknown as ToolServicePort
      const conversation = [{ role: 'user' as const, content: 'Read in parallel' }]

      state.blocks.push(
        {
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: { id: 'tc-read-a', name: 'read', params: '{}', response: '' }
        },
        {
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: { id: 'tc-read-b', name: 'read', params: '{}', response: '' }
        }
      )
      state.completedToolCalls = [
        { id: 'tc-read-a', name: 'read', arguments: '{}' },
        { id: 'tc-read-b', name: 'read', arguments: '{}' }
      ]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        undefined,
        'openai'
      )

      expect(state.blocks.some((block) => block.type === 'plan')).toBe(false)
      expect(
        publishDeepchatEventMock.mock.calls.some(([eventName]) => eventName === 'chat.plan.updated')
      ).toBe(false)
    })

    it('runs explicitly parallel read batches without a tool-name allowlist', async () => {
      const tools = [makeAgentTool('catalog_read', TOOL_EXECUTION.read.parallel)]
      const started: string[] = []
      let releaseFirstRead: (() => void) | null = null
      let firstReadStarted: (() => void) | null = null
      const firstReadStartedPromise = new Promise<void>((resolve) => {
        firstReadStarted = resolve
      })
      const firstReadReleasePromise = new Promise<void>((resolve) => {
        releaseFirstRead = resolve
      })
      const toolService = {
        ...createMockToolService(),
        callTool: vi.fn(async (request) => {
          started.push(request.id)
          if (request.id === 'tc-read-a') {
            firstReadStarted?.()
            await firstReadReleasePromise
            return {
              content: 'read result a',
              rawData: {
                toolCallId: request.id,
                content: 'read result a',
                isError: false
              }
            }
          }

          return {
            content: 'read result b',
            rawData: {
              toolCallId: request.id,
              content: 'read result b',
              isError: false
            }
          }
        })
      } as unknown as ToolServicePort
      const conversation = [{ role: 'user' as const, content: 'Hello' }]

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-read-a',
          name: 'catalog_read',
          params: '{"path":"a.txt"}',
          response: ''
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-read-b',
          name: 'catalog_read',
          params: '{"path":"b.txt"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-read-a', name: 'catalog_read', arguments: '{"path":"a.txt"}' },
        { id: 'tc-read-b', name: 'catalog_read', arguments: '{"path":"b.txt"}' }
      ]

      const execution = settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )
      await firstReadStartedPromise
      await Promise.resolve()
      const secondReadStartedBeforeFirstResolved = started.includes('tc-read-b')
      releaseFirstRead?.()
      const executed = await execution

      expect(secondReadStartedBeforeFirstResolved).toBe(true)
      expect(executed.executed).toBe(2)
      expect(conversation.slice(-2)).toEqual([
        { role: 'tool', tool_call_id: 'tc-read-a', content: 'read result a' },
        { role: 'tool', tool_call_id: 'tc-read-b', content: 'read result b' }
      ])
    })

    it('isolates parallel pre-check failures to the affected tool call', async () => {
      const tools = [makeAgentTool('read', TOOL_EXECUTION.read.parallel)]
      const toolService = {
        ...createMockToolService(),
        preCheckToolPermission: vi.fn(async (request) => {
          if (request.id === 'tc-read-a') {
            throw new Error('pre-check failed')
          }
          return null
        }),
        callTool: vi.fn(async (request) => ({
          content: `result for ${request.id}`,
          rawData: {
            toolCallId: request.id,
            content: `result for ${request.id}`,
            isError: false
          }
        }))
      } as unknown as ToolServicePort

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc-read-a', name: 'read', params: '{"path":"a.txt"}', response: '' }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc-read-b', name: 'read', params: '{"path":"b.txt"}', response: '' }
      })
      state.completedToolCalls = [
        { id: 'tc-read-a', name: 'read', arguments: '{"path":"a.txt"}' },
        { id: 'tc-read-b', name: 'read', arguments: '{"path":"b.txt"}' }
      ]

      const executed = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(executed.executed).toBe(2)
      expect(toolService.callTool).toHaveBeenCalledTimes(1)
      expect(toolService.callTool).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tc-read-b' }),
        expect.any(Object)
      )
      expect(state.blocks[0].tool_call?.response).toBe('Error: pre-check failed')
      expect(state.blocks[0].status).toBe('error')
      expect(state.blocks[1].tool_call?.response).toBe('result for tc-read-b')
      expect(state.blocks[1].status).toBe('success')
    })

    it('keeps mixed read/write Agent tool batches serialized', async () => {
      const tools = [
        makeAgentTool('write'),
        makeAgentTool('read', TOOL_EXECUTION.read.parallel)
      ]
      const started: string[] = []
      let releaseWrite: (() => void) | null = null
      let writeStarted: (() => void) | null = null
      const writeStartedPromise = new Promise<void>((resolve) => {
        writeStarted = resolve
      })
      const writeReleasePromise = new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
      const toolService = {
        ...createMockToolService(),
        callTool: vi.fn(async (request) => {
          const name = request.function.name
          started.push(name)
          if (name === 'write') {
            writeStarted?.()
            await writeReleasePromise
          }

          return {
            content: `${name} result`,
            rawData: {
              toolCallId: request.id,
              content: `${name} result`,
              isError: false
            }
          }
        })
      } as unknown as ToolServicePort

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc-write', name: 'write', params: '{}', response: '' }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc-read', name: 'read', params: '{}', response: '' }
      })
      state.completedToolCalls = [
        { id: 'tc-write', name: 'write', arguments: '{}' },
        { id: 'tc-read', name: 'read', arguments: '{}' }
      ]

      const execution = settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )
      await writeStartedPromise
      await Promise.resolve()
      const readStartedBeforeWriteResolved = started.includes('read')
      releaseWrite?.()
      await execution

      expect(readStartedBeforeWriteResolved).toBe(false)
      expect(started).toEqual(['write', 'read'])
    })

    it('persists final-only subagent tool payloads', async () => {
      const tools = [makeTool('subagent_orchestrator')]
      const toolService = createMockToolService()
      const commitDispatch = vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true }))
      const commitToolOutcome = vi.fn(() => {
        const toolBlock = state.blocks.find(
          (block) => block.type === 'tool_call' && block.tool_call?.id === 'tc1'
        )
        expect(toolBlock?.extra?.subagentFinal).toBeUndefined()
        return { sessionId: 's1', entryId: 2, created: true }
      })
      const subagentFinal = JSON.stringify({
        runId: 'run-1',
        mode: 'parallel',
        tasks: [
          {
            slotId: 'worker-1',
            displayName: 'Worker 1',
            title: 'Inspect repo',
            status: 'completed'
          }
        ]
      })

      ;(toolService.callTool as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (request, options) => {
          options?.commitDispatch?.({
            toolName: request.function.name,
            toolSource: 'mcp',
            normalizedArguments: {},
            target: { serverName: 'test-server', originalName: request.function.name }
          })
          return {
            content: [{ type: 'text', text: 'Final summary' }],
            rawData: {
              toolCallId: 'tc1',
              content: [{ type: 'text', text: 'Final summary' }],
              isError: false,
              toolResult: { subagentFinal }
            }
          }
        }
      )

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'subagent_orchestrator', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'subagent_orchestrator', arguments: '{}' }]

      await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        { executionJournal: { commitDispatch, commitToolOutcome } }
      )

      const toolBlock = state.blocks.find(
        (block) => block.type === 'tool_call' && block.tool_call?.id === 'tc1'
      )
      expect(toolBlock?.tool_call?.response).toBe('Final summary')
      expect(toolBlock?.status).toBe('success')
      expect(toolBlock?.extra?.subagentFinal).toBe(subagentFinal)

      const persistedBlocks = (
        io.messageStore.updateAssistantContent as ReturnType<typeof vi.fn>
      ).mock.calls.at(-1)?.[1] as StreamState['blocks'] | undefined
      const persistedToolBlock = persistedBlocks?.find(
        (block) => block.type === 'tool_call' && block.tool_call?.id === 'tc1'
      )
      expect(persistedToolBlock?.extra?.subagentFinal).toBe(subagentFinal)
      expect(commitToolOutcome).toHaveBeenCalledOnce()
    })

    it('finalizes trailing narrative blocks before plain tool results run', async () => {
      const tools = [makeTool('get_weather')]
      const toolService = createMockToolService()
      const conversation = [{ role: 'user' as const, content: 'Hello' }]
      const trailingText = 'Working on it.'

      accumulate(state, {
        type: 'tool_call_start',
        tool_call_id: 'tc1',
        tool_call_name: 'get_weather'
      })
      accumulate(state, {
        type: 'tool_call_end',
        tool_call_id: 'tc1',
        tool_call_arguments_complete: '{}'
      })
      accumulate(state, {
        type: 'text',
        content: trailingText
      })

      const trailingBlockBeforeExecution = state.blocks.at(-1)
      expect(trailingBlockBeforeExecution?.type).toBe('content')
      expect(trailingBlockBeforeExecution?.status).toBe('pending')

      ;(toolService.callTool as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        const persistedBlocks = (
          io.messageStore.updateAssistantContent as ReturnType<typeof vi.fn>
        ).mock.calls.at(-1)?.[1] as StreamState['blocks'] | undefined
        const trailingBlockDuringExecution = state.blocks.at(-1)
        expect(io.messageStore.updateAssistantContent).toHaveBeenCalled()
        expect(persistedBlocks?.at(-1)?.type).toBe('content')
        expect(persistedBlocks?.at(-1)?.content).toBe(trailingText)
        expect(persistedBlocks?.at(-1)?.status).toBe('success')
        expect(trailingBlockDuringExecution?.type).toBe('content')
        expect(trailingBlockDuringExecution?.content).toBe(trailingText)
        expect(trailingBlockDuringExecution?.status).toBe('success')

        return {
          content: 'Sunny, 72F',
          rawData: {
            toolCallId: 'tc1',
            content: 'Sunny, 72F',
            isError: false
          }
        }
      })

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      const trailingBlockAfterExecution = state.blocks
        .filter((block) => block.type === 'content')
        .at(-1)
      expect(trailingBlockAfterExecution?.content).toBe(trailingText)
      expect(trailingBlockAfterExecution?.status).toBe('success')
    })

    it('pauses with a skill draft confirmation question after successful draft creation', async () => {
      const tools = [makeTool('skill_manage')]
      const toolService = {
        ...createMockToolService(),
        callTool: vi.fn().mockResolvedValue({
          content:
            '{"success":true,"action":"create","draftId":"draft-1","skillName":"draft-skill"}',
          rawData: {
            toolCallId: 'tc1',
            content:
              '{"success":true,"action":"create","draftId":"draft-1","skillName":"draft-skill"}',
            isError: false,
            toolResult: {
              toolName: 'skill_manage',
              success: true,
              action: 'create',
              draftId: 'draft-1',
              skillName: 'draft-skill',
              skillDraft: {
                status: 'created',
                draftId: 'draft-1',
                skillName: 'draft-skill'
              }
            }
          }
        })
      } as unknown as ToolServicePort
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_manage',
          params: '{"action":"create"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_manage', arguments: '{"action":"create"}' }
      ]

      const result = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(result.type).toBe('paused')
      expect(result.type === 'paused' ? result.interactions : []).toHaveLength(1)
      expect(result.type === 'paused' ? result.interactions[0] : null).toEqual(
        expect.objectContaining({
          type: 'question',
          messageId: 'm1',
          toolCallId: 'tc1',
          toolName: 'skill_manage'
        })
      )
      expect(state.blocks[0].status).toBe('success')
      expect(state.blocks[1]).toEqual(
        expect.objectContaining({
          type: 'action',
          action_type: 'question_request',
          status: 'pending',
          tool_call: expect.objectContaining({ id: 'tc1', name: 'skill_manage' }),
          extra: expect.objectContaining({
            needsUserAction: true,
            questionHeader: 'chat.skillDraft.confirmationTitle',
            questionText: 'chat.skillDraft.confirmationQuestion',
            questionCustom: false,
            skillDraftAction: 'confirm',
            skillDraftId: 'draft-1',
            skillDraftName: 'draft-skill',
            skillDraftStatus: 'pending'
          })
        })
      )
      expect(
        (state.blocks[1].extra?.questionOptions as any[]).map((option) => option.label)
      ).toEqual([
        'chat.skillDraft.actions.view',
        'chat.skillDraft.actions.install',
        'chat.skillDraft.actions.discard'
      ])
    })

    it('returns all interaction origins in persisted action order with execution state', async () => {
      const toolService = createMockToolService() as ToolServicePort & {
        preCheckToolPermission: ReturnType<typeof vi.fn>
      }
      toolService.preCheckToolPermission = vi.fn(async (request) =>
        request.function.name === 'precheck_tool'
          ? {
              needsPermission: true,
              permissionType: 'write' as const,
              description: 'Need pre-check permission'
            }
          : null
      )
      toolService.callTool = vi.fn(async (request) => {
        if (request.function.name === 'skill_manage') {
          return {
            content: 'draft created',
            rawData: {
              content: 'draft created',
              isError: false,
              toolResult: {
                skillDraft: {
                  status: 'created',
                  draftId: 'draft-1',
                  skillName: 'draft-skill'
                }
              }
            }
          }
        }
        if (request.function.name === 'post_permission_tool') {
          return {
            content: 'permission required',
            rawData: {
              content: 'permission required',
              isError: true,
              requiresPermission: true,
              permissionRequest: {
                permissionType: 'write',
                description: 'Need post-call permission'
              }
            }
          }
        }
        throw new Error(`Unexpected tool execution: ${request.function.name}`)
      })

      const calls = [
        { id: 'tc-skill', name: 'skill_manage', arguments: '{"action":"create"}' },
        {
          id: 'tc-question',
          name: QUESTION_TOOL_NAME,
          arguments: '{"question":"Continue?","options":[{"label":"Yes"}]}'
        },
        { id: 'tc-post', name: 'post_permission_tool', arguments: '{}' },
        { id: 'tc-pre', name: 'precheck_tool', arguments: '{}' }
      ]
      state.completedToolCalls = calls
      state.blocks.push(
        ...calls.map((call) => ({
          type: 'tool_call' as const,
          content: '',
          status: 'pending' as const,
          timestamp: Date.now(),
          tool_call: {
            id: call.id,
            name: call.name,
            params: call.arguments,
            response: ''
          }
        }))
      )

      const result = await settleToolBatch(
        state,
        [],
        0,
        calls.map((call) => makeTool(call.name)),
        toolService,
        'gpt-4',
        io,
        'default',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(result.type).toBe('paused')
      if (result.type !== 'paused') throw new Error('Expected paused tool batch')
      expect(
        result.interactions.map(({ origin, order, toolCallId }) => ({
          origin,
          order,
          toolCallId
        }))
      ).toEqual([
        { origin: 'question', order: 0, toolCallId: 'tc-question' },
        { origin: 'post-call-permission', order: 1, toolCallId: 'tc-post' },
        { origin: 'pre-check-permission', order: 2, toolCallId: 'tc-pre' },
        { origin: 'skill-draft-confirmation', order: 3, toolCallId: 'tc-skill' }
      ])
      expect(result.executionState).toEqual({
        callOrder: ['tc-skill', 'tc-question', 'tc-post', 'tc-pre'],
        invokedCallIds: ['tc-skill', 'tc-post'],
        committedResultCallIds: ['tc-skill'],
        pendingInteractionCallIds: ['tc-question', 'tc-post', 'tc-pre', 'tc-skill']
      })
      expect(
        state.blocks
          .filter((block) => block.type === 'action' && block.status === 'pending')
          .map((block) => block.tool_call?.id)
      ).toEqual(['tc-question', 'tc-post', 'tc-pre', 'tc-skill'])
      expect(
        state.blocks.filter(
          (block) =>
            block.type !== 'action' &&
            (block.status === 'pending' || block.status === 'loading')
        )
      ).toEqual([])
      expect(toolService.callTool).toHaveBeenCalledTimes(2)
    })

    it('does not emit PreToolUse for question interactions that pause execution', async () => {
      const hooks = {
        onPreToolUse: vi.fn(),
        onPermissionRequest: vi.fn(),
        onPostToolUse: vi.fn(),
        onPostToolUseFailure: vi.fn()
      }
      const toolService = createMockToolService()
      const rendererFlushHandle = {
        flush: vi.fn(),
        schedule: vi.fn(),
        rescheduleRenderer: vi.fn()
      }

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: QUESTION_TOOL_NAME, params: '', response: '' }
      })
      state.completedToolCalls = [
        {
          id: 'tc1',
          name: QUESTION_TOOL_NAME,
          arguments: JSON.stringify({
            question: 'Continue?',
            options: [{ label: 'Yes' }]
          })
        }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        [makeTool(QUESTION_TOOL_NAME)],
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks,
        undefined,
        DEFAULT_INTERLEAVED_REASONING,
        rendererFlushHandle
      )

      expect(result.type).toBe('paused')
      expect(result.type === 'paused' ? result.interactions : []).toHaveLength(1)
      expect(hooks.onPreToolUse).not.toHaveBeenCalled()
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(rendererFlushHandle.rescheduleRenderer).toHaveBeenCalledTimes(1)
      expect(rendererFlushHandle.schedule).toHaveBeenCalled()
      expect(rendererFlushHandle.rescheduleRenderer.mock.invocationCallOrder[0]).toBeLessThan(
        rendererFlushHandle.schedule.mock.invocationCallOrder.at(-1)!
      )
    })

    it('does not emit PreToolUse before a pre-checked permission pause', async () => {
      const hooks = {
        onPreToolUse: vi.fn(),
        onPermissionRequest: vi.fn(),
        onPostToolUse: vi.fn(),
        onPostToolUseFailure: vi.fn()
      }
      const toolService = createMockToolService() as ToolServicePort & {
        preCheckToolPermission: ReturnType<typeof vi.fn>
      }
      const rendererFlushHandle = {
        flush: vi.fn(),
        schedule: vi.fn(),
        rescheduleRenderer: vi.fn()
      }
      toolService.preCheckToolPermission = vi.fn().mockResolvedValue({
        needsPermission: true,
        permissionType: 'write',
        description: 'Need permission'
      })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'write_file', params: '{"path":"a.txt"}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'write_file', arguments: '{"path":"a.txt"}' }]

      const result = await settleToolBatch(
        state,
        [],
        0,
        [makeTool('write_file')],
        toolService,
        'gpt-4',
        io,
        'default',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks,
        undefined,
        DEFAULT_INTERLEAVED_REASONING,
        rendererFlushHandle
      )

      expect(result.type).toBe('paused')
      expect(result.type === 'paused' ? result.interactions : []).toHaveLength(1)
      expect(hooks.onPreToolUse).not.toHaveBeenCalled()
      expect(hooks.onPermissionRequest).toHaveBeenCalledTimes(1)
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(rendererFlushHandle.rescheduleRenderer).toHaveBeenCalledTimes(1)
      expect(rendererFlushHandle.schedule).toHaveBeenCalled()
      expect(rendererFlushHandle.rescheduleRenderer.mock.invocationCallOrder[0]).toBeLessThan(
        rendererFlushHandle.schedule.mock.invocationCallOrder.at(-1)!
      )
    })

    it('auto-approves reviewed Agent tool calls with full-access capability reach', async () => {
      const hooks = {
        reviewToolPermission: vi.fn().mockResolvedValue({
          decision: 'auto_allow',
          riskLevel: 'low'
        })
      }
      const tools = [makeAgentTool('read')]
      const toolService = createMockToolService({ read: 'file content' })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-read',
          name: 'read',
          params: '{"path":"/tmp/outside.txt"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-read', name: 'read', arguments: '{"path":"/tmp/outside.txt"}' }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'auto_approve',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks
      )

      expect(result.type).toBe('completed')
      expect(hooks.reviewToolPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 's1',
          messageId: 'm1',
          toolCallId: 'tc-read',
          toolName: 'read',
          toolArgs: '{"path":"/tmp/outside.txt"}',
          toolSource: 'agent',
          reason: 'tool_call',
          permission: expect.objectContaining({
            permissionType: 'read',
            serverName: 'agent-filesystem',
            paths: ['/tmp/outside.txt'],
            rememberable: false
          })
        })
      )
      expect(toolService.callTool).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tc-read' }),
        expect.objectContaining({ permissionMode: 'full_access' })
      )
      expect(result.executed).toBe(1)
    })

    it('does not stage success when full_access tool still requires permission after grant', async () => {
      const tools = [makeAgentTool('write')]
      const toolService = {
        ...createMockToolService(),
        callTool: vi.fn(async () => ({
          content: 'permission required',
          rawData: {
            content: 'permission required',
            isError: true,
            requiresPermission: true,
            permissionRequest: {
              permissionType: 'write',
              description: 'Need write permission',
              paths: ['/tmp/secret.txt']
            }
          }
        }))
      } as unknown as ToolServicePort
      const autoGrantPermission = vi.fn().mockResolvedValue(undefined)

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-write',
          name: 'write',
          params: '{"path":"/tmp/secret.txt"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-write', name: 'write', arguments: '{"path":"/tmp/secret.txt"}' }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        { autoGrantPermission }
      )

      expect(result.type).toBe('paused')
      if (result.type !== 'paused') throw new Error('Expected paused tool batch')
      expect(autoGrantPermission).toHaveBeenCalled()
      expect(toolService.callTool).toHaveBeenCalledTimes(2)
      expect(result.interactions).toEqual([
        expect.objectContaining({
          origin: 'post-call-permission',
          toolCallId: 'tc-write'
        })
      ])
      // Permission payload must not be committed as a successful tool response body.
      expect(state.blocks[0].tool_call?.response ?? '').not.toContain('permission required')
      expect(result.executionState.committedResultCallIds).not.toContain('tc-write')
    })

    it('auto-grants repeated Code Mode command permissions in one outer call', async () => {
      const codeTool = {
        ...makeAgentTool('run_code'),
        server: {
          name: CODE_MODE_TOOL_SERVER_NAME,
          icons: 'icon',
          description: 'Code Mode runtime'
        }
      }
      const permissionResponse = (command: string, commandSignature: string) => ({
        content: 'permission required',
        rawData: {
          toolCallId: 'tc-code',
          content: 'permission required',
          requiresPermission: true,
          permissionRequest: {
            toolName: 'exec',
            serverName: 'agent-filesystem',
            permissionType: 'command' as const,
            description: 'Need command permission',
            command,
            commandSignature,
            shellProfile: 'posix' as const
          }
        }
      })
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool)
        .mockResolvedValueOnce(permissionResponse('git log -1', 'posix:git log'))
        .mockImplementationOnce(async (request, options) => {
          expect(options?.oneShotCommandGrantId).toBe('grant-1')
          options?.commitDispatch?.({
            toolName: 'exec',
            toolSource: 'agent',
            normalizedArguments: { command: 'git log -1' },
            target: { serverName: 'agent-filesystem', originalName: 'exec' }
          })
          return permissionResponse('git log -1 --stat', 'posix:git log')
        })
        .mockImplementationOnce(async (_request, options) => {
          expect(options?.oneShotCommandGrantId).toBe('grant-2')
          return {
            content: 'done',
            rawData: { toolCallId: 'tc-code', content: 'done', isError: false }
          }
        })
      let grantSequence = 0
      const autoGrantPermission = vi.fn(
        async (permission: NonNullable<PendingToolInteraction['permission']>) => ({
          kind: 'command' as const,
          signature: permission.commandSignature!,
          oneShotGrantId: `grant-${++grantSequence}`
        })
      )
      const revokeOneShotCommandPermission = vi.fn()
      const commitDispatch = vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true }))
      const commitToolOutcome = vi.fn(() => ({ sessionId: 's1', entryId: 2, created: true }))
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-code',
          name: 'run_code',
          params: '{"code":"...","description":"Inspect git"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-code',
          name: 'run_code',
          arguments: '{"code":"...","description":"Inspect git"}'
        }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        [codeTool],
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          autoGrantPermission,
          revokeOneShotCommandPermission,
          executionJournal: { commitDispatch, commitToolOutcome }
        }
      )

      expect(result.type).toBe('completed')
      expect(toolService.callTool).toHaveBeenCalledTimes(3)
      expect(autoGrantPermission).toHaveBeenCalledTimes(2)
      expect(revokeOneShotCommandPermission).toHaveBeenCalledTimes(2)
      expect(commitDispatch).toHaveBeenCalledOnce()
      expect(commitToolOutcome).toHaveBeenCalledOnce()
      expect(state.blocks[0]).toMatchObject({
        status: 'success',
        tool_call: { response: 'done' }
      })
    })

    it('does not reuse a permission response when the approved dispatch is cancelled', async () => {
      const abortController = new AbortController()
      const abortIo = createIo({ abortSignal: abortController.signal })
      const abortError = new Error('approved dispatch cancelled')
      abortError.name = 'AbortError'
      const finalizePermission = vi.fn()
      const revokePermission = vi.fn()
      const permissionLease = { kind: 'file' as const, leaseId: 'file-lease-1' }
      const tools = [makeAgentTool('write')]
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool)
        .mockResolvedValueOnce({
          content: 'permission required',
          rawData: {
            toolCallId: 'tc-write',
            content: 'permission required',
            isError: true,
            requiresPermission: true,
            permissionRequest: {
              permissionType: 'write',
              description: 'Need write permission',
              paths: ['/tmp/secret.txt']
            }
          }
        })
        .mockImplementationOnce(async (request, options) => {
          options?.commitDispatch?.({
            toolName: request.function.name,
            toolSource: 'agent',
            normalizedArguments: { path: '/tmp/secret.txt', content: 'secret' },
            target: { serverName: 'agent-filesystem', originalName: 'write' }
          })
          abortController.abort(abortError)
          throw abortError
        })
      const commitToolOutcome = vi.fn(() => ({
        sessionId: 's1',
        entryId: 2,
        created: true
      }))
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-write',
          name: 'write',
          params: '{"path":"/tmp/secret.txt","content":"secret"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-write',
          name: 'write',
          arguments: '{"path":"/tmp/secret.txt","content":"secret"}'
        }
      ]

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          abortIo,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            autoGrantPermission: vi.fn().mockResolvedValue({
              kind: 'granted',
              lease: {
                capability: permissionLease,
                finalize: finalizePermission,
                revoke: revokePermission
              }
            }),
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
              commitToolOutcome
            }
          }
        )
      ).rejects.toBe(abortError)

      expect(finalizePermission).toHaveBeenCalledOnce()
      expect(revokePermission).not.toHaveBeenCalled()
      expect(vi.mocked(toolService.callTool).mock.calls[1]?.[1]).toMatchObject({ permissionLease })
      expect(commitToolOutcome).not.toHaveBeenCalled()
      expect(state.blocks[0]).toMatchObject({
        status: 'pending',
        tool_call: { response: '' }
      })
    })

    it('revokes a pre-checked permission lease when Tool Surface authority changes before T1', async () => {
      const { tools, binding } = createDispatchToolSurfaceBinding([
        makeAgentTool('write_file', TOOL_EXECUTION.write)
      ])
      const toolService = createMockToolService({ write_file: 'written' }) as ToolServicePort & {
        preCheckToolPermission: ReturnType<typeof vi.fn>
        assertToolSurfaceAuthority: ReturnType<typeof vi.fn>
      }
      toolService.preCheckToolPermission.mockResolvedValue({
        needsPermission: true,
        permissionType: 'write',
        description: 'Need write permission',
        toolName: 'write_file',
        serverName: 'agent-filesystem',
        paths: ['/tmp/outside.txt'],
        rememberable: false
      })
      let authorityRevoked = false
      toolService.assertToolSurfaceAuthority.mockImplementation(() => {
        if (authorityRevoked) throw new Error('Tool Surface authority was revoked')
      })
      const finalizePermission = vi.fn()
      const revokePermission = vi.fn()
      const autoGrantPermission = vi.fn(async () => {
        authorityRevoked = true
        return {
          kind: 'granted' as const,
          lease: { finalize: finalizePermission, revoke: revokePermission }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-write',
          name: 'write_file',
          params: '{"path":"/tmp/outside.txt","content":"hello"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-write',
          name: 'write_file',
          arguments: '{"path":"/tmp/outside.txt","content":"hello"}'
        }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        { autoGrantPermission, toolSurface: binding }
      )

      expect(result.type).toBe('completed')
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(finalizePermission).not.toHaveBeenCalled()
      expect(revokePermission).toHaveBeenCalledOnce()
    })

    it('revokes a pre-checked permission lease when T1 persistence fails', async () => {
      const tools = [makeAgentTool('write_file')]
      const toolService = createMockToolService() as ToolServicePort & {
        preCheckToolPermission: ReturnType<typeof vi.fn>
      }
      toolService.preCheckToolPermission.mockResolvedValue({
        needsPermission: true,
        permissionType: 'write',
        description: 'Need write permission',
        toolName: 'write_file',
        serverName: 'agent-filesystem',
        paths: ['/tmp/outside.txt'],
        rememberable: false
      })
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: { path: '/tmp/outside.txt', content: 'hello' },
          target: { serverName: 'agent-filesystem', originalName: 'write_file' }
        })
        throw new Error('unreachable')
      })
      const finalizePermission = vi.fn()
      const revokePermission = vi.fn()
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-write',
          name: 'write_file',
          params: '{"path":"/tmp/outside.txt","content":"hello"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-write',
          name: 'write_file',
          arguments: '{"path":"/tmp/outside.txt","content":"hello"}'
        }
      ]

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            autoGrantPermission: vi.fn().mockResolvedValue({
              kind: 'granted',
              lease: { finalize: finalizePermission, revoke: revokePermission }
            }),
            executionJournal: {
              commitDispatch: vi.fn(() => {
                throw new ExecutionJournalError('T1 unavailable', 'persistence_failed')
              }),
              commitToolOutcome: vi.fn()
            }
          }
        )
      ).rejects.toThrow('T1 unavailable')

      expect(finalizePermission).not.toHaveBeenCalled()
      expect(revokePermission).toHaveBeenCalledOnce()
    })

    it.each([
      ['serial', TOOL_EXECUTION.write],
      ['parallel', TOOL_EXECUTION.read.parallel]
    ] as const)(
      'revokes a pre-checked command grant when %s execution is cancelled before dispatch',
      async (_mode, executionContract) => {
        const abortController = new AbortController()
        const abortIo = createIo({ abortSignal: abortController.signal })
        const tools = [makeAgentTool('exec', executionContract)]
        const toolService = createMockToolService() as ToolServicePort & {
          preCheckToolPermission: ReturnType<typeof vi.fn>
        }
        toolService.preCheckToolPermission.mockResolvedValue({
          needsPermission: true,
          permissionType: 'command',
          description: 'Need command permission',
          toolName: 'exec',
          serverName: 'agent-filesystem',
          command: 'npm install',
          commandSignature: 'posix:npm install',
          shellProfile: 'posix'
        })
        const revocationError = new Error('permission store unavailable')
        const revokeOneShotCommandPermission = vi.fn(() => {
          throw revocationError
        })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const autoGrantPermission = vi.fn(async () => {
          abortController.abort()
          return {
            kind: 'command' as const,
            signature: 'posix:npm install',
            oneShotGrantId: 'command-grant-cancelled'
          }
        })
        state.blocks.push({
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: {
            id: 'tc-exec',
            name: 'exec',
            params: '{"command":"npm install"}',
            response: ''
          }
        })
        state.completedToolCalls = [
          { id: 'tc-exec', name: 'exec', arguments: '{"command":"npm install"}' }
        ]

        try {
          await expect(
            settleToolBatch(
              state,
              [],
              0,
              tools,
              toolService,
              'gpt-4',
              abortIo,
              'full_access',
              new ToolOutputGuard(),
              32000,
              1024,
              { autoGrantPermission, revokeOneShotCommandPermission }
            )
          ).rejects.toMatchObject({ name: 'AbortError' })

          expect(toolService.callTool).not.toHaveBeenCalled()
          expect(revokeOneShotCommandPermission).toHaveBeenCalledWith(
            'posix:npm install',
            'command-grant-cancelled'
          )
          expect(warn).toHaveBeenCalledOnce()
        } finally {
          warn.mockRestore()
        }
      }
    )

    it('preserves a successful command result when lease cleanup fails', async () => {
      const tools = [makeAgentTool('exec')]
      const toolService = createMockToolService({ exec: 'done' }) as ToolServicePort & {
        preCheckToolPermission: ReturnType<typeof vi.fn>
      }
      toolService.preCheckToolPermission.mockResolvedValue({
        needsPermission: true,
        permissionType: 'command',
        description: 'Need command permission',
        toolName: 'exec',
        serverName: 'agent-filesystem',
        command: 'npm install',
        commandSignature: 'posix:npm install',
        shellProfile: 'posix'
      })
      const autoGrantPermission = vi.fn().mockResolvedValue({
        kind: 'command',
        signature: 'posix:npm install',
        oneShotGrantId: 'command-grant-exec'
      })
      const revocationError = new Error('permission store unavailable')
      const revokeOneShotCommandPermission = vi.fn(() => {
        throw revocationError
      })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-exec',
          name: 'exec',
          params: '{"command":"npm install"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-exec', name: 'exec', arguments: '{"command":"npm install"}' }
      ]

      try {
        const result = await settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          { autoGrantPermission, revokeOneShotCommandPermission }
        )

        expect(toolService.callTool).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'tc-exec' }),
          expect.objectContaining({ oneShotCommandGrantId: 'command-grant-exec' })
        )
        expect(revokeOneShotCommandPermission).toHaveBeenCalledWith(
          'posix:npm install',
          'command-grant-exec'
        )
        expect(result.type).toBe('completed')
        expect(state.blocks[0]).toMatchObject({
          status: 'success',
          tool_call: { response: 'done' }
        })
        expect(warn).toHaveBeenCalledOnce()
      } finally {
        warn.mockRestore()
      }
    })

    it.each([
      [
        'a non-command grant',
        { kind: 'granted' as const },
        'Command approval did not return a one-shot grant lease.',
        null
      ],
      [
        'a lease for another signature',
        {
          kind: 'command' as const,
          signature: 'git-bash:npm install',
          oneShotGrantId: 'wrong-command-grant'
        },
        'Command approval returned a lease for another signature.',
        ['git-bash:npm install', 'wrong-command-grant']
      ]
    ] as const)(
      'fails closed when command approval returns %s',
      async (_description, grant, expectedError, expectedRevocation) => {
        const tools = [makeAgentTool('exec')]
        const toolService = createMockToolService() as ToolServicePort & {
          preCheckToolPermission: ReturnType<typeof vi.fn>
        }
        toolService.preCheckToolPermission.mockResolvedValue({
          needsPermission: true,
          permissionType: 'command',
          description: 'Need command permission',
          toolName: 'exec',
          serverName: 'agent-filesystem',
          command: 'npm install',
          commandSignature: 'posix:npm install',
          shellProfile: 'posix'
        })
        const autoGrantPermission = vi.fn().mockResolvedValue(grant)
        const revokeOneShotCommandPermission = vi.fn()
        state.blocks.push({
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: {
            id: 'tc-exec',
            name: 'exec',
            params: '{"command":"npm install"}',
            response: ''
          }
        })
        state.completedToolCalls = [
          { id: 'tc-exec', name: 'exec', arguments: '{"command":"npm install"}' }
        ]

        const result = await settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          { autoGrantPermission, revokeOneShotCommandPermission }
        )

        expect(result.type).toBe('completed')
        expect(result.executionState.invokedCallIds).toEqual([])
        expect(state.blocks[0]).toMatchObject({
          status: 'error',
          tool_call: { response: `Error: ${expectedError}` }
        })
        expect(toolService.callTool).not.toHaveBeenCalled()
        if (expectedRevocation) {
          expect(revokeOneShotCommandPermission).toHaveBeenCalledWith(...expectedRevocation)
        } else {
          expect(revokeOneShotCommandPermission).not.toHaveBeenCalled()
        }
      }
    )

    it('revokes a command lease returned for a non-command approval', async () => {
      const tools = [makeAgentTool('write')]
      const toolService = createMockToolService() as ToolServicePort & {
        preCheckToolPermission: ReturnType<typeof vi.fn>
      }
      toolService.preCheckToolPermission.mockResolvedValue({
        needsPermission: true,
        permissionType: 'write',
        description: 'Need write permission',
        toolName: 'write',
        serverName: 'agent-filesystem',
        paths: ['/tmp/secret.txt']
      })
      const autoGrantPermission = vi.fn().mockResolvedValue({
        kind: 'command',
        signature: 'posix:npm install',
        oneShotGrantId: 'unexpected-command-grant'
      })
      const revokeOneShotCommandPermission = vi.fn()
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-write',
          name: 'write',
          params: '{"path":"/tmp/secret.txt"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-write', name: 'write', arguments: '{"path":"/tmp/secret.txt"}' }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        { autoGrantPermission, revokeOneShotCommandPermission }
      )

      expect(result.type).toBe('completed')
      expect(result.executionState.invokedCallIds).toEqual([])
      expect(state.blocks[0]).toMatchObject({
        status: 'error',
        tool_call: {
          response: 'Error: Non-command approval returned a command grant lease.'
        }
      })
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(revokeOneShotCommandPermission).toHaveBeenCalledWith(
        'posix:npm install',
        'unexpected-command-grant'
      )
    })

    it('pauses post-call user confirmation without attempting an automatic grant', async () => {
      const tools = [makeAgentTool('deepchat_subagents')]
      const toolService = {
        ...createMockToolService(),
        callTool: vi.fn(async () => ({
          content: 'confirmation required',
          rawData: {
            content: 'confirmation required',
            requiresPermission: true,
            permissionRequest: {
              permissionType: 'write',
              description: 'Start this Subagent task?',
              requestId: 'approval-1',
              requiresUserConfirmation: true
            }
          }
        }))
      } as unknown as ToolServicePort
      const autoGrantPermission = vi.fn().mockResolvedValue(undefined)

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-spawn',
          name: 'deepchat_subagents',
          params: '{"operation":"spawn"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-spawn', name: 'deepchat_subagents', arguments: '{"operation":"spawn"}' }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        { autoGrantPermission }
      )

      expect(result.type).toBe('paused')
      expect(result.type === 'paused' ? result.interactions[0]?.permission : null).toMatchObject({
        requestId: 'approval-1',
        requiresUserConfirmation: true
      })
      expect(autoGrantPermission).not.toHaveBeenCalled()
      expect(toolService.callTool).toHaveBeenCalledTimes(1)
    })

    it('reviews command-runner Agent tool calls even without path args', async () => {
      const hooks = {
        onPermissionRequest: vi.fn(),
        reviewToolPermission: vi.fn().mockResolvedValue({
          decision: 'ask_user',
          riskLevel: 'high'
        })
      }
      const tools = [makeAgentTool('exec')]
      const toolService = createMockToolService()

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-exec',
          name: 'exec',
          params: '{"command":"rm -rf /tmp/project"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-exec', name: 'exec', arguments: '{"command":"rm -rf /tmp/project"}' }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'auto_approve',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks
      )

      expect(hooks.reviewToolPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'exec',
          toolArgs: '{"command":"rm -rf /tmp/project"}',
          permission: expect.objectContaining({
            permissionType: 'command',
            command: 'rm -rf /tmp/project',
            commandSignature: 'posix:rm -rf /tmp/project',
            shellProfile: 'posix'
          })
        })
      )
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(result.type).toBe('paused')
      expect(result.type === 'paused' ? result.interactions : []).toHaveLength(1)
    })

    it('marks tool calls as reviewing while auto approve reviewer is pending', async () => {
      const reviewDecision = createDeferred<{ decision: 'auto_allow'; riskLevel: 'low' }>()
      const hooks = {
        reviewToolPermission: vi.fn(() => reviewDecision.promise)
      }
      const tools = [makeAgentTool('read')]
      const toolService = createMockToolService({ read: 'file content' })
      const flushedBlocks: any[] = []
      const rendererFlushHandle = {
        flush: vi.fn(() => {
          flushedBlocks.push(JSON.parse(JSON.stringify(state.blocks)))
        }),
        schedule: vi.fn(),
        rescheduleRenderer: vi.fn()
      }

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-read',
          name: 'read',
          params: '{"path":"/tmp/outside.txt"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-read', name: 'read', arguments: '{"path":"/tmp/outside.txt"}' }
      ]

      const executePromise = settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'auto_approve',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks,
        undefined,
        DEFAULT_INTERLEAVED_REASONING,
        rendererFlushHandle
      )
      await Promise.resolve()

      expect(flushedBlocks[0][0].extra).toMatchObject({
        autoApproveReviewStatus: 'reviewing'
      })
      expect(toolService.callTool).not.toHaveBeenCalled()

      reviewDecision.resolve({ decision: 'auto_allow', riskLevel: 'low' })
      const result = await executePromise

      const lastFlushedToolBlock = flushedBlocks
        .flat()
        .filter((block) => block.tool_call?.id === 'tc-read')
        .at(-1)
      expect(lastFlushedToolBlock?.extra?.autoApproveReviewStatus).toBeUndefined()
      expect(result.executed).toBe(1)
    })

    it('does not flash reviewing when no auto approve reviewer is registered', async () => {
      const hooks = {
        onPermissionRequest: vi.fn()
      }
      const tools = [makeAgentTool('read')]
      const toolService = createMockToolService({ read: 'file content' })
      const rendererFlushHandle = {
        flush: vi.fn(),
        schedule: vi.fn(),
        rescheduleRenderer: vi.fn()
      }

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-read',
          name: 'read',
          params: '{"path":"/tmp/outside.txt"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc-read', name: 'read', arguments: '{"path":"/tmp/outside.txt"}' }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'auto_approve',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks,
        undefined,
        DEFAULT_INTERLEAVED_REASONING,
        rendererFlushHandle
      )

      expect(rendererFlushHandle.flush).not.toHaveBeenCalled()
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(result.type).toBe('paused')
      expect(result.type === 'paused' ? result.interactions : []).toHaveLength(1)
      expect(
        state.blocks.find((block) => block.tool_call?.id === 'tc-read')?.extra
          ?.autoApproveReviewStatus
      ).toBeUndefined()
    })

    it('pauses auto-approve Agent tool calls when the reviewer asks the user', async () => {
      const hooks = {
        onPermissionRequest: vi.fn(),
        reviewToolPermission: vi.fn().mockResolvedValue({
          decision: 'ask_user',
          riskLevel: 'high'
        })
      }
      const tools = [makeAgentTool('write')]
      const toolService = createMockToolService()

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-write',
          name: 'write',
          params: '{"path":"/tmp/outside.txt","content":"hello"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-write',
          name: 'write',
          arguments: '{"path":"/tmp/outside.txt","content":"hello"}'
        }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'auto_approve',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks
      )

      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(result.executed).toBe(0)
      expect(result.type).toBe('paused')
      expect(result.type === 'paused' ? result.interactions : []).toHaveLength(1)
      expect(result.type === 'paused' ? result.interactions[0].permission : null).toEqual(
        expect.objectContaining({
          permissionType: 'write',
          serverName: 'agent-filesystem',
          paths: ['/tmp/outside.txt']
        })
      )
      expect(hooks.onPermissionRequest).toHaveBeenCalledTimes(1)
      expect(
        state.blocks.find((block) => block.tool_call?.id === 'tc-write')?.extra
          ?.autoApproveReviewStatus
      ).toBeUndefined()
      expect(state.blocks.at(-1)).toEqual(
        expect.objectContaining({
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          extra: expect.objectContaining({
            needsUserAction: true,
            permissionType: 'write',
            serverName: 'agent-filesystem'
          })
        })
      )
    })

    it('clears reviewing marker when auto approve reviewer blocks a tool call', async () => {
      const hooks = {
        reviewToolPermission: vi.fn().mockResolvedValue({
          decision: 'block',
          riskLevel: 'critical',
          rationale: 'blocked by reviewer'
        })
      }
      const tools = [makeAgentTool('write')]
      const toolService = createMockToolService()

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-write',
          name: 'write',
          params: '{"path":"/tmp/outside.txt","content":"hello"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-write',
          name: 'write',
          arguments: '{"path":"/tmp/outside.txt","content":"hello"}'
        }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'auto_approve',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks
      )

      const toolBlock = state.blocks.find((block) => block.tool_call?.id === 'tc-write')
      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(result.executed).toBe(1)
      expect(toolBlock?.status).toBe('error')
      expect(toolBlock?.tool_call?.response).toContain('blocked by reviewer')
      expect(toolBlock?.extra?.autoApproveReviewStatus).toBeUndefined()
    })

    it('falls back to user approval for unknown auto approve reviewer decisions', async () => {
      const hooks = {
        onPermissionRequest: vi.fn(),
        reviewToolPermission: vi.fn().mockResolvedValue({
          decision: 'unknown',
          riskLevel: 'low'
        })
      }
      const tools = [makeAgentTool('write')]
      const toolService = createMockToolService()

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-write',
          name: 'write',
          params: '{"path":"/tmp/outside.txt","content":"hello"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-write',
          name: 'write',
          arguments: '{"path":"/tmp/outside.txt","content":"hello"}'
        }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'auto_approve',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks
      )

      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(result.type).toBe('paused')
      expect(result.type === 'paused' ? result.interactions : []).toHaveLength(1)
      expect(hooks.onPermissionRequest).toHaveBeenCalledTimes(1)
    })

    it('auto-approves pre-checked permissions before execution', async () => {
      const hooks = {
        autoGrantPermission: vi.fn().mockResolvedValue(undefined),
        reviewToolPermission: vi.fn().mockResolvedValue({
          decision: 'auto_allow',
          riskLevel: 'medium'
        })
      }
      const tools = [makeAgentTool('write_file')]
      const toolService = createMockToolService({ write_file: 'written' }) as ToolServicePort & {
        preCheckToolPermission: ReturnType<typeof vi.fn>
      }
      toolService.preCheckToolPermission = vi.fn().mockResolvedValue({
        needsPermission: true,
        permissionType: 'write',
        description: 'Need write permission',
        toolName: 'write_file',
        serverName: 'agent-filesystem',
        paths: ['/tmp/outside.txt'],
        rememberable: false
      })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-write',
          name: 'write_file',
          params: '{"path":"/tmp/outside.txt","content":"hello"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-write',
          name: 'write_file',
          arguments: '{"path":"/tmp/outside.txt","content":"hello"}'
        }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'auto_approve',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks
      )

      expect(toolService.preCheckToolPermission).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tc-write' }),
        {
          permissionMode: 'full_access',
          signal: io.abortSignal,
          activeSkillNames: undefined,
          commandShell: POSIX_COMMAND_SHELL
        }
      )
      expect(hooks.reviewToolPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'precheck',
          permission: expect.objectContaining({
            permissionType: 'write',
            paths: ['/tmp/outside.txt']
          })
        })
      )
      expect(hooks.autoGrantPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          permissionType: 'write',
          paths: ['/tmp/outside.txt']
        })
      )
      expect(toolService.callTool).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tc-write' }),
        expect.objectContaining({
          permissionMode: 'full_access',
          commandShell: POSIX_COMMAND_SHELL
        })
      )
      expect(vi.mocked(toolService.preCheckToolPermission).mock.calls[0][1]?.commandShell).toBe(
        POSIX_COMMAND_SHELL
      )
      expect(vi.mocked(toolService.callTool).mock.calls[0][1]?.commandShell).toBe(
        POSIX_COMMAND_SHELL
      )
      expect(result.executed).toBe(1)
      expect(result.type).toBe('completed')
    })

    it.each(['full_access', 'auto_approve'] as const)(
      'never auto-grants explicit user confirmation in %s mode',
      async (permissionMode) => {
        const hooks = {
          autoGrantPermission: vi.fn().mockResolvedValue(undefined),
          reviewToolPermission: vi.fn().mockResolvedValue({ decision: 'auto_allow' })
        }
        const tools = [makeAgentTool('deepchat_subagents')]
        const toolService = createMockToolService() as ToolServicePort & {
          preCheckToolPermission: ReturnType<typeof vi.fn>
        }
        toolService.preCheckToolPermission = vi.fn().mockResolvedValue({
          needsPermission: true,
          permissionType: 'write',
          description: 'Start this Subagent task?',
          toolName: 'deepchat_subagents',
          serverName: 'agent-live-delegation',
          requestId: 'approval-1',
          rememberable: false,
          requiresUserConfirmation: true
        })

        state.blocks.push({
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: {
            id: 'tc-spawn',
            name: 'deepchat_subagents',
            params: '{"operation":"spawn"}',
            response: ''
          }
        })
        state.completedToolCalls = [
          { id: 'tc-spawn', name: 'deepchat_subagents', arguments: '{"operation":"spawn"}' }
        ]

        const result = await settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          permissionMode,
          new ToolOutputGuard(),
          32000,
          1024,
          hooks
        )

        expect(result.type).toBe('paused')
        expect(result.type === 'paused' ? result.interactions[0]?.permission : null).toMatchObject({
          requestId: 'approval-1',
          requiresUserConfirmation: true
        })
        expect(toolService.callTool).not.toHaveBeenCalled()
        expect(hooks.autoGrantPermission).not.toHaveBeenCalled()
        expect(hooks.reviewToolPermission).not.toHaveBeenCalled()
      }
    )

    it('enriches tool_call blocks with server info', async () => {
      const tools = [makeTool('get_weather')]
      const toolService = createMockToolService({ get_weather: 'Sunny' })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'get_weather', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'get_weather', arguments: '{}' }]

      await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(state.blocks[0].tool_call!.server_name).toBe('test-server')
      expect(state.blocks[0].tool_call!.server_icons).toBe('icon')
      expect(state.blocks[0].tool_call!.server_description).toBe('Test server')
    })

    it('flags toolsChanged when skill_view activates a skill via main SKILL.md', async () => {
      const tools = [makeAgentTool('skill_view')]
      const skillResolution = makeRuntimeSkillResolution()
      const responseText = JSON.stringify({
        success: true,
        name: 'deepchat-settings',
        content: skillResolution.effectiveContent,
        activatedForMessage: true,
        activationScope: 'message'
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
              toolResult: makeRuntimeSkillToolResult({ skillResolution })
            }
          }
        })
      } as unknown as ToolServicePort

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          commitRuntimeSkillView: vi.fn(),
          activateSkill: vi.fn().mockResolvedValue(['deepchat-settings']),
          executionJournal: {
            commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
            commitToolOutcome: vi.fn(() => ({ sessionId: 's1', entryId: 2, created: true }))
          }
        }
      )

      expect(result.toolsChanged).toBe(true)
    })

    it('applies a prepared Skill activation only after its Journal outcome is committed', async () => {
      const tools = [makeAgentTool('skill_view')]
      const order: string[] = []
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: { name: 'deepchat-settings' },
          target: { serverName: 'agent-skills', originalName: 'skill_view' }
        })
        order.push('dispatch')
        return {
          content: 'activated',
          rawData: {
            toolCallId: request.id,
            content: 'activated',
            isError: false,
            toolResult: makeRuntimeSkillToolResult()
          }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]
      let activationApplied = false
      const apply = vi.fn(() => {
        order.push('apply')
        activationApplied = true
      })

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          prepareSkillActivation: vi.fn(async () => {
            order.push('prepare')
            return { kind: 'prepared', apply }
          }),
          getActiveSkillNames: () => (activationApplied ? ['deepchat-settings'] : []),
          activateSkill: vi.fn(),
          commitRuntimeSkillView: vi.fn(() => order.push('materialize')),
          executionJournal: {
            commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
            commitToolOutcome: vi.fn(() => {
              order.push('outcome')
              return { sessionId: 's1', entryId: 2, created: true }
            })
          }
        }
      )

      expect(result.toolsChanged).toBe(true)
      expect(order).toEqual(['dispatch', 'prepare', 'outcome', 'materialize', 'apply'])
      expect(apply).toHaveBeenCalledOnce()
    })

    it('does not apply a prepared Skill activation when cancellation wins during materialization', async () => {
      const abortController = new AbortController()
      const abortIo = createIo({ abortSignal: abortController.signal })
      const tools = [makeAgentTool('skill_view')]
      const order: string[] = []
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: { name: 'deepchat-settings' },
          target: { serverName: 'agent-skills', originalName: 'skill_view' }
        })
        return {
          content: 'activated',
          rawData: {
            toolCallId: request.id,
            content: 'activated',
            isError: false,
            toolResult: makeRuntimeSkillToolResult()
          }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]
      const apply = vi.fn(() => order.push('apply'))

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          abortIo,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            prepareSkillActivation: vi.fn(async () => ({ kind: 'prepared', apply })),
            getActiveSkillNames: () => [],
            activateSkill: vi.fn(),
            commitRuntimeSkillView: vi.fn(() => {
              order.push('materialize')
              abortController.abort()
            }),
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
              commitToolOutcome: vi.fn(() => {
                order.push('outcome')
                return { sessionId: 's1', entryId: 2, created: true }
              })
            }
          }
        )
      ).rejects.toMatchObject({ name: 'AbortError' })

      expect(order).toEqual(['outcome', 'materialize'])
      expect(apply).not.toHaveBeenCalled()
    })

    it('does not apply a prepared Skill activation when its Journal outcome cannot persist', async () => {
      const tools = [makeAgentTool('skill_view')]
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: { name: 'deepchat-settings' },
          target: { serverName: 'agent-skills', originalName: 'skill_view' }
        })
        return {
          content: 'activated',
          rawData: {
            toolCallId: request.id,
            content: 'activated',
            isError: false,
            toolResult: makeRuntimeSkillToolResult()
          }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]
      const apply = vi.fn()
      const journalError = new ExecutionJournalError('outcome unavailable', 'persistence_failed')

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            prepareSkillActivation: vi.fn().mockResolvedValue({ kind: 'prepared', apply }),
            activateSkill: vi.fn(),
            commitRuntimeSkillView: vi.fn(),
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
              commitToolOutcome: vi.fn(() => {
                throw journalError
              })
            }
          }
        )
      ).rejects.toBe(journalError)

      expect(apply).not.toHaveBeenCalled()
    })

    it('fails the Run when Native Skill activation reaches preparation without a dispatch', async () => {
      const tools = [makeAgentTool('skill_view')]
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request) => ({
        content: 'activated',
        rawData: {
          toolCallId: request.id,
          content: 'activated',
          isError: false,
          toolResult: makeRuntimeSkillToolResult()
        }
      }))
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]
      const prepareSkillActivation = vi.fn()
      const commitToolOutcome = vi.fn()

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            prepareSkillActivation,
            executionJournal: {
              commitDispatch: vi.fn(),
              commitToolOutcome
            }
          }
        )
      ).rejects.toMatchObject({
        name: 'ExecutionJournalError',
        code: 'invalid_fact',
        message: 'Native Skill activation requires a committed dispatch before preparation.'
      })

      expect(prepareSkillActivation).not.toHaveBeenCalled()
      expect(commitToolOutcome).not.toHaveBeenCalled()
    })

    it('commits a bounded Skill activation rejection without applying runtime state', async () => {
      const tools = [makeAgentTool('skill_view')]
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: { name: 'deepchat-settings' },
          target: { serverName: 'agent-skills', originalName: 'skill_view' }
        })
        return {
          content: 'private skill body',
          rawData: {
            toolCallId: request.id,
            content: 'private skill body',
            isError: false,
            toolResult: makeRuntimeSkillToolResult()
          }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]
      const commitToolOutcome = vi.fn(() => ({
        sessionId: 's1',
        entryId: 2,
        created: true
      }))

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          prepareSkillActivation: vi.fn().mockResolvedValue({ kind: 'rejected' }),
          activateSkill: vi.fn(),
          executionJournal: {
            commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
            commitToolOutcome
          }
        }
      )

      expect(result.toolsChanged).toBe(false)
      expect(commitToolOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          isError: true,
          responseText: expect.stringContaining('cannot be activated in the current Run')
        })
      )
      expect(JSON.stringify(state.blocks)).not.toContain('private skill body')
    })

    it('commits a bounded Skill activation error when cancellation wins before preparation', async () => {
      const tools = [makeAgentTool('skill_view')]
      const abortController = new AbortController()
      io = createIo({ abortSignal: abortController.signal })
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: { name: 'deepchat-settings' },
          target: { serverName: 'agent-skills', originalName: 'skill_view' }
        })
        abortController.abort()
        return {
          content: 'activated',
          rawData: {
            toolCallId: request.id,
            content: 'activated',
            isError: false,
            toolResult: makeRuntimeSkillToolResult()
          }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]
      const prepareSkillActivation = vi.fn()
      const commitToolOutcome = vi.fn(() => ({
        sessionId: 's1',
        entryId: 2,
        created: true
      }))

      await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        {
          prepareSkillActivation,
          executionJournal: {
            commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
            commitToolOutcome
          }
        }
      )

      expect(prepareSkillActivation).not.toHaveBeenCalled()
      expect(commitToolOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          isError: true,
          responseText: expect.stringContaining('cannot be activated in the current Run')
        })
      )
    })

    it('returns a confirmation for a repeated root skill_view in the same batch', async () => {
      const tools = [makeAgentTool('skill_view')]
      const skillResolution = makeRuntimeSkillResolution()
      const rootViewText = JSON.stringify({
        success: true,
        name: 'deepchat-settings',
        content: skillResolution.effectiveContent,
        activatedForMessage: true
      })
      const confirmationText = JSON.stringify({
        success: true,
        name: 'deepchat-settings',
        activeForCurrentMessage: true,
        activatedForMessage: false,
        message: 'Skill is already active for the current message.'
      })
      const toolService = {
        ...createMockToolService(),
        callTool: vi.fn().mockImplementation(async (request, options) => {
          if (options?.activeSkillNames?.includes('deepchat-settings')) {
            return {
              content: confirmationText,
              rawData: {
                toolCallId: request.id,
                content: confirmationText,
                isError: false,
                toolResult: { activationApplied: false, activationSource: 'none' }
              }
            }
          }
          options?.commitDispatch?.({
            toolName: request.function.name,
            toolSource: 'agent',
            normalizedArguments: { name: 'deepchat-settings' },
            target: { serverName: 'agent-skills', originalName: 'skill_view' }
          })
          return {
            content: rootViewText,
            rawData: {
              toolCallId: request.id,
              content: rootViewText,
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
      const commitRuntimeSkillView = vi.fn().mockResolvedValue(undefined)
      const activateSkill = vi.fn(async (skillName: string) => [skillName])
      const conversation: Array<{ role: string; content: string }> = []

      for (const toolCallId of ['tc1', 'tc2']) {
        state.blocks.push({
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: {
            id: toolCallId,
            name: 'skill_view',
            params: '{"name":"deepchat-settings"}',
            response: ''
          }
        })
      }
      state.completedToolCalls = ['tc1', 'tc2'].map((id) => ({
        id,
        name: 'skill_view',
        arguments: '{"name":"deepchat-settings"}'
      }))

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        { getActiveSkillNames: () => [], commitRuntimeSkillView, activateSkill }
      )

      expect(toolService.callTool).toHaveBeenCalledTimes(2)
      expect(vi.mocked(toolService.callTool).mock.calls[1][1]?.activeSkillNames).toEqual([
        'deepchat-settings'
      ])
      expect(commitRuntimeSkillView).toHaveBeenCalledOnce()
      expect(commitRuntimeSkillView).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'tc1', responseText: rootViewText })
      )
      expect(activateSkill).toHaveBeenCalledOnce()
      expect(state.blocks[0].tool_call?.response).toBe(rootViewText)
      expect(state.blocks[1].tool_call?.response).toBe(confirmationText)
      expect(conversation.filter((message) => message.content.includes('# Effective Skill body')))
        .toHaveLength(1)
    })

    it.each([
      ['missing', undefined],
      [
        'identity-mismatched',
        {
          ...makeRuntimeSkillResolution(),
          identity: {
            ...makeRuntimeSkillResolution().identity,
            sourceId: '/skills/another-skill'
          }
        }
      ]
    ])('fails closed for %s runtime Skill execution evidence', async (_case, skillResolution) => {
      const tools = [makeAgentTool('skill_view')]
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
            content: '{"success":true,"name":"deepchat-settings"}',
            rawData: {
              toolCallId: 'tc1',
              content: '{"success":true,"name":"deepchat-settings"}',
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
                ...(skillResolution ? { skillResolution } : {})
              }
            }
          }
        })
      } as unknown as ToolServicePort
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]
      const commitRuntimeSkillView = vi.fn()
      const activateSkill = vi.fn()

      await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        { commitRuntimeSkillView, activateSkill }
      )
      expect(commitRuntimeSkillView).not.toHaveBeenCalled()
      expect(activateSkill).not.toHaveBeenCalled()
      expect(state.blocks[0]).toMatchObject({
        status: 'error',
        tool_call: {
          response: 'Error: Runtime Skill-view activation metadata is invalid.'
        }
      })
    })

    it('fails closed when runtime Skill activation does not enter the active set', async () => {
      const tools = [makeAgentTool('skill_view')]
      const skillResolution = makeRuntimeSkillResolution()
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
            content: '{"success":true,"name":"deepchat-settings"}',
            rawData: {
              toolCallId: 'tc1',
              content: '{"success":true,"name":"deepchat-settings"}',
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
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            commitRuntimeSkillView: vi.fn().mockResolvedValue(undefined),
            activateSkill: vi.fn().mockResolvedValue([])
          }
        )
      ).rejects.toMatchObject({
        name: 'CommittedToolOutcomeProjectionError',
        code: 'projection_failed',
        cause: expect.objectContaining({
          message: 'Runtime Skill-view activation did not activate deepchat-settings.'
        })
      })

      expect(state.blocks[0]).toMatchObject({
        status: 'pending',
        tool_call: { response: '' }
      })
    })

    it('rejects an impossible runtime Skill view before journaling its large body', async () => {
      const tools = [makeAgentTool('skill_view')]
      const skillResolution = makeRuntimeSkillResolution('x'.repeat(20_000))
      const responseText = JSON.stringify({
        success: true,
        name: 'deepchat-settings',
        content: 'x'.repeat(20_000)
      })
      const commitToolOutcome = vi.fn(() => ({ sessionId: 's1', entryId: 2, created: true }))
      const commitRuntimeSkillView = vi.fn()
      const activateSkill = vi.fn()
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
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
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]

      await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        1000,
        100,
        {
          commitRuntimeSkillView,
          activateSkill,
          executionJournal: {
            commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
            commitToolOutcome
          }
        }
      )

      expect(commitRuntimeSkillView).not.toHaveBeenCalled()
      expect(activateSkill).not.toHaveBeenCalled()
      expect(commitToolOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          isError: true,
          responseText: expect.stringContaining('cannot fit this model context')
        })
      )
      expect(commitToolOutcome.mock.calls[0][0].responseText).not.toContain('x'.repeat(100))
    })

    it('fails closed when final fitting changes a committed runtime Skill view', async () => {
      const tools = [makeAgentTool('skill_view')]
      const skillResolution = makeRuntimeSkillResolution()
      const responseText = '{"success":true,"name":"deepchat-settings"}'
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
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
      const outputGuard = new ToolOutputGuard()
      vi.spyOn(outputGuard, 'fitToolBatchOutputs').mockResolvedValue({
        kind: 'ok',
        results: [
          {
            toolCallId: 'tc1',
            toolName: 'skill_view',
            responseText: '[changed]',
            contextResponseText: '[changed]',
            isError: false,
            requiresInline: true,
            downgraded: true
          }
        ]
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]
      const commitRuntimeSkillView = vi.fn()
      const activateSkill = vi.fn()
      const commitToolOutcome = vi.fn(() => ({
        sessionId: 's1',
        entryId: 2,
        created: true
      }))

      await expect(
        settleToolBatch(
          state,
          [{ role: 'user', content: 'optional history '.repeat(10_000) }],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          outputGuard,
          32000,
          1024,
          {
            commitRuntimeSkillView,
            activateSkill,
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
              commitToolOutcome
            }
          }
        )
      ).rejects.toMatchObject({
        name: 'CommittedToolOutcomeProjectionError',
        code: 'projection_failed'
      })

      expect(commitToolOutcome).toHaveBeenCalledOnce()
      expect(commitRuntimeSkillView).not.toHaveBeenCalled()
      expect(activateSkill).not.toHaveBeenCalled()
      expect(state.blocks[0]).toMatchObject({
        status: 'pending',
        tool_call: { response: '' }
      })
    })

    it('fails closed when final fitting cannot keep a committed runtime Skill view inline', async () => {
      const tools = [makeAgentTool('skill_view')]
      const skillResolution = makeRuntimeSkillResolution()
      const responseText = '{"success":true,"name":"deepchat-settings"}'
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
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
      const outputGuard = new ToolOutputGuard()
      vi.spyOn(outputGuard, 'fitToolBatchOutputs').mockResolvedValue({
        kind: 'terminal_error',
        message: 'Tool results cannot fit the context window.',
        results: [
          {
            toolCallId: 'tc1',
            toolName: 'skill_view',
            responseText: 'Tool result omitted.',
            contextResponseText: '',
            isError: true,
            requiresInline: true,
            downgraded: true
          }
        ]
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          outputGuard,
          32000,
          1024,
          {
            commitRuntimeSkillView: vi.fn(),
            activateSkill: vi.fn()
          }
        )
      ).rejects.toMatchObject({
        name: 'CommittedToolOutcomeProjectionError',
        code: 'projection_failed',
        cause: expect.objectContaining({ message: expect.stringContaining('remain inline') })
      })
      expect(state.blocks[0]).toMatchObject({
        status: 'pending',
        tool_call: { response: '' }
      })
    })

    it('keeps a committed tool outcome authoritative when skill activation fails', async () => {
      const tools = [makeAgentTool('skill_view')]
      const skillResolution = makeRuntimeSkillResolution()
      const toolService = createMockToolService()
      const commitToolOutcome = vi.fn(() => ({ sessionId: 's1', entryId: 2, created: true }))
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'agent',
          normalizedArguments: { name: 'deepchat-settings' },
          target: { serverName: 'agent-skills', originalName: 'skill_view' }
        })
        return {
          content: 'activated',
          rawData: {
            toolCallId: request.id,
            content: 'activated',
            isError: false,
            toolResult: {
              activationApplied: true,
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
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            activateSkill: vi.fn().mockRejectedValue(new Error('activation failed')),
            commitRuntimeSkillView: vi.fn().mockResolvedValue(undefined),
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
              commitToolOutcome
            }
          }
        )
      ).rejects.toMatchObject({
        name: 'CommittedToolOutcomeProjectionError',
        code: 'projection_failed',
        cause: expect.objectContaining({ message: 'activation failed' })
      })

      expect(commitToolOutcome).toHaveBeenCalledOnce()
      expect(commitToolOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          responseText: 'activated',
          isError: false
        })
      )
      expect(state.blocks[0]).toMatchObject({
        status: 'pending',
        tool_call: { response: '' }
      })
    })

    it('does not activate a runtime Skill when its strict Tape commit fails', async () => {
      const tools = [makeAgentTool('skill_view')]
      const activateSkill = vi.fn()
      const skillResolution = makeRuntimeSkillResolution()
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
            content: '{"success":true,"name":"deepchat-settings"}',
            rawData: {
              toolCallId: 'tc1',
              content: '{"success":true,"name":"deepchat-settings"}',
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
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            commitRuntimeSkillView: vi.fn().mockRejectedValue(new Error('tape unavailable')),
            activateSkill
          }
        )
      ).rejects.toMatchObject({
        name: 'CommittedToolOutcomeProjectionError',
        code: 'projection_failed',
        cause: expect.objectContaining({ message: 'tape unavailable' })
      })

      expect(activateSkill).not.toHaveBeenCalled()
      expect(state.blocks[0]).toMatchObject({
        status: 'pending',
        tool_call: { response: '' }
      })
    })

    it('never projects a successful runtime Skill view when cancellation wins after return', async () => {
      const abortController = new AbortController()
      const abortIo = createIo({ abortSignal: abortController.signal })
      const tools = [makeAgentTool('skill_view')]
      const skillResolution = makeRuntimeSkillResolution()
      const responseText = JSON.stringify({
        success: true,
        name: 'deepchat-settings',
        content: '# Effective Skill body',
        activatedForMessage: true,
        activationScope: 'message',
        activationEvidenceVersion: 1
      })
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
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
      const commitToolOutcome = vi.fn(() => ({
        sessionId: 's1',
        entryId: 2,
        created: true
      }))
      const commitRuntimeSkillView = vi.fn()
      const activateSkill = vi.fn()
      const conversation: any[] = []
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{"name":"deepchat-settings"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'skill_view', arguments: '{"name":"deepchat-settings"}' }
      ]

      await expect(
        settleToolBatch(
          state,
          conversation,
          0,
          tools,
          toolService,
          'gpt-4',
          abortIo,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            resultNormalizer: vi.fn(async ({ content }) => {
              abortController.abort()
              return content
            }),
            commitRuntimeSkillView,
            activateSkill,
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
              commitToolOutcome
            }
          }
        )
      ).resolves.toMatchObject({ type: 'completed', executed: 1 })

      expect(commitToolOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          responseText: 'Error: Runtime Skill view was canceled before activation.',
          isError: true
        })
      )
      expect(commitRuntimeSkillView).not.toHaveBeenCalled()
      expect(activateSkill).not.toHaveBeenCalled()
      expect(JSON.stringify(conversation)).not.toContain('# Effective Skill body')
      expect(state.blocks[0]).toMatchObject({
        status: 'error',
        tool_call: { response: 'Error: Runtime Skill view was canceled before activation.' }
      })
    })

    it('does not treat an MCP tool named skill_view as a native Skill activation', async () => {
      const tools = [makeTool('skill_view')]
      const toolService = createMockToolService()
      vi.mocked(toolService.callTool).mockImplementation(async (request, options) => {
        options?.commitDispatch?.({
          toolName: request.function.name,
          toolSource: 'mcp',
          normalizedArguments: {},
          target: { serverName: 'test-server', originalName: 'skill_view' }
        })
        return {
          content: 'ordinary MCP result',
          rawData: {
            toolCallId: request.id,
            content: 'ordinary MCP result',
            isError: false,
            toolResult: {
              activationApplied: true,
              activatedSkill: 'deepchat-settings'
            }
          }
        }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'skill_view',
          params: '{}',
          response: ''
        }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'skill_view', arguments: '{}' }]
      const prepareSkillActivation = vi.fn()
      const activateSkill = vi.fn()

      const result = await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        { prepareSkillActivation, activateSkill }
      )

      expect(result.toolsChanged).toBe(false)
      expect(prepareSkillActivation).not.toHaveBeenCalled()
      expect(activateSkill).not.toHaveBeenCalled()
    })

    it('rejects an empty provider tool call id before invoking its target', async () => {
      const tools = [makeTool('mutate')]
      const toolService = createMockToolService()
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: '', name: 'mutate', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: '', name: 'mutate', arguments: '{}' }]

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024
        )
      ).rejects.toThrow('providerToolCallId')

      expect(toolService.callTool).not.toHaveBeenCalled()
      expect(state.blocks[0]).toMatchObject({
        status: 'pending',
        tool_call: { response: '' }
      })
    })

    it('includes reasoning_content when interleaved compatibility is enabled', async () => {
      const tools = [makeTool('search')]
      const toolService = createMockToolService({ search: 'result' })
      const conversation: any[] = []

      state.blocks.push({
        type: 'reasoning_content',
        content: 'Let me think...',
        status: 'pending',
        timestamp: Date.now()
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'search', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'search', arguments: '{}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        undefined,
        undefined,
        {
          ...DEFAULT_INTERLEAVED_REASONING,
          preserveReasoningContent: true,
          portraitInterleaved: true
        }
      )

      const assistantMsg = conversation.find((m: any) => m.role === 'assistant')
      expect(assistantMsg.reasoning_content).toBe('Let me think...')
    })

    it('adds empty reasoning_content for DeepSeek tool-only assistant messages when enabled', async () => {
      const tools = [makeTool('search')]
      const toolService = createMockToolService({ search: 'result' })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'search', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'search', arguments: '{}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'deepseek-v4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        undefined,
        undefined,
        {
          ...DEFAULT_INTERLEAVED_REASONING,
          preserveReasoningContent: true,
          preserveEmptyReasoningContent: true,
          portraitInterleaved: true
        }
      )

      const assistantMsg = conversation.find((m: any) => m.role === 'assistant')
      expect(assistantMsg.reasoning_content).toBe('')
      expect(assistantMsg.tool_calls).toHaveLength(1)
    })

    it('does not add empty reasoning_content for non-DeepSeek tool-only assistant messages', async () => {
      const tools = [makeTool('search')]
      const toolService = createMockToolService({ search: 'result' })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'search', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'search', arguments: '{}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        undefined,
        undefined,
        {
          ...DEFAULT_INTERLEAVED_REASONING,
          preserveReasoningContent: true,
          preserveEmptyReasoningContent: false,
          portraitInterleaved: true
        }
      )

      const assistantMsg = conversation.find((m: any) => m.role === 'assistant')
      expect(assistantMsg.reasoning_content).toBeUndefined()
      expect(assistantMsg.tool_calls).toHaveLength(1)
    })

    it('preserves tool call provider options in the follow-up assistant message', async () => {
      const tools = [makeTool('exec')]
      const toolService = createMockToolService({ exec: 'done' })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'exec',
          params: '{"command":"tree"}',
          response: ''
        },
        extra: {
          providerOptionsJson: JSON.stringify({
            vertex: {
              thoughtSignature: 'tool-thought-signature'
            }
          })
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc1',
          name: 'exec',
          arguments: '{"command":"tree"}',
          providerOptions: {
            vertex: {
              thoughtSignature: 'tool-thought-signature'
            }
          }
        }
      ]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gemini-3.1-flash-lite-preview',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      const assistantMsg = conversation.find((message: any) => message.role === 'assistant')
      expect(assistantMsg.tool_calls).toEqual([
        {
          id: 'tc1',
          type: 'function',
          function: { name: 'exec', arguments: '{"command":"tree"}' },
          provider_options: {
            vertex: {
              thoughtSignature: 'tool-thought-signature'
            }
          }
        }
      ])
    })

    it('does not include reasoning_content when compatibility is disabled', async () => {
      const tools = [makeTool('search')]
      const toolService = createMockToolService({ search: 'result' })
      const conversation: any[] = []

      state.blocks.push({
        type: 'reasoning_content',
        content: 'Thinking...',
        status: 'pending',
        timestamp: Date.now()
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'search', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'search', arguments: '{}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      const assistantMsg = conversation.find((m: any) => m.role === 'assistant')
      expect(assistantMsg.reasoning_content).toBeUndefined()
    })

    it('reports an interleaved reasoning gap when reasoning exists but compatibility is unavailable', async () => {
      const tools = [makeTool('search')]
      const toolService = createMockToolService({ search: 'result' })
      const conversation: any[] = []
      const hooks = {
        onInterleavedReasoningGap: vi.fn()
      }

      state.blocks.push({
        type: 'reasoning_content',
        content: 'Thinking...',
        status: 'pending',
        timestamp: Date.now()
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'search', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'search', arguments: '{}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks,
        'zenmux',
        {
          ...DEFAULT_INTERLEAVED_REASONING,
          reasoningSupported: true,
          providerDbSourceUrl: 'https://example.com/dist/all.json'
        }
      )

      const assistantMsg = conversation.find((message: any) => message.role === 'assistant')
      expect(assistantMsg.reasoning_content).toBeUndefined()
      expect(hooks.onInterleavedReasoningGap).toHaveBeenCalledWith({
        providerId: 'zenmux',
        modelId: 'gpt-4',
        providerDbSourceUrl: 'https://example.com/dist/all.json',
        reasoningContentLength: 'Thinking...'.length,
        toolCallCount: 1
      })
    })

    it('handles tool error', async () => {
      const tools = [makeTool('bad_tool')]
      const toolService = createMockToolService()
      ;(toolService.callTool as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Tool failed')
      )
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'bad_tool', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'bad_tool', arguments: '{}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      const toolMsg = conversation.find((m: any) => m.role === 'tool')
      expect(toolMsg.content).toBe('Error: Tool failed')

      const block = state.blocks.find((b) => b.type === 'tool_call')
      expect(block!.tool_call!.response).toBe('Error: Tool failed')
      expect(block!.status).toBe('error')
    })

    it('preserves raw tool error status when guard returns ok', async () => {
      const tools = [makeTool('bad_tool')]
      const toolService = createMockToolService()
      ;(toolService.callTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Upstream failure',
        rawData: {
          toolCallId: 'tc1',
          content: 'Upstream failure',
          isError: true
        }
      })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'bad_tool', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'bad_tool', arguments: '{}' }]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      const toolMsg = conversation.find((message: any) => message.role === 'tool')
      expect(toolMsg.content).toBe('Upstream failure')

      const block = state.blocks.find((b) => b.type === 'tool_call')
      expect(block!.tool_call!.response).toBe('Upstream failure')
      expect(block!.status).toBe('error')
    })

    it('preserves recoverable YoBrowser unavailable errors as failed tool context', async () => {
      const tools = [makeTool('cdp_send')]
      const toolService = createMockToolService()
      const payload = {
        ok: false,
        error: {
          code: 'yobrowser_unavailable',
          message: 'YoBrowser is not available for this session, so the CDP command was not run.',
          recoverable: true,
          sessionId: 's1',
          method: 'Page.captureScreenshot',
          browserStatus: {
            initialized: false,
            page: null,
            canGoBack: false,
            canGoForward: false,
            visible: false,
            loading: false
          },
          suggestedNextActions: [
            'Call get_browser_status to inspect the current browser state.',
            'Call load_url with the target URL to recreate or reopen the session browser.'
          ]
        }
      }
      const content = JSON.stringify(payload)
      ;(toolService.callTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        content,
        rawData: {
          toolCallId: 'tc1',
          content,
          isError: true
        }
      })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'cdp_send',
          params: '{"method":"Page.captureScreenshot"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'cdp_send', arguments: '{"method":"Page.captureScreenshot"}' }
      ]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      const toolMsg = conversation.find((message: any) => message.role === 'tool')
      expect(toolMsg.content).toContain('yobrowser_unavailable')

      const block = state.blocks.find((b) => b.type === 'tool_call')
      expect(block!.tool_call!.response).toContain('yobrowser_unavailable')
      expect(block!.status).toBe('error')
    })

    it('commits a returned parallel result before stopping on abort', async () => {
      const abortController = new AbortController()
      const abortIo = createIo({ abortSignal: abortController.signal })
      const tools = [makeAgentTool('read', TOOL_EXECUTION.read.parallel)]
      const toolService = createMockToolService()

      // Abort after first tool call
      ;(toolService.callTool as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        abortController.abort()
        return { content: 'ok', rawData: { toolCallId: 'tc1', content: 'ok', isError: false } }
      })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'read', params: '{"path":"a"}', response: '' }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc2', name: 'read', params: '{"path":"b"}', response: '' }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'read', arguments: '{"path":"a"}' },
        { id: 'tc2', name: 'read', arguments: '{"path":"b"}' }
      ]

      const conversation: any[] = []
      const executing = settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        abortIo,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      await expect(executing).resolves.toMatchObject({ type: 'completed', executed: 1 })
      expect(toolService.callTool).toHaveBeenCalledTimes(1)
      expect(conversation).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'tool', tool_call_id: 'tc1', content: 'ok' })
        ])
      )
      expect(state.blocks.find((block) => block.tool_call?.id === 'tc1')).toMatchObject({
        status: 'success',
        tool_call: { response: 'ok' }
      })
      expect(state.blocks.find((block) => block.tool_call?.id === 'tc2')).toMatchObject({
        status: 'pending',
        tool_call: { response: '' }
      })
    })

    it('does not suppress a parallel journal failure when the batch is also aborted', async () => {
      const abortController = new AbortController()
      const abortIo = createIo({ abortSignal: abortController.signal })
      const tools = [makeAgentTool('read', TOOL_EXECUTION.read.parallel)]
      const toolService = createMockToolService()
      const journalError = new ExecutionJournalError('outcome unavailable', 'persistence_failed')
      const commitToolOutcome = vi.fn((input) => {
        if (input.operation.providerToolCallId === 'tc2') throw journalError
        return { sessionId: 's1', entryId: 2, created: true }
      })
      ;(toolService.callTool as ReturnType<typeof vi.fn>).mockImplementation(
        async (request, options) => {
          options?.commitDispatch?.({
            toolName: request.function.name,
            toolSource: 'agent',
            normalizedArguments: { path: request.id },
            target: { serverName: 'agent-filesystem', originalName: 'read' }
          })
          if (request.id === 'tc2') abortController.abort()
          return {
            content: request.id,
            rawData: { toolCallId: request.id, content: request.id, isError: false }
          }
        }
      )
      state.blocks.push(
        {
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: { id: 'tc1', name: 'read', params: '{"path":"a"}', response: '' }
        },
        {
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: { id: 'tc2', name: 'read', params: '{"path":"b"}', response: '' }
        }
      )
      state.completedToolCalls = [
        { id: 'tc1', name: 'read', arguments: '{"path":"a"}' },
        { id: 'tc2', name: 'read', arguments: '{"path":"b"}' }
      ]

      await expect(
        settleToolBatch(
          state,
          [],
          0,
          tools,
          toolService,
          'gpt-4',
          abortIo,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          {
            executionJournal: {
              commitDispatch: vi.fn(() => ({ sessionId: 's1', entryId: 1, created: true })),
              commitToolOutcome
            }
          }
        )
      ).rejects.toBe(journalError)

      expect(commitToolOutcome).toHaveBeenCalledTimes(2)
      expect(state.blocks.every((block) => block.status === 'pending')).toBe(true)
    })

    it('stages CanceledError from a parallel read batch when the run remains active', async () => {
      const tools = [makeAgentTool('read', TOOL_EXECUTION.read.parallel)]
      const toolService = createMockToolService()
      const canceledError = new Error('Canceled')
      canceledError.name = 'CanceledError'
      ;(toolService.callTool as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(canceledError)
        .mockResolvedValueOnce({
          content: 'second result',
          rawData: { toolCallId: 'tc2', content: 'second result', isError: false }
        })

      state.blocks.push(
        {
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: { id: 'tc1', name: 'read', params: '{"path":"a"}', response: '' }
        },
        {
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: Date.now(),
          tool_call: { id: 'tc2', name: 'read', params: '{"path":"b"}', response: '' }
        }
      )
      state.completedToolCalls = [
        { id: 'tc1', name: 'read', arguments: '{"path":"a"}' },
        { id: 'tc2', name: 'read', arguments: '{"path":"b"}' }
      ]
      const conversation: any[] = []

      await expect(
        settleToolBatch(
          state,
          conversation,
          0,
          tools,
          toolService,
          'gpt-4',
          io,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024
        )
      ).resolves.toMatchObject({ type: 'completed', executed: 2 })
      expect(conversation).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'tool',
            tool_call_id: 'tc1',
            content: 'Error: Canceled'
          }),
          expect.objectContaining({
            role: 'tool',
            tool_call_id: 'tc2',
            content: 'second result'
          })
        ])
      )
      expect(state.blocks.find((block) => block.tool_call?.id === 'tc1')).toMatchObject({
        status: 'error',
        tool_call: { response: 'Error: Canceled' }
      })
    })

    it('commits the raw result when cancellation wins during asynchronous normalization', async () => {
      const abortController = new AbortController()
      const abortIo = createIo({ abortSignal: abortController.signal })
      const tools = [makeTool('tool_a')]
      const toolService = createMockToolService({ tool_a: 'raw result' })
      const conversation: any[] = []
      const resultNormalizer = vi.fn(async () => {
        abortController.abort()
        return 'normalized result'
      })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'tool_a', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'tool_a', arguments: '{}' }]

      await expect(
        settleToolBatch(
          state,
          conversation,
          0,
          tools,
          toolService,
          'gpt-4',
          abortIo,
          'full_access',
          new ToolOutputGuard(),
          32000,
          1024,
          { resultNormalizer }
        )
      ).resolves.toMatchObject({ type: 'completed', executed: 1 })
      expect(resultNormalizer).toHaveBeenCalledOnce()
      expect(conversation).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'tool', tool_call_id: 'tc1', content: 'raw result' })
        ])
      )
      expect(state.blocks[0]).toMatchObject({
        status: 'success',
        tool_call: { response: 'raw result' }
      })
    })

    it('flushes to renderer and DB after each tool execution', async () => {
      const tools = [makeTool('tool_a')]
      const toolService = createMockToolService({ tool_a: 'done' })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'tool_a', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'tool_a', arguments: '{}' }]

      await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(publishDeepchatEventMock).toHaveBeenCalledWith(
        'chat.stream.updated',
        expect.objectContaining({
          kind: 'snapshot',
          requestId: 'req-1',
          sessionId: 's1',
          messageId: 'm1',
          blocks: expect.any(Array)
        })
      )
      expect(io.messageStore.updateAssistantContent).toHaveBeenCalled()
    })

    it('promotes image previews after the current-round block when call ids repeat', async () => {
      const tools = [makeTool('tool_image')]
      const toolService = {
        getAllToolDefinitions: vi.fn().mockResolvedValue([]),
        preCheckToolPermission: vi.fn().mockResolvedValue(null),
        callTool: vi.fn(async (request) => ({
          content: '[image]',
          rawData: {
            toolCallId: request.id,
            content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
            isError: false,
            imagePreviews: [
              {
                id: 'mcp_image-1',
                data: 'imgcache://cached.png',
                mimeType: 'image/png',
                source: 'mcp_image'
              },
              {
                id: 'metadata-only',
                mimeType: 'image/png',
                source: 'mcp_image'
              }
            ]
          }
        })),
        buildToolSystemPrompt: vi.fn().mockReturnValue('')
      } as unknown as ToolServicePort

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'success',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'tool_image',
          params: '{"previous":true}',
          response: 'previous result'
        }
      })
      const prevBlockCount = state.blocks.length
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'tool_image', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'tool_image', arguments: '{}' }]

      await settleToolBatch(
        state,
        [],
        prevBlockCount,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(state.blocks[0]).toMatchObject({
        status: 'success',
        tool_call: {
          params: '{"previous":true}',
          response: 'previous result'
        }
      })
      expect(state.blocks[0].tool_call?.imagePreviews).toBeUndefined()
      expect(state.blocks[1].tool_call?.imagePreviews).toEqual([
        {
          id: 'metadata-only',
          mimeType: 'image/png',
          source: 'mcp_image'
        }
      ])
      expect(state.blocks).toHaveLength(3)
      expect(state.blocks[2]).toEqual(
        expect.objectContaining({
          type: 'image',
          status: 'success',
          image_data: {
            data: 'imgcache://cached.png',
            mimeType: 'image/png'
          },
          extra: expect.objectContaining({
            toolCallId: 'tc1',
            toolName: 'tool_image',
            toolImagePreviewId: 'mcp_image-1',
            toolImagePreviewSource: 'mcp_image'
          })
        })
      )
    })

    it('promotes image_generate previews into assistant image blocks', async () => {
      const tools = [makeAgentImageGenerationTool()]
      const toolService = {
        getAllToolDefinitions: vi.fn().mockResolvedValue([]),
        preCheckToolPermission: vi.fn().mockResolvedValue(null),
        callTool: vi.fn(async (request) => ({
          content: '{"ok":true,"imageCount":1}',
          rawData: {
            toolCallId: request.id,
            content: '{"ok":true,"imageCount":1}',
            isError: false,
            imagePreviews: [
              {
                id: 'generated-image-1',
                data: 'imgcache://generated.png',
                mimeType: 'image/png',
                title: 'Generated image 1',
                source: 'tool_output'
              }
            ]
          }
        })),
        buildToolSystemPrompt: vi.fn().mockReturnValue('')
      } as unknown as ToolServicePort

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: IMAGE_GENERATE_TOOL_NAME, params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: IMAGE_GENERATE_TOOL_NAME, arguments: '{}' }]

      await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(state.blocks).toHaveLength(2)
      expect(state.blocks[0]).toEqual(
        expect.objectContaining({
          type: 'tool_call',
          status: 'success'
        })
      )
      expect(state.blocks[0].tool_call?.imagePreviews).toBeUndefined()
      expect(state.blocks[1]).toEqual(
        expect.objectContaining({
          type: 'image',
          status: 'success',
          image_data: {
            data: 'imgcache://generated.png',
            mimeType: 'image/png'
          },
          extra: expect.objectContaining({
            toolCallId: 'tc1',
            toolName: IMAGE_GENERATE_TOOL_NAME,
            toolImagePreviewId: 'generated-image-1',
            toolImagePreviewSource: 'tool_output',
            toolImagePreviewTitle: 'Generated image 1'
          })
        })
      )
    })

    it('promotes same-name MCP image_generate previews into assistant image blocks', async () => {
      const tools = [makeTool(IMAGE_GENERATE_TOOL_NAME)]
      const toolService = {
        getAllToolDefinitions: vi.fn().mockResolvedValue([]),
        preCheckToolPermission: vi.fn().mockResolvedValue(null),
        callTool: vi.fn(async (request) => ({
          content: '{"ok":true,"imageCount":1}',
          rawData: {
            toolCallId: request.id,
            content: '{"ok":true,"imageCount":1}',
            isError: false,
            imagePreviews: [
              {
                id: 'mcp-generated-image-1',
                data: 'imgcache://mcp-generated.png',
                mimeType: 'image/png',
                source: 'tool_output'
              }
            ]
          }
        })),
        buildToolSystemPrompt: vi.fn().mockReturnValue('')
      } as unknown as ToolServicePort

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: IMAGE_GENERATE_TOOL_NAME, params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: IMAGE_GENERATE_TOOL_NAME, arguments: '{}' }]

      await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(state.blocks).toHaveLength(2)
      expect(state.blocks[0]).toEqual(
        expect.objectContaining({
          type: 'tool_call',
          status: 'success'
        })
      )
      expect(state.blocks[0].tool_call?.imagePreviews).toBeUndefined()
      expect(state.blocks[1]).toEqual(
        expect.objectContaining({
          type: 'image',
          status: 'success',
          image_data: {
            data: 'imgcache://mcp-generated.png',
            mimeType: 'image/png'
          },
          extra: expect.objectContaining({
            toolCallId: 'tc1',
            toolName: IMAGE_GENERATE_TOOL_NAME,
            toolImagePreviewId: 'mcp-generated-image-1',
            toolImagePreviewSource: 'tool_output'
          })
        })
      )
    })

    it('does not promote image_generate previews when the tool result is an error', async () => {
      const tools = [makeAgentImageGenerationTool()]
      const toolService = {
        getAllToolDefinitions: vi.fn().mockResolvedValue([]),
        preCheckToolPermission: vi.fn().mockResolvedValue(null),
        callTool: vi.fn(async (request) => ({
          content: 'generation failed',
          rawData: {
            toolCallId: request.id,
            content: 'generation failed',
            isError: true,
            imagePreviews: [
              {
                id: 'generated-image-1',
                data: 'imgcache://partial.png',
                mimeType: 'image/png',
                source: 'tool_output'
              }
            ]
          }
        })),
        buildToolSystemPrompt: vi.fn().mockReturnValue('')
      } as unknown as ToolServicePort

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: IMAGE_GENERATE_TOOL_NAME, params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: IMAGE_GENERATE_TOOL_NAME, arguments: '{}' }]

      await settleToolBatch(
        state,
        [],
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0].status).toBe('error')
      expect(state.blocks[0].tool_call?.imagePreviews).toEqual([
        {
          id: 'generated-image-1',
          data: 'imgcache://partial.png',
          mimeType: 'image/png',
          source: 'tool_output'
        }
      ])
    })

    it('offloads large yo_browser responses into a stub', async () => {
      tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-dispatch-offload-'))
      homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempHome)

      const tools = [makeTool('cdp_send')]
      const longScreenshot = JSON.stringify({ data: 'x'.repeat(7000) })
      const toolService = createMockToolService({ cdp_send: longScreenshot })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'function.cdp_send:11',
          name: 'cdp_send',
          params: '{"method":"Page.captureScreenshot"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'function.cdp_send:11',
          name: 'cdp_send',
          arguments: '{"method":"Page.captureScreenshot"}'
        }
      ]

      const executed = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(executed.terminalError).toBeUndefined()
      const toolMessage = conversation.find((message: any) => message.role === 'tool')
      const offloadPath = resolveToolOffloadPath('s1', 'function.cdp_send:11')
      expect(toolMessage.content).toContain('[Tool output offloaded]')
      expect(toolMessage.content).toContain(`Offload file: ${offloadPath}`)
      expect(toolMessage.content).not.toContain(':11.offload')
      await expect(fs.readFile(offloadPath!, 'utf-8')).resolves.toBe(longScreenshot)
      expect(state.blocks[0].tool_call?.response).toContain('[Tool output offloaded]')
      expect(state.blocks[0].status).toBe('success')
    })

    it('normalizes tool output through the result port before offload', async () => {
      const tools = [makeTool('cdp_send')]
      const longScreenshot = JSON.stringify({ data: 'x'.repeat(7000) })
      const toolService = createMockToolService({ cdp_send: longScreenshot })
      const conversation: any[] = []
      const hooks = {
        resultNormalizer: vi.fn().mockResolvedValue('English screenshot summary')
      }

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc-normalized',
          name: 'cdp_send',
          params: '{"method":"Page.captureScreenshot"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc-normalized',
          name: 'cdp_send',
          arguments: '{"method":"Page.captureScreenshot"}'
        }
      ]

      const executed = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks,
        'openai'
      )

      expect(executed.terminalError).toBeUndefined()
      expect(hooks.resultNormalizer).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 's1',
          toolCallId: 'tc-normalized',
          toolName: 'cdp_send',
          toolArgs: '{"method":"Page.captureScreenshot"}',
          content: longScreenshot,
          isError: false
        })
      )
      const toolMessage = conversation.find((message: any) => message.role === 'tool')
      expect(toolMessage.content).toBe('English screenshot summary')
      expect(toolMessage.content).not.toContain('[Tool output offloaded]')
      expect(state.blocks[0].tool_call?.response).toBe('English screenshot summary')
    })

    it('turns offload write failures into tool errors instead of falling back to raw content', async () => {
      tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-dispatch-offload-fail-'))
      homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
      const writeFileSpy = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'))

      const tools = [makeTool('cdp_send')]
      const longScreenshot = JSON.stringify({ data: 'x'.repeat(7000) })
      const toolService = createMockToolService({ cdp_send: longScreenshot })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'cdp_send',
          params: '{"method":"Page.captureScreenshot"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc1',
          name: 'cdp_send',
          arguments: '{"method":"Page.captureScreenshot"}'
        }
      ]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      writeFileSpy.mockRestore()
      const toolMessage = conversation.find((message: any) => message.role === 'tool')
      expect(toolMessage.content).toContain('offloading that result to disk failed')
      expect(toolMessage.content).not.toContain(longScreenshot)
      expect(state.blocks[0].status).toBe('error')
    })

    it('keeps the largest prefix of tool results and downgrades the overflow tail', async () => {
      const tools = [makeTool('read')]
      const toolService = createMockToolService()
      const hooks = {
        onPreToolUse: vi.fn(),
        onPermissionRequest: vi.fn(),
        onPostToolUse: vi.fn(),
        onPostToolUseFailure: vi.fn()
      }
      const conversation: any[] = []

      ;(toolService.callTool as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: 'a'.repeat(60),
          rawData: { toolCallId: 'tc1', content: 'a'.repeat(60), isError: false }
        })
        .mockResolvedValueOnce({
          content: 'b'.repeat(4000),
          rawData: { toolCallId: 'tc2', content: 'b'.repeat(4000), isError: false }
        })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'read', params: '{"path":"a.txt"}', response: '' }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc2', name: 'read', params: '{"path":"b.txt"}', response: '' }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'read', arguments: '{"path":"a.txt"}' },
        { id: 'tc2', name: 'read', arguments: '{"path":"b.txt"}' }
      ]

      const executed = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        260,
        32,
        hooks
      )

      const toolMessages = conversation.filter((message: any) => message.role === 'tool')
      expect(executed.terminalError).toBeUndefined()
      expect(toolMessages).toHaveLength(2)
      expect(toolMessages[0].content).toBe('a'.repeat(60))
      expect(toolMessages[1].content).toContain('remaining context window is too small')
      expect(state.blocks[0].status).toBe('success')
      expect(state.blocks[0].tool_call?.response).toBe('a'.repeat(60))
      expect(state.blocks[1].status).toBe('error')
      expect(state.blocks[1].tool_call?.response).toContain('remaining context window is too small')
      expect(hooks.onPostToolUse).toHaveBeenCalledTimes(1)
      expect(hooks.onPostToolUseFailure).toHaveBeenCalledTimes(1)
    })

    it('keeps the fitting prefix when a short overflow tail is downgraded', async () => {
      const tools = [makeTool('read')]
      const toolService = createMockToolService()
      const conversation: any[] = []

      ;(toolService.callTool as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: 'a'.repeat(40),
          rawData: { toolCallId: 'tc1', content: 'a'.repeat(40), isError: false }
        })
        .mockResolvedValueOnce({
          content: 'b'.repeat(40),
          rawData: { toolCallId: 'tc2', content: 'b'.repeat(40), isError: false }
        })
        .mockResolvedValueOnce({
          content: 'OK',
          rawData: { toolCallId: 'tc3', content: 'OK', isError: false }
        })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'read', params: '{"path":"a.txt"}', response: '' }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc2', name: 'read', params: '{"path":"b.txt"}', response: '' }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc3', name: 'read', params: '{"path":"c.txt"}', response: '' }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'read', arguments: '{"path":"a.txt"}' },
        { id: 'tc2', name: 'read', arguments: '{"path":"b.txt"}' },
        { id: 'tc3', name: 'read', arguments: '{"path":"c.txt"}' }
      ]

      const assistantMessage = {
        role: 'assistant' as const,
        content: '',
        tool_calls: state.completedToolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments }
        }))
      }
      const fittingPrefixMessages = [
        assistantMessage,
        { role: 'tool' as const, tool_call_id: 'tc1', content: 'a'.repeat(40) },
        { role: 'tool' as const, tool_call_id: 'tc2', content: 'b'.repeat(40) }
      ]
      const toolDefinitionTokens = estimateToolDefinitionTokens(tools)
      const contextLength = estimateMessagesTokens(fittingPrefixMessages) + toolDefinitionTokens + 1

      const executed = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        contextLength,
        0
      )

      const toolMessages = conversation.filter((message: any) => message.role === 'tool')
      expect(executed.terminalError).toBeUndefined()
      expect(toolMessages).toHaveLength(3)
      expect(toolMessages[0].content).toBe('a'.repeat(40))
      expect(toolMessages[1].content).toBe('b'.repeat(40))
      expect(toolMessages[2].content).toBe('')
      expect(state.blocks[0].status).toBe('success')
      expect(state.blocks[1].status).toBe('success')
      expect(state.blocks[2].status).toBe('error')
      expect(state.blocks[2].tool_call?.response).toContain('remaining context window is too small')
    })

    it('cleans offload files when a tail tool is downgraded during batch fitting', async () => {
      tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-dispatch-tail-offload-'))
      homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempHome)

      const tools = [makeTool('read'), makeTool('exec')]
      const toolService = createMockToolService()
      const conversation: any[] = []

      ;(toolService.callTool as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: 'a'.repeat(60),
          rawData: { toolCallId: 'tc1', content: 'a'.repeat(60), isError: false }
        })
        .mockResolvedValueOnce({
          content: 'x'.repeat(7000),
          rawData: { toolCallId: 'tc2', content: 'x'.repeat(7000), isError: false }
        })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'read', params: '{"path":"a.txt"}', response: '' }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc2', name: 'exec', params: '{"command":"ls"}', response: '' }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'read', arguments: '{"path":"a.txt"}' },
        { id: 'tc2', name: 'exec', arguments: '{"command":"ls"}' }
      ]

      const executed = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        260,
        32
      )

      expect(executed.terminalError).toBeUndefined()
      expect(state.blocks[1].tool_call?.response).toContain('remaining context window is too small')
      expect(state.blocks[1].tool_call?.response).not.toContain('[Tool output offloaded]')
      await expect(fs.access(resolveToolOffloadPath('s1', 'tc2')!)).rejects.toThrow()
    })

    it('drops search side effects for downgraded tail tool results', async () => {
      const tools = [makeTool('read'), makeTool('search_docs')]
      const toolService = createMockToolService()
      const conversation: any[] = []
      const searchResource = JSON.stringify({
        title: 'Example',
        url: 'https://example.com',
        content: 'x'.repeat(4000),
        description: 'x'.repeat(4000)
      })

      ;(toolService.callTool as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: 'a'.repeat(60),
          rawData: { toolCallId: 'tc1', content: 'a'.repeat(60), isError: false }
        })
        .mockResolvedValueOnce({
          content: [
            {
              type: 'resource',
              resource: {
                uri: 'https://example.com',
                mimeType: 'application/deepchat-webpage',
                text: searchResource
              }
            }
          ],
          rawData: {
            toolCallId: 'tc2',
            content: [
              {
                type: 'resource',
                resource: {
                  uri: 'https://example.com',
                  mimeType: 'application/deepchat-webpage',
                  text: searchResource
                }
              }
            ],
            isError: false
          }
        })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'read', params: '{"path":"a.txt"}', response: '' }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc2', name: 'search_docs', params: '{"q":"x"}', response: '' }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'read', arguments: '{"path":"a.txt"}' },
        { id: 'tc2', name: 'search_docs', arguments: '{"q":"x"}' }
      ]

      const executed = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        260,
        32
      )

      expect(executed.terminalError).toBeUndefined()
      expect(state.blocks.find((block) => block.type === 'search')).toBeUndefined()
      expect(state.blocks[1].tool_call?.response).toContain('remaining context window is too small')
      expect((io.messageStore as any).addSearchResult).not.toHaveBeenCalled()
    })

    it('marks the tool as error when offload succeeds but context budget cannot fit the result', async () => {
      tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-dispatch-offload-clean-'))
      homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempHome)

      const tools = [makeTool('cdp_send')]
      const longScreenshot = JSON.stringify({ data: 'x'.repeat(7000) })
      const toolService = createMockToolService({ cdp_send: longScreenshot })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'cdp_send',
          params: '{"method":"Page.captureScreenshot"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc1',
          name: 'cdp_send',
          arguments: '{"method":"Page.captureScreenshot"}'
        }
      ]

      await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        200,
        32
      )

      const toolMessage = conversation.find((message: any) => message.role === 'tool')
      expect(toolMessage.content).toContain('remaining context window is too small')
      expect(state.blocks[0].status).toBe('error')
      await expect(fs.access(resolveToolOffloadPath('s1', 'tc1')!)).rejects.toThrow()
    })

    it('returns terminalError when even the minimal tool failure stub cannot fit', async () => {
      tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-dispatch-terminal-clean-'))
      homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempHome)

      const tools = [makeTool('cdp_send')]
      const longScreenshot = JSON.stringify({ data: 'x'.repeat(7000) })
      const toolService = createMockToolService({ cdp_send: longScreenshot })
      const conversation: any[] = []
      const hooks = {
        onPreToolUse: vi.fn(),
        onPermissionRequest: vi.fn(),
        onPostToolUse: vi.fn(),
        onPostToolUseFailure: vi.fn()
      }

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'cdp_send',
          params: '{"method":"Page.captureScreenshot"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc1',
          name: 'cdp_send',
          arguments: '{"method":"Page.captureScreenshot"}'
        }
      ]

      const executed = await settleToolBatch(
        state,
        conversation,
        0,
        tools,
        toolService,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        1,
        1,
        hooks
      )

      expect(executed.terminalError).toContain('remaining context window is too small')
      expect(conversation.find((message: any) => message.role === 'tool')).toBeUndefined()
      expect(state.blocks[0].status).toBe('error')
      expect(hooks.onPostToolUseFailure).toHaveBeenCalledWith({
        callId: 'tc1',
        name: 'cdp_send',
        params: '{"method":"Page.captureScreenshot"}',
        error: expect.stringContaining('remaining context window is too small')
      })
      await expect(fs.access(resolveToolOffloadPath('s1', 'tc1')!)).rejects.toThrow()
    })
  })

  describe('finalize', () => {
    it('marks pending blocks as success and computes metadata', () => {
      // Set startTime in the past so generationTime > 0
      state.startTime = Date.now() - 1000
      state.blocks.push({
        type: 'content',
        content: 'Hello',
        status: 'pending',
        timestamp: Date.now()
      })
      state.metadata.outputTokens = 100
      state.firstTokenTime = state.startTime + 50

      finalize(state, io)

      expect(state.blocks[0].status).toBe('success')
      expect(io.messageStore.finalizeAssistantMessage).toHaveBeenCalledWith(
        'm1',
        state.blocks,
        expect.any(String)
      )

      const metadata = JSON.parse(
        (io.messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock.calls[0][2]
      )
      expect(metadata.firstTokenTime).toBe(50)
      expect(metadata.generationTime).toBeGreaterThanOrEqual(1000)
      expect(metadata.tokensPerSecond).toBeDefined()
    })

    it('emits completed event', () => {
      finalize(state, io)

      expectDeepchatEvent('chat.stream.completed', {
        sessionId: 's1',
        messageId: 'm1',
        requestId: 'req-1'
      })
    })

    it('emits updated event with blocks', () => {
      state.blocks.push({
        type: 'content',
        content: 'test',
        status: 'pending',
        timestamp: Date.now()
      })

      finalize(state, io)

      expectDeepchatEvent('chat.stream.updated', {
        sessionId: 's1',
        messageId: 'm1',
        requestId: 'req-1',
        providerId: 'acp',
        modelId: 'dimcode',
        blocks: expect.any(Array)
      })
    })

    it('publishes a max_steps terminal plan event before finalizing', () => {
      state.planTerminalReason = 'max_steps'
      state.latestAgentPlanSnapshot = {
        sessionId: 's1',
        messageId: 'm1',
        plan: [{ step: 'Still running', status: 'in_progress' }],
        revision: 3,
        updatedAt: '2026-05-18T00:00:00.000Z'
      }

      finalize(state, io)

      expect(state.blocks.some((block) => block.type === 'plan')).toBe(false)
      expect(state.latestAgentPlanSnapshot?.terminalReason).toBe('max_steps')
      expect(io.messageStore.finalizeAssistantMessage).toHaveBeenCalledWith(
        'm1',
        state.blocks,
        expect.any(String)
      )
      expectDeepchatEvent('chat.plan.updated', {
        sessionId: 's1',
        messageId: 'm1',
        terminalReason: 'max_steps'
      })
    })
  })

  describe('finalizePaused', () => {
    it.each(['pending', 'loading'] as const)(
      'rejects an unresolved %s non-interaction block without projecting success',
      (status) => {
        state.blocks.push({
          type: 'tool_call',
          content: '',
          status,
          timestamp: Date.now(),
          tool_call: {
            id: 'subagent-running',
            name: 'agent',
            params: '{}',
            response: ''
          }
        })

        expect(() => finalizePaused(state, io)).toThrow(
          `Paused stream invariant violated: block index=0 type=tool_call status=${status} is unresolved.`
        )
        expect(io.messageStore.updateAssistantContent).not.toHaveBeenCalled()
        expect(publishDeepchatEventMock).not.toHaveBeenCalledWith(
          'chat.stream.completed',
          expect.anything()
        )
      }
    )
  })

  describe('finalizeError', () => {
    it('pushes error block and marks pending blocks as error', () => {
      state.blocks.push({
        type: 'content',
        content: 'Partial',
        status: 'pending',
        timestamp: Date.now()
      })

      finalizeError(state, io, new Error('Connection lost'))

      expect(state.blocks).toHaveLength(2)
      expect(state.blocks[0].status).toBe('error')
      expect(state.blocks[1].type).toBe('error')
      expect(state.blocks[1].content).toBe('Connection lost')
    })

    it('calls setMessageError', () => {
      state.metadata.provider = 'openai'
      state.metadata.model = 'gpt-4'
      finalizeError(state, io, new Error('fail'))

      expect(io.messageStore.setMessageError).toHaveBeenCalledWith(
        'm1',
        state.blocks,
        expect.any(String)
      )
      const metadata = JSON.parse(
        (io.messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
      )
      expect(metadata.provider).toBe('openai')
      expect(metadata.model).toBe('gpt-4')
    })

    it('emits failed event', () => {
      finalizeError(state, io, new Error('boom'))

      expectDeepchatEvent('chat.stream.failed', {
        sessionId: 's1',
        messageId: 'm1',
        requestId: 'req-1',
        error: 'boom'
      })
    })

    it('handles non-Error objects', () => {
      finalizeError(state, io, 'string error')

      const errorBlock = state.blocks.find((b) => b.type === 'error')
      expect(errorBlock!.content).toBe('string error')
    })

    it('publishes an error terminal plan event before setMessageError', () => {
      const errorWrites: any[] = []
      ;(io.messageStore.setMessageError as ReturnType<typeof vi.fn>).mockImplementation(
        (_messageId, blocks) => {
          errorWrites.push(structuredClone(blocks))
        }
      )
      state.latestAgentPlanSnapshot = {
        sessionId: 's1',
        messageId: 'm1',
        plan: [{ step: 'Still running', status: 'in_progress' }],
        revision: 1,
        updatedAt: '2026-05-18T00:00:00.000Z'
      }

      finalizeError(state, io, new Error('boom'))

      expect(state.latestAgentPlanSnapshot?.terminalReason).toBe('error')
      expect(errorWrites[0]?.some((block: { type: string }) => block.type === 'plan')).toBe(false)
      expect(io.messageStore.setMessageError).toHaveBeenCalledWith(
        'm1',
        state.blocks,
        expect.any(String)
      )
      expectDeepchatEvent('chat.plan.updated', {
        sessionId: 's1',
        messageId: 'm1',
        terminalReason: 'error'
      })
    })

    it('stamps user cancel as aborted', () => {
      state.latestAgentPlanSnapshot = {
        sessionId: 's1',
        messageId: 'm1',
        plan: [{ step: 'Still running', status: 'in_progress' }],
        revision: 1,
        updatedAt: '2026-05-18T00:00:00.000Z'
      }

      finalizeError(state, io, 'common.error.userCanceledGeneration')

      expect(state.latestAgentPlanSnapshot?.terminalReason).toBe('aborted')
      expectDeepchatEvent('chat.plan.updated', {
        terminalReason: 'aborted'
      })
    })
  })

  describe('persistAbortExceptionPlanState', () => {
    it('publishes the aborted terminal marker for abort-exception early returns', () => {
      state.latestAgentPlanSnapshot = {
        sessionId: 's1',
        messageId: 'm1',
        plan: [{ step: 'Still running', status: 'in_progress' }],
        revision: 1,
        updatedAt: '2026-05-18T00:00:00.000Z'
      }

      persistAbortExceptionPlanState(state, io)

      expect(state.latestAgentPlanSnapshot?.terminalReason).toBe('aborted')
      expect(io.messageStore.updateAssistantContent).not.toHaveBeenCalled()
      expectDeepchatEvent('chat.plan.updated', {
        sessionId: 's1',
        messageId: 'm1',
        terminalReason: 'aborted'
      })
    })

    it('persists existing non-plan blocks for abort-exception early returns', () => {
      state.blocks.push({
        type: 'content',
        content: 'Partial answer',
        status: 'success',
        timestamp: Date.now()
      })
      state.latestAgentPlanSnapshot = {
        sessionId: 's1',
        messageId: 'm1',
        plan: [{ step: 'Still running', status: 'in_progress' }],
        revision: 1,
        updatedAt: '2026-05-18T00:00:00.000Z'
      }

      persistAbortExceptionPlanState(state, io)

      expect(io.messageStore.updateAssistantContent).toHaveBeenCalledWith('m1', state.blocks)
      expectDeepchatEvent('chat.stream.updated', {
        sessionId: 's1',
        messageId: 'm1',
        requestId: 'req-1'
      })
      expect(state.blocks.some((block) => block.type === 'plan')).toBe(false)
    })

    it('is idempotent for already stamped plan snapshots', () => {
      state.latestAgentPlanSnapshot = {
        sessionId: 's1',
        messageId: 'm1',
        plan: [{ step: 'Still running', status: 'in_progress' }],
        revision: 1,
        updatedAt: '2026-05-18T00:00:00.000Z'
      }

      persistAbortExceptionPlanState(state, io)
      publishDeepchatEventMock.mockClear()
      ;(io.messageStore.updateAssistantContent as ReturnType<typeof vi.fn>).mockClear()

      persistAbortExceptionPlanState(state, io)

      expect(io.messageStore.updateAssistantContent).not.toHaveBeenCalled()
      expect(
        publishDeepchatEventMock.mock.calls.some(([eventName]) => eventName === 'chat.plan.updated')
      ).toBe(false)
    })
  })
})
