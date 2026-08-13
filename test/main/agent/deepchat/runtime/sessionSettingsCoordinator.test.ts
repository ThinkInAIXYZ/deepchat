import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { SessionSettingsCoordinator } from '@/agent/deepchat/runtime/sessionSettingsCoordinator'
import type { ProviderModelResolutionPort } from '@/provider/settings'
import { ModelType } from '@shared/model'
import type { SessionGenerationSettings } from '@shared/types/agent-interface'
import { describe, expect, it, vi } from 'vitest'

const SESSION_ID = 'session'
const APP_SESSION_ID = toAppSessionId(SESSION_ID)
const BASE_SETTINGS: SessionGenerationSettings = {
  systemPrompt: 'System prompt',
  temperature: 0.7,
  contextLength: 128_000,
  maxTokens: 4096,
  timeout: 30_000
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
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

function createHarness() {
  const runtime = new DeepChatAgentRuntime()
  const instance = runtime.getOrHydrate(APP_SESSION_ID)
  instance.setRuntimeState({
    status: 'idle',
    providerId: 'openai',
    modelId: 'gpt-4',
    permissionMode: 'default'
  })
  instance.setAgentId('deepchat')
  instance.setGenerationSettings(BASE_SETTINGS)

  const getDefaultSystemPrompt = vi.fn().mockResolvedValue('Default prompt')
  const sessionStore = {
    get: vi.fn().mockReturnValue({
      provider_id: 'openai',
      model_id: 'gpt-4',
      permission_mode: 'default'
    }),
    updateGenerationSettings: vi.fn(),
    updatePermissionMode: vi.fn(),
    updateSessionConfiguration: vi.fn()
  }
  const revalidateActiveSkillsForAgent = vi.fn().mockResolvedValue(undefined)
  const beginSessionAgentReassignment = vi.fn().mockResolvedValue(undefined)
  const finishSessionAgentReassignment = vi.fn()
  type Dependencies = ConstructorParameters<typeof SessionSettingsCoordinator>[0]
  const dependencies: Dependencies = {
    providerSettings: createProviderSettings(),
    promptSettings: { getDefaultSystemPrompt },
    sessionStore: sessionStore as unknown as Dependencies['sessionStore'],
    toolResolver: {
      revalidateActiveSkillsForAgent
    } as unknown as Dependencies['toolResolver'],
    toolService: {
      clearAgentPlanState: vi.fn()
    } as unknown as Dependencies['toolService'],
    sessionPermissionPort: {
      clearSessionPermissions: vi.fn()
    },
    registry: runtime,
    identity: { getAgentId: vi.fn().mockReturnValue('deepchat') },
    beginSessionAgentReassignment,
    finishSessionAgentReassignment,
    readPersistedProjectDir: vi.fn().mockReturnValue(null)
  }

  return {
    beginSessionAgentReassignment,
    coordinator: new SessionSettingsCoordinator(dependencies),
    finishSessionAgentReassignment,
    getDefaultSystemPrompt,
    instance,
    revalidateActiveSkillsForAgent,
    runtime,
    sessionStore,
    replaceInstance() {
      runtime.evict(APP_SESSION_ID)
      const replacement = runtime.getOrHydrate(APP_SESSION_ID)
      replacement.setRuntimeState({
        status: 'generating',
        providerId: 'replacement-provider',
        modelId: 'replacement-model',
        permissionMode: 'full_access'
      })
      replacement.setGenerationSettings({
        ...BASE_SETTINGS,
        systemPrompt: 'Replacement prompt'
      })
      return replacement
    }
  }
}

describe('SessionSettingsCoordinator', () => {
  it('does not persist or mutate a model switch after instance replacement', async () => {
    const harness = createHarness()
    const prompt = deferred<string>()
    harness.getDefaultSystemPrompt.mockReturnValueOnce(prompt.promise)

    const update = harness.coordinator.setModel(SESSION_ID, 'anthropic', 'claude-3-5-sonnet')
    await vi.waitFor(() => expect(harness.getDefaultSystemPrompt).toHaveBeenCalledOnce())
    const replacement = harness.replaceInstance()
    prompt.resolve('Target default prompt')

    await expect(update).rejects.toMatchObject({ name: 'StaleDeepChatAgentInstanceError' })
    expect(harness.sessionStore.updateSessionConfiguration).not.toHaveBeenCalled()
    expect(replacement.getRuntimeState()).toEqual({
      status: 'generating',
      providerId: 'replacement-provider',
      modelId: 'replacement-model',
      permissionMode: 'full_access'
    })
    expect(replacement.getGenerationSettings()?.systemPrompt).toBe('Replacement prompt')
  })

  it('rechecks generating status before committing a model switch', async () => {
    const harness = createHarness()
    const prompt = deferred<string>()
    harness.getDefaultSystemPrompt.mockReturnValueOnce(prompt.promise)

    const update = harness.coordinator.setModel(SESSION_ID, 'anthropic', 'claude-3-5-sonnet')
    await vi.waitFor(() => expect(harness.getDefaultSystemPrompt).toHaveBeenCalledOnce())
    harness.instance.setRuntimeState({
      status: 'generating',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'default'
    })
    prompt.resolve('Target default prompt')

    await expect(update).rejects.toThrow('Cannot switch model while session is generating.')
    expect(harness.sessionStore.updateSessionConfiguration).not.toHaveBeenCalled()
    expect(harness.instance.getRuntimeState()?.providerId).toBe('openai')
  })

  it('does not publish agent context after replacement during reassignment fencing', async () => {
    const harness = createHarness()
    const reassignment = deferred<void>()
    harness.beginSessionAgentReassignment.mockReturnValueOnce(reassignment.promise)

    const update = harness.coordinator.setAgentContext(SESSION_ID, {
      agentId: 'other-agent',
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet',
      permissionMode: 'full_access'
    })
    await vi.waitFor(() =>
      expect(harness.beginSessionAgentReassignment).toHaveBeenCalledWith(SESSION_ID)
    )
    const replacement = harness.replaceInstance()
    reassignment.resolve()

    await expect(update).rejects.toMatchObject({ name: 'StaleDeepChatAgentInstanceError' })
    expect(harness.sessionStore.updateSessionConfiguration).not.toHaveBeenCalled()
    expect(harness.finishSessionAgentReassignment).toHaveBeenCalledWith(SESSION_ID)
    expect(replacement.getAgentId()).toBeUndefined()
    expect(replacement.getRuntimeState()?.providerId).toBe('replacement-provider')
  })

  it('does not persist generation settings after instance replacement', async () => {
    const harness = createHarness()

    const update = harness.coordinator.updateGenerationSettings(SESSION_ID, {
      systemPrompt: 'Stale prompt'
    })
    const replacement = harness.replaceInstance()

    await expect(update).rejects.toMatchObject({ name: 'StaleDeepChatAgentInstanceError' })
    expect(harness.sessionStore.updateGenerationSettings).not.toHaveBeenCalled()
    expect(replacement.getGenerationSettings()?.systemPrompt).toBe('Replacement prompt')
  })

  it('does not apply settings sanitized for a model that changed in flight', async () => {
    const harness = createHarness()

    const update = harness.coordinator.updateGenerationSettings(SESSION_ID, {
      systemPrompt: 'Old-model prompt'
    })
    harness.instance.setRuntimeState({
      status: 'idle',
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet',
      permissionMode: 'default'
    })

    await expect(update).rejects.toThrow(
      `Session ${SESSION_ID} model changed while generation settings were updating.`
    )
    expect(harness.sessionStore.updateGenerationSettings).not.toHaveBeenCalled()
  })

  it('clears stale provider limits only when the configured context window changes', async () => {
    const harness = createHarness()
    harness.instance.recordContextWindowObservation({
      providerId: 'openai',
      modelId: 'gpt-4',
      confidence: 'explicit',
      limitTokens: 8192,
      limitScope: 'context'
    })

    await harness.coordinator.updateGenerationSettings(SESSION_ID, {
      systemPrompt: 'Updated prompt'
    })
    expect(harness.instance.getContextWindowObservation('openai', 'gpt-4')).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4',
      providerContextLimitTokens: 8192,
      metadataSuspect: false
    })

    await harness.coordinator.updateGenerationSettings(SESSION_ID, { contextLength: 64_000 })
    expect(
      harness.instance.getContextWindowObservation('openai', 'gpt-4')
    ).toBeUndefined()
  })

  it('atomically applies the model and generation snapshot for an idle turn', async () => {
    const harness = createHarness()
    const generationSettings = {
      ...BASE_SETTINGS,
      systemPrompt: 'Frozen child prompt',
      temperature: 0.2,
      maxTokens: 8192
    }

    await harness.coordinator.applyTurnExecutionSnapshot(SESSION_ID, {
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet',
      generationSettings
    })

    expect(harness.sessionStore.updateSessionConfiguration).toHaveBeenCalledWith(
      SESSION_ID,
      'anthropic',
      'claude-3-5-sonnet',
      expect.objectContaining(generationSettings)
    )
    expect(harness.instance.getRuntimeState()).toEqual({
      status: 'idle',
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet',
      permissionMode: 'default'
    })
    expect(harness.instance.getGenerationSettings()).toMatchObject(generationSettings)
  })

  it('refuses to apply a turn snapshot after generation has started', async () => {
    const harness = createHarness()
    harness.instance.setRuntimeState({
      status: 'generating',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'default'
    })

    await expect(
      harness.coordinator.applyTurnExecutionSnapshot(SESSION_ID, {
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        generationSettings: BASE_SETTINGS
      })
    ).rejects.toThrow('while session is generating')
    expect(harness.sessionStore.updateSessionConfiguration).not.toHaveBeenCalled()
  })

  it('does not apply a turn snapshot after the runtime instance is replaced', async () => {
    const harness = createHarness()
    const prompt = deferred<string>()
    harness.getDefaultSystemPrompt.mockReturnValueOnce(prompt.promise)

    const update = harness.coordinator.applyTurnExecutionSnapshot(SESSION_ID, {
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet',
      generationSettings: { ...BASE_SETTINGS, systemPrompt: '' }
    })
    await vi.waitFor(() => expect(harness.getDefaultSystemPrompt).toHaveBeenCalledOnce())
    const replacement = harness.replaceInstance()
    prompt.resolve('Target default prompt')

    await expect(update).rejects.toMatchObject({ name: 'StaleDeepChatAgentInstanceError' })
    expect(harness.sessionStore.updateSessionConfiguration).not.toHaveBeenCalled()
    expect(replacement.getRuntimeState()?.providerId).toBe('replacement-provider')
  })

  it('preserves a permission downgrade while a turn snapshot is being sanitized', async () => {
    const harness = createHarness()
    const prompt = deferred<string>()
    harness.getDefaultSystemPrompt.mockReturnValueOnce(prompt.promise)
    harness.instance.getRuntimeState()!.permissionMode = 'full_access'

    const update = harness.coordinator.applyTurnExecutionSnapshot(SESSION_ID, {
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet',
      generationSettings: { ...BASE_SETTINGS, systemPrompt: '' }
    })
    await vi.waitFor(() => expect(harness.getDefaultSystemPrompt).toHaveBeenCalledOnce())
    harness.instance.getRuntimeState()!.permissionMode = 'default'
    prompt.resolve('Target default prompt')

    await update
    expect(harness.instance.getRuntimeState()).toEqual({
      status: 'idle',
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet',
      permissionMode: 'default'
    })
  })
})
