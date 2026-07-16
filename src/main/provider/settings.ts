import type { SystemPrompt } from '@shared/types/prompt'
import type {
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  ModelConfigSource,
  RENDERER_MODEL_META,
  IModelConfig
} from '@shared/types/provider'
import { ProviderBatchUpdate } from '@shared/provider-operations'
import {
  ModelType,
  isNewApiEndpointType,
  resolveProviderCapabilityProviderId,
  type NewApiEndpointType
} from '@shared/model'
import { resolveVideoGenerationCompatType } from '@shared/videoGenerationSettings'
import {
  resolveDerivedModelMaxTokens,
  resolveModelContextLength,
  resolveModelFunctionCall,
  resolveModelVision
} from '@shared/modelConfigDefaults'
import { DEFAULT_PROVIDERS } from '@/provider/defaults'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import { compare } from 'compare-versions'
import { ModelConfigHelper } from '@/provider/modelConfig'
import { providerDbLoader, type ProviderDbRefreshResult } from '@/provider/providerDbLoader'
import {
  ProviderAggregate,
  ReasoningPortrait,
  type ProviderModel,
  type ReasoningEffort,
  type Verbosity
} from '@shared/types/model-db'
import { modelCapabilities } from '@/provider/modelCapabilities'
import { ProviderHelper } from '@/provider/providerHelper'
import { ModelStatusHelper } from '@/provider/modelStatusHelper'
import { ProviderModelHelper, PROVIDER_MODELS_DIR } from '@/provider/providerModelHelper'
import { DEFAULT_SYSTEM_PROMPT } from '@/agent/promptSettings'
import type { ProviderDatabase } from './data/database'
import type { SettingsKey, SettingsSnapshotValues } from '@shared/contracts/routes'
import type { DeepchatEventPayload, DeepchatEventPublisher } from '@shared/contracts/events'
import {
  emitModelConfigChanged,
  emitModelConfigReset,
  emitModelConfigsImported,
  emitModelsChanged
} from '@/provider/eventPublishers'
import { ModelConfigDbStore, ProviderDbStore, ProviderModelDbStore } from './settingsDbStores'
import { SettingsStore } from '@/config/settingsStore'
import type { StoreLike } from '@/config/storeLike'
import type { PrivacySettingsPort } from '@/app/privacy'

// Create interface for model storage
const defaultProviders = DEFAULT_PROVIDERS.map((provider) => ({
  id: provider.id,
  name: provider.name,
  apiType: provider.apiType,
  apiKey: provider.apiKey,
  baseUrl: provider.baseUrl,
  enable: provider.enable,
  websites: provider.websites,
  models: provider.models ?? [],
  customModels: provider.customModels ?? [],
  enabledModels: provider.enabledModels ?? [],
  disabledModels: provider.disabledModels ?? []
}))

const PROVIDERS_STORE_KEY = 'providers'
const DEPRECATED_BUILTIN_PROVIDER_IDS = ['qwenlm', 'laoshi'] as const
const VOICE_AI_DEFAULTS = {
  audioFormat: 'mp3',
  model: 'voiceai-tts-v1-latest',
  language: 'en',
  temperature: 1,
  topP: 0.8,
  agentId: ''
} as const
type AnthropicLegacyProvider = LLM_PROVIDER & { authMode?: 'apikey' | 'oauth' }
type ModelSelection = { providerId: string; modelId: string }
type ProviderModelSettingKey =
  | 'defaultModel'
  | 'assistantModel'
  | 'defaultVisionModel'
  | 'preferredModel'
type AnthropicModelSettingKey = 'defaultModel' | 'assistantModel' | 'defaultVisionModel'

const ANTHROPIC_MODEL_SETTING_KEYS: AnthropicModelSettingKey[] = [
  'defaultModel',
  'assistantModel',
  'defaultVisionModel'
]
const DEPRECATED_PROVIDER_MODEL_SETTING_KEYS: ProviderModelSettingKey[] = [
  'defaultModel',
  'assistantModel',
  'defaultVisionModel',
  'preferredModel'
]
const hasLegacyAnthropicOAuthState = (provider: AnthropicLegacyProvider): boolean =>
  Object.prototype.hasOwnProperty.call(provider, 'authMode') || provider.oauthToken !== undefined

const hasAnthropicApiCredential = (
  provider: AnthropicLegacyProvider,
  envApiKey = process.env.ANTHROPIC_API_KEY
): boolean => Boolean(provider.apiKey?.trim() || envApiKey?.trim())

const isModelSelection = (value: unknown): value is ModelSelection => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.providerId === 'string' && typeof record.modelId === 'string'
}

const normalizeKnownModelId = (modelId: string): string => {
  const normalizedModelId = modelId.trim().toLowerCase()
  return normalizedModelId.replace(/^models\//, '')
}

const normalizeKnownProviderId = (providerId: string): string =>
  modelCapabilities.resolveProviderId(providerId.trim().toLowerCase()) ||
  providerId.trim().toLowerCase()

const toTrackedSettingsChangePayload = (
  key: string,
  value: unknown
): { changedKey: SettingsKey; value: SettingsSnapshotValues[SettingsKey] } | null => {
  switch (key) {
    case 'fontFamily':
      return {
        changedKey: 'fontFamily',
        value: typeof value === 'string' ? value : ''
      }
    case 'codeFontFamily':
      return {
        changedKey: 'codeFontFamily',
        value: typeof value === 'string' ? value : ''
      }
    case 'contentProtectionEnabled':
      return {
        changedKey: 'contentProtectionEnabled',
        value: Boolean(value)
      }
    case 'notificationsEnabled':
      return {
        changedKey: 'notificationsEnabled',
        value: Boolean(value)
      }
    default:
      return null
  }
}

export const getAnthropicModelSelectionKeysToClear = (
  settings: Partial<
    Record<
      AnthropicModelSettingKey | 'preferredModel',
      { providerId: string; modelId: string } | undefined
    >
  >
): AnthropicModelSettingKey[] =>
  ANTHROPIC_MODEL_SETTING_KEYS.filter((key) => {
    const selection = settings[key]
    return isModelSelection(selection) && selection.providerId === 'anthropic'
  })

export const removeDeprecatedBuiltinProviders = (
  providers: LLM_PROVIDER[],
  deprecatedProviderIds: readonly string[] = DEPRECATED_BUILTIN_PROVIDER_IDS
): LLM_PROVIDER[] => {
  const deprecatedProviderIdSet = new Set(deprecatedProviderIds)
  return providers.filter((provider) => !deprecatedProviderIdSet.has(provider.id))
}

export const getDeprecatedProviderModelSelectionKeysToClear = (
  settings: Partial<
    Record<ProviderModelSettingKey, { providerId: string; modelId: string } | undefined>
  >,
  deprecatedProviderIds: readonly string[] = DEPRECATED_BUILTIN_PROVIDER_IDS
): ProviderModelSettingKey[] => {
  const deprecatedProviderIdSet = new Set(deprecatedProviderIds)

  return DEPRECATED_PROVIDER_MODEL_SETTING_KEYS.filter((key) => {
    const selection = settings[key]
    return isModelSelection(selection) && deprecatedProviderIdSet.has(selection.providerId)
  })
}

export const normalizeAnthropicProviderForApiOnly = (
  provider: AnthropicLegacyProvider,
  fallbackBaseUrl = 'https://api.anthropic.com',
  envApiKey = process.env.ANTHROPIC_API_KEY
): LLM_PROVIDER => {
  if (provider.id !== 'anthropic') {
    return provider
  }

  const shouldDisable =
    hasLegacyAnthropicOAuthState(provider) && !hasAnthropicApiCredential(provider, envApiKey)

  const normalized: AnthropicLegacyProvider = {
    ...provider,
    baseUrl: provider.baseUrl || fallbackBaseUrl,
    enable: shouldDisable ? false : provider.enable
  }

  delete normalized.authMode
  delete normalized.oauthToken

  return normalized
}

export interface ProviderSettingsPort {
  getProviders(): LLM_PROVIDER[]
  setProviders(providers: LLM_PROVIDER[]): void
  cleanupLegacyProviderJsonForDatabaseEncryption(): number
  getProviderById(id: string): LLM_PROVIDER | undefined
  setProviderById(id: string, provider: LLM_PROVIDER): void
  getProviderModels(providerId: string): MODEL_META[]
  getDbProviderModels(providerId: string): RENDERER_MODEL_META[]
  getCapabilityProviderId(providerId: string, modelId: string): string
  supportsReasoningCapability(providerId: string, modelId: string): boolean
  getReasoningPortrait(providerId: string, modelId: string): ReasoningPortrait | null
  getThinkingBudgetRange(
    providerId: string,
    modelId: string
  ): { min?: number; max?: number; default?: number }
  getTemperatureCapability(providerId: string, modelId: string): boolean | undefined
  supportsTemperatureControl(providerId: string, modelId: string): boolean
  supportsSearchCapability(providerId: string, modelId: string): boolean
  getSearchDefaults(
    providerId: string,
    modelId: string
  ): { default?: boolean; forced?: boolean; strategy?: 'turbo' | 'max' }
  supportsAudioInputCapability(providerId: string, modelId: string): boolean
  supportsReasoningEffortCapability(providerId: string, modelId: string): boolean
  getReasoningEffortDefault(providerId: string, modelId: string): ReasoningEffort | undefined
  supportsVerbosityCapability(providerId: string, modelId: string): boolean
  getVerbosityDefault(providerId: string, modelId: string): Verbosity | undefined
  setProviderModels(providerId: string, models: MODEL_META[]): void
  getEnabledProviders(): LLM_PROVIDER[]
  getAllEnabledModels(): Promise<{ providerId: string; models: RENDERER_MODEL_META[] }[]>
  getCustomModels(providerId: string): MODEL_META[]
  setCustomModels(providerId: string, models: MODEL_META[]): void
  addCustomModel(providerId: string, model: MODEL_META): void
  removeCustomModel(providerId: string, modelId: string): void
  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void
  getModelStatus(providerId: string, modelId: string): boolean
  setModelStatus(providerId: string, modelId: string, enabled: boolean): void
  ensureModelStatus(providerId: string, modelId: string, enabled: boolean): void
  batchSetModelStatus(providerId: string, modelStatusMap: Record<string, boolean>): void
  batchSetModelStatusQuiet(providerId: string, modelStatusMap: Record<string, boolean>): void
  getBatchModelStatus(providerId: string, modelIds: string[]): Record<string, boolean>
  getDefaultProviders(): LLM_PROVIDER[]
  isKnownModel(providerId: string, modelId: string): boolean
  getModelConfig(modelId: string, providerId?: string): ModelConfig
  setModelConfig(
    modelId: string,
    providerId: string,
    config: ModelConfig,
    options?: { source?: ModelConfigSource }
  ): void
  resetModelConfig(modelId: string, providerId: string): void
  getAllModelConfigs(): Record<string, IModelConfig>
  getProviderModelConfigs(providerId: string): Array<{ modelId: string; config: ModelConfig }>
  hasUserModelConfig(modelId: string, providerId: string): boolean
  exportModelConfigs(): Record<string, IModelConfig>
  importModelConfigs(configs: Record<string, IModelConfig>, overwrite: boolean): void
  getProviderDb(): { providers: Record<string, unknown> } | null
  refreshProviderDb(force?: boolean): Promise<ProviderDbRefreshResult>
  notifyModelsChanged(providerId?: string): void
  getVoiceAiConfig(): {
    audioFormat: string
    model: string
    language: string
    temperature: number
    topP: number
    agentId: string
  }
  setVoiceAiConfig(
    updates: Partial<ReturnType<ProviderSettingsPort['getVoiceAiConfig']>>
  ): ReturnType<ProviderSettingsPort['getVoiceAiConfig']>
  getAzureApiVersion(): string | undefined
  setAzureApiVersion(version: string): void
  getGeminiSafety(key: string): string
  setGeminiSafety(key: string, value: string): void
  getAwsBedrockCredential(): unknown
  setAwsBedrockCredential(credential: unknown): void
  updateProviderAtomic(id: string, updates: Partial<LLM_PROVIDER>): boolean
  addProviderAtomic(provider: LLM_PROVIDER): void
  removeProviderAtomic(providerId: string): void
  reorderProvidersAtomic(providers: LLM_PROVIDER[]): void
  updateProvidersBatch(batchUpdate: ProviderBatchUpdate): void
}

export type ProviderModelResolutionPort = Pick<
  ProviderSettingsPort,
  | 'getProviderById'
  | 'isKnownModel'
  | 'getModelConfig'
  | 'getCapabilityProviderId'
  | 'supportsReasoningCapability'
  | 'getReasoningPortrait'
  | 'getThinkingBudgetRange'
  | 'supportsAudioInputCapability'
  | 'supportsReasoningEffortCapability'
  | 'getReasoningEffortDefault'
  | 'supportsVerbosityCapability'
  | 'getVerbosityDefault'
>

export class ProviderSettings implements ProviderSettingsPort {
  private userDataPath: string
  private currentAppVersion: string
  private modelConfigHelper: ModelConfigHelper // Model configuration helper
  private providerHelper: ProviderHelper
  private modelStatusHelper: ModelStatusHelper
  private providerModelHelper: ProviderModelHelper
  private readonly appSettings: SettingsStore
  private readonly store: StoreLike<Record<string, unknown>>

  constructor(
    settings: SettingsStore,
    private readonly privacy: PrivacySettingsPort,
    database: ProviderDatabase,
    private readonly publishEvent: DeepchatEventPublisher,
    previousAppVersion?: string
  ) {
    this.appSettings = settings
    this.store = new ProviderDbStore(settings, () => database.settingsTable)
    this.userDataPath = app.getPath('userData')
    this.currentAppVersion = app.getVersion()
    this.providerHelper = new ProviderHelper({
      store: this.store,
      setSetting: this.setSetting.bind(this),
      defaultProviders,
      publishEvent: this.publishEvent
    })

    this.modelStatusHelper = new ModelStatusHelper({
      store: this.store,
      setSetting: this.setSetting.bind(this),
      publishEvent: this.publishEvent
    })

    // Initialize model configuration helper
    this.modelConfigHelper = new ModelConfigHelper(
      this.currentAppVersion,
      new ModelConfigDbStore(() => database.settingsTable) as unknown as ConstructorParameters<
        typeof ModelConfigHelper
      >[1]
    )

    this.providerModelHelper = new ProviderModelHelper({
      userDataPath: this.userDataPath,
      getModelConfig: (modelId: string, providerId?: string) =>
        this.getModelConfig(modelId, providerId),
      setModelStatus: this.modelStatusHelper.setModelStatus.bind(this.modelStatusHelper),
      deleteModelStatus: this.modelStatusHelper.deleteModelStatus.bind(this.modelStatusHelper),
      publishEvent: this.publishEvent
    })
    this.providerModelHelper.setStoreFactory(
      (providerId) => new ProviderModelDbStore(providerId, () => database.settingsTable)
    )
    this.providerHelper.setCleanupHooks({
      deleteProviderModelStatuses: this.modelStatusHelper.deleteProviderModelStatuses.bind(
        this.modelStatusHelper
      ),
      clearProviderModelStore: this.providerModelHelper.clearProviderModelStore.bind(
        this.providerModelHelper
      )
    })

    // Initialize built-in ACP agents on first run or version upgrade
    // Initialize provider models directory
    this.initProviderModelsDir()

    // 初始化 Provider DB（外部聚合 JSON，本地内置为兜底）
    providerDbLoader.subscribeCatalogChanges((change) => {
      const reason = change.reason === 'loaded' ? 'provider-db-loaded' : 'provider-db-updated'
      this.publishEvent('providers.changed', { reason, version: Date.now() })
      this.publishEvent('models.changed', { reason, version: Date.now() })
    })
    providerDbLoader.setPrivacyModeResolver(() => this.privacy.isEnabled())
    providerDbLoader.initialize().catch((error) => {
      console.warn('[ProviderSettings] Failed to initialize provider DB:', error)
    })

    if (previousAppVersion !== this.currentAppVersion) {
      this.migrateConfigData(previousAppVersion)
    }

    // Migrate minimax provider from OpenAI format to Anthropic format
    this.migrateMinimaxProvider()
    this.migrateAnthropicProviderToApiOnly()
    this.cleanupDeprecatedBuiltinProviders()

    const existingProviders = this.getSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY) || []
    const newProviders = defaultProviders.filter(
      (defaultProvider) =>
        !existingProviders.some((existingProvider) => existingProvider.id === defaultProvider.id)
    )

    if (newProviders.length > 0) {
      this.setProviders([...existingProviders, ...newProviders])
    }
  }

  cleanupLegacyProviderJsonForDatabaseEncryption(): number {
    if (!this.appSettings.isDatabaseAttached) {
      return 0
    }

    const legacyProviders = this.appSettings.getLegacy(PROVIDERS_STORE_KEY)
    if (!Array.isArray(legacyProviders) || legacyProviders.length === 0) {
      return 0
    }

    this.appSettings.deleteLegacy(PROVIDERS_STORE_KEY)
    console.info('[Config] Removed legacy providers from app-settings JSON after SQLite migration')
    return legacyProviders.length
  }

  private initProviderModelsDir(): void {
    const modelsDir = path.join(this.userDataPath, PROVIDER_MODELS_DIR)
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true })
    }
  }

  // 提供聚合 Provider DB（只读）给渲染层/其他模块
  getProviderDb(): ProviderAggregate | null {
    return providerDbLoader.getDb()
  }

  async refreshProviderDb(force = false): Promise<ProviderDbRefreshResult> {
    return providerDbLoader.refreshIfNeeded(force)
  }

  notifyModelsChanged(providerId?: string): void {
    emitModelsChanged(this.publishEvent, providerId)
  }

  private resolveCapabilityRoute(
    providerId: string,
    modelId: string
  ): {
    endpointType?: NewApiEndpointType
    supportedEndpointTypes?: NewApiEndpointType[]
    type?: ModelType
    providerApiType?: string
    ownedBy?: string
  } | null {
    const providerApiType = this.providerHelper?.getProviderById?.(providerId)?.apiType
    const modelConfig = this.getModelConfig(modelId, providerId)
    if (isNewApiEndpointType(modelConfig.endpointType)) {
      return {
        endpointType: modelConfig.endpointType,
        providerApiType,
        ownedBy: modelConfig.ownedBy
      }
    }

    const storedModel =
      this.providerModelHelper
        .getProviderModels(providerId)
        .find((model) => model.id === modelId) ??
      this.getCustomModels(providerId).find((model) => model.id === modelId)

    if (storedModel) {
      return {
        endpointType: storedModel.endpointType,
        supportedEndpointTypes: storedModel.supportedEndpointTypes,
        type: storedModel.type,
        providerApiType,
        ownedBy: storedModel.ownedBy ?? modelConfig.ownedBy
      }
    }

    return providerApiType
      ? {
          providerApiType
        }
      : null
  }

  getCapabilityProviderId(providerId: string, modelId: string): string {
    return resolveProviderCapabilityProviderId(
      providerId,
      this.resolveCapabilityRoute(providerId, modelId),
      modelId
    )
  }

  supportsReasoningCapability(providerId: string, modelId: string): boolean {
    return modelCapabilities.supportsReasoning(
      this.getCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  private inferProviderDbModelType(model: ProviderModel): ModelType {
    const videoGenerationType = resolveVideoGenerationCompatType({
      modelId: model.id,
      type: model.type,
      modalities: model.modalities
    })
    if (videoGenerationType) {
      return videoGenerationType
    }

    if (Array.isArray(model.modalities?.output) && model.modalities.output.includes('image')) {
      return ModelType.ImageGeneration
    }

    switch (model.type) {
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
      case 'chat':
      default:
        return ModelType.Chat
    }
  }

  getReasoningPortrait(providerId: string, modelId: string): ReasoningPortrait | null {
    return modelCapabilities.getReasoningPortrait(
      this.getCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  getThinkingBudgetRange(
    providerId: string,
    modelId: string
  ): { min?: number; max?: number; default?: number } {
    return modelCapabilities.getThinkingBudgetRange(
      this.getCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  supportsSearchCapability(providerId: string, modelId: string): boolean {
    return modelCapabilities.supportsSearch(providerId, modelId)
  }

  getTemperatureCapability(providerId: string, modelId: string): boolean | undefined {
    return modelCapabilities.getTemperatureCapability(
      this.getCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  supportsTemperatureControl(providerId: string, modelId: string): boolean {
    return modelCapabilities.supportsTemperatureControl(
      this.getCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  getSearchDefaults(
    providerId: string,
    modelId: string
  ): { default?: boolean; forced?: boolean; strategy?: 'turbo' | 'max' } {
    return modelCapabilities.getSearchDefaults(providerId, modelId)
  }

  supportsAudioInputCapability(providerId: string, modelId: string): boolean {
    return modelCapabilities.supportsAudioInput(
      this.getCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  supportsReasoningEffortCapability(providerId: string, modelId: string): boolean {
    return modelCapabilities.supportsReasoningEffort(
      this.getCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  getReasoningEffortDefault(providerId: string, modelId: string): ReasoningEffort | undefined {
    return modelCapabilities.getReasoningEffortDefault(
      this.getCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  supportsVerbosityCapability(providerId: string, modelId: string): boolean {
    return modelCapabilities.supportsVerbosity(
      this.getCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  getVerbosityDefault(providerId: string, modelId: string): Verbosity | undefined {
    return modelCapabilities.getVerbosityDefault(
      this.getCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  private migrateConfigData(oldVersion: string | undefined): void {
    // Before version 0.2.4, minimax's baseUrl was incorrect and needs to be fixed
    if (oldVersion && compare(oldVersion, '0.2.4', '<')) {
      const providers = this.getProviders()
      for (const provider of providers) {
        if (provider.id === 'minimax') {
          provider.baseUrl = 'https://api.minimax.chat/v1'
          this.setProviderById('minimax', provider)
        }
      }
    }
    // Before version 0.0.10, model data was stored in app-settings.json
    if (oldVersion && compare(oldVersion, '0.0.10', '<')) {
      // Migrate old model data
      const providers = this.getProviders()

      for (const provider of providers) {
        // Check and fix ollama's baseUrl
        if (provider.id === 'ollama' && provider.baseUrl) {
          if (provider.baseUrl.endsWith('/v1')) {
            provider.baseUrl = provider.baseUrl.replace(/\/v1$/, '')
            // Save the modified provider
            this.setProviderById('ollama', provider)
          }
        }

        // Migrate provider models
        const oldProviderModelsKey = `${provider.id}_models`
        const oldModels =
          this.getSetting<(MODEL_META & { enabled: boolean })[]>(oldProviderModelsKey)

        if (oldModels && oldModels.length > 0) {
          const store = this.providerModelHelper.getProviderModelStore(provider.id)
          // Iterate through old models, save enabled state
          oldModels.forEach((model) => {
            if (model.enabled) {
              this.setModelStatus(provider.id, model.id, true)
            }
            // @ts-ignore - Need to delete enabled property for independent state storage
            delete model.enabled
          })
          // Save model list to new storage
          store.set('models', oldModels)
          // Clear old storage
          this.store.delete(oldProviderModelsKey)
        }

        // Migrate custom models
        const oldCustomModelsKey = `custom_models_${provider.id}`
        const oldCustomModels =
          this.getSetting<(MODEL_META & { enabled: boolean })[]>(oldCustomModelsKey)

        if (oldCustomModels && oldCustomModels.length > 0) {
          const store = this.providerModelHelper.getProviderModelStore(provider.id)
          // Iterate through old custom models, save enabled state
          oldCustomModels.forEach((model) => {
            if (model.enabled) {
              this.setModelStatus(provider.id, model.id, true)
            }
            // @ts-ignore - Need to delete enabled property for independent state storage
            delete model.enabled
          })
          // Save custom model list to new storage
          store.set('custom_models', oldCustomModels)
          // Clear old storage
          this.store.delete(oldCustomModelsKey)
        }
      }
    }

    // Before version 0.0.17, need to remove qwenlm provider
    if (oldVersion && compare(oldVersion, '0.0.17', '<')) {
      // Get all current providers
      const providers = this.getProviders()

      // Filter out qwenlm provider
      const filteredProviders = providers.filter((provider) => provider.id !== 'qwenlm')

      // If filtered count differs, there was removal operation, need to save updated provider list
      if (filteredProviders.length !== providers.length) {
        this.setProviders(filteredProviders)
      }
    }

    // Before version 0.3.5, handle migration and settings of default system prompt
    if (oldVersion && compare(oldVersion, '0.3.5', '<')) {
      try {
        const currentPrompt = this.getSetting<string>('default_system_prompt')
        if (!currentPrompt || currentPrompt.trim() === '') {
          this.setSetting('default_system_prompt', DEFAULT_SYSTEM_PROMPT)
        }
        const legacyDefault = this.getSetting<string>('default_system_prompt')
        if (
          typeof legacyDefault === 'string' &&
          legacyDefault.trim() &&
          legacyDefault.trim() !== DEFAULT_SYSTEM_PROMPT.trim()
        ) {
          const prompts = this.store.get<SystemPrompt[]>('systemPrompts') || []
          const now = Date.now()
          const idx = prompts.findIndex((p) => p.id === 'default')
          if (idx !== -1) {
            prompts[idx] = {
              ...prompts[idx],
              content: legacyDefault,
              isDefault: true,
              updatedAt: now
            }
          } else {
            prompts.push({
              id: 'default',
              name: 'DeepChat',
              content: legacyDefault,
              isDefault: true,
              createdAt: now,
              updatedAt: now
            })
          }
          this.store.set('systemPrompts', prompts)
        }
      } catch (e) {
        console.warn('Failed to migrate legacy default_system_prompt:', e)
      }
    }

    // Before version 0.5.8, split OpenAI Responses and OpenAI Completions semantics
    if (oldVersion && compare(oldVersion, '0.5.8', '<')) {
      const providers = this.getProviders()
      let hasChanges = false

      const migratedProviders = providers.map((provider) => {
        if (provider.apiType === 'openai-compatible') {
          hasChanges = true
          return { ...provider, apiType: 'openai-completions' }
        }

        if (
          provider.id !== 'openai' &&
          provider.id !== 'minimax' &&
          provider.apiType === 'openai'
        ) {
          hasChanges = true
          return { ...provider, apiType: 'openai-completions' }
        }

        return provider
      })

      if (hasChanges) {
        this.setProviders(migratedProviders)
      }
    }
  }

  private migrateMinimaxProvider(): void {
    const providers = this.getProviders()
    const legacyMinimax = providers.find(
      (provider) =>
        provider.id === 'minimax' &&
        (provider.apiType === 'openai' || provider.apiType === 'minimax')
    )

    if (!legacyMinimax) {
      return
    }

    const defaultMinimax = defaultProviders.find((provider) => provider.id === 'minimax')
    if (!defaultMinimax) {
      return
    }

    const updatedProvider: LLM_PROVIDER = {
      ...defaultMinimax,
      apiKey: legacyMinimax.apiKey
    }

    this.setProviderById('minimax', updatedProvider)

    if (providers.some((provider) => provider.id === 'minimax-an')) {
      const filteredProviders = this.getProviders().filter(
        (provider) => provider.id !== 'minimax-an'
      )
      this.setProviders(filteredProviders)
    }
  }

  private migrateAnthropicProviderToApiOnly(): void {
    const providers = this.getProviders()
    const defaultAnthropic = defaultProviders.find((provider) => provider.id === 'anthropic')
    const fallbackBaseUrl = defaultAnthropic?.baseUrl || 'https://api.anthropic.com'
    const envApiKey = process.env.ANTHROPIC_API_KEY
    let hasChanges = false
    let shouldClearAnthropicSelections = false

    const normalizedProviders = providers.map((provider) => {
      if (provider.id !== 'anthropic') {
        return provider
      }

      const legacyProvider = provider as AnthropicLegacyProvider
      const normalized = normalizeAnthropicProviderForApiOnly(
        legacyProvider,
        fallbackBaseUrl,
        envApiKey
      )
      const shouldDisableForMissingCredential =
        hasLegacyAnthropicOAuthState(legacyProvider) &&
        !hasAnthropicApiCredential(legacyProvider, envApiKey)

      if (
        hasLegacyAnthropicOAuthState(legacyProvider) ||
        normalized.enable !== legacyProvider.enable ||
        normalized.baseUrl !== legacyProvider.baseUrl
      ) {
        hasChanges = true
      }

      if (shouldDisableForMissingCredential) {
        shouldClearAnthropicSelections = true
      }

      return normalized
    })

    if (hasChanges) {
      this.setProviders(normalizedProviders)
    }

    if (shouldClearAnthropicSelections) {
      const keysToClear = getAnthropicModelSelectionKeysToClear({
        defaultModel: this.getSetting('defaultModel'),
        assistantModel: this.getSetting('assistantModel'),
        defaultVisionModel: this.store.get('defaultVisionModel') as
          | { providerId: string; modelId: string }
          | undefined,
        preferredModel: this.getSetting('preferredModel')
      })

      for (const key of keysToClear) {
        this.store.delete(key)
      }
    }
  }

  private cleanupDeprecatedBuiltinProviders(): void {
    const providers = this.getProviders()
    const filteredProviders = removeDeprecatedBuiltinProviders(providers)

    if (filteredProviders.length !== providers.length) {
      this.setProviders(filteredProviders)
    }

    const keysToClear = getDeprecatedProviderModelSelectionKeysToClear({
      defaultModel: this.store.get('defaultModel') as ModelSelection | undefined,
      assistantModel: this.store.get('assistantModel') as ModelSelection | undefined,
      defaultVisionModel: this.store.get('defaultVisionModel') as ModelSelection | undefined,
      preferredModel: this.store.get('preferredModel') as ModelSelection | undefined
    })

    for (const key of keysToClear) {
      this.store.delete(key)
    }
  }

  getSetting<T>(key: string): T | undefined {
    try {
      return this.store.get<T>(key)
    } catch (error) {
      console.error(`[Config] Failed to get setting ${key}:`, error)
      return undefined
    }
  }

  setSetting<T>(key: string, value: T): void {
    try {
      this.store.set(key, value)

      const trackedChange = toTrackedSettingsChangePayload(key, value)
      if (trackedChange) {
        this.publishEvent('settings.changed', {
          changedKeys: [trackedChange.changedKey],
          version: Date.now(),
          values: {
            [trackedChange.changedKey]: trackedChange.value
          } as Partial<SettingsSnapshotValues>
        })
      }
    } catch (error) {
      console.error(`[Config] Failed to set setting ${key}:`, error)
    }
  }

  getVoiceAiConfig(): {
    audioFormat: string
    model: string
    language: string
    temperature: number
    topP: number
    agentId: string
  } {
    return {
      audioFormat: this.store.get<string>('voiceAI_audioFormat') ?? VOICE_AI_DEFAULTS.audioFormat,
      model: this.store.get<string>('voiceAI_model') ?? VOICE_AI_DEFAULTS.model,
      language: this.store.get<string>('voiceAI_language') ?? VOICE_AI_DEFAULTS.language,
      temperature: this.store.get<number>('voiceAI_temperature') ?? VOICE_AI_DEFAULTS.temperature,
      topP: this.store.get<number>('voiceAI_topP') ?? VOICE_AI_DEFAULTS.topP,
      agentId: this.store.get<string>('voiceAI_agentId') ?? VOICE_AI_DEFAULTS.agentId
    }
  }

  setVoiceAiConfig(
    updates: Partial<ReturnType<ProviderSettings['getVoiceAiConfig']>>
  ): ReturnType<ProviderSettings['getVoiceAiConfig']> {
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        this.store.set(`voiceAI_${key}`, value)
      }
    }
    return this.getVoiceAiConfig()
  }

  getAzureApiVersion(): string | undefined {
    return this.store.get<string>('azureApiVersion')
  }

  setAzureApiVersion(version: string): void {
    this.store.set('azureApiVersion', version)
  }

  getGeminiSafety(key: string): string {
    return this.store.get<string>(`geminiSafety_${key}`) || 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
  }

  setGeminiSafety(key: string, value: string): void {
    this.store.set(`geminiSafety_${key}`, value)
  }

  getAwsBedrockCredential(): unknown {
    const stored = this.store.get<unknown>('awsBedrockCredential')
    if (typeof stored !== 'string') return stored

    try {
      const parsed = JSON.parse(stored) as { credential?: unknown } | unknown
      return parsed && typeof parsed === 'object' && 'credential' in parsed
        ? (parsed as { credential?: unknown }).credential
        : parsed
    } catch {
      return stored
    }
  }

  setAwsBedrockCredential(credential: unknown): void {
    this.store.set('awsBedrockCredential', JSON.stringify({ credential }))
  }

  getProviders(): LLM_PROVIDER[] {
    return this.providerHelper.getProviders()
  }

  setProviders(providers: LLM_PROVIDER[]): void {
    this.providerHelper.setProviders(providers)
  }

  getProviderById(id: string): LLM_PROVIDER | undefined {
    return this.providerHelper.getProviderById(id)
  }

  setProviderById(id: string, provider: LLM_PROVIDER): void {
    this.providerHelper.setProviderById(id, provider)
  }

  /**
   * 原子操作：更新单个 provider 配置
   * @param id Provider ID
   * @param updates 更新的字段
   * @returns 是否需要重建实例
   */
  updateProviderAtomic(id: string, updates: Partial<LLM_PROVIDER>): boolean {
    return this.providerHelper.updateProviderAtomic(id, updates)
  }

  /**
   * 原子操作：批量更新 providers
   * @param batchUpdate 批量更新请求
   */
  updateProvidersBatch(batchUpdate: ProviderBatchUpdate): void {
    this.providerHelper.updateProvidersBatch(batchUpdate)
  }

  /**
   * 原子操作：添加 provider
   * @param provider 新的 provider
   */
  addProviderAtomic(provider: LLM_PROVIDER): void {
    this.providerHelper.addProviderAtomic(provider)
  }

  /**
   * 原子操作：删除 provider
   * @param providerId Provider ID
   */
  removeProviderAtomic(providerId: string): void {
    this.providerHelper.removeProviderAtomic(providerId)
  }

  /**
   * 原子操作：重新排序 providers
   * @param providers 新的 provider 排序
   */
  reorderProvidersAtomic(providers: LLM_PROVIDER[]): void {
    this.providerHelper.reorderProvidersAtomic(providers)
  }

  getModelStatus(providerId: string, modelId: string): boolean {
    return this.modelStatusHelper.getModelStatus(providerId, modelId)
  }

  getBatchModelStatus(providerId: string, modelIds: string[]): Record<string, boolean> {
    return this.modelStatusHelper.getBatchModelStatus(providerId, modelIds)
  }

  setModelStatus(providerId: string, modelId: string, enabled: boolean): void {
    this.modelStatusHelper.setModelStatus(providerId, modelId, enabled)
  }

  ensureModelStatus(providerId: string, modelId: string, enabled: boolean): void {
    this.modelStatusHelper.ensureModelStatus(providerId, modelId, enabled)
  }

  enableModel(providerId: string, modelId: string): void {
    this.modelStatusHelper.enableModel(providerId, modelId)
  }

  disableModel(providerId: string, modelId: string): void {
    this.modelStatusHelper.disableModel(providerId, modelId)
  }

  clearModelStatusCache(): void {
    this.modelStatusHelper.clearModelStatusCache()
  }

  clearProviderModelStatusCache(providerId: string): void {
    this.modelStatusHelper.clearProviderModelStatusCache(providerId)
  }

  batchSetModelStatus(providerId: string, modelStatusMap: Record<string, boolean>): void {
    this.modelStatusHelper.batchSetModelStatus(providerId, modelStatusMap)
  }

  batchSetModelStatusQuiet(providerId: string, modelStatusMap: Record<string, boolean>): void {
    this.modelStatusHelper.batchSetModelStatusQuiet(providerId, modelStatusMap)
  }

  getProviderModels(providerId: string): MODEL_META[] {
    const models = this.providerModelHelper.getProviderModels(providerId)
    return models.map((model) => {
      const capabilityProviderId = resolveProviderCapabilityProviderId(
        providerId,
        {
          endpointType: model.endpointType,
          supportedEndpointTypes: model.supportedEndpointTypes,
          type: model.type,
          providerApiType: this.providerHelper?.getProviderById?.(providerId)?.apiType,
          ownedBy: model.ownedBy
        },
        model.id
      )

      if (capabilityProviderId === providerId) {
        return model
      }

      return {
        ...model,
        reasoning:
          model.reasoning === true ||
          modelCapabilities.supportsReasoning(capabilityProviderId, model.id)
      }
    })
  }

  // 基于聚合 Provider DB 的标准模型（只读映射，不落库）
  getDbProviderModels(providerId: string): RENDERER_MODEL_META[] {
    const db = providerDbLoader.getDb()
    const resolvedId =
      modelCapabilities.resolveProviderId(providerId.toLowerCase()) || providerId.toLowerCase()
    const provider = db?.providers?.[resolvedId]
    if (!provider || !Array.isArray(provider.models)) return []
    return provider.models.map((m) => ({
      id: m.id,
      name: m.display_name || m.name || m.id,
      contextLength: resolveModelContextLength(m.limit?.context),
      maxTokens: resolveDerivedModelMaxTokens(m.limit?.output),
      provider: providerId,
      providerId,
      group: 'default',
      enabled: false,
      isCustom: false,
      vision: resolveModelVision(
        Array.isArray(m?.modalities?.input) ? m.modalities!.input!.includes('image') : undefined
      ),
      functionCall: resolveModelFunctionCall(m.tool_call),
      reasoning: this.supportsReasoningCapability(providerId, m.id),
      type: this.inferProviderDbModelType(m)
    }))
  }

  setProviderModels(providerId: string, models: MODEL_META[]): void {
    this.providerModelHelper.setProviderModels(providerId, models)
  }

  getEnabledProviders(): LLM_PROVIDER[] {
    return this.providerHelper.getEnabledProviders()
  }

  getAllEnabledModels(): Promise<{ providerId: string; models: RENDERER_MODEL_META[] }[]> {
    const enabledProviders = this.getEnabledProviders()
    return Promise.all(
      enabledProviders.map(async (provider) => {
        const providerId = provider.id
        const allModels = [
          ...this.getProviderModels(providerId),
          ...this.getCustomModels(providerId)
        ]

        // Batch get model states
        const modelIds = allModels.map((model) => model.id)
        const modelStatusMap = this.getBatchModelStatus(providerId, modelIds)

        // Filter enabled models based on batch retrieved states
        const enabledModels = allModels
          .filter((model) => modelStatusMap[model.id])
          .map((model) => ({
            ...model,
            enabled: true,
            // Ensure capability properties are copied
            vision: model.vision || false,
            functionCall: model.functionCall || false,
            reasoning: model.reasoning || false
          }))

        return {
          providerId,
          models: enabledModels
        }
      })
    )
  }

  getCustomModels(providerId: string): MODEL_META[] {
    return this.providerModelHelper.getCustomModels(providerId)
  }

  isKnownModel(providerId: string, modelId: string): boolean {
    const normalizedProviderId = normalizeKnownProviderId(providerId)
    const normalizedModelId = normalizeKnownModelId(modelId)

    if (!normalizedProviderId || !normalizedModelId) {
      return false
    }

    const hasKnownModel = (models: Array<{ id: string }> | undefined): boolean =>
      Array.isArray(models) &&
      models.some((model) => normalizeKnownModelId(model.id) === normalizedModelId)

    return (
      this.hasUserModelConfig(normalizedModelId, normalizedProviderId) ||
      hasKnownModel(this.getProviderModels(normalizedProviderId)) ||
      hasKnownModel(this.getCustomModels(normalizedProviderId)) ||
      hasKnownModel(this.getDbProviderModels(normalizedProviderId))
    )
  }

  setCustomModels(providerId: string, models: MODEL_META[]): void {
    this.providerModelHelper.setCustomModels(providerId, models)
  }

  addCustomModel(providerId: string, model: MODEL_META): void {
    this.providerModelHelper.addCustomModel(providerId, model)
  }

  removeCustomModel(providerId: string, modelId: string): void {
    this.providerModelHelper.removeCustomModel(providerId, modelId)
  }

  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void {
    this.providerModelHelper.updateCustomModel(providerId, modelId, updates)
  }

  public getDefaultProviders(): LLM_PROVIDER[] {
    return this.providerHelper.getDefaultProviders()
  }

  /**
   * 获取指定provider和model的推荐配置
   * @param modelId 模型ID
   * @param providerId 可选的提供商ID，如果提供则优先查找该提供商的特定配置
   * @returns ModelConfig 模型配置
   */
  getModelConfig(modelId: string, providerId?: string): ModelConfig {
    return this.modelConfigHelper.getModelConfig(modelId, providerId)
  }

  /**
   * Set custom model configuration for a specific provider and model
   * @param modelId - The model ID
   * @param providerId - The provider ID
   * @param config - The model configuration
   */
  setModelConfig(
    modelId: string,
    providerId: string,
    config: ModelConfig,
    options?: { source?: ModelConfigSource }
  ): void {
    const storedConfig = this.modelConfigHelper.setModelConfig(modelId, providerId, config, options)
    this.providerModelHelper.invalidateProviderModelsCache(providerId)
    emitModelConfigChanged(
      this.publishEvent,
      providerId,
      modelId,
      storedConfig as unknown as NonNullable<
        DeepchatEventPayload<'models.config.changed'>['config']
      >
    )
  }

  /**
   * Reset model configuration for a specific provider and model
   * @param modelId - The model ID
   * @param providerId - The provider ID
   */
  resetModelConfig(modelId: string, providerId: string): void {
    this.modelConfigHelper.resetModelConfig(modelId, providerId)
    this.providerModelHelper.invalidateProviderModelsCache(providerId)
    emitModelConfigReset(this.publishEvent, providerId, modelId)
  }

  /**
   * Get all user-defined model configurations
   */
  getAllModelConfigs(): Record<string, IModelConfig> {
    return this.modelConfigHelper.getAllModelConfigs()
  }

  /**
   * Get configurations for a specific provider
   * @param providerId - The provider ID
   */
  getProviderModelConfigs(providerId: string): Array<{ modelId: string; config: ModelConfig }> {
    return this.modelConfigHelper.getProviderModelConfigs(providerId)
  }

  /**
   * Check if a model has user-defined configuration
   * @param modelId - The model ID
   * @param providerId - The provider ID
   */
  hasUserModelConfig(modelId: string, providerId: string): boolean {
    return this.modelConfigHelper.hasUserConfig(modelId, providerId)
  }

  /**
   * Export all model configurations for backup/sync
   */
  exportModelConfigs(): Record<string, IModelConfig> {
    return this.modelConfigHelper.exportConfigs()
  }

  /**
   * Import model configurations for restore/sync
   * @param configs - Model configurations to import
   * @param overwrite - Whether to overwrite existing configurations
   */
  importModelConfigs(configs: Record<string, IModelConfig>, overwrite: boolean = false): void {
    this.modelConfigHelper.importConfigs(configs, overwrite)
    this.providerModelHelper.invalidateAllProviderModelsCache()
    emitModelConfigsImported(this.publishEvent, overwrite)
  }
}
