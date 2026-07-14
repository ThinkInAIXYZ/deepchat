import { describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter } from '@shared/presenter'
import type { SessionGenerationSettings } from '@shared/types/agent-interface'
import {
  buildPersistedGenerationSettingsPatch,
  mapPersistedGenerationPatch,
  sanitizeGenerationSettings
} from '@/presenter/agentRuntimePresenter/generationSettings'

function createConfigPresenter(): IConfigPresenter {
  return {
    getModelConfig: vi.fn(() => ({
      contextLength: 32_000,
      maxTokens: 4_096,
      temperature: 0.7,
      timeout: 60_000
    })),
    getDefaultSystemPrompt: vi.fn().mockResolvedValue('default prompt'),
    supportsReasoningCapability: vi.fn(() => false),
    supportsReasoningEffortCapability: vi.fn(() => false),
    supportsVerbosityCapability: vi.fn(() => false)
  } as unknown as IConfigPresenter
}

describe('generation settings policy', () => {
  it('sanitizes numeric values and removes unsupported reasoning fields', async () => {
    const result = await sanitizeGenerationSettings(createConfigPresenter(), 'openai', 'gpt-4o', {
      systemPrompt: 'session prompt',
      contextLength: 16_000,
      maxTokens: 2_000,
      topP: 2,
      thinkingBudget: 1_024,
      reasoningEffort: 'high',
      verbosity: 'high'
    })

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
    const patch = mapPersistedGenerationPatch(createConfigPresenter(), {
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
