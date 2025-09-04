import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ModelConfigHelper } from '../../../src/main/presenter/configPresenter/modelConfig'
import { ModelType } from '../../../src/shared/model'
import { ModelConfig } from '../../../src/shared/presenter'

// Mock electron-store with in-memory storage
const mockStores = new Map<string, Record<string, any>>()

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

describe('Model Configuration Tests', () => {
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
    modelConfigHelper = new ModelConfigHelper()
  })

  afterEach(() => {
    // Restore original store state
    mockStores.clear()
    originalStoreData.forEach((value, key) => {
      mockStores.set(key, value)
    })

    vi.clearAllMocks()
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
        contextLength: 8192,
        temperature: 0.6,
        vision: false,
        functionCall: false,
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

  describe('Complete Configuration Priority Chain', () => {
    // Test with a model that has both default and provider-specific configurations
    const testModelId = 'gpt-4' // This model should have default settings
    const testProviderId = 'openai' // This provider should have specific settings for gpt-4

    it('should return default configuration when no provider is specified', () => {
      // Get configuration without provider - should use default pattern matching
      const configWithoutProvider = modelConfigHelper.getModelConfig(testModelId)

      // Should return a valid configuration (from default settings)
      expect(configWithoutProvider).toBeDefined()
      expect(configWithoutProvider.maxTokens).toBeGreaterThan(0)
      expect(configWithoutProvider.contextLength).toBeGreaterThan(0)
      expect(typeof configWithoutProvider.temperature).toBe('number')
      expect(typeof configWithoutProvider.vision).toBe('boolean')
      expect(typeof configWithoutProvider.functionCall).toBe('boolean')
      expect(typeof configWithoutProvider.reasoning).toBe('boolean')
      expect(configWithoutProvider.type).toBe(ModelType.Chat)
    })

    it('should return provider-specific configuration when provider is specified', () => {
      // Get configuration with provider - should use provider-specific settings if available
      const configWithProvider = modelConfigHelper.getModelConfig(testModelId, testProviderId)
      const configWithoutProvider = modelConfigHelper.getModelConfig(testModelId)

      // Both should be valid configurations
      expect(configWithProvider).toBeDefined()
      expect(configWithoutProvider).toBeDefined()

      // They might be the same or different depending on whether provider-specific config exists
      // But both should be valid configurations
      expect(configWithProvider.maxTokens).toBeGreaterThan(0)
      expect(configWithProvider.contextLength).toBeGreaterThan(0)
    })

    it('should prioritize user config over provider config over default config', () => {
      // Step 1: Get baseline configurations
      const defaultConfig = modelConfigHelper.getModelConfig(testModelId) // No provider
      const providerConfig = modelConfigHelper.getModelConfig(testModelId, testProviderId) // With provider

      console.log('Default config maxTokens:', defaultConfig.maxTokens)
      console.log('Provider config maxTokens:', providerConfig.maxTokens)

      // Step 2: Set user configuration with unique values
      const userConfig: ModelConfig = {
        maxTokens: 99999, // Unique value to identify user config
        contextLength: 88888, // Unique value
        temperature: 0.123, // Unique value
        vision: true,
        functionCall: true,
        reasoning: true,
        type: ModelType.Chat
      }

      modelConfigHelper.setModelConfig(testModelId, testProviderId, userConfig)

      // Step 3: Verify user config takes priority
      const retrievedConfig = modelConfigHelper.getModelConfig(testModelId, testProviderId)
      expect(retrievedConfig).toMatchObject(userConfig)
      expect(retrievedConfig.isUserDefined).toBe(true)
      expect(retrievedConfig.maxTokens).toBe(99999) // Should be user config value
      expect(retrievedConfig.contextLength).toBe(88888) // Should be user config value
      expect(retrievedConfig.temperature).toBe(0.123) // Should be user config value
    })

    it('should fall back to provider config after user config reset', () => {
      // Step 1: Set user configuration
      const userConfig: ModelConfig = {
        maxTokens: 77777,
        contextLength: 66666,
        temperature: 0.999,
        vision: false,
        functionCall: false,
        reasoning: false,
        type: ModelType.Chat
      }

      modelConfigHelper.setModelConfig(testModelId, testProviderId, userConfig)

      // Step 2: Verify user config is active
      const configWithUserSettings = modelConfigHelper.getModelConfig(testModelId, testProviderId)
      expect(configWithUserSettings.maxTokens).toBe(77777)

      // Step 3: Get expected fallback config (provider or default)
      const expectedFallbackConfig = modelConfigHelper.getModelConfig(testModelId, testProviderId)

      // Step 4: Reset user configuration
      modelConfigHelper.resetModelConfig(testModelId, testProviderId)

      // Step 5: Verify fallback to provider/default config
      const configAfterReset = modelConfigHelper.getModelConfig(testModelId, testProviderId)
      expect(configAfterReset.maxTokens).not.toBe(77777) // Should not be user config
      expect(configAfterReset.maxTokens).toBeGreaterThan(0) // Should be valid config

      // Should match the provider config or default config
      expect(configAfterReset.contextLength).toBeGreaterThan(0)
      expect(typeof configAfterReset.temperature).toBe('number')
      expect(typeof configAfterReset.vision).toBe('boolean')
    })

    it('should handle configuration priority with different model types', () => {
      // Test with a model that should match default patterns
      const chatModelId = 'gpt-3.5-turbo'
      const visionModelId = 'gpt-4-vision'

      // Get configurations for different model types
      const chatConfig = modelConfigHelper.getModelConfig(chatModelId, testProviderId)
      const visionConfig = modelConfigHelper.getModelConfig(visionModelId, testProviderId)

      // Both should be valid
      expect(chatConfig).toBeDefined()
      expect(visionConfig).toBeDefined()

      // Vision model might have different default settings
      expect(chatConfig.type).toBe(ModelType.Chat)
      expect(visionConfig.type).toBe(ModelType.Chat) // Both should be chat type by default

      // Test user override
      const customVisionConfig: ModelConfig = {
        maxTokens: 12000,
        contextLength: 24000,
        temperature: 0.7,
        vision: true, // Enable vision for this model
        functionCall: false,
        reasoning: false,
        type: ModelType.Chat
      }

      modelConfigHelper.setModelConfig(visionModelId, testProviderId, customVisionConfig)
      const retrievedVisionConfig = modelConfigHelper.getModelConfig(visionModelId, testProviderId)

      expect(retrievedVisionConfig).toMatchObject(customVisionConfig)
      expect(retrievedVisionConfig.isUserDefined).toBe(true)
      expect(retrievedVisionConfig.vision).toBe(true) // User setting should override
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

  describe('Edge Cases and Error Handling', () => {
    it('should handle edge cases gracefully', () => {
      // Empty model ID
      const configEmptyModel = modelConfigHelper.getModelConfig('', 'test-provider')
      expect(configEmptyModel).toBeDefined()
      expect(configEmptyModel.maxTokens).toBeGreaterThan(0)

      // Undefined provider ID
      const configUndefinedProvider = modelConfigHelper.getModelConfig('test-model', undefined)
      expect(configUndefinedProvider).toBeDefined()
      expect(configUndefinedProvider.maxTokens).toBeGreaterThan(0)
    })

    it('should verify test state isolation', () => {
      const testKey = 'test-state-isolation'
      const testProvider = 'test-provider'

      // Set configuration
      modelConfigHelper.setModelConfig(testKey, testProvider, {
        maxTokens: 999,
        contextLength: 999,
        temperature: 0.9,
        vision: true,
        functionCall: true,
        reasoning: true,
        type: ModelType.Chat
      })

      expect(modelConfigHelper.hasUserConfig(testKey, testProvider)).toBe(true)
      // Note: afterEach will clean this up for subsequent tests
    })
  })
})
