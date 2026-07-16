import type { ProviderSettingsPort } from '@/provider/settings'
import { describe, expect, it, vi } from 'vitest'

import type { SessionGenerationSettings } from '@shared/types/agent-interface'
import {
  buildPersistedGenerationSettingsPatch,
  mapPersistedGenerationPatch,
  sanitizeGenerationSettings
} from '@/agent/deepchat/runtime/generationSettings'

function createProviderSettings(): ProviderSettingsPort {
  return {
    getModelConfig: vi.fn(() => ({
      contextLength: 32_000,
      maxTokens: 4_096,
      temperature: 0.7,
      timeout: 60_000
    })),
    getProviderById: vi.fn(() => undefined),
    getCapabilityProviderId: vi.fn((providerId: string) => providerId),
    getReasoningPortrait: vi.fn(() => null),
    getThinkingBudgetRange: vi.fn(() => ({})),
    supportsReasoningCapability: vi.fn(() => false),
    supportsReasoningEffortCapability: vi.fn(() => false),
    getReasoningEffortDefault: vi.fn(() => undefined),
    supportsVerbosityCapability: vi.fn(() => false),
    getVerbosityDefault: vi.fn(() => undefined)
  } as unknown as ProviderSettingsPort
}

describe('generation settings policy', () => {
  it('sanitizes numeric values and removes unsupported reasoning fields', async () => {
    const result = await sanitizeGenerationSettings(
      createProviderSettings(),
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
