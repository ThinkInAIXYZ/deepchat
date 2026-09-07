import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getLocale: vi.fn(() => 'en-US')
  }
}))

const state = vi.hoisted(() => ({
  mockDb: {
    providers: {
      moonshot: {
        id: 'moonshot',
        models: [
          {
            id: 'kimi-k3',
            temperature: false,
            reasoning: {
              supported: true,
              default: true
            },
            extra_capabilities: {
              reasoning: {
                supported: true,
                interleaved: true,
                summaries: true,
                visibility: 'summary',
                continuation: ['thinking_blocks']
              }
            }
          }
        ]
      },
      aihubmix: {
        id: 'aihubmix',
        models: [
          {
            id: 'kimi-k3',
            reasoning: {
              supported: true,
              default: true
            },
            extra_capabilities: {
              reasoning: {
                supported: true
              }
            }
          },
          {
            id: 'coding-kimi-k3',
            reasoning: {
              supported: true,
              default: true
            },
            extra_capabilities: {
              reasoning: {
                supported: true
              }
            }
          },
          { id: 'ambiguous-model', temperature: true }
        ]
      },
      llmgateway: {
        id: 'llmgateway',
        models: [
          { id: 'kimi-k3', temperature: false },
          { id: 'ambiguous-model', temperature: false },
          { id: 'hunyuan-ambiguous', reasoning: { supported: true } }
        ]
      },
      mirror: {
        id: 'mirror',
        models: [{ id: 'hunyuan-ambiguous', reasoning: { supported: false }, temperature: false }]
      },
      anthropic: {
        id: 'anthropic',
        models: [
          {
            id: 'claude-opus-4-7',
            temperature: false,
            reasoning: {
              supported: true,
              default: true
            }
          },
          {
            id: 'minimax-m3',
            temperature: false,
            reasoning: {
              supported: true,
              default: true
            }
          }
        ]
      },
      openrouter: {
        id: 'openrouter',
        models: [
          {
            id: 'anthropic/claude-opus-4-7',
            temperature: true,
            reasoning: {
              supported: true,
              default: true
            }
          }
        ]
      },
      google: {
        id: 'google',
        models: [{ id: 'gemini-3.5-pro', temperature: true }]
      },
      zhipuai: {
        id: 'zhipuai',
        models: [
          {
            id: 'glm-4.7',
            temperature: true,
            reasoning: { supported: true, default: true },
            extra_capabilities: {
              reasoning: {
                supported: true,
                interleaved: true,
                summaries: true,
                visibility: 'summary',
                continuation: ['thinking_blocks']
              }
            }
          }
        ]
      },
      minimax: {
        id: 'minimax',
        models: [
          {
            id: 'MiniMax-M2',
            temperature: true,
            reasoning: { supported: true, default: true }
          },
          {
            id: 'MiniMax-M3',
            temperature: true,
            reasoning: { supported: true, default: true }
          }
        ]
      },
      stepfun: {
        id: 'stepfun',
        models: [
          {
            id: 'step-3.5-flash',
            temperature: true,
            reasoning: { supported: true, default: true }
          }
        ]
      },
      mistral: {
        id: 'mistral',
        models: [{ id: 'mistral-large-latest', temperature: true }]
      },
      cohere: {
        id: 'cohere',
        models: [{ id: 'command-r-plus-08-2024', temperature: true }]
      },
      openai: {
        id: 'openai',
        models: [
          {
            id: 'gpt-5',
            temperature: false,
            reasoning: { supported: true, default: true },
            extra_capabilities: {
              reasoning: {
                supported: true,
                mode: 'effort',
                effort: 'medium',
                effort_options: ['minimal', 'low', 'medium', 'high']
              }
            }
          },
          {
            id: 'o3',
            temperature: false,
            reasoning: { supported: true, default: true },
            extra_capabilities: {
              reasoning: {
                supported: true,
                mode: 'effort',
                effort: 'medium',
                effort_options: ['low', 'medium', 'high']
              }
            }
          },
          {
            id: 'owner-routed-model',
            temperature: false
          }
        ]
      },
      xai: {
        id: 'xai',
        models: [{ id: 'owner-routed-model', temperature: true }]
      },
      'sole-provider': {
        id: 'sole-provider',
        models: [{ id: 'only-once', temperature: false }]
      }
    }
  }
}))

vi.mock('../../../src/main/provider/providerDbLoader', () => ({
  providerDbLoader: {
    getDb: () => state.mockDb,
    subscribeCatalogChanges: vi.fn()
  }
}))

import {
  buildResolvedCapabilitySnapshot,
  resolveCapabilityFamilyHint,
  resolveCapabilityIdentity
} from '../../../src/main/provider/capabilityIdentity'
import { ProviderSettings } from '../../../src/main/provider/settings'

describe('capability identity resolution', () => {
  it('resolves New API K3 to the Moonshot catalog record before transport', () => {
    const identity = resolveCapabilityIdentity({
      providerId: 'new-api',
      modelId: 'kimi-k3',
      endpointType: 'openai'
    })
    const snapshot = buildResolvedCapabilitySnapshot(identity)

    expect(identity).toEqual({
      providerId: 'moonshot',
      requestModelId: 'kimi-k3',
      catalogMatched: true,
      catalogModelId: 'kimi-k3'
    })
    expect(snapshot.temperatureCapability).toBe(false)
    expect(snapshot.requestPolicy).toEqual({
      temperature: { mode: 'omit' },
      topP: { mode: 'omit' },
      reasoning: { mode: 'fixed', value: true },
      legacyThinking: { mode: 'omit' }
    })
    expect(snapshot.supportsReasoningEffort).toBe(true)
    expect(snapshot.reasoningEffortDefault).toBe('max')
    expect(snapshot.reasoningPortrait).toMatchObject({
      supported: true,
      mode: 'effort',
      effort: 'max',
      effortOptions: ['low', 'high', 'max'],
      interleaved: true,
      summaries: true,
      visibility: 'summary',
      continuation: ['thinking_blocks']
    })
  })

  it('keeps provider-local carrier records ahead of namespace and family matches', () => {
    expect(
      resolveCapabilityIdentity({
        providerId: 'openrouter',
        modelId: 'anthropic/claude-opus-4-7'
      })
    ).toMatchObject({
      providerId: 'openrouter',
      catalogMatched: true
    })
  })

  it('applies ZenMux and OpenCode Go route overrides in the main-process resolver', () => {
    const zenmuxIdentity = resolveCapabilityIdentity({
      providerId: 'zenmux',
      modelId: 'anthropic/claude-opus-4-7'
    })
    expect(zenmuxIdentity).toMatchObject({
      providerId: 'anthropic'
    })
    expect(buildResolvedCapabilitySnapshot(zenmuxIdentity).requestPolicy.topP).toEqual({
      mode: 'omit'
    })
    expect(
      resolveCapabilityIdentity({
        providerId: 'opencode-go',
        modelId: 'minimax-m3'
      })
    ).toMatchObject({
      providerId: 'anthropic'
    })
  })

  it('does not choose an ambiguous global model by provider iteration order', () => {
    expect(
      resolveCapabilityIdentity({
        providerId: 'custom-relay',
        modelId: 'ambiguous-model'
      })
    ).toEqual({
      providerId: 'custom-relay',
      requestModelId: 'ambiguous-model',
      catalogMatched: false,
      catalogModelId: null
    })

    expect(
      resolveCapabilityIdentity({
        providerId: 'custom-relay',
        modelId: 'only-once'
      })
    ).toEqual({
      providerId: 'sole-provider',
      requestModelId: 'only-once',
      catalogMatched: true,
      catalogModelId: 'only-once'
    })

    expect(
      resolveCapabilityIdentity({
        providerId: 'new-api',
        modelId: 'hunyuan-ambiguous',
        endpointType: 'openai'
      })
    ).toEqual({
      providerId: 'openai',
      requestModelId: 'hunyuan-ambiguous',
      catalogMatched: false,
      catalogModelId: null
    })
  })

  it('keeps explicit provider overrides authoritative even without a catalog model', () => {
    expect(
      resolveCapabilityIdentity({
        providerId: 'custom-relay',
        modelId: 'unknown-model',
        explicitProviderId: 'capability-team'
      })
    ).toEqual({
      providerId: 'capability-team',
      requestModelId: 'unknown-model',
      catalogMatched: false,
      catalogModelId: null
    })
  })

  it('resolves separator-normalized xAI owner metadata', () => {
    expect(
      resolveCapabilityIdentity({
        providerId: 'new-api',
        modelId: 'owner-routed-model',
        ownedBy: 'x-ai',
        endpointType: 'openai'
      })
    ).toEqual({
      providerId: 'xai',
      requestModelId: 'owner-routed-model',
      catalogMatched: true,
      catalogModelId: 'owner-routed-model'
    })

    expect(
      resolveCapabilityIdentity({
        providerId: 'new-api',
        modelId: 'owner-routed-model',
        ownedBy: 'flux-ai',
        endpointType: 'openai'
      })
    ).toEqual({
      providerId: 'openai',
      requestModelId: 'owner-routed-model',
      catalogMatched: true,
      catalogModelId: 'owner-routed-model'
    })
  })

  it('resolves authoritative model origins without selecting an arbitrary mirror', () => {
    expect(
      resolveCapabilityIdentity({
        providerId: 'new-api',
        modelId: 'z-ai/glm_4.7',
        endpointType: 'openai'
      })
    ).toEqual({
      providerId: 'zhipuai',
      requestModelId: 'z-ai/glm_4.7',
      catalogMatched: true,
      catalogModelId: 'glm-4.7'
    })

    expect(
      resolveCapabilityIdentity({
        providerId: 'new-api',
        modelId: 'minimax-m2',
        endpointType: 'openai'
      })
    ).toEqual({
      providerId: 'minimax',
      requestModelId: 'minimax-m2',
      catalogMatched: true,
      catalogModelId: 'minimax-m2'
    })

    const gptOssIdentity = resolveCapabilityIdentity({
      providerId: 'new-api',
      modelId: 'gpt-oss-120b',
      endpointType: 'openai'
    })
    expect(gptOssIdentity).toEqual({
      providerId: 'openai',
      requestModelId: 'gpt-oss-120b',
      catalogMatched: false,
      catalogModelId: null
    })
    expect(buildResolvedCapabilitySnapshot(gptOssIdentity)).toMatchObject({
      supportsReasoning: true,
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true
      },
      temperatureCapability: undefined
    })

    for (const [modelId, providerId, catalogModelId] of [
      ['step-3.5-flash', 'stepfun', 'step-3.5-flash'],
      ['mistralai/mistral-large-latest', 'mistral', 'mistral-large-latest'],
      ['cohere/command-r-plus-08-2024', 'cohere', 'command-r-plus-08-2024']
    ] as const) {
      expect(
        resolveCapabilityIdentity({
          providerId: 'new-api',
          modelId,
          endpointType: 'openai'
        })
      ).toMatchObject({
        providerId,
        catalogMatched: true,
        catalogModelId
      })
    }
  })

  it('uses the same K3 alias identity for request policy and catalog capabilities', () => {
    const identity = resolveCapabilityIdentity({
      providerId: 'new-api',
      modelId: 'coding-kimi-k3-free',
      endpointType: 'openai'
    })

    expect(identity).toEqual({
      providerId: 'moonshot',
      requestModelId: 'coding-kimi-k3-free',
      catalogMatched: true,
      catalogModelId: 'kimi-k3'
    })
    expect(buildResolvedCapabilitySnapshot(identity)).toMatchObject({
      requestPolicy: {
        temperature: { mode: 'omit' },
        topP: { mode: 'omit' }
      },
      reasoningPortrait: {
        interleaved: true,
        visibility: 'summary'
      }
    })

    expect(
      resolveCapabilityIdentity({
        providerId: 'aihubmix',
        modelId: 'kimi_k3'
      })
    ).toMatchObject({
      providerId: 'aihubmix',
      catalogMatched: true,
      catalogModelId: 'kimi-k3'
    })
  })

  it.each(['gpt-5', 'o3'])(
    'keeps effort model %s hidden through explicit temperature capability',
    (modelId) => {
      const identity = resolveCapabilityIdentity({
        providerId: 'openai',
        modelId
      })

      expect(buildResolvedCapabilitySnapshot(identity)).toMatchObject({
        temperatureCapability: false,
        requestPolicy: {
          temperature: { mode: 'omit' }
        },
        supportsReasoningEffort: true
      })
    }
  )

  it('uses stored reasoning for state-dependent fixed policy unless a draft overrides it', () => {
    const providerSettings = Object.create(ProviderSettings.prototype) as ProviderSettings
    const identity = {
      providerId: 'moonshot',
      requestModelId: 'kimi-k2.6',
      catalogMatched: false as const,
      catalogModelId: null
    }
    const resolveIdentity = vi.fn(() => identity)
    const getModelConfig = vi.fn(() => ({ reasoning: true }))

    Object.assign(providerSettings as object, {
      resolveCapabilityIdentityForModel: resolveIdentity,
      getModelConfig
    })

    expect(
      providerSettings.getCapabilitySnapshot({
        providerId: 'new-api',
        modelId: 'kimi-k2.6'
      }).requestPolicy.temperature
    ).toEqual({ mode: 'fixed', value: 1 })
    expect(getModelConfig).toHaveBeenCalledWith('kimi-k2.6', 'new-api', identity)

    expect(
      providerSettings.getCapabilitySnapshot({
        providerId: 'new-api',
        modelId: 'kimi-k2.6',
        reasoningEnabled: false
      }).requestPolicy.temperature
    ).toEqual({ mode: 'fixed', value: 0.6 })
    expect(getModelConfig).toHaveBeenCalledTimes(1)

    expect(
      providerSettings.getCapabilitySnapshot({
        providerId: 'new-api',
        modelId: 'kimi-k2.6',
        resolvedModelConfig: {
          endpointType: 'openai',
          reasoning: false
        }
      }).requestPolicy.temperature
    ).toEqual({ mode: 'fixed', value: 0.6 })
    expect(resolveIdentity).toHaveBeenLastCalledWith('new-api', 'kimi-k2.6', undefined, {
      endpointType: 'openai',
      reasoning: false
    })
    expect(getModelConfig).toHaveBeenCalledTimes(1)
  })

  it('omits MiniMax-M3 temperature when thinking is enabled without rewriting catalog support', () => {
    const identity = resolveCapabilityIdentity({
      providerId: 'minimax',
      modelId: 'MiniMax-M3'
    })

    expect(identity).toEqual({
      providerId: 'minimax',
      requestModelId: 'MiniMax-M3',
      catalogMatched: true,
      catalogModelId: 'minimax-m3'
    })
    expect(buildResolvedCapabilitySnapshot(identity, { reasoningEnabled: true })).toMatchObject({
      temperatureCapability: true,
      requestPolicy: {
        temperature: { mode: 'omit' },
        topP: { mode: 'passthrough' }
      }
    })
    expect(buildResolvedCapabilitySnapshot(identity, { reasoningEnabled: false })).toMatchObject({
      temperatureCapability: true,
      requestPolicy: {
        temperature: { mode: 'passthrough' }
      }
    })
  })

  it('uses stored MiniMax-M3 reasoning for temperature omit unless a draft overrides it', () => {
    const providerSettings = Object.create(ProviderSettings.prototype) as ProviderSettings
    const identity = {
      providerId: 'minimax',
      requestModelId: 'MiniMax-M3',
      catalogMatched: true as const,
      catalogModelId: 'minimax-m3'
    }
    const resolveIdentity = vi.fn(() => identity)
    const getModelConfig = vi.fn(() => ({ reasoning: true, temperature: 0.6 }))

    Object.assign(providerSettings as object, {
      resolveCapabilityIdentityForModel: resolveIdentity,
      getModelConfig
    })

    expect(
      providerSettings.getCapabilitySnapshot({
        providerId: 'minimax',
        modelId: 'MiniMax-M3'
      }).requestPolicy.temperature
    ).toEqual({ mode: 'omit' })
    expect(getModelConfig).toHaveBeenCalledWith('MiniMax-M3', 'minimax', identity)

    expect(
      providerSettings.getCapabilitySnapshot({
        providerId: 'minimax',
        modelId: 'MiniMax-M3',
        reasoningEnabled: false
      }).requestPolicy.temperature
    ).toEqual({ mode: 'passthrough' })
    expect(getModelConfig).toHaveBeenCalledTimes(1)
  })

  it.each([
    'getCapabilityProviderId',
    'supportsReasoningCapability',
    'getReasoningPortrait',
    'getThinkingBudgetRange',
    'getTemperatureCapability',
    'supportsTemperatureControl',
    'supportsSearchCapability',
    'getSearchDefaults',
    'supportsReasoningEffortCapability',
    'getReasoningEffortDefault',
    'supportsVerbosityCapability',
    'getVerbosityDefault'
  ])('does not expose retired capability projection %s', (methodName) => {
    expect(ProviderSettings.prototype).not.toHaveProperty(methodName)
  })

  it('keeps Phase 1 narrow and transport fallback internal to identity resolution', () => {
    expect(resolveCapabilityFamilyHint('claude-opus-4-7')).toBe('anthropic')
    expect(resolveCapabilityFamilyHint('proxy-model', 'Google Gemini')).toBe('gemini')
    expect(resolveCapabilityFamilyHint('kimi-k3', 'Moonshot')).toBeUndefined()
    expect(
      resolveCapabilityIdentity({
        providerId: 'new-api',
        modelId: 'unknown-gemini-model',
        endpointType: 'gemini'
      })
    ).toMatchObject({
      providerId: 'google',
      catalogMatched: false
    })
    expect(
      resolveCapabilityIdentity({
        providerId: 'custom-relay',
        modelId: 'unknown-model'
      })
    ).toMatchObject({
      providerId: 'custom-relay',
      catalogMatched: false
    })
  })
})
