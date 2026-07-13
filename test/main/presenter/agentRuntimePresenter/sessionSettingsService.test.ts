import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter } from '@shared/presenter'
import type { SessionGenerationSettings } from '@shared/types/agent-interface'
import { RuntimeSharedState } from '@/presenter/agentRuntimePresenter/runtimeSharedState'
import { SessionSettingsService } from '@/presenter/agentRuntimePresenter/sessionSettingsService'
import type { DeepChatSessionStore } from '@/presenter/agentRuntimePresenter/sessionStore'

function createConfigPresenter() {
  return {
    getModelConfig: vi.fn(() => ({
      temperature: 0.7,
      contextLength: 128000,
      maxTokens: 4096,
      timeout: 600000,
      thinkingBudget: 512,
      reasoningEffort: 'medium',
      verbosity: 'medium'
    })),
    getDefaultSystemPrompt: vi.fn().mockResolvedValue('Default prompt'),
    getProviderById: vi.fn(),
    getReasoningPortrait: vi.fn(() => ({
      supported: true,
      defaultEnabled: true,
      mode: 'effort',
      budget: { min: 0, max: 8192, default: 512 },
      effort: 'medium',
      effortOptions: ['minimal', 'low', 'medium', 'high'],
      verbosity: 'medium',
      verbosityOptions: ['low', 'medium', 'high']
    })),
    getCapabilityProviderId: vi.fn((providerId: string) => providerId),
    supportsReasoningCapability: vi.fn(() => true),
    supportsReasoningEffortCapability: vi.fn(() => true),
    supportsVerbosityCapability: vi.fn(() => true),
    getThinkingBudgetRange: vi.fn(() => ({ min: 0, max: 8192, default: 512 })),
    getReasoningEffortDefault: vi.fn(() => 'medium'),
    getVerbosityDefault: vi.fn(() => 'medium')
  }
}

function createSessionStore() {
  return {
    get: vi.fn(),
    updatePermissionMode: vi.fn(),
    updateSessionModel: vi.fn(),
    updateGenerationSettings: vi.fn()
  }
}

describe('SessionSettingsService', () => {
  let configPresenter: ReturnType<typeof createConfigPresenter>
  let sessionStore: ReturnType<typeof createSessionStore>
  let runtimeSharedState: RuntimeSharedState
  let invalidateSystemPromptCache: ReturnType<typeof vi.fn>
  let invalidateToolProfileCache: ReturnType<typeof vi.fn>
  let service: SessionSettingsService

  beforeEach(() => {
    configPresenter = createConfigPresenter()
    sessionStore = createSessionStore()
    runtimeSharedState = new RuntimeSharedState()
    invalidateSystemPromptCache = vi.fn()
    invalidateToolProfileCache = vi.fn()
    service = new SessionSettingsService(
      configPresenter as unknown as IConfigPresenter,
      sessionStore as unknown as DeepChatSessionStore,
      runtimeSharedState,
      { invalidateSystemPromptCache, invalidateToolProfileCache }
    )
  })

  it('returns null for an unknown session', async () => {
    await expect(service.getGenerationSettings('missing')).resolves.toBeNull()
  })

  it('updates permission mode in runtime state and persistence', async () => {
    runtimeSharedState.runtimeState.set('s1', {
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    })

    await service.setPermissionMode('s1', 'auto_approve')

    expect(runtimeSharedState.runtimeState.get('s1')?.permissionMode).toBe('auto_approve')
    expect(sessionStore.updatePermissionMode).toHaveBeenCalledWith('s1', 'auto_approve')
  })

  it('returns the runtime permission mode without consulting persistence', async () => {
    runtimeSharedState.runtimeState.set('s1', {
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'default'
    })
    sessionStore.get.mockReturnValue({ permission_mode: 'auto_approve' })

    await expect(service.getPermissionMode('s1')).resolves.toBe('default')

    expect(sessionStore.get).not.toHaveBeenCalled()
  })

  it('falls back to the persisted permission mode when runtime state is absent', async () => {
    sessionStore.get.mockReturnValue({ permission_mode: 'auto_approve' })

    await expect(service.getPermissionMode('s1')).resolves.toBe('auto_approve')

    expect(sessionStore.get).toHaveBeenCalledWith('s1')
  })

  it('hydrates persisted settings and returns defensive copies of the cache', async () => {
    sessionStore.get.mockReturnValue({
      provider_id: 'openai',
      model_id: 'gpt-4',
      permission_mode: 'full_access',
      system_prompt: 'Persisted prompt',
      temperature: 0.3,
      top_p: null,
      context_length: 32000,
      max_tokens: 2048,
      timeout_ms: 120000,
      thinking_budget: null,
      reasoning_effort: null,
      reasoning_visibility: null,
      verbosity: null,
      force_interleaved_thinking_compat: null
    })

    const first = await service.getGenerationSettings('s1')
    expect(first).toMatchObject({
      systemPrompt: 'Persisted prompt',
      temperature: 0.3,
      contextLength: 32000,
      maxTokens: 2048,
      timeout: 120000
    })

    first!.temperature = 1.5
    const second = await service.getGenerationSettings('s1')
    expect(second?.temperature).toBe(0.3)
    expect(configPresenter.getDefaultSystemPrompt).toHaveBeenCalledTimes(1)
  })

  it('keeps invalid numeric updates unchanged and persists only requested fields', async () => {
    runtimeSharedState.runtimeState.set('s1', {
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    })
    service.cacheGenerationSettings('s1', {
      systemPrompt: 'Prompt',
      temperature: 0.7,
      contextLength: 128000,
      maxTokens: 4096,
      timeout: 600000,
      thinkingBudget: 512,
      reasoningEffort: 'medium',
      verbosity: 'medium'
    })

    const updated = await service.updateGenerationSettings('s1', {
      temperature: 1.2,
      contextLength: 1000,
      maxTokens: 999999
    })

    expect(updated).toMatchObject({
      temperature: 1.2,
      contextLength: 128000,
      maxTokens: 4096
    })
    expect(sessionStore.updateGenerationSettings).toHaveBeenCalledWith('s1', {
      temperature: 1.2,
      contextLength: 128000,
      maxTokens: 4096
    })
    expect(invalidateSystemPromptCache).not.toHaveBeenCalled()
  })

  it('invalidates the system prompt cache only when the prompt is requested', async () => {
    runtimeSharedState.runtimeState.set('s1', {
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    })
    const settings: SessionGenerationSettings = {
      systemPrompt: 'Before',
      temperature: 0.7,
      contextLength: 128000,
      maxTokens: 4096,
      timeout: 600000
    }
    service.cacheGenerationSettings('s1', settings)

    await service.updateGenerationSettings('s1', { systemPrompt: 'After' })

    expect(invalidateSystemPromptCache).toHaveBeenCalledWith('s1')
    expect(invalidateToolProfileCache).not.toHaveBeenCalled()
  })

  it('keeps the prompt and resets other settings when switching models', async () => {
    runtimeSharedState.runtimeState.set('s1', {
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'default'
    })
    service.cacheGenerationSettings('s1', {
      systemPrompt: 'Keep this prompt',
      temperature: 1.5,
      contextLength: 128000,
      maxTokens: 4096,
      timeout: 600000
    })
    configPresenter.getModelConfig.mockImplementation((modelId: string) =>
      modelId === 'claude-3-5-sonnet'
        ? {
            temperature: 0.2,
            contextLength: 32000,
            maxTokens: 2048,
            timeout: 120000,
            thinkingBudget: 256,
            reasoningEffort: 'low',
            verbosity: 'high'
          }
        : {
            temperature: 0.7,
            contextLength: 128000,
            maxTokens: 4096,
            timeout: 600000
          }
    )

    await service.setSessionModel('s1', 'anthropic', 'claude-3-5-sonnet')

    expect(runtimeSharedState.runtimeState.get('s1')).toMatchObject({
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet'
    })
    expect(sessionStore.updateSessionModel).toHaveBeenCalledWith(
      's1',
      'anthropic',
      'claude-3-5-sonnet'
    )
    expect(sessionStore.updateGenerationSettings).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        systemPrompt: 'Keep this prompt',
        temperature: 0.2,
        contextLength: 32000,
        maxTokens: 2048,
        timeout: 120000
      })
    )
    expect(invalidateSystemPromptCache).toHaveBeenCalledWith('s1')
    expect(invalidateToolProfileCache).toHaveBeenCalledWith('s1')
  })

  it('rejects model switching while generation is active', async () => {
    runtimeSharedState.runtimeState.set('s1', {
      status: 'generating',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    })

    await expect(service.setSessionModel('s1', 'anthropic', 'claude')).rejects.toThrow(
      'Cannot switch model while session is generating.'
    )
    expect(sessionStore.updateSessionModel).not.toHaveBeenCalled()
  })
})
