import {
  ApiEndpointType,
  ModelType,
  isNewApiEndpointType,
  resolveProviderCapabilityProviderId
} from '@shared/model'
import { IModelConfig, ModelConfig, ModelConfigSource } from '@shared/presenter'
import {
  DEFAULT_MODEL_TIMEOUT,
  DEFAULT_MODEL_CAPABILITY_FALLBACKS,
  resolveDerivedModelMaxTokens,
  resolveModelContextLength,
  resolveModelFunctionCall
} from '@shared/modelConfigDefaults'
import { applyMoonshotKimiReasoningTemperaturePolicy } from '@shared/moonshotKimiPolicy'
import { resolveVideoGenerationCompatType } from '@shared/videoGenerationSettings'
import ElectronStore from 'electron-store'
import { providerDbLoader } from './providerDbLoader'
import {
  hasAnthropicReasoningToggle,
  isImageInputSupported,
  normalizeAnthropicReasoningVisibilityValue,
  normalizeReasoningEffortValue,
  normalizeReasoningVisibilityValue,
  ProviderModel,
  ReasoningPortrait,
  isVerbosity,
  type Verbosity
} from '@shared/types/model-db'
import { resolveProviderId } from './providerId'
import { modelCapabilities } from './modelCapabilities'
import type { StoreLike } from './storeLike'

const SPECIAL_CONCAT_CHAR = '-_-'

const MODEL_CONFIG_META_KEY = '__meta__'
const MINIMAX_M3_CONTEXT_LENGTH = 1_000_000

const normalizeProviderDbModelId = (modelId: string | undefined): string | undefined => {
  const normalized = modelId ? modelId.toLowerCase() : modelId
  return normalized ? normalized.replace(/^models\//, '') : normalized
}

const isMiniMaxProviderId = (providerId: string | undefined): boolean => {
  const normalized = providerId?.trim().toLowerCase()
  return normalized === 'minimax' || normalized === 'minimax-cn'
}

const isMiniMaxM3Model = (providerId: string | undefined, modelId: string): boolean =>
  isMiniMaxProviderId(providerId) && modelId.trim().toLowerCase() === 'minimax-m3'

const normalizeVerbosityValue = (
  portrait: ReasoningPortrait | null,
  value: unknown
): Verbosity | undefined => {
  if (!isVerbosity(value)) {
    return undefined
  }

  const options = portrait?.verbosityOptions?.filter(isVerbosity)
  if (!options || options.length === 0) {
    return value
  }

  if (options.includes(value)) {
    return value
  }

  return isVerbosity(portrait?.verbosity) && options.includes(portrait.verbosity)
    ? portrait.verbosity
    : undefined
}

interface ModelConfigStoreMeta {
  lastRefreshVersion?: string
  userConfigKeys: string[]
}

type ModelConfigStoreSchema = Record<string, IModelConfig | ModelConfigStoreMeta>

export class ModelConfigHelper {
  private modelConfigStore: StoreLike<ModelConfigStoreSchema>
  private memoryCache: Map<string, IModelConfig> = new Map()
  private cacheInitialized: boolean = false
  private currentVersion: string

  constructor(appVersion: string = '0.0.0') {
    this.modelConfigStore = new ElectronStore<ModelConfigStoreSchema>({
      name: 'model-config'
    })
    this.currentVersion = appVersion
    this.ensureStoreSynced()
  }

  setStore(store: StoreLike<ModelConfigStoreSchema>): void {
    this.modelConfigStore = store
    this.memoryCache.clear()
    this.cacheInitialized = false
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
    return resolveProviderId(providerId)
  }

  /**
   * Infer model type from provider model data
   * Priority: 1. modalities.output includes image 2. model.type (from provider.json) 3. default Chat
   */
  private inferModelType(model: ProviderModel): ModelType {
    const videoGenerationType = resolveVideoGenerationCompatType({
      modelId: model.id,
      type: model.type,
      modalities: model.modalities
    })
    if (videoGenerationType) {
      return videoGenerationType
    }

    // Priority 1: Output modality indicates image generation
    if (Array.isArray(model.modalities?.output) && model.modalities.output.includes('image')) {
      return ModelType.ImageGeneration
    }

    // Priority 2: Use type from provider.json if present and valid
    if (model.type) {
      switch (model.type) {
        case 'chat':
          return ModelType.Chat
        case 'embedding':
          return ModelType.Embedding
        case 'rerank':
          return ModelType.Rerank
        case 'imageGeneration':
          return ModelType.ImageGeneration
        case 'videoGeneration':
          return ModelType.VideoGeneration
        case 'tts':
          return ModelType.TTS
        default:
          // Invalid type, fall through to default
          break
      }
    }

    // Priority 3: Default to Chat
    return ModelType.Chat
  }

  private applyProviderSpecificPolicies(
    providerId: string | undefined,
    modelId: string,
    config: ModelConfig
  ): ModelConfig {
    if (!providerId) {
      return config
    }

    const policyConfig = applyMoonshotKimiReasoningTemperaturePolicy(providerId, modelId, config)

    if (!isMiniMaxM3Model(providerId, modelId)) {
      return policyConfig
    }

    return {
      ...policyConfig,
      contextLength: Math.max(policyConfig.contextLength ?? 0, MINIMAX_M3_CONTEXT_LENGTH),
      forceInterleavedThinkingCompat: true
    }
  }

  private buildConfigFromProviderModel(model: ProviderModel, providerId: string): ModelConfig {
    const modelType = this.inferModelType(model)
    const portrait = modelCapabilities.getReasoningPortrait(providerId, model.id)
    const capabilityProviderId = resolveProviderCapabilityProviderId(providerId, null, model.id)
    const reasoningEnabled =
      portrait?.defaultEnabled ?? model.reasoning?.default ?? portrait?.supported ?? false
    const thinkingBudget =
      portrait?.budget?.default ?? model.reasoning?.budget?.default ?? undefined
    const forceInterleavedThinkingCompat = portrait?.interleaved === true ? true : undefined
    const reasoningEffort = normalizeReasoningEffortValue(
      portrait,
      portrait?.effort ?? model.reasoning?.effort
    )
    const reasoningVisibility = hasAnthropicReasoningToggle(capabilityProviderId, portrait)
      ? (normalizeAnthropicReasoningVisibilityValue(portrait?.visibility) ??
        normalizeReasoningVisibilityValue(portrait?.visibility))
      : normalizeReasoningVisibilityValue(portrait?.visibility)
    const verbosity = normalizeVerbosityValue(
      portrait,
      portrait?.verbosity ?? model.reasoning?.verbosity
    )
    const contextLimit = isMiniMaxM3Model(providerId, model.id)
      ? Math.max(model.limit?.context ?? 0, MINIMAX_M3_CONTEXT_LENGTH)
      : model.limit?.context

    return this.applyProviderSpecificPolicies(providerId, model.id, {
      maxTokens: resolveDerivedModelMaxTokens(model.limit?.output),
      contextLength: resolveModelContextLength(contextLimit),
      timeout: DEFAULT_MODEL_TIMEOUT,
      temperature: 0.6,
      topP: undefined,
      vision: isImageInputSupported(model),
      speechRecognition: false,
      functionCall: resolveModelFunctionCall(model.tool_call),
      reasoning: Boolean(reasoningEnabled),
      type: modelType,
      apiEndpoint:
        modelType === ModelType.ImageGeneration
          ? ApiEndpointType.Image
          : modelType === ModelType.VideoGeneration
            ? ApiEndpointType.Video
            : modelType === ModelType.TTS
              ? ApiEndpointType.AudioSpeech
              : ApiEndpointType.Chat,
      thinkingBudget,
      forceInterleavedThinkingCompat: isMiniMaxM3Model(providerId, model.id)
        ? true
        : forceInterleavedThinkingCompat,
      reasoningEffort,
      reasoningVisibility,
      verbosity,
      enableSearch: Boolean(model.search?.supported ?? false),
      forcedSearch: Boolean(model.search?.forced_search ?? false),
      searchStrategy: (model.search?.search_strategy ?? 'turbo') as
        | 'turbo'
        | 'balanced'
        | 'precise',
      maxCompletionTokens: undefined
    })
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
      const finalUserConfig = this.applyProviderSpecificPolicies(providerId, modelId, {
        ...storedConfig
      })
      finalUserConfig.isUserDefined = true
      return finalUserConfig
    }

    let finalConfig: ModelConfig | null = null

    // 严格匹配：仅当提供 providerId 时从 Provider DB 查找
    const db = providerDbLoader.getDb()
    const providers = db?.providers
    const resolvedProviderId = normProviderId ? this.resolveProviderId(normProviderId) : undefined
    const providerEntry = resolvedProviderId ? providers?.[resolvedProviderId] : undefined
    const providerFound = Boolean(providerEntry)

    if (
      normProviderId &&
      resolvedProviderId &&
      providerEntry &&
      Array.isArray(providerEntry.models)
    ) {
      for (let i = 0; i < providerEntry.models.length; i += 1) {
        const candidate = providerEntry.models[i]
        if (candidate && normalizeProviderDbModelId(candidate.id) === normModelId) {
          finalConfig = this.buildConfigFromProviderModel(candidate, resolvedProviderId)
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
          if (candidateModel && normalizeProviderDbModelId(candidateModel.id) === normModelId) {
            finalConfig = this.buildConfigFromProviderModel(candidateModel, candidateProvider.id)
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
        ...DEFAULT_MODEL_CAPABILITY_FALLBACKS,
        timeout: DEFAULT_MODEL_TIMEOUT,
        temperature: 0.6,
        topP: undefined,
        type: ModelType.Chat,
        apiEndpoint: ApiEndpointType.Chat,
        endpointType: undefined,
        thinkingBudget: undefined,
        forceInterleavedThinkingCompat: undefined,
        reasoningEffort: undefined,
        verbosity: undefined,
        enableSearch: false,
        forcedSearch: false,
        searchStrategy: 'turbo',
        maxCompletionTokens: undefined,
        ownedBy: undefined
      }
    }

    if (storedConfig && storedSource && storedSource !== 'user') {
      finalConfig = {
        ...finalConfig,
        maxTokens:
          storedConfig.maxTokens !== undefined
            ? resolveDerivedModelMaxTokens(storedConfig.maxTokens)
            : finalConfig.maxTokens,
        contextLength: storedConfig.contextLength ?? finalConfig.contextLength,
        timeout: storedConfig.timeout ?? finalConfig.timeout,
        temperature: storedConfig.temperature ?? finalConfig.temperature,
        topP: storedConfig.topP ?? finalConfig.topP,
        vision: storedConfig.vision ?? finalConfig.vision,
        speechRecognition: storedConfig.speechRecognition ?? finalConfig.speechRecognition,
        functionCall: storedConfig.functionCall ?? finalConfig.functionCall,
        type: storedConfig.type ?? finalConfig.type,
        maxCompletionTokens: storedConfig.maxCompletionTokens ?? finalConfig.maxCompletionTokens,
        conversationId: storedConfig.conversationId ?? finalConfig.conversationId,
        apiEndpoint: storedConfig.apiEndpoint ?? finalConfig.apiEndpoint,
        endpointType: isNewApiEndpointType(storedConfig.endpointType)
          ? storedConfig.endpointType
          : finalConfig.endpointType,
        ownedBy: storedConfig.ownedBy ?? finalConfig.ownedBy,
        enableSearch: storedConfig.enableSearch ?? finalConfig.enableSearch,
        forcedSearch: storedConfig.forcedSearch ?? finalConfig.forcedSearch,
        searchStrategy: storedConfig.searchStrategy ?? finalConfig.searchStrategy,
        reasoning: finalConfig.reasoning,
        thinkingBudget: finalConfig.thinkingBudget,
        forceInterleavedThinkingCompat: finalConfig.forceInterleavedThinkingCompat,
        reasoningEffort: finalConfig.reasoningEffort,
        verbosity: finalConfig.verbosity
      }
    }

    const normalizedFinalConfig = this.applyProviderSpecificPolicies(providerId, modelId, {
      ...finalConfig!,
      isUserDefined: false
    })
    normalizedFinalConfig.isUserDefined = false
    return normalizedFinalConfig
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
    const normalizedMaxTokens =
      source === 'provider'
        ? resolveDerivedModelMaxTokens(config.maxTokens)
        : (config.maxTokens ?? undefined)
    const normalizedTimeout =
      typeof config.timeout === 'number' && Number.isFinite(config.timeout) && config.timeout > 0
        ? Math.round(config.timeout)
        : undefined
    const storedConfig: ModelConfig = this.applyProviderSpecificPolicies(providerId, modelId, {
      ...config,
      ...(normalizedMaxTokens !== undefined ? { maxTokens: normalizedMaxTokens } : {}),
      ...(normalizedTimeout !== undefined ? { timeout: normalizedTimeout } : {}),
      isUserDefined: source === 'user'
    })
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
      this.clearStore()
      this.memoryCache.clear()
      this.cacheInitialized = false
    }

    const meta = this.getOrCreateMeta()
    const userKeySet = overwrite ? new Set<string>() : new Set<string>(meta.userConfigKeys || [])

    Object.entries(configs).forEach(([key, value]) => {
      if (this.isMetaKey(key) || !value) return

      if (!overwrite && this.hasStoreEntry(key)) {
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
    this.clearStore()
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
    return this.modelConfigStore.path ?? ''
  }

  /**
   * Clear memory cache (useful for testing or memory management)
   */
  clearMemoryCache(): void {
    this.memoryCache.clear()
    this.cacheInitialized = false
  }

  private hasStoreEntry(key: string): boolean {
    if (typeof this.modelConfigStore.has === 'function') {
      return this.modelConfigStore.has(key)
    }
    return this.modelConfigStore.get(key) !== undefined
  }

  private clearStore(): void {
    if (typeof this.modelConfigStore.clear === 'function') {
      this.modelConfigStore.clear()
      return
    }

    Object.keys(this.modelConfigStore.store).forEach((key) => {
      this.modelConfigStore.delete(key)
    })
  }
}
