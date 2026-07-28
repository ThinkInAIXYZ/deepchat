import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ModelConfigHelper } from '../../../src/main/provider/modelConfig'
import { ModelType } from '../../../src/shared/model'
import { DEFAULT_MODEL_TIMEOUT } from '../../../src/shared/modelConfigDefaults'
import type { ModelConfig } from '@shared/types/provider'
import { providerDbLoader } from '../../../src/main/provider/providerDbLoader'
import { modelCapabilities } from '../../../src/main/provider/modelCapabilities'

// Mock electron-store with in-memory storage
const mockStores = new Map<string, Record<string, any>>()

const CURRENT_VERSION = '1.0.0'
const rebuildModelCapabilities = () => {
  const capabilities = modelCapabilities as unknown as { rebuildIndexFromDb: () => void }
  capabilities.rebuildIndexFromDb()
}

vi.mock('electron-store', () => {
  return {
    default: class MockElectronStore {
      private storePath: string
      private data: Record<string, any>

      constructor(options: { name: string }) {
        this.storePath = options.name
        if (!mockStores.has(this.storePath)) {
          mockStores.set(this.storePath, {})
        }
        this.data = mockStores.get(this.storePath)!
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
        Object.keys(this.data).forEach((key) => delete this.data[key])
      }

      get store() {
        return { ...this.data }
      }

      get path() {
        return `/mock/path/${this.storePath}.json`
      }
    }
  }
})

describe('ModelConfigHelper', () => {
  let modelConfigHelper: ModelConfigHelper
  let originalStoreData: Map<string, Record<string, any>>

  beforeEach(() => {
    // Save original store state for restoration
    originalStoreData = new Map()
    mockStores.forEach((value, key) => {
      originalStoreData.set(key, { ...value })
    })

    // Clear stores for clean test state
    mockStores.clear()

    // Initialize test instances
    modelConfigHelper = new ModelConfigHelper(CURRENT_VERSION)
  })

  afterEach(() => {
    // Restore original store state
    mockStores.clear()
    originalStoreData.forEach((value, key) => {
      mockStores.set(key, value)
    })

    vi.restoreAllMocks()
    rebuildModelCapabilities()
  })

  describe('Core CRUD Operations', () => {
    const testModelId = 'test-gpt-4'
    const testProviderId = 'test-openai'
    const testConfig: ModelConfig = {
      maxTokens: 8000,
      contextLength: 16000,
      temperature: 0.8,
      vision: true,
      functionCall: true,
      reasoning: false,
      type: ModelType.Chat
    }

    it('should handle complete CRUD lifecycle', () => {
      // CREATE: Set configuration and verify
      modelConfigHelper.setModelConfig(testModelId, testProviderId, testConfig)
      expect(modelConfigHelper.hasUserConfig(testModelId, testProviderId)).toBe(true)

      // READ: Get configuration and verify it matches
      const retrievedConfig = modelConfigHelper.getModelConfig(testModelId, testProviderId)
      expect(retrievedConfig).toMatchObject(testConfig)
      expect(retrievedConfig.isUserDefined).toBe(true)

      // UPDATE: Modify configuration
      const updatedConfig = { ...testConfig, maxTokens: 12000 }
      modelConfigHelper.setModelConfig(testModelId, testProviderId, updatedConfig)
      expect(modelConfigHelper.getModelConfig(testModelId, testProviderId).maxTokens).toBe(12000)

      // DELETE: Reset configuration
      modelConfigHelper.resetModelConfig(testModelId, testProviderId)
      expect(modelConfigHelper.hasUserConfig(testModelId, testProviderId)).toBe(false)
      expect(modelConfigHelper.getModelConfig(testModelId, testProviderId).maxTokens).toBe(4096) // Default
    })

    it('should return safe default configuration for unknown models', () => {
      const defaultConfig = modelConfigHelper.getModelConfig('unknown-model', 'unknown-provider')

      expect(defaultConfig).toMatchObject({
        maxTokens: 4096,
        contextLength: 16000,
        timeout: DEFAULT_MODEL_TIMEOUT,
        temperature: 0.6,
        vision: false,
        functionCall: true,
        reasoning: false,
        type: ModelType.Chat
      })
      expect(defaultConfig.isUserDefined).toBe(false)
    })

    it('should handle multiple configurations and bulk operations', () => {
      const config1 = { ...testConfig, maxTokens: 5000 }
      const config2 = { ...testConfig, maxTokens: 10000 }

      // Set multiple configurations
      modelConfigHelper.setModelConfig('model1', testProviderId, config1)
      modelConfigHelper.setModelConfig('model2', testProviderId, config2)

      // Verify count and provider-specific retrieval
      const allConfigs = modelConfigHelper.getAllModelConfigs()
      expect(Object.keys(allConfigs)).toHaveLength(2)

      const providerConfigs = modelConfigHelper.getProviderModelConfigs(testProviderId)
      expect(providerConfigs).toHaveLength(2)
      expect(providerConfigs.map((c) => c.modelId)).toContain('model1')
      expect(providerConfigs.map((c) => c.modelId)).toContain('model2')

      // Test export/import
      const exportedConfigs = modelConfigHelper.exportConfigs()
      modelConfigHelper.clearAllConfigs()
      expect(Object.keys(modelConfigHelper.getAllModelConfigs())).toHaveLength(0)

      modelConfigHelper.importConfigs(exportedConfigs, false)
      expect(Object.keys(modelConfigHelper.getAllModelConfigs())).toHaveLength(2)
      expect(modelConfigHelper.getModelConfig('model1', testProviderId).maxTokens).toBe(5000)
    })
  })

  describe('Configuration Priority', () => {
    it('uses provider metadata until a user config overrides it', () => {
      const providerId = 'test-provider'
      const modelId = 'provider-model'
      const providerModel = {
        id: modelId,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 32768, output: 8192 },
        tool_call: false,
        reasoning: { supported: false },
        type: 'chat'
      } as any
      const hasProviderSpy = vi
        .spyOn(modelCapabilities, 'hasProvider')
        .mockImplementation((id) => id === providerId)
      const capabilityMatchSpy = vi
        .spyOn(modelCapabilities, 'getProviderCapabilityModelMatch')
        .mockImplementation((id, candidateModelId) =>
          id === providerId && candidateModelId === modelId
            ? { providerId, modelId, model: providerModel }
            : undefined
        )

      try {
        expect(modelConfigHelper.getModelConfig(modelId, providerId)).toMatchObject({
          maxTokens: 8192,
          contextLength: 32768,
          vision: true,
          functionCall: false,
          reasoning: false,
          type: ModelType.Chat,
          isUserDefined: false
        })

        const userConfig: ModelConfig = {
          maxTokens: 9999,
          contextLength: 65536,
          temperature: 0.2,
          vision: false,
          functionCall: true,
          reasoning: true,
          type: ModelType.Chat
        }
        modelConfigHelper.setModelConfig(modelId, providerId, userConfig)

        expect(modelConfigHelper.getModelConfig(modelId, providerId)).toMatchObject({
          ...userConfig,
          isUserDefined: true
        })

        modelConfigHelper.resetModelConfig(modelId, providerId)

        expect(modelConfigHelper.getModelConfig(modelId, providerId)).toMatchObject({
          maxTokens: 8192,
          contextLength: 32768,
          isUserDefined: false
        })
      } finally {
        capabilityMatchSpy.mockRestore()
        hasProviderSpy.mockRestore()
      }
    })

    it('should maintain configuration isolation between different providers', () => {
      const modelId = 'test-isolation-model'
      const provider1 = 'provider-1'
      const provider2 = 'provider-2'

      // Set different configurations for same model with different providers
      const config1: ModelConfig = {
        maxTokens: 1111,
        contextLength: 2222,
        temperature: 0.1,
        vision: true,
        functionCall: true,
        reasoning: false,
        type: ModelType.Chat
      }

      const config2: ModelConfig = {
        maxTokens: 3333,
        contextLength: 4444,
        temperature: 0.9,
        vision: false,
        functionCall: false,
        reasoning: true,
        type: ModelType.Chat
      }

      modelConfigHelper.setModelConfig(modelId, provider1, config1)
      modelConfigHelper.setModelConfig(modelId, provider2, config2)

      // Verify configurations are isolated
      const retrievedConfig1 = modelConfigHelper.getModelConfig(modelId, provider1)
      const retrievedConfig2 = modelConfigHelper.getModelConfig(modelId, provider2)

      expect(retrievedConfig1).toMatchObject(config1)
      expect(retrievedConfig1.isUserDefined).toBe(true)
      expect(retrievedConfig2).toMatchObject(config2)
      expect(retrievedConfig2.isUserDefined).toBe(true)
      expect(retrievedConfig1.maxTokens).toBe(1111)
      expect(retrievedConfig2.maxTokens).toBe(3333)

      // Reset one should not affect the other
      modelConfigHelper.resetModelConfig(modelId, provider1)

      const configAfterReset1 = modelConfigHelper.getModelConfig(modelId, provider1)
      const configAfterReset2 = modelConfigHelper.getModelConfig(modelId, provider2)

      expect(configAfterReset1.maxTokens).not.toBe(1111) // Should be reset
      expect(configAfterReset2).toMatchObject(config2) // Should remain unchanged
      expect(configAfterReset2.isUserDefined).toBe(true)
    })
  })

  describe('Metadata synchronization and provider-managed configs', () => {
    const providerId = 'openai'
    const providerManagedModelId = 'gpt-5-mini'
    const userManagedModelId = 'custom-user-model'

    it('marks provider-managed configs as non-user entries', () => {
      const providerConfig: ModelConfig = {
        maxTokens: 64000,
        contextLength: 128000,
        temperature: 0.4,
        vision: false,
        functionCall: true,
        reasoning: false,
        type: ModelType.Chat
      }

      modelConfigHelper.setModelConfig(providerManagedModelId, providerId, providerConfig, {
        source: 'provider'
      })

      expect(modelConfigHelper.hasUserConfig(providerManagedModelId, providerId)).toBe(false)

      const storedConfig = modelConfigHelper.getModelConfig(providerManagedModelId, providerId)
      expect(storedConfig.isUserDefined).toBe(false)
      expect(storedConfig.maxTokens).toBe(32000)
    })

    it('keeps user configs but drops provider configs when defaults change', () => {
      const providerConfig: ModelConfig = {
        maxTokens: 4321,
        contextLength: 8765,
        temperature: 0.3,
        vision: false,
        functionCall: false,
        reasoning: false,
        type: ModelType.Chat
      }

      const userConfig: ModelConfig = {
        maxTokens: 9876,
        contextLength: 5432,
        temperature: 0.6,
        vision: true,
        functionCall: true,
        reasoning: true,
        type: ModelType.Chat
      }

      modelConfigHelper.setModelConfig(providerManagedModelId, providerId, providerConfig, {
        source: 'provider'
      })
      modelConfigHelper.setModelConfig(userManagedModelId, providerId, userConfig)

      const helperAny = modelConfigHelper as any
      const providerKey = helperAny.generateCacheKey(providerId, providerManagedModelId)
      const userKey = helperAny.generateCacheKey(providerId, userManagedModelId)

      const refreshedHelper = new ModelConfigHelper('2.0.0')

      expect(refreshedHelper.hasUserConfig(userManagedModelId, providerId)).toBe(true)
      expect(refreshedHelper.getModelConfig(userManagedModelId, providerId).maxTokens).toBe(
        userConfig.maxTokens
      )

      expect(refreshedHelper.hasUserConfig(providerManagedModelId, providerId)).toBe(false)

      const refreshedProviderConfig = refreshedHelper.getModelConfig(
        providerManagedModelId,
        providerId
      )
      expect(refreshedProviderConfig.maxTokens).not.toBe(providerConfig.maxTokens)
      expect(refreshedProviderConfig.isUserDefined).toBe(false)

      const refreshedStore = (refreshedHelper as any).modelConfigStore
      expect(refreshedStore.get(providerKey)).toBeUndefined()
      expect(refreshedStore.get(userKey)).toBeDefined()
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it.each([
      { label: 'empty model IDs', modelId: '', providerId: 'test-provider' },
      { label: 'missing provider IDs', modelId: 'test-model', providerId: undefined }
    ])('returns safe defaults for $label', ({ modelId, providerId }) => {
      expect(modelConfigHelper.getModelConfig(modelId, providerId)).toMatchObject({
        maxTokens: 4096,
        contextLength: 16000,
        temperature: 0.6,
        vision: false,
        functionCall: true,
        reasoning: false,
        type: ModelType.Chat,
        isUserDefined: false
      })
    })
  })

  describe('Interleaved Thinking Defaults', () => {
    it('derives interleaved thinking from the provider reasoning portrait', () => {
      const getDbSpy = vi.spyOn(providerDbLoader, 'getDb').mockReturnValue({
        providers: {
          moonshot: {
            id: 'moonshot',
            models: [
              {
                id: 'moonshotai/kimi-k2.5',
                tool_call: true,
                reasoning: { supported: true, default: true },
                extra_capabilities: {
                  reasoning: {
                    supported: true,
                    default_enabled: true,
                    mode: 'effort',
                    effort: 'medium',
                    effort_options: ['minimal', 'low', 'medium', 'high'],
                    verbosity: 'medium',
                    verbosity_options: ['low', 'medium', 'high'],
                    interleaved: true
                  }
                }
              }
            ]
          }
        }
      } as any)
      rebuildModelCapabilities()

      const config = modelConfigHelper.getModelConfig('moonshotai/kimi-k2.5', 'zenmux')

      expect(config.forceInterleavedThinkingCompat).toBe(true)
      expect(config.isUserDefined).toBe(false)

      getDbSpy.mockRestore()
    })

    it('keeps explicit user overrides for interleaved thinking', () => {
      modelConfigHelper.setModelConfig('moonshotai/kimi-k2.5', 'zenmux', {
        maxTokens: 8192,
        contextLength: 128000,
        temperature: 0.7,
        vision: false,
        functionCall: true,
        reasoning: true,
        forceInterleavedThinkingCompat: false,
        type: ModelType.Chat
      })

      const config = modelConfigHelper.getModelConfig('moonshotai/kimi-k2.5', 'zenmux')

      expect(config.forceInterleavedThinkingCompat).toBe(false)
      expect(config.isUserDefined).toBe(true)
    })

    it('derives anthropic reasoning visibility from provider portraits', () => {
      const getDbSpy = vi.spyOn(providerDbLoader, 'getDb').mockReturnValue({
        providers: {
          anthropic: {
            id: 'anthropic',
            models: [
              {
                id: 'claude-opus-4-7',
                tool_call: true,
                temperature: false,
                reasoning: { supported: true, default: false },
                extra_capabilities: {
                  reasoning: {
                    supported: true,
                    default_enabled: false,
                    mode: 'effort',
                    effort: 'high',
                    effort_options: ['low', 'medium', 'high', 'xhigh', 'max'],
                    visibility: 'omitted'
                  }
                }
              }
            ]
          }
        }
      } as any)
      rebuildModelCapabilities()

      const config = modelConfigHelper.getModelConfig('claude-opus-4-7', 'anthropic')

      expect(config.reasoning).toBe(false)
      expect(config.reasoningVisibility).toBe('omitted')
      expect(config.reasoningEffort).toBe('high')

      getDbSpy.mockRestore()
    })

    it('derives anthropic reasoning visibility for zenmux anthropic routes', () => {
      const getDbSpy = vi.spyOn(providerDbLoader, 'getDb').mockReturnValue({
        providers: {
          anthropic: {
            id: 'anthropic',
            models: [
              {
                id: 'claude-opus-4-7',
                tool_call: true,
                temperature: false,
                reasoning: { supported: true, default: false },
                extra_capabilities: {
                  reasoning: {
                    supported: true,
                    default_enabled: false,
                    mode: 'effort',
                    effort: 'high',
                    effort_options: ['low', 'medium', 'high', 'xhigh', 'max'],
                    visibility: 'omitted'
                  }
                }
              }
            ]
          }
        }
      } as any)
      rebuildModelCapabilities()

      const config = modelConfigHelper.getModelConfig('anthropic/claude-opus-4-7', 'zenmux')

      expect(config.reasoning).toBe(false)
      expect(config.reasoningVisibility).toBe('omitted')
      expect(config.reasoningEffort).toBe('high')

      getDbSpy.mockRestore()
    })

    it('preserves non-anthropic reasoning visibility values from provider portraits', () => {
      const getDbSpy = vi.spyOn(providerDbLoader, 'getDb').mockReturnValue({
        providers: {
          openai: {
            id: 'openai',
            models: [
              {
                id: 'gpt-5',
                tool_call: true,
                temperature: true,
                reasoning: { supported: true, default: true },
                extra_capabilities: {
                  reasoning: {
                    supported: true,
                    default_enabled: true,
                    mode: 'effort',
                    effort: 'medium',
                    effort_options: ['minimal', 'low', 'medium', 'high'],
                    visibility: 'hidden'
                  }
                }
              },
              {
                id: 'gpt-5-mini',
                tool_call: true,
                temperature: true,
                reasoning: { supported: true, default: true },
                extra_capabilities: {
                  reasoning: {
                    supported: true,
                    default_enabled: true,
                    mode: 'effort',
                    effort: 'medium',
                    effort_options: ['minimal', 'low', 'medium', 'high'],
                    visibility: 'summary'
                  }
                }
              }
            ]
          }
        }
      } as any)
      rebuildModelCapabilities()

      const hiddenConfig = modelConfigHelper.getModelConfig('gpt-5', 'openai')
      const summaryConfig = modelConfigHelper.getModelConfig('gpt-5-mini', 'openai')

      expect(hiddenConfig.reasoningVisibility).toBe('hidden')
      expect(summaryConfig.reasoningVisibility).toBe('summary')

      getDbSpy.mockRestore()
    })
  })
})
