import { describe, expect, it, vi } from 'vitest'
import { resolveSessionVisionTarget } from '../../../../src/main/agent/vision/sessionVisionResolver'

describe('resolveSessionVisionTarget', () => {
  it('uses the current session model when it is explicitly known and supports vision', async () => {
    const providerSettings = {
      isKnownModel: vi.fn().mockReturnValue(true),
      getModelConfig: vi.fn().mockReturnValue({ vision: true }),
      resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({})
    }

    const result = await resolveSessionVisionTarget({
      providerId: 'openai',
      modelId: 'gpt-4o',
      agentId: 'deepchat',
      providerConfig: providerSettings,
      agentSettings: providerSettings
    })

    expect(result).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4o',
      source: 'session-model'
    })
    expect(providerSettings.resolveDeepChatAgentConfig).not.toHaveBeenCalled()
  })

  it('ignores synthesized session-model vision support when the model is unknown', async () => {
    const providerSettings = {
      isKnownModel: vi.fn().mockReturnValue(false),
      getModelConfig: vi.fn().mockReturnValue({ vision: true }),
      resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({
        visionModel: { providerId: 'google', modelId: 'gemini-2.5-flash' }
      })
    }

    const result = await resolveSessionVisionTarget({
      providerId: 'openai',
      modelId: 'unknown-vision-model',
      agentId: 'deepchat',
      providerConfig: providerSettings,
      agentSettings: providerSettings
    })

    expect(result).toEqual({
      providerId: 'google',
      modelId: 'gemini-2.5-flash',
      source: 'agent-vision-model'
    })
  })
})
