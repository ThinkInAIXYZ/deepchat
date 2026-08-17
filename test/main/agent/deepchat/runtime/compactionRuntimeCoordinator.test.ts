import type { ProviderModelResolutionPort } from '@/provider/settings'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  CompactionRuntimeCoordinator,
  type CompactionRuntimeCoordinatorDependencies
} from '@/agent/deepchat/runtime/compactionRuntimeCoordinator'
import type { CompactionIntent } from '@/agent/deepchat/runtime/compactionService'
import type {
  DeepChatSessionState,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import { ModelType } from '@shared/model'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'

const SESSION_ID = 'session'

function createRuntimeState(
  status: DeepChatSessionState['status'] = 'idle'
): DeepChatSessionState {
  return {
    status,
    providerId: 'openai',
    modelId: 'gpt-5',
    permissionMode: 'full_access'
  }
}

function createGenerationSettings(): SessionGenerationSettings {
  return {
    systemPrompt: 'System prompt',
    temperature: 0.7,
    contextLength: 128_000,
    maxTokens: 4096,
    timeout: 30_000
  }
}

function createProviderSettings(): ProviderModelResolutionPort {
  return {
    getProviderById: vi.fn().mockReturnValue(undefined),
    isKnownModel: vi.fn().mockReturnValue(true),
    getModelConfig: vi.fn().mockReturnValue({
      maxTokens: 4096,
      contextLength: 128_000,
      vision: false,
      functionCall: true,
      reasoning: true,
      type: ModelType.Chat
    }),
    getCapabilitySnapshot: vi.fn(({ providerId, modelId }) => ({
      identity: {
        providerId,
        requestModelId: modelId,
        catalogMatched: false,
        catalogModelId: null
      },
      requestPolicy: {
        temperature: { mode: 'passthrough' },
        topP: { mode: 'passthrough' },
        reasoning: { mode: 'passthrough' },
        legacyThinking: { mode: 'passthrough' }
      },
      supportsAudioInput: false,
      supportsReasoning: true,
      reasoningPortrait: null,
      thinkingBudgetRange: {},
      supportsSearch: false,
      searchDefaults: {},
      temperatureCapability: undefined,
      supportsTemperatureControl: true,
      supportsReasoningEffort: false,
      reasoningEffortDefault: undefined,
      supportsVerbosity: false,
      verbosityDefault: undefined
    })),
    supportsAudioInputCapability: vi.fn().mockReturnValue(false),
  }
}

function createIntent(previousSummaryUpdatedAt: number | null = null): CompactionIntent {
  return {
    compactionAttemptId: 'compaction-attempt-1',
    sessionId: SESSION_ID,
    previousState: {
      summaryText: previousSummaryUpdatedAt === null ? null : 'Previous summary',
      summaryCursorOrderSeq: previousSummaryUpdatedAt === null ? 1 : 3,
      summaryUpdatedAt: previousSummaryUpdatedAt
    },
    targetCursorOrderSeq: 5,
    summaryBlocks: ['Summarize this history'],
    currentCheckpointTokenEstimate: 0,
    newlyHiddenVisibleTokenEstimate: 10_000,
    currentModel: {
      providerId: 'openai',
      modelId: 'gpt-5',
      contextLength: 128_000
    },
    reserveTokens: 4096,
    retainedTurnCount: 0,
    retainedTokenEstimate: 0,
    retainedTokenTarget: 0
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

type PrepareManualCompactionInput = Parameters<
  CompactionRuntimeCoordinatorDependencies['compactionService']['prepareForManualCompaction']
>[0]

function createHarness(options?: {
  hydrate?: boolean
  sessionExists?: boolean
  state?: DeepChatSessionState
}) {
  const runtime = new DeepChatAgentRuntime()
  const shouldHydrate = options?.hydrate !== false
  const initialInstance = shouldHydrate
    ? runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    : undefined
  if (initialInstance && options?.state !== undefined) {
    initialInstance.setRuntimeState(options.state)
  } else if (initialInstance) {
    initialInstance.setRuntimeState(createRuntimeState())
  }

  let summaryState = {
    summaryText: null as string | null,
    summaryCursorOrderSeq: 1,
    summaryUpdatedAt: null as number | null
  }
  let reconstructionAnchor: {
    entryId: number
    name: string
    state: Record<string, unknown>
    createdAt: number
  } | null = null
  const reconstructionAnchorsByAttempt = new Map<
    string,
    NonNullable<typeof reconstructionAnchor>
  >()
  const publishedEvents: Array<{ event: string; payload: unknown }> = []
  const messageStore: CompactionRuntimeCoordinatorDependencies['messageStore'] = {
    createCompactionMessage: vi.fn().mockReturnValue('compaction-message'),
    createCompactionMessageAtOrderSeq: vi.fn().mockReturnValue('compaction-message'),
    deleteMessage: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    getNextOrderSeq: vi.fn().mockReturnValue(7),
    recordCompactionModelCall: vi.fn(),
    updateCompactionMessage: vi.fn()
  }
  const sessionStore: CompactionRuntimeCoordinatorDependencies['sessionStore'] = {
    get: vi.fn().mockImplementation(() =>
      options?.sessionExists === true
        ? {
            provider_id: 'openai',
            model_id: 'gpt-5',
            permission_mode: 'full_access'
          }
        : undefined
    ),
    getReconstructionAnchorPromptState: vi.fn(() => reconstructionAnchor),
    getReconstructionAnchorPromptStateByCompactionAttemptId: vi.fn(
      (_sessionId, compactionAttemptId) =>
        reconstructionAnchorsByAttempt.get(compactionAttemptId) ?? null
    ),
    getSummaryState: vi.fn(() => ({ ...summaryState })),
    resetSummaryState: vi.fn(() => {
      summaryState = {
        summaryText: null,
        summaryCursorOrderSeq: 1,
        summaryUpdatedAt: null
      }
    })
  }

  const scopeFor = vi.fn((sessionId: string, instance: DeepChatAgentInstance) =>
    runtime.scopeFor(toAppSessionId(sessionId), instance)
  )
  const transitionStatus = vi.fn(
    (
      scope: ReturnType<typeof runtime.scopeFor>,
      status: DeepChatSessionState['status']
    ): boolean => {
      if (!scope.isCurrent()) return false
      const state = scope.state()
      if (!state) return false
      state.status = status
      return true
    }
  )
  const ensureOperationController = vi.fn((scope: ReturnType<typeof runtime.scopeFor>) => {
    scope.assertCurrent()
    const controller = new AbortController()
    scope.instance.setAbortController(controller)
    return controller
  })
  const canSettleOperation = vi.fn(
    (scope: ReturnType<typeof runtime.scopeFor>, controller: AbortController) =>
      scope.isCurrent() && scope.instance.getAbortController() === controller
  )
  const clearOperationController = vi.fn(
    (scope: ReturnType<typeof runtime.scopeFor>, controller?: AbortController) =>
      scope.isCurrent() && scope.instance.clearAbortController(controller)
  )
  const runLifecycle: CompactionRuntimeCoordinatorDependencies['runLifecycle'] = {
    canSettleOperation,
    clearOperationController,
    ensureOperationController,
    hasPendingInteractions: vi.fn().mockReturnValue(false),
    scopeFor,
    transitionStatus
  }

  const generationSettings = createGenerationSettings()
  const sessionSettings: CompactionRuntimeCoordinatorDependencies['sessionSettings'] = {
    getEffectiveGenerationSettings: vi.fn().mockResolvedValue(generationSettings),
    resolveProjectDir: vi.fn().mockReturnValue('/workspace')
  }
  const toolResolver: CompactionRuntimeCoordinatorDependencies['toolResolver'] = {
    loadToolDefinitionsForSession: vi.fn().mockResolvedValue([]),
    resolveActiveSkillNamesForToolProfile: vi.fn().mockResolvedValue([])
  }
  const prepareForManualCompaction = vi.fn(
    async (_input: PrepareManualCompactionInput): Promise<CompactionIntent | null> => null
  )
  const applyCompaction = vi.fn(
    async (intent: CompactionIntent) => {
      summaryState = {
        summaryText: 'Updated summary',
        summaryCursorOrderSeq: intent.targetCursorOrderSeq,
        summaryUpdatedAt: (intent.previousState.summaryUpdatedAt ?? 0) + 1
      }
      reconstructionAnchor = {
        entryId: (reconstructionAnchor?.entryId ?? 0) + 1,
        name: 'compaction/manual',
        state: {
          summary: summaryState.summaryText,
          cursorOrderSeq: summaryState.summaryCursorOrderSeq
        },
        createdAt: summaryState.summaryUpdatedAt
      }
      return {
        outcome: 'summarized' as const,
        anchorCommitted: true,
        summaryState: { ...summaryState }
      }
    }
  )
  const compactionService: CompactionRuntimeCoordinatorDependencies['compactionService'] = {
    applyCompaction,
    prepareForManualCompaction
  }
  const emitMessageRefresh = vi.fn()
  const getInstance = vi.fn((sessionId: string) =>
    runtime.getOrHydrate(toAppSessionId(sessionId))
  )
  const getHydratedInstance = vi.fn((sessionId: string) =>
    runtime.getHydrated(toAppSessionId(sessionId))
  )
  const getSessionListState = vi.fn(async () => initialInstance?.getRuntimeState() ?? null)
  const providerSettings = createProviderSettings()
  const deps: CompactionRuntimeCoordinatorDependencies = {
    compactionService,
    sessionStore,
    messageStore,
    providerSettings,
    toolResolver,
    runLifecycle,
    sessionSettings,
    tapeReconciliation: {
      ensureSessionTapeReady: vi.fn().mockReturnValue({
        sessionId: SESSION_ID,
        migrationState: 'ready',
        messageCount: 0,
        maxOrderSeq: 0,
        appendedFactCount: 0,
        historyRecords: []
      })
    },
    registry: runtime,
    sessionState: { getSummary: getSessionListState },
    promptAssembly: {
      createBasePromptAssembler: () => ({
        assemble: vi.fn().mockResolvedValue('Assembled system prompt')
      })
    },
    commandShell: {
      resolveForTurn: vi.fn().mockResolvedValue(POSIX_COMMAND_SHELL)
    },
    messageProjection: { refresh: emitMessageRefresh },
    publishEvent: (event, payload) => publishedEvents.push({ event, payload })
  }
  const coordinator = new CompactionRuntimeCoordinator(deps)

  return {
    applyCompaction,
    canSettleOperation,
    clearOperationController,
    coordinator,
    deps,
    emitMessageRefresh,
    getHydratedInstance,
    getInstance,
    initialInstance,
    messageStore,
    prepareForManualCompaction,
    providerSettings,
    publishedEvents,
    runtime,
    sessionSettings,
    sessionStore,
    setSummaryState: (next: typeof summaryState) => {
      summaryState = next
    },
    setReconstructionAnchor: (next: typeof reconstructionAnchor) => {
      reconstructionAnchor = next
      const compactionAttemptId = next?.state.compactionAttemptId
      if (next && typeof compactionAttemptId === 'string') {
        reconstructionAnchorsByAttempt.set(compactionAttemptId, next)
      }
    },
    toolResolver,
    transitionStatus
  }
}

describe('CompactionRuntimeCoordinator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not hydrate an instance when neither runtime nor persisted session facts exist', async () => {
    const { coordinator, getInstance, runtime } = createHarness({ hydrate: false })

    await expect(coordinator.getSnapshot(SESSION_ID)).rejects.toThrow(
      `Session ${SESSION_ID} not found`
    )

    expect(getInstance).not.toHaveBeenCalled()
    expect(runtime.getHydrated(toAppSessionId(SESSION_ID))).toBeUndefined()
  })

  it('keeps an in-flight state authoritative and otherwise refreshes from persisted summary', async () => {
    const { coordinator, initialInstance, setSummaryState } = createHarness()
    setSummaryState({
      summaryText: 'Persisted summary',
      summaryCursorOrderSeq: 7,
      summaryUpdatedAt: 200
    })
    initialInstance?.setCompactionState({
      status: 'compacting',
      cursorOrderSeq: 9,
      summaryUpdatedAt: 100
    })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      state: {
        status: 'compacting',
        cursorOrderSeq: 9,
        summaryUpdatedAt: 100,
        boundaryReason: null
      }
    })

    initialInstance?.setCompactionState({
      status: 'idle',
      cursorOrderSeq: 1,
      summaryUpdatedAt: null
    })
    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      state: {
        status: 'compacted',
        cursorOrderSeq: 7,
        summaryUpdatedAt: 200,
        boundaryReason: null
      }
    })
  })

  it('projects a cursor-only reconstruction boundary as compacted', async () => {
    const { coordinator, setSummaryState } = createHarness()
    setSummaryState({
      summaryText: null,
      summaryCursorOrderSeq: 7,
      summaryUpdatedAt: null
    })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      state: {
        status: 'compacted',
        cursorOrderSeq: 7,
        summaryUpdatedAt: null,
        boundaryReason: null
      }
    })
  })

  it('derives boundary-only reason and anchor identity from the latest Tape anchor', async () => {
    const { coordinator, setReconstructionAnchor, setSummaryState } = createHarness()
    setSummaryState({
      summaryText: null,
      summaryCursorOrderSeq: 7,
      summaryUpdatedAt: null
    })
    setReconstructionAnchor({
      entryId: 42,
      name: 'compaction/context_pressure',
      state: {
        cursorOrderSeq: 7,
        reason: 'summary_rejected_larger'
      },
      createdAt: 200
    })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toEqual({
      state: {
        status: 'compacted',
        cursorOrderSeq: 7,
        summaryUpdatedAt: null,
        boundaryReason: 'summary_rejected_larger'
      },
      emitSeq: 0,
      latestAnchorEntryId: 42
    })

    setReconstructionAnchor({
      entryId: 43,
      name: 'handoff/legacy',
      state: { cursorOrderSeq: 7, reason: 'legacy_reason' },
      createdAt: 201
    })
    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      state: { boundaryReason: null },
      latestAnchorEntryId: 43
    })
  })

  it('uses a per-session sequence across same-millisecond events and runtime replacement', async () => {
    const { coordinator, publishedEvents, runtime } = createHarness()
    vi.spyOn(Date, 'now').mockReturnValue(100)

    coordinator.emit(SESSION_ID, coordinator.idleState())
    coordinator.emit(SESSION_ID, {
      status: 'compacting',
      cursorOrderSeq: 5,
      summaryUpdatedAt: null,
      boundaryReason: null
    })

    runtime.evict(toAppSessionId(SESSION_ID))
    const replacement = runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    replacement.setRuntimeState(createRuntimeState())
    coordinator.emit(SESSION_ID, coordinator.idleState(), replacement)

    expect(
      publishedEvents.map(({ payload }) => (payload as { emitSeq: number }).emitSeq)
    ).toEqual([1, 2, 3])
    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({ emitSeq: 3 })
  })

  it('takes event boundary reasons only from the durable Tape anchor', () => {
    const { coordinator, publishedEvents, setReconstructionAnchor } = createHarness()
    setReconstructionAnchor({
      entryId: 42,
      name: 'compaction/context_pressure',
      state: {
        cursorOrderSeq: 7,
        reason: 'summary_unavailable'
      },
      createdAt: 200
    })

    coordinator.emit(SESSION_ID, {
      status: 'compacted',
      cursorOrderSeq: 7,
      summaryUpdatedAt: null,
      boundaryReason: 'summary_rejected_larger'
    })

    expect(publishedEvents.at(-1)?.payload).toEqual(
      expect.objectContaining({
        boundaryReason: 'summary_unavailable',
        latestAnchorEntryId: 42
      })
    )
  })

  it('restarts process-local sequencing while preserving the durable anchor identity', async () => {
    const { coordinator, deps, setReconstructionAnchor, setSummaryState } = createHarness()
    setSummaryState({
      summaryText: null,
      summaryCursorOrderSeq: 7,
      summaryUpdatedAt: null
    })
    setReconstructionAnchor({
      entryId: 42,
      name: 'compaction/context_pressure',
      state: {
        cursorOrderSeq: 7,
        reason: 'summary_unavailable'
      },
      createdAt: 200
    })
    coordinator.emit(SESSION_ID, {
      status: 'compacted',
      cursorOrderSeq: 7,
      summaryUpdatedAt: null,
      boundaryReason: 'summary_unavailable'
    })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      emitSeq: 1,
      latestAnchorEntryId: 42
    })

    const restartedCoordinator = new CompactionRuntimeCoordinator(deps)
    await expect(restartedCoordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      state: { boundaryReason: 'summary_unavailable' },
      emitSeq: 0,
      latestAnchorEntryId: 42
    })
  })

  it('owns the complete manual lifecycle when no history is eligible', async () => {
    const {
      coordinator,
      initialInstance,
      prepareForManualCompaction,
      sessionSettings,
      toolResolver,
      transitionStatus,
      providerSettings
    } = createHarness()

    await expect(coordinator.compact(SESSION_ID)).resolves.toEqual({
      compacted: false,
      state: {
        status: 'idle',
        cursorOrderSeq: 1,
        summaryUpdatedAt: null,
        boundaryReason: null
      }
    })

    expect(transitionStatus.mock.calls.map(([, status]) => status)).toEqual([
      'generating',
      'idle'
    ])
    expect(initialInstance?.getAbortController()).toBeUndefined()
    expect(sessionSettings.getEffectiveGenerationSettings).toHaveBeenCalledWith(
      SESSION_ID,
      initialInstance,
      expect.objectContaining({
        modelConfig: expect.objectContaining({ contextLength: 128_000 }),
        capabilitySnapshot: expect.objectContaining({
          identity: expect.objectContaining({
            providerId: 'openai',
            requestModelId: 'gpt-5'
          })
        })
      })
    )
    expect(toolResolver.loadToolDefinitionsForSession).toHaveBeenCalledWith(
      SESSION_ID,
      '/workspace',
      [],
      initialInstance
    )
    expect(prepareForManualCompaction).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        providerId: 'openai',
        modelId: 'gpt-5',
        systemPrompt: 'Assembled system prompt',
        reserveTokens: 4096,
        historyRecords: [],
        signal: expect.any(AbortSignal)
      })
    )
    expect(providerSettings.getModelConfig).toHaveBeenCalledOnce()
    expect(providerSettings.getCapabilitySnapshot).toHaveBeenCalledOnce()
  })

  it('applies a prepared manual intent and returns the owned projection', async () => {
    const {
      applyCompaction,
      coordinator,
      initialInstance,
      messageStore,
      prepareForManualCompaction,
      publishedEvents
    } = createHarness()
    const intent = createIntent()
    prepareForManualCompaction.mockResolvedValueOnce(intent)

    await expect(coordinator.compact(SESSION_ID)).resolves.toEqual({
      compacted: true,
      state: {
        status: 'compacted',
        cursorOrderSeq: 5,
        summaryUpdatedAt: 1,
        boundaryReason: null
      }
    })

    expect(applyCompaction).toHaveBeenCalledWith(
      intent,
      expect.any(AbortSignal),
      expect.any(Function)
    )
    expect(messageStore.updateCompactionMessage).toHaveBeenCalledWith(
      'compaction-message',
      'compacted',
      1,
      { compactionAttemptId: 'compaction-attempt-1', boundaryReason: null }
    )
    expect(initialInstance?.getCompactionState()).toEqual({
      status: 'compacted',
      cursorOrderSeq: 5,
      summaryUpdatedAt: 1,
      boundaryReason: null
    })
    expect(publishedEvents.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({ status: 'compacting', cursorOrderSeq: 5 }),
      expect.objectContaining({ status: 'compacted', cursorOrderSeq: 5 })
    ])
  })

  it('persists each observed summary call against the compaction marker identity', async () => {
    const { applyCompaction, coordinator, messageStore } = createHarness()
    const intent = createIntent()
    applyCompaction.mockImplementationOnce(async (_intent, _signal, observeModelCall) => {
      observeModelCall?.({
        sessionId: 'incorrect-session',
        compactionAttemptId: 'incorrect-attempt',
        providerCallId: 'provider-call-1',
        providerId: 'assistant-provider',
        modelId: 'summary-model',
        status: 'completed',
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        startedAt: 10,
        completedAt: 20
      })
      return {
        outcome: 'unchanged',
        anchorCommitted: false,
        summaryState: intent.previousState
      }
    })

    await coordinator.apply(SESSION_ID, intent)

    expect(messageStore.recordCompactionModelCall).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      compactionMessageId: 'compaction-message',
      compactionAttemptId: intent.compactionAttemptId,
      providerCallId: 'provider-call-1',
      providerId: 'assistant-provider',
      modelId: 'summary-model',
      status: 'completed',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      startedAt: 10,
      completedAt: 20
    })
  })

  it('removes the local marker when another compaction attempt wins the anchor CAS', async () => {
    const { applyCompaction, coordinator, messageStore } = createHarness()
    const intent = createIntent()
    applyCompaction.mockResolvedValueOnce({
      outcome: 'summarized',
      anchorCommitted: false,
      summaryState: {
        summaryText: 'Winner summary',
        summaryCursorOrderSeq: 7,
        summaryUpdatedAt: 2
      }
    })

    await expect(coordinator.apply(SESSION_ID, intent)).resolves.toMatchObject({
      summaryCursorOrderSeq: 7
    })

    expect(messageStore.updateCompactionMessage).not.toHaveBeenCalled()
    expect(messageStore.deleteMessage).toHaveBeenCalledWith('compaction-message')
  })

  it('finalizes a committed marker without mutating a replacement runtime', async () => {
    const { applyCompaction, coordinator, initialInstance, messageStore, publishedEvents, runtime } =
      createHarness()
    const completion = createDeferred<{
      outcome: 'summarized'
      anchorCommitted: true
      summaryState: {
        summaryText: string
        summaryCursorOrderSeq: number
        summaryUpdatedAt: number
      }
    }>()
    applyCompaction.mockImplementationOnce(async () => await completion.promise)

    const applying = coordinator.apply(SESSION_ID, createIntent(), undefined, initialInstance)
    await vi.waitFor(() => expect(applyCompaction).toHaveBeenCalledOnce())
    runtime.evict(toAppSessionId(SESSION_ID))
    const replacement = runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    replacement.setRuntimeState(createRuntimeState())
    completion.resolve({
      outcome: 'summarized',
      anchorCommitted: true,
      summaryState: {
        summaryText: 'durable summary',
        summaryCursorOrderSeq: 5,
        summaryUpdatedAt: 200
      }
    })

    await expect(applying).resolves.toMatchObject({
      summaryText: 'durable summary',
      summaryCursorOrderSeq: 5,
      summaryUpdatedAt: 200
    })
    expect(messageStore.updateCompactionMessage).toHaveBeenCalledWith(
      'compaction-message',
      'compacted',
      200,
      { compactionAttemptId: 'compaction-attempt-1', boundaryReason: null }
    )
    expect(publishedEvents.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({ status: 'compacting' })
    ])
    expect(replacement.getCompactionState()).toBeUndefined()
  })

  it('settles a boundary-only marker from its attempt anchor after a newer anchor', async () => {
    const {
      applyCompaction,
      coordinator,
      messageStore,
      setReconstructionAnchor,
      setSummaryState
    } = createHarness()
    const intent = createIntent()
    const boundaryState = {
      summaryText: null,
      summaryCursorOrderSeq: intent.targetCursorOrderSeq,
      summaryUpdatedAt: null
    }
    applyCompaction.mockImplementationOnce(async () => {
      setSummaryState(boundaryState)
      setReconstructionAnchor({
        entryId: 42,
        name: 'compaction/context_pressure',
        state: {
          compactionAttemptId: intent.compactionAttemptId,
          cursorOrderSeq: intent.targetCursorOrderSeq,
          reason: 'summary_rejected_larger'
        },
        createdAt: 200
      })
      setReconstructionAnchor({
        entryId: 43,
        name: 'compaction/context_pressure',
        state: {
          compactionAttemptId: 'newer-compaction-attempt',
          cursorOrderSeq: intent.targetCursorOrderSeq + 1,
          reason: 'summary_unavailable'
        },
        createdAt: 201
      })
      return {
        outcome: 'boundary_only',
        anchorCommitted: true,
        summaryState: boundaryState
      }
    })

    await coordinator.apply(SESSION_ID, intent)

    expect(messageStore.updateCompactionMessage).toHaveBeenCalledWith(
      'compaction-message',
      'compacted',
      null,
      {
        compactionAttemptId: 'compaction-attempt-1',
        boundaryReason: 'summary_rejected_larger'
      }
    )
  })

  it('retracts a failed marker without masking the failure after runtime replacement', async () => {
    const {
      applyCompaction,
      coordinator,
      initialInstance,
      messageStore,
      publishedEvents,
      runtime
    } = createHarness()
    const completion = createDeferred<never>()
    const failure = new Error('provider failed')
    applyCompaction.mockImplementationOnce(async () => await completion.promise)

    const applying = coordinator.apply(SESSION_ID, createIntent(), undefined, initialInstance)
    await vi.waitFor(() => expect(applyCompaction).toHaveBeenCalledOnce())
    runtime.evict(toAppSessionId(SESSION_ID))
    const replacement = runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    replacement.setRuntimeState(createRuntimeState())
    completion.reject(failure)

    await expect(applying).rejects.toBe(failure)
    expect(messageStore.deleteMessage).toHaveBeenCalledWith('compaction-message')
    expect(publishedEvents.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({ status: 'compacting' })
    ])
    expect(replacement.getCompactionState()).toBeUndefined()
  })

  it('does not settle idle after the operation controller loses ownership', async () => {
    const {
      canSettleOperation,
      coordinator,
      initialInstance,
      prepareForManualCompaction,
      transitionStatus
    } = createHarness()
    prepareForManualCompaction.mockImplementationOnce(async () => {
      initialInstance?.setAbortController(new AbortController())
      return null
    })
    canSettleOperation.mockReturnValueOnce(false)

    await coordinator.compact(SESSION_ID)

    expect(transitionStatus.mock.calls.map(([, status]) => status)).toEqual(['generating'])
    expect(initialInstance?.getRuntimeState()?.status).toBe('generating')
  })

  it('restores the previous projection and normalizes a late aborted failure', async () => {
    const {
      applyCompaction,
      coordinator,
      initialInstance,
      messageStore,
      publishedEvents
    } = createHarness()
    const controller = new AbortController()
    controller.abort()
    applyCompaction.mockRejectedValueOnce(new Error('late failure'))

    await expect(
      coordinator.apply(SESSION_ID, createIntent(100), { signal: controller.signal }, initialInstance)
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(messageStore.deleteMessage).toHaveBeenCalledWith('compaction-message')
    expect(initialInstance?.getCompactionState()).toEqual({
      status: 'compacted',
      cursorOrderSeq: 3,
      summaryUpdatedAt: 100,
      boundaryReason: null
    })
    expect(publishedEvents.at(-1)?.payload).toEqual(
      expect.objectContaining({
        status: 'compacted',
        cursorOrderSeq: 3,
        summaryUpdatedAt: 100
      })
    )
  })

  it('restores the previous projection without masking a non-abort failure', async () => {
    const { applyCompaction, coordinator, initialInstance, messageStore } = createHarness()
    const failure = new Error('compaction failed')
    applyCompaction.mockRejectedValueOnce(failure)

    await expect(
      coordinator.apply(SESSION_ID, createIntent(100), undefined, initialInstance)
    ).rejects.toBe(failure)

    expect(messageStore.deleteMessage).toHaveBeenCalledWith('compaction-message')
    expect(initialInstance?.getCompactionState()).toEqual({
      status: 'compacted',
      cursorOrderSeq: 3,
      summaryUpdatedAt: 100,
      boundaryReason: null
    })
  })
})
