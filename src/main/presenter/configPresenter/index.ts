import { eventBus, SendTarget } from '@/eventbus'
import {
  IConfigPresenter,
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  RENDERER_MODEL_META,
  MCPServerConfig,
  Prompt,
  SystemPrompt,
  IModelConfig,
  BuiltinKnowledgeConfig
} from '@shared/presenter'
import {
  ProviderChange,
  ProviderBatchUpdate,
  checkRequiresRebuild
} from '@shared/provider-operations'
import { SearchEngineTemplate } from '@shared/chat'
import { ModelType } from '@shared/model'
import ElectronStore from 'electron-store'
import { DEFAULT_PROVIDERS } from './providers'
import path from 'path'
import { app, nativeTheme, shell } from 'electron'
import fs from 'fs'
import { CONFIG_EVENTS, SYSTEM_EVENTS, FLOATING_BUTTON_EVENTS } from '@/events'
import { McpConfHelper } from './mcpConfHelper'
import { presenter } from '@/presenter'
import { compare } from 'compare-versions'
import { defaultShortcutKey, ShortcutKeySetting } from './shortcutKeySettings'
import { ModelConfigHelper } from './modelConfig'
import { KnowledgeConfHelper } from './knowledgeConfHelper'

// Default system prompt constant
const DEFAULT_SYSTEM_PROMPT = `You are DeepChat, a highly capable AI assistant. Your goal is to fully complete the user’s requested task before handing the conversation back to them. Keep working autonomously until the task is fully resolved.
Be thorough in gathering information. Before replying, make sure you have all the details necessary to provide a complete solution. Use additional tools or ask clarifying questions when needed, but if you can find the answer on your own, avoid asking the user for help.
When using tools, briefly describe your intended steps first—for example, which tool you’ll use and for what purpose.
Adhere to this in all languages.Always respond in the same language as the user's query.`

// Define application settings interface
interface IAppSettings {
  // Define your configuration items here, for example:
  language: string
  providers: LLM_PROVIDER[]
  closeToQuit: boolean // Whether to quit the program when clicking the close button
  appVersion?: string // Used for version checking and data migration
  proxyMode?: string // Proxy mode: system, none, custom
  customProxyUrl?: string // Custom proxy address
  customShortKey?: ShortcutKeySetting // Custom shortcut keys
  artifactsEffectEnabled?: boolean // Whether artifacts animation effects are enabled
  searchPreviewEnabled?: boolean // Whether search preview is enabled
  contentProtectionEnabled?: boolean // Whether content protection is enabled
  syncEnabled?: boolean // Whether sync functionality is enabled
  syncFolderPath?: string // Sync folder path
  lastSyncTime?: number // Last sync time
  customSearchEngines?: string // Custom search engines JSON string
  soundEnabled?: boolean // Whether sound effects are enabled
  copyWithCotEnabled?: boolean
  loggingEnabled?: boolean // Whether logging is enabled
  floatingButtonEnabled?: boolean // Whether floating button is enabled
  default_system_prompt?: string // Default system prompt
  webContentLengthLimit?: number // Web content truncation length limit, default 3000 characters
  updateChannel?: string // Update channel: 'stable' | 'canary'
  [key: string]: unknown // Allow arbitrary keys, using unknown type instead of any
}

// Create interface for model storage
interface IModelStore {
  models: MODEL_META[]
  custom_models: MODEL_META[]
}

const defaultProviders = DEFAULT_PROVIDERS.map((provider) => ({
  id: provider.id,
  name: provider.name,
  apiType: provider.apiType,
  apiKey: provider.apiKey,
  baseUrl: provider.baseUrl,
  enable: provider.enable,
  websites: provider.websites
}))

// Define storeKey constants
const PROVIDERS_STORE_KEY = 'providers'

const PROVIDER_MODELS_DIR = 'provider_models'
// Model state key prefix
const MODEL_STATUS_KEY_PREFIX = 'model_status_'

export class ConfigPresenter implements IConfigPresenter {
  private store: ElectronStore<IAppSettings>
  private providersModelStores: Map<string, ElectronStore<IModelStore>> = new Map()
  private customPromptsStore: ElectronStore<{ prompts: Prompt[] }>
  private systemPromptsStore: ElectronStore<{ prompts: SystemPrompt[] }>
  private userDataPath: string
  private currentAppVersion: string
  private mcpConfHelper: McpConfHelper // Use MCP configuration helper
  private modelConfigHelper: ModelConfigHelper // Model configuration helper
  private knowledgeConfHelper: KnowledgeConfHelper // Knowledge configuration helper
  // Model status memory cache for high-frequency read/write operations
  private modelStatusCache: Map<string, boolean> = new Map()

  constructor() {
    this.userDataPath = app.getPath('userData')
    this.currentAppVersion = app.getVersion()
    // Initialize application settings storage
    this.store = new ElectronStore<IAppSettings>({
      name: 'app-settings',
      defaults: {
        language: 'system',
        providers: defaultProviders,
        closeToQuit: false,
        customShortKey: defaultShortcutKey,
        proxyMode: 'system',
        customProxyUrl: '',
        artifactsEffectEnabled: true,
        searchPreviewEnabled: true,
        contentProtectionEnabled: false,
        syncEnabled: false,
        syncFolderPath: path.join(this.userDataPath, 'sync'),
        lastSyncTime: 0,
        soundEnabled: false,
        copyWithCotEnabled: true,
        loggingEnabled: false,
        floatingButtonEnabled: false,
        default_system_prompt: '',
        webContentLengthLimit: 3000,
        updateChannel: 'stable', // Default to stable version
        appVersion: this.currentAppVersion
      }
    })

    this.initTheme()

    // Initialize custom prompts storage
    this.customPromptsStore = new ElectronStore<{ prompts: Prompt[] }>({
      name: 'custom_prompts',
      defaults: {
        prompts: []
      }
    })

    this.systemPromptsStore = new ElectronStore<{ prompts: SystemPrompt[] }>({
      name: 'system_prompts',
      defaults: {
        prompts: [
          {
            id: 'default',
            name: 'DeepChat',
            content: DEFAULT_SYSTEM_PROMPT,
            isDefault: true,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]
      }
    })

    // Initialize MCP configuration helper
    this.mcpConfHelper = new McpConfHelper()

    // Initialize model configuration helper
    this.modelConfigHelper = new ModelConfigHelper()

    // Initialize knowledge configuration helper
    this.knowledgeConfHelper = new KnowledgeConfHelper()

    // Initialize provider models directory
    this.initProviderModelsDir()

    // If application version is updated, update appVersion
    if (this.store.get('appVersion') !== this.currentAppVersion) {
      const oldVersion = this.store.get('appVersion')
      this.store.set('appVersion', this.currentAppVersion)
      // Migrate data
      this.migrateConfigData(oldVersion)
      this.mcpConfHelper.onUpgrade(oldVersion)
    }

    const existingProviders = this.getSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY) || []
    const newProviders = defaultProviders.filter(
      (defaultProvider) =>
        !existingProviders.some((existingProvider) => existingProvider.id === defaultProvider.id)
    )

    if (newProviders.length > 0) {
      this.setProviders([...existingProviders, ...newProviders])
    }
  }

  private initProviderModelsDir(): void {
    const modelsDir = path.join(this.userDataPath, PROVIDER_MODELS_DIR)
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true })
    }
  }

  private getProviderModelStore(providerId: string): ElectronStore<IModelStore> {
    if (!this.providersModelStores.has(providerId)) {
      const store = new ElectronStore<IModelStore>({
        name: `models_${providerId}`,
        cwd: path.join(this.userDataPath, PROVIDER_MODELS_DIR),
        defaults: {
          models: [],
          custom_models: []
        }
      })
      this.providersModelStores.set(providerId, store)
    }
    return this.providersModelStores.get(providerId)!
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
          const store = this.getProviderModelStore(provider.id)
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
          const store = this.getProviderModelStore(provider.id)
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
          const prompts = (this.systemPromptsStore.get('prompts') || []) as SystemPrompt[]
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
          this.systemPromptsStore.set('prompts', prompts)
        }
      } catch (e) {
        console.warn('Failed to migrate legacy default_system_prompt:', e)
      }
    }
  }

  getSetting<T>(key: string): T | undefined {
    try {
      return this.store.get(key) as T
    } catch (error) {
      console.error(`[Config] Failed to get setting ${key}:`, error)
      return undefined
    }
  }

  setSetting<T>(key: string, value: T): void {
    try {
      this.store.set(key, value)
      // Trigger setting change event (main process internal use only)
      eventBus.sendToMain(CONFIG_EVENTS.SETTING_CHANGED, key, value)

      // Special handling: font size settings need to notify all tabs
      if (key === 'fontSizeLevel') {
        eventBus.sendToRenderer(CONFIG_EVENTS.FONT_SIZE_CHANGED, SendTarget.ALL_WINDOWS, value)
      }
    } catch (error) {
      console.error(`[Config] Failed to set setting ${key}:`, error)
    }
  }

  getProviders(): LLM_PROVIDER[] {
    const providers = this.getSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY)
    if (Array.isArray(providers) && providers.length > 0) {
      return providers
    } else {
      this.setSetting(PROVIDERS_STORE_KEY, defaultProviders)
      return defaultProviders
    }
  }

  setProviders(providers: LLM_PROVIDER[]): void {
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, providers)
    // Trigger new event (need to notify all tabs)
    eventBus.send(CONFIG_EVENTS.PROVIDER_CHANGED, SendTarget.ALL_WINDOWS)
  }

  getProviderById(id: string): LLM_PROVIDER | undefined {
    const providers = this.getProviders()
    return providers.find((provider) => provider.id === id)
  }

  setProviderById(id: string, provider: LLM_PROVIDER): void {
    const providers = this.getProviders()
    const index = providers.findIndex((p) => p.id === id)
    if (index !== -1) {
      providers[index] = provider
      this.setProviders(providers)
    } else {
      console.error(`[Config] Provider ${id} not found`)
    }
  }

  /**
   * 原子操作：更新单个 provider 配置
   * @param id Provider ID
   * @param updates 更新的字段
   * @returns 是否需要重建实例
   */
  updateProviderAtomic(id: string, updates: Partial<LLM_PROVIDER>): boolean {
    const providers = this.getProviders()
    const index = providers.findIndex((p) => p.id === id)

    if (index === -1) {
      console.error(`[Config] Provider ${id} not found`)
      return false
    }

    // Check if instance rebuild is needed
    const requiresRebuild = checkRequiresRebuild(updates)

    // Update configuration
    providers[index] = { ...providers[index], ...updates }
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, providers)

    // Trigger precise change event
    const change: ProviderChange = {
      operation: 'update',
      providerId: id,
      requiresRebuild,
      updates
    }
    eventBus.send(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, SendTarget.ALL_WINDOWS, change)

    return requiresRebuild
  }

  /**
   * 原子操作：批量更新 providers
   * @param batchUpdate 批量更新请求
   */
  updateProvidersBatch(batchUpdate: ProviderBatchUpdate): void {
    // Update complete provider list (used for order changes)
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, batchUpdate.providers)

    // Trigger batch change event
    eventBus.send(CONFIG_EVENTS.PROVIDER_BATCH_UPDATE, SendTarget.ALL_WINDOWS, batchUpdate)
  }

  /**
   * 原子操作：添加 provider
   * @param provider 新的 provider
   */
  addProviderAtomic(provider: LLM_PROVIDER): void {
    const providers = this.getProviders()
    providers.push(provider)
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, providers)

    const change: ProviderChange = {
      operation: 'add',
      providerId: provider.id,
      requiresRebuild: true, // Adding new provider always requires creating instance
      provider
    }
    eventBus.send(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, SendTarget.ALL_WINDOWS, change)
  }

  /**
   * 原子操作：删除 provider
   * @param providerId Provider ID
   */
  removeProviderAtomic(providerId: string): void {
    const providers = this.getProviders()
    const filteredProviders = providers.filter((p) => p.id !== providerId)
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, filteredProviders)

    const change: ProviderChange = {
      operation: 'remove',
      providerId,
      requiresRebuild: true // Deleting provider requires cleaning up instances
    }
    eventBus.send(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, SendTarget.ALL_WINDOWS, change)
  }

  /**
   * 原子操作：重新排序 providers
   * @param providers 新的 provider 排序
   */
  reorderProvidersAtomic(providers: LLM_PROVIDER[]): void {
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, providers)

    const change: ProviderChange = {
      operation: 'reorder',
      providerId: '', // Reordering affects all providers
      requiresRebuild: false // Only reordering doesn't require rebuilding instances
    }
    eventBus.send(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, SendTarget.ALL_WINDOWS, change)
  }

  // Construct storage key for model state
  private getModelStatusKey(providerId: string, modelId: string): string {
    // Replace dots in modelId with hyphens
    const formattedModelId = modelId.replace(/\./g, '-')
    return `${MODEL_STATUS_KEY_PREFIX}${providerId}_${formattedModelId}`
  }

  // Get model enabled state (with memory cache optimization)
  getModelStatus(providerId: string, modelId: string): boolean {
    const statusKey = this.getModelStatusKey(providerId, modelId)

    // First check memory cache
    if (this.modelStatusCache.has(statusKey)) {
      return this.modelStatusCache.get(statusKey)!
    }

    // Cache miss: read from settings and cache the result
    const status = this.getSetting<boolean>(statusKey)
    const finalStatus = typeof status === 'boolean' ? status : false
    this.modelStatusCache.set(statusKey, finalStatus)

    return finalStatus
  }

  // Batch get model enabled states (with memory cache optimization)
  getBatchModelStatus(providerId: string, modelIds: string[]): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    const uncachedKeys: string[] = []
    const uncachedModelIds: string[] = []

    // First pass: check cache for all models
    for (const modelId of modelIds) {
      const statusKey = this.getModelStatusKey(providerId, modelId)
      if (this.modelStatusCache.has(statusKey)) {
        result[modelId] = this.modelStatusCache.get(statusKey)!
      } else {
        uncachedKeys.push(statusKey)
        uncachedModelIds.push(modelId)
      }
    }

    // Second pass: fetch uncached values from settings and cache them
    for (let i = 0; i < uncachedModelIds.length; i++) {
      const modelId = uncachedModelIds[i]
      const statusKey = uncachedKeys[i]
      const status = this.getSetting<boolean>(statusKey)
      const finalStatus = typeof status === 'boolean' ? status : false

      // Cache the result and add to return object
      this.modelStatusCache.set(statusKey, finalStatus)
      result[modelId] = finalStatus
    }

    return result
  }

  // Set model enabled state (synchronously update memory cache)
  setModelStatus(providerId: string, modelId: string, enabled: boolean): void {
    const statusKey = this.getModelStatusKey(providerId, modelId)

    // Update both settings and memory cache synchronously
    this.setSetting(statusKey, enabled)
    this.modelStatusCache.set(statusKey, enabled)

    // Trigger model state change event (need to notify all tabs)
    eventBus.sendToRenderer(CONFIG_EVENTS.MODEL_STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
      providerId,
      modelId,
      enabled
    })
  }

  // Enable model
  enableModel(providerId: string, modelId: string): void {
    this.setModelStatus(providerId, modelId, true)
  }

  // Disable model
  disableModel(providerId: string, modelId: string): void {
    this.setModelStatus(providerId, modelId, false)
  }

  // Clear model state cache (for configuration reload or reset scenarios)
  clearModelStatusCache(): void {
    this.modelStatusCache.clear()
  }

  // Clear model state cache for specific provider
  clearProviderModelStatusCache(providerId: string): void {
    const keysToDelete: string[] = []
    for (const key of this.modelStatusCache.keys()) {
      if (key.startsWith(`${MODEL_STATUS_KEY_PREFIX}${providerId}_`)) {
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach((key) => this.modelStatusCache.delete(key))
  }

  // Batch set model states
  batchSetModelStatus(providerId: string, modelStatusMap: Record<string, boolean>): void {
    for (const [modelId, enabled] of Object.entries(modelStatusMap)) {
      this.setModelStatus(providerId, modelId, enabled)
    }
  }

  getProviderModels(providerId: string): MODEL_META[] {
    const store = this.getProviderModelStore(providerId)
    let models = store.get('models') || []

    models = models.map((model) => {
      const config = this.getModelConfig(model.id, providerId)
      if (config) {
        model.maxTokens = config.maxTokens
        model.contextLength = config.contextLength
        // If model already has these properties, keep them, otherwise use values from config or default to false
        model.vision = model.vision !== undefined ? model.vision : config.vision || false
        model.functionCall =
          model.functionCall !== undefined ? model.functionCall : config.functionCall || false
        model.reasoning =
          model.reasoning !== undefined ? model.reasoning : config.reasoning || false
        model.enableSearch =
          model.enableSearch !== undefined ? model.enableSearch : config.enableSearch || false
        model.type = model.type !== undefined ? model.type : config.type || ModelType.Chat
      } else {
        // Ensure model has these properties, default to false if not configured
        model.vision = model.vision || false
        model.functionCall = model.functionCall || false
        model.reasoning = model.reasoning || false
        model.enableSearch = model.enableSearch || false
        model.type = model.type || ModelType.Chat
      }
      return model
    })
    return models
  }

  getModelDefaultConfig(modelId: string, providerId?: string): ModelConfig {
    const model = this.getModelConfig(modelId, providerId)
    if (model) {
      return model
    }
    return {
      maxTokens: 4096,
      contextLength: 4096,
      temperature: 0.7,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: ModelType.Chat
    }
  }

  setProviderModels(providerId: string, models: MODEL_META[]): void {
    const store = this.getProviderModelStore(providerId)
    store.set('models', models)
  }

  getEnabledProviders(): LLM_PROVIDER[] {
    const providers = this.getProviders()
    return providers.filter((provider) => provider.enable)
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
            reasoning: model.reasoning || false,
            enableSearch: model.enableSearch || false
          }))

        return {
          providerId,
          models: enabledModels
        }
      })
    )
  }

  getCustomModels(providerId: string): MODEL_META[] {
    const store = this.getProviderModelStore(providerId)
    let customModels = store.get('custom_models') || []

    // Ensure custom models also have capability properties
    customModels = customModels.map((model) => {
      // If model already has these properties, keep them, otherwise default to false
      model.vision = model.vision !== undefined ? model.vision : false
      model.functionCall = model.functionCall !== undefined ? model.functionCall : false
      model.reasoning = model.reasoning !== undefined ? model.reasoning : false
      model.enableSearch = model.enableSearch !== undefined ? model.enableSearch : false
      return model
    })

    return customModels
  }

  setCustomModels(providerId: string, models: MODEL_META[]): void {
    const store = this.getProviderModelStore(providerId)
    store.set('custom_models', models)
  }

  addCustomModel(providerId: string, model: MODEL_META): void {
    const models = this.getCustomModels(providerId)
    const existingIndex = models.findIndex((m) => m.id === model.id)

    // Create model copy without enabled property
    const modelWithoutStatus: MODEL_META = { ...model }
    // @ts-ignore - Need to delete enabled property for independent state storage
    delete modelWithoutStatus.enabled

    if (existingIndex !== -1) {
      models[existingIndex] = modelWithoutStatus as MODEL_META
    } else {
      models.push(modelWithoutStatus as MODEL_META)
    }

    this.setCustomModels(providerId, models)
    // Set individual model state
    this.setModelStatus(providerId, model.id, true)
    // Trigger model list change event (need to notify all tabs)
    eventBus.sendToRenderer(CONFIG_EVENTS.MODEL_LIST_CHANGED, SendTarget.ALL_WINDOWS, providerId)
  }

  removeCustomModel(providerId: string, modelId: string): void {
    const models = this.getCustomModels(providerId)
    const filteredModels = models.filter((model) => model.id !== modelId)
    this.setCustomModels(providerId, filteredModels)

    // Delete model state
    const statusKey = this.getModelStatusKey(providerId, modelId)
    this.store.delete(statusKey)

    // Trigger model list change event (need to notify all tabs)
    eventBus.sendToRenderer(CONFIG_EVENTS.MODEL_LIST_CHANGED, SendTarget.ALL_WINDOWS, providerId)
  }

  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void {
    const models = this.getCustomModels(providerId)
    const index = models.findIndex((model) => model.id === modelId)

    if (index !== -1) {
      Object.assign(models[index], updates)
      this.setCustomModels(providerId, models)
      eventBus.sendToRenderer(CONFIG_EVENTS.MODEL_LIST_CHANGED, SendTarget.ALL_WINDOWS, providerId)
    }
  }

  getCloseToQuit(): boolean {
    return this.getSetting<boolean>('closeToQuit') ?? false
  }

  setCloseToQuit(value: boolean): void {
    this.setSetting('closeToQuit', value)
  }

  // Get application current language, considering system language settings
  getLanguage(): string {
    const language = this.getSetting<string>('language') || 'system'

    if (language !== 'system') {
      return language
    }

    return this.getSystemLanguage()
  }

  // Set application language
  setLanguage(language: string): void {
    this.setSetting('language', language)
    // Trigger language change event (need to notify all tabs)
    eventBus.sendToRenderer(CONFIG_EVENTS.LANGUAGE_CHANGED, SendTarget.ALL_WINDOWS, language)
  }

  // Get system language and match supported language list
  private getSystemLanguage(): string {
    const systemLang = app.getLocale()
    const supportedLanguages = [
      'zh-CN',
      'zh-TW',
      'en-US',
      'zh-HK',
      'ko-KR',
      'ru-RU',
      'ja-JP',
      'fr-FR',
      'fa-IR'
    ]

    // Exact match
    if (supportedLanguages.includes(systemLang)) {
      return systemLang
    }

    // Partial match (only match language code)
    const langCode = systemLang.split('-')[0]
    const matchedLang = supportedLanguages.find((lang) => lang.startsWith(langCode))
    if (matchedLang) {
      return matchedLang
    }

    // Default return English
    return 'en-US'
  }

  public getDefaultProviders(): LLM_PROVIDER[] {
    return DEFAULT_PROVIDERS
  }

  // Get proxy mode
  getProxyMode(): string {
    return this.getSetting<string>('proxyMode') || 'system'
  }

  // Set proxy mode
  setProxyMode(mode: string): void {
    this.setSetting('proxyMode', mode)
    eventBus.sendToMain(CONFIG_EVENTS.PROXY_MODE_CHANGED, mode)
  }

  // Get custom proxy address
  getCustomProxyUrl(): string {
    return this.getSetting<string>('customProxyUrl') || ''
  }

  // Set custom proxy address
  setCustomProxyUrl(url: string): void {
    this.setSetting('customProxyUrl', url)
    eventBus.sendToMain(CONFIG_EVENTS.CUSTOM_PROXY_URL_CHANGED, url)
  }

  // Get sync function status
  getSyncEnabled(): boolean {
    return this.getSetting<boolean>('syncEnabled') || false
  }

  // Get log folder path
  getLoggingFolderPath(): string {
    return path.join(this.userDataPath, 'logs')
  }

  // Open log folder
  async openLoggingFolder(): Promise<void> {
    const loggingFolderPath = this.getLoggingFolderPath()

    // If folder doesn't exist, create it first
    if (!fs.existsSync(loggingFolderPath)) {
      fs.mkdirSync(loggingFolderPath, { recursive: true })
    }

    // Open folder
    await shell.openPath(loggingFolderPath)
  }

  // Set sync function status
  setSyncEnabled(enabled: boolean): void {
    console.log('setSyncEnabled', enabled)
    this.setSetting('syncEnabled', enabled)
    eventBus.send(CONFIG_EVENTS.SYNC_SETTINGS_CHANGED, SendTarget.ALL_WINDOWS, { enabled })
  }

  // Get sync folder path
  getSyncFolderPath(): string {
    return (
      this.getSetting<string>('syncFolderPath') || path.join(app.getPath('home'), 'DeepchatSync')
    )
  }

  // Set sync folder path
  setSyncFolderPath(folderPath: string): void {
    this.setSetting('syncFolderPath', folderPath)
    eventBus.send(CONFIG_EVENTS.SYNC_SETTINGS_CHANGED, SendTarget.ALL_WINDOWS, { folderPath })
  }

  // Get last sync time
  getLastSyncTime(): number {
    return this.getSetting<number>('lastSyncTime') || 0
  }

  // Set last sync time
  setLastSyncTime(time: number): void {
    this.setSetting('lastSyncTime', time)
  }

  // Get custom search engines
  async getCustomSearchEngines(): Promise<SearchEngineTemplate[]> {
    try {
      const customEnginesJson = this.store.get('customSearchEngines')
      if (customEnginesJson) {
        return JSON.parse(customEnginesJson as string)
      }
      return []
    } catch (error) {
      console.error('Failed to get custom search engines:', error)
      return []
    }
  }

  // Set custom search engines
  async setCustomSearchEngines(engines: SearchEngineTemplate[]): Promise<void> {
    try {
      this.store.set('customSearchEngines', JSON.stringify(engines))
      // Send event to notify search engine update (need to notify all tabs)
      eventBus.send(CONFIG_EVENTS.SEARCH_ENGINES_UPDATED, SendTarget.ALL_WINDOWS, engines)
    } catch (error) {
      console.error('Failed to set custom search engines:', error)
      throw error
    }
  }

  // Get search preview setting status
  getSearchPreviewEnabled(): Promise<boolean> {
    const value = this.getSetting<boolean>('searchPreviewEnabled')
    // Default search preview is off
    return Promise.resolve(value === undefined || value === null ? false : value)
  }

  // Set search preview status
  setSearchPreviewEnabled(enabled: boolean): void {
    console.log('ConfigPresenter.setSearchPreviewEnabled:', enabled, typeof enabled)

    // Ensure the input is a boolean value
    const boolValue = Boolean(enabled)

    this.setSetting('searchPreviewEnabled', boolValue)
  }

  // Get content protection setting status
  getContentProtectionEnabled(): boolean {
    const value = this.getSetting<boolean>('contentProtectionEnabled')
    // Default content protection is off
    return value === undefined || value === null ? false : value
  }

  // Set content protection status
  setContentProtectionEnabled(enabled: boolean): void {
    this.setSetting('contentProtectionEnabled', enabled)
    eventBus.send(CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED, SendTarget.ALL_WINDOWS, enabled)
  }

  getLoggingEnabled(): boolean {
    return this.getSetting<boolean>('loggingEnabled') ?? false
  }

  setLoggingEnabled(enabled: boolean): void {
    this.setSetting('loggingEnabled', enabled)
    setTimeout(() => {
      presenter.devicePresenter.restartApp()
    }, 1000)
  }

  // Get sound effects switch status
  getSoundEnabled(): boolean {
    const value = this.getSetting<boolean>('soundEnabled') ?? false
    return value === undefined || value === null ? false : value
  }

  // Set sound effects switch status
  setSoundEnabled(enabled: boolean): void {
    this.setSetting('soundEnabled', enabled)
    eventBus.sendToRenderer(CONFIG_EVENTS.SOUND_ENABLED_CHANGED, SendTarget.ALL_WINDOWS, enabled)
  }

  getCopyWithCotEnabled(): boolean {
    const value = this.getSetting<boolean>('copyWithCotEnabled') ?? true
    return value === undefined || value === null ? false : value
  }

  setCopyWithCotEnabled(enabled: boolean): void {
    this.setSetting('copyWithCotEnabled', enabled)
    eventBus.sendToRenderer(CONFIG_EVENTS.COPY_WITH_COT_CHANGED, SendTarget.ALL_WINDOWS, enabled)
  }

  // Get floating button switch status
  getFloatingButtonEnabled(): boolean {
    const value = this.getSetting<boolean>('floatingButtonEnabled') ?? false
    return value === undefined || value === null ? false : value
  }

  // Set floating button switch status
  setFloatingButtonEnabled(enabled: boolean): void {
    this.setSetting('floatingButtonEnabled', enabled)
    eventBus.sendToMain(FLOATING_BUTTON_EVENTS.ENABLED_CHANGED, enabled)

    try {
      presenter.floatingButtonPresenter.setEnabled(enabled)
    } catch (error) {
      console.error('Failed to directly call floatingButtonPresenter:', error)
    }
  }

  // ===================== MCP configuration related methods =====================

  // Get MCP server configuration
  async getMcpServers(): Promise<Record<string, MCPServerConfig>> {
    return await this.mcpConfHelper.getMcpServers()
  }

  // Set MCP server configuration
  async setMcpServers(servers: Record<string, MCPServerConfig>): Promise<void> {
    return this.mcpConfHelper.setMcpServers(servers)
  }

  // Get default MCP server
  getMcpDefaultServers(): Promise<string[]> {
    return this.mcpConfHelper.getMcpDefaultServers()
  }

  // Set default MCP server
  async addMcpDefaultServer(serverName: string): Promise<void> {
    return this.mcpConfHelper.addMcpDefaultServer(serverName)
  }

  async removeMcpDefaultServer(serverName: string): Promise<void> {
    return this.mcpConfHelper.removeMcpDefaultServer(serverName)
  }

  async toggleMcpDefaultServer(serverName: string): Promise<void> {
    return this.mcpConfHelper.toggleMcpDefaultServer(serverName)
  }

  // Get MCP enabled status
  getMcpEnabled(): Promise<boolean> {
    return this.mcpConfHelper.getMcpEnabled()
  }

  // Set MCP enabled status
  async setMcpEnabled(enabled: boolean): Promise<void> {
    return this.mcpConfHelper.setMcpEnabled(enabled)
  }

  // Add MCP server
  async addMcpServer(name: string, config: MCPServerConfig): Promise<boolean> {
    return this.mcpConfHelper.addMcpServer(name, config)
  }

  // Remove MCP server
  async removeMcpServer(name: string): Promise<void> {
    return this.mcpConfHelper.removeMcpServer(name)
  }

  // Update MCP server configuration
  async updateMcpServer(name: string, config: Partial<MCPServerConfig>): Promise<void> {
    await this.mcpConfHelper.updateMcpServer(name, config)
  }

  // Provide getMcpConfHelper method to get MCP configuration helper
  getMcpConfHelper(): McpConfHelper {
    return this.mcpConfHelper
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
  setModelConfig(modelId: string, providerId: string, config: ModelConfig): void {
    this.modelConfigHelper.setModelConfig(modelId, providerId, config)
    // Trigger model configuration change event (need to notify all tabs)
    eventBus.sendToRenderer(
      CONFIG_EVENTS.MODEL_CONFIG_CHANGED,
      SendTarget.ALL_WINDOWS,
      providerId,
      modelId,
      config
    )
  }

  /**
   * Reset model configuration for a specific provider and model
   * @param modelId - The model ID
   * @param providerId - The provider ID
   */
  resetModelConfig(modelId: string, providerId: string): void {
    this.modelConfigHelper.resetModelConfig(modelId, providerId)
    // 触发模型配置重置事件（需要通知所有标签页）
    eventBus.sendToRenderer(
      CONFIG_EVENTS.MODEL_CONFIG_RESET,
      SendTarget.ALL_WINDOWS,
      providerId,
      modelId
    )
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
    // 触发批量导入事件（需要通知所有标签页）
    eventBus.sendToRenderer(CONFIG_EVENTS.MODEL_CONFIGS_IMPORTED, SendTarget.ALL_WINDOWS, overwrite)
  }

  getNotificationsEnabled(): boolean {
    const value = this.getSetting<boolean>('notificationsEnabled')
    if (value === undefined) {
      return true
    } else {
      return value
    }
  }

  setNotificationsEnabled(enabled: boolean): void {
    this.setSetting('notificationsEnabled', enabled)
  }

  async initTheme() {
    const theme = this.getSetting<string>('appTheme')
    if (theme) {
      nativeTheme.themeSource = theme as 'dark' | 'light' | 'system'
    }
    // 监听系统主题变化
    nativeTheme.on('updated', () => {
      // 只有当主题设置为 system 时，才需要通知渲染进程系统主题变化
      if (nativeTheme.themeSource === 'system') {
        eventBus.sendToMain(SYSTEM_EVENTS.SYSTEM_THEME_UPDATED, nativeTheme.shouldUseDarkColors)
      }
    })
  }

  async setTheme(theme: 'dark' | 'light' | 'system'): Promise<boolean> {
    nativeTheme.themeSource = theme
    this.setSetting('appTheme', theme)
    // 通知所有窗口主题已更改
    eventBus.sendToRenderer(CONFIG_EVENTS.THEME_CHANGED, SendTarget.ALL_WINDOWS, theme)
    return nativeTheme.shouldUseDarkColors
  }

  async getTheme(): Promise<string> {
    return this.getSetting<string>('appTheme') || 'system'
  }

  async getCurrentThemeIsDark(): Promise<boolean> {
    return nativeTheme.shouldUseDarkColors
  }

  async getSystemTheme(): Promise<'dark' | 'light'> {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  // 获取所有自定义 prompts
  async getCustomPrompts(): Promise<Prompt[]> {
    try {
      return this.customPromptsStore.get('prompts') || []
    } catch {
      return []
    }
  }

  // 保存自定义 prompts
  async setCustomPrompts(prompts: Prompt[]): Promise<void> {
    await this.customPromptsStore.set('prompts', prompts)
  }

  // 添加单个 prompt
  async addCustomPrompt(prompt: Prompt): Promise<void> {
    const prompts = await this.getCustomPrompts()
    prompts.push(prompt)
    await this.setCustomPrompts(prompts)
    // 事件会在 setCustomPrompts 中触发
  }

  // 更新单个 prompt
  async updateCustomPrompt(promptId: string, updates: Partial<Prompt>): Promise<void> {
    const prompts = await this.getCustomPrompts()
    const index = prompts.findIndex((p) => p.id === promptId)
    if (index !== -1) {
      prompts[index] = { ...prompts[index], ...updates }
      await this.setCustomPrompts(prompts)
      // 事件会在 setCustomPrompts 中触发
    }
  }

  // 删除单个 prompt
  async deleteCustomPrompt(promptId: string): Promise<void> {
    const prompts = await this.getCustomPrompts()
    const filteredPrompts = prompts.filter((p) => p.id !== promptId)
    await this.setCustomPrompts(filteredPrompts)
    // 事件会在 setCustomPrompts 中触发
  }

  // 获取默认系统提示词
  async getDefaultSystemPrompt(): Promise<string> {
    const prompts = await this.getSystemPrompts()
    const defaultPrompt = prompts.find((p) => p.isDefault)
    if (defaultPrompt) {
      return defaultPrompt.content
    }
    return this.getSetting<string>('default_system_prompt') || ''
  }

  // 设置默认系统提示词
  async setDefaultSystemPrompt(prompt: string): Promise<void> {
    this.setSetting('default_system_prompt', prompt)
  }

  // 重置为默认系统提示词
  async resetToDefaultPrompt(): Promise<void> {
    this.setSetting('default_system_prompt', DEFAULT_SYSTEM_PROMPT)
  }

  // 清空系统提示词
  async clearSystemPrompt(): Promise<void> {
    this.setSetting('default_system_prompt', '')
  }

  async getSystemPrompts(): Promise<SystemPrompt[]> {
    try {
      return this.systemPromptsStore.get('prompts') || []
    } catch {
      return []
    }
  }

  async setSystemPrompts(prompts: SystemPrompt[]): Promise<void> {
    await this.systemPromptsStore.set('prompts', prompts)
  }

  async addSystemPrompt(prompt: SystemPrompt): Promise<void> {
    const prompts = await this.getSystemPrompts()
    prompts.push(prompt)
    await this.setSystemPrompts(prompts)
  }

  async updateSystemPrompt(promptId: string, updates: Partial<SystemPrompt>): Promise<void> {
    const prompts = await this.getSystemPrompts()
    const index = prompts.findIndex((p) => p.id === promptId)
    if (index !== -1) {
      prompts[index] = { ...prompts[index], ...updates }
      await this.setSystemPrompts(prompts)
    }
  }

  async deleteSystemPrompt(promptId: string): Promise<void> {
    const prompts = await this.getSystemPrompts()
    const filteredPrompts = prompts.filter((p) => p.id !== promptId)
    await this.setSystemPrompts(filteredPrompts)
  }

  async setDefaultSystemPromptId(promptId: string): Promise<void> {
    const prompts = await this.getSystemPrompts()
    const updatedPrompts = prompts.map((p) => ({ ...p, isDefault: false }))
    const targetIndex = updatedPrompts.findIndex((p) => p.id === promptId)
    if (targetIndex !== -1) {
      updatedPrompts[targetIndex].isDefault = true
      await this.setSystemPrompts(updatedPrompts)
    }
  }

  async getDefaultSystemPromptId(): Promise<string> {
    const prompts = await this.getSystemPrompts()
    const defaultPrompt = prompts.find((p) => p.isDefault)
    return defaultPrompt?.id || 'default'
  }

  // 获取更新渠道
  getUpdateChannel(): string {
    return this.getSetting<string>('updateChannel') || 'stable'
  }

  // 设置更新渠道
  setUpdateChannel(channel: string): void {
    this.setSetting('updateChannel', channel)
  }

  // 获取默认快捷键
  getDefaultShortcutKey(): ShortcutKeySetting {
    return {
      ...defaultShortcutKey
    }
  }

  // 获取快捷键
  getShortcutKey(): ShortcutKeySetting {
    return (
      this.getSetting<ShortcutKeySetting>('shortcutKey') || {
        ...defaultShortcutKey
      }
    )
  }

  // 设置快捷键
  setShortcutKey(customShortcutKey: ShortcutKeySetting) {
    this.setSetting('shortcutKey', customShortcutKey)
  }

  // 重置快捷键
  resetShortcutKeys() {
    this.setSetting('shortcutKey', { ...defaultShortcutKey })
  }

  // 获取知识库配置
  getKnowledgeConfigs(): BuiltinKnowledgeConfig[] {
    return this.knowledgeConfHelper.getKnowledgeConfigs()
  }

  // 设置知识库配置
  setKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): void {
    this.knowledgeConfHelper.setKnowledgeConfigs(configs)
  }

  // 获取NPM Registry缓存
  getNpmRegistryCache(): any {
    return this.mcpConfHelper.getNpmRegistryCache()
  }

  // 设置NPM Registry缓存
  setNpmRegistryCache(cache: any): void {
    return this.mcpConfHelper.setNpmRegistryCache(cache)
  }

  // 检查NPM Registry缓存是否有效
  isNpmRegistryCacheValid(): boolean {
    return this.mcpConfHelper.isNpmRegistryCacheValid()
  }

  // 获取有效的NPM Registry
  getEffectiveNpmRegistry(): string | null {
    return this.mcpConfHelper.getEffectiveNpmRegistry()
  }

  // 获取自定义NPM Registry
  getCustomNpmRegistry(): string | undefined {
    return this.mcpConfHelper.getCustomNpmRegistry()
  }

  // 设置自定义NPM Registry
  setCustomNpmRegistry(registry: string | undefined): void {
    this.mcpConfHelper.setCustomNpmRegistry(registry)
  }

  // 获取自动检测NPM Registry设置
  getAutoDetectNpmRegistry(): boolean {
    return this.mcpConfHelper.getAutoDetectNpmRegistry()
  }

  // 设置自动检测NPM Registry
  setAutoDetectNpmRegistry(enabled: boolean): void {
    this.mcpConfHelper.setAutoDetectNpmRegistry(enabled)
  }

  // 清除NPM Registry缓存
  clearNpmRegistryCache(): void {
    this.mcpConfHelper.clearNpmRegistryCache()
  }

  // 对比知识库配置差异
  diffKnowledgeConfigs(newConfigs: BuiltinKnowledgeConfig[]) {
    return KnowledgeConfHelper.diffKnowledgeConfigs(
      this.knowledgeConfHelper.getKnowledgeConfigs(),
      newConfigs
    )
  }

  // 批量导入MCP服务器
  async batchImportMcpServers(
    servers: Array<{
      name: string
      description: string
      package: string
      version?: string
      type?: any
      args?: string[]
      env?: Record<string, string>
      enabled?: boolean
      source?: string
      [key: string]: unknown
    }>,
    options: {
      skipExisting?: boolean
      enableByDefault?: boolean
      overwriteExisting?: boolean
    } = {}
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    return this.mcpConfHelper.batchImportMcpServers(servers, options)
  }

  // 根据包名查找服务器
  async findMcpServerByPackage(packageName: string): Promise<string | null> {
    return this.mcpConfHelper.findServerByPackage(packageName)
  }
}

export { defaultShortcutKey } from './shortcutKeySettings'
