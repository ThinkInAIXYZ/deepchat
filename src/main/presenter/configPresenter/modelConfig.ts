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
   * Generate a safe cache key by escaping special characters that could cause JSON parsing issues
   * @param providerId - The provider ID
   * @param modelId - The model ID
   * @returns Safe cache key string
   */
  private generateCacheKey(providerId: string, modelId: string): string {
    // Replace dots and other problematic characters that could interfere with electron-store's key parsing
    const sanitizeString = (str: string): string => {
      return str
        .replace(/\./g, '_DOT_') // Replace dots with _DOT_
        .replace(/\[/g, '_LBRACKET_') // Replace [ with _LBRACKET_
        .replace(/\]/g, '_RBRACKET_') // Replace ] with _RBRACKET_
        .replace(/"/g, '_QUOTE_') // Replace " with _QUOTE_
        .replace(/'/g, '_SQUOTE_') // Replace ' with _SQUOTE_
    }

    const sanitizedProviderId = sanitizeString(providerId)
    const sanitizedModelId = sanitizeString(modelId)

    return sanitizedProviderId + SPECIAL_CONCAT_CHAR + sanitizedModelId
  }

  /**
   * Reverse the sanitization process to get original IDs from cache key
   * @param sanitizedString - The sanitized string
   * @returns Original string with special characters restored
   */
  private desanitizeString(sanitizedString: string): string {
    return sanitizedString
      .replace(/_DOT_/g, '.')
      .replace(/_LBRACKET_/g, '[')
      .replace(/_RBRACKET_/g, ']')
      .replace(/_QUOTE_/g, '"')
      .replace(/_SQUOTE_/g, "'")
  }

  /**
   * Parse cache key to extract original provider ID and model ID
   * @param cacheKey - The cache key to parse
   * @returns Object with providerId and modelId
   */
  private parseCacheKey(cacheKey: string): { providerId: string; modelId: string } {
    const [sanitizedProviderId, sanitizedModelId] = cacheKey.split(SPECIAL_CONCAT_CHAR)
    return {
      providerId: this.desanitizeString(sanitizedProviderId),
      modelId: this.desanitizeString(sanitizedModelId)
    }
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
   * @returns ModelConfig with isUserDefined flag
   */
  getModelConfig(modelId: string, providerId?: string): ModelConfig {
    // Initialize cache if not already done
    this.initializeCache()

    let hasUserConfig = false
    let userConfig: ModelConfig | null = null

    // 1. First try to get user-defined config for this specific provider + model
    if (providerId) {
      const cacheKey = this.generateCacheKey(providerId, modelId)
      let userConfigData = this.memoryCache.get(cacheKey)

      // If not in cache, try to load from store and cache it
      if (!userConfigData) {
        userConfigData = this.modelConfigStore.get(cacheKey)
        if (userConfigData) {
          this.memoryCache.set(cacheKey, userConfigData)
        }
      }

      if (userConfigData?.config) {
        hasUserConfig = true
        userConfig = userConfigData.config
      }
    }

    let finalConfig: ModelConfig

    if (hasUserConfig && userConfig) {
      // Use user config as base
      finalConfig = { ...userConfig }
    } else {
      // 2. Try to get provider-specific default config
      let providerConfig: ModelConfig | null = null
      if (providerId) {
        providerConfig = getProviderSpecificModelConfig(providerId, modelId) || null
      }

      if (providerConfig) {
        finalConfig = { ...providerConfig }
      } else {
        // 3. Try to get default model config by pattern matching
        const lowerModelId = modelId.toLowerCase()
        let defaultConfig: ModelConfig | null = null

        for (const config of defaultModelsSettings) {
          if (config.match.some((matchStr) => lowerModelId.includes(matchStr.toLowerCase()))) {
            defaultConfig = {
              maxTokens: config.maxTokens,
              contextLength: config.contextLength,
              temperature: config.temperature,
              vision: config.vision,
              functionCall: config.functionCall || false,
              reasoning: config.reasoning || false,
              type: config.type || ModelType.Chat,
              thinkingBudget: config.thinkingBudget,
              enableSearch: config.enableSearch || false,
              forcedSearch: config.forcedSearch || false,
              searchStrategy: config.searchStrategy || 'turbo',
              reasoningEffort: config.reasoningEffort,
              verbosity: config.verbosity,
              maxCompletionTokens: config.maxCompletionTokens
            }
            break
          }
        }

        if (defaultConfig) {
          finalConfig = defaultConfig
        } else {
          // 4. Return safe default config if nothing matches
          finalConfig = {
            maxTokens: 4096,
            contextLength: 8192,
            temperature: 0.6,
            vision: false,
            functionCall: false,
            reasoning: false,
            type: ModelType.Chat,
            thinkingBudget: undefined,
            enableSearch: false,
            forcedSearch: false,
            searchStrategy: 'turbo',
            reasoningEffort: undefined,
            verbosity: undefined,
            maxCompletionTokens: undefined
          }
        }
      }
    }

    // Add source information to the config
    finalConfig.isUserDefined = hasUserConfig

    return finalConfig
  }

  /**
   * Set model configuration for a specific provider and model
   * @param modelId - The model ID
   * @param providerId - The provider ID
   * @param config - The model configuration
   */
  setModelConfig(modelId: string, providerId: string, config: ModelConfig): void {
    const cacheKey = this.generateCacheKey(providerId, modelId)
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
    const cacheKey = this.generateCacheKey(providerId, modelId)

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
      const { providerId: keyProviderId, modelId: keyModelId } = this.parseCacheKey(key)
      if (keyProviderId === providerId) {
        result.push({
          modelId: keyModelId,
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

    const cacheKey = this.generateCacheKey(providerId, modelId)

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
