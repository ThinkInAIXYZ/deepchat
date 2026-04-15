import { eventBus, SendTarget } from '@/eventbus'
import {
  IConfigPresenter,
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  ModelConfigSource,
  RENDERER_MODEL_META,
  MCPServerConfig,
  Prompt,
  SystemPrompt,
  IModelConfig,
  BuiltinKnowledgeConfig,
  AcpAgentConfig,
  AcpAgentInstallState,
  AcpAgentState,
  AcpManualAgent,
  AcpRegistryAgent,
  AcpResolvedLaunchSpec,
  ProviderDbRefreshResult
} from '@shared/presenter'
import { ProviderBatchUpdate } from '@shared/provider-operations'
import { SearchEngineTemplate } from '@shared/chat'
import {
  ModelType,
  isNewApiEndpointType,
  resolveNewApiCapabilityProviderId,
  type NewApiEndpointType
} from '@shared/model'
import {
  DEFAULT_MODEL_CAPABILITY_FALLBACKS,
  resolveModelContextLength,
  resolveModelFunctionCall,
  resolveModelMaxTokens,
  resolveModelVision
} from '@shared/modelConfigDefaults'
import ElectronStore from 'electron-store'
import { DEFAULT_PROVIDERS } from './providers'
import path from 'path'
import { app, nativeTheme, shell } from 'electron'
import fs from 'fs'
import { CONFIG_EVENTS, SYSTEM_EVENTS, FLOATING_BUTTON_EVENTS, SESSION_EVENTS } from '@/events'
import { McpConfHelper } from './mcpConfHelper'
import { presenter } from '@/presenter'
import { compare } from 'compare-versions'
import { defaultShortcutKey, ShortcutKeySetting } from './shortcutKeySettings'
import { ModelConfigHelper } from './modelConfig'
import { KnowledgeConfHelper } from './knowledgeConfHelper'
import { providerDbLoader } from './providerDbLoader'
import {
  ProviderAggregate,
  ReasoningPortrait,
  type ReasoningEffort,
  type Verbosity
} from '@shared/types/model-db'
import { modelCapabilities } from './modelCapabilities'
import { ProviderHelper } from './providerHelper'
import { ModelStatusHelper } from './modelStatusHelper'
import { ProviderModelHelper, PROVIDER_MODELS_DIR } from './providerModelHelper'
import { SystemPromptHelper, DEFAULT_SYSTEM_PROMPT } from './systemPromptHelper'
import { UiSettingsHelper } from './uiSettingsHelper'
import { AcpConfHelper } from './acpConfHelper'
import { AcpRegistryService } from './acpRegistryService'
import { AcpLaunchSpecService } from './acpLaunchSpecService'
import { AcpProvider } from '../llmProviderPresenter/providers/acpProvider'
import { resolveAcpAgentAlias } from './acpRegistryConstants'
import { AgentRepository, BUILTIN_DEEPCHAT_AGENT_ID } from '../agentRepository'
import { normalizeDeepChatSubagentConfig } from '@shared/lib/deepchatSubagents'
import type { HookTestResult, HooksNotificationsSettings } from '@shared/hooksNotifications'
import type {
  Agent,
  AgentType,
  CreateDeepChatAgentInput,
  DeepChatAgentConfig,
  UpdateDeepChatAgentInput
} from '@shared/types/agent-interface'
import {
  createDefaultHooksNotificationsConfig,
  normalizeHooksNotificationsConfig
} from '../hooksNotifications/config'

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
  copyWithCotEnabled?: boolean
  autoCompactionEnabled?: boolean
  autoCompactionTriggerThreshold?: number
  autoCompactionRetainRecentPairs?: number
  loggingEnabled?: boolean // Whether logging is enabled
  floatingButtonEnabled?: boolean // Whether floating button is enabled
  default_system_prompt?: string // Default system prompt
  updateChannel?: string // Update channel: 'stable' | 'beta'
  fontFamily?: string // Custom UI font
  codeFontFamily?: string // Custom code font
  skillsPath?: string // Skills directory path
  enableSkills?: boolean // Skills system global toggle
  skillDraftSuggestionsEnabled?: boolean // Whether agent may propose skill drafts after tasks
  hooksNotifications?: HooksNotificationsSettings // Hooks & notifications settings
  defaultModel?: { providerId: string; modelId: string } // Default model for new conversations
  defaultVisionModel?: { providerId: string; modelId: string } // Legacy vision model setting for migration only
  defaultProjectPath?: string | null
  acpRegistryMigrationVersion?: number
  unifiedAgentsMigrationVersion?: number
  [key: string]: unknown // Allow arbitrary keys, using unknown type instead of any
}

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
const UNIFIED_AGENTS_MIGRATION_VERSION = 1
type AnthropicLegacyProvider = LLM_PROVIDER & { authMode?: 'apikey' | 'oauth' }
type ModelSelection = { providerId: string; modelId: string }
type AnthropicModelSettingKey = 'defaultModel' | 'assistantModel' | 'defaultVisionModel'

const ANTHROPIC_MODEL_SETTING_KEYS: AnthropicModelSettingKey[] = [
  'defaultModel',
  'assistantModel',
  'defaultVisionModel'
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

export class ConfigPresenter implements IConfigPresenter {
  private store: ElectronStore<IAppSettings>
  private customPromptsStore: ElectronStore<{ prompts: Prompt[] }>
  private systemPromptsStore: ElectronStore<{ prompts: SystemPrompt[] }>
  private userDataPath: string
  private currentAppVersion: string
  private mcpConfHelper: McpConfHelper // Use MCP configuration helper
  private acpConfHelper: AcpConfHelper
  private acpRegistryService: AcpRegistryService
  private acpLaunchSpecService: AcpLaunchSpecService
  private modelConfigHelper: ModelConfigHelper // Model configuration helper
  private knowledgeConfHelper: KnowledgeConfHelper // Knowledge configuration helper
  private providerHelper: ProviderHelper
  private modelStatusHelper: ModelStatusHelper
  private providerModelHelper: ProviderModelHelper
  private systemPromptHelper: SystemPromptHelper
  private uiSettingsHelper: UiSettingsHelper
  private agentRepository: AgentRepository | null = null
  // Custom prompts cache for high-frequency read operations
  private customPromptsCache: Prompt[] | null = null

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
        copyWithCotEnabled: true,
        autoCompactionEnabled: true,
        autoCompactionTriggerThreshold: 80,
        autoCompactionRetainRecentPairs: 2,
        loggingEnabled: false,
        floatingButtonEnabled: false,
        fontFamily: '',
        codeFontFamily: '',
        default_system_prompt: '',
        skillsPath: path.join(app.getPath('home'), '.deepchat', 'skills'),
        enableSkills: true,
        skillDraftSuggestionsEnabled: false,
        updateChannel: 'stable', // Default to stable version
        appVersion: this.currentAppVersion,
        hooksNotifications: createDefaultHooksNotificationsConfig()
      }
    })

    this.providerHelper = new ProviderHelper({
      store: this.store,
      setSetting: this.setSetting.bind(this),
      defaultProviders
    })

    this.modelStatusHelper = new ModelStatusHelper({
      store: this.store,
      setSetting: this.setSetting.bind(this)
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

    this.systemPromptHelper = new SystemPromptHelper({
      systemPromptsStore: this.systemPromptsStore,
      getSetting: this.getSetting.bind(this),
      setSetting: this.setSetting.bind(this)
    })

    this.uiSettingsHelper = new UiSettingsHelper({
      getSetting: this.getSetting.bind(this),
      setSetting: this.setSetting.bind(this)
    })

    // Initialize MCP configuration helper
    this.mcpConfHelper = new McpConfHelper()

    this.acpConfHelper = new AcpConfHelper({ mcpConfHelper: this.mcpConfHelper })
    this.acpRegistryService = new AcpRegistryService()
    this.acpLaunchSpecService = new AcpLaunchSpecService(
      path.join(this.userDataPath, 'acp-registry')
    )
    this.syncAcpProviderEnabled(this.acpConfHelper.getGlobalEnabled())
    void this.acpRegistryService
      .initialize()
      .then(() => {
        this.syncRegistryAgentsToRepository()
        this.notifyAcpAgentsChanged()
      })
      .catch((error) => {
        console.error('[ACP] Failed to initialize registry service:', error)
      })

    // Initialize model configuration helper
    this.modelConfigHelper = new ModelConfigHelper(this.currentAppVersion)

    // Initialize knowledge configuration helper
    this.knowledgeConfHelper = new KnowledgeConfHelper()

    this.providerModelHelper = new ProviderModelHelper({
      userDataPath: this.userDataPath,
      getModelConfig: (modelId: string, providerId?: string) =>
        this.getModelConfig(modelId, providerId),
      setModelStatus: this.modelStatusHelper.setModelStatus.bind(this.modelStatusHelper),
      deleteModelStatus: this.modelStatusHelper.deleteModelStatus.bind(this.modelStatusHelper)
    })

    // Initialize built-in ACP agents on first run or version upgrade
    // Initialize provider models directory
    this.initProviderModelsDir()

    // 初始化 Provider DB（外部聚合 JSON，本地内置为兜底）
    providerDbLoader.initialize().catch((error) => {
      console.warn('[ConfigPresenter] Failed to initialize provider DB:', error)
    })

    // If application version is updated, update appVersion
    if (this.store.get('appVersion') !== this.currentAppVersion) {
      const oldVersion = this.store.get('appVersion')
      this.store.set('appVersion', this.currentAppVersion)
      // Migrate data
      this.migrateConfigData(oldVersion)
      this.mcpConfHelper.onUpgrade(oldVersion)
    }

    // Migrate minimax provider from OpenAI format to Anthropic format
    this.migrateMinimaxProvider()
    this.migrateAnthropicProviderToApiOnly()

    const existingProviders = this.getSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY) || []
    const newProviders = defaultProviders.filter(
      (defaultProvider) =>
        !existingProviders.some((existingProvider) => existingProvider.id === defaultProvider.id)
    )

    if (newProviders.length > 0) {
      this.setProviders([...existingProviders, ...newProviders])
    }
  }

  setAgentRepository(agentRepository: AgentRepository): void {
    this.agentRepository = agentRepository
    this.initializeUnifiedAgents()
    this.migrateLegacyDefaultVisionModelToBuiltinAgent()
  }

  private getAgentRepositoryOrThrow(): AgentRepository {
    if (!this.agentRepository) {
      throw new Error('Unified agent repository is not attached.')
    }
    return this.agentRepository
  }

  private initializeUnifiedAgents(): void {
    const repository = this.getAgentRepositoryOrThrow()

    repository.ensureBuiltinDeepChatAgent({
      name: 'DeepChat',
      config: this.buildLegacyBuiltinDeepChatConfig()
    })

    const migratedVersion = this.getSetting<number>('unifiedAgentsMigrationVersion') ?? 0
    if (migratedVersion < UNIFIED_AGENTS_MIGRATION_VERSION) {
      this.acpConfHelper.getManualAgents().forEach((agent) => {
        repository.createManualAcpAgent(agent)
      })

      this.syncRegistryAgentsToRepository(
        this.acpConfHelper.getRegistryStates(),
        this.acpConfHelper.getInstallStates()
      )
      this.store.set('unifiedAgentsMigrationVersion', UNIFIED_AGENTS_MIGRATION_VERSION)
      return
    }

    this.syncRegistryAgentsToRepository()
  }

  private migrateLegacyDefaultVisionModelToBuiltinAgent(): void {
    const legacySelection = this.store.get('defaultVisionModel') as unknown
    if (legacySelection === undefined) {
      return
    }

    const builtinVisionModel = this.getBuiltinDeepChatConfig().visionModel

    if (
      isModelSelection(legacySelection) &&
      (!builtinVisionModel?.providerId || !builtinVisionModel?.modelId)
    ) {
      const providerId = legacySelection.providerId.trim()
      const modelId = legacySelection.modelId.trim()

      if (providerId && modelId) {
        this.updateBuiltinDeepChatConfig({
          visionModel: {
            providerId,
            modelId
          }
        })
      }
    }

    this.store.delete('defaultVisionModel')
    eventBus.sendToMain(CONFIG_EVENTS.SETTING_CHANGED, 'defaultVisionModel', undefined)
  }

  private buildLegacyBuiltinDeepChatConfig(): DeepChatAgentConfig {
    const defaultModel = this.store.get('defaultModel') as ModelSelection | undefined
    const assistantModel = this.store.get('assistantModel') as ModelSelection | undefined
    const visionModel = this.store.get('defaultVisionModel') as ModelSelection | undefined
    const autoCompactionEnabled = this.store.get('autoCompactionEnabled')
    const autoCompactionTriggerThreshold = this.store.get('autoCompactionTriggerThreshold')
    const autoCompactionRetainRecentPairs = this.store.get('autoCompactionRetainRecentPairs')

    return normalizeDeepChatSubagentConfig({
      defaultModelPreset:
        defaultModel?.providerId && defaultModel?.modelId
          ? {
              providerId: defaultModel.providerId,
              modelId: defaultModel.modelId
            }
          : null,
      assistantModel:
        assistantModel?.providerId && assistantModel?.modelId
          ? {
              providerId: assistantModel.providerId,
              modelId: assistantModel.modelId
            }
          : null,
      visionModel:
        visionModel?.providerId && visionModel?.modelId
          ? {
              providerId: visionModel.providerId,
              modelId: visionModel.modelId
            }
          : null,
      systemPrompt: (this.store.get('default_system_prompt') as string | undefined) ?? '',
      permissionMode: 'full_access',
      disabledAgentTools: [],
      autoCompactionEnabled:
        typeof autoCompactionEnabled === 'boolean' ? autoCompactionEnabled : true,
      autoCompactionTriggerThreshold:
        typeof autoCompactionTriggerThreshold === 'number' ? autoCompactionTriggerThreshold : 80,
      autoCompactionRetainRecentPairs:
        typeof autoCompactionRetainRecentPairs === 'number' ? autoCompactionRetainRecentPairs : 2
    })
  }

  private syncRegistryAgentsToRepository(
    legacyStateById?: Record<string, AcpAgentState>,
    legacyInstallStateById?: Record<string, AcpAgentInstallState>
  ): void {
    if (!this.agentRepository) {
      return
    }

    try {
      this.agentRepository.syncRegistryAgents(
        this.acpRegistryService.listAgents(),
        legacyStateById,
        legacyInstallStateById
      )
    } catch (error) {
      console.warn('[Agents] Failed to sync ACP registry agents into sqlite:', error)
    }
  }

  private getBuiltinDeepChatConfig(): DeepChatAgentConfig {
    return this.agentRepository?.resolveDeepChatAgentConfig(BUILTIN_DEEPCHAT_AGENT_ID) ?? {}
  }

  private updateBuiltinDeepChatConfig(updates: Partial<DeepChatAgentConfig>): void {
    if (!this.agentRepository) {
      return
    }

    this.agentRepository.updateDeepChatAgent(BUILTIN_DEEPCHAT_AGENT_ID, {
      config: updates
    })
    this.notifyAcpAgentsChanged()
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

  private resolveNewApiCapabilityEndpointType(modelId: string): NewApiEndpointType {
    const modelConfig = this.getModelConfig(modelId, 'new-api')
    if (isNewApiEndpointType(modelConfig.endpointType)) {
      return modelConfig.endpointType
    }

    const storedModel =
      this.getProviderModels('new-api').find((model) => model.id === modelId) ??
      this.getCustomModels('new-api').find((model) => model.id === modelId)

    if (storedModel) {
      if (isNewApiEndpointType(storedModel.endpointType)) {
        return storedModel.endpointType
      }

      const supportedEndpointTypes =
        storedModel.supportedEndpointTypes?.filter(isNewApiEndpointType) ?? []
      if (
        storedModel.type === ModelType.ImageGeneration &&
        supportedEndpointTypes.includes('image-generation')
      ) {
        return 'image-generation'
      }
      if (supportedEndpointTypes.length > 0) {
        return supportedEndpointTypes[0]
      }
      if (storedModel.type === ModelType.ImageGeneration) {
        return 'image-generation'
      }
    }

    return 'openai'
  }

  private resolveCapabilityProviderId(providerId: string, modelId: string): string {
    if (providerId.trim().toLowerCase() !== 'new-api') {
      return providerId
    }

    return resolveNewApiCapabilityProviderId(this.resolveNewApiCapabilityEndpointType(modelId))
  }

  supportsReasoningCapability(providerId: string, modelId: string): boolean {
    return modelCapabilities.supportsReasoning(
      this.resolveCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  getReasoningPortrait(providerId: string, modelId: string): ReasoningPortrait | null {
    return modelCapabilities.getReasoningPortrait(
      this.resolveCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  getThinkingBudgetRange(
    providerId: string,
    modelId: string
  ): { min?: number; max?: number; default?: number } {
    return modelCapabilities.getThinkingBudgetRange(
      this.resolveCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  supportsSearchCapability(providerId: string, modelId: string): boolean {
    return modelCapabilities.supportsSearch(providerId, modelId)
  }

  getSearchDefaults(
    providerId: string,
    modelId: string
  ): { default?: boolean; forced?: boolean; strategy?: 'turbo' | 'max' } {
    return modelCapabilities.getSearchDefaults(providerId, modelId)
  }

  supportsReasoningEffortCapability(providerId: string, modelId: string): boolean {
    return modelCapabilities.supportsReasoningEffort(
      this.resolveCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  getReasoningEffortDefault(providerId: string, modelId: string): ReasoningEffort | undefined {
    return modelCapabilities.getReasoningEffortDefault(
      this.resolveCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  supportsVerbosityCapability(providerId: string, modelId: string): boolean {
    return modelCapabilities.supportsVerbosity(
      this.resolveCapabilityProviderId(providerId, modelId),
      modelId
    )
  }

  getVerbosityDefault(providerId: string, modelId: string): Verbosity | undefined {
    return modelCapabilities.getVerbosityDefault(
      this.resolveCapabilityProviderId(providerId, modelId),
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
        eventBus.sendToMain(CONFIG_EVENTS.SETTING_CHANGED, key, undefined)
      }
    }
  }

  getSetting<T>(key: string): T | undefined {
    try {
      if (this.agentRepository) {
        if (key === 'defaultModel') {
          return this.getDefaultModel() as T | undefined
        }
        if (key === 'assistantModel') {
          return this.getBuiltinDeepChatConfig().assistantModel as T | undefined
        }
        if (key === 'default_system_prompt') {
          return this.getBuiltinDeepChatConfig().systemPrompt as T | undefined
        }
      }
      return this.store.get(key) as T
    } catch (error) {
      console.error(`[Config] Failed to get setting ${key}:`, error)
      return undefined
    }
  }

  setSetting<T>(key: string, value: T): void {
    try {
      if (this.agentRepository) {
        if (key === 'defaultModel') {
          this.setDefaultModel(value as { providerId: string; modelId: string } | undefined)
          return
        }
        if (key === 'assistantModel') {
          this.updateBuiltinDeepChatConfig({
            assistantModel: value as { providerId: string; modelId: string } | null | undefined
          })
          eventBus.sendToMain(CONFIG_EVENTS.SETTING_CHANGED, key, value)
          return
        }
        if (key === 'default_system_prompt') {
          this.updateBuiltinDeepChatConfig({
            systemPrompt: typeof value === 'string' ? value : ''
          })
          eventBus.sendToMain(CONFIG_EVENTS.SETTING_CHANGED, key, value)
          return
        }
      }

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

  getProviderModels(providerId: string): MODEL_META[] {
    return this.providerModelHelper.getProviderModels(providerId)
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
      maxTokens: resolveModelMaxTokens(m.limit?.output),
      provider: providerId,
      providerId,
      group: 'default',
      enabled: false,
      isCustom: false,
      vision: resolveModelVision(
        Array.isArray(m?.modalities?.input) ? m.modalities!.input!.includes('image') : undefined
      ),
      functionCall: resolveModelFunctionCall(m.tool_call),
      reasoning: Boolean(m.reasoning?.supported),
      type:
        Array.isArray(m?.modalities?.output) && m.modalities!.output!.includes('image')
          ? ModelType.ImageGeneration
          : ModelType.Chat
    }))
  }

  getModelDefaultConfig(modelId: string, providerId?: string): ModelConfig {
    const model = this.getModelConfig(modelId, providerId)
    if (model) {
      return model
    }
    return {
      ...DEFAULT_MODEL_CAPABILITY_FALLBACKS,
      temperature: 0.6,
      type: ModelType.Chat
    }
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

    try {
      presenter.floatingButtonPresenter.refreshLanguage()
    } catch (error) {
      console.error('Failed to refresh floating widget language:', error)
    }
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
      'fa-IR',
      'pt-BR',
      'da-DK',
      'he-IL'
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
    return this.providerHelper.getDefaultProviders()
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

  // Skills settings
  getSkillsEnabled(): boolean {
    return this.getSetting<boolean>('enableSkills') ?? true
  }

  setSkillsEnabled(enabled: boolean): void {
    this.setSetting('enableSkills', enabled)
  }

  getSkillDraftSuggestionsEnabled(): boolean {
    return this.getSetting<boolean>('skillDraftSuggestionsEnabled') ?? false
  }

  setSkillDraftSuggestionsEnabled(enabled: boolean): void {
    this.setSetting('skillDraftSuggestionsEnabled', enabled)
  }

  getSkillsPath(): string {
    return (
      this.getSetting<string>('skillsPath') || path.join(app.getPath('home'), '.deepchat', 'skills')
    )
  }

  setSkillsPath(skillsPath: string): void {
    this.setSetting('skillsPath', skillsPath)
  }

  getSkillSettings(): {
    skillsPath: string
    enableSkills: boolean
    skillDraftSuggestionsEnabled: boolean
  } {
    return {
      skillsPath: this.getSkillsPath(),
      enableSkills: this.getSkillsEnabled(),
      skillDraftSuggestionsEnabled: this.getSkillDraftSuggestionsEnabled()
    }
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
    return this.uiSettingsHelper.getSearchPreviewEnabled()
  }

  setSearchPreviewEnabled(enabled: boolean): void {
    this.uiSettingsHelper.setSearchPreviewEnabled(enabled)
  }

  getAutoScrollEnabled(): boolean {
    return this.uiSettingsHelper.getAutoScrollEnabled()
  }

  setAutoScrollEnabled(enabled: boolean): void {
    this.uiSettingsHelper.setAutoScrollEnabled(enabled)
  }

  getAutoCompactionEnabled(): boolean {
    return (
      this.getBuiltinDeepChatConfig().autoCompactionEnabled ??
      this.uiSettingsHelper.getAutoCompactionEnabled()
    )
  }

  setAutoCompactionEnabled(enabled: boolean): void {
    this.updateBuiltinDeepChatConfig({
      autoCompactionEnabled: Boolean(enabled)
    })
  }

  getAutoCompactionTriggerThreshold(): number {
    return (
      this.getBuiltinDeepChatConfig().autoCompactionTriggerThreshold ??
      this.uiSettingsHelper.getAutoCompactionTriggerThreshold()
    )
  }

  setAutoCompactionTriggerThreshold(threshold: number): void {
    this.updateBuiltinDeepChatConfig({
      autoCompactionTriggerThreshold: threshold
    })
  }

  getAutoCompactionRetainRecentPairs(): number {
    return (
      this.getBuiltinDeepChatConfig().autoCompactionRetainRecentPairs ??
      this.uiSettingsHelper.getAutoCompactionRetainRecentPairs()
    )
  }

  setAutoCompactionRetainRecentPairs(count: number): void {
    this.updateBuiltinDeepChatConfig({
      autoCompactionRetainRecentPairs: count
    })
  }

  getContentProtectionEnabled(): boolean {
    return this.uiSettingsHelper.getContentProtectionEnabled()
  }

  setContentProtectionEnabled(enabled: boolean): void {
    this.uiSettingsHelper.setContentProtectionEnabled(enabled)
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

  getCopyWithCotEnabled(): boolean {
    return this.uiSettingsHelper.getCopyWithCotEnabled()
  }

  setCopyWithCotEnabled(enabled: boolean): void {
    this.uiSettingsHelper.setCopyWithCotEnabled(enabled)
  }

  setTraceDebugEnabled(enabled: boolean): void {
    this.uiSettingsHelper.setTraceDebugEnabled(enabled)
  }

  getFontFamily(): string {
    return this.uiSettingsHelper.getFontFamily()
  }

  setFontFamily(fontFamily?: string | null): void {
    this.uiSettingsHelper.setFontFamily(fontFamily)
  }

  getCodeFontFamily(): string {
    return this.uiSettingsHelper.getCodeFontFamily()
  }

  setCodeFontFamily(fontFamily?: string | null): void {
    this.uiSettingsHelper.setCodeFontFamily(fontFamily)
  }

  resetFontSettings(): void {
    this.uiSettingsHelper.resetFontSettings()
  }

  async getSystemFonts(): Promise<string[]> {
    return this.uiSettingsHelper.getSystemFonts()
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
    eventBus.sendToRenderer(FLOATING_BUTTON_EVENTS.ENABLED_CHANGED, SendTarget.ALL_WINDOWS, enabled)

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

  getEnabledMcpServers(): Promise<string[]> {
    return this.mcpConfHelper.getEnabledMcpServers()
  }

  async setMcpServerEnabled(serverName: string, enabled: boolean): Promise<void> {
    return this.mcpConfHelper.setMcpServerEnabled(serverName, enabled)
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

  private syncAcpProviderEnabled(enabled: boolean): void {
    const provider = this.getProviderById('acp')
    if (!provider || provider.enable === enabled) {
      return
    }
    console.log(`[ACP] syncAcpProviderEnabled: updating provider enable state to ${enabled}`)
    this.updateProviderAtomic('acp', { enable: enabled })
  }

  async getAcpEnabled(): Promise<boolean> {
    return this.acpConfHelper.getGlobalEnabled()
  }

  async setAcpEnabled(enabled: boolean): Promise<void> {
    const changed = this.acpConfHelper.setGlobalEnabled(enabled)
    if (!changed) return

    console.log('[ACP] setAcpEnabled: updating global toggle to', enabled)
    this.syncAcpProviderEnabled(enabled)

    if (!enabled) {
      console.log('[ACP] Disabling: clearing provider models and status cache')
      this.providerModelHelper.setProviderModels('acp', [])
      this.clearProviderModelStatusCache('acp')
    }

    this.notifyAcpAgentsChanged()
  }

  // ===================== ACP configuration methods =====================
  async listAcpRegistryAgents(): Promise<AcpRegistryAgent[]> {
    this.syncRegistryAgentsToRepository()
    const registryAgents = this.acpRegistryService.listAgents()

    return registryAgents.map((agent) => {
      const overlay = this.agentRepository?.getAcpRegistryOverlay(agent.id) ?? {
        enabled: this.acpConfHelper.getRegistryStates()[agent.id]?.enabled ?? false,
        envOverride: this.acpConfHelper.getRegistryStates()[agent.id]?.envOverride,
        installState: this.acpConfHelper.getInstallStates()[agent.id] ?? null
      }
      return {
        ...agent,
        enabled: overlay.enabled,
        envOverride: overlay.envOverride,
        installState: overlay.installState ?? null
      }
    })
  }

  async refreshAcpRegistry(force = true): Promise<AcpRegistryAgent[]> {
    await this.acpRegistryService.refresh(force)
    this.syncRegistryAgentsToRepository()
    const agents = await this.listAcpRegistryAgents()
    this.notifyAcpAgentsChanged()
    return agents
  }

  async getAcpRegistryIconMarkup(agentId: string, iconUrl?: string): Promise<string | null> {
    return await this.acpRegistryService.getIconMarkup(agentId, iconUrl)
  }

  async getAcpAgentState(agentId: string): Promise<AcpAgentState | null> {
    return this.agentRepository?.getAcpAgentState(resolveAcpAgentAlias(agentId)) ?? null
  }

  async setAcpAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
    const resolvedId = resolveAcpAgentAlias(agentId)
    this.getAgentRepositoryOrThrow().setAgentEnabled(resolvedId, enabled)
    this.handleAcpAgentsMutated([resolvedId])

    if (enabled) {
      void this.ensureAcpAgentInstalled(resolvedId).catch((error) => {
        console.warn(`[ACP] Failed to preinstall registry agent ${resolvedId}:`, error)
      })
    }
  }

  async setAcpAgentEnvOverride(agentId: string, env: Record<string, string>): Promise<void> {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const installState = this.getAgentRepositoryOrThrow().getAgentInstallState(resolvedId)
    if (installState?.status !== 'installed') {
      throw new Error(`ACP registry agent is not installed: ${resolvedId}`)
    }
    this.getAgentRepositoryOrThrow().setAgentEnvOverride(resolvedId, env)
    this.handleAcpAgentsMutated([resolvedId])
  }

  async ensureAcpAgentInstalled(agentId: string): Promise<AcpAgentInstallState> {
    const registryAgent = this.getRegistryAgentOrThrow(agentId)
    const currentState = this.getAgentRepositoryOrThrow().getAgentInstallState(registryAgent.id)
    const installingState: AcpAgentInstallState = {
      status: 'installing',
      version: registryAgent.version,
      distributionType:
        this.acpLaunchSpecService.selectRegistryDistribution(registryAgent)?.type ?? undefined,
      lastCheckedAt: Date.now(),
      installedAt: currentState?.installedAt ?? null,
      installDir: currentState?.installDir ?? null,
      error: null
    }
    this.getAgentRepositoryOrThrow().setAgentInstallState(registryAgent.id, installingState)
    this.notifyAcpAgentsChanged()

    try {
      const installedState = await this.acpLaunchSpecService.ensureRegistryAgentInstalled(
        registryAgent,
        currentState
      )
      this.getAgentRepositoryOrThrow().setAgentInstallState(registryAgent.id, installedState)
      this.notifyAcpAgentsChanged()
      return installedState
    } catch (error) {
      const failedState: AcpAgentInstallState = {
        status: 'error',
        version: registryAgent.version,
        distributionType:
          this.acpLaunchSpecService.selectRegistryDistribution(registryAgent)?.type ?? undefined,
        lastCheckedAt: Date.now(),
        installedAt: currentState?.installedAt ?? null,
        installDir: currentState?.installDir ?? null,
        error: error instanceof Error ? error.message : String(error)
      }
      this.getAgentRepositoryOrThrow().setAgentInstallState(registryAgent.id, failedState)
      this.notifyAcpAgentsChanged()
      throw error
    }
  }

  async repairAcpAgent(agentId: string): Promise<AcpAgentInstallState> {
    const registryAgent = this.getRegistryAgentOrThrow(agentId)
    const currentState = this.getAgentRepositoryOrThrow().getAgentInstallState(registryAgent.id)
    const repairingState: AcpAgentInstallState = {
      status: 'installing',
      version: registryAgent.version,
      distributionType:
        this.acpLaunchSpecService.selectRegistryDistribution(registryAgent)?.type ?? undefined,
      lastCheckedAt: Date.now(),
      installedAt: currentState?.installedAt ?? null,
      installDir: currentState?.installDir ?? null,
      error: null
    }
    this.getAgentRepositoryOrThrow().setAgentInstallState(registryAgent.id, repairingState)
    this.notifyAcpAgentsChanged()

    try {
      const installedState = await this.acpLaunchSpecService.ensureRegistryAgentInstalled(
        registryAgent,
        currentState,
        { repair: true }
      )
      this.getAgentRepositoryOrThrow().setAgentInstallState(registryAgent.id, installedState)
      this.handleAcpAgentsMutated([registryAgent.id])
      return installedState
    } catch (error) {
      const failedState: AcpAgentInstallState = {
        status: 'error',
        version: registryAgent.version,
        distributionType:
          this.acpLaunchSpecService.selectRegistryDistribution(registryAgent)?.type ?? undefined,
        lastCheckedAt: Date.now(),
        installedAt: currentState?.installedAt ?? null,
        installDir: currentState?.installDir ?? null,
        error: error instanceof Error ? error.message : String(error)
      }
      this.getAgentRepositoryOrThrow().setAgentInstallState(registryAgent.id, failedState)
      this.notifyAcpAgentsChanged()
      throw error
    }
  }

  async uninstallAcpRegistryAgent(agentId: string): Promise<void> {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const registryAgent = this.getRegistryAgentOrThrow(resolvedId)
    const currentState = this.getAgentRepositoryOrThrow().getAgentInstallState(registryAgent.id)

    await this.acpLaunchSpecService.uninstallRegistryAgent(registryAgent, currentState)

    const uninstalledState: AcpAgentInstallState = {
      status: 'not_installed',
      version: registryAgent.version,
      distributionType:
        this.acpLaunchSpecService.selectRegistryDistribution(registryAgent)?.type ?? undefined,
      lastCheckedAt: Date.now(),
      installedAt: null,
      installDir: null,
      error: null
    }

    const updated = this.getAgentRepositoryOrThrow().clearRegistryAcpAgentInstallation(
      registryAgent.id,
      uninstalledState
    )
    if (!updated) {
      throw new Error(`ACP registry agent not found: ${registryAgent.id}`)
    }

    this.handleAcpAgentsMutated([registryAgent.id])
  }

  async getAcpAgentInstallStatus(agentId: string): Promise<AcpAgentInstallState | null> {
    return this.agentRepository?.getAgentInstallState(resolveAcpAgentAlias(agentId)) ?? null
  }

  async listManualAcpAgents(): Promise<AcpManualAgent[]> {
    return this.getAgentRepositoryOrThrow().listManualAcpAgents()
  }

  async addManualAcpAgent(
    agent: Omit<AcpManualAgent, 'id' | 'source'> & { id?: string }
  ): Promise<AcpManualAgent> {
    const created = this.getAgentRepositoryOrThrow().createManualAcpAgent(agent)
    this.handleAcpAgentsMutated([created.id])
    return created
  }

  async updateManualAcpAgent(
    agentId: string,
    updates: Partial<Omit<AcpManualAgent, 'id' | 'source'>>
  ): Promise<AcpManualAgent | null> {
    const updated = this.getAgentRepositoryOrThrow().updateManualAcpAgent(agentId, updates)
    if (updated) {
      this.handleAcpAgentsMutated([updated.id])
    }
    return updated
  }

  async removeManualAcpAgent(agentId: string): Promise<boolean> {
    const removed = this.getAgentRepositoryOrThrow().removeManualAcpAgent(agentId)
    if (removed) {
      this.handleAcpAgentsMutated([agentId])
    }
    return removed
  }

  async getAcpAgents(): Promise<AcpAgentConfig[]> {
    const acpEnabled = this.acpConfHelper.getGlobalEnabled()
    if (!acpEnabled) {
      return []
    }

    const [registryAgents, manualAgents] = await Promise.all([
      this.listAcpRegistryAgents(),
      this.listManualAcpAgents()
    ])

    const enabledRegistryAgents = registryAgents
      .filter((agent) => agent.enabled && agent.installState?.status === 'installed')
      .map((agent) => this.buildRegistryAgentConfig(agent))

    const enabledManualAgents = manualAgents
      .filter((agent) => agent.enabled)
      .map((agent) => this.buildManualAgentConfig(agent))

    return [...enabledRegistryAgents, ...enabledManualAgents]
  }

  async resolveAcpLaunchSpec(agentId: string, _workdir?: string): Promise<AcpResolvedLaunchSpec> {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const manualAgent = this.getAgentRepositoryOrThrow().getManualAcpAgent(resolvedId)
    if (manualAgent) {
      return this.acpLaunchSpecService.resolveManualLaunchSpec(manualAgent)
    }

    const registryAgent = this.getRegistryAgentOrThrow(resolvedId)
    const installState = this.getAgentRepositoryOrThrow().getAgentInstallState(registryAgent.id)
    const launchSpec = await this.acpLaunchSpecService.resolveRegistryLaunchSpec(
      registryAgent,
      installState
    )

    const nextInstallState: AcpAgentInstallState = {
      status: 'installed',
      distributionType: launchSpec.distributionType,
      version: launchSpec.version,
      lastCheckedAt: Date.now(),
      installedAt: installState?.installedAt ?? Date.now(),
      installDir: launchSpec.installDir ?? null,
      error: null
    }
    this.getAgentRepositoryOrThrow().setAgentInstallState(resolvedId, nextInstallState)
    return launchSpec
  }

  async getAcpSharedMcpSelections(): Promise<string[]> {
    return this.acpConfHelper.getSharedMcpSelections()
  }

  async setAcpSharedMcpSelections(mcpIds: string[]): Promise<void> {
    await this.acpConfHelper.setSharedMcpSelections(mcpIds)
    this.handleAcpAgentsMutated()
  }

  async listAgents(): Promise<Agent[]> {
    return this.getAgentRepositoryOrThrow().listAgents()
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    return this.getAgentRepositoryOrThrow().getAgent(agentId)
  }

  async getAgentType(agentId: string): Promise<AgentType | null> {
    return this.getAgentRepositoryOrThrow().getAgentType(agentId)
  }

  async getDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig | null> {
    return this.getAgentRepositoryOrThrow().getDeepChatAgentConfig(agentId)
  }

  async resolveDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig> {
    return this.getAgentRepositoryOrThrow().resolveDeepChatAgentConfig(
      agentId || BUILTIN_DEEPCHAT_AGENT_ID
    )
  }

  async agentSupportsCapability(agentId: string, capability: 'vision'): Promise<boolean> {
    if (capability !== 'vision') {
      return false
    }

    const agentConfig = await this.resolveDeepChatAgentConfig(agentId)
    const providerId = agentConfig.visionModel?.providerId?.trim()
    const modelId = agentConfig.visionModel?.modelId?.trim()

    return Boolean(providerId && modelId && this.getModelConfig(modelId, providerId)?.vision)
  }

  async createDeepChatAgent(input: CreateDeepChatAgentInput): Promise<Agent> {
    const created = this.getAgentRepositoryOrThrow().createDeepChatAgent(input)
    this.notifyAcpAgentsChanged()
    return created
  }

  async updateDeepChatAgent(
    agentId: string,
    updates: UpdateDeepChatAgentInput
  ): Promise<Agent | null> {
    const updated = this.getAgentRepositoryOrThrow().updateDeepChatAgent(agentId, updates)
    if (updated) {
      this.notifyAcpAgentsChanged()
    }
    return updated
  }

  async deleteDeepChatAgent(agentId: string): Promise<boolean> {
    const removed = this.getAgentRepositoryOrThrow().deleteDeepChatAgent(agentId)
    if (removed) {
      this.notifyAcpAgentsChanged()
    }
    return removed
  }

  async getAgentMcpSelections(agentId: string, isBuiltin?: boolean): Promise<string[]> {
    return await this.acpConfHelper.getAgentMcpSelections(agentId, isBuiltin)
  }

  async setAgentMcpSelections(
    agentId: string,
    isBuiltin: boolean,
    mcpIds: string[]
  ): Promise<void> {
    await this.acpConfHelper.setAgentMcpSelections(agentId, isBuiltin, mcpIds)
    this.handleAcpAgentsMutated()
  }

  async addMcpToAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void> {
    await this.acpConfHelper.addMcpToAgent(agentId, isBuiltin, mcpId)
    this.handleAcpAgentsMutated()
  }

  async removeMcpFromAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void> {
    await this.acpConfHelper.removeMcpFromAgent(agentId, isBuiltin, mcpId)
    this.handleAcpAgentsMutated()
  }

  private buildRegistryAgentConfig(agent: AcpRegistryAgent): AcpAgentConfig {
    const preview = this.acpLaunchSpecService.buildRegistryPreview(agent)
    return {
      id: agent.id,
      name: agent.name,
      command: preview.command,
      args: preview.args,
      description: agent.description,
      icon: agent.icon,
      source: 'registry',
      installState: agent.installState ?? null
    }
  }

  private buildManualAgentConfig(agent: AcpManualAgent): AcpAgentConfig {
    return {
      id: agent.id,
      name: agent.name,
      command: agent.command,
      args: agent.args,
      env: agent.env,
      description: agent.description,
      icon: agent.icon,
      source: 'manual',
      installState: null
    }
  }

  private getRegistryAgentOrThrow(agentId: string): AcpRegistryAgent {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const agent = this.acpRegistryService.getAgent(resolvedId)
    if (!agent) {
      throw new Error(`ACP registry agent not found: ${resolvedId}`)
    }
    return agent
  }

  private handleAcpAgentsMutated(agentIds?: string[]) {
    this.clearProviderModelStatusCache('acp')
    this.notifyAcpAgentsChanged()
    this.refreshAcpProviderAgents(agentIds)
  }

  private refreshAcpProviderAgents(agentIds?: string[]): void {
    try {
      const providerInstance = presenter?.llmproviderPresenter?.getProviderInstance?.('acp')
      if (!providerInstance) {
        return
      }

      const acpProvider = providerInstance as AcpProvider
      if (typeof acpProvider.refreshAgents !== 'function') {
        return
      }

      void acpProvider.refreshAgents(agentIds)
    } catch (error) {
      console.warn('[ACP] Failed to refresh agent processes after config change:', error)
    }
  }

  private notifyAcpAgentsChanged() {
    console.log('[ACP] notifyAcpAgentsChanged: sending MODEL_LIST_CHANGED event for provider "acp"')
    eventBus.sendToRenderer(CONFIG_EVENTS.MODEL_LIST_CHANGED, SendTarget.ALL_WINDOWS, 'acp')
    eventBus.sendToRenderer(CONFIG_EVENTS.AGENTS_CHANGED, SendTarget.ALL_WINDOWS)
    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)
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
  setModelConfig(
    modelId: string,
    providerId: string,
    config: ModelConfig,
    options?: { source?: ModelConfigSource }
  ): void {
    const storedConfig = this.modelConfigHelper.setModelConfig(modelId, providerId, config, options)
    // Trigger model configuration change event (need to notify all tabs)
    eventBus.sendToRenderer(
      CONFIG_EVENTS.MODEL_CONFIG_CHANGED,
      SendTarget.ALL_WINDOWS,
      providerId,
      modelId,
      storedConfig
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
    return this.uiSettingsHelper.getNotificationsEnabled()
  }

  setNotificationsEnabled(enabled: boolean): void {
    this.uiSettingsHelper.setNotificationsEnabled(enabled)
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

        try {
          void presenter.floatingButtonPresenter.refreshTheme()
        } catch (error) {
          console.error('Failed to refresh floating widget theme:', error)
        }
      }
    })
  }

  async setTheme(theme: 'dark' | 'light' | 'system'): Promise<boolean> {
    nativeTheme.themeSource = theme
    this.setSetting('appTheme', theme)
    // 通知所有窗口主题已更改
    eventBus.sendToRenderer(CONFIG_EVENTS.THEME_CHANGED, SendTarget.ALL_WINDOWS, theme)

    try {
      void presenter.floatingButtonPresenter.refreshTheme()
    } catch (error) {
      console.error('Failed to refresh floating widget theme:', error)
    }

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

  // 获取所有自定义 prompts (with cache)
  async getCustomPrompts(): Promise<Prompt[]> {
    // Check cache first
    if (this.customPromptsCache !== null) {
      return this.customPromptsCache
    }

    // Load from store and cache it
    try {
      const prompts = this.customPromptsStore.get('prompts') || []
      this.customPromptsCache = prompts
      console.log(`[Config] Custom prompts cache loaded: ${prompts.length} prompts`)
      return prompts
    } catch (error) {
      console.error('[Config] Failed to load custom prompts:', error)
      this.customPromptsCache = []
      return []
    }
  }

  // 保存自定义 prompts (with cache update)
  async setCustomPrompts(prompts: Prompt[]): Promise<void> {
    await this.customPromptsStore.set('prompts', prompts)
    this.clearCustomPromptsCache()
    console.log(`[Config] Custom prompts cache updated: ${prompts.length} prompts`)
    // Notify all windows about custom prompts change
    eventBus.sendToRenderer(CONFIG_EVENTS.CUSTOM_PROMPTS_CHANGED, SendTarget.ALL_WINDOWS, {
      count: prompts.length
    })
  }

  // 添加单个 prompt (optimized with cache)
  async addCustomPrompt(prompt: Prompt): Promise<void> {
    const prompts = await this.getCustomPrompts()
    const updatedPrompts = [...prompts, prompt] // Create new array
    await this.setCustomPrompts(updatedPrompts)
    console.log(`[Config] Added custom prompt: ${prompt.name}`)
  }

  // 更新单个 prompt (optimized with cache)
  async updateCustomPrompt(promptId: string, updates: Partial<Prompt>): Promise<void> {
    const prompts = await this.getCustomPrompts()
    const index = prompts.findIndex((p) => p.id === promptId)
    if (index !== -1) {
      const updatedPrompts = [...prompts] // Create new array
      updatedPrompts[index] = { ...updatedPrompts[index], ...updates }
      await this.setCustomPrompts(updatedPrompts)
      console.log(`[Config] Updated custom prompt: ${promptId}`)
    } else {
      console.warn(`[Config] Custom prompt not found for update: ${promptId}`)
    }
  }

  // 删除单个 prompt (optimized with cache)
  async deleteCustomPrompt(promptId: string): Promise<void> {
    const prompts = await this.getCustomPrompts()
    const initialCount = prompts.length
    const filteredPrompts = prompts.filter((p) => p.id !== promptId)

    if (filteredPrompts.length === initialCount) {
      console.warn(`[Config] Custom prompt not found for deletion: ${promptId}`)
      return
    }

    await this.setCustomPrompts(filteredPrompts)
    console.log(`[Config] Deleted custom prompt: ${promptId}`)
  }

  /**
   * 清除自定义 prompts 缓存
   * 这将强制下次访问时重新加载
   */
  clearCustomPromptsCache(): void {
    console.log('[Config] Clearing custom prompts cache')
    this.customPromptsCache = null
  }

  // 获取默认系统提示词
  async getDefaultSystemPrompt(): Promise<string> {
    return this.systemPromptHelper.getDefaultSystemPrompt()
  }

  async setDefaultSystemPrompt(prompt: string): Promise<void> {
    return this.systemPromptHelper.setDefaultSystemPrompt(prompt)
  }

  async resetToDefaultPrompt(): Promise<void> {
    return this.systemPromptHelper.resetToDefaultPrompt()
  }

  async clearSystemPrompt(): Promise<void> {
    return this.systemPromptHelper.clearSystemPrompt()
  }

  async getSystemPrompts(): Promise<SystemPrompt[]> {
    return this.systemPromptHelper.getSystemPrompts()
  }

  async setSystemPrompts(prompts: SystemPrompt[]): Promise<void> {
    return this.systemPromptHelper.setSystemPrompts(prompts)
  }

  async addSystemPrompt(prompt: SystemPrompt): Promise<void> {
    return this.systemPromptHelper.addSystemPrompt(prompt)
  }

  async updateSystemPrompt(promptId: string, updates: Partial<SystemPrompt>): Promise<void> {
    return this.systemPromptHelper.updateSystemPrompt(promptId, updates)
  }

  async deleteSystemPrompt(promptId: string): Promise<void> {
    return this.systemPromptHelper.deleteSystemPrompt(promptId)
  }

  async setDefaultSystemPromptId(promptId: string): Promise<void> {
    return this.systemPromptHelper.setDefaultSystemPromptId(promptId)
  }

  async getDefaultSystemPromptId(): Promise<string> {
    return this.systemPromptHelper.getDefaultSystemPromptId()
  }

  // 获取更新渠道
  getUpdateChannel(): string {
    const raw = this.getSetting<string>('updateChannel') || 'stable'
    const channel = raw === 'stable' || raw === 'beta' ? raw : 'beta'
    if (channel !== raw) {
      this.setSetting('updateChannel', channel)
    }
    return channel
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

  // ===================== Nowledge-mem configuration methods =====================
  async getNowledgeMemConfig(): Promise<{
    baseUrl: string
    apiKey?: string
    timeout: number
  } | null> {
    try {
      return this.store.get('nowledgeMemConfig', null) as {
        baseUrl: string
        apiKey?: string
        timeout: number
      } | null
    } catch (error) {
      console.error('[Config] Failed to get nowledge-mem config:', error)
      return null
    }
  }

  async setNowledgeMemConfig(config: {
    baseUrl: string
    apiKey?: string
    timeout: number
  }): Promise<void> {
    try {
      this.store.set('nowledgeMemConfig', config)
      eventBus.sendToRenderer(
        CONFIG_EVENTS.NOWLEDGE_MEM_CONFIG_UPDATED,
        SendTarget.ALL_WINDOWS,
        config
      )
    } catch (error) {
      console.error('[Config] Failed to set nowledge-mem config:', error)
      throw error
    }
  }

  getHooksNotificationsConfig(): HooksNotificationsSettings {
    const raw = this.store.get('hooksNotifications')
    const normalized = normalizeHooksNotificationsConfig(raw)
    if (!raw || JSON.stringify(raw) !== JSON.stringify(normalized)) {
      this.store.set('hooksNotifications', normalized)
    }
    return normalized
  }

  setHooksNotificationsConfig(config: HooksNotificationsSettings): HooksNotificationsSettings {
    const normalized = normalizeHooksNotificationsConfig(config)
    this.store.set('hooksNotifications', normalized)
    return normalized
  }

  async testHookCommand(hookId: string): Promise<HookTestResult> {
    return await presenter.hooksNotifications.testHookCommand(hookId)
  }

  getDefaultModel(): { providerId: string; modelId: string } | undefined {
    const selection = this.getBuiltinDeepChatConfig().defaultModelPreset
    if (selection?.providerId && selection?.modelId) {
      return {
        providerId: selection.providerId,
        modelId: selection.modelId
      }
    }
    return this.store.get('defaultModel') as { providerId: string; modelId: string } | undefined
  }

  setDefaultModel(model: { providerId: string; modelId: string } | undefined): void {
    this.updateBuiltinDeepChatConfig({
      defaultModelPreset:
        model?.providerId && model?.modelId
          ? {
              providerId: model.providerId,
              modelId: model.modelId
            }
          : null
    })
    eventBus.sendToMain(CONFIG_EVENTS.SETTING_CHANGED, 'defaultModel', model)
  }

  getDefaultProjectPath(): string | null {
    const path = this.getSetting<string | null>('defaultProjectPath')
    return path?.trim() ? path.trim() : null
  }

  setDefaultProjectPath(projectPath: string | null): void {
    const normalized = projectPath?.trim() ? projectPath.trim() : null
    this.setSetting('defaultProjectPath', normalized)
    eventBus.sendToRenderer(CONFIG_EVENTS.DEFAULT_PROJECT_PATH_CHANGED, SendTarget.ALL_WINDOWS, {
      path: normalized
    })
  }
}

export { defaultShortcutKey } from './shortcutKeySettings'
