import type { ProviderSettingsPort } from '@/provider/settings'
import { describe, expect, it, vi } from 'vitest'

import type { SessionGenerationSettings } from '@shared/types/agent-interface'
import {
  buildPersistedGenerationSettingsPatch,
  mapPersistedGenerationPatch,
  sanitizeGenerationSettings
} from '@/agent/deepchat/runtime/generationSettings'
import { resolveProviderModelRuntimeFacts } from '@/agent/deepchat/runtime/providerModelRuntimeFacts'

const createCapabilitySnapshot = () => ({
  identity: {
    providerId: 'openai',
    requestModelId: 'gpt-4o',
    catalogMatched: false,
    catalogModelId: null
  },
  requestPolicy: {
    temperature: { mode: 'passthrough' as const },
    topP: { mode: 'passthrough' as const },
    reasoning: { mode: 'passthrough' as const },
    legacyThinking: { mode: 'passthrough' as const }
  },
  supportsAudioInput: false,
  supportsReasoning: false,
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
})

function createProviderSettings(): ProviderSettingsPort {
  return {
    getModelConfig: vi.fn(() => ({
      contextLength: 32_000,
      maxTokens: 4_096,
      temperature: 0.7,
      timeout: 60_000
    })),
    getProviderById: vi.fn(() => undefined),
    getCapabilitySnapshot: vi.fn(() => createCapabilitySnapshot())
  } as unknown as ProviderSettingsPort
}

describe('generation settings policy', () => {
  it('falls back from a non-positive model context window', async () => {
    const providerSettings = createProviderSettings()
    vi.mocked(providerSettings.getModelConfig).mockReturnValue({
      contextLength: 0,
      maxTokens: 0,
      temperature: 0.7,
      timeout: 60_000
    })

    const result = await sanitizeGenerationSettings(
      providerSettings,
      { getDefaultSystemPrompt: vi.fn().mockResolvedValue('default prompt') },
      'openai',
      'gpt-4o',
      { contextLength: 0 }
    )

    expect(result.contextLength).toBe(32_000)
    expect(result.maxTokens).toBe(4_096)
  })

  it('does not materialize an absent model topP as an explicit undefined property', async () => {
    const result = await sanitizeGenerationSettings(
      createProviderSettings(),
      { getDefaultSystemPrompt: vi.fn().mockResolvedValue('default prompt') },
      'openai',
      'gpt-4o',
      {}
    )

    expect(result).not.toHaveProperty('topP')
  })

  it('sanitizes numeric values and removes unsupported reasoning fields', async () => {
    const providerSettings = createProviderSettings()
    const result = await sanitizeGenerationSettings(
      providerSettings,
      { getDefaultSystemPrompt: vi.fn().mockResolvedValue('default prompt') },
      'openai',
      'gpt-4o',
      {
        systemPrompt: 'session prompt',
        contextLength: 16_000,
        maxTokens: 2_000,
        topP: 2,
        thinkingBudget: 1_024,
        reasoningEffort: 'high',
        verbosity: 'high'
      }
    )

    expect(result).toMatchObject({
      systemPrompt: 'session prompt',
      contextLength: 16_000,
      maxTokens: 2_000,
      temperature: 0.7
    })
    expect(result).not.toHaveProperty('topP')
    expect(result).not.toHaveProperty('thinkingBudget')
    expect(result).not.toHaveProperty('reasoningEffort')
    expect(result).not.toHaveProperty('verbosity')
    expect(providerSettings.getCapabilitySnapshot).toHaveBeenCalledTimes(1)
  })

  it('keeps K3 session sampling settings while normalizing effort from the snapshot', async () => {
    const providerSettings = createProviderSettings()
    vi.mocked(providerSettings.getModelConfig).mockReturnValue({
      contextLength: 262_144,
      maxTokens: 32_768,
      temperature: 0.6,
      topP: 0.8,
      timeout: 60_000,
      reasoning: false,
      reasoningEffort: 'medium'
    })
    vi.mocked(providerSettings.getCapabilitySnapshot).mockReturnValue({
      ...createCapabilitySnapshot(),
      identity: {
        providerId: 'moonshot',
        requestModelId: 'kimi-k3',
        catalogMatched: true,
        catalogModelId: 'kimi-k3'
      },
      requestPolicy: {
        temperature: { mode: 'omit' },
        topP: { mode: 'omit' },
        reasoning: { mode: 'fixed', value: true },
        legacyThinking: { mode: 'omit' }
      },
      supportsReasoning: true,
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'max',
        effortOptions: ['low', 'high', 'max']
      },
      supportsReasoningEffort: true,
      reasoningEffortDefault: 'max'
    })

    const result = await sanitizeGenerationSettings(
      providerSettings,
      { getDefaultSystemPrompt: vi.fn().mockResolvedValue('default prompt') },
      'new-api',
      'kimi-k3',
      {
        temperature: 0.4,
        topP: 0.5,
        reasoningEffort: 'medium'
      }
    )

    expect(result).toMatchObject({
      temperature: 0.4,
      topP: 0.5,
      reasoningEffort: 'max'
    })
    expect(providerSettings.getCapabilitySnapshot).toHaveBeenCalledTimes(1)
  })

  it('shares one capability snapshot across persisted mapping and sanitization', async () => {
    const providerSettings = createProviderSettings()
    const providerModelFacts = resolveProviderModelRuntimeFacts(
      providerSettings,
      'openai',
      'gpt-4o'
    )
    const patch = mapPersistedGenerationPatch(
      providerSettings,
      {
        provider_id: 'openai',
        model_id: 'gpt-4o',
        permission_mode: 'default',
        system_prompt: null,
        temperature: null,
        top_p: null,
        context_length: null,
        max_tokens: null,
        timeout_ms: null,
        thinking_budget: null,
        reasoning_effort: null,
        reasoning_visibility: 'summarized',
        verbosity: null,
        force_interleaved_thinking_compat: null,
        image_generation_options_json: null,
        video_generation_options_json: null
      },
      providerModelFacts.capabilitySnapshot
    )

    await sanitizeGenerationSettings(
      providerSettings,
      { getDefaultSystemPrompt: vi.fn().mockResolvedValue('default prompt') },
      'openai',
      'gpt-4o',
      patch,
      undefined,
      providerModelFacts
    )

    expect(providerSettings.getModelConfig).toHaveBeenCalledTimes(1)
    expect(providerSettings.getCapabilitySnapshot).toHaveBeenCalledTimes(1)
  })

  it('rejects request-local capability facts from another service selection', async () => {
    const providerSettings = createProviderSettings()
    const providerModelFacts = resolveProviderModelRuntimeFacts(
      providerSettings,
      'new-api',
      'kimi-k3'
    )

    await expect(
      sanitizeGenerationSettings(
        providerSettings,
        { getDefaultSystemPrompt: vi.fn().mockResolvedValue('default prompt') },
        'new-api',
        'other-model',
        {},
        undefined,
        providerModelFacts
      )
    ).rejects.toThrow('cannot be used')
  })

  it('persists only fields present in the requested patch', () => {
    const sanitized: SessionGenerationSettings = {
      systemPrompt: 'kept',
      temperature: 0.3,
      contextLength: 32_000,
      maxTokens: 2_000,
      timeout: 60_000,
      reasoningEffort: 'medium'
    }

    expect(
      buildPersistedGenerationSettingsPatch(
        { temperature: 0.3, reasoningEffort: 'medium' },
        sanitized
      )
    ).toEqual({ temperature: 0.3, reasoningEffort: 'medium' })
  })

  it('restores persisted image and video generation options', () => {
    const patch = mapPersistedGenerationPatch(createProviderSettings(), {
      provider_id: 'openai',
      model_id: 'gpt-image-2',
      permission_mode: 'default',
      system_prompt: null,
      temperature: null,
      top_p: null,
      context_length: null,
      max_tokens: null,
      timeout_ms: null,
      thinking_budget: null,
      reasoning_effort: null,
      reasoning_visibility: null,
      verbosity: null,
      force_interleaved_thinking_compat: null,
      image_generation_options_json: JSON.stringify({
        size: '1024x1024',
        quality: 'high'
      }),
      video_generation_options_json: JSON.stringify({
        duration: 8,
        generateAudio: true
      })
    })

    expect(patch).toMatchObject({
      imageGeneration: { size: '1024x1024', quality: 'high' },
      videoGeneration: { duration: 8, generateAudio: true }
    })
  })
})
