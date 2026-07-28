import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock electron-store with in-memory storage to persist user configs across helper instances
const state = vi.hoisted(() => ({
  mockStores: new Map<string, Record<string, any>>(),
  mockDb: null as any
}))
vi.mock('electron-store', () => {
  return {
    default: class MockElectronStore {
      private storePath: string
      private data: Record<string, any>
      constructor(options: { name: string }) {
        this.storePath = options.name
        if (!state.mockStores.has(this.storePath)) state.mockStores.set(this.storePath, {})
        this.data = state.mockStores.get(this.storePath)!
      }
      get(key: string) {
        return this.data[key]
      }
      set(key: string, value: any) {
        this.data[key] = value
      }
      delete(key: string) {
        delete this.data[key]
      }
      has(key: string) {
        return key in this.data
      }
      clear() {
        Object.keys(this.data).forEach((k) => delete this.data[k])
      }
      get store() {
        return { ...this.data }
      }
      get path() {
        return `/mock/${this.storePath}.json`
      }
    }
  }
})

// Mock providerDbLoader with a mutable in-memory aggregate
vi.mock('../../../src/main/provider/providerDbLoader', () => {
  return {
    providerDbLoader: {
      getDb: () => state.mockDb,
      initialize: async () => {},
      subscribeCatalogChanges: vi.fn()
    }
  }
})

import { ModelConfigHelper } from '../../../src/main/provider/modelConfig'
import { modelCapabilities } from '../../../src/main/provider/modelCapabilities'
import { ApiEndpointType, ModelType } from '../../../src/shared/model'
import { resolveCapabilityIdentity } from '../../../src/main/provider/capabilityIdentity'

describe('Provider DB strict matching and user overrides', () => {
  beforeEach(() => {
    // Reset stores and mock DB before each test
    state.mockStores.clear()
    state.mockDb = {
      providers: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          models: [
            {
              id: 'gpt-5.6-sol',
              limit: { context: 1_050_000, output: 128_000 },
              modalities: { input: ['text', 'image'], output: ['text'] },
              tool_call: true
            },
            {
              id: 'opaque-renderer',
              type: 'imageGeneration',
              limit: { context: 65_536, output: 8_192 },
              modalities: { input: ['text'], output: ['image'] },
              tool_call: false
            }
          ]
        },
        'test-provider': {
          id: 'test-provider',
          name: 'Test Provider',
          models: [
            {
              id: 'test-model',
              limit: { context: 10000, output: 2000 },
              modalities: { input: ['text', 'image'] },
              tool_call: true,
              reasoning: {
                supported: true,
                budget: { default: 12345 },
                effort: 'low',
                verbosity: 'high'
              },
              search: { supported: true, forced_search: false, search_strategy: 'turbo' }
            },
            {
              id: 'partial-limit',
              limit: { context: 16000 }, // output missing -> fallback 4096
              modalities: { input: ['text'] }
            },
            {
              id: 'large-output',
              limit: { context: 200000, output: 64000 },
              modalities: { input: ['text'] }
            },
            {
              id: 'no-limit' // both missing -> fallback 16000/4096
            },
            {
              id: 'tool-call-disabled',
              tool_call: false
            },
            {
              id: 'claude-portrait',
              reasoning: {
                supported: true,
                default: true
              },
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: false,
                  mode: 'budget',
                  budget: { min: 1024, default: 2048 }
                }
              }
            },
            {
              id: 'gemini-budget',
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: true,
                  mode: 'budget',
                  budget: { min: 0, max: 24576, default: -1, auto: -1, off: 0, unit: 'tokens' }
                }
              }
            },
            {
              id: 'gpt-5.2',
              reasoning: {
                supported: true,
                default: true
              },
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: false,
                  mode: 'effort',
                  effort: 'none',
                  effort_options: ['none', 'low', 'medium', 'high', 'xhigh'],
                  verbosity: 'medium',
                  verbosity_options: ['low', 'medium', 'high']
                }
              }
            }
          ]
        },
        aihubmix: {
          id: 'aihubmix',
          name: 'AIHubMix',
          models: [
            {
              id: 'kimi-k3',
              limit: { context: 8192, output: 1024 },
              reasoning: { supported: true, default: true }
            }
          ]
        },
        moonshot: {
          id: 'moonshot',
          name: 'Moonshot',
          models: [
            {
              id: 'kimi-k3',
              limit: { context: 1048576, output: 131072 },
              modalities: { input: ['text', 'image', 'video'], output: ['text'] },
              tool_call: true,
              temperature: false,
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
            },
            {
              id: 'moonshotai/kimi-k2.6',
              reasoning: {
                supported: true,
                default: true
              },
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: true,
                  mode: 'budget',
                  budget: { min: 0, max: 32768, default: 8192 }
                }
              }
            },
            {
              id: 'moonshotai/kimi-k2.6:thinking',
              reasoning: {
                supported: true,
                default: false
              },
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: false,
                  mode: 'budget',
                  budget: { min: 0, max: 32768, default: 8192 }
                }
              }
            }
          ]
        },
        alpha: {
          id: 'alpha',
          models: [
            { id: 'shared-model', limit: { context: 11111, output: 1111 } },
            { id: 'foreign-only', limit: { context: 55555, output: 5555 } }
          ]
        },
        beta: {
          id: 'beta',
          models: [{ id: 'shared-model', limit: { context: 22222, output: 2222 } }]
        },
        minimax: {
          id: 'minimax',
          name: 'MiniMax',
          models: [
            {
              id: 'MiniMax-M2.5',
              limit: { context: 204800, output: 131072 },
              modalities: { input: ['text'], output: ['text'] },
              tool_call: true,
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
              id: 'MiniMax-M3',
              limit: { context: 512000, output: 128000 },
              modalities: { input: ['text', 'image', 'video'], output: ['text'] },
              tool_call: true,
              reasoning: {
                supported: true,
                default: true
              },
              extra_capabilities: {
                reasoning: {
                  supported: true
                }
              }
            }
          ]
        }
      }
    }
    ;(modelCapabilities as any).rebuildIndexFromDb()
  })

  it('returns provider DB config on strict provider+model match', () => {
    const helper = new ModelConfigHelper()
    const cfg = helper.getModelConfig('test-model', 'test-provider')
    expect(cfg.maxTokens).toBe(2000)
    expect(cfg.contextLength).toBe(10000)
    expect(cfg.vision).toBe(true)
    expect(cfg.functionCall).toBe(true)
    expect(cfg.reasoning).toBe(true)
    expect(cfg.thinkingBudget).toBe(12345)
    expect(cfg.reasoningEffort).toBe('low')
    expect(cfg.verbosity).toBe('high')
    expect(cfg.enableSearch).toBe(true)
    expect(cfg.forcedSearch).toBe(false)
    expect(cfg.searchStrategy).toBe('turbo')
    expect(cfg.type).toBe(ModelType.Chat)
    expect(cfg.temperature).toBe(0.6)
  })

  it('resolves OpenAI Codex models through the OpenAI catalog identity', () => {
    const helper = new ModelConfigHelper()

    const config = helper.getModelConfig('gpt-5.6-sol', 'openai-codex')

    expect(config).toMatchObject({
      contextLength: 1_050_000,
      maxTokens: 32_000,
      reasoning: true
    })
  })

  it('applies partial fallbacks when limit fields are missing', () => {
    const helper = new ModelConfigHelper()
    const cfg1 = helper.getModelConfig('partial-limit', 'test-provider')
    expect(cfg1.contextLength).toBe(16000)
    expect(cfg1.maxTokens).toBe(4096)
    expect(cfg1.enableSearch).toBe(false)
    expect(cfg1.forcedSearch).toBe(false)
    expect(cfg1.searchStrategy).toBe('turbo')

    const cfg2 = helper.getModelConfig('no-limit', 'test-provider')
    expect(cfg2.contextLength).toBe(16000)
    expect(cfg2.maxTokens).toBe(4096)
    expect(cfg2.functionCall).toBe(true)
    expect(cfg2.enableSearch).toBe(false)
    expect(cfg2.forcedSearch).toBe(false)
    expect(cfg2.searchStrategy).toBe('turbo')
  })

  it('caps provider-derived maxTokens defaults at 32000', () => {
    const helper = new ModelConfigHelper()
    const cfg = helper.getModelConfig('large-output', 'test-provider')

    expect(cfg.contextLength).toBe(200000)
    expect(cfg.maxTokens).toBe(32000)
  })

  it('preserves explicit tool_call=false from provider DB', () => {
    const helper = new ModelConfigHelper()
    const cfg = helper.getModelConfig('tool-call-disabled', 'test-provider')
    expect(cfg.contextLength).toBe(16000)
    expect(cfg.maxTokens).toBe(4096)
    expect(cfg.functionCall).toBe(false)
  })

  it('falls back to safe defaults when providerId is not provided', () => {
    const helper = new ModelConfigHelper()
    const cfg = helper.getModelConfig('test-model')
    expect(cfg.contextLength).toBe(16000)
    expect(cfg.maxTokens).toBe(4096)
    expect(cfg.functionCall).toBe(true)
    expect(cfg.temperature).toBe(0.6)
  })

  it('uses capability identity instead of provider iteration order for proxy defaults', () => {
    const helper = new ModelConfigHelper()

    const proxyConfig = helper.getModelConfig('kimi-k3', 'new-api')
    const directConfig = helper.getModelConfig('kimi-k3', 'moonshot')

    expect(proxyConfig).toMatchObject({
      contextLength: directConfig.contextLength,
      maxTokens: directConfig.maxTokens,
      vision: directConfig.vision,
      functionCall: directConfig.functionCall,
      reasoning: directConfig.reasoning,
      reasoningEffort: directConfig.reasoningEffort
    })
    expect(proxyConfig.contextLength).toBe(1048576)
    expect(proxyConfig.maxTokens).toBe(32000)
    expect(proxyConfig.vision).toBe(true)
    expect(proxyConfig.functionCall).toBe(true)
    expect(proxyConfig.reasoning).toBe(true)
    expect(proxyConfig.reasoningEffort).toBe('max')
  })

  it('does not inherit globally unique defaults for custom models under a known provider', () => {
    const helper = new ModelConfigHelper()

    const knownProviderConfig = helper.getModelConfig('foreign-only', 'test-provider')
    const proxyConfig = helper.getModelConfig('foreign-only', 'new-api')

    expect(knownProviderConfig).toMatchObject({
      contextLength: 16000,
      maxTokens: 4096,
      reasoning: false
    })
    expect(proxyConfig).toMatchObject({
      contextLength: 55555,
      maxTokens: 5555
    })
  })

  it('preserves user ownership when reading route-only configuration', () => {
    const helper = new ModelConfigHelper()
    const helperInternals = helper as any
    const cacheKey = helperInternals.generateCacheKey('new-api', 'custom-route-model')

    helper.importConfigs(
      {
        [cacheKey]: {
          id: 'custom-route-model',
          providerId: 'new-api',
          source: 'user',
          config: {
            maxTokens: 4096,
            contextLength: 16000,
            temperature: 0.6,
            vision: false,
            functionCall: true,
            reasoning: false,
            type: ModelType.ImageGeneration,
            apiEndpoint: ApiEndpointType.Video,
            endpointType: 'image-generation',
            isUserDefined: false
          }
        }
      },
      false
    )

    expect(helper.getModelRouteConfig('custom-route-model', 'new-api')).toMatchObject({
      type: ModelType.ImageGeneration,
      apiEndpoint: ApiEndpointType.Video,
      endpointType: 'image-generation',
      isUserDefined: true
    })
  })

  it('keeps an explicit capability provider override authoritative for proxy defaults', () => {
    const helper = new ModelConfigHelper()

    const config = helper.getModelConfig('kimi-k3', 'new-api', 'capability-team')

    expect(config.contextLength).toBe(16000)
    expect(config.maxTokens).toBe(4096)
    expect(config.reasoning).toBe(false)
    expect(config.reasoningEffort).toBeUndefined()
  })

  it('uses safe defaults instead of selecting an ambiguous global model match', () => {
    const helper = new ModelConfigHelper()

    const cfg = helper.getModelConfig('shared-model', 'new-api')

    expect(cfg.contextLength).toBe(16000)
    expect(cfg.maxTokens).toBe(4096)
  })

  it('keeps New API catalog defaults stable across reset, refresh, and restart', () => {
    const modelId = 'gpt-5.6-sol'
    const providerId = 'new-api'
    const providerFacts = {
      id: modelId,
      name: 'GPT-5.6 Sol',
      group: 'openai',
      providerId,
      isCustom: false,
      endpointType: 'openai' as const,
      supportedEndpointTypes: ['openai'] as const,
      ownedBy: 'openai',
      type: ModelType.Chat
    }
    const identity = resolveCapabilityIdentity({
      providerId,
      modelId,
      ownedBy: providerFacts.ownedBy,
      endpointType: providerFacts.endpointType
    })
    const resolveConfig = (helper: ModelConfigHelper, facts = providerFacts) =>
      helper.getModelConfig(modelId, providerId, undefined, identity, {
        ...facts,
        supportedEndpointTypes: [...facts.supportedEndpointTypes]
      })
    const helper = new ModelConfigHelper()

    expect(resolveConfig(helper)).toMatchObject({
      contextLength: 1_050_000,
      maxTokens: 32_000,
      isUserDefined: false
    })

    helper.resetModelConfig(modelId, providerId)
    expect(resolveConfig(helper)).toMatchObject({
      contextLength: 1_050_000,
      maxTokens: 32_000
    })

    expect(
      resolveConfig(helper, { ...providerFacts, name: 'GPT-5.6 Sol (refreshed)' })
    ).toMatchObject({
      contextLength: 1_050_000,
      maxTokens: 32_000
    })

    const restartedHelper = new ModelConfigHelper()
    expect(resolveConfig(restartedHelper)).toMatchObject({
      contextLength: 1_050_000,
      maxTokens: 32_000
    })

    restartedHelper.setModelConfig(modelId, providerId, {
      ...resolveConfig(restartedHelper),
      contextLength: 200_000
    })
    expect(resolveConfig(restartedHelper).contextLength).toBe(200_000)

    restartedHelper.resetModelConfig(modelId, providerId)
    expect(resolveConfig(restartedHelper)).toMatchObject({
      contextLength: 1_050_000,
      maxTokens: 32_000,
      isUserDefined: false
    })
  })

  it('keeps the catalog model type when sparse provider route facts omit it', () => {
    const modelId = 'opaque-renderer'
    const providerId = 'new-api'
    const identity = resolveCapabilityIdentity({
      providerId,
      modelId,
      ownedBy: 'openai',
      endpointType: 'openai'
    })
    const helper = new ModelConfigHelper()
    const config = helper.getModelConfig(modelId, providerId, undefined, identity, {
      id: modelId,
      name: 'Opaque Renderer',
      group: 'openai',
      providerId,
      isCustom: false,
      endpointType: 'openai',
      supportedEndpointTypes: ['openai'],
      ownedBy: 'openai'
    })

    expect(config.type).toBe(ModelType.ImageGeneration)
    expect(config.apiEndpoint).toBe(ApiEndpointType.Image)
  })

  it('recomputes the API endpoint when provider facts override the catalog model type', () => {
    const modelId = 'opaque-renderer'
    const providerId = 'new-api'
    const identity = resolveCapabilityIdentity({
      providerId,
      modelId,
      ownedBy: 'openai',
      endpointType: 'openai'
    })
    const helper = new ModelConfigHelper()
    const config = helper.getModelConfig(modelId, providerId, undefined, identity, {
      id: modelId,
      name: 'Opaque Renderer',
      group: 'openai',
      providerId,
      isCustom: false,
      endpointType: 'openai',
      supportedEndpointTypes: ['openai'],
      ownedBy: 'openai',
      type: ModelType.Chat
    })

    expect(config.type).toBe(ModelType.Chat)
    expect(config.apiEndpoint).toBe(ApiEndpointType.Chat)
  })

  it('prefers user config over provider DB and persists across restart', () => {
    const helper1 = new ModelConfigHelper()
    const userCfg = {
      maxTokens: 64000,
      contextLength: 128000,
      temperature: 0.5,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: ModelType.Chat
    }
    helper1.setModelConfig('test-model', 'test-provider', userCfg)
    const read1 = helper1.getModelConfig('test-model', 'test-provider')
    expect(read1).toMatchObject({ ...userCfg, isUserDefined: true })

    // Simulate app restart: new helper instance, same version
    const helper2 = new ModelConfigHelper()
    const read2 = helper2.getModelConfig('test-model', 'test-provider')
    expect(read2).toMatchObject({ ...userCfg, isUserDefined: true })

    // Simulate version bump: non-user entries would be cleared, user entries remain
    const helper3 = new ModelConfigHelper()
    const read3 = helper3.getModelConfig('test-model', 'test-provider')
    expect(read3).toMatchObject({ ...userCfg, isUserDefined: true })
  })

  it('rejects provider-derived imports while preserving user values', () => {
    const helper = new ModelConfigHelper()
    const helperAny = helper as any
    const providerCacheKey = helperAny.generateCacheKey('test-provider', 'large-output')

    helper.importConfigs(
      {
        [providerCacheKey]: {
          id: 'large-output',
          providerId: 'test-provider',
          source: 'provider',
          config: {
            maxTokens: 64000,
            contextLength: 200000,
            temperature: 0.4,
            vision: false,
            functionCall: true,
            reasoning: false,
            type: ModelType.Chat,
            isUserDefined: false
          }
        }
      },
      false
    )

    const providerRead = helper.getModelConfig('large-output', 'test-provider')
    expect(providerRead.maxTokens).toBe(32000)
    expect(providerRead.contextLength).toBe(200000)

    helper.setModelConfig('large-output', 'test-provider', {
      maxTokens: 64000,
      contextLength: 128000,
      temperature: 0.6,
      vision: false,
      functionCall: true,
      reasoning: false,
      type: ModelType.Chat
    })

    const userRead = helper.getModelConfig('large-output', 'test-provider')
    expect(userRead.maxTokens).toBe(64000)
    expect(userRead.isUserDefined).toBe(true)
  })

  it('matches DB with case-insensitive provider/model IDs for provider data (strictly lowercase in DB)', () => {
    const helper = new ModelConfigHelper()
    const cfg = helper.getModelConfig('TEST-MODEL', 'TEST-PROVIDER')
    // DB lookup lowercases internally
    expect(cfg.contextLength).toBe(10000)
    expect(cfg.maxTokens).toBe(2000)
  })

  it('matches mixed-case provider DB model IDs case-insensitively', () => {
    const helper = new ModelConfigHelper()

    const cfg = helper.getModelConfig('minimax-m2.5', 'minimax')

    expect(cfg.contextLength).toBe(204800)
    expect(cfg.maxTokens).toBe(32000)
    expect(cfg.functionCall).toBe(true)
    expect(cfg.reasoning).toBe(true)
  })

  it('applies MiniMax-M3 provider defaults when the provider DB cache is stale', () => {
    const helper = new ModelConfigHelper()

    const cfg = helper.getModelConfig('minimax-m3', 'minimax')

    expect(cfg.contextLength).toBe(1_000_000)
    expect(cfg.maxTokens).toBe(32000)
    expect(cfg.vision).toBe(true)
    expect(cfg.functionCall).toBe(true)
    expect(cfg.reasoning).toBe(true)
    expect(cfg.forceInterleavedThinkingCompat).toBe(true)
  })

  it('keeps MiniMax-M3 context floor after provider facts merge', () => {
    const helper = new ModelConfigHelper()
    const cfg = helper.getModelConfig('minimax-m3', 'minimax', undefined, undefined, {
      id: 'minimax-m3',
      name: 'MiniMax M3',
      group: 'default',
      providerId: 'minimax',
      contextLength: 512000,
      maxTokens: 32000,
      vision: true,
      functionCall: true,
      reasoning: true,
      type: ModelType.Chat
    })

    expect(cfg.contextLength).toBe(1_000_000)
    expect(cfg.forceInterleavedThinkingCompat).toBe(true)
    expect(cfg.isUserDefined).toBe(false)
  })

  it('prefers portrait defaults over legacy reasoning defaults', () => {
    const helper = new ModelConfigHelper()

    const cfg = helper.getModelConfig('claude-portrait', 'test-provider')

    expect(cfg.reasoning).toBe(false)
    expect(cfg.thinkingBudget).toBe(2048)
    expect(cfg.reasoningEffort).toBeUndefined()
  })

  it('preserves provider portrait sentinel budgets', () => {
    const helper = new ModelConfigHelper()

    const cfg = helper.getModelConfig('gemini-budget', 'test-provider')

    expect(cfg.reasoning).toBe(true)
    expect(cfg.thinkingBudget).toBe(-1)
  })

  it('keeps none as the provider default effort without enabling reasoning', () => {
    const helper = new ModelConfigHelper()

    const cfg = helper.getModelConfig('gpt-5.2', 'test-provider')

    expect(cfg.reasoning).toBe(false)
    expect(cfg.reasoningEffort).toBe('none')
    expect(cfg.verbosity).toBe('medium')
  })

  it('forces Moonshot Kimi defaults to the thinking-enabled temperature when reasoning defaults on', () => {
    const helper = new ModelConfigHelper()

    const cfg = helper.getModelConfig('moonshotai/kimi-k2.6', 'moonshot')

    expect(cfg.reasoning).toBe(true)
    expect(cfg.temperature).toBe(1)
  })

  it('forces Moonshot Kimi :thinking variants to keep reasoning on and temperature at 1.0', () => {
    const helper = new ModelConfigHelper()

    const cfg = helper.getModelConfig('moonshotai/kimi-k2.6:thinking', 'moonshot')

    expect(cfg.reasoning).toBe(true)
    expect(cfg.temperature).toBe(1)
  })

  it('merges provider facts without persisting derived configuration', () => {
    const helper = new ModelConfigHelper()

    const cfg = helper.getModelConfig('claude-portrait', 'test-provider', undefined, undefined, {
      id: 'claude-portrait',
      name: 'Claude Portrait',
      group: 'default',
      providerId: 'test-provider',
      maxTokens: 8192,
      contextLength: 65536,
      vision: true,
      functionCall: true,
      reasoning: true,
      type: ModelType.Chat
    })

    expect(cfg.contextLength).toBe(65536)
    expect(cfg.maxTokens).toBe(8192)
    expect(cfg.vision).toBe(true)
    expect(cfg.functionCall).toBe(true)
    expect(cfg.reasoning).toBe(true)
    expect(cfg.thinkingBudget).toBe(2048)
    expect(cfg.reasoningEffort).toBeUndefined()
    expect(cfg.verbosity).toBeUndefined()
    expect(cfg.isUserDefined).toBe(false)
    expect(helper.exportConfigs()).toEqual({})
  })
})
