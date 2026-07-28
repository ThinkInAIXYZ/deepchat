import { ApiEndpointType, ModelType } from '@shared/model'
import type {
  IModelConfig,
  MODEL_META,
  ModelConfig,
  ModelRouteConfig
} from '@shared/types/provider'
import {
  DEFAULT_MODEL_TIMEOUT,
  DEFAULT_MODEL_CAPABILITY_FALLBACKS,
  resolveDerivedModelMaxTokens,
  resolveModelContextLength,
  resolveModelFunctionCall
} from '@shared/modelConfigDefaults'
import { applyMoonshotKimiReasoningTemperaturePolicy } from '@shared/modelRequestPolicy'
import { resolveVideoGenerationCompatType } from '@shared/videoGenerationSettings'
import ElectronStore from 'electron-store'
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
import { modelCapabilities, type CapabilityModelMatch } from './modelCapabilities'
import type { StoreLike } from '@/config/storeLike'
import { resolveCapabilityIdentity } from './capabilityIdentity'
import type { ResolvedCapabilityIdentity } from '@shared/types/model-capabilities'
import { normalizeUserModelConfigEntry } from './userModelConfig'

const SPECIAL_CONCAT_CHAR = '-_-'

const MINIMAX_M3_CONTEXT_LENGTH = 1_000_000
const ANTHROPIC_FALLBACK_CONTEXT_LENGTH = 200_000
const ANTHROPIC_FALLBACK_MAX_TOKENS = 64_000
const ACP_FALLBACK_CONTEXT_LENGTH = 8192
const ACP_FALLBACK_MAX_TOKENS = 4096

type ModelCapabilityFallbacks = {
  contextLength: number
  maxTokens: number
  vision: boolean
  speechRecognition: boolean
  functionCall: boolean
  reasoning: boolean
}

const definedConfigFields = (config: ModelConfig | undefined): Partial<ModelConfig> =>
  config
    ? Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined))
    : {}

const isMiniMaxProviderId = (providerId: string | undefined): boolean => {
  const normalized = providerId?.trim().toLowerCase()
  return normalized === 'minimax' || normalized === 'minimax-cn'
}

const isMiniMaxM3Model = (providerId: string | undefined, modelId: string): boolean =>
  isMiniMaxProviderId(providerId) && modelId.trim().toLowerCase() === 'minimax-m3'

const normalizeProviderKind = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? ''

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

export class ModelConfigHelper {
  private modelConfigStore: StoreLike<Record<string, unknown>>
  private memoryCache: Map<string, IModelConfig> = new Map()
  private cacheInitialized: boolean = false

  constructor(
    store: StoreLike<Record<string, unknown>> = new ElectronStore<Record<string, unknown>>({
      name: 'model-config'
    })
  ) {
    this.modelConfigStore = store
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

  private resolveCapabilityFallbacks(
    providerId: string | undefined,
    capabilityProviderId: string | undefined,
    resolvedIdentity: ResolvedCapabilityIdentity | undefined,
    providerApiType: string | undefined
  ): ModelCapabilityFallbacks {
    const providerKinds = [
      normalizeProviderKind(providerId),
      normalizeProviderKind(capabilityProviderId),
      normalizeProviderKind(resolvedIdentity?.providerId),
      normalizeProviderKind(providerApiType)
    ]

    if (providerKinds.includes('acp')) {
      return {
        ...DEFAULT_MODEL_CAPABILITY_FALLBACKS,
        contextLength: ACP_FALLBACK_CONTEXT_LENGTH,
        maxTokens: ACP_FALLBACK_MAX_TOKENS
      }
    }

    if (
      providerKinds.includes('anthropic') ||
      providerKinds.includes('aws-bedrock') ||
      providerKinds.includes('amazon-bedrock')
    ) {
      return {
        ...DEFAULT_MODEL_CAPABILITY_FALLBACKS,
        contextLength: ANTHROPIC_FALLBACK_CONTEXT_LENGTH,
        maxTokens: resolveDerivedModelMaxTokens(ANTHROPIC_FALLBACK_MAX_TOKENS)
      }
    }

    return DEFAULT_MODEL_CAPABILITY_FALLBACKS
  }

  private buildConfigFromProviderModel(match: CapabilityModelMatch): ModelConfig {
    const { model, modelId, providerId } = match
    const modelType = this.inferModelType(model)
    const portrait = modelCapabilities.getCatalogCapabilitySnapshot(
      providerId,
      modelId
    ).reasoningPortrait
    const reasoningEnabled =
      portrait?.defaultEnabled ?? model.reasoning?.default ?? portrait?.supported ?? false
    const thinkingBudget =
      portrait?.budget?.default ?? model.reasoning?.budget?.default ?? undefined
    const forceInterleavedThinkingCompat = portrait?.interleaved === true ? true : undefined
    const reasoningEffort = normalizeReasoningEffortValue(
      portrait,
      portrait?.effort ?? model.reasoning?.effort
    )
    const reasoningVisibility = hasAnthropicReasoningToggle(providerId, portrait)
      ? (normalizeAnthropicReasoningVisibilityValue(portrait?.visibility) ??
        normalizeReasoningVisibilityValue(portrait?.visibility))
      : normalizeReasoningVisibilityValue(portrait?.visibility)
    const verbosity = normalizeVerbosityValue(
      portrait,
      portrait?.verbosity ?? model.reasoning?.verbosity
    )
    return {
      maxTokens: resolveDerivedModelMaxTokens(model.limit?.output),
      contextLength: resolveModelContextLength(model.limit?.context),
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
      forceInterleavedThinkingCompat,
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
    }
  }

  private applyProviderFacts(config: ModelConfig, facts?: MODEL_META): ModelConfig {
    if (!facts) {
      return config
    }

    const contextLength =
      typeof facts.contextLength === 'number' &&
      Number.isFinite(facts.contextLength) &&
      facts.contextLength > 0
        ? Math.round(facts.contextLength)
        : config.contextLength
    const maxTokens =
      typeof facts.maxTokens === 'number' && Number.isFinite(facts.maxTokens) && facts.maxTokens > 0
        ? resolveDerivedModelMaxTokens(facts.maxTokens)
        : config.maxTokens
    const type =
      resolveVideoGenerationCompatType({
        modelId: facts.id,
        type: facts.type ?? config.type,
        apiEndpoint: config.apiEndpoint,
        endpointType: facts.endpointType ?? config.endpointType,
        supportedEndpointTypes: facts.supportedEndpointTypes
      }) ??
      facts.type ??
      config.type
    const endpointType = facts.endpointType ?? config.endpointType
    const apiEndpoint =
      endpointType === 'image-generation' || type === ModelType.ImageGeneration
        ? ApiEndpointType.Image
        : endpointType === 'video-generation' || type === ModelType.VideoGeneration
          ? ApiEndpointType.Video
          : type === ModelType.TTS
            ? ApiEndpointType.AudioSpeech
            : facts.type !== undefined
              ? ApiEndpointType.Chat
              : config.apiEndpoint

    return {
      ...config,
      contextLength,
      maxTokens,
      vision: typeof facts.vision === 'boolean' ? facts.vision : config.vision,
      functionCall:
        typeof facts.functionCall === 'boolean' ? facts.functionCall : config.functionCall,
      reasoning: typeof facts.reasoning === 'boolean' ? facts.reasoning : config.reasoning,
      type,
      apiEndpoint,
      endpointType,
      ownedBy: typeof facts.ownedBy === 'string' ? facts.ownedBy : config.ownedBy,
      enableSearch:
        typeof facts.enableSearch === 'boolean' ? facts.enableSearch : config.enableSearch
    }
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
      const entry = normalizeUserModelConfigEntry(value)
      if (entry) {
        this.memoryCache.set(key, entry)
      }
    })
    this.cacheInitialized = true
  }

  private getStoredConfigEntry(modelId: string, providerId?: string): IModelConfig | undefined {
    if (!providerId) {
      return undefined
    }

    const normalizedModelId = modelId.toLowerCase().replace(/^models\//, '')
    const normalizedProviderId = providerId.toLowerCase()
    const originalCacheKey = this.generateCacheKey(providerId, modelId)
    const originalEntry = this.memoryCache.get(originalCacheKey)
    if (originalEntry?.config) {
      return originalEntry
    }

    const normalizedCacheKey = this.generateCacheKey(normalizedProviderId, normalizedModelId)
    if (normalizedCacheKey !== originalCacheKey) {
      const normalizedEntry = this.memoryCache.get(normalizedCacheKey)
      if (normalizedEntry?.config) {
        return normalizedEntry
      }
    }

    return undefined
  }

  getModelRouteConfig(modelId: string, providerId?: string): ModelRouteConfig {
    this.initializeCache()
    const entry = this.getStoredConfigEntry(modelId, providerId)
    const config = entry?.config
    if (!config) {
      return {}
    }

    return {
      apiEndpoint: config.apiEndpoint,
      endpointType: config.endpointType,
      ownedBy: config.ownedBy,
      type: config.type,
      isUserDefined: true
    }
  }

  /**
   * Resolve model configuration from safe defaults, catalog data, provider facts, and user intent.
   */
  getModelConfig(
    modelId: string,
    providerId?: string,
    capabilityProviderId?: string,
    resolvedIdentity?: ResolvedCapabilityIdentity,
    providerFacts?: MODEL_META,
    providerApiType?: string
  ): ModelConfig {
    this.initializeCache()

    // 统一小写用于 DB 严格匹配；用户配置读取先原样，再尝试小写键
    const normModelIdRaw = modelId ? modelId.toLowerCase() : modelId
    // 兼容 Google Gemini SDK 返回的 `models/` 前缀模型ID
    const normModelId = normModelIdRaw ? normModelIdRaw.replace(/^models\//, '') : normModelIdRaw
    const normProviderId = providerId ? providerId.toLowerCase() : providerId

    const cachedEntry = this.getStoredConfigEntry(modelId, providerId)
    const userConfig = cachedEntry?.config

    let capabilityIdentity = resolvedIdentity
    if (!capabilityIdentity && normProviderId && normModelId) {
      if (!capabilityProviderId && modelCapabilities.hasProvider(normProviderId)) {
        const providerMatch = modelCapabilities.getProviderCapabilityModelMatch(
          normProviderId,
          modelId
        )
        capabilityIdentity = providerMatch
          ? {
              providerId: providerMatch.providerId,
              requestModelId: modelId,
              catalogMatched: true,
              catalogModelId: providerMatch.modelId
            }
          : {
              providerId: modelCapabilities.resolveProviderId(normProviderId) ?? normProviderId,
              requestModelId: modelId,
              catalogMatched: false,
              catalogModelId: null
            }
      } else {
        capabilityIdentity = resolveCapabilityIdentity({
          providerId: normProviderId,
          modelId,
          explicitProviderId: capabilityProviderId
        })
      }
    }
    let finalConfig: ModelConfig | null = null

    if (capabilityIdentity?.catalogMatched) {
      const match: CapabilityModelMatch | undefined =
        modelCapabilities.getProviderCapabilityModelMatch(
          capabilityIdentity.providerId,
          capabilityIdentity.catalogModelId
        )
      if (match) {
        finalConfig = this.buildConfigFromProviderModel(match)
      }
    }

    if (!finalConfig) {
      finalConfig = {
        ...this.resolveCapabilityFallbacks(
          normProviderId,
          capabilityProviderId,
          capabilityIdentity,
          providerApiType
        ),
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

    const normalizedFinalConfig = this.applyProviderSpecificPolicies(providerId, modelId, {
      ...this.applyProviderFacts(finalConfig, providerFacts),
      ...definedConfigFields(userConfig),
      isUserDefined: Boolean(userConfig)
    })
    return normalizedFinalConfig
  }

  /**
   * Set model configuration for a specific provider and model
   * @param modelId - The model ID
   * @param providerId - The provider ID
   * @param config - The model configuration
   */
  setModelConfig(modelId: string, providerId: string, config: ModelConfig): ModelConfig {
    const cacheKey = this.generateCacheKey(providerId, modelId)
    const normalizedTimeout =
      typeof config.timeout === 'number' && Number.isFinite(config.timeout) && config.timeout > 0
        ? Math.round(config.timeout)
        : undefined
    const storedConfig: ModelConfig = this.applyProviderSpecificPolicies(providerId, modelId, {
      ...config,
      ...(normalizedTimeout !== undefined ? { timeout: normalizedTimeout } : {}),
      isUserDefined: true
    })
    const configData: IModelConfig = {
      id: modelId,
      providerId: providerId,
      config: storedConfig,
      source: 'user'
    }

    // Update both store and cache
    this.modelConfigStore.set(cacheKey, configData)
    this.memoryCache.set(cacheKey, configData)

    return storedConfig
  }

  /**
   * Reset model configuration for a specific provider and model
   * @param modelId - The model ID
   * @param providerId - The provider ID
   */
  resetModelConfig(modelId: string, providerId: string): void {
    const cacheKeys = new Set([
      this.generateCacheKey(providerId, modelId),
      this.generateCacheKey(
        providerId.toLowerCase(),
        modelId.toLowerCase().replace(/^models\//, '')
      )
    ])

    // Remove from both store and cache
    for (const cacheKey of cacheKeys) {
      this.modelConfigStore.delete(cacheKey)
      this.memoryCache.delete(cacheKey)
    }
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
    this.initializeCache()
    return Boolean(this.getStoredConfigEntry(modelId, providerId))
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

    Object.entries(configs).forEach(([key, value]) => {
      const entry = normalizeUserModelConfigEntry(value)
      if (!entry) return

      if (!overwrite && normalizeUserModelConfigEntry(this.modelConfigStore.get(key))) {
        return
      }

      this.modelConfigStore.set(key, entry)
      this.memoryCache.set(key, entry)
    })

    this.cacheInitialized = false
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
