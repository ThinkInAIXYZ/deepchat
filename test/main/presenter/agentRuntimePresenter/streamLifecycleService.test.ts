import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  DeepChatSessionState,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition, MCPToolResponse } from '@shared/types/core/mcp'
import type { IConfigPresenter, ILlmProviderPresenter, ModelConfig } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import { RuntimeSharedState } from '@/presenter/agentRuntimePresenter/runtimeSharedState'
import { GenerationControlService } from '@/presenter/agentRuntimePresenter/generationControlService'
import type { DeepChatMessageStore } from '@/presenter/agentRuntimePresenter/messageStore'
import type { DeepChatSessionStore } from '@/presenter/agentRuntimePresenter/sessionStore'
import type { DeepChatTapeService } from '@/presenter/agentRuntimePresenter/tapeService'
import type { SessionSettingsService } from '@/presenter/agentRuntimePresenter/sessionSettingsService'
import type { PendingInputService } from '@/presenter/agentRuntimePresenter/pendingInputService'
import type { TurnPreparationService } from '@/presenter/agentRuntimePresenter/turnPreparationService'
import type { MemoryCompactionService } from '@/presenter/agentRuntimePresenter/memoryCompactionService'
import type { ToolOutputGuard } from '@/presenter/agentRuntimePresenter/toolOutputGuard'
import type { NewSessionHooksBridge } from '@/presenter/hooksNotifications/newSessionBridge'

vi.mock('@/presenter/agentRuntimePresenter/process', () => ({
  processStream: vi.fn()
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

vi.mock('@/presenter/agentRuntimePresenter/internalSessionEvents', () => ({
  buildAssistantDeliverySegments: vi.fn(() => []),
  buildAssistantPreviewMarkdown: vi.fn(() => ''),
  buildAssistantResponseMarkdown: vi.fn(() => ''),
  emitDeepChatInternalSessionUpdate: vi.fn(),
  extractWaitingInteraction: vi.fn(() => null)
}))

import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { processStream } from '@/presenter/agentRuntimePresenter/process'
import {
  StreamLifecycleService,
  type StreamLifecycleDependencies,
  type StreamLifecycleHost
} from '@/presenter/agentRuntimePresenter/streamLifecycleService'
import type { ProcessParams, ProcessResult } from '@/presenter/agentRuntimePresenter/types'

const SYSTEM_MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'SYSTEM' },
  { role: 'user', content: 'Hello' }
]

const MODEL_CONFIG = {
  contextLength: 32_000,
  maxTokens: 2_000,
  temperature: 0.2,
  vision: true
} as ModelConfig

const GENERATION_SETTINGS = {
  systemPrompt: 'SYSTEM',
  temperature: 0.2,
  contextLength: 32_000,
  maxTokens: 2_000,
  timeout: 30_000
}

const INTERLEAVED_REASONING = {
  preserveReasoningContent: false,
  preserveEmptyReasoningContent: false,
  forcedBySessionSetting: false,
  portraitInterleaved: false,
  reasoningSupported: false,
  providerDbSourceUrl: 'https://example.invalid/providers.json'
}

function createRecord(
  id: string,
  role: ChatMessageRecord['role'],
  content: string
): ChatMessageRecord {
  return {
    id,
    sessionId: 's1',
    orderSeq: role === 'user' ? 1 : 2,
    role,
    content,
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    createdAt: 1,
    updatedAt: 1
  }
}

function asyncEvents(events: LLMCoreStreamEvent[]): AsyncGenerator<LLMCoreStreamEvent> {
  return (async function* () {
    for (const event of events) yield event
  })()
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createFixture() {
  const runtimeSharedState = new RuntimeSharedState()
  const runtimeState: DeepChatSessionState = {
    status: 'idle',
    providerId: 'openai',
    modelId: 'gpt-4.1',
    permissionMode: 'full_access'
  }
  runtimeSharedState.runtimeState.set('s1', runtimeState)

  const assistantBlocks: AssistantMessageBlock[] = [
    { type: 'content', content: 'partial', status: 'success', timestamp: 1 }
  ]
  const records = new Map<string, ChatMessageRecord>([
    ['user-1', createRecord('user-1', 'user', 'Hello')],
    ['assistant-1', createRecord('assistant-1', 'assistant', JSON.stringify(assistantBlocks))]
  ])
  const messageStore = {
    getMessage: vi.fn((messageId: string) => records.get(messageId) ?? null),
    setMessageError: vi.fn(),
    getMaxMessageTraceRequestSeq: vi.fn(() => 0),
    insertMessageTrace: vi.fn()
  }
  const tapeService = {
    listViewManifestsByMessage: vi.fn(() => []),
    getViewManifestSourceMaps: vi.fn(() => ({
      latestEntryId: 3,
      reconstructionAnchorEntryIds: [],
      reconstructionAnchorEntryId: null,
      entryIdByMessageId: new Map(),
      toolCallEntryIdByToolId: new Map(),
      toolResultEntryIdByToolId: new Map()
    })),
    appendViewManifest: vi.fn(),
    ensureSessionTapeReady: vi.fn(() => ({ historyRecords: [] }))
  }
  const sessionStore = {
    getReconstructionAnchorPromptState: vi.fn(() => null)
  }
  const pendingInputService = {
    consumeQueuedInput: vi.fn(),
    consumeClaimedInput: vi.fn(),
    rollbackClaimedInputTurn: vi.fn(),
    releaseClaimedInput: vi.fn(),
    drainPendingQueueIfPossible: vi.fn(async () => false),
    hasPendingSteerInput: vi.fn(() => false)
  }
  const memoryCompactionService = {
    prepareForContextPressureRecovery: vi.fn(async () => null),
    applyCompactionIntent: vi.fn(),
    triggerMemoryExtractionFromCompaction: vi.fn(),
    appendMemoryInjection: vi.fn(async (_sessionId: string, prompt: string) => prompt),
    getLatestUserQuery: vi.fn(() => 'Hello'),
    triggerMemoryExtractionFallback: vi.fn()
  }
  const turnPreparationService = {
    normalizeUserMessageInput: vi.fn((input: string | SendMessageInput) =>
      typeof input === 'string' ? { text: input, files: [] } : input
    ),
    prepareNewTurn: vi.fn(async (input) => {
      input.onMessageCreated?.('user', 'user-1')
      input.onMessageCreated?.('assistant', 'assistant-1')
      return {
        sessionId: 's1',
        state: runtimeState,
        normalizedInput: { text: 'Hello', files: [] },
        projectDir: '/workspace',
        generationSettings: GENERATION_SETTINGS,
        messages: SYSTEM_MESSAGES.map((message) => ({ ...message })),
        tools: [],
        baseSystemPrompt: 'SYSTEM',
        effectiveActiveSkillNames: [],
        interleavedReasoning: INTERLEAVED_REASONING,
        userMessageId: 'user-1',
        assistantMessageId: 'assistant-1',
        summaryState: {
          summaryText: '',
          summaryCursorOrderSeq: 1,
          summaryUpdatedAt: null
        },
        supportsVision: true,
        supportsAudioInput: false,
        contextBudgetLength: 32_000,
        maxTokens: 2_000,
        toolReserveTokens: 0,
        viewContext: {
          taskType: 'chat',
          policy: 'legacy_context_v1',
          policyVersion: 1,
          selection: {
            includedRecords: [],
            excludedRecords: [],
            includesSystemPrompt: true,
            newUserMessageId: 'user-1'
          },
          summaryCursorOrderSeq: 1,
          supportsVision: true,
          supportsAudioInput: false,
          traceDebugEnabled: false
        },
        preStreamStartedAt: Date.now(),
        refreshSystemPrompt: vi.fn(async () => 'SYSTEM')
      }
    }),
    resetRuntimeActivatedSkills: vi.fn(),
    resolveInterleavedReasoningConfig: vi.fn(() => INTERLEAVED_REASONING),
    resolveDeepChatContextBudgetLength: vi.fn((_providerId, contextLength) => contextLength),
    resolveCapabilityProviderId: vi.fn((providerId) => providerId),
    getReasoningPortrait: vi.fn(() => null),
    resolveActiveSkillNamesForToolProfile: vi.fn(async () => []),
    resolveAgentExtensionPolicy: vi.fn(async () => ({})),
    resolveEffectiveActiveSkillNames: vi.fn((skillNames) => skillNames),
    loadToolDefinitionsForSession: vi.fn(async () => []),
    supportsVision: vi.fn(() => true),
    supportsAudioInput: vi.fn(() => false),
    shouldBypassDeepChatContextBudget: vi.fn(() => false),
    normalizeNullablePolicyList: vi.fn((value) => value),
    filterSkillNamesByPolicy: vi.fn((skillNames) => skillNames ?? []),
    activateRuntimeSkill: vi.fn(async () => []),
    buildSystemPromptWithSkills: vi.fn(async () => 'SYSTEM')
  }
  const sessionSettingsService = {
    getEffectiveGenerationSettings: vi.fn(async () => GENERATION_SETTINGS)
  }
  const provider = {
    coreStream: vi.fn(() => asyncEvents([{ type: 'text', content: 'done' }]))
  }
  const llmProviderPresenter = {
    getProviderInstance: vi.fn(() => provider),
    executeWithRateLimit: vi.fn(async () => undefined)
  }
  const configPresenter = {
    getModelConfig: vi.fn(() => MODEL_CONFIG),
    getSetting: vi.fn(() => false)
  }
  const hooksBridge = { dispatch: vi.fn() }
  let runSequence = 0
  const generationControlService = new GenerationControlService(
    runtimeSharedState,
    vi.fn(),
    () => `run-${++runSequence}`
  )
  const host = {
    hasPendingInteractions: vi.fn(() => false),
    resolveProjectDir: vi.fn(() => '/workspace'),
    getSessionAgentId: vi.fn(() => 'deepchat'),
    setSessionStatus: vi.fn((_sessionId: string, status: DeepChatSessionState['status']) => {
      runtimeState.status = status
    }),
    markFirstTurnReady: vi.fn(),
    autoGrantPermission: vi.fn(async () => undefined),
    reviewToolPermission: vi.fn(async () => ({ decision: 'ask_user' as const })),
    registerActiveProviderPermission: vi.fn(),
    normalizeToolResult: vi.fn(async (input) => input.content as MCPToolResponse['content'])
  }

  const dependencies: StreamLifecycleDependencies = {
    llmProviderPresenter: llmProviderPresenter as unknown as ILlmProviderPresenter,
    configPresenter: configPresenter as unknown as IConfigPresenter,
    toolPresenter: null as IToolPresenter | null,
    messageStore: messageStore as unknown as DeepChatMessageStore,
    sessionStore: sessionStore as unknown as DeepChatSessionStore,
    tapeService: tapeService as unknown as DeepChatTapeService,
    runtimeSharedState,
    generationControlService,
    sessionSettingsService: sessionSettingsService as unknown as SessionSettingsService,
    pendingInputService: pendingInputService as unknown as PendingInputService,
    turnPreparationService: turnPreparationService as unknown as TurnPreparationService,
    memoryCompactionService: memoryCompactionService as unknown as MemoryCompactionService,
    toolOutputGuard: {} as ToolOutputGuard,
    hooksBridge: hooksBridge as unknown as NewSessionHooksBridge
  }
  const service = new StreamLifecycleService(dependencies, host as StreamLifecycleHost)

  return {
    service,
    runtimeSharedState,
    runtimeState,
    messageStore,
    tapeService,
    pendingInputService,
    memoryCompactionService,
    turnPreparationService,
    sessionSettingsService,
    llmProviderPresenter,
    configPresenter,
    provider,
    hooksBridge,
    generationControlService,
    host
  }
}

describe('StreamLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(processStream).mockResolvedValue({ status: 'completed' })
  })

  it('persists supplied accounting metadata when settling a pre-stream abort', () => {
    const fixture = createFixture()
    const metadata = JSON.stringify({
      runId: 'paused-run',
      runOutcome: 'aborted',
      runStopReason: 'user_stop',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 4
    })

    fixture.service.settleAbortedTurn('s1', 'assistant-1', undefined, metadata)

    expect(fixture.messageStore.setMessageError).toHaveBeenCalledWith(
      'assistant-1',
      expect.arrayContaining([
        expect.objectContaining({ content: 'common.error.userCanceledGeneration' })
      ]),
      metadata
    )
  })

  it('orchestrates a prepared turn and settles a completed queued input', async () => {
    const fixture = createFixture()

    const result = await fixture.service.processMessage('s1', 'Hello', {
      projectDir: '/workspace',
      pendingQueueItemId: 'pending-1',
      pendingQueueItemSource: 'queue',
      emitRefreshBeforeStream: true
    })

    expect(result).toEqual({ requestId: 'assistant-1', messageId: 'assistant-1' })
    expect(fixture.turnPreparationService.prepareNewTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        content: { text: 'Hello', files: [] },
        projectDir: '/workspace',
        signal: expect.any(AbortSignal)
      })
    )
    const params = vi.mocked(processStream).mock.calls[0]?.[0]
    expect(params?.io).toMatchObject({
      sessionId: 's1',
      messageId: 'assistant-1',
      requestId: 's1:run-1'
    })
    expect(fixture.pendingInputService.consumeClaimedInput).toHaveBeenCalledWith(
      's1',
      'pending-1',
      'queue'
    )
    expect(fixture.host.setSessionStatus.mock.calls.map((call) => call[1])).toEqual([
      'generating',
      'idle'
    ])
    expect(fixture.memoryCompactionService.triggerMemoryExtractionFallback).toHaveBeenCalledWith(
      's1'
    )
    expect(fixture.pendingInputService.drainPendingQueueIfPossible).toHaveBeenCalledWith(
      's1',
      'completed'
    )
    expect(fixture.turnPreparationService.resetRuntimeActivatedSkills).toHaveBeenCalledWith('s1')
    expect(fixture.generationControlService.getActiveGeneration('s1')).toBeNull()
    expect(fixture.hooksBridge.dispatch).toHaveBeenCalledWith(
      'SessionStart',
      expect.objectContaining({ sessionId: 's1', messageId: 'assistant-1' })
    )
    expect(fixture.hooksBridge.dispatch).toHaveBeenCalledWith(
      'SessionEnd',
      expect.objectContaining({ sessionId: 's1' })
    )
  })

  it('settles a preparation CanceledError with a canceled block and consumes a steer claim', async () => {
    const fixture = createFixture()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fixture.turnPreparationService.prepareNewTurn.mockImplementationOnce(async (input) => {
      input.onMessageCreated?.('user', 'user-1')
      input.onMessageCreated?.('assistant', 'assistant-1')
      const error = new Error('Canceled')
      error.name = 'CanceledError'
      throw error
    })

    const result = await fixture.service.processMessage('s1', 'Hello', {
      pendingQueueItemId: 'steer-1',
      pendingQueueItemSource: 'steer'
    })

    expect(result).toEqual({ requestId: 'assistant-1', messageId: 'assistant-1' })
    expect(fixture.pendingInputService.consumeClaimedInput).toHaveBeenCalledWith(
      's1',
      'steer-1',
      'steer'
    )
    expect(fixture.messageStore.setMessageError).toHaveBeenCalledWith(
      'assistant-1',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          content: 'common.error.userCanceledGeneration'
        })
      ]),
      expect.any(String)
    )
    const metadata = JSON.parse(fixture.messageStore.setMessageError.mock.calls[0][2])
    expect(metadata).toEqual(
      expect.objectContaining({
        runId: 'assistant-1',
        runOutcome: 'aborted',
        runStopReason: 'user_stop',
        providerRounds: 0,
        toolCalls: 0
      })
    )
    expect(fixture.runtimeState.status).toBe('idle')
    expect(fixture.hooksBridge.dispatch).toHaveBeenCalledWith(
      'Stop',
      expect.objectContaining({ stop: { reason: 'user_stop', userStop: true } })
    )
    errorLog.mockRestore()
  })

  it('promotes the preparation controller before blocked settings resolve', async () => {
    const fixture = createFixture()
    const settings = createDeferred<typeof GENERATION_SETTINGS>()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fixture.sessionSettingsService.getEffectiveGenerationSettings.mockReturnValueOnce(
      settings.promise
    )

    const turn = fixture.service.processMessage('s1', 'Hello')
    await vi.waitFor(() => {
      expect(fixture.sessionSettingsService.getEffectiveGenerationSettings).toHaveBeenCalledOnce()
    })

    const preparationSignal =
      fixture.turnPreparationService.prepareNewTurn.mock.calls[0]?.[0].signal
    expect(fixture.generationControlService.getAbortSignal('s1')).toBe(preparationSignal)
    expect(fixture.generationControlService.getActiveGeneration('s1')).toEqual({
      eventId: 'assistant-1',
      runId: 's1:run-1'
    })

    fixture.generationControlService.cancelGeneration('s1')
    settings.resolve(GENERATION_SETTINGS)

    await expect(turn).resolves.toEqual({
      requestId: 'assistant-1',
      messageId: 'assistant-1'
    })
    expect(preparationSignal.aborted).toBe(true)
    expect(processStream).not.toHaveBeenCalled()
    expect(fixture.provider.coreStream).not.toHaveBeenCalled()
    expect(fixture.runtimeState.status).toBe('idle')
    expect(fixture.generationControlService.getActiveGeneration('s1')).toBeNull()
    expect(fixture.messageStore.setMessageError).toHaveBeenCalledWith(
      'assistant-1',
      expect.arrayContaining([
        expect.objectContaining({ content: 'common.error.userCanceledGeneration' })
      ]),
      expect.any(String)
    )
    expect(JSON.parse(fixture.messageStore.setMessageError.mock.calls[0][2])).toEqual(
      expect.objectContaining({
        runId: 's1:run-1',
        runOutcome: 'aborted',
        runStopReason: 'user_stop',
        providerRounds: 0,
        toolCalls: 0
      })
    )
    errorLog.mockRestore()
  })

  it('does not start stream processing after cancellation during blocked skill resolution', async () => {
    const fixture = createFixture()
    const skillNames = createDeferred<string[]>()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fixture.turnPreparationService.resolveActiveSkillNamesForToolProfile.mockReturnValueOnce(
      skillNames.promise
    )

    const turn = fixture.service.processMessage('s1', 'Hello')
    await vi.waitFor(() => {
      expect(
        fixture.turnPreparationService.resolveActiveSkillNamesForToolProfile
      ).toHaveBeenCalledOnce()
    })

    fixture.generationControlService.cancelGeneration('s1')
    skillNames.resolve([])

    await expect(turn).resolves.toEqual({
      requestId: 'assistant-1',
      messageId: 'assistant-1'
    })
    expect(processStream).not.toHaveBeenCalled()
    expect(fixture.turnPreparationService.resolveAgentExtensionPolicy).not.toHaveBeenCalled()
    expect(fixture.provider.coreStream).not.toHaveBeenCalled()
    expect(fixture.runtimeState.status).toBe('idle')
    expect(fixture.generationControlService.getActiveGeneration('s1')).toBeNull()
    errorLog.mockRestore()
  })

  it('does not start stream processing after cancellation during blocked policy resolution', async () => {
    const fixture = createFixture()
    const extensionPolicy = createDeferred<Record<string, never>>()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fixture.turnPreparationService.resolveAgentExtensionPolicy.mockReturnValueOnce(
      extensionPolicy.promise
    )

    const turn = fixture.service.processMessage('s1', 'Hello')
    await vi.waitFor(() => {
      expect(fixture.turnPreparationService.resolveAgentExtensionPolicy).toHaveBeenCalledOnce()
    })

    fixture.generationControlService.cancelGeneration('s1')
    extensionPolicy.resolve({})

    await expect(turn).resolves.toEqual({
      requestId: 'assistant-1',
      messageId: 'assistant-1'
    })
    expect(processStream).not.toHaveBeenCalled()
    expect(fixture.turnPreparationService.loadToolDefinitionsForSession).not.toHaveBeenCalled()
    expect(fixture.provider.coreStream).not.toHaveBeenCalled()
    expect(fixture.runtimeState.status).toBe('idle')
    expect(fixture.generationControlService.getActiveGeneration('s1')).toBeNull()
    errorLog.mockRestore()
  })

  it('rolls back a claimed turn and persists an assistant error when streaming fails', async () => {
    const fixture = createFixture()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(processStream).mockRejectedValueOnce(new Error('provider failed'))

    const result = await fixture.service.processMessage('s1', 'Hello', {
      pendingQueueItemId: 'pending-1',
      pendingQueueItemSource: 'queue'
    })

    expect(result).toEqual({ requestId: 'assistant-1', messageId: 'assistant-1' })
    expect(fixture.pendingInputService.rollbackClaimedInputTurn).toHaveBeenCalledWith(
      's1',
      'pending-1',
      'queue',
      'user-1'
    )
    expect(fixture.messageStore.setMessageError).toHaveBeenCalledWith(
      'assistant-1',
      expect.arrayContaining([
        expect.objectContaining({ type: 'error', content: 'provider failed' })
      ]),
      expect.any(String)
    )
    expect(JSON.parse(fixture.messageStore.setMessageError.mock.calls[0][2])).toEqual(
      expect.objectContaining({
        runId: 's1:run-1',
        runOutcome: 'error',
        runStopReason: 'pre_stream_error',
        provider: 'openai',
        model: 'gpt-4.1',
        providerRounds: 0,
        toolCalls: 0
      })
    )
    expect(fixture.hooksBridge.dispatch).toHaveBeenCalledWith(
      'Stop',
      expect.objectContaining({ stop: { reason: 'pre_stream_error', userStop: false } })
    )
    expect(fixture.runtimeState.status).toBe('error')
    expect(fixture.generationControlService.getActiveGeneration('s1')).toBeNull()
    errorLog.mockRestore()
  })

  it('persists run metadata when provider lookup fails before processStream starts', async () => {
    const fixture = createFixture()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fixture.llmProviderPresenter.getProviderInstance.mockImplementationOnce(() => {
      throw new Error('provider unavailable')
    })

    await fixture.service.processMessage('s1', 'Hello')

    expect(processStream).not.toHaveBeenCalled()
    expect(JSON.parse(fixture.messageStore.setMessageError.mock.calls[0][2])).toEqual(
      expect.objectContaining({
        runId: 's1:run-1',
        runOutcome: 'error',
        runStopReason: 'pre_stream_error',
        providerRounds: 0,
        toolCalls: 0
      })
    )
    errorLog.mockRestore()
  })

  it('does not let a stale stream failure overwrite a replacement generation status', async () => {
    const fixture = createFixture()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let rejectStream!: (error: Error) => void
    vi.mocked(processStream).mockImplementationOnce(
      () =>
        new Promise<ProcessResult>((_resolve, reject) => {
          rejectStream = reject
        })
    )

    const staleTurn = fixture.service.processMessage('s1', 'Hello')
    await vi.waitFor(() => expect(processStream).toHaveBeenCalledOnce())
    const replacementController = new AbortController()
    const replacement = fixture.generationControlService.registerActiveGeneration(
      's1',
      'assistant-replacement',
      replacementController
    )
    rejectStream(new Error('late provider failure'))

    await expect(staleTurn).resolves.toEqual({
      requestId: 'assistant-1',
      messageId: 'assistant-1'
    })
    expect(fixture.runtimeState.status).toBe('generating')
    expect(fixture.generationControlService.isActiveRun('s1', replacement.runId)).toBe(true)
    expect(fixture.messageStore.setMessageError).toHaveBeenCalledWith(
      'assistant-1',
      expect.any(Array),
      expect.any(String)
    )
    errorLog.mockRestore()
  })

  it('classifies a local request preflight overflow and persists zero executed rounds', async () => {
    const fixture = createFixture()
    const providerRequestStarted = vi.fn()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fixture.sessionSettingsService.getEffectiveGenerationSettings.mockResolvedValueOnce({
      ...GENERATION_SETTINGS,
      contextLength: 1,
      maxTokens: 1
    })
    vi.mocked(processStream).mockImplementationOnce(async (params: ProcessParams) => {
      for await (const _event of params.coreStream(
        params.messages,
        params.modelId,
        params.modelConfig,
        params.temperature,
        params.maxTokens,
        params.tools,
        providerRequestStarted
      )) {
        // Exhaust the wrapped provider stream so local preflight runs.
      }
      return { status: 'completed' }
    })

    await fixture.service.processMessage('s1', 'Hello')

    expect(fixture.provider.coreStream).not.toHaveBeenCalled()
    expect(providerRequestStarted).not.toHaveBeenCalled()
    expect(JSON.parse(fixture.messageStore.setMessageError.mock.calls[0][2])).toEqual(
      expect.objectContaining({
        runId: 's1:run-1',
        runOutcome: 'error',
        runStopReason: 'context_window',
        providerRounds: 0,
        toolCalls: 0
      })
    )
    expect(fixture.hooksBridge.dispatch).toHaveBeenCalledWith(
      'Stop',
      expect.objectContaining({ stop: { reason: 'context_window', userStop: false } })
    )
    errorLog.mockRestore()
  })

  it('keeps a paused interaction generating while consuming its claimed queue item', async () => {
    const fixture = createFixture()
    vi.mocked(processStream).mockResolvedValueOnce({
      status: 'paused',
      pendingInteractions: []
    })

    await fixture.service.processMessage('s1', 'Hello', {
      pendingQueueItemId: 'pending-1',
      pendingQueueItemSource: 'queue'
    })

    expect(fixture.pendingInputService.consumeClaimedInput).toHaveBeenCalledWith(
      's1',
      'pending-1',
      'queue'
    )
    expect(fixture.runtimeState.status).toBe('generating')
    expect(fixture.pendingInputService.drainPendingQueueIfPossible).not.toHaveBeenCalled()
    expect(fixture.hooksBridge.dispatch.mock.calls.some(([event]) => event === 'SessionEnd')).toBe(
      false
    )
    expect(fixture.generationControlService.getActiveGeneration('s1')).toBeNull()
  })

  it('leaves returned-abort persistence to processStream and advances the queue', async () => {
    const fixture = createFixture()
    vi.mocked(processStream).mockResolvedValueOnce({
      status: 'aborted',
      stopReason: 'user_stop',
      usage: { totalTokens: 3 }
    })

    await fixture.service.processMessage('s1', 'Hello')

    expect(fixture.runtimeState.status).toBe('idle')
    expect(fixture.messageStore.setMessageError).not.toHaveBeenCalled()
    expect(fixture.pendingInputService.drainPendingQueueIfPossible).toHaveBeenCalledWith(
      's1',
      'completed'
    )
    expect(
      fixture.hooksBridge.dispatch.mock.calls.filter(([event]) => event === 'Stop')
    ).toHaveLength(1)
  })

  it('publishes rate-limit snapshots and persists the provider view and request trace', async () => {
    const fixture = createFixture()
    const providerRequestStarted = vi.fn()
    fixture.configPresenter.getSetting.mockReturnValue(true)
    fixture.llmProviderPresenter.executeWithRateLimit.mockImplementationOnce(
      async (_providerId, options) => {
        options?.onQueued?.({
          providerId: 'openai',
          qpsLimit: 1,
          currentQps: 1,
          queueLength: 2,
          estimatedWaitTime: 500
        })
      }
    )
    fixture.provider.coreStream.mockImplementationOnce(
      (_messages, _modelId, modelConfig: ModelConfig) =>
        (async function* () {
          const traceConfig = (
            modelConfig as ModelConfig & {
              requestTraceContext?: {
                persist: (payload: {
                  endpoint: string
                  headers: Record<string, string>
                  body: unknown
                }) => Promise<void>
              }
            }
          ).requestTraceContext
          await traceConfig?.persist({
            endpoint: 'https://api.example.invalid/chat',
            headers: { authorization: 'Bearer secret' },
            body: { prompt: 'Hello' }
          })
          yield { type: 'text', content: 'done' } as LLMCoreStreamEvent
        })()
    )
    vi.mocked(processStream).mockImplementationOnce(async (params: ProcessParams) => {
      for await (const _event of params.coreStream(
        params.messages,
        params.modelId,
        params.modelConfig,
        params.temperature,
        params.maxTokens,
        params.tools,
        providerRequestStarted
      )) {
        // Exhaust the provider stream so rate limiting, manifests, and tracing all run.
      }
      params.onFirstProviderRoundReady?.()
      return { status: 'completed' }
    })

    await fixture.service.runStreamForMessage({
      sessionId: 's1',
      messageId: 'assistant-1',
      messages: SYSTEM_MESSAGES.map((message) => ({ ...message })),
      projectDir: '/workspace',
      tools: [],
      viewContext: {
        taskType: 'chat',
        policy: 'legacy_context_v1',
        policyVersion: 1,
        selection: {
          includedRecords: [],
          excludedRecords: [],
          includesSystemPrompt: true,
          newUserMessageId: 'user-1'
        },
        summaryCursorOrderSeq: 1,
        supportsVision: true,
        supportsAudioInput: false,
        traceDebugEnabled: true
      }
    })

    const streamUpdates = vi
      .mocked(publishDeepchatEvent)
      .mock.calls.filter(([event]) => event === 'chat.stream.updated')
    expect(streamUpdates).toHaveLength(2)
    expect(streamUpdates[0]?.[1]).toMatchObject({
      requestId: 's1:run-1',
      messageId: '__rate_limit__:s1:run-1',
      blocks: [expect.objectContaining({ action_type: 'rate_limit' })]
    })
    expect(streamUpdates[1]?.[1]).toMatchObject({ blocks: [] })
    expect(fixture.tapeService.appendViewManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        messageId: 'assistant-1',
        requestSeq: 1,
        taskType: 'chat',
        policy: 'legacy_context_v1'
      })
    )
    expect(fixture.messageStore.insertMessageTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        messageId: 'assistant-1',
        requestSeq: 1,
        endpoint: 'https://api.example.invalid/chat'
      })
    )
    expect(fixture.host.markFirstTurnReady).toHaveBeenCalledWith('s1')
    expect(providerRequestStarted).toHaveBeenCalledOnce()
  })

  it('recovers context pressure through the memory-compaction collaborator', async () => {
    const fixture = createFixture()
    const intent = { targetCursorOrderSeq: 2 }
    const controller = new AbortController()
    fixture.memoryCompactionService.prepareForContextPressureRecovery.mockResolvedValueOnce(intent)
    fixture.memoryCompactionService.applyCompactionIntent.mockResolvedValueOnce({
      summaryText: 'compact summary',
      summaryCursorOrderSeq: 2,
      summaryUpdatedAt: 10
    })
    fixture.memoryCompactionService.appendMemoryInjection.mockImplementationOnce(
      async (_sessionId, prompt) => `${prompt}\nMEMORY`
    )

    const result = await fixture.service.recoverRequestContextPressure({
      sessionId: 's1',
      providerId: 'openai',
      modelId: 'gpt-4.1',
      requestMessages: SYSTEM_MESSAGES.map((message) => ({ ...message })),
      baseSystemPrompt: 'SYSTEM',
      contextLength: 32_000,
      requestedMaxTokens: 2_000,
      tools: [] as MCPToolDefinition[],
      supportsVision: true,
      supportsAudioInput: false,
      interleavedReasoning: INTERLEAVED_REASONING,
      minimumProtectedTailCount: 0,
      signal: controller.signal
    })

    expect(fixture.memoryCompactionService.prepareForContextPressureRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        projectedMessages: [{ role: 'user', content: 'Hello' }],
        preserveInterleavedReasoning: false
      })
    )
    expect(
      fixture.memoryCompactionService.triggerMemoryExtractionFromCompaction
    ).toHaveBeenCalledWith('s1', intent)
    expect(fixture.memoryCompactionService.appendMemoryInjection).toHaveBeenCalledWith(
      's1',
      expect.any(String),
      'Hello',
      null,
      controller.signal
    )
    expect(result.summaryCursorOrderSeq).toBe(2)
    expect(result.systemPrompt).toContain('compact summary')
    expect(result.systemPrompt).toContain('MEMORY')
    expect(result.messages[0]).toMatchObject({ role: 'system', content: result.systemPrompt })
  })

  it('dispatches terminal hooks without letting a stale run overwrite replacement status', () => {
    const fixture = createFixture()
    const oldRun = fixture.generationControlService.registerActiveGeneration(
      's1',
      'assistant-1',
      new AbortController()
    )
    fixture.generationControlService.registerActiveGeneration(
      's1',
      'assistant-2',
      new AbortController()
    )
    fixture.host.setSessionStatus.mockClear()

    const result: ProcessResult = { status: 'completed', stopReason: 'complete' }
    fixture.service.applyProcessResultStatus('s1', result, oldRun.runId)

    expect(fixture.host.setSessionStatus).not.toHaveBeenCalled()
    expect(fixture.hooksBridge.dispatch).toHaveBeenCalledWith(
      'SessionEnd',
      expect.objectContaining({ sessionId: 's1' })
    )
  })

  it('dispatches the canonical provider error reason to terminal hooks', () => {
    const fixture = createFixture()

    fixture.service.applyProcessResultStatus('s1', {
      status: 'error',
      stopReason: 'provider_error',
      errorMessage: 'provider failed'
    })

    expect(fixture.hooksBridge.dispatch).toHaveBeenCalledWith(
      'Stop',
      expect.objectContaining({ stop: { reason: 'provider_error', userStop: false } })
    )
  })
})
