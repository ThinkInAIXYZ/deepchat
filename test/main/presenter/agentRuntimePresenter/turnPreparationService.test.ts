import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelType } from '@shared/model'
import type { IConfigPresenter, ISkillPresenter } from '@shared/presenter'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import { RuntimeSharedState } from '@/presenter/agentRuntimePresenter/runtimeSharedState'
import type { DeepChatMessageStore } from '@/presenter/agentRuntimePresenter/messageStore'
import type { DeepChatSessionStore } from '@/presenter/agentRuntimePresenter/sessionStore'
import type { DeepChatTapeService } from '@/presenter/agentRuntimePresenter/tapeService'
import type { SessionSettingsService } from '@/presenter/agentRuntimePresenter/sessionSettingsService'

vi.mock('@/lib/agentRuntime/systemEnvPromptBuilder', () => ({
  buildRuntimeCapabilitiesPrompt: vi.fn(() => 'RUNTIME_CAPABILITIES'),
  buildSystemEnvPrompt: vi.fn(async () => 'ENVIRONMENT')
}))

vi.mock('@/presenter/agentRuntimePresenter/tapeViewAssembler', () => ({
  getTapeContextHistoryRecords: vi.fn((records) => records),
  buildTapeChatView: vi.fn((input) => ({
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.newUserContent.text }
    ],
    metadata: {
      includedRecords: [],
      excludedRecords: [],
      summaryCursor: {
        summaryCursorOrderSeq: input.options.summaryCursorOrderSeq,
        preCursorOrderSeqMin: null,
        preCursorOrderSeqMax: null,
        preCursorCount: 0
      },
      includesSystemPrompt: true
    },
    policyId: 'legacy_context_v1',
    policyVersion: 1
  }))
}))

import { buildSystemEnvPrompt } from '@/lib/agentRuntime/systemEnvPromptBuilder'
import {
  TurnPreparationService,
  type TurnPreparationCompactionPort,
  type TurnPreparationDependencies,
  type TurnPreparationHost
} from '@/presenter/agentRuntimePresenter/turnPreparationService'

const READ_TOOL: MCPToolDefinition = {
  type: 'function',
  source: 'agent',
  function: {
    name: 'read',
    description: 'Read a file',
    parameters: { type: 'object', properties: {} }
  },
  server: { name: 'deepchat', icons: '', description: 'Agent tools' }
}

function createFixture() {
  const runtimeSharedState = new RuntimeSharedState()
  runtimeSharedState.runtimeState.set('s1', {
    status: 'generating',
    providerId: 'openai',
    modelId: 'gpt-4.1',
    permissionMode: 'full_access'
  })

  let orderSeq = 0
  const messageStore = {
    getNextOrderSeq: vi.fn(() => ++orderSeq),
    createCompactionMessage: vi.fn(() => 'compaction-1'),
    createUserMessage: vi.fn(() => 'user-1'),
    createAssistantMessage: vi.fn(() => 'assistant-1')
  }
  const sessionStore = {
    getSummaryState: vi.fn(() => ({
      summaryText: 'prior summary',
      summaryCursorOrderSeq: 2,
      summaryUpdatedAt: 10
    })),
    getReconstructionAnchorPromptState: vi.fn(() => null)
  }
  const tapeService = {
    ensureSessionTapeReady: vi.fn(() => ({ historyRecords: [] }))
  }
  const compactionPort = {
    prepareForNextUserTurn: vi.fn(async () => null)
  }
  const sessionSettingsService = {
    getEffectiveGenerationSettings: vi.fn(async () => ({
      systemPrompt: 'BASE_PROMPT',
      temperature: 0.2,
      contextLength: 32_000,
      maxTokens: 2_000,
      timeout: 30_000
    }))
  }
  const configPresenter = {
    getModelConfig: vi.fn(() => ({ type: ModelType.Chat, vision: true })),
    supportsAudioInputCapability: vi.fn(() => true),
    supportsReasoningCapability: vi.fn(() => true),
    getReasoningPortrait: vi.fn(() => null),
    getCapabilityProviderId: vi.fn((providerId: string) => providerId),
    getSkillsEnabled: vi.fn(() => false),
    getSkillDraftSuggestionsEnabled: vi.fn(() => false),
    resolveDeepChatAgentConfig: vi.fn(async () => ({})),
    getSetting: vi.fn(() => false)
  }
  const toolPresenter = {
    getAllToolDefinitions: vi.fn(async () => [READ_TOOL]),
    syncAgentToolContext: vi.fn(),
    buildToolSystemPrompt: vi.fn(() => 'TOOLING'),
    clearAgentPlanState: vi.fn()
  }
  const host = {
    hasPendingInteractions: vi.fn(() => false),
    resolveProjectDir: vi.fn((_sessionId: string, incoming?: string | null) =>
      incoming === undefined ? '/workspace' : incoming
    ),
    getSessionAgentId: vi.fn(() => 'deepchat'),
    getSessionKind: vi.fn(() => 'agent'),
    getDisabledAgentTools: vi.fn(() => []),
    applyCompactionIntent: vi.fn(),
    emitCompactionState: vi.fn(),
    triggerMemoryExtractionFromCompaction: vi.fn(),
    appendMemoryInjection: vi.fn(async (_sessionId: string, prompt: string) => `${prompt}\nMEMORY`),
    emitMessageRefresh: vi.fn(),
    dispatchUserPromptSubmit: vi.fn()
  }

  const dependencies: TurnPreparationDependencies = {
    configPresenter: configPresenter as unknown as IConfigPresenter,
    toolPresenter: toolPresenter as unknown as IToolPresenter,
    sessionStore: sessionStore as unknown as DeepChatSessionStore,
    messageStore: messageStore as unknown as DeepChatMessageStore,
    tapeService: tapeService as unknown as DeepChatTapeService,
    compactionPort: compactionPort as TurnPreparationCompactionPort,
    sessionSettingsService: sessionSettingsService as unknown as SessionSettingsService,
    runtimeSharedState,
    providerCatalogPort: {
      getProviderModels: vi.fn(() => []),
      getCustomModels: vi.fn(() => [])
    },
    skillPresenter: undefined as unknown as Pick<
      ISkillPresenter,
      'getMetadataList' | 'getActiveSkills' | 'loadSkillContent'
    >
  }
  const service = new TurnPreparationService(dependencies, host as TurnPreparationHost)

  return {
    service,
    runtimeSharedState,
    messageStore,
    sessionStore,
    tapeService,
    compactionPort,
    sessionSettingsService,
    configPresenter,
    toolPresenter,
    host
  }
}

describe('TurnPreparationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prepares persisted messages, prompt context, tools, and stream-facing metadata', async () => {
    const fixture = createFixture()
    const onMessageCreated = vi.fn()

    const prepared = await fixture.service.prepareNewTurn({
      sessionId: 's1',
      content: {
        text: 'Inspect this',
        files: [],
        activeSkills: [' beta ', 'alpha', 'beta']
      },
      projectDir: '/workspace',
      onMessageCreated
    })

    expect(prepared.userMessageId).toBe('user-1')
    expect(prepared.assistantMessageId).toBe('assistant-1')
    expect(prepared.normalizedInput.activeSkills).toEqual(['alpha', 'beta'])
    expect(prepared.tools).toEqual([READ_TOOL])
    expect(prepared.messages[0]?.content).toContain('BASE_PROMPT')
    expect(prepared.messages[0]?.content).toContain('RUNTIME_CAPABILITIES')
    expect(prepared.messages[0]?.content).toContain('ENVIRONMENT')
    expect(prepared.messages[0]?.content).toContain('TOOLING')
    expect(prepared.messages[0]?.content).toContain('prior summary')
    expect(prepared.messages[0]?.content).toContain('MEMORY')
    expect(prepared.viewContext.selection.newUserMessageId).toBe('user-1')
    expect(onMessageCreated.mock.calls).toEqual([
      ['user', 'user-1'],
      ['assistant', 'assistant-1']
    ])
    expect(fixture.host.emitMessageRefresh).toHaveBeenCalledWith('s1', 'user-1')
    expect(fixture.host.dispatchUserPromptSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', messageId: 'user-1' })
    )
    expect(fixture.toolPresenter.clearAgentPlanState).toHaveBeenCalledWith('s1')
  })

  it('stops after a canceled memory injection before creating assistant context', async () => {
    const fixture = createFixture()
    const controller = new AbortController()
    let resolveInjection!: (prompt: string) => void
    fixture.host.appendMemoryInjection.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveInjection = resolve
        })
    )

    const preparing = fixture.service.prepareNewTurn({
      sessionId: 's1',
      content: 'Cancel during memory',
      signal: controller.signal
    })
    await vi.waitFor(() => expect(fixture.host.appendMemoryInjection).toHaveBeenCalled())

    controller.abort()
    resolveInjection('late prompt')

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.host.appendMemoryInjection).toHaveBeenCalledWith(
      's1',
      expect.any(String),
      'Cancel during memory',
      'user-1',
      controller.signal
    )
    expect(fixture.messageStore.createAssistantMessage).not.toHaveBeenCalled()
  })

  it('rejects a falsey user message id before refresh or assistant creation', async () => {
    const fixture = createFixture()
    fixture.messageStore.createUserMessage.mockReturnValue('')
    const onMessageCreated = vi.fn()

    await expect(
      fixture.service.prepareNewTurn({
        sessionId: 's1',
        content: 'Persist me',
        onMessageCreated
      })
    ).rejects.toThrow('Failed to create user message.')

    expect(onMessageCreated).not.toHaveBeenCalled()
    expect(fixture.host.emitMessageRefresh).not.toHaveBeenCalled()
    expect(fixture.messageStore.createAssistantMessage).not.toHaveBeenCalled()
  })

  it('owns prompt and tool caches and invalidates tool discovery on registry changes', async () => {
    const fixture = createFixture()

    const firstTools = await fixture.service.loadToolDefinitionsForSession('s1', '/workspace')
    const secondTools = await fixture.service.loadToolDefinitionsForSession('s1', '/workspace')
    const firstPrompt = await fixture.service.buildSystemPromptWithSkills(
      's1',
      'BASE_PROMPT',
      firstTools
    )
    const secondPrompt = await fixture.service.buildSystemPromptWithSkills(
      's1',
      'BASE_PROMPT',
      secondTools
    )

    expect(secondTools).toBe(firstTools)
    expect(secondPrompt).toBe(firstPrompt)
    expect(fixture.toolPresenter.getAllToolDefinitions).toHaveBeenCalledTimes(1)
    expect(fixture.toolPresenter.syncAgentToolContext).toHaveBeenCalledTimes(1)
    expect(buildSystemEnvPrompt).toHaveBeenCalledTimes(1)

    fixture.service.handleToolRegistryChanged()
    await fixture.service.loadToolDefinitionsForSession('s1', '/workspace')
    expect(fixture.toolPresenter.getAllToolDefinitions).toHaveBeenCalledTimes(2)

    fixture.service.invalidateSessionCaches('s1')
    const refreshedTools = await fixture.service.loadToolDefinitionsForSession('s1', '/workspace')
    await fixture.service.buildSystemPromptWithSkills('s1', 'BASE_PROMPT', refreshedTools)
    expect(fixture.toolPresenter.getAllToolDefinitions).toHaveBeenCalledTimes(3)
    expect(buildSystemEnvPrompt).toHaveBeenCalledTimes(2)
  })

  it('builds the complete manual compaction request behind the preparation boundary', async () => {
    const fixture = createFixture()
    const state = fixture.runtimeSharedState.runtimeState.get('s1')!

    expect(fixture.service.supportsManualCompaction(state)).toBe(true)
    const request = await fixture.service.buildManualCompactionRequest('s1', state)

    expect(request).toEqual({
      sessionId: 's1',
      providerId: 'openai',
      modelId: 'gpt-4.1',
      systemPrompt: expect.stringContaining('BASE_PROMPT'),
      contextLength: 32_000,
      reserveTokens: 2_000,
      extraReserveTokens: expect.any(Number),
      supportsVision: true,
      supportsAudioInput: true,
      preserveInterleavedReasoning: false,
      preserveEmptyInterleavedReasoning: false,
      historyRecords: []
    })
    expect(fixture.host.resolveProjectDir).toHaveBeenCalledWith('s1')
    expect(fixture.toolPresenter.getAllToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 's1',
        agentWorkspacePath: '/workspace'
      })
    )
    expect(fixture.tapeService.ensureSessionTapeReady).toHaveBeenCalledWith(
      's1',
      fixture.messageStore
    )

    expect(fixture.service.supportsManualCompaction({ ...state, providerId: 'acp' })).toBe(false)
  })

  it('stops manual compaction preparation when canceled during tool loading', async () => {
    const fixture = createFixture()
    const state = fixture.runtimeSharedState.runtimeState.get('s1')!
    const controller = new AbortController()
    let resolveTools!: (tools: MCPToolDefinition[]) => void
    fixture.toolPresenter.getAllToolDefinitions.mockImplementationOnce(
      () =>
        new Promise<MCPToolDefinition[]>((resolve) => {
          resolveTools = resolve
        })
    )

    const preparing = fixture.service.buildManualCompactionRequest('s1', state, controller.signal)
    await vi.waitFor(() =>
      expect(fixture.toolPresenter.getAllToolDefinitions).toHaveBeenCalledOnce()
    )

    controller.abort()
    resolveTools([READ_TOOL])

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' })
    expect(buildSystemEnvPrompt).not.toHaveBeenCalled()
    expect(fixture.tapeService.ensureSessionTapeReady).not.toHaveBeenCalled()
  })

  it('bypasses local prompt layers and tools only for ACP-backed subagent sessions', async () => {
    const fixture = createFixture()
    fixture.runtimeSharedState.runtimeState.get('s1')!.providerId = 'acp'
    fixture.host.getSessionKind.mockReturnValue('subagent')

    await expect(
      fixture.service.loadToolDefinitionsForSession('s1', '/workspace')
    ).resolves.toEqual([])
    await expect(
      fixture.service.buildSystemPromptWithSkills('s1', '  delegated prompt  ', [READ_TOOL])
    ).resolves.toBe('delegated prompt')
    expect(fixture.toolPresenter.getAllToolDefinitions).not.toHaveBeenCalled()
    expect(buildSystemEnvPrompt).not.toHaveBeenCalled()
  })
})
