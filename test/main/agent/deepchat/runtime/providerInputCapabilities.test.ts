import { describe, expect, it, vi } from 'vitest'
import {
  resolveProviderInputCapabilities,
  supportsProviderAudioInput,
  supportsProviderVision
} from '@/agent/deepchat/runtime/providerInputCapabilities'
import {
  assertProviderModelRuntimeFacts,
  resolveProviderModelRuntimeFacts
} from '@/agent/deepchat/runtime/providerModelRuntimeFacts'

const createCapabilitySnapshot = (supportsAudioInput: boolean) =>
  ({
    identity: {
      providerId: 'provider',
      requestModelId: 'model',
      catalogMatched: true,
      catalogModelId: 'model'
    },
    supportsAudioInput
  }) as any

describe('provider input capabilities', () => {
  it('resolves vision and audio from one model config and capability snapshot', () => {
    const providerSettings = {
      getModelConfig: vi.fn().mockReturnValue({ vision: true }),
      getCapabilitySnapshot: vi.fn().mockReturnValue(createCapabilitySnapshot(true))
    }

    expect(resolveProviderInputCapabilities(providerSettings, 'provider', 'model')).toEqual({
      supportsVision: true,
      supportsAudioInput: true
    })
    expect(providerSettings.getModelConfig).toHaveBeenCalledWith('model', 'provider')
    expect(providerSettings.getCapabilitySnapshot).toHaveBeenCalledWith({
      providerId: 'provider',
      modelId: 'model',
      resolvedModelConfig: { vision: true }
    })
  })

  it('fails vision closed when the model config is unavailable', () => {
    const providerSettings = {
      getModelConfig: vi.fn().mockReturnValue(undefined),
      getCapabilitySnapshot: vi.fn().mockReturnValue(createCapabilitySnapshot(false))
    }

    expect(resolveProviderInputCapabilities(providerSettings as any, 'provider', 'missing')).toEqual(
      {
        supportsVision: false,
        supportsAudioInput: false
      }
    )
  })

  it('reuses request-local model facts without repeating capability resolution', () => {
    const providerSettings = {
      getModelConfig: vi.fn().mockReturnValue({ vision: true, reasoning: true }),
      getCapabilitySnapshot: vi.fn().mockReturnValue(createCapabilitySnapshot(true))
    }
    const facts = resolveProviderModelRuntimeFacts(providerSettings, 'provider', 'model')

    expect(
      resolveProviderInputCapabilities(providerSettings, 'provider', 'model', facts)
    ).toEqual({
      supportsVision: true,
      supportsAudioInput: true
    })
    expect(providerSettings.getModelConfig).toHaveBeenCalledTimes(1)
    expect(providerSettings.getCapabilitySnapshot).toHaveBeenCalledTimes(1)
  })

  it('rejects reuse across service provider selections', () => {
    const providerSettings = {
      getModelConfig: vi.fn().mockReturnValue({ vision: true }),
      getCapabilitySnapshot: vi.fn().mockReturnValue(createCapabilitySnapshot(true))
    }
    const facts = resolveProviderModelRuntimeFacts(providerSettings, 'new-api', 'kimi-k3')

    expect(() => assertProviderModelRuntimeFacts(facts, 'moonshot', 'kimi-k3')).toThrow(
      'cannot be used'
    )
    expect(() =>
      resolveProviderInputCapabilities(providerSettings, 'new-api', 'other-model', facts)
    ).toThrow('cannot be used')
  })

  it('supports isolated capability reads without querying the unrelated capability', () => {
    const providerSettings = {
      getModelConfig: vi.fn().mockReturnValue({ vision: true }),
      supportsAudioInputCapability: vi.fn().mockReturnValue(false)
    }

    expect(supportsProviderVision(providerSettings, 'provider', 'model')).toBe(true)
    expect(providerSettings.supportsAudioInputCapability).not.toHaveBeenCalled()

    providerSettings.getModelConfig.mockClear()
    expect(supportsProviderAudioInput(providerSettings, 'provider', 'model')).toBe(false)
    expect(providerSettings.getModelConfig).not.toHaveBeenCalled()
  })
})
