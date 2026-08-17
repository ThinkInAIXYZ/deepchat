import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DeepChatContextCoordinator,
  type ProviderAttemptToolSurfacePort
} from '@/agent/deepchat/loop/contextCoordinator'
import {
  createLoopRun,
  registerMaterializedSkillContext,
  registerRuntimeSkillContext
} from '@/agent/deepchat/loop/loopRun'
import {
  createFullToolSurfaceRunController,
  type ToolSurfaceSnapshot
} from '@/agent/deepchat/runtime/toolSurface'
import {
  assertProgrammaticToolCapabilityViewActive,
  buildProgrammaticToolCapabilityV1,
  createProgrammaticToolSurfaceRunControllerV1,
  type ProgrammaticToolCapabilityV1
} from '@/agent/deepchat/runtime/programmaticToolSurface'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { hashSkillEffectiveContent } from '@/tape/domain/skillMaterialization'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/core/mcp'
import type { ModelConfig } from '@shared/types/provider'
import { estimateMessagesTokens } from '@/agent/deepchat/runtime/contextBuilder'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'

function createRun(messages: ChatMessage[] = [{ role: 'user', content: 'hello' }]) {
  return createLoopRun({
    runId: 'run-1',
    sessionId: toAppSessionId('session-1'),
    messageId: 'message-1',
    abortController: new AbortController(),
    messages,
    streamState: {},
    resources: {
      toolDefinitions: [],
      activeSkillNames: [],
      commandShell: POSIX_COMMAND_SHELL,
      toolMode: { mode: 'agent', source: 'fallback' }
    },
    initialLogicalRound: 1
  })
}

function agentTool(name: string): MCPToolDefinition {
  return {
    source: 'agent',
    execution: TOOL_EXECUTION.read.parallel,
    type: 'function',
    function: {
      name,
      description: `${name} description`,
      parameters: { type: 'object', properties: {} }
    },
    server: {
      name: 'agent-tools',
      icons: '',
      description: 'Agent tools'
    }
  }
}

function programmaticDefinitions(): MCPToolDefinition[] {
  return [
    {
      source: 'agent',
      execution: TOOL_EXECUTION.write,
      type: 'function',
      function: {
        name: 'exec',
        description: 'Execute a shell command',
        parameters: { type: 'object', properties: {} }
      },
      server: {
        name: 'agent-filesystem',
        icons: '',
        description: 'Agent FileSystem tools'
      }
    },
    {
      source: 'mcp',
      execution: TOOL_EXECUTION.read.parallel,
      type: 'function',
      function: {
        name: 'remote_read',
        description: 'Read remotely',
        parameters: { type: 'object', properties: {} }
      },
      server: {
        id: '66666666-6666-4666-8666-666666666666',
        name: 'remote-tools',
        icons: '',
        description: 'Remote tools',
        configGeneration: 1,
        bindingHash: 'f'.repeat(64)
      },
      raw: { name: 'remote_read', inputSchema: { type: 'object', properties: {} } }
    }
  ]
}

function createProgrammaticToolSurfacePort(definitions: readonly MCPToolDefinition[]): {
  port: ProviderAttemptToolSurfacePort
  build: ReturnType<typeof vi.fn<ProviderAttemptToolSurfacePort['build']>>
  buildCapability: ReturnType<
    typeof vi.fn<NonNullable<ProviderAttemptToolSurfacePort['buildProgrammaticCapability']>>
  >
  admit: ReturnType<typeof vi.fn<ProviderAttemptToolSurfacePort['admit']>>
  snapshots: ToolSurfaceSnapshot[]
  capabilities: ProgrammaticToolCapabilityV1[]
} {
  const controller = createProgrammaticToolSurfaceRunControllerV1({
    ceilingDefinitions: definitions,
    providerActiveDefinitions: definitions.filter((definition) => definition.source === 'agent'),
    policyVersion: 'cli-programmatic-test-v1'
  })
  const snapshots: ToolSurfaceSnapshot[] = []
  const capabilities: ProgrammaticToolCapabilityV1[] = []
  const build = vi.fn<ProviderAttemptToolSurfacePort['build']>(({ requestSeq, tools }) => {
    const snapshot = controller.build({
      request: {
        sessionId: 'session-1',
        messageId: 'message-1',
        runId: 'run-1',
        requestSeq
      },
      eligibleDefinitions: tools
    })
    snapshots.push(snapshot)
    return snapshot
  })
  const buildCapability = vi.fn<
    NonNullable<ProviderAttemptToolSurfacePort['buildProgrammaticCapability']>
  >((snapshot) => {
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
        maxInputBytes: 1024,
        maxOutputBytes: 2048,
        maxDurationMs: 30_000
      }
    })
    capabilities.push(capability)
    return capability
  })
  const admit = vi.fn<ProviderAttemptToolSurfacePort['admit']>(({ snapshot }) => {
    controller.admit(snapshot)
  })
  return {
    port: {
      build,
      buildProgrammaticCapability: buildCapability,
      admit,
      releaseActivationCandidates: (candidates) => controller.stageActivationBatch(candidates)
    },
    build,
    buildCapability,
    admit,
    snapshots,
    capabilities
  }
}

function createFullToolSurfacePort(definitions: readonly MCPToolDefinition[]): {
  port: ProviderAttemptToolSurfacePort
  build: ReturnType<typeof vi.fn<ProviderAttemptToolSurfacePort['build']>>
  admit: ReturnType<typeof vi.fn<ProviderAttemptToolSurfacePort['admit']>>
  snapshots: ToolSurfaceSnapshot[]
} {
  const controller = createFullToolSurfaceRunController({
    ceilingDefinitions: definitions,
    initialActiveDefinitions: [...definitions].reverse(),
    policyVersion: 'full-test-v1'
  })
  const snapshots: ToolSurfaceSnapshot[] = []
  const build = vi.fn<ProviderAttemptToolSurfacePort['build']>(({ requestSeq, tools }) => {
    const snapshot = controller.build({
      request: {
        sessionId: 'session-1',
        messageId: 'message-1',
        runId: 'run-1',
        requestSeq
      },
      eligibleDefinitions: tools
    })
    snapshots.push(snapshot)
    return snapshot
  })
  const admit = vi.fn<ProviderAttemptToolSurfacePort['admit']>(({ snapshot }) => {
    controller.admit(snapshot)
  })
  const releaseActivationCandidates: ProviderAttemptToolSurfacePort['releaseActivationCandidates'] =
    (candidates) => controller.stageActivationBatch(candidates)
  return {
    port: { build, admit, releaseActivationCandidates },
    build,
    admit,
    snapshots
  }
}

function expectedAttemptOutcome(overrides: Record<string, unknown> = {}) {
  return {
    logicalRound: 1,
    requestSeq: 1,
    physicalAttempt: 1,
    requestOrigin: 'chat',
    attemptOrigin: 'initial',
    status: 'completed',
    stopReason: 'complete',
    failureClassification: null,
    retryDecision: 'none',
    httpStatus: null,
    errorCode: null,
    retryDelayMs: null,
    usage: null,
    contextPressure: null,
    ...overrides
  }
}

function createPreflight(
  messages: ChatMessage[],
  overrides: Partial<{
    fitsWithinContext: boolean
    requiresContextPressureRecovery: boolean
    requestedMaxTokens: number
    effectiveMaxTokens: number
  }> = {}
) {
  return {
    messages,
    contextLength: 1_000,
    inputTokens: 10,
    toolReserveTokens: 0,
    requestedMaxTokens: overrides.requestedMaxTokens ?? 100,
    effectiveMaxTokens: overrides.effectiveMaxTokens ?? 100,
    usableContextLength: 1_000,
    remainingOutputTokens: 990,
    totalRequestTokens: 110,
    fitsWithinContext: overrides.fitsWithinContext ?? true,
    shrunkByContextPressure: overrides.requiresContextPressureRecovery ?? false,
    requiresContextPressureRecovery: overrides.requiresContextPressureRecovery ?? false
  }
}

async function collect(stream: AsyncGenerator<LLMCoreStreamEvent>) {
  const events: LLMCoreStreamEvent[] = []
  for await (const event of stream) {
    events.push(event)
  }
  return events
}

function createClosedToolUnit(
  toolCallId: string,
  toolName: string,
  content: string
): ChatMessage[] {
  return [
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: toolCallId,
          type: 'function',
          function: { name: toolName, arguments: '{}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: toolCallId, content }
  ]
}

function createAttemptInput(options?: {
  providerEvents?: LLMCoreStreamEvent[][]
  providerAttempts?: Array<{ events?: LLMCoreStreamEvent[]; error?: unknown }>
  appendManifest?: (manifest: any) => void
  assertAuthority?: (authority: any, attempt: number) => void
  buildExecutionContract?: (input: any) => any
  executionContract?: false
  tools?: MCPToolDefinition[]
  toolSurface?: ProviderAttemptToolSurfacePort
  viewContext?: false
  strictViewContract?: boolean
  requireDurableManifest?: boolean
}) {
  const run = createRun()
  const order: string[] = []
  const manifests: any[] = []
  const providerRequests: any[] = []
  const manifestContractRefs: any[] = []
  const manifestToolRefs: any[] = []
  const manifestToolSurfaceRefs: any[] = []
  const manifestProgrammaticCapabilityRefs: any[] = []
  const providerContractRefs: any[] = []
  const providerToolSurfaceRefs: any[] = []
  const providerToolRefs: any[] = []
  const contractBuildInputs: any[] = []
  const contractToolRefs: any[] = []
  const executionContractErrors: unknown[] = []
  const manifestErrors: unknown[] = []
  const manifestErrorContexts: unknown[] = []
  const authorityChecks: any[] = []
  const outcomes: any[] = []
  const outcomeErrors: unknown[] = []
  const providerAttempts =
    options?.providerAttempts ??
    (
      options?.providerEvents ?? [
        [
          { type: 'text', content: 'ok' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    ).map((events) => ({ events }))
  let providerAttempt = 0
  let waiting = false
  const actualRateClears: string[] = []

  return {
    run,
    order,
    manifests,
    providerRequests,
    manifestContractRefs,
    manifestToolRefs,
    manifestToolSurfaceRefs,
    manifestProgrammaticCapabilityRefs,
    providerContractRefs,
    providerToolSurfaceRefs,
    providerToolRefs,
    contractBuildInputs,
    contractToolRefs,
    executionContractErrors,
    manifestErrors,
    manifestErrorContexts,
    authorityChecks,
    outcomes,
    outcomeErrors,
    actualRateClears,
    input: {
      run,
      requestMessages: run.messages,
      providerId: 'provider-1',
      modelId: 'model-1',
      modelConfig: { contextLength: 1_000 } as ModelConfig,
      temperature: 0.4,
      maxTokens: 100,
      tools: options?.tools ?? [],
      ...(options?.toolSurface ? { toolSurface: options.toolSurface } : {}),
      allowTransientRetry: true,
      bypassContextBudget: false,
      fallbackContextLength: 1_000,
      supportsVision: true,
      supportsAudioInput: true,
      traceDebugEnabled: true,
      strictViewContract: options?.strictViewContract,
      requireDurableManifest: options?.requireDurableManifest,
      viewContext:
        options?.viewContext === false
          ? undefined
          : {
              taskType: 'chat' as const,
              policy: 'legacy_context_v1' as const,
              policyVersion: 1,
              selection: { id: 'initial-selection' },
              summaryCursorOrderSeq: 3,
              supportsVision: false,
              supportsAudioInput: false,
              traceDebugEnabled: false
            },
      budget: {
        estimateToolReserveTokens: () => 0,
        preflight: ({
          messages,
          requestedMaxTokens
        }: {
          messages: ChatMessage[]
          requestedMaxTokens: number
        }) =>
          createPreflight(messages, {
            requestedMaxTokens,
            effectiveMaxTokens: requestedMaxTokens
          }),
        fitStrictRetry: ({ messages }: { messages: ChatMessage[] }) => messages,
        getStrictRetryMaxTokens: (maxTokens: number) => Math.floor(maxTokens / 2),
        getStrictRetryExtraReserve: () => 25,
        buildOverflowError: () => new Error('cannot fit'),
        buildOverflowAfterRecoveryError: () => new Error('provider still overflowed')
      },
      recovery: {
        recover: vi.fn(async ({ requestMessages }: { requestMessages: ChatMessage[] }) => ({
          messages: requestMessages
        }))
      },
      ...(options?.executionContract === false
        ? {}
        : {
            executionContract: {
              build: (input: any) => {
                contractToolRefs.push(input.tools)
                contractBuildInputs.push(structuredClone(input))
                return options?.buildExecutionContract
                  ? options.buildExecutionContract(input)
                  : {
                      request: {
                        sessionId: run.sessionId,
                        messageId: run.messageId,
                        runId: run.runId,
                        requestSeq: input.requestSeq
                      }
                    }
              },
              onBuildError: (error: unknown) => executionContractErrors.push(error)
            }
          }),
      manifest: {
        resolvePolicy: ({ recoveredFromContextPressure, viewPolicy, viewPolicyVersion }: any) => ({
          policy: recoveredFromContextPressure
            ? ('context_pressure_recovery_shadow' as const)
            : (viewPolicy ?? ('tool_loop_shadow' as const)),
          policyVersion: viewPolicyVersion ?? null
        }),
        append: (manifest: any) => {
          order.push(`manifest:${manifest.requestSeq}`)
          manifestContractRefs.push(manifest.executionContract)
          manifestToolRefs.push(manifest.tools)
          manifestToolSurfaceRefs.push(manifest.toolSurfaceSnapshot)
          manifestProgrammaticCapabilityRefs.push(manifest.programmaticToolCapability)
          manifests.push(structuredClone(manifest))
          options?.appendManifest?.(manifest)
          return {
            manifestHash: 'a'.repeat(64),
            ...(manifest.tapeIncarnationId ? { tapeIncarnationId: manifest.tapeIncarnationId } : {})
          }
        },
        onAppendError: (error: unknown, context: unknown) => {
          manifestErrors.push(error)
          manifestErrorContexts.push(context)
        }
      },
      authority: {
        assertCurrent: ({ authority }: any) => {
          order.push(`authority:${authority.requestSeq}`)
          authorityChecks.push(structuredClone(authority))
          options?.assertAuthority?.(authority, authorityChecks.length)
        }
      },
      rateGate: {
        beforeWait: () => order.push('before-rate'),
        wait: async () => {
          waiting = true
          order.push('rate')
        },
        clearWaiting: () => {
          if (!waiting) return
          waiting = false
          actualRateClears.push('clear')
          order.push('rate-clear')
        }
      },
      provider: {
        stream: async function* (request: any) {
          order.push('provider')
          providerContractRefs.push(request.executionContract)
          providerToolSurfaceRefs.push(request.toolSurfaceSnapshot)
          providerToolRefs.push(request.tools)
          const { signal, ...serializableRequest } = request
          providerRequests.push({ ...structuredClone(serializableRequest), signal })
          const attempt = providerAttempts[providerAttempt++] ?? { events: [] }
          for (const event of attempt.events ?? []) {
            yield event
          }
          if ('error' in attempt) {
            throw attempt.error
          }
        },
        beforeStream: () => order.push('before-provider')
      },
      outcome: {
        append: (outcome: any) => {
          order.push(`outcome:${outcome.requestSeq}`)
          outcomes.push(structuredClone(outcome))
        },
        onAppendError: (error: unknown) => outcomeErrors.push(error)
      },
      isContextOverflowEvent: (event: LLMCoreStreamEvent) =>
        event.type === 'error' && event.error_message === 'context overflow',
      isContextOverflowError: (error: unknown) =>
        error instanceof Error && error.message === 'context overflow',
      createAbortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
  }
}

function registerMessageSkill(
  fixture: ReturnType<typeof createAttemptInput>,
  skillName = 'skill-1'
) {
  const effectiveContent = 'Follow only this turn instruction.'
  const completeBodyFragment = `### ${skillName}\n${effectiveContent}`
  const contentHash = hashSkillEffectiveContent(effectiveContent)
  fixture.run.resources.tapeIncarnationId = 'incarnation-1'
  fixture.run.messages[0] = {
    role: 'user',
    content: `## Skills Selected for This Turn\n\n${completeBodyFragment}\n\nhello`
  }
  const context = {
    activationScope: 'message' as const,
    agentId: 'agent-1',
    sourceType: 'created' as const,
    sourceId: `/skills/${skillName}`,
    skillName,
    authoritativeRef: {
      kind: 'context' as const,
      entryId: 13,
      provenanceKey: `skill-materialization:v1:${skillName}`,
      payloadHash: 'a'.repeat(64)
    },
    providerRole: 'user' as const,
    sourceEntryIds: [7],
    projectedContentHash: contentHash,
    projectionVersion: 1 as const,
    deduplicationSource: 'message' as const
  }
  registerMaterializedSkillContext(fixture.run, {
    tapeIncarnationId: 'incarnation-1',
    effectiveContent,
    completeBodyFragment,
    providerMessageIndex: 0,
    context
  })
  return context
}

describe('DeepChatContextCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('assembles post-compaction prompt before building the effective view', async () => {
    const order: string[] = []
    const prepared = await new DeepChatContextCoordinator().assemble({
      assembleContributions: async () => {
        order.push('post')
        return { checkpoint: 'checkpoint' }
      },
      buildView: (contributions) => {
        order.push(`view:${contributions.checkpoint}`)
        return { messages: [{ role: 'user', content: contributions.checkpoint }] }
      },
      assertCurrent: () => order.push('check')
    })

    expect(order).toEqual(['post', 'check', 'view:checkpoint'])
    expect(prepared).toEqual({
      contributions: { checkpoint: 'checkpoint' },
      view: { messages: [{ role: 'user', content: 'checkpoint' }] }
    })
  })

  it('does not rebuild or fit pressure context when there is no compaction intent', async () => {
    const assembleCheckpoint = vi.fn()
    const rebuildAfterCompaction = vi.fn()
    const fit = vi.fn()
    const messages: ChatMessage[] = [{ role: 'user', content: 'unchanged' }]

    const recovered = await new DeepChatContextCoordinator().recoverFromPressure({
      requestMessages: messages,
      requestedMaxTokens: 100,
      toolReserveTokens: 20,
      minimumProtectedTailCount: 0,
      contextContributions: {
        checkpoint: { message: null, contributions: [] },
        memory: { content: null, manifest: null, anchorEntryId: null },
        directives: { content: null, manifest: null, anchorEntryId: null },
        memoryIncluded: false,
        directivesIncluded: false
      },
      prepareCompaction: async () => ({ applied: false as const }),
      assembleCheckpoint,
      getSummaryCursorOrderSeq: () => 1,
      rebuildAfterCompaction,
      fit,
      measure: (candidate) => JSON.stringify(candidate).length,
      assertCurrent: vi.fn()
    })

    expect(recovered).toEqual({ messages })
    expect(assembleCheckpoint).not.toHaveBeenCalled()
    expect(rebuildAfterCompaction).not.toHaveBeenCalled()
    expect(fit).not.toHaveBeenCalled()
  })

  it('rebuilds and fits pressure context only after compaction normally returns', async () => {
    const order: string[] = []
    const oldCheckpoint = { role: 'user' as const, content: 'old checkpoint' }
    const contextContributions = {
      checkpoint: { message: oldCheckpoint, contributions: [] },
      memory: { content: null, manifest: null, anchorEntryId: null },
      directives: { content: null, manifest: null, anchorEntryId: null },
      memoryIncluded: false,
      directivesIncluded: false
    }
    const recovered = await new DeepChatContextCoordinator().recoverFromPressure({
      requestMessages: [
        { role: 'system', content: 'old system' },
        oldCheckpoint,
        { role: 'assistant', content: 'old history' },
        { role: 'user', content: 'latest' }
      ],
      requestedMaxTokens: 100,
      toolReserveTokens: 20,
      minimumProtectedTailCount: 1,
      contextContributions,
      prepareCompaction: async (systemPrompt) => {
        order.push(`compact:${systemPrompt}`)
        return { applied: true as const, summary: { cursor: 9 } }
      },
      assembleCheckpoint: async () => {
        order.push('checkpoint')
        return {
          message: { role: 'user', content: 'new checkpoint' },
          contributions: []
        }
      },
      getSummaryCursorOrderSeq: (summary) => summary.cursor,
      rebuildAfterCompaction: ({ requestMessages }) => ({
        messages: [
          requestMessages[0],
          contextContributions.checkpoint.message!,
          ...requestMessages.slice(2)
        ],
        pinnedFirstUserContentHash: 'rebuilt-pin-hash'
      }),
      fit: ({ messages, reserveTokens, minimumProtectedTailCount, pinnedFirstUserContentHash }) => {
        order.push(
          `fit:${reserveTokens}:${minimumProtectedTailCount}:${pinnedFirstUserContentHash}`
        )
        return messages.filter(
          (message) => !(message.role === 'assistant' && message.content === 'old history')
        )
      },
      measure: (candidate) => JSON.stringify(candidate).length,
      assertCurrent: () => order.push('check')
    })

    expect(order).toEqual([
      'check',
      'compact:old system',
      'check',
      'checkpoint',
      'check',
      'fit:120:1:rebuilt-pin-hash'
    ])
    expect(recovered).toEqual({
      messages: [
        { role: 'system', content: 'old system' },
        { role: 'user', content: 'new checkpoint' },
        { role: 'user', content: 'latest' }
      ],
      summaryCursorOrderSeq: 9,
      syntheticContributions: []
    })
  })

  it('does not report recovery when the derived view is not smaller', async () => {
    const oldCheckpoint = { role: 'user' as const, content: 'old checkpoint' }
    const messages: ChatMessage[] = [oldCheckpoint, { role: 'user', content: 'latest' }]
    const contextContributions = {
      checkpoint: { message: oldCheckpoint, contributions: [] },
      memory: { content: null, manifest: null, anchorEntryId: null },
      directives: { content: null, manifest: null, anchorEntryId: null },
      memoryIncluded: false,
      directivesIncluded: false
    }

    const recovered = await new DeepChatContextCoordinator().recoverFromPressure({
      requestMessages: messages,
      requestedMaxTokens: 100,
      toolReserveTokens: 20,
      minimumProtectedTailCount: 1,
      contextContributions,
      prepareCompaction: async () => ({
        applied: true as const,
        summary: { cursor: 9 }
      }),
      assembleCheckpoint: async () => ({
        message: { role: 'user', content: 'new checkpoint with no reduction' },
        contributions: []
      }),
      getSummaryCursorOrderSeq: (summary) => summary.cursor,
      rebuildAfterCompaction: ({ requestMessages }) => ({
        messages: [contextContributions.checkpoint.message!, ...requestMessages.slice(1)]
      }),
      fit: ({ messages: candidate }) => candidate,
      measure: (candidate) => JSON.stringify(candidate).length,
      assertCurrent: vi.fn()
    })

    expect(recovered).toEqual({ messages })
    expect(contextContributions.checkpoint.message).toBe(oldCheckpoint)
  })

  it('attempts the ViewManifest before rate admission and sends the exact manifested request', async () => {
    const fixture = createAttemptInput()
    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      { type: 'text', content: 'ok' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.order).toEqual([
      'manifest:1',
      'before-rate',
      'rate',
      'rate-clear',
      'before-provider',
      'provider',
      'outcome:1'
    ])
    expect(fixture.manifests[0].messages).toEqual(fixture.providerRequests[0].messages)
    expect(fixture.manifestContractRefs[0]).toBe(fixture.providerContractRefs[0])
    expect(fixture.manifestToolRefs[0]).toBe(fixture.input.tools)
    expect(fixture.contractToolRefs[0]).toBe(fixture.input.tools)
    expect(fixture.providerToolRefs[0]).toBe(fixture.input.tools)
    expect(fixture.manifestToolSurfaceRefs).toEqual([null])
    expect(fixture.providerToolSurfaceRefs).toEqual([null])
    expect(fixture.run.activeRequestContract).toEqual({
      requestSeq: 1,
      executionContract: fixture.providerContractRefs[0]
    })
    expect(fixture.run.activeRequestToolSurface).toBeNull()
    expect(fixture.providerRequests[0]).toMatchObject({
      identity: { logicalRound: 1, requestSeq: 1, physicalAttempt: 1 },
      requestOrigin: 'chat',
      attemptOrigin: 'initial',
      signal: fixture.run.abortController.signal
    })
    expect(fixture.manifests[0]).toMatchObject({
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      selection: { id: 'initial-selection' },
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false
    })
    expect(fixture.run.requestSeq).toBe(1)
    expect(fixture.actualRateClears).toEqual(['clear'])
    expect(fixture.authorityChecks).toEqual([])
  })

  it('durably binds a projected runtime Skill result to its provider request occurrence', async () => {
    const fixture = createAttemptInput()
    const responseText = '{"success":true,"content":"effective Skill body"}'
    const contentHash = hashSkillEffectiveContent(responseText)
    fixture.run.resources.tapeIncarnationId = 'incarnation-1'
    fixture.run.messages.push({
      role: 'tool',
      tool_call_id: 'tool-call-1',
      content: responseText
    })
    const identity = {
      agentId: 'agent-1',
      sourceType: 'created' as const,
      sourceId: '/skills/skill-1',
      skillName: 'skill-1'
    }
    registerRuntimeSkillContext(fixture.run, {
      identity,
      toolCallId: 'tool-call-1',
      entryId: 12,
      tapeIncarnationId: 'incarnation-1',
      contentHash,
      executionRef: {
        kind: 'materialization',
        entryId: 11,
        tapeIncarnationId: 'incarnation-1',
        ...identity,
        effectiveContentHash: hashSkillEffectiveContent('effective Skill body')
      }
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.manifests[0]).toMatchObject({
      runId: 'run-1',
      tapeIncarnationId: 'incarnation-1',
      requireDurableManifest: true,
      skillContexts: [
        {
          activationScope: 'runtime_view',
          skillName: 'skill-1',
          projectedContentHash: contentHash,
          authoritativeRef: {
            kind: 'tool_result',
            entryId: 12,
            contentHash
          }
        }
      ]
    })
    expect(fixture.manifests[0].messages).toEqual(fixture.providerRequests[0].messages)
    expect(fixture.run.activeRequestView).toEqual({
      requestSeq: 1,
      manifestHash: 'a'.repeat(64),
      tapeIncarnationId: 'incarnation-1'
    })
  })

  it('durably binds a materialized message Skill to the exact provider projection', async () => {
    const fixture = createAttemptInput({
      assertAuthority: (authority) => {
        expect(Object.isFrozen(authority)).toBe(true)
        expect(Object.isFrozen(authority.skillContexts)).toBe(true)
        expect(Object.isFrozen(authority.skillContexts[0])).toBe(true)
        expect(Object.isFrozen(authority.skillContexts[0].sourceEntryIds)).toBe(true)
        expect(Object.isFrozen(authority.skillContexts[0].authoritativeRef)).toBe(true)
      }
    })
    const context = registerMessageSkill(fixture)

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.manifests[0]).toMatchObject({
      runId: 'run-1',
      tapeIncarnationId: 'incarnation-1',
      requireDurableManifest: true,
      skillContexts: [
        {
          activationScope: 'message',
          skillName: 'skill-1',
          sourceEntryIds: [7],
          projectedContentHash: context.projectedContentHash,
          authoritativeRef: {
            kind: 'context',
            entryId: 13,
            provenanceKey: 'skill-materialization:v1:skill-1'
          }
        }
      ]
    })
    expect(fixture.authorityChecks).toEqual([
      {
        sessionId: 'session-1',
        messageId: 'message-1',
        runId: 'run-1',
        requestSeq: 1,
        manifestHash: 'a'.repeat(64),
        tapeIncarnationId: 'incarnation-1',
        skillContexts: [context]
      }
    ])
    expect(fixture.order).toEqual([
      'manifest:1',
      'before-rate',
      'rate',
      'rate-clear',
      'before-provider',
      'authority:1',
      'provider',
      'outcome:1'
    ])
  })

  it('fails closed when Skill authority drifts after rate admission', async () => {
    let rateAdmissionCompleted = false
    const fixture = createAttemptInput({
      assertAuthority: () => {
        expect(rateAdmissionCompleted).toBe(true)
        throw new Error('Skill authority drifted during rate wait')
      }
    })
    registerMessageSkill(fixture)
    const wait = fixture.input.rateGate.wait
    fixture.input.rateGate.wait = async (signal: AbortSignal) => {
      await wait(signal)
      rateAdmissionCompleted = true
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow('Skill authority drifted during rate wait')

    expect(fixture.authorityChecks).toHaveLength(1)
    expect(fixture.providerRequests).toEqual([])
    expect(fixture.outcomes).toEqual([])
    expect(fixture.run.physicalAttempt).toBe(0)
  })

  it('revalidates the same Skill authority before every transient retry attempt', async () => {
    const transientError = Object.assign(new Error('fetch failed'), {
      code: 'ECONNRESET',
      headers: { 'retry-after-ms': '0' }
    })
    const fixture = createAttemptInput({
      providerAttempts: [
        { error: transientError },
        {
          events: [
            { type: 'text', content: 'must not be sent' },
            { type: 'stop', stop_reason: 'complete' }
          ]
        }
      ],
      assertAuthority: (_authority, attempt) => {
        if (attempt === 2) throw new Error('Skill authority drifted during retry delay')
      }
    })
    registerMessageSkill(fixture)

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow('Skill authority drifted during retry delay')

    expect(fixture.authorityChecks.map(({ requestSeq }) => requestSeq)).toEqual([1, 1])
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.run.physicalAttempt).toBe(1)
    expect(fixture.outcomes).toHaveLength(1)
    expect(fixture.outcomes[0]).toMatchObject({ retryDecision: 'retry_scheduled' })
  })

  it('revalidates the new Skill manifest after context-overflow recovery', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    registerMessageSkill(fixture)
    const optionalHistory: ChatMessage = { role: 'assistant', content: 'optional history' }
    fixture.input.requestMessages.push(optionalHistory)
    fixture.input.budget.fitStrictRetry = vi.fn(({ messages }) =>
      messages.filter((message) => message !== optionalHistory)
    )

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.manifests.map(({ requestSeq }) => requestSeq)).toEqual([1, 2])
    expect(fixture.authorityChecks.map(({ requestSeq }) => requestSeq)).toEqual([1, 2])
    expect(fixture.providerRequests.map(({ identity }) => identity.requestSeq)).toEqual([1, 2])
  })

  it('prevents provider admission when a runtime Skill manifest cannot be committed', async () => {
    const fixture = createAttemptInput({
      appendManifest: () => {
        throw new Error('manifest unavailable')
      }
    })
    const responseText = '{"success":true,"content":"effective Skill body"}'
    fixture.run.resources.tapeIncarnationId = 'incarnation-1'
    fixture.run.messages.push({
      role: 'tool',
      tool_call_id: 'tool-call-1',
      content: responseText
    })
    const identity = {
      agentId: 'agent-1',
      sourceType: 'created' as const,
      sourceId: '/skills/skill-1',
      skillName: 'skill-1'
    }
    registerRuntimeSkillContext(fixture.run, {
      identity,
      toolCallId: 'tool-call-1',
      entryId: 12,
      tapeIncarnationId: 'incarnation-1',
      contentHash: hashSkillEffectiveContent(responseText),
      executionRef: {
        kind: 'materialization',
        entryId: 11,
        tapeIncarnationId: 'incarnation-1',
        ...identity,
        effectiveContentHash: hashSkillEffectiveContent('effective Skill body')
      }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow('manifest unavailable')
    expect(fixture.providerRequests).toEqual([])
    expect(fixture.order).toEqual(['manifest:1'])
    expect(fixture.manifestErrors).toHaveLength(1)
  })

  it('binds one immutable Tool Surface across a manifested View and its transient retries', async () => {
    const tools = [agentTool('read'), agentTool('write')]
    const surface = createFullToolSurfacePort(tools)
    const transientError = Object.assign(new Error('fetch failed'), {
      code: 'ECONNRESET',
      headers: { 'retry-after-ms': '0' }
    })
    const fixture = createAttemptInput({
      tools,
      toolSurface: surface.port,
      providerAttempts: [
        { error: transientError },
        {
          events: [
            { type: 'text', content: 'recovered' },
            { type: 'stop', stop_reason: 'complete' }
          ]
        }
      ]
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(surface.build).toHaveBeenCalledOnce()
    expect(surface.build).toHaveBeenCalledWith({ requestSeq: 1, tools })
    expect(surface.snapshots).toHaveLength(1)
    const [snapshot] = surface.snapshots
    expect(surface.admit).toHaveBeenCalledOnce()
    expect(surface.admit).toHaveBeenCalledWith({ requestSeq: 1, snapshot })
    expect(snapshot.toolDefinitions.map((tool) => tool.function.name)).toEqual(['write', 'read'])
    expect(fixture.manifestToolRefs[0]).toBe(snapshot.toolDefinitions)
    expect(fixture.manifestToolSurfaceRefs).toEqual([snapshot])
    expect(Object.isFrozen(fixture.manifestToolRefs[0])).toBe(true)
    expect(fixture.manifestToolRefs).toEqual([fixture.contractToolRefs[0]])
    expect(fixture.providerToolRefs[0]).toBe(fixture.contractToolRefs[0])
    expect(fixture.providerToolRefs[1]).toBe(fixture.contractToolRefs[0])
    expect(
      fixture.providerToolRefs[0].map((tool: MCPToolDefinition) => tool.function.name)
    ).toEqual(['write', 'read'])
    expect(fixture.providerToolSurfaceRefs).toEqual([snapshot, snapshot])
    expect(fixture.run.activeRequestToolSurface).toEqual({
      requestSeq: 1,
      snapshot,
      releaseActivationCandidates: expect.any(Function)
    })
    expect(fixture.run.activeRequestToolSurface?.snapshot).toBe(snapshot)
    expect(fixture.providerRequests.map((request) => request.identity)).toEqual([
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 1 },
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 2 }
    ])
  })

  it('reuses one committed Programmatic capability through transient physical retries', async () => {
    const tools = programmaticDefinitions()
    const surface = createProgrammaticToolSurfacePort(tools)
    const transientError = Object.assign(new Error('fetch failed'), {
      code: 'ECONNRESET',
      headers: { 'retry-after-ms': '0' }
    })
    const fixture = createAttemptInput({
      tools,
      toolSurface: surface.port,
      providerAttempts: [
        { error: transientError },
        {
          events: [
            { type: 'text', content: 'recovered' },
            { type: 'stop', stop_reason: 'complete' }
          ]
        }
      ]
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(surface.build).toHaveBeenCalledOnce()
    expect(surface.buildCapability).toHaveBeenCalledOnce()
    expect(surface.admit).toHaveBeenCalledOnce()
    const [snapshot] = surface.snapshots
    const [capability] = surface.capabilities
    expect(fixture.manifestToolSurfaceRefs).toEqual([snapshot])
    expect(fixture.manifestProgrammaticCapabilityRefs).toEqual([capability])
    expect(fixture.providerToolSurfaceRefs).toEqual([snapshot, snapshot])
    expect(
      fixture.providerToolRefs.map((definitions) =>
        definitions.map((tool: MCPToolDefinition) => tool.function.name)
      )
    ).toEqual([['exec'], ['exec']])
    expect(fixture.run.activeRequestToolSurface?.programmaticCapability).toBe(capability)
    expect(() => assertProgrammaticToolCapabilityViewActive(capability, snapshot)).not.toThrow()
  })

  it('keeps V4 provider fail-open without activating unpersisted Programmatic authority', async () => {
    const tools = programmaticDefinitions()
    const surface = createProgrammaticToolSurfacePort(tools)
    const persistenceError = new Error('programmatic provenance unavailable')
    const fixture = createAttemptInput({
      tools,
      toolSurface: surface.port,
      appendManifest: () => {
        throw persistenceError
      }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'ok' },
      { type: 'stop', stop_reason: 'complete' }
    ])

    const [snapshot] = surface.snapshots
    const [capability] = surface.capabilities
    expect(fixture.manifestErrors).toHaveLength(1)
    expect(fixture.providerRequests).toHaveLength(1)
    expect(
      fixture.providerToolRefs[0].map((tool: MCPToolDefinition) => tool.function.name)
    ).toEqual(['exec'])
    expect(fixture.run.activeRequestContract?.executionContract).toBeNull()
    expect(fixture.run.activeRequestToolSurface).not.toHaveProperty('programmaticCapability')
    expect(() => assertProgrammaticToolCapabilityViewActive(capability, snapshot)).toThrow(
      /committed provider View provenance/
    )
  })

  it('keeps strict V5 Programmatic provenance failure before provider admission', async () => {
    const tools = programmaticDefinitions()
    const surface = createProgrammaticToolSurfacePort(tools)
    const fixture = createAttemptInput({
      tools,
      toolSurface: surface.port,
      strictViewContract: true,
      appendManifest: () => {
        throw new Error('programmatic provenance unavailable')
      }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow('programmatic provenance unavailable')

    expect(surface.build).toHaveBeenCalledOnce()
    expect(surface.buildCapability).toHaveBeenCalledOnce()
    expect(surface.admit).not.toHaveBeenCalled()
    expect(fixture.providerRequests).toHaveLength(0)
    expect(fixture.order).not.toContain('rate')
    expect(fixture.manifestErrorContexts).toEqual([
      {
        requestSeq: 1,
        failurePolicy: 'fail-closed',
        toolSurfaceApplicable: true,
        verified: false
      }
    ])
    expect(fixture.run.activeRequestContract).toBeNull()
    expect(fixture.run.activeRequestToolSurface).toBeNull()
    expect(() =>
      assertProgrammaticToolCapabilityViewActive(surface.capabilities[0], surface.snapshots[0])
    ).toThrow(/committed provider View provenance/)
  })

  it('uses fallback capabilities without a ViewManifest context', async () => {
    const fixture = createAttemptInput({
      viewContext: false,
      providerEvents: [
        [
          { type: 'text', content: 'ok' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.manifests[0]).toMatchObject({
      requestSeq: 1,
      taskType: 'tool_loop',
      supportsVision: true,
      supportsAudioInput: true,
      traceDebugEnabled: true
    })
    expect(fixture.manifests[0].selection).toBeUndefined()
    expect(fixture.outcomes).toEqual([expectedAttemptOutcome({ requestOrigin: 'tool_loop' })])
  })

  it('records the effective preflight context ceiling in the ViewManifest', async () => {
    const fixture = createAttemptInput()
    fixture.input.budget.preflight = vi.fn(({ messages, requestedMaxTokens }) => ({
      ...createPreflight(messages, {
        requestedMaxTokens,
        effectiveMaxTokens: requestedMaxTokens
      }),
      contextLength: 640
    }))

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.manifests[0].tokenBudget.contextLength).toBe(640)
    expect(fixture.input.modelConfig.contextLength).toBe(1_000)
  })

  it('records only the final cumulative usage snapshot for a completed attempt', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: 100,
              completion_tokens: 10,
              total_tokens: 110,
              cached_tokens: 40
            }
          },
          {
            type: 'usage',
            usage: {
              prompt_tokens: 140,
              completion_tokens: 20,
              total_tokens: 160,
              cached_tokens: 120,
              cache_write_tokens: 8
            }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        usage: {
          inputTokens: 140,
          outputTokens: 20,
          totalTokens: 160,
          cacheReadTokens: 120,
          cacheWriteTokens: 8
        }
      })
    ])
  })

  it('anchors provider prompt usage and estimates only an exact-prefix suffix', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: 800,
              completion_tokens: 20,
              total_tokens: 820,
              cached_tokens: 700
            }
          },
          { type: 'stop', stop_reason: 'complete' }
        ],
        [{ type: 'stop', stop_reason: 'complete' }]
      ]
    })
    const originalPreflight = fixture.input.budget.preflight
    fixture.input.budget.preflight = vi.fn(originalPreflight)

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    const suffix: ChatMessage = { role: 'assistant', content: 'new provider-visible suffix' }
    fixture.input.requestMessages.push(suffix)
    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.input.budget.preflight).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        promptTokenEstimate: 800 + estimateMessagesTokens([suffix])
      })
    )
    expect(fixture.run.promptUsageAnchor).toMatchObject({
      providerId: 'provider-1',
      modelId: 'model-1',
      promptTokens: 800,
      cacheReadTokens: 700
    })
  })

  it('keeps a usage anchor valid when context pressure reduces only the effective output cap', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 800, completion_tokens: 20, total_tokens: 820 }
          },
          { type: 'stop', stop_reason: 'complete' }
        ],
        [{ type: 'stop', stop_reason: 'complete' }]
      ]
    })
    fixture.input.budget.preflight = vi.fn(({ messages, requestedMaxTokens }) =>
      createPreflight(messages, {
        requestedMaxTokens,
        effectiveMaxTokens: 20
      })
    )

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    const suffix: ChatMessage = { role: 'assistant', content: 'new suffix' }
    fixture.input.requestMessages.push(suffix)
    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.input.budget.preflight).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        promptTokenEstimate: 800 + estimateMessagesTokens([suffix])
      })
    )
    expect(fixture.providerRequests.map(({ maxTokens }) => maxTokens)).toEqual([20, 20])
  })

  it('does not anchor usage for a fitted projection that differs from the continuation view', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 400, completion_tokens: 10, total_tokens: 410 }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    fixture.input.requestMessages.unshift({ role: 'assistant', content: 'trimmed history' })
    fixture.input.budget.preflight = vi.fn(({ messages, requestedMaxTokens }) =>
      createPreflight(messages.slice(1), { requestedMaxTokens })
    )

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.providerRequests[0].messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(fixture.run.promptUsageAnchor).toBeNull()
  })

  it('does not anchor usage when cache-read tokens exceed total prompt tokens', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: 100,
              completion_tokens: 10,
              total_tokens: 110,
              cached_tokens: 120
            }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.run.promptUsageAnchor).toBeNull()
  })

  it('does not anchor an ambiguous zero-token usage snapshot', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.run.promptUsageAnchor).toBeNull()
  })

  it.each([
    [
      'provider',
      (fixture: ReturnType<typeof createAttemptInput>) => (fixture.input.providerId = 'p2')
    ],
    ['model', (fixture: ReturnType<typeof createAttemptInput>) => (fixture.input.modelId = 'm2')],
    [
      'model config',
      (fixture: ReturnType<typeof createAttemptInput>) =>
        (fixture.input.modelConfig = { contextLength: 2_000 } as ModelConfig)
    ],
    [
      'temperature',
      (fixture: ReturnType<typeof createAttemptInput>) => (fixture.input.temperature = 0.7)
    ],
    [
      'max tokens',
      (fixture: ReturnType<typeof createAttemptInput>) => (fixture.input.maxTokens = 120)
    ],
    [
      'tool schema',
      (fixture: ReturnType<typeof createAttemptInput>) =>
        (fixture.input.tools = [
          {
            type: 'function',
            function: {
              name: 'inspect',
              description: 'Inspect data',
              parameters: { type: 'object', properties: {} }
            },
            server: { name: 'test', icons: '', description: '' }
          }
        ])
    ],
    [
      'message prefix',
      (fixture: ReturnType<typeof createAttemptInput>) =>
        (fixture.input.requestMessages[0] = { role: 'user', content: 'changed prefix' })
    ]
  ])('invalidates a prompt usage anchor after %s drift', async (_label, mutate) => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 800, completion_tokens: 0, total_tokens: 800 }
          },
          { type: 'stop', stop_reason: 'complete' }
        ],
        [{ type: 'stop', stop_reason: 'complete' }]
      ]
    })
    const originalPreflight = fixture.input.budget.preflight
    fixture.input.budget.preflight = vi.fn(originalPreflight)

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    mutate(fixture)
    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.input.budget.preflight).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({ promptTokenEstimate: expect.any(Number) })
    )
  })

  it('keeps an actual provider attempt fail-open when ViewManifest persistence throws', async () => {
    const fixture = createAttemptInput({
      appendManifest: () => {
        throw new Error('manifest unavailable')
      }
    })
    fixture.input.manifest.onAppendError = (error: unknown) => {
      fixture.manifestErrors.push(error)
      throw new Error('manifest error reporting unavailable')
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'ok' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.providerRequests[0].executionContract).toBeNull()
    expect(fixture.run.activeRequestContract).toEqual({
      requestSeq: 1,
      executionContract: null
    })
    expect(fixture.manifestErrors).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          'ExecutionContract disabled for request 1 because durable provider View provenance could not be confirmed'
        )
      })
    ])
  })

  it('keeps an ordinary Tool Surface fail-open when atomic View persistence throws', async () => {
    const tools = [agentTool('read')]
    const surface = createFullToolSurfacePort(tools)
    const fixture = createAttemptInput({
      tools,
      toolSurface: surface.port,
      executionContract: false,
      appendManifest: () => {
        throw new Error('surface provenance unavailable')
      }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'ok' },
      { type: 'stop', stop_reason: 'complete' }
    ])

    expect(surface.build).toHaveBeenCalledOnce()
    expect(surface.admit).toHaveBeenCalledOnce()
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.providerToolSurfaceRefs[0]).toBe(surface.snapshots[0])
    expect(fixture.contractBuildInputs).toEqual([])
    expect(fixture.run.activeRequestContract).toEqual({
      requestSeq: 1,
      executionContract: null
    })
    expect(fixture.manifestErrors).toEqual([
      expect.objectContaining({
        message: 'surface provenance unavailable'
      })
    ])
    expect(fixture.manifestErrorContexts).toEqual([
      {
        requestSeq: 1,
        failurePolicy: 'fail-open',
        toolSurfaceApplicable: true,
        verified: false
      }
    ])
  })

  it('reuses one null contract decision across transient retries after manifest failure', async () => {
    const transientError = Object.assign(new Error('fetch failed'), {
      code: 'ECONNRESET',
      headers: { 'retry-after-ms': '0' }
    })
    const fixture = createAttemptInput({
      appendManifest: () => {
        throw new Error('manifest unavailable')
      },
      providerAttempts: [
        { error: transientError },
        {
          events: [
            { type: 'text', content: 'recovered' },
            { type: 'stop', stop_reason: 'complete' }
          ]
        }
      ]
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.manifests).toHaveLength(1)
    expect(fixture.contractBuildInputs).toHaveLength(1)
    expect(fixture.providerRequests.map((request) => request.identity)).toEqual([
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 1 },
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 2 }
    ])
    expect(fixture.providerContractRefs).toEqual([null, null])
    expect(fixture.run.activeRequestContract).toEqual({
      requestSeq: 1,
      executionContract: null
    })
  })

  it('requires Skill-bearing manifest durability without requiring an ExecutionContract', async () => {
    const optionalContract = createAttemptInput({
      requireDurableManifest: true,
      buildExecutionContract: () => {
        throw new Error('optional contract unavailable')
      }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(optionalContract.input))
    ).resolves.toEqual([
      { type: 'text', content: 'ok' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(optionalContract.manifests).toHaveLength(1)
    expect(optionalContract.manifests[0].executionContract).toBeUndefined()
    expect(optionalContract.providerRequests[0].executionContract).toBeNull()

    const missingManifest = createAttemptInput({
      requireDurableManifest: true,
      appendManifest: () => {
        throw new Error('required Skill manifest unavailable')
      }
    })
    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(missingManifest.input))
    ).rejects.toThrow('required Skill manifest unavailable')
    expect(missingManifest.providerRequests).toHaveLength(0)
    expect(missingManifest.order).not.toContain('rate')
  })

  it.each([
    {
      name: 'contract construction',
      create: () =>
        createAttemptInput({
          strictViewContract: true,
          buildExecutionContract: () => {
            throw new Error('contract unavailable')
          }
        }),
      message: 'contract unavailable',
      manifestAttempts: 0
    },
    {
      name: 'manifest persistence',
      create: () =>
        createAttemptInput({
          strictViewContract: true,
          appendManifest: () => {
            throw new Error('manifest unavailable')
          }
        }),
      message: 'manifest unavailable',
      manifestAttempts: 1
    }
  ])('fails a strict child View before provider admission on $name failure', async (scenario) => {
    const fixture = scenario.create()

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow(scenario.message)
    expect(fixture.providerRequests).toHaveLength(0)
    expect(fixture.order).not.toContain('rate')
    expect(fixture.run.activeRequestContract).toBeNull()
    expect(fixture.manifests).toHaveLength(scenario.manifestAttempts)
  })

  it('fails a strict child View when its builder returns no ExecutionContract', async () => {
    const fixture = createAttemptInput({
      strictViewContract: true,
      buildExecutionContract: () => null
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow('ExecutionContract builder did not return a contract.')
    expect(fixture.providerRequests).toHaveLength(0)
    expect(fixture.order).not.toContain('rate')
    expect(fixture.manifests).toHaveLength(0)
    expect(fixture.run.activeRequestContract).toBeNull()
    expect(fixture.executionContractErrors).toEqual([
      expect.objectContaining({
        message: 'ExecutionContract builder did not return a contract.'
      })
    ])
  })

  it('does not admit a Tool Surface when strict manifest persistence fails', async () => {
    const tools = [agentTool('read')]
    const surface = createFullToolSurfacePort(tools)
    const fixture = createAttemptInput({
      tools,
      toolSurface: surface.port,
      strictViewContract: true,
      appendManifest: () => {
        throw new Error('manifest unavailable')
      }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow('manifest unavailable')

    expect(surface.build).toHaveBeenCalledOnce()
    expect(surface.admit).not.toHaveBeenCalled()
    expect(fixture.providerRequests).toHaveLength(0)
    expect(fixture.order).not.toContain('rate')
  })

  it('does not admit a prepared Tool Surface when rate admission is canceled', async () => {
    const tools = [agentTool('read')]
    const surface = createFullToolSurfacePort(tools)
    const fixture = createAttemptInput({ tools, toolSurface: surface.port })
    fixture.input.rateGate.wait = async () => {
      fixture.run.abortController.abort()
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(surface.build).toHaveBeenCalledOnce()
    expect(surface.admit).not.toHaveBeenCalled()
    expect(fixture.manifests).toHaveLength(1)
    expect(fixture.providerRequests).toHaveLength(0)
  })

  it('does not start a physical attempt when Tool Surface admission cancels the Run', async () => {
    const tools = [agentTool('read')]
    const surface = createFullToolSurfacePort(tools)
    const fixture = createAttemptInput({ tools, toolSurface: surface.port })
    const admit = surface.port.admit
    surface.port.admit = (input) => {
      admit(input)
      fixture.run.abortController.abort()
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(surface.admit).toHaveBeenCalledOnce()
    expect(fixture.run.physicalAttempt).toBe(0)
    expect(fixture.providerRequests).toHaveLength(0)
  })

  it('fails before starting a View when Tool Surface construction fails', async () => {
    const surfaceError = new Error('tool surface unavailable')
    const build = vi.fn<ProviderAttemptToolSurfacePort['build']>(() => {
      throw surfaceError
    })
    const admit = vi.fn<ProviderAttemptToolSurfacePort['admit']>()
    const fixture = createAttemptInput({
      toolSurface: { build, admit, releaseActivationCandidates: vi.fn() }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toBe(surfaceError)

    expect(build).toHaveBeenCalledWith({ requestSeq: 1, tools: fixture.input.tools })
    expect(admit).not.toHaveBeenCalled()
    expect(fixture.run.requestSeq).toBe(0)
    expect(fixture.run.activeRequestContract).toBeNull()
    expect(fixture.run.activeRequestToolSurface).toBeNull()
    expect(fixture.manifests).toHaveLength(0)
    expect(fixture.providerRequests).toHaveLength(0)
    expect(fixture.order).not.toContain('rate')
  })

  it('rejects a mismatched Tool Surface identity before manifesting a View', async () => {
    const tools = [agentTool('read')]
    const surface = createFullToolSurfacePort(tools)
    const fixture = createAttemptInput({
      tools,
      toolSurface: {
        build: ({ requestSeq, tools: requestTools }) =>
          surface.port.build({ requestSeq: requestSeq + 1, tools: requestTools }),
        admit: surface.port.admit,
        releaseActivationCandidates: surface.port.releaseActivationCandidates
      }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow(/identity does not match/)

    expect(fixture.run.requestSeq).toBe(0)
    expect(fixture.run.activeRequestContract).toBeNull()
    expect(fixture.run.activeRequestToolSurface).toBeNull()
    expect(fixture.manifests).toHaveLength(0)
    expect(fixture.providerRequests).toHaveLength(0)
    expect(fixture.order).not.toContain('rate')
  })

  it('rejects an unsigned Tool Surface before manifesting a View', async () => {
    const fixture = createAttemptInput({
      toolSurface: {
        build: ({ requestSeq }) =>
          ({
            request: {
              sessionId: 'session-1',
              messageId: 'message-1',
              runId: 'run-1',
              requestSeq
            },
            toolDefinitions: []
          }) as ToolSurfaceSnapshot,
        admit: vi.fn(),
        releaseActivationCandidates: vi.fn()
      }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toMatchObject({ code: 'invalid_definition' })

    expect(fixture.run.requestSeq).toBe(0)
    expect(fixture.manifests).toHaveLength(0)
    expect(fixture.providerRequests).toHaveLength(0)
    expect(fixture.order).not.toContain('rate')
  })

  it('does not fall back to legacy tools when a Tool Surface port returns no snapshot', async () => {
    const fixture = createAttemptInput({
      toolSurface: {
        build: () => null as unknown as ToolSurfaceSnapshot,
        admit: vi.fn(),
        releaseActivationCandidates: vi.fn()
      }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toMatchObject({ code: 'invalid_definition' })

    expect(fixture.run.requestSeq).toBe(0)
    expect(fixture.manifests).toHaveLength(0)
    expect(fixture.providerRequests).toHaveLength(0)
    expect(fixture.order).not.toContain('rate')
  })

  it('does not build a Tool Surface after the Run is canceled', async () => {
    const build = vi.fn<ProviderAttemptToolSurfacePort['build']>()
    const admit = vi.fn<ProviderAttemptToolSurfacePort['admit']>()
    const fixture = createAttemptInput({
      toolSurface: { build, admit, releaseActivationCandidates: vi.fn() }
    })
    fixture.run.abortController.abort()

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(build).not.toHaveBeenCalled()
    expect(admit).not.toHaveBeenCalled()
    expect(fixture.run.requestSeq).toBe(0)
    expect(fixture.manifests).toHaveLength(0)
    expect(fixture.providerRequests).toHaveLength(0)
  })

  it('keeps generation fail-open when provider outcome persistence throws', async () => {
    const fixture = createAttemptInput()
    const persistenceError = new Error('outcome unavailable')
    fixture.input.outcome.append = () => {
      throw persistenceError
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'ok' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.outcomeErrors).toEqual([persistenceError])
  })

  it('keeps strict overflow recovery in one round while advancing requestSeq per request', async () => {
    const tools = [agentTool('read'), agentTool('write')]
    const surface = createFullToolSurfacePort(tools)
    const fixture = createAttemptInput({
      tools,
      toolSurface: surface.port,
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    const optionalHistory: ChatMessage = { role: 'assistant', content: 'optional history' }
    const currentInput: ChatMessage = { role: 'user', content: 'current input' }
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      optionalHistory,
      currentInput
    )
    fixture.input.budget.fitStrictRetry = vi.fn(({ messages }) =>
      messages.filter((message) => message !== optionalHistory)
    )

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.input.recovery.recover).toHaveBeenCalledOnce()
    expect(fixture.providerRequests).toHaveLength(2)
    expect(fixture.providerRequests[0].messages).toEqual([optionalHistory, currentInput])
    expect(fixture.providerRequests[1].messages).toEqual([currentInput])
    expect(fixture.manifests.map((manifest) => manifest.requestSeq)).toEqual([1, 2])
    expect(fixture.run.requestSeq).toBe(2)
    expect(fixture.run.logicalRound).toBe(1)
    expect(fixture.run.physicalAttempt).toBe(1)
    expect(fixture.run.providerRecovery).toEqual({
      contextOverflowHandoffAttempted: false,
      strictProviderOverflowRetryUsed: false,
      contextRecoverySequencesUsed: 1
    })
    expect(fixture.manifests[1].tokenBudget).toMatchObject({
      requestedMaxTokens: 50,
      reserveTokens: 75
    })
    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'context_overflow',
        stopReason: 'error',
        failureClassification: 'context_overflow',
        retryDecision: 'context_recovery_scheduled'
      }),
      expectedAttemptOutcome({
        requestSeq: 2,
        requestOrigin: 'context_recovery'
      })
    ])
    expect(fixture.providerRequests.map((request) => request.identity)).toEqual([
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 1 },
      { logicalRound: 1, requestSeq: 2, physicalAttempt: 1 }
    ])
    expect(fixture.contractBuildInputs.map((input) => input.requestSeq)).toEqual([1, 2])
    expect(fixture.providerContractRefs[0]).not.toBe(fixture.providerContractRefs[1])
    expect(fixture.run.activeRequestContract?.executionContract).toBe(
      fixture.providerContractRefs[1]
    )
    expect(surface.build.mock.calls.map(([input]) => input.requestSeq)).toEqual([1, 2])
    expect(surface.admit.mock.calls.map(([input]) => input.requestSeq)).toEqual([1, 2])
    expect(surface.snapshots).toHaveLength(2)
    expect(surface.snapshots[0]).not.toBe(surface.snapshots[1])
    expect(fixture.providerToolSurfaceRefs).toEqual(surface.snapshots)
    expect(fixture.run.activeRequestToolSurface).toEqual({
      requestSeq: 2,
      snapshot: surface.snapshots[1],
      releaseActivationCandidates: expect.any(Function)
    })
    expect(fixture.order.indexOf('outcome:1')).toBeLessThan(fixture.order.indexOf('manifest:2'))
  })

  it('replaces the Programmatic View and capability after context recovery', async () => {
    const tools = programmaticDefinitions()
    const surface = createProgrammaticToolSurfacePort(tools)
    const fixture = createAttemptInput({
      tools,
      toolSurface: surface.port,
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    fixture.input.recovery.recover = vi.fn(async () => ({
      messages: [{ role: 'user', content: 'recovered input' }]
    }))

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(surface.build.mock.calls.map(([input]) => input.requestSeq)).toEqual([1, 2])
    expect(surface.buildCapability).toHaveBeenCalledTimes(2)
    expect(surface.admit.mock.calls.map(([input]) => input.requestSeq)).toEqual([1, 2])
    expect(surface.snapshots).toHaveLength(2)
    expect(surface.capabilities).toHaveLength(2)
    expect(surface.snapshots[1]).not.toBe(surface.snapshots[0])
    expect(surface.capabilities[1]).not.toBe(surface.capabilities[0])
    expect(fixture.manifestToolSurfaceRefs).toEqual(surface.snapshots)
    expect(fixture.manifestProgrammaticCapabilityRefs).toEqual(surface.capabilities)
    expect(fixture.providerToolSurfaceRefs).toEqual(surface.snapshots)
    expect(fixture.run.activeRequestToolSurface).toMatchObject({
      requestSeq: 2,
      snapshot: surface.snapshots[1],
      programmaticCapability: surface.capabilities[1]
    })
    expect(() =>
      assertProgrammaticToolCapabilityViewActive(surface.capabilities[0], surface.snapshots[0])
    ).toThrow(/active provider View/)
    expect(() =>
      assertProgrammaticToolCapabilityViewActive(surface.capabilities[1], surface.snapshots[1])
    ).not.toThrow()
  })

  it('retries when handoff replaces an aliased provider message projection', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    const optionalHistory: ChatMessage = { role: 'assistant', content: 'optional history' }
    const currentInput: ChatMessage = { role: 'user', content: 'current input' }
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      optionalHistory,
      currentInput
    )
    fixture.input.recovery.recover = vi.fn(async () => ({
      messages: [currentInput],
      summaryCursorOrderSeq: 4
    }))

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.providerRequests.map(({ messages }) => messages)).toEqual([
      [optionalHistory, currentInput],
      [currentInput]
    ])
  })

  it('allows later recovery sequences after success and enforces the Run-level ceiling', async () => {
    const overflow = [
      { type: 'error', error_message: 'context overflow' }
    ] satisfies LLMCoreStreamEvent[]
    const success = [
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ] satisfies LLMCoreStreamEvent[]
    const fixture = createAttemptInput({
      providerEvents: [overflow, success, overflow, success, overflow, success, overflow]
    })
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      { role: 'assistant', content: 'oldest' },
      { role: 'assistant', content: 'older' },
      { role: 'assistant', content: 'old' },
      { role: 'user', content: 'current input' }
    )
    fixture.input.recovery.recover = vi.fn(async ({ requestMessages }) => ({
      messages: requestMessages.slice(1)
    }))

    const coordinator = new DeepChatContextCoordinator()
    await expect(collect(coordinator.streamProviderAttempts(fixture.input))).resolves.toEqual(
      success
    )
    await expect(collect(coordinator.streamProviderAttempts(fixture.input))).resolves.toEqual(
      success
    )
    await expect(collect(coordinator.streamProviderAttempts(fixture.input))).resolves.toEqual(
      success
    )
    await expect(collect(coordinator.streamProviderAttempts(fixture.input))).rejects.toThrow(
      'provider still overflowed'
    )

    expect(fixture.input.recovery.recover).toHaveBeenCalledTimes(3)
    expect(fixture.providerRequests).toHaveLength(7)
    expect(fixture.run.providerRecovery).toEqual({
      contextOverflowHandoffAttempted: false,
      strictProviderOverflowRetryUsed: false,
      contextRecoverySequencesUsed: 3
    })
  })

  it('compacts closed tool results before invoking semantic pressure recovery', async () => {
    const fixture = createAttemptInput()
    const largeOutput = 'x'.repeat(9000)
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      { role: 'user', content: 'current input' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'inspect', arguments: '{}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call-1', content: largeOutput }
    )
    fixture.input.budget.preflight = vi.fn(({ messages, requestedMaxTokens }) => {
      const compacted = String(messages.at(-1)?.content).startsWith(
        '[Tool output compacted from provider View]'
      )
      return createPreflight(messages, {
        requestedMaxTokens,
        effectiveMaxTokens: compacted ? requestedMaxTokens : 20,
        requiresContextPressureRecovery: !compacted,
        fitsWithinContext: compacted
      })
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.input.recovery.recover).not.toHaveBeenCalled()
    expect(String(fixture.providerRequests[0].messages.at(-1)?.content)).toContain(
      '[Tool output compacted from provider View]'
    )
    expect(fixture.run.providerRecovery.contextRecoverySequencesUsed).toBe(1)
  })

  it('preserves the latest closed tool result when older compaction relieves pressure', async () => {
    const fixture = createAttemptInput()
    const olderOutput = `older:${'x'.repeat(9000)}`
    const latestOutput = `latest:${'y'.repeat(9000)}`
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      { role: 'user', content: 'current input' },
      ...createClosedToolUnit('call-older', 'inspect', olderOutput),
      ...createClosedToolUnit('call-latest', 'write', latestOutput)
    )
    fixture.input.budget.preflight = vi.fn(({ messages, requestedMaxTokens }) => {
      const olderCompacted = String(messages[2]?.content).startsWith(
        '[Tool output compacted from provider View]'
      )
      return createPreflight(messages, {
        requestedMaxTokens,
        effectiveMaxTokens: olderCompacted ? requestedMaxTokens : 20,
        requiresContextPressureRecovery: !olderCompacted,
        fitsWithinContext: olderCompacted
      })
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.input.recovery.recover).not.toHaveBeenCalled()
    expect(String(fixture.providerRequests[0].messages[2].content)).toContain(
      '[Tool output compacted from provider View]'
    )
    expect(fixture.providerRequests[0].messages[4].content).toBe(latestOutput)
  })

  it('continues preflight tool compaction after a provider overflow', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    const olderOutput = `older:${'x'.repeat(9000)}`
    const latestOutput = `latest:${'y'.repeat(9000)}`
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      { role: 'user', content: 'current input' },
      ...createClosedToolUnit('call-older', 'inspect', olderOutput),
      ...createClosedToolUnit('call-latest', 'write', latestOutput)
    )
    fixture.input.budget.preflight = vi.fn(({ messages, requestedMaxTokens }) => {
      const olderCompacted = String(messages[2]?.content).startsWith(
        '[Tool output compacted from provider View]'
      )
      return createPreflight(messages, {
        requestedMaxTokens,
        effectiveMaxTokens: olderCompacted ? requestedMaxTokens : 20,
        requiresContextPressureRecovery: !olderCompacted,
        fitsWithinContext: olderCompacted
      })
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])

    expect(fixture.providerRequests).toHaveLength(2)
    expect(String(fixture.providerRequests[0].messages[2].content)).toContain(
      '[Tool output compacted from provider View]'
    )
    expect(fixture.providerRequests[0].messages[4].content).toBe(latestOutput)
    expect(String(fixture.providerRequests[1].messages[4].content)).toContain(
      '[Tool output compacted from provider View]'
    )
    expect(fixture.providerRequests.map(({ maxTokens }) => maxTokens)).toEqual([100, 100])
    expect(fixture.input.recovery.recover).not.toHaveBeenCalled()
  })

  it('uses semantic recovery after preflight exhausts tool compaction', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    const optionalHistory: ChatMessage = { role: 'assistant', content: 'optional history' }
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      optionalHistory,
      { role: 'user', content: 'current input' },
      ...createClosedToolUnit('call-older', 'inspect', 'x'.repeat(9000)),
      ...createClosedToolUnit('call-latest', 'write', 'y'.repeat(9000))
    )
    fixture.input.budget.preflight = vi.fn(({ messages, requestedMaxTokens }) => {
      const toolMessages = messages.filter((message) => message.role === 'tool')
      const allCompacted =
        toolMessages.length === 2 &&
        toolMessages.every((message) =>
          String(message.content).startsWith('[Tool output compacted from provider View]')
        )
      return createPreflight(messages, {
        requestedMaxTokens,
        effectiveMaxTokens: allCompacted ? requestedMaxTokens : 20,
        requiresContextPressureRecovery: !allCompacted,
        fitsWithinContext: allCompacted
      })
    })
    fixture.input.recovery.recover = vi.fn(async ({ requestMessages }) => ({
      messages: requestMessages.slice(1),
      summaryCursorOrderSeq: 5
    }))

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])

    expect(fixture.providerRequests).toHaveLength(2)
    expect(
      [3, 5].every((index) =>
        String(fixture.providerRequests[0].messages[index]?.content).startsWith(
          '[Tool output compacted from provider View]'
        )
      )
    ).toBe(true)
    expect(fixture.input.recovery.recover).toHaveBeenCalledOnce()
    expect(fixture.providerRequests[1].messages).not.toContain(optionalHistory)
  })

  it('retries a provider overflow with model-free tool-result compaction first', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      { role: 'user', content: 'current input' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'inspect', arguments: '{}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'x'.repeat(9000) }
    )

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])

    expect(fixture.input.recovery.recover).not.toHaveBeenCalled()
    expect(fixture.providerRequests).toHaveLength(2)
    expect(String(fixture.providerRequests[1].messages.at(-1)?.content)).toContain(
      '[Tool output compacted from provider View]'
    )
  })

  it('preserves the latest closed tool result on the first provider-overflow retry', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    const olderOutput = `older:${'x'.repeat(9000)}`
    const latestOutput = `latest:${'y'.repeat(9000)}`
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      { role: 'user', content: 'current input' },
      ...createClosedToolUnit('call-older', 'inspect', olderOutput),
      ...createClosedToolUnit('call-latest', 'write', latestOutput)
    )

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.providerRequests).toHaveLength(2)
    expect(String(fixture.providerRequests[1].messages[2].content)).toContain(
      '[Tool output compacted from provider View]'
    )
    expect(fixture.providerRequests[1].messages[4].content).toBe(latestOutput)
  })

  it('compacts the latest closed tool result only after an older-only retry still overflows', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [{ type: 'error', error_message: 'context overflow' }],
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      { role: 'assistant', content: 'optional closed history' },
      { role: 'user', content: 'current input' },
      ...createClosedToolUnit('call-older', 'inspect', 'x'.repeat(9000)),
      ...createClosedToolUnit('call-latest', 'write', 'y'.repeat(9000))
    )
    fixture.input.recovery.recover = vi.fn(async ({ requestMessages }) => ({
      messages: requestMessages.slice(1),
      summaryCursorOrderSeq: 5
    }))

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])

    expect(fixture.providerRequests).toHaveLength(4)
    expect(String(fixture.providerRequests[1].messages[3].content)).toContain(
      '[Tool output compacted from provider View]'
    )
    expect(String(fixture.providerRequests[1].messages[5].content)).not.toContain(
      '[Tool output compacted from provider View]'
    )
    expect(String(fixture.providerRequests[2].messages[5].content)).toContain(
      '[Tool output compacted from provider View]'
    )
    expect(fixture.input.recovery.recover).toHaveBeenCalledOnce()
  })

  it('falls through to semantic recovery when a compacted tool retry still overflows', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      { role: 'assistant', content: 'optional closed history' },
      { role: 'user', content: 'current input' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'inspect', arguments: '{}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'x'.repeat(9000) }
    )
    fixture.input.recovery.recover = vi.fn(async ({ requestMessages }) => ({
      messages: requestMessages.slice(1),
      summaryCursorOrderSeq: 5
    }))

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])

    expect(fixture.input.recovery.recover).toHaveBeenCalledTimes(1)
    expect(fixture.providerRequests).toHaveLength(3)
    expect(fixture.providerRequests[2].messages[0]).toEqual({
      role: 'user',
      content: 'current input'
    })
  })

  it('skips a protected-only context retry when only its output cap would change', async () => {
    const fixture = createAttemptInput({
      providerEvents: [[{ type: 'error', error_message: 'context overflow' }]]
    })
    const facts = {
      matched: true,
      actualTokens: 1200,
      limitTokens: 1000,
      scope: 'prompt' as const,
      confidence: 'explicit' as const
    }
    fixture.input.inspectContextOverflow = () => facts
    fixture.input.onContextOverflowFacts = vi.fn()
    fixture.input.budget.buildOverflowAfterRecoveryError = vi.fn(
      (_preflight, observedFacts) =>
        new Error(`provider still overflowed: ${JSON.stringify(observedFacts)}`)
    )

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow(`provider still overflowed: ${JSON.stringify(facts)}`)

    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.input.recovery.recover).toHaveBeenCalledOnce()
    expect(fixture.input.onContextOverflowFacts).toHaveBeenCalledWith(facts)
  })

  it('retries a total-context overflow when only the effective output cap shrinks', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    const facts = {
      matched: true,
      actualTokens: 1100,
      limitTokens: 1000,
      limitScope: 'context' as const,
      scope: 'request' as const,
      confidence: 'explicit' as const
    }
    fixture.input.inspectContextOverflow = () => facts
    fixture.input.onContextOverflowFacts = vi.fn()

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])

    expect(fixture.providerRequests).toHaveLength(2)
    expect(fixture.providerRequests.map(({ messages }) => messages)).toEqual([
      [{ role: 'user', content: 'hello' }],
      [{ role: 'user', content: 'hello' }]
    ])
    expect(fixture.providerRequests.map(({ maxTokens }) => maxTokens)).toEqual([100, 50])
    expect(fixture.manifests.map(({ tokenBudget }) => tokenBudget.effectiveMaxTokens)).toEqual([
      100, 50
    ])
    expect(fixture.input.onContextOverflowFacts).toHaveBeenCalledWith(facts)
  })

  it('does not send a retry that fails the calibrated local preflight', async () => {
    const fixture = createAttemptInput({
      providerEvents: [[{ type: 'error', error_message: 'context overflow' }]]
    })
    fixture.input.budget.preflight = vi
      .fn()
      .mockImplementationOnce(({ messages, requestedMaxTokens }) =>
        createPreflight(messages, { requestedMaxTokens, effectiveMaxTokens: requestedMaxTokens })
      )
      .mockImplementationOnce(({ messages, requestedMaxTokens }) =>
        createPreflight(messages, {
          fitsWithinContext: false,
          requestedMaxTokens,
          effectiveMaxTokens: 0
        })
      )
    const buildFailure = vi.fn(() => new Error('calibrated request cannot fit'))
    fixture.input.budget.buildOverflowAfterRecoveryError = buildFailure

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow('calibrated request cannot fit')

    expect(fixture.providerRequests).toHaveLength(1)
    expect(buildFailure).toHaveBeenCalledWith(
      expect.objectContaining({ fitsWithinContext: false }),
      undefined,
      'retry_projection_cannot_fit'
    )
  })

  it('commits the admitted retry projection before preparing the next request', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    const optionalHistory: ChatMessage = { role: 'assistant', content: 'optional history' }
    const currentInput: ChatMessage = { role: 'user', content: 'current input' }
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      optionalHistory,
      currentInput
    )
    let projected = false
    fixture.input.budget.fitStrictRetry = vi.fn(({ messages }) => {
      if (projected) return messages
      projected = true
      return messages.filter((message) => message !== optionalHistory)
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])

    expect(fixture.providerRequests).toHaveLength(2)
    expect(fixture.providerRequests[0].messages).toEqual([optionalHistory, currentInput])
    expect(fixture.providerRequests[1].messages).toEqual([currentInput])
    expect(fixture.manifests[1].messages).toEqual(fixture.providerRequests[1].messages)
  })

  it('runs pressure recovery before manifesting the provider request', async () => {
    const fixture = createAttemptInput()
    const preflight = vi
      .fn()
      .mockReturnValueOnce(
        createPreflight([{ role: 'user', content: 'pressure' }], {
          requiresContextPressureRecovery: true,
          effectiveMaxTokens: 20
        })
      )
      .mockReturnValueOnce(
        createPreflight([
          { role: 'system', content: 'recovered system' },
          { role: 'user', content: 'pressure' }
        ])
      )
    fixture.input.budget.preflight = preflight
    fixture.input.recovery.recover = vi.fn(async () => ({
      messages: [
        { role: 'system', content: 'recovered system' },
        { role: 'user', content: 'pressure' }
      ],
      systemPrompt: 'recovered system',
      summaryCursorOrderSeq: 9
    }))

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.input.recovery.recover).toHaveBeenCalledOnce()
    expect(fixture.manifests[0]).toMatchObject({
      policy: 'context_pressure_recovery_shadow',
      selection: undefined,
      summaryCursorOrderSeq: 9
    })
    expect(fixture.manifests[0].messages).toEqual(fixture.providerRequests[0].messages)
  })

  it('rebuilds a pressure-recovery View with deferred activation policy', async () => {
    const tools = [agentTool('read'), agentTool('write')]
    const surface = createFullToolSurfacePort(tools)
    const fixture = createAttemptInput({ tools, toolSurface: surface.port })
    fixture.input.budget.preflight = vi
      .fn()
      .mockReturnValueOnce(
        createPreflight(fixture.run.messages, { requiresContextPressureRecovery: true })
      )
      .mockReturnValue(createPreflight(fixture.run.messages))

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(surface.build).toHaveBeenCalledTimes(2)
    expect(surface.build.mock.calls[0][0]).toMatchObject({ requestSeq: 1 })
    expect(surface.build.mock.calls[0][0].deferActivationCandidates).toBeUndefined()
    expect(surface.build.mock.calls[1][0]).toMatchObject({
      requestSeq: 1,
      deferActivationCandidates: true
    })
    expect(surface.admit).toHaveBeenCalledOnce()
    expect(surface.admit.mock.calls[0][0].snapshot).toBe(surface.snapshots[1])
    expect(fixture.manifestToolSurfaceRefs).toEqual([surface.snapshots[1]])
    expect(fixture.providerToolSurfaceRefs).toEqual([surface.snapshots[1]])
  })

  it('does not start the provider when cancellation lands after rate admission', async () => {
    const fixture = createAttemptInput()
    fixture.input.rateGate.wait = async () => {
      fixture.run.abortController.abort()
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.manifests).toHaveLength(1)
    expect(fixture.providerRequests).toHaveLength(0)
    expect(fixture.outcomes).toHaveLength(0)
  })

  it('does not freeze a provider View when cancellation lands during context recovery', async () => {
    const fixture = createAttemptInput()
    fixture.input.budget.preflight = vi
      .fn()
      .mockReturnValueOnce(
        createPreflight(fixture.run.messages, { requiresContextPressureRecovery: true })
      )
      .mockReturnValue(createPreflight(fixture.run.messages))
    let markRecoveryStarted = () => {
      throw new Error('Recovery started before initialization')
    }
    const recoveryStarted = new Promise<void>((resolve) => {
      markRecoveryStarted = resolve
    })
    let releaseRecovery = () => {
      throw new Error('Recovery released before initialization')
    }
    const recoveryBlocked = new Promise<void>((resolve) => {
      releaseRecovery = resolve
    })
    fixture.input.recovery.recover = vi.fn(async () => {
      markRecoveryStarted()
      await recoveryBlocked
      return { messages: fixture.run.messages }
    })

    const request = collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    await recoveryStarted
    fixture.run.abortController.abort(new DOMException('stopped', 'AbortError'))
    releaseRecovery()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.run.requestSeq).toBe(0)
    expect(fixture.manifests).toEqual([])
    expect(fixture.providerRequests).toEqual([])
  })

  it('records abort and error attempts without inventing usage', async () => {
    const aborted = createAttemptInput()
    aborted.input.provider.stream = async function* () {
      aborted.run.abortController.abort()
      throw Object.assign(new Error('canceled'), { name: 'AbortError' })
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(aborted.input))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(aborted.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'aborted',
        stopReason: null,
        failureClassification: 'aborted',
        retryDecision: 'not_retryable'
      })
    ])

    const failed = createAttemptInput()
    failed.input.provider.stream = async function* () {
      throw new Error('provider unavailable')
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(failed.input))
    ).rejects.toThrow('provider unavailable')
    expect(failed.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'error',
        stopReason: null,
        failureClassification: 'unknown',
        retryDecision: 'not_retryable'
      })
    ])
  })

  it('keeps usage returned before a provider error terminal event', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: 80,
              completion_tokens: 5,
              total_tokens: 85,
              cached_tokens: 60
            }
          },
          { type: 'error', error_message: 'provider failed' },
          { type: 'stop', stop_reason: 'error' }
        ]
      ]
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'error',
        stopReason: 'error',
        failureClassification: 'unknown',
        retryDecision: 'not_retryable',
        usage: {
          inputTokens: 80,
          outputTokens: 5,
          totalTokens: 85,
          cacheReadTokens: 60
        }
      })
    ])
  })

  it.each([
    {
      label: 'completed attempt above the context window',
      contextLength: 1_000,
      stopReason: 'complete',
      inputTokens: 1_001,
      outputTokens: 1,
      expected: {
        kind: 'successful_prompt_overflow',
        contextWindowTokens: 1_000,
        thresholdTokens: 1_000
      }
    },
    {
      label: 'completed attempt exactly at the context window',
      contextLength: 1_000,
      stopReason: 'complete',
      inputTokens: 1_000,
      outputTokens: 1,
      expected: null
    },
    {
      label: 'zero-output length stop at the pressure threshold',
      contextLength: 1_000,
      stopReason: 'max_tokens',
      inputTokens: 990,
      outputTokens: 0,
      expected: {
        kind: 'zero_output_length_at_limit',
        contextWindowTokens: 1_000,
        thresholdTokens: 990
      }
    },
    {
      label: 'fractional pressure threshold rounds up',
      contextLength: 101,
      stopReason: 'max_tokens',
      inputTokens: 100,
      outputTokens: 0,
      expected: {
        kind: 'zero_output_length_at_limit',
        contextWindowTokens: 101,
        thresholdTokens: 100
      }
    },
    {
      label: 'fractional pressure threshold rejects input below 99 percent',
      contextLength: 101,
      stopReason: 'max_tokens',
      inputTokens: 99,
      outputTokens: 0,
      expected: null
    },
    {
      label: 'length stop with semantic output',
      contextLength: 1_000,
      stopReason: 'max_tokens',
      inputTokens: 990,
      outputTokens: 1,
      expected: null
    },
    {
      label: 'zero-output length stop below the pressure threshold',
      contextLength: 1_000,
      stopReason: 'max_tokens',
      inputTokens: 989,
      outputTokens: 0,
      expected: null
    },
    {
      label: 'tiny context window uses a one-token threshold',
      contextLength: 1,
      stopReason: 'max_tokens',
      inputTokens: 1,
      outputTokens: 0,
      expected: {
        kind: 'zero_output_length_at_limit',
        contextWindowTokens: 1,
        thresholdTokens: 1
      }
    }
  ])('records silent context pressure for $label', async (testCase) => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: testCase.inputTokens,
              completion_tokens: testCase.outputTokens,
              total_tokens: testCase.inputTokens + testCase.outputTokens
            }
          },
          { type: 'stop', stop_reason: testCase.stopReason }
        ]
      ]
    })
    fixture.input.modelConfig.contextLength = testCase.contextLength
    fixture.input.fallbackContextLength = testCase.contextLength
    fixture.input.budget.preflight = ({ messages, requestedMaxTokens }) => ({
      ...createPreflight(messages, {
        requestedMaxTokens,
        effectiveMaxTokens: requestedMaxTokens
      }),
      contextLength: testCase.contextLength
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.outcomes).toHaveLength(1)
    expect(fixture.outcomes[0].contextPressure).toEqual(testCase.expected)
  })

  it('does not infer silent pressure without a budgeted attempt usage snapshot', async () => {
    const withoutUsage = createAttemptInput({
      providerEvents: [[{ type: 'stop', stop_reason: 'complete' }]]
    })
    await collect(new DeepChatContextCoordinator().streamProviderAttempts(withoutUsage.input))
    expect(withoutUsage.outcomes[0].contextPressure).toBeNull()

    const bypassed = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 1_001, completion_tokens: 1, total_tokens: 1_002 }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    bypassed.input.bypassContextBudget = true
    await collect(new DeepChatContextCoordinator().streamProviderAttempts(bypassed.input))
    expect(bypassed.outcomes[0].contextPressure).toBeNull()
  })

  it('does not double-count cache reads or aggregate usage across physical attempts', async () => {
    const cached = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: 800,
              completion_tokens: 1,
              total_tokens: 801,
              cached_tokens: 300
            }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    await collect(new DeepChatContextCoordinator().streamProviderAttempts(cached.input))
    expect(cached.outcomes[0].contextPressure).toBeNull()

    const retried = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 1_001, completion_tokens: 0, total_tokens: 1_001 }
          },
          {
            type: 'error',
            error_message: 'temporarily unavailable',
            failure: {
              statusCode: 503,
              retryHeaders: { 'retry-after-ms': '0' }
            }
          }
        ],
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    await collect(new DeepChatContextCoordinator().streamProviderAttempts(retried.input))
    expect(retried.outcomes.map((outcome) => outcome.contextPressure)).toEqual([null, null])
  })

  it('retries a transient throw against the same manifested request', async () => {
    const transientError = Object.assign(new Error('fetch failed'), {
      code: 'ECONNRESET',
      headers: { 'retry-after-ms': '0' }
    })
    const fixture = createAttemptInput({
      providerAttempts: [
        { error: transientError },
        {
          events: [
            { type: 'text', content: 'recovered' },
            { type: 'stop', stop_reason: 'complete' }
          ]
        }
      ]
    })

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.manifests).toHaveLength(1)
    expect(fixture.providerRequests.map((request) => request.identity)).toEqual([
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 1 },
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 2 }
    ])
    expect(fixture.contractBuildInputs).toHaveLength(1)
    expect(fixture.providerContractRefs[0]).toBe(fixture.providerContractRefs[1])
    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'error',
        stopReason: null,
        failureClassification: 'transient',
        retryDecision: 'retry_scheduled',
        errorCode: 'ECONNRESET',
        retryDelayMs: 0
      }),
      expectedAttemptOutcome({ physicalAttempt: 2, attemptOrigin: 'transient_retry' })
    ])
  })

  it('keeps interactive requests fail-open when contract construction fails', async () => {
    const contractError = new Error('contract unavailable')
    const fixture = createAttemptInput({
      buildExecutionContract: () => {
        throw contractError
      }
    })
    fixture.input.executionContract!.onBuildError = (error: unknown) => {
      fixture.executionContractErrors.push(error)
      throw new Error('contract error reporting unavailable')
    }

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.executionContractErrors).toEqual([contractError])
    expect(fixture.manifests[0].executionContract).toBeUndefined()
    expect(fixture.providerContractRefs).toEqual([null])
    expect(fixture.run.activeRequestContract).toEqual({
      requestSeq: 1,
      executionContract: null
    })
  })

  it('buffers retryable error controls until the retry decision is final', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'error',
            error_message: 'temporarily unavailable',
            failure: {
              statusCode: 503,
              retryHeaders: { 'retry-after-ms': '0' }
            }
          },
          { type: 'stop', stop_reason: 'error' }
        ],
        [
          { type: 'text', content: 'ok after retry' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    fixture.input.retryObserver = (event) => fixture.order.push(`retry:${event.type}`)

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      { type: 'text', content: 'ok after retry' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.outcomes[0]).toEqual(
      expectedAttemptOutcome({
        status: 'error',
        stopReason: 'error',
        failureClassification: 'transient',
        retryDecision: 'retry_scheduled',
        httpStatus: 503,
        retryDelayMs: 0
      })
    )
    expect(fixture.order).toEqual([
      'manifest:1',
      'before-rate',
      'rate',
      'rate-clear',
      'before-provider',
      'provider',
      'outcome:1',
      'retry:retry_scheduled',
      'before-rate',
      'rate',
      'rate-clear',
      'before-provider',
      'retry:retry_started',
      'provider',
      'outcome:1',
      'retry:retry_finished'
    ])
  })

  it('retries a premature EOF before output and surfaces it after partial output', async () => {
    vi.useFakeTimers()
    const retryable = createAttemptInput({
      providerEvents: [
        [],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    const retryPromise = collect(
      new DeepChatContextCoordinator().streamProviderAttempts(retryable.input)
    )
    await vi.runAllTimersAsync()

    await expect(retryPromise).resolves.toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(retryable.providerRequests).toHaveLength(2)
    expect(retryable.outcomes[0]).toMatchObject({
      status: 'error',
      failureClassification: 'transient',
      retryDecision: 'retry_scheduled',
      errorCode: 'premature_eof'
    })

    const partial = createAttemptInput({
      providerEvents: [[{ type: 'text', content: 'partial' }]]
    })
    const partialEvents = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(partial.input)
    )

    expect(partialEvents).toEqual([
      { type: 'text', content: 'partial' },
      {
        type: 'error',
        error_message: 'Provider stream ended without a terminal stop event.',
        failure: { code: 'premature_eof', retryable: true }
      }
    ])
    expect(partial.providerRequests).toHaveLength(1)
    expect(partial.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'error',
        stopReason: 'error',
        failureClassification: 'transient',
        retryDecision: 'output_committed',
        errorCode: 'premature_eof'
      })
    ])
  })

  it.each([
    ['text', { type: 'text', content: 'partial' }],
    ['reasoning', { type: 'reasoning', reasoning_content: 'thinking' }],
    [
      'tool start',
      { type: 'tool_call_start', tool_call_id: 'call-1', tool_call_name: 'read_file' }
    ],
    [
      'tool chunk',
      { type: 'tool_call_chunk', tool_call_id: 'call-1', tool_call_arguments_chunk: '{' }
    ],
    [
      'tool end',
      { type: 'tool_call_end', tool_call_id: 'call-1', tool_call_arguments_complete: '{}' }
    ],
    [
      'permission',
      {
        type: 'permission',
        permission: { providerId: 'acp', requestId: 'request-1', tool_call_id: 'call-1' }
      }
    ],
    ['image', { type: 'image_data', image_data: { data: 'image', mimeType: 'image/png' } }],
    [
      'rate limit',
      {
        type: 'rate_limit',
        rate_limit: { providerId: 'provider-1', qpsLimit: 1, currentQps: 1, queueLength: 1 }
      }
    ],
    ['plan', { type: 'plan', plan: [] }]
  ] satisfies Array<[string, LLMCoreStreamEvent]>)(
    'does not replay after committed %s output',
    async (_name, semanticEvent) => {
      const terminalError: LLMCoreStreamEvent = {
        type: 'error',
        error_message: 'temporarily unavailable',
        failure: {
          statusCode: 503,
          retryHeaders: { 'retry-after-ms': '0' }
        }
      }
      const fixture = createAttemptInput({
        providerEvents: [[semanticEvent, terminalError, { type: 'stop', stop_reason: 'error' }]]
      })

      const events = await collect(
        new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
      )

      expect(events).toEqual([semanticEvent, terminalError, { type: 'stop', stop_reason: 'error' }])
      expect(fixture.providerRequests).toHaveLength(1)
      expect(fixture.outcomes[0]).toMatchObject({
        failureClassification: 'transient',
        retryDecision: 'output_committed'
      })
    }
  )

  it('preserves partial output without replay when the provider throws', async () => {
    const transientError = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    const fixture = createAttemptInput({
      providerAttempts: [
        {
          events: [{ type: 'text', content: 'partial' }],
          error: transientError
        }
      ]
    })
    const projected: LLMCoreStreamEvent[] = []

    const consume = async () => {
      for await (const event of new DeepChatContextCoordinator().streamProviderAttempts(
        fixture.input
      )) {
        projected.push(event)
      }
    }

    await expect(consume()).rejects.toBe(transientError)
    expect(projected).toEqual([{ type: 'text', content: 'partial' }])
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.outcomes[0]).toMatchObject({
      status: 'error',
      failureClassification: 'transient',
      retryDecision: 'output_committed'
    })
  })

  it('sanitizes a thrown context overflow after partial output', async () => {
    const rawError = new Error('context overflow')
    const fixture = createAttemptInput({
      providerAttempts: [
        {
          events: [{ type: 'text', content: 'partial' }],
          error: rawError
        }
      ]
    })
    const projected: LLMCoreStreamEvent[] = []

    const consume = async () => {
      for await (const event of new DeepChatContextCoordinator().streamProviderAttempts(
        fixture.input
      )) {
        projected.push(event)
      }
    }

    let thrown: unknown
    try {
      await consume()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toEqual(
      expect.objectContaining({
        message:
          'The provider reported a context overflow after response output began. DeepChat preserved the partial output and did not retry.'
      })
    )
    expect(thrown).not.toBe(rawError)
    expect(projected).toEqual([{ type: 'text', content: 'partial' }])
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.outcomes[0]).toMatchObject({
      failureClassification: 'context_overflow',
      retryDecision: 'output_committed'
    })
  })

  it('caps transient replay at two retries per logical round', async () => {
    const retryableFailure: LLMCoreStreamEvent[] = [
      {
        type: 'error',
        error_message: 'overloaded',
        failure: {
          statusCode: 503,
          retryHeaders: { 'retry-after-ms': '0' }
        }
      },
      { type: 'stop', stop_reason: 'error' }
    ]
    const fixture = createAttemptInput({
      providerEvents: [retryableFailure, retryableFailure, retryableFailure]
    })

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(fixture.providerRequests.map((request) => request.identity.physicalAttempt)).toEqual([
      1, 2, 3
    ])
    expect(fixture.manifests).toHaveLength(1)
    expect(fixture.outcomes.map((outcome) => outcome.retryDecision)).toEqual([
      'retry_scheduled',
      'retry_scheduled',
      'retry_budget_exhausted'
    ])
    expect(events).toEqual(retryableFailure)
  })

  it('shares retry budget across context recovery while resetting physical identity', async () => {
    const lifecycle: any[] = []
    const transientFailure: LLMCoreStreamEvent[] = [
      {
        type: 'error',
        error_message: 'overloaded',
        failure: {
          statusCode: 503,
          retryHeaders: { 'retry-after-ms': '0' }
        }
      },
      { type: 'stop', stop_reason: 'error' }
    ]
    const fixture = createAttemptInput({
      providerEvents: [
        transientFailure,
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 }
          },
          { type: 'error', error_message: 'context overflow' }
        ],
        transientFailure,
        transientFailure
      ]
    })
    const optionalHistory: ChatMessage = { role: 'assistant', content: 'optional history' }
    const currentInput: ChatMessage = { role: 'user', content: 'current input' }
    fixture.input.requestMessages.splice(
      0,
      fixture.input.requestMessages.length,
      optionalHistory,
      currentInput
    )
    fixture.input.budget.fitStrictRetry = vi.fn(({ messages }) =>
      messages.filter((message) => message !== optionalHistory)
    )
    fixture.input.retryObserver = (event) => lifecycle.push(structuredClone(event))

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      {
        type: 'usage',
        usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 }
      },
      ...transientFailure
    ])
    expect(fixture.manifests.map((manifest) => manifest.requestSeq)).toEqual([1, 2])
    expect(fixture.providerRequests.map((request) => request.identity)).toEqual([
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 1 },
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 2 },
      { logicalRound: 1, requestSeq: 2, physicalAttempt: 1 },
      { logicalRound: 1, requestSeq: 2, physicalAttempt: 2 }
    ])
    expect(fixture.order.filter((entry) => entry === 'rate')).toHaveLength(4)
    expect(fixture.outcomes.map((outcome) => outcome.retryDecision)).toEqual([
      'retry_scheduled',
      'context_recovery_scheduled',
      'retry_scheduled',
      'retry_budget_exhausted'
    ])
    expect(lifecycle.map((event) => [event.type, event.retryNumber])).toEqual([
      ['retry_scheduled', 1],
      ['retry_started', 1],
      ['retry_finished', 1],
      ['retry_scheduled', 2],
      ['retry_started', 2],
      ['retry_finished', 2]
    ])
  })

  it('refuses Retry-After above the cap without sending another request', async () => {
    const failure: LLMCoreStreamEvent[] = [
      {
        type: 'error',
        error_message: 'rate limited',
        failure: {
          statusCode: 429,
          retryHeaders: { 'retry-after': '61' }
        }
      },
      { type: 'stop', stop_reason: 'error' }
    ]
    const fixture = createAttemptInput({ providerEvents: [failure] })

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual(failure)
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'error',
        stopReason: 'error',
        failureClassification: 'transient',
        retryDecision: 'retry_after_exceeds_limit',
        httpStatus: 429
      })
    ])
  })

  it('does not replay provider modes without an idempotent chat contract', async () => {
    const failure: LLMCoreStreamEvent[] = [
      {
        type: 'error',
        error_message: 'temporarily unavailable',
        failure: {
          statusCode: 503,
          retryHeaders: { 'retry-after-ms': '0' }
        }
      },
      { type: 'stop', stop_reason: 'error' }
    ]
    const fixture = createAttemptInput({ providerEvents: [failure] })
    fixture.input.allowTransientRetry = false

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual(failure)
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.outcomes[0]).toMatchObject({
      failureClassification: 'transient',
      retryDecision: 'not_retryable',
      retryDelayMs: null
    })
  })

  it('cancels scheduled backoff and still projects consumed usage', async () => {
    const usageEvent: LLMCoreStreamEvent = {
      type: 'usage',
      usage: {
        prompt_tokens: 9,
        completion_tokens: 1,
        total_tokens: 10
      }
    }
    const fixture = createAttemptInput({
      providerEvents: [
        [
          usageEvent,
          {
            type: 'error',
            error_message: 'temporarily unavailable',
            failure: { statusCode: 503 }
          }
        ]
      ]
    })
    fixture.input.retryObserver = (event) => {
      if (event.type === 'retry_scheduled') {
        fixture.run.abortController.abort(new DOMException('stopped', 'AbortError'))
      }
    }
    const projected: LLMCoreStreamEvent[] = []

    const consume = async () => {
      for await (const event of new DeepChatContextCoordinator().streamProviderAttempts(
        fixture.input
      )) {
        projected.push(event)
      }
    }

    await expect(consume()).rejects.toMatchObject({ name: 'AbortError' })
    expect(projected).toEqual([usageEvent])
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.outcomes[0]).toMatchObject({
      failureClassification: 'transient',
      retryDecision: 'retry_scheduled'
    })
  })

  it('settles an attempt as aborted when a provider ignores cancellation and stops cleanly', async () => {
    const fixture = createAttemptInput({
      providerEvents: [[{ type: 'stop', stop_reason: 'complete' }]]
    })
    const stream = fixture.input.provider.stream
    fixture.input.provider.stream = async function* (request) {
      fixture.run.abortController.abort()
      yield* stream(request)
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'aborted',
        stopReason: null,
        failureClassification: 'aborted',
        retryDecision: 'not_retryable'
      })
    ])
  })

  it('settles an active attempt when cancellation closes the stream at semantic output', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 }
          },
          { type: 'text', content: 'partial' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    const stream = new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)

    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { type: 'text', content: 'partial' }
    })
    fixture.run.abortController.abort(new DOMException('stopped', 'AbortError'))
    await stream.return(undefined)

    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'aborted',
        stopReason: null,
        failureClassification: 'aborted',
        retryDecision: 'output_committed',
        usage: {
          inputTokens: 8,
          outputTokens: 1,
          totalTokens: 9
        }
      })
    ])
  })

  it('aggregates final usage snapshots across physical attempts exactly once', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: 10,
              completion_tokens: 2,
              total_tokens: 12,
              cached_tokens: 4
            }
          },
          {
            type: 'error',
            error_message: 'temporarily unavailable',
            failure: {
              statusCode: 503,
              retryHeaders: { 'retry-after-ms': '0' }
            }
          }
        ],
        [
          { type: 'text', content: 'done' },
          {
            type: 'usage',
            usage: {
              prompt_tokens: 7,
              completion_tokens: 3,
              total_tokens: 10,
              cached_tokens: 1,
              cache_write_tokens: 2
            }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      { type: 'text', content: 'done' },
      {
        type: 'usage',
        usage: {
          prompt_tokens: 17,
          completion_tokens: 5,
          total_tokens: 22,
          cached_tokens: 5,
          cache_write_tokens: 2
        }
      },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.outcomes.map((outcome) => outcome.usage)).toEqual([
      {
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        cacheReadTokens: 4
      },
      {
        inputTokens: 7,
        outputTokens: 3,
        totalTokens: 10,
        cacheReadTokens: 1,
        cacheWriteTokens: 2
      }
    ])
  })

  it('rejects unsafe usage aggregation instead of corrupting message accounting', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: Number.MAX_SAFE_INTEGER,
              completion_tokens: 0,
              total_tokens: Number.MAX_SAFE_INTEGER
            }
          },
          {
            type: 'error',
            error_message: 'temporarily unavailable',
            failure: {
              statusCode: 503,
              retryHeaders: { 'retry-after-ms': '0' }
            }
          }
        ],
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow('Provider usage prompt_tokens exceeds the safe integer range.')
    expect(fixture.outcomes).toHaveLength(2)
  })

  it('isolates retry observer failures from provider execution', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'error',
            error_message: 'temporarily unavailable',
            failure: {
              statusCode: 503,
              retryHeaders: { 'retry-after-ms': '0' }
            }
          }
        ],
        [
          { type: 'text', content: 'done' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    fixture.input.retryObserver = (event) => {
      if (event.type === 'retry_started') {
        Reflect.set(event.attempt, 'physicalAttempt', 99)
      }
      throw new Error('observer unavailable')
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'done' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.providerRequests.map((request) => request.identity.physicalAttempt)).toEqual([
      1, 2
    ])
    expect(fixture.outcomes.map((outcome) => outcome.physicalAttempt)).toEqual([1, 2])
  })
})
