import { ModelType } from '@shared/model'
import { IModelConfig, ModelConfig } from '@shared/presenter'
import ElectronStore from 'electron-store'
import { defaultModelsSettings } from './modelDefaultSettings'
import { getProviderSpecificModelConfig } from './providerModelSettings'

const SPECIAL_CONCAT_CHAR = '-_-'

export class ModelConfigHelper {
  private modelConfigStore: ElectronStore<Record<string, IModelConfig>>
  private memoryCache: Map<string, IModelConfig> = new Map()
  private cacheInitialized: boolean = false

  constructor() {
    this.modelConfigStore = new ElectronStore<Record<string, IModelConfig>>({
      name: 'model-config'
    })
  }

  /**
   * Initialize memory cache by loading all data from store
   * This is called lazily on first access
   */
  private initializeCache(): void {
    if (this.cacheInitialized) return

    const allConfigs = this.modelConfigStore.store
    Object.entries(allConfigs).forEach(([key, value]) => {
      this.memoryCache.set(key, value)
    })
    this.cacheInitialized = true
  }

  /**
   * Get model configuration with priority: user config > provider config > default config
   * @param modelId - The model ID
   * @param providerId - Optional provider ID
   * @returns ModelConfig
   */
  getModelConfig(modelId: string, providerId?: string): ModelConfig {
    // Initialize cache if not already done
    this.initializeCache()

    // 1. First try to get user-defined config for this specific provider + model
    if (providerId) {
      const cacheKey = providerId + SPECIAL_CONCAT_CHAR + modelId
      let userConfig = this.memoryCache.get(cacheKey)

      // If not in cache, try to load from store and cache it
      if (!userConfig) {
        userConfig = this.modelConfigStore.get(cacheKey)
        if (userConfig) {
          this.memoryCache.set(cacheKey, userConfig)
        }
      }

      if (userConfig?.config) {
        return userConfig.config
      }
    }

    // 2. Try to get provider-specific default config
    if (providerId) {
      const providerConfig = getProviderSpecificModelConfig(providerId, modelId)
      if (providerConfig) {
        return providerConfig
      }
    }

    // 3. Try to get default model config by pattern matching
    const lowerModelId = modelId.toLowerCase()
    for (const config of defaultModelsSettings) {
      if (config.match.some((matchStr) => lowerModelId.includes(matchStr.toLowerCase()))) {
        return {
          maxTokens: config.maxTokens,
          contextLength: config.contextLength,
          temperature: config.temperature,
          vision: config.vision,
          functionCall: config.functionCall || false,
          reasoning: config.reasoning || false,
          type: config.type || ModelType.Chat
        }
      }
    }

    // 4. Return safe default config if nothing matches
    return {
      maxTokens: 4096,
      contextLength: 8192,
      temperature: 0.6,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: ModelType.Chat
    }
  }

  /**
   * Set model configuration for a specific provider and model
   * @param modelId - The model ID
   * @param providerId - The provider ID
   * @param config - The model configuration
   */
  setModelConfig(modelId: string, providerId: string, config: ModelConfig): void {
    const cacheKey = providerId + SPECIAL_CONCAT_CHAR + modelId
    const configData: IModelConfig = {
      id: modelId,
      providerId: providerId,
      config: config
    }

    // Update both store and cache
    this.modelConfigStore.set(cacheKey, configData)
    this.memoryCache.set(cacheKey, configData)
  }

  /**
   * Reset model configuration for a specific provider and model
   * @param modelId - The model ID
   * @param providerId - The provider ID
   */
  resetModelConfig(modelId: string, providerId: string): void {
    const cacheKey = providerId + SPECIAL_CONCAT_CHAR + modelId

    // Remove from both store and cache
    this.modelConfigStore.delete(cacheKey)
    this.memoryCache.delete(cacheKey)
  }

  /**
   * Get all user-defined model configurations
   * @returns Record of all configurations
   */
  getAllModelConfigs(): Record<string, IModelConfig> {
    // Initialize cache if not already done
    this.initializeCache()

    // Return data from cache for better performance
    const result: Record<string, IModelConfig> = {}
    this.memoryCache.forEach((value, key) => {
      result[key] = value
    })
    return result
  }

  /**
   * Get configurations for a specific provider
   * @param providerId - The provider ID
   * @returns Array of model configurations
   */
  getProviderModelConfigs(providerId: string): Array<{ modelId: string; config: ModelConfig }> {
    const allConfigs = this.getAllModelConfigs()
    const result: Array<{ modelId: string; config: ModelConfig }> = []

    Object.entries(allConfigs).forEach(([key, value]) => {
      const [keyProviderId] = key.split(SPECIAL_CONCAT_CHAR)
      if (keyProviderId === providerId) {
        result.push({
          modelId: value.id,
          config: value.config
        })
      }
    })

    return result
  }

  /**
   * Check if a model has user-defined configuration
   * @param modelId - The model ID
   * @param providerId - The provider ID
   * @returns boolean
   */
  hasUserConfig(modelId: string, providerId: string): boolean {
    // Initialize cache if not already done
    this.initializeCache()

    const cacheKey = providerId + SPECIAL_CONCAT_CHAR + modelId

    // Check cache first
    if (this.memoryCache.has(cacheKey)) {
      return true
    }

    // If not in cache, check store and update cache if found
    const userConfig = this.modelConfigStore.get(cacheKey)
    if (userConfig) {
      this.memoryCache.set(cacheKey, userConfig)
      return true
    }

    return false
  }

  /**
   * Import model configurations (used for sync restore)
   * @param configs - Model configurations to import
   * @param overwrite - Whether to overwrite existing configurations
   */
  importConfigs(configs: Record<string, IModelConfig>, overwrite: boolean = false): void {
    if (overwrite) {
      // Clear existing configs from both store and cache
      this.modelConfigStore.clear()
      this.memoryCache.clear()
    }

    // Import configs to both store and cache
    Object.entries(configs).forEach(([key, value]) => {
      if (overwrite || !this.modelConfigStore.has(key)) {
        this.modelConfigStore.set(key, value)
        this.memoryCache.set(key, value)
      }
    })

    this.cacheInitialized = true
  }

  /**
   * Export all model configurations for backup
   * @returns Object containing all configurations
   */
  exportConfigs(): Record<string, IModelConfig> {
    return this.getAllModelConfigs()
  }

  /**
   * Clear all configurations
   */
  clearAllConfigs(): void {
    this.modelConfigStore.clear()
    this.memoryCache.clear()
  }

  /**
   * Get store path for sync backup
   * @returns Store file path
   */
  getStorePath(): string {
    return this.modelConfigStore.path
  }

  /**
   * Clear memory cache (useful for testing or memory management)
   */
  clearMemoryCache(): void {
    this.memoryCache.clear()
    this.cacheInitialized = false
  }
}
