import { ModelType } from '@shared/model'
import { IModelConfig, ModelConfig, ModelConfigSource } from '@shared/presenter'
import ElectronStore from 'electron-store'
import { providerDbLoader } from './providerDbLoader'
import { isImageInputSupported, ProviderModel } from '@shared/types/model-db'

const SPECIAL_CONCAT_CHAR = '-_-'

const MODEL_CONFIG_META_KEY = '__meta__'

interface ModelConfigStoreMeta {
  lastRefreshVersion?: string
  userConfigKeys: string[]
}

type ModelConfigStoreSchema = Record<string, IModelConfig | ModelConfigStoreMeta>

export class ModelConfigHelper {
  private modelConfigStore: ElectronStore<ModelConfigStoreSchema>
  private memoryCache: Map<string, IModelConfig> = new Map()
  private cacheInitialized: boolean = false
  private currentVersion: string
  private static readonly PROVIDER_ID_ALIASES: Record<string, string> = {
    dashscope: 'alibaba-cn',
    gemini: 'google'
  }

  constructor(appVersion: string = '0.0.0') {
    this.modelConfigStore = new ElectronStore<ModelConfigStoreSchema>({
      name: 'model-config'
    })
    this.currentVersion = appVersion
    this.ensureStoreSynced()
  }

  private ensureStoreSynced(): void {
    const meta = this.getStoreMeta()
    if (!meta) {
      this.initializeMetaFromLegacyStore()
      return
    }

    if (meta.lastRefreshVersion !== this.currentVersion) {
      this.refreshDerivedConfigs(meta)
    }
  }

  private resolveProviderId(providerId: string | undefined): string | undefined {
    if (!providerId) return undefined
    const alias = ModelConfigHelper.PROVIDER_ID_ALIASES[providerId]
    return alias || providerId
  }

  private buildConfigFromProviderModel(model: ProviderModel): ModelConfig {
    return {
      maxTokens: model.limit?.output ?? 4096,
      contextLength: model.limit?.context ?? 8192,
      temperature: 0.6,
      vision: isImageInputSupported(model),
      functionCall: model.tool_call ?? false,
      reasoning: Boolean(model.reasoning?.supported ?? false),
      type: ModelType.Chat,
      thinkingBudget: model.reasoning?.budget?.default ?? undefined,
      enableSearch: Boolean(model.search?.supported ?? false),
      forcedSearch: Boolean(model.search?.forced_search),
      searchStrategy: model.search?.search_strategy === 'max' ? 'max' : 'turbo',
      reasoningEffort: (model.reasoning?.effort ?? undefined) as
        | 'minimal'
        | 'low'
        | 'medium'
        | 'high'
        | undefined,
      verbosity: (model.reasoning?.verbosity ?? undefined) as 'low' | 'medium' | 'high' | undefined,
      maxCompletionTokens: undefined
    }
  }

  private initializeMetaFromLegacyStore(): void {
    const legacyEntries = this.modelConfigStore.store
    const userKeys: Set<string> = new Set()

    Object.entries(legacyEntries).forEach(([key, value]) => {
      if (this.isMetaKey(key)) {
        return
      }

      const entry = value as IModelConfig | undefined
      if (entry && this.isEntryUserDefined(entry)) {
        userKeys.add(key)
        const updatedEntry: IModelConfig = {
          ...entry,
          source: 'user',
          config: {
            ...entry.config,
            isUserDefined: true
          }
        }
        this.modelConfigStore.set(key, updatedEntry)
      } else {
        this.modelConfigStore.delete(key)
      }
    })

    this.memoryCache.clear()
    this.cacheInitialized = false

    this.updateStoreMeta({
      lastRefreshVersion: this.currentVersion,
      userConfigKeys: Array.from(userKeys)
    })
  }

  private refreshDerivedConfigs(meta: ModelConfigStoreMeta): void {
    const userKeySet = new Set(meta.userConfigKeys || [])

    Object.keys(this.modelConfigStore.store).forEach((key) => {
      if (this.isMetaKey(key)) {
        return
      }

      if (userKeySet.has(key)) {
        return
      }

      this.modelConfigStore.delete(key)
      this.memoryCache.delete(key)
    })

    this.cacheInitialized = false

    this.updateStoreMeta({
      lastRefreshVersion: this.currentVersion,
      userConfigKeys: Array.from(userKeySet)
    })
  }

  private getStoreMeta(): ModelConfigStoreMeta | undefined {
    const meta = this.modelConfigStore.get(MODEL_CONFIG_META_KEY)
    return meta as ModelConfigStoreMeta | undefined
  }

  private updateStoreMeta(meta: ModelConfigStoreMeta): void {
    this.modelConfigStore.set(MODEL_CONFIG_META_KEY, meta)
  }

  private getOrCreateMeta(): ModelConfigStoreMeta {
    let meta = this.getStoreMeta()
    if (!meta) {
      this.initializeMetaFromLegacyStore()
      meta = this.getStoreMeta()
    }
    if (!meta) {
      meta = {
        lastRefreshVersion: this.currentVersion,
        userConfigKeys: []
      }
      this.updateStoreMeta(meta)
    }
    return meta
  }

  private isMetaKey(key: string): boolean {
    return key === MODEL_CONFIG_META_KEY
  }

  private isEntryUserDefined(entry: IModelConfig | undefined): boolean {
    if (!entry) return false
    if (entry.source) {
      return entry.source === 'user'
    }
    return entry.config?.isUserDefined === true
  }

  private updateUserConfigKeys(cacheKey: string, source: ModelConfigSource): void {
    const meta = this.getOrCreateMeta()
    const userKeys = new Set(meta.userConfigKeys || [])

    if (source === 'user') {
      userKeys.add(cacheKey)
    } else {
      userKeys.delete(cacheKey)
    }

    this.updateStoreMeta({
      lastRefreshVersion: this.currentVersion,
      userConfigKeys: Array.from(userKeys)
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
      if (this.isMetaKey(key) || !value) return
      this.memoryCache.set(key, value as IModelConfig)
    })
    this.cacheInitialized = true
  }

  /**
   * 获取模型配置（优先级：用户自定义 > 远端缓存/本地内置 Provider DB 严格匹配 > 默认兜底）
   * 严格匹配要求 providerId 与 modelId 全等；不再做模糊匹配。
   */
  getModelConfig(modelId: string, providerId?: string): ModelConfig {
    this.initializeCache()

    let storedConfig: ModelConfig | null = null
    let storedSource: ModelConfigSource | undefined

    // 统一小写用于 DB 严格匹配；用户配置读取先原样，再尝试小写键
    const normModelIdRaw = modelId ? modelId.toLowerCase() : modelId
    // 兼容 Google Gemini SDK 返回的 `models/` 前缀模型ID
    const normModelId = normModelIdRaw ? normModelIdRaw.replace(/^models\//, '') : normModelIdRaw
    const normProviderId = providerId ? providerId.toLowerCase() : providerId

    if (providerId) {
      const cacheKey = this.generateCacheKey(providerId, modelId)
      const cachedEntry = this.memoryCache.has(cacheKey)
        ? (this.memoryCache.get(cacheKey) as IModelConfig | undefined)
        : undefined

      if (cachedEntry?.config) {
        storedConfig = cachedEntry.config
        storedSource = cachedEntry.source ?? (cachedEntry.config.isUserDefined ? 'user' : undefined)
      } else if (normProviderId && normModelId) {
        // 二次尝试：小写键（兼容历史大小写不一致的存储键）
        const normKey = this.generateCacheKey(normProviderId, normModelId)
        const normCached = this.memoryCache.has(normKey)
          ? (this.memoryCache.get(normKey) as IModelConfig | undefined)
          : undefined
        if (normCached?.config) {
          storedConfig = normCached.config
          storedSource = normCached.source ?? (normCached.config.isUserDefined ? 'user' : undefined)
        }
      }
    }

    const isUserConfig = storedSource === 'user'

    if (storedConfig && isUserConfig) {
      const finalUserConfig = { ...storedConfig }
      finalUserConfig.isUserDefined = true
      return finalUserConfig
    }

    if (storedConfig && storedSource) {
      const finalStoredConfig = { ...storedConfig }
      finalStoredConfig.isUserDefined = false
      return finalStoredConfig
    }

    let finalConfig: ModelConfig | null = null

    // 严格匹配：仅当提供 providerId 时从 Provider DB 查找
    const db = providerDbLoader.getDb()
    const providers = db?.providers
    const resolvedProviderId = normProviderId ? this.resolveProviderId(normProviderId) : undefined
    const providerEntry = resolvedProviderId ? providers?.[resolvedProviderId] : undefined
    const providerFound = Boolean(providerEntry)

    if (normProviderId && providerEntry && Array.isArray(providerEntry.models)) {
      for (let i = 0; i < providerEntry.models.length; i += 1) {
        const candidate = providerEntry.models[i]
        if (candidate && candidate.id === normModelId) {
          finalConfig = this.buildConfigFromProviderModel(candidate)
          break
        }
      }
    }

    if (!finalConfig && normProviderId && !providerFound && providers && normModelId) {
      for (const key in providers) {
        if (!Object.prototype.hasOwnProperty.call(providers, key)) continue
        const candidateProvider = providers[key]
        if (!candidateProvider || !Array.isArray(candidateProvider.models)) {
          continue
        }

        for (let j = 0; j < candidateProvider.models.length; j += 1) {
          const candidateModel = candidateProvider.models[j]
          if (candidateModel && candidateModel.id === normModelId) {
            finalConfig = this.buildConfigFromProviderModel(candidateModel)
            break
          }
        }

        if (finalConfig) {
          break
        }
      }
    }

    if (!finalConfig) {
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

    finalConfig.isUserDefined = false
    return finalConfig
  }

  /**
   * Set model configuration for a specific provider and model
   * @param modelId - The model ID
   * @param providerId - The provider ID
   * @param config - The model configuration
   */
  setModelConfig(
    modelId: string,
    providerId: string,
    config: ModelConfig,
    options?: { source?: ModelConfigSource }
  ): ModelConfig {
    const cacheKey = this.generateCacheKey(providerId, modelId)
    const source: ModelConfigSource = options?.source ?? 'user'
    const storedConfig: ModelConfig = {
      ...config,
      isUserDefined: source === 'user'
    }
    const configData: IModelConfig = {
      id: modelId,
      providerId: providerId,
      config: storedConfig,
      source
    }

    // Update both store and cache
    this.modelConfigStore.set(cacheKey, configData)
    this.memoryCache.set(cacheKey, configData)
    this.updateUserConfigKeys(cacheKey, source)

    return storedConfig
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
    this.updateUserConfigKeys(cacheKey, 'provider')
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
      if (this.isMetaKey(key)) return
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
    const cachedEntry = this.memoryCache.get(cacheKey)
    if (cachedEntry) {
      const source = cachedEntry.source ?? (cachedEntry.config.isUserDefined ? 'user' : undefined)
      if (source === 'user') {
        return true
      }
    }

    // If not in cache, check store and update cache if found
    const storeEntry = this.modelConfigStore.get(cacheKey) as IModelConfig | undefined
    if (storeEntry) {
      this.memoryCache.set(cacheKey, storeEntry)
      const source = storeEntry.source ?? (storeEntry.config.isUserDefined ? 'user' : undefined)
      return source === 'user'
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
      this.cacheInitialized = false
    }

    const meta = this.getOrCreateMeta()
    const userKeySet = overwrite ? new Set<string>() : new Set<string>(meta.userConfigKeys || [])

    Object.entries(configs).forEach(([key, value]) => {
      if (this.isMetaKey(key) || !value) return

      if (!overwrite && this.modelConfigStore.has(key)) {
        return
      }

      const entry = value as IModelConfig
      const source = entry.source ?? (entry.config?.isUserDefined ? 'user' : 'provider')
      const storedEntry: IModelConfig = {
        ...entry,
        source,
        config: {
          ...entry.config,
          isUserDefined: source === 'user'
        }
      }

      this.modelConfigStore.set(key, storedEntry)
      this.memoryCache.set(key, storedEntry)

      if (source === 'user') {
        userKeySet.add(key)
      } else {
        userKeySet.delete(key)
      }
    })

    this.cacheInitialized = false
    this.updateStoreMeta({
      lastRefreshVersion: this.currentVersion,
      userConfigKeys: Array.from(userKeySet)
    })
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
    this.cacheInitialized = false
    this.updateStoreMeta({
      lastRefreshVersion: this.currentVersion,
      userConfigKeys: []
    })
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
