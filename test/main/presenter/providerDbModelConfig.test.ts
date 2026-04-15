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
vi.mock('../../../src/main/presenter/configPresenter/providerDbLoader', () => {
  return {
    providerDbLoader: {
      getDb: () => state.mockDb,
      initialize: async () => {}
    }
  }
})

import { ModelConfigHelper } from '../../../src/main/presenter/configPresenter/modelConfig'
import { modelCapabilities } from '../../../src/main/presenter/configPresenter/modelCapabilities'
import { ModelType } from '../../../src/shared/model'

describe('Provider DB strict matching + user overrides', () => {
  beforeEach(() => {
    // Reset stores and mock DB before each test
    state.mockStores.clear()
    state.mockDb = {
      providers: {
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
        }
      }
    }
    ;(modelCapabilities as any).rebuildIndexFromDb()
  })

  it('returns provider DB config on strict provider+model match', () => {
    const helper = new ModelConfigHelper('1.0.0')
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

  it('applies partial fallbacks when limit fields are missing', () => {
    const helper = new ModelConfigHelper('1.0.0')
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

  it('preserves explicit tool_call=false from provider DB', () => {
    const helper = new ModelConfigHelper('1.0.0')
    const cfg = helper.getModelConfig('tool-call-disabled', 'test-provider')
    expect(cfg.contextLength).toBe(16000)
    expect(cfg.maxTokens).toBe(4096)
    expect(cfg.functionCall).toBe(false)
  })

  it('falls back to safe defaults when providerId is not provided', () => {
    const helper = new ModelConfigHelper('1.0.0')
    const cfg = helper.getModelConfig('test-model')
    expect(cfg.contextLength).toBe(16000)
    expect(cfg.maxTokens).toBe(4096)
    expect(cfg.functionCall).toBe(true)
    expect(cfg.temperature).toBe(0.6)
  })

  it('prefers user config over provider DB and persists across restart', () => {
    const helper1 = new ModelConfigHelper('1.0.0')
    const userCfg = {
      maxTokens: 8888,
      contextLength: 7777,
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
    const helper2 = new ModelConfigHelper('1.0.0')
    const read2 = helper2.getModelConfig('test-model', 'test-provider')
    expect(read2).toMatchObject({ ...userCfg, isUserDefined: true })

    // Simulate version bump: non-user entries would be cleared, user entries remain
    const helper3 = new ModelConfigHelper('2.0.0')
    const read3 = helper3.getModelConfig('test-model', 'test-provider')
    expect(read3).toMatchObject({ ...userCfg, isUserDefined: true })
  })

  it('matches DB with case-insensitive provider/model IDs for provider data (strictly lowercase in DB)', () => {
    const helper = new ModelConfigHelper('1.0.0')
    const cfg = helper.getModelConfig('TEST-MODEL', 'TEST-PROVIDER')
    // DB lookup lowercases internally
    expect(cfg.contextLength).toBe(10000)
    expect(cfg.maxTokens).toBe(2000)
  })

  it('prefers portrait defaults over legacy reasoning defaults', () => {
    const helper = new ModelConfigHelper('1.0.0')

    const cfg = helper.getModelConfig('claude-portrait', 'test-provider')

    expect(cfg.reasoning).toBe(false)
    expect(cfg.thinkingBudget).toBe(2048)
    expect(cfg.reasoningEffort).toBeUndefined()
  })

  it('preserves provider portrait sentinel budgets', () => {
    const helper = new ModelConfigHelper('1.0.0')

    const cfg = helper.getModelConfig('gemini-budget', 'test-provider')

    expect(cfg.reasoning).toBe(true)
    expect(cfg.thinkingBudget).toBe(-1)
  })

  it('keeps none as the provider default effort without enabling reasoning', () => {
    const helper = new ModelConfigHelper('1.0.0')

    const cfg = helper.getModelConfig('gpt-5.2', 'test-provider')

    expect(cfg.reasoning).toBe(false)
    expect(cfg.reasoningEffort).toBe('none')
    expect(cfg.verbosity).toBe('medium')
  })

  it('recomputes reasoning-related fields for provider cached configs', () => {
    const helper = new ModelConfigHelper('1.0.0')

    helper.setModelConfig(
      'claude-portrait',
      'test-provider',
      {
        maxTokens: 8192,
        contextLength: 65536,
        temperature: 0.3,
        vision: true,
        functionCall: true,
        reasoning: true,
        type: ModelType.Chat,
        thinkingBudget: 9999,
        reasoningEffort: 'high',
        verbosity: 'high'
      },
      { source: 'provider' }
    )

    const cfg = helper.getModelConfig('claude-portrait', 'test-provider')

    expect(cfg.contextLength).toBe(65536)
    expect(cfg.maxTokens).toBe(8192)
    expect(cfg.vision).toBe(true)
    expect(cfg.functionCall).toBe(true)
    expect(cfg.reasoning).toBe(false)
    expect(cfg.thinkingBudget).toBe(2048)
    expect(cfg.reasoningEffort).toBeUndefined()
    expect(cfg.verbosity).toBeUndefined()
    expect(cfg.isUserDefined).toBe(false)
  })
})
