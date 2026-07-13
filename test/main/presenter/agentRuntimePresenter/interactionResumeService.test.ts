import { describe, expect, it, vi } from 'vitest'
import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  MessageMetadata
} from '@shared/types/agent-interface'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import {
  InteractionResumeService,
  type InteractionResumeHost
} from '@/presenter/agentRuntimePresenter/interactionResumeService'
import { GenerationControlService } from '@/presenter/agentRuntimePresenter/generationControlService'
import type { DeepChatMessageStore } from '@/presenter/agentRuntimePresenter/messageStore'
import { RuntimeSharedState } from '@/presenter/agentRuntimePresenter/runtimeSharedState'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function buildQuestionBlocks(toolCallId = 'tc1', question = 'Pick one'): AssistantMessageBlock[] {
  return [
    {
      type: 'tool_call',
      status: 'loading',
      tool_call: {
        id: toolCallId,
        name: 'deepchat_question',
        params: '{}'
      }
    },
    {
      type: 'action',
      action_type: 'question_request',
      status: 'pending',
      content: question,
      tool_call: {
        id: toolCallId,
        name: 'deepchat_question',
        params: '{}'
      },
      extra: {
        needsUserAction: true,
        questionText: question,
        questionOptions: [{ label: 'A' }]
      }
    }
  ]
}

function buildTwoQuestionBlocks(): AssistantMessageBlock[] {
  return [
    ...buildQuestionBlocks('tc1', 'Pick the first option'),
    ...buildQuestionBlocks('tc2', 'Pick the second option')
  ]
}

function buildPermissionBlocks(): AssistantMessageBlock[] {
  const toolCall = {
    id: 'tc1',
    name: 'echo',
    params: '{}',
    server_name: 'test-server'
  }
  return [
    {
      type: 'tool_call',
      status: 'loading',
      tool_call: { ...toolCall }
    },
    {
      type: 'action',
      action_type: 'tool_call_permission',
      status: 'pending',
      content: 'Allow echo?',
      tool_call: { ...toolCall },
      extra: {
        needsUserAction: true,
        permissionType: 'write',
        permissionRequest: JSON.stringify({
          permissionType: 'write',
          description: 'Allow echo?',
          serverName: 'test-server',
          toolName: 'echo'
        })
      }
    }
  ]
}

const echoToolDefinition: MCPToolDefinition = {
  type: 'function',
  function: {
    name: 'echo',
    description: 'Echo input',
    parameters: { type: 'object', properties: {} }
  },
  server: { name: 'test-server', icons: '', description: '' },
  source: 'mcp'
}

function createMessage(
  blocks: AssistantMessageBlock[],
  metadata: MessageMetadata = {}
): ChatMessageRecord {
  return {
    id: 'm1',
    sessionId: 's1',
    orderSeq: 1,
    role: 'assistant',
    content: JSON.stringify(blocks),
    status: 'pending',
    isContextEdge: 0,
    metadata: JSON.stringify(metadata),
    createdAt: 1,
    updatedAt: 1
  }
}

function createService(message: ChatMessageRecord) {
  const messageStore = {
    getMessage: vi.fn(() => message),
    getMessages: vi.fn(() => [message]),
    updateAssistantContent: vi.fn(),
    updateAssistantMetadata: vi.fn(),
    updateMessageStatus: vi.fn(),
    setMessageError: vi.fn()
  }
  const host = {
    messageStore: messageStore as unknown as DeepChatMessageStore,
    getRuntimeState: vi.fn(() => ({ providerId: 'openai', modelId: 'gpt-4' })),
    resolveProjectDir: vi.fn(() => '/tmp/project'),
    emitMessageRefresh: vi.fn(),
    dispatchHook: vi.fn(),
    setSessionStatus: vi.fn()
  } as unknown as InteractionResumeHost
  return {
    service: new InteractionResumeService(host),
    host,
    messageStore
  }
}

function createCancelableService(
  message: ChatMessageRecord,
  overrides: Partial<InteractionResumeHost> = {}
) {
  const runtimeSharedState = new RuntimeSharedState()
  const generationControlService = new GenerationControlService(
    runtimeSharedState,
    vi.fn(),
    () => 'run-1'
  )
  const messageStore = {
    getMessage: vi.fn(() => message),
    getMessages: vi.fn(() => [message]),
    updateAssistantContent: vi.fn(),
    updateAssistantMetadata: vi.fn(),
    updateMessageStatus: vi.fn(),
    setMessageError: vi.fn()
  }
  const callTool = vi.fn()
  const approvePermission = vi.fn()
  const host = {
    messageStore: messageStore as unknown as DeepChatMessageStore,
    generationControlService,
    toolPresenter: { callTool },
    sessionPermissionPort: { approvePermission },
    resolveProjectDir: vi.fn(() => '/tmp/project'),
    getSessionState: vi.fn(async () => ({ providerId: 'openai', modelId: 'gpt-4' })),
    loadToolDefinitionsForSession: vi.fn(async () => [echoToolDefinition]),
    getDisabledAgentTools: vi.fn(() => []),
    resolveAgentExtensionPolicy: vi.fn(async () => ({})),
    getSessionAgentId: vi.fn(() => 'deepchat'),
    getRuntimeState: vi.fn(() => ({ providerId: 'openai', modelId: 'gpt-4' })),
    dispatchHook: vi.fn(),
    publishStreamFailure: vi.fn(),
    resolveStreamRequestId: vi.fn(() => 'request-1'),
    emitMessageRefresh: vi.fn(),
    setSessionStatus: vi.fn(),
    settleAbortedTurn: vi.fn(),
    drainPendingQueueIfPossible: vi.fn(async () => false),
    ...overrides
  } as unknown as InteractionResumeHost
  return {
    service: new InteractionResumeService(host),
    host,
    messageStore,
    generationControlService,
    runtimeSharedState,
    callTool,
    approvePermission
  }
}

function createResumeService(
  message: ChatMessageRecord = createMessage([]),
  overrides: Partial<InteractionResumeHost> = {}
) {
  const runtimeSharedState = new RuntimeSharedState()
  const generationControlService = new GenerationControlService(
    runtimeSharedState,
    vi.fn(),
    () => 'run-1'
  )
  const messageStore = {
    getMessage: vi.fn(() => message),
    getMessages: vi.fn(() => [message]),
    updateAssistantContent: vi.fn(),
    updateAssistantMetadata: vi.fn(),
    updateMessageStatus: vi.fn(),
    setMessageError: vi.fn()
  }
  const appendMemoryInjection = vi.fn(async () => 'SYSTEM WITH MEMORY')
  const runStreamForMessage = vi.fn(
    async (args: Parameters<InteractionResumeHost['runStreamForMessage']>[0]) => {
      args.onRunRegistered?.('stream-run-1')
      return {
        runId: 'stream-run-1',
        result: { status: 'completed' as const, stopReason: 'complete' }
      }
    }
  )
  const applyProcessResultStatus = vi.fn()
  const clearPendingQueue = vi.fn(async () => false)
  const triggerMemoryExtractionFallback = vi.fn()
  const settleAbortedTurn = vi.fn()
  const host = {
    llmProviderPresenter: {},
    configPresenter: {
      getModelConfig: vi.fn(() => ({ contextLength: 32_000, maxTokens: 2_000 })),
      getSetting: vi.fn(() => false)
    },
    toolPresenter: null,
    messageStore: messageStore as unknown as DeepChatMessageStore,
    sessionStore: {
      getSummaryState: vi.fn(() => ({
        summaryText: null,
        summaryCursorOrderSeq: 1,
        summaryUpdatedAt: null
      })),
      getReconstructionAnchorPromptState: vi.fn(() => null)
    },
    tapeService: {
      ensureSessionTapeReady: vi.fn(() => ({ historyRecords: [message] }))
    },
    generationControlService,
    toolOutputGuard: {},
    getRuntimeState: vi.fn(() => ({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4.1',
      permissionMode: 'full_access'
    })),
    getSessionState: vi.fn(async () => ({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4.1',
      permissionMode: 'full_access'
    })),
    getSessionAgentId: vi.fn(() => 'deepchat'),
    resolveProjectDir: vi.fn(() => '/tmp/project'),
    setSessionStatus: vi.fn(),
    emitMessageRefresh: vi.fn(),
    dispatchHook: vi.fn(),
    publishStreamFailure: vi.fn(),
    resolveStreamRequestId: vi.fn(() => 'request-1'),
    getEffectiveSessionGenerationSettings: vi.fn(async () => ({
      systemPrompt: 'SYSTEM',
      temperature: 0.2,
      contextLength: 32_000,
      maxTokens: 2_000,
      timeout: 30_000
    })),
    shouldUseDeepChatContextBudget: vi.fn(() => false),
    resolveInterleavedReasoningConfig: vi.fn(() => ({
      preserveReasoningContent: false,
      preserveEmptyReasoningContent: false,
      forcedBySessionSetting: false,
      portraitInterleaved: false,
      reasoningSupported: false,
      providerDbSourceUrl: ''
    })),
    resolveDeepChatContextBudgetLength: vi.fn(() => 32_000),
    resolveActiveSkillNamesForToolProfile: vi.fn(async () => []),
    loadToolDefinitionsForSession: vi.fn(async () => []),
    buildSystemPromptWithSkills: vi.fn(async () => 'SYSTEM'),
    resolveAgentExtensionPolicy: vi.fn(async () => ({})),
    getDisabledAgentTools: vi.fn(() => []),
    supportsVision: vi.fn(() => false),
    supportsAudioInput: vi.fn(() => false),
    resolveCompactionStateForResumeTurn: vi.fn(),
    appendMemoryInjection,
    getLatestUserQuery: vi.fn(() => 'latest query'),
    runStreamForMessage,
    applyProcessResultStatus,
    settleAbortedTurn,
    drainPendingQueueIfPossible: clearPendingQueue,
    triggerMemoryExtractionFallback,
    invalidateSystemPromptCache: vi.fn(),
    invalidateToolProfileCache: vi.fn(),
    ...overrides
  } as unknown as InteractionResumeHost

  return {
    service: new InteractionResumeService(host),
    host,
    messageStore,
    generationControlService,
    runtimeSharedState,
    appendMemoryInjection,
    runStreamForMessage,
    applyProcessResultStatus,
    clearPendingQueue,
    triggerMemoryExtractionFallback,
    settleAbortedTurn
  }
}

const cancellationCases = [
  {
    label: 'generation cancellation',
    cancel: (service: GenerationControlService) => service.cancelGeneration('s1')
  },
  {
    label: 'session destruction',
    cancel: (service: GenerationControlService) => service.destroySession('s1')
  }
]

describe('InteractionResumeService', () => {
  it('resolves the first pending question and resumes with the persisted answer', async () => {
    const { service, host, messageStore } = createService(createMessage(buildQuestionBlocks()))
    const resume = vi.spyOn(service, 'resumeAssistantMessage').mockResolvedValue(true)

    await expect(
      service.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'question_option',
        optionLabel: 'A'
      })
    ).resolves.toEqual({ resumed: true })

    const persistedBlocks = messageStore.updateAssistantContent.mock.calls[0][1]
    expect(persistedBlocks[0]).toMatchObject({
      status: 'success',
      tool_call: { response: 'A' }
    })
    expect(persistedBlocks[1]).toMatchObject({
      status: 'success',
      extra: {
        needsUserAction: false,
        questionResolution: 'replied',
        questionFollowUpPending: false,
        answerText: 'A'
      }
    })
    expect(host.emitMessageRefresh).toHaveBeenCalledWith('s1', 'm1')
    expect(resume).toHaveBeenCalledWith('s1', 'm1', persistedBlocks, null, {})
  })

  it('replaces paused metadata when a question waits for a follow-up user message', async () => {
    const message = createMessage(buildQuestionBlocks(), {
      runId: 'run-1',
      runOutcome: 'paused',
      runStopReason: 'interaction',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 1,
      toolCalls: 1
    })
    const { service, host, messageStore } = createService(message)

    await expect(
      service.respondToolInteraction('s1', 'm1', 'tc1', { kind: 'question_other' })
    ).resolves.toEqual({ resumed: false, waitingForUserMessage: true })

    const metadata = JSON.parse(messageStore.updateAssistantContent.mock.calls[0][2])
    expect(metadata).toMatchObject({
      runId: 'run-1',
      runOutcome: 'completed',
      runStopReason: 'user_follow_up',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 1,
      toolCalls: 1
    })
    const persistedBlocks = messageStore.updateAssistantContent.mock.calls[0][1]
    expect(persistedBlocks[1].extra).toMatchObject({ questionFollowUpPending: true })
    expect(messageStore.updateMessageStatus).toHaveBeenCalledWith('m1', 'sent')
    expect(host.dispatchHook).toHaveBeenCalledWith(
      'Stop',
      expect.objectContaining({ stop: { reason: 'user_follow_up', userStop: false } })
    )
    expect(host.dispatchHook).toHaveBeenCalledWith(
      'SessionEnd',
      expect.objectContaining({ usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } })
    )
  })

  it('preserves an earlier follow-up intent until all pending questions are resolved', async () => {
    const message = createMessage(buildTwoQuestionBlocks(), {
      runId: 'run-1',
      runOutcome: 'paused',
      runStopReason: 'interaction',
      providerRounds: 1,
      toolCalls: 2
    })
    const { service, messageStore } = createService(message)
    const resume = vi.spyOn(service, 'resumeAssistantMessage').mockResolvedValue(true)

    await expect(
      service.respondToolInteraction('s1', 'm1', 'tc1', { kind: 'question_other' })
    ).resolves.toEqual({ resumed: false })

    const afterFirstQuestion = messageStore.updateAssistantContent.mock.calls[0][1]
    message.content = JSON.stringify(afterFirstQuestion)
    expect(service.hasPendingInteractions('s1')).toBe(true)
    expect(service.isAwaitingToolQuestionFollowUp('s1')).toBe(true)

    await expect(
      service.respondToolInteraction('s1', 'm1', 'tc2', {
        kind: 'question_option',
        optionLabel: 'A'
      })
    ).resolves.toEqual({ resumed: false, waitingForUserMessage: true })

    expect(resume).not.toHaveBeenCalled()
    expect(messageStore.updateMessageStatus).toHaveBeenLastCalledWith('m1', 'sent')
    expect(JSON.parse(messageStore.updateAssistantContent.mock.calls[1][2])).toMatchObject({
      runId: 'run-1',
      runOutcome: 'completed',
      runStopReason: 'user_follow_up',
      providerRounds: 1,
      toolCalls: 2
    })
  })

  it('does not infer follow-up intent from legacy resolved questions without an answer', async () => {
    const legacyResolvedQuestion: AssistantMessageBlock = {
      type: 'action',
      action_type: 'question_request',
      status: 'success',
      content: 'Legacy question',
      tool_call: { id: 'legacy', name: 'deepchat_question', params: '{}' },
      extra: {
        needsUserAction: false,
        questionResolution: 'replied'
      }
    }
    const message = createMessage([legacyResolvedQuestion, ...buildQuestionBlocks()])
    const { service } = createService(message)
    const resume = vi.spyOn(service, 'resumeAssistantMessage').mockResolvedValue(true)

    await expect(
      service.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'question_option',
        optionLabel: 'A'
      })
    ).resolves.toEqual({ resumed: true })

    expect(resume).toHaveBeenCalledOnce()
  })

  it('adds one completed deferred tool call to resumed stream accounting', async () => {
    const message = createMessage(buildPermissionBlocks(), {
      runId: 'run-1',
      runOutcome: 'paused',
      runStopReason: 'interaction',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 3
    })
    const { service, messageStore } = createCancelableService(message)
    vi.spyOn(service, 'executeDeferredToolCall').mockResolvedValue({
      responseText: 'done',
      isError: false,
      countedToolCall: true
    })
    const resume = vi.spyOn(service, 'resumeAssistantMessage').mockResolvedValue(true)

    await expect(
      service.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'permission',
        granted: true
      })
    ).resolves.toEqual({ resumed: true })

    const persistedMetadata = JSON.parse(messageStore.updateAssistantContent.mock.calls[0][2])
    expect(persistedMetadata).toMatchObject({
      runOutcome: 'paused',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 4
    })
    expect(resume.mock.calls[0][4]).toMatchObject({
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 4
    })
  })

  it('persists deferred terminal errors with cumulative usage and tool accounting', async () => {
    const message = createMessage(buildPermissionBlocks(), {
      runId: 'run-1',
      runOutcome: 'paused',
      runStopReason: 'interaction',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 3
    })
    const { service, host, messageStore } = createCancelableService(message)
    vi.spyOn(service, 'executeDeferredToolCall').mockResolvedValue({
      responseText: 'terminal failure',
      isError: true,
      countedToolCall: true,
      terminalError: 'terminal failure'
    })
    const resume = vi.spyOn(service, 'resumeAssistantMessage')

    await expect(
      service.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'permission',
        granted: true
      })
    ).resolves.toEqual({ resumed: false })

    const metadata = JSON.parse(messageStore.setMessageError.mock.calls[0][2])
    expect(metadata).toMatchObject({
      runId: 'run-1',
      runOutcome: 'error',
      runStopReason: 'tool_error',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 4
    })
    expect(host.publishStreamFailure).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'terminal failure' })
    )
    expect(resume).not.toHaveBeenCalled()
  })

  it('owns the interaction lock and rejects duplicate responses while resume is in flight', async () => {
    const { service } = createService(createMessage(buildQuestionBlocks()))
    let finishResume: ((value: boolean) => void) | undefined
    vi.spyOn(service, 'resumeAssistantMessage').mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishResume = resolve
        })
    )

    const first = service.respondToolInteraction('s1', 'm1', 'tc1', {
      kind: 'question_option',
      optionLabel: 'A'
    })
    await Promise.resolve()
    await expect(
      service.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'question_option',
        optionLabel: 'A'
      })
    ).resolves.toEqual({ resumed: false })

    finishResume?.(true)
    await expect(first).resolves.toEqual({ resumed: true })
  })

  it('detects pending interactions for queue and session lifecycle collaborators', () => {
    const { service } = createService(createMessage(buildQuestionBlocks()))
    expect(service.hasPendingInteractions('s1')).toBe(true)
  })

  it('resumes through the stream with one pre-stream controller and settles completed work', async () => {
    const {
      service,
      host,
      generationControlService,
      runtimeSharedState,
      appendMemoryInjection,
      runStreamForMessage,
      applyProcessResultStatus,
      clearPendingQueue,
      triggerMemoryExtractionFallback
    } = createResumeService()
    const ensureController = vi.spyOn(generationControlService, 'ensureSessionAbortController')
    const clearActiveGeneration = vi.spyOn(generationControlService, 'clearActiveGeneration')
    const clearSessionAbortController = vi.spyOn(
      generationControlService,
      'clearSessionAbortController'
    )

    await expect(service.resumeAssistantMessage('s1', 'm1', [])).resolves.toBe(true)

    const preStreamController = ensureController.mock.results[0].value
    const streamArgs = runStreamForMessage.mock.calls[0][0]
    expect(appendMemoryInjection.mock.calls[0][4]).toBe(preStreamController.signal)
    expect(streamArgs.preStreamAbortController).toBe(preStreamController)
    expect(streamArgs).toMatchObject({
      sessionId: 's1',
      messageId: 'm1',
      projectDir: '/tmp/project',
      baseSystemPrompt: 'SYSTEM',
      initialBlocks: []
    })
    expect(applyProcessResultStatus).toHaveBeenCalledWith(
      's1',
      { status: 'completed', stopReason: 'complete' },
      'stream-run-1'
    )
    expect(clearActiveGeneration).toHaveBeenCalledWith('s1', 'stream-run-1')
    expect(clearSessionAbortController).toHaveBeenCalledWith('s1', preStreamController)
    expect(clearPendingQueue).toHaveBeenCalledWith('s1', 'completed')
    expect(triggerMemoryExtractionFallback).toHaveBeenCalledWith('s1')
    expect(runtimeSharedState.abortControllers.size).toBe(0)
    expect(runtimeSharedState.activeGenerations.size).toBe(0)

    await expect(service.resumeAssistantMessage('s1', 'm1', [])).resolves.toBe(true)
    expect(runStreamForMessage).toHaveBeenCalledTimes(2)
  })

  it('propagates pre-stream cancellation through resume memory injection', async () => {
    const message = createMessage([], {
      runId: 'run-1',
      runOutcome: 'paused',
      runStopReason: 'interaction',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 4
    })
    const injection = createDeferred<string>()
    const appendMemoryInjection = vi.fn(() => injection.promise)
    const runStreamForMessage = vi.fn()
    const settleAbortedTurn = vi.fn()
    const { service, generationControlService } = createResumeService(message, {
      appendMemoryInjection,
      getLatestUserQuery: vi.fn(() => 'latest query'),
      runStreamForMessage,
      settleAbortedTurn,
      drainPendingQueueIfPossible: vi.fn(async () => false)
    })

    const resuming = service.resumeAssistantMessage('s1', 'm1', [])
    await vi.waitFor(() => expect(appendMemoryInjection).toHaveBeenCalledOnce())
    const signal = appendMemoryInjection.mock.calls[0][4]

    generationControlService.cancelGeneration('s1')
    injection.resolve('late prompt')

    await expect(resuming).resolves.toBe(false)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(true)
    expect(runStreamForMessage).not.toHaveBeenCalled()
    const settleArgs = settleAbortedTurn.mock.calls[0]
    expect(settleArgs.slice(0, 3)).toEqual(['s1', 'm1', undefined])
    expect(JSON.parse(settleArgs[3])).toMatchObject({
      runId: 'run-1',
      runOutcome: 'aborted',
      runStopReason: 'user_stop',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 4
    })
  })

  it('persists pre-stream failures with cumulative accounting and a terminal outcome', async () => {
    const message = createMessage([], {
      runId: 'run-1',
      runOutcome: 'paused',
      runStopReason: 'interaction',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 4
    })
    const preStreamError = new Error('memory unavailable')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { service, host, messageStore, runStreamForMessage } = createResumeService(message, {
      appendMemoryInjection: vi.fn(async () => {
        throw preStreamError
      })
    })

    try {
      await expect(service.resumeAssistantMessage('s1', 'm1', [])).rejects.toBe(preStreamError)
    } finally {
      consoleError.mockRestore()
    }

    const metadata = JSON.parse(messageStore.setMessageError.mock.calls[0][2])
    expect(metadata).toMatchObject({
      runId: 'run-1',
      runOutcome: 'error',
      runStopReason: 'pre_stream_error',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 4
    })
    expect(runStreamForMessage).not.toHaveBeenCalled()
    expect(host.publishStreamFailure).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'memory unavailable' })
    )
    expect(host.dispatchHook).toHaveBeenCalledWith(
      'Stop',
      expect.objectContaining({ stop: { reason: 'pre_stream_error', userStop: false } })
    )
    expect(host.dispatchHook).toHaveBeenCalledWith(
      'SessionEnd',
      expect.objectContaining({ error: { message: 'memory unavailable' } })
    )
  })

  it('uses the canonical context-window reason for resume pre-stream overflow failures', async () => {
    const message = createMessage([], {
      runId: 'run-1',
      runOutcome: 'paused',
      runStopReason: 'interaction',
      providerRounds: 2,
      toolCalls: 1
    })
    const overflow = new Error('maximum context length exceeded before resume')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { service, host, messageStore } = createResumeService(message, {
      appendMemoryInjection: vi.fn(async () => {
        throw overflow
      })
    })

    try {
      await expect(service.resumeAssistantMessage('s1', 'm1', [])).rejects.toBe(overflow)
    } finally {
      consoleError.mockRestore()
    }

    expect(JSON.parse(messageStore.setMessageError.mock.calls[0][2])).toMatchObject({
      runOutcome: 'error',
      runStopReason: 'context_window',
      providerRounds: 2,
      toolCalls: 1
    })
    expect(host.dispatchHook).toHaveBeenCalledWith(
      'Stop',
      expect.objectContaining({ stop: { reason: 'context_window', userStop: false } })
    )
  })

  it('persists resume budget terminal errors with the completed deferred tool count', async () => {
    const message = createMessage([], {
      runId: 'run-1',
      runOutcome: 'paused',
      runStopReason: 'interaction',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 3
    })
    const toolOutputGuard = {
      hasContextBudget: vi.fn(() => false),
      buildContextOverflowMessage: vi.fn(() => 'too large'),
      fitToolError: vi.fn(() => ({ kind: 'terminal_error' as const, message: 'too large' })),
      cleanupOffloadedOutput: vi.fn(async () => {}),
      replaceToolMessageContent: vi.fn()
    }
    const { service, host, messageStore, runStreamForMessage } = createResumeService(message, {
      shouldUseDeepChatContextBudget: vi.fn(() => true),
      resolveCompactionStateForResumeTurn: vi.fn(async () => ({
        summaryText: null,
        summaryCursorOrderSeq: 1,
        summaryUpdatedAt: null
      })),
      loadToolDefinitionsForSession: vi.fn(async () => [echoToolDefinition]),
      toolOutputGuard: toolOutputGuard as never
    })

    await expect(
      service.resumeAssistantMessage(
        's1',
        'm1',
        [],
        { id: 'tc1', name: 'echo', offloadPath: '/tmp/tool-output.txt' },
        {
          runId: 'run-1',
          runOutcome: 'paused',
          runStopReason: 'interaction',
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
          providerRounds: 2,
          toolCalls: 4
        }
      )
    ).resolves.toBe(false)

    const metadata = JSON.parse(messageStore.setMessageError.mock.calls[0][2])
    expect(metadata).toMatchObject({
      runId: 'run-1',
      runOutcome: 'error',
      runStopReason: 'context_window',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 4
    })
    expect(runStreamForMessage).not.toHaveBeenCalled()
    expect(host.publishStreamFailure).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'too large' })
    )
    expect(host.dispatchHook).toHaveBeenCalledWith(
      'Stop',
      expect.objectContaining({ stop: { reason: 'context_window', userStop: false } })
    )
    expect(host.dispatchHook).toHaveBeenCalledWith(
      'SessionEnd',
      expect.objectContaining({ error: { message: 'too large' } })
    )
  })

  it('does not persist a resume budget failure after cancellation during offload cleanup', async () => {
    const cleanup = createDeferred<void>()
    const toolOutputGuard = {
      hasContextBudget: vi.fn(() => false),
      buildContextOverflowMessage: vi.fn(() => 'too large'),
      fitToolError: vi.fn(() => ({ kind: 'terminal_error' as const, message: 'too large' })),
      cleanupOffloadedOutput: vi.fn(() => cleanup.promise),
      replaceToolMessageContent: vi.fn()
    }
    const {
      service,
      host,
      messageStore,
      generationControlService,
      runStreamForMessage,
      settleAbortedTurn
    } = createResumeService(createMessage([]), {
      shouldUseDeepChatContextBudget: vi.fn(() => true),
      resolveCompactionStateForResumeTurn: vi.fn(async () => ({
        summaryText: null,
        summaryCursorOrderSeq: 1,
        summaryUpdatedAt: null
      })),
      loadToolDefinitionsForSession: vi.fn(async () => [echoToolDefinition]),
      toolOutputGuard: toolOutputGuard as never
    })

    const resuming = service.resumeAssistantMessage('s1', 'm1', [], {
      id: 'tc1',
      name: 'echo',
      offloadPath: '/tmp/tool-output.txt'
    })
    await vi.waitFor(() => expect(toolOutputGuard.cleanupOffloadedOutput).toHaveBeenCalledOnce())

    generationControlService.cancelGeneration('s1')
    cleanup.resolve()

    await expect(resuming).resolves.toBe(false)
    expect(messageStore.updateAssistantContent).not.toHaveBeenCalled()
    expect(messageStore.setMessageError).not.toHaveBeenCalled()
    expect(host.publishStreamFailure).not.toHaveBeenCalled()
    expect(host.setSessionStatus).not.toHaveBeenCalledWith('s1', 'error')
    expect(runStreamForMessage).not.toHaveBeenCalled()
    expect(settleAbortedTurn).toHaveBeenCalledWith(
      's1',
      'm1',
      undefined,
      JSON.stringify({ runOutcome: 'aborted', runStopReason: 'user_stop' })
    )
  })

  it.each(cancellationCases)(
    'stops deferred tool resolution after $label while tool definitions are loading',
    async ({ cancel }) => {
      const definitions = createDeferred<MCPToolDefinition[]>()
      const { service, host, generationControlService, runtimeSharedState, callTool } =
        createCancelableService(createMessage(buildPermissionBlocks()), {
          loadToolDefinitionsForSession: vi.fn(() => definitions.promise)
        })

      const execution = service.executeDeferredToolCall('s1', 'm1', {
        id: 'tc1',
        name: 'echo',
        params: '{}',
        server_name: 'test-server'
      })

      await vi.waitFor(() => {
        expect(host.loadToolDefinitionsForSession).toHaveBeenCalledOnce()
      })
      expect(runtimeSharedState.deferredToolAbortControllers.size).toBe(1)

      cancel(generationControlService)
      definitions.resolve([echoToolDefinition])

      await expect(execution).rejects.toMatchObject({ name: 'AbortError' })
      expect(callTool).not.toHaveBeenCalled()
      expect(runtimeSharedState.deferredToolAbortControllers.size).toBe(0)
    }
  )

  it('settles an in-flight approved deferred tool as aborted with updated accounting', async () => {
    const settleAbortedTurn = vi.fn()
    const drainPendingQueueIfPossible = vi.fn(async () => false)
    const message = createMessage(buildPermissionBlocks(), {
      runId: 'run-1',
      runOutcome: 'paused',
      runStopReason: 'interaction',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 4
    })
    const { service, generationControlService, callTool, messageStore } = createCancelableService(
      message,
      { settleAbortedTurn, drainPendingQueueIfPossible }
    )
    callTool.mockImplementation(
      (_request: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          const signal = options?.signal
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )

    const responding = service.respondToolInteraction('s1', 'm1', 'tc1', {
      kind: 'permission',
      granted: true
    })
    await vi.waitFor(() => expect(callTool).toHaveBeenCalledOnce())

    generationControlService.cancelGeneration('s1')

    await expect(responding).resolves.toEqual({ resumed: false })
    const persistedMetadata = JSON.parse(messageStore.updateAssistantMetadata.mock.calls[0][1])
    expect(persistedMetadata).toMatchObject({
      runId: 'run-1',
      runOutcome: 'paused',
      runStopReason: 'interaction',
      providerRounds: 2,
      toolCalls: 5
    })
    expect(messageStore.updateAssistantContent).not.toHaveBeenCalled()
    const settledMetadata = JSON.parse(settleAbortedTurn.mock.calls[0][3])
    expect(settledMetadata).toMatchObject({
      runId: 'run-1',
      runOutcome: 'aborted',
      runStopReason: 'user_stop',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      providerRounds: 2,
      toolCalls: 5
    })
    expect(drainPendingQueueIfPossible).toHaveBeenCalledWith('s1', 'completed')
  })

  it('executes an available deferred tool and releases its owned controller', async () => {
    const toolOutputGuard = {
      prepareToolOutput: vi.fn(async () => ({
        kind: 'ok' as const,
        content: 'guarded tool result',
        offloadPath: '/tmp/tool-output.txt'
      }))
    }
    const { service, runtimeSharedState, callTool } = createCancelableService(
      createMessage(buildPermissionBlocks()),
      { toolOutputGuard: toolOutputGuard as never }
    )
    callTool.mockResolvedValue({
      content: 'raw tool result',
      rawData: {
        toolCallId: 'tc1',
        content: 'raw tool result',
        isError: false,
        rtkApplied: true,
        rtkMode: 'rewrite'
      }
    })

    await expect(
      service.executeDeferredToolCall('s1', 'm1', {
        id: 'tc1',
        name: 'echo',
        params: '{"value":"hello"}',
        server_name: 'test-server'
      })
    ).resolves.toMatchObject({
      responseText: 'guarded tool result',
      isError: false,
      countedToolCall: true,
      toolSource: 'mcp',
      serverName: 'test-server',
      offloadPath: '/tmp/tool-output.txt',
      rtkApplied: true,
      rtkMode: 'rewrite'
    })

    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'tc1',
        conversationId: 's1',
        providerId: 'openai',
        function: { name: 'echo', arguments: '{"value":"hello"}' }
      }),
      expect.objectContaining({
        agentId: 'deepchat',
        enabledSkillNames: undefined,
        signal: expect.any(AbortSignal)
      })
    )
    expect(toolOutputGuard.prepareToolOutput).toHaveBeenCalledWith({
      sessionId: 's1',
      toolCallId: 'tc1',
      toolName: 'echo',
      rawContent: 'raw tool result'
    })
    expect(runtimeSharedState.deferredToolAbortControllers.size).toBe(0)
  })

  it('preserves a deferred tool CanceledError without persisting it as tool output', async () => {
    const canceledError = new Error('provider canceled')
    canceledError.name = 'CanceledError'
    const { service, runtimeSharedState, callTool } = createCancelableService(
      createMessage(buildPermissionBlocks())
    )
    callTool.mockRejectedValue(canceledError)

    await expect(
      service.executeDeferredToolCall('s1', 'm1', {
        id: 'tc1',
        name: 'echo',
        params: '{}',
        server_name: 'test-server'
      })
    ).rejects.toBe(canceledError)

    expect(runtimeSharedState.deferredToolAbortControllers.size).toBe(0)
  })

  it('keeps ownership of a response controller outside deferred tool execution', async () => {
    const { service, host, generationControlService, runtimeSharedState } = createCancelableService(
      createMessage(buildPermissionBlocks()),
      { loadToolDefinitionsForSession: vi.fn(async () => []) }
    )
    const responseController = generationControlService.registerDeferredToolController('s1', 'tc1')
    const registerController = vi.spyOn(generationControlService, 'registerDeferredToolController')

    await expect(
      service.executeDeferredToolCall(
        's1',
        'm1',
        {
          id: 'tc1',
          name: 'echo',
          params: '{}',
          server_name: 'test-server'
        },
        responseController
      )
    ).resolves.toEqual({
      responseText: "Tool 'echo' is no longer available in the current session.",
      isError: true
    })

    expect(registerController).not.toHaveBeenCalled()
    expect(runtimeSharedState.deferredToolAbortControllers.get('s1:tc1')).toBe(responseController)
    expect(responseController.signal.aborted).toBe(false)
    expect(host.loadToolDefinitionsForSession).toHaveBeenCalledOnce()

    generationControlService.clearDeferredToolController('s1', 'tc1', responseController)
  })

  it.each(cancellationCases)(
    'does not execute or persist a granted permission response after $label during approval',
    async ({ cancel }) => {
      const approval = createDeferred<void>()
      const approvePermission = vi.fn(() => approval.promise)
      const {
        service,
        host,
        messageStore,
        generationControlService,
        runtimeSharedState,
        callTool
      } = createCancelableService(createMessage(buildPermissionBlocks()), {
        sessionPermissionPort: { approvePermission }
      })
      const registeredController = vi.spyOn(
        generationControlService,
        'registerDeferredToolController'
      )

      const response = service.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'permission',
        granted: true
      })

      await vi.waitFor(() => {
        expect(host.sessionPermissionPort?.approvePermission).toHaveBeenCalledOnce()
      })
      expect(registeredController).toHaveBeenCalledOnce()
      expect(runtimeSharedState.deferredToolAbortControllers.size).toBe(1)

      cancel(generationControlService)
      approval.resolve()

      await expect(response).resolves.toEqual({ resumed: false })
      expect(callTool).not.toHaveBeenCalled()
      expect(approvePermission).toHaveBeenCalledOnce()
      expect(messageStore.updateAssistantContent).not.toHaveBeenCalled()
      expect(messageStore.updateMessageStatus).not.toHaveBeenCalled()
      expect(messageStore.setMessageError).not.toHaveBeenCalled()
      expect(host.emitMessageRefresh).not.toHaveBeenCalled()
      expect(host.dispatchHook).not.toHaveBeenCalled()
      expect(host.settleAbortedTurn).toHaveBeenCalledWith(
        's1',
        'm1',
        undefined,
        JSON.stringify({ runOutcome: 'aborted', runStopReason: 'user_stop' })
      )
      expect(host.drainPendingQueueIfPossible).toHaveBeenCalledWith('s1', 'completed')
      expect(runtimeSharedState.deferredToolAbortControllers.size).toBe(0)
    }
  )
})
