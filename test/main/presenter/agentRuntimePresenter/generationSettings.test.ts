import { describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter } from '@shared/presenter'
import type { SessionGenerationSettings } from '@shared/types/agent-interface'
import {
  buildPersistedGenerationSettingsPatch,
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
})
