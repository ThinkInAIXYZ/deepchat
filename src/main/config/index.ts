import logger from '@shared/logger'
import {
  ConfigServicePort,
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  ModelConfigSource,
  RENDERER_MODEL_META,
  MCPServerConfig,
  Prompt,
  SystemPrompt,
  IModelConfig,
  AcpAgentConfig,
  AcpAgentInstallState,
  AcpAgentState,
  AcpManualAgent,
  AcpRegistryAgent,
  AcpResolvedLaunchSpec,
  ProviderDbRefreshResult
} from '@shared/presenter'
import type { BuiltinKnowledgeConfig } from '@shared/types/knowledge'
import { ProviderBatchUpdate, ProviderChange } from '@shared/provider-operations'
import { DEFAULT_DISABLED_AGENT_TOOLS } from '@shared/agentTools'
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
import ElectronStore from 'electron-store'
import { DEFAULT_PROVIDERS } from './providers'
import path from 'path'
import { isDeepStrictEqual } from 'node:util'
import { app, nativeTheme } from 'electron'
import fs from 'fs'
import { McpConfHelper } from './mcpConfHelper'
import { compare } from 'compare-versions'
import { ModelConfigHelper } from './modelConfig'
import { KnowledgeConfHelper } from './knowledgeConfHelper'
import { providerDbLoader } from './providerDbLoader'
import {
  ProviderAggregate,
  ReasoningPortrait,
  type ProviderModel,
  type ReasoningEffort,
  type Verbosity
} from '@shared/types/model-db'
import { modelCapabilities } from './modelCapabilities'
import { ProviderHelper } from './providerHelper'
import { ModelStatusHelper } from './modelStatusHelper'
import { ProviderModelHelper, PROVIDER_MODELS_DIR } from './providerModelHelper'
import { SystemPromptHelper, DEFAULT_SYSTEM_PROMPT } from './systemPromptHelper'
import { UiSettingsHelper } from './uiSettingsHelper'
import { AcpCatalogConfigAdapter } from './acpCatalogConfigAdapter'
import { AcpRegistryService } from '@/agent/acp/catalog/acpRegistryService'
import { AcpLaunchSpecService } from '@/agent/acp/launch/acpLaunchSpecService'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import { AgentRepository, BUILTIN_DEEPCHAT_AGENT_ID } from '@/agent/repository'
import { normalizeDeepChatSubagentConfig } from '@shared/lib/deepchatSubagents'
import type { SQLitePresenter } from '../presenter/sqlitePresenter'
import type { SettingsKey, SettingsSnapshotValues } from '@shared/contracts/routes'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import type { AgentCatalogEventSink } from '@/agent/shared/agentCatalogEventSink'
import {
  emitAcpAgentModelsChanged,
  emitAgentCatalogChanged,
  emitCustomPromptsChanged,
  emitLanguageChanged,
  emitModelConfigChanged,
  emitModelConfigReset,
  emitModelConfigsImported,
  emitModelsChanged,
  emitSystemThemeChanged,
  emitThemeChanged
} from './eventPublishers'
import type { HooksNotificationsSettings } from '@shared/hooksNotifications'
import type {
  Agent,
  AgentType,
  CreateDeepChatAgentInput,
  DeepChatAgentConfig,
  UpdateDeepChatAgentInput
} from '@shared/types/agent-interface'
import { createDefaultHooksNotificationsConfig } from '@/hook/config'
import {
  AcpDbStore,
  McpDbStore,
  ModelConfigDbStore,
  ProviderModelDbStore,
  SENSITIVE_APP_SETTING_KEYS
} from './configDbStores'
import type { StoreLike } from './storeLike'
import { SettingsStore } from './settingsStore'
import type { PrivacySettingsPort } from '@/app/privacy'

// Define application settings interface
interface IAppSettings {
  // Define your configuration items here, for example:
  language: string
  providers: LLM_PROVIDER[]
  closeToQuit: boolean // Whether to quit the program when clicking the close button
  appVersion?: string // Used for version checking and data migration
  proxyMode?: string // Proxy mode: system, none, custom
  customProxyUrl?: string // Custom proxy address
  artifactsEffectEnabled?: boolean // Whether artifacts animation effects are enabled
  searchPreviewEnabled?: boolean // Whether search preview is enabled
  contentProtectionEnabled?: boolean // Whether content protection is enabled
  privacyModeEnabled?: boolean // Whether privacy mode is enabled
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
const UNIFIED_AGENTS_MIGRATION_VERSION = 2
const DEPRECATED_BUILTIN_PROVIDER_IDS = ['qwenlm', 'laoshi'] as const
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
const MEMORY_MAINTENANCE_TRIGGER_CONFIG_KEYS: readonly (keyof DeepChatAgentConfig)[] = [
  'memoryEnabled',
  'memoryEmbedding',
  'memoryExtractionModel',
  'personaEvolutionEnabled',
  'assistantModel',
  'defaultModelPreset'
]

const findChangedAcpRegistryAgentIds = (
  previousAgents: AcpRegistryAgent[],
  nextAgents: AcpRegistryAgent[]
): string[] => {
  const nextById = new Map(nextAgents.map((agent) => [agent.id, agent] as const))
  return previousAgents
    .filter((agent) => !isDeepStrictEqual(agent, nextById.get(agent.id)))
    .map((agent) => agent.id)
}

const hasMemoryMaintenanceTriggerConfigUpdate = (
  updates: Partial<DeepChatAgentConfig> | null | undefined
): boolean => {
  if (!updates) return false
  return MEMORY_MAINTENANCE_TRIGGER_CONFIG_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(updates, key)
  )
}

const withDeepChatAgentDefaults = (config: DeepChatAgentConfig): DeepChatAgentConfig => ({
  ...config,
  disabledAgentTools: Array.isArray(config.disabledAgentTools)
    ? [...config.disabledAgentTools]
    : [...DEFAULT_DISABLED_AGENT_TOOLS]
})

const mergeDefaultDisabledAgentTools = (
  disabledAgentTools: DeepChatAgentConfig['disabledAgentTools']
): string[] =>
  Array.from(
    new Set([
      ...(Array.isArray(disabledAgentTools) ? disabledAgentTools : []),
      ...DEFAULT_DISABLED_AGENT_TOOLS
    ])
  )

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

const normalizeModelSelection = (value: unknown): ModelSelection | null => {
  if (!isModelSelection(value)) {
    return null
  }

  const providerId = normalizeKnownProviderId(value.providerId)
  const modelId = value.modelId.trim()

  if (!providerId || !modelId) {
    return null
  }

  return {
    providerId,
    modelId
  }
}

const isDeprecatedBuiltinProviderId = (
  providerId: string,
  deprecatedProviderIds: readonly string[] = DEPRECATED_BUILTIN_PROVIDER_IDS
): boolean => deprecatedProviderIds.includes(normalizeKnownProviderId(providerId))

const isDeprecatedBuiltinModelSelection = (
  selection: unknown,
  deprecatedProviderIds: readonly string[] = DEPRECATED_BUILTIN_PROVIDER_IDS
): boolean => {
  const normalizedSelection = normalizeModelSelection(selection)
  return Boolean(
    normalizedSelection &&
    isDeprecatedBuiltinProviderId(normalizedSelection.providerId, deprecatedProviderIds)
  )
}

const shouldReplaceBuiltinModelSelection = (
  builtinSelection: unknown,
  deprecatedProviderIds: readonly string[] = DEPRECATED_BUILTIN_PROVIDER_IDS
): boolean =>
  normalizeModelSelection(builtinSelection) === null ||
  isDeprecatedBuiltinModelSelection(builtinSelection, deprecatedProviderIds)

const getLiveLegacyModelSelection = (
  value: unknown,
  deprecatedProviderIds: readonly string[] = DEPRECATED_BUILTIN_PROVIDER_IDS
): ModelSelection | null => {
  const normalizedSelection = normalizeModelSelection(value)
  if (!normalizedSelection) {
    return null
  }

  return isDeprecatedBuiltinProviderId(normalizedSelection.providerId, deprecatedProviderIds)
    ? null
    : normalizedSelection
}

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
    case 'traceDebugEnabled':
      return {
        changedKey: 'traceDebugEnabled',
        value: Boolean(value)
      }
    case 'copyWithCotEnabled':
      return {
        changedKey: 'copyWithCotEnabled',
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

export function createSettingsStore(): SettingsStore {
  const userDataPath = app.getPath('userData')
  return new SettingsStore(
    new ElectronStore<IAppSettings>({
      name: 'app-settings',
      defaults: {
        language: 'system',
        providers: defaultProviders,
        closeToQuit: false,
        proxyMode: 'system',
        customProxyUrl: '',
        artifactsEffectEnabled: true,
        searchPreviewEnabled: true,
        contentProtectionEnabled: false,
        privacyModeEnabled: false,
        syncEnabled: false,
        syncFolderPath: path.join(userDataPath, 'sync'),
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
        appVersion: app.getVersion(),
        hooksNotifications: createDefaultHooksNotificationsConfig()
      }
    }) as unknown as StoreLike<Record<string, unknown>>
  )
}

export class ConfigService implements ConfigServicePort {
  private customPromptsStore: ElectronStore<{ prompts: Prompt[] }>
  private systemPromptsStore: ElectronStore<{ prompts: SystemPrompt[] }>
  private userDataPath: string
  private currentAppVersion: string
  private mcpConfHelper: McpConfHelper // Use MCP configuration helper
  private acpCatalogConfigAdapter: AcpCatalogConfigAdapter
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
  private readonly agentCatalogEventSink: AgentCatalogEventSink = {
    publishChanged: (agentIds) => emitAgentCatalogChanged(this, agentIds)
  }
  private pendingAgentCatalogChanged = false
  private pendingAcpAgentModelsChanged = false
  private isAttachingAgentRepository = false
  private deepChatAgentDeleteCleanup:
    | ((agentId: string) => Promise<{ cleanupPendingRestart: boolean }>)
    | null = null
  private deepChatAgentMemoryMaintenanceConfigChanged: ((agentId: string) => void) | null = null
  // Custom prompts cache for high-frequency read operations
  private customPromptsCache: Prompt[] | null = null
  private runtimeEffects!: {
    refreshFloatingLanguage(): void
    refreshTabLanguage(): Promise<void>
    refreshFloatingTheme(): Promise<void>
    applyProxyMode(mode: string): void
    applyCustomProxyUrl(url: string): void
    refreshAcpProviderAgents(agentIds?: string[]): Promise<void>
    replaceProviders(providers: LLM_PROVIDER[]): void
    applyProviderAtomicUpdate(change: ProviderChange): void
    applyProviderBatchUpdate(batchUpdate: ProviderBatchUpdate): void
    handleMcpConfigChanged(): void
  }
  private providerRuntimeReady = false

  constructor(
    private readonly store: SettingsStore,
    private readonly privacy: PrivacySettingsPort
  ) {
    this.userDataPath = app.getPath('userData')
    this.currentAppVersion = app.getVersion()
    this.providerHelper = new ProviderHelper({
      store: this.store,
      setSetting: this.setSetting.bind(this),
      defaultProviders,
      events: {
        providersChanged: (providers) => this.handleProvidersChanged(providers),
        providerAtomicUpdated: (change) => this.handleProviderAtomicUpdate(change),
        providerBatchUpdated: (batchUpdate) => this.handleProviderBatchUpdate(batchUpdate)
      }
    })

    this.modelStatusHelper = new ModelStatusHelper({
      store: this.store,
      setSetting: this.setSetting.bind(this)
    })

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

    this.acpCatalogConfigAdapter = new AcpCatalogConfigAdapter({
      mcpConfHelper: this.mcpConfHelper
    })
    this.acpRegistryService = new AcpRegistryService({
      isPrivacyModeEnabled: () => this.privacy.isEnabled()
    })
    this.acpLaunchSpecService = new AcpLaunchSpecService(
      path.join(this.userDataPath, 'acp-registry')
    )
    this.syncAcpProviderEnabled(this.acpCatalogConfigAdapter.getGlobalEnabled())
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
    providerDbLoader.setPrivacyModeResolver(() => this.privacy.isEnabled())
    providerDbLoader.initialize().catch((error) => {
      console.warn('[ConfigService] Failed to initialize provider DB:', error)
    })

    // If application version is updated, update appVersion
    if (this.store.get<string>('appVersion') !== this.currentAppVersion) {
      const oldVersion = this.store.get<string>('appVersion')
      this.store.set('appVersion', this.currentAppVersion)
      // Migrate data
      this.migrateConfigData(oldVersion)
      this.mcpConfHelper.onUpgrade(oldVersion)
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

  startRuntime(runtimeEffects: ConfigService['runtimeEffects']): void {
    this.runtimeEffects = runtimeEffects
    this.providerRuntimeReady = true
    this.runtimeEffects.replaceProviders(this.getProviders())
    void this.initTheme()

    let registryAgentsBeforeInitialization: AcpRegistryAgent[] = []
    try {
      registryAgentsBeforeInitialization = this.acpRegistryService.listAgents()
    } catch {
      // Initialization will report the missing registry snapshot below.
    }
    void this.acpRegistryService
      .initialize()
      .then(async () => {
        const registryAgents = this.acpRegistryService.listAgents()
        this.syncRegistryAgentsToRepository()
        const changedAgentIds = findChangedAcpRegistryAgentIds(
          registryAgentsBeforeInitialization,
          registryAgents
        )
        if (changedAgentIds.length > 0) {
          await this.refreshAcpProviderAgents(changedAgentIds)
        }
        this.notifyAcpAgentsChanged()
      })
      .catch((error) => {
        console.error('[ACP] Failed to initialize registry service:', error)
      })
  }

  private handleProvidersChanged(providers: LLM_PROVIDER[]): void {
    if (!this.providerRuntimeReady) {
      return
    }
    this.runtimeEffects.replaceProviders(providers)
  }

  private handleProviderAtomicUpdate(change: ProviderChange): void {
    if (!this.providerRuntimeReady) {
      return
    }
    this.runtimeEffects.applyProviderAtomicUpdate(change)
  }

  private handleProviderBatchUpdate(batchUpdate: ProviderBatchUpdate): void {
    if (!this.providerRuntimeReady) {
      return
    }
    this.runtimeEffects.applyProviderBatchUpdate(batchUpdate)
  }

  private async notifyMcpConfigChanged(): Promise<void> {
    const [mcpServers, mcpEnabled] = await Promise.all([this.getMcpServers(), this.getMcpEnabled()])
    publishDeepchatEvent('mcp.config.changed', {
      mcpServers,
      mcpEnabled,
      version: Date.now()
    })
    if (this.providerRuntimeReady) {
      this.runtimeEffects.handleMcpConfigChanged()
    }
  }

  setAgentRepository(agentRepository: AgentRepository): void {
    this.agentRepository = agentRepository
    this.isAttachingAgentRepository = true
    try {
      this.initializeUnifiedAgents()
      // The memory-maintenance callback is wired later by Presenter, so these migration writes may
      // intentionally no-op for maintenance arming during construction.
      this.reconcileLegacyBuiltinAgentSelections()
      this.cleanupDeprecatedBuiltinAgentSelections()
    } finally {
      this.isAttachingAgentRepository = false
      if (this.pendingAgentCatalogChanged) {
        const publishAcpModels = this.pendingAcpAgentModelsChanged
        this.pendingAgentCatalogChanged = false
        this.pendingAcpAgentModelsChanged = false
        queueMicrotask(() => {
          if (publishAcpModels) {
            this.notifyAcpAgentsChanged()
            return
          }
          this.notifyAgentCatalogChanged()
        })
      }
    }
  }

  setSQLitePresenter(sqlitePresenter: SQLitePresenter): void {
    try {
      this.migrateConfigStoresToSqlite(sqlitePresenter)
      this.migrateSensitiveConfigStoresToSqlite(sqlitePresenter)
      this.attachDbBackedConfigStores(sqlitePresenter)
    } catch (error) {
      console.error('[Config] Failed to attach sqlite-backed config storage:', error)
      throw error
    }
  }

  setDeepChatAgentDeleteCleanup(
    cleanup: (agentId: string) => Promise<{ cleanupPendingRestart: boolean }>
  ): void {
    this.deepChatAgentDeleteCleanup = cleanup
  }

  setDeepChatAgentMemoryMaintenanceConfigChanged(callback: (agentId: string) => void): void {
    this.deepChatAgentMemoryMaintenanceConfigChanged = callback
  }

  private notifyDeepChatAgentMemoryMaintenanceConfigChanged(agentId: string): void {
    try {
      this.deepChatAgentMemoryMaintenanceConfigChanged?.(agentId)
    } catch (error) {
      logger.warn(
        `[Config] DeepChat agent memory maintenance config callback failed: ${String(error)}`
      )
    }
  }

  cleanupLegacyProviderJsonForDatabaseEncryption(): number {
    if (!this.store.isDatabaseAttached) {
      return 0
    }

    const legacyProviders = this.store.getLegacy(PROVIDERS_STORE_KEY)
    if (!Array.isArray(legacyProviders) || legacyProviders.length === 0) {
      return 0
    }

    this.store.deleteLegacy(PROVIDERS_STORE_KEY)
    console.info('[Config] Removed legacy providers from app-settings JSON after SQLite migration')
    return legacyProviders.length
  }

  private migrateConfigStoresToSqlite(sqlitePresenter: SQLitePresenter): void {
    const configTables = sqlitePresenter.configTables
    if (configTables.hasConfigMigration()) {
      return
    }

    const providers = this.providerHelper.getProviders()
    const providerIds = providers.map((provider) => provider.id)
    const providerOrder = this.readLegacyStringArray('providerOrder') ?? providerIds
    const providerTimestamps = this.readLegacyNumberRecord('providerTimestamps')

    configTables.replaceProviders(providers, providerOrder, providerTimestamps)

    for (const provider of providers) {
      const store = this.providerModelHelper.getProviderModelStore(provider.id)
      const models = store.get<MODEL_META[]>('models', [])
      const customModels = store.get<MODEL_META[]>('custom_models', [])
      if (Array.isArray(models)) {
        configTables.replaceProviderModels(provider.id, 'provider', models)
      }
      if (Array.isArray(customModels)) {
        configTables.replaceProviderModels(provider.id, 'custom', customModels)
      }
    }

    for (const [statusKey, enabled] of this.readLegacyModelStatuses()) {
      const parsed = this.parseLegacyModelStatusKey(statusKey, providerIds)
      configTables.setModelStatus(statusKey, parsed.providerId, parsed.modelId, enabled)
    }

    const modelConfigs = this.modelConfigHelper.exportConfigs()
    for (const [cacheKey, config] of Object.entries(modelConfigs)) {
      configTables.setModelConfigStoreEntry(cacheKey, config)
    }

    const mcpStore = this.mcpConfHelper.getStoreForMigration()
    const mcpServers = mcpStore.get<Record<string, MCPServerConfig>>('mcpServers', {})
    if (mcpServers && typeof mcpServers === 'object' && !Array.isArray(mcpServers)) {
      configTables.replaceMcpServers(mcpServers)
    }

    for (const [key, value] of Object.entries(mcpStore.store)) {
      if (key === 'mcpServers') {
        continue
      }
      if (value !== undefined) {
        configTables.setMcpSetting(key, value)
      }
    }

    configTables.setAgentSetting('enabled', this.acpCatalogConfigAdapter.getGlobalEnabled())
    configTables.setAgentSetting('version', '4')
    configTables.setAgentMcpSelections(this.acpCatalogConfigAdapter.getSharedMcpSelections())
    configTables.markConfigMigrationApplied()
  }

  private migrateSensitiveConfigStoresToSqlite(sqlitePresenter: SQLitePresenter): void {
    const configTables = sqlitePresenter.configTables
    const migrationId = 'sensitive-config-sqlite-v1'
    if (configTables.hasConfigMigration(migrationId)) {
      return
    }

    for (const key of SENSITIVE_APP_SETTING_KEYS) {
      if (key === 'customPrompts' || key === 'systemPrompts' || key === 'knowledgeConfigs') {
        continue
      }
      const value = this.store.get(key)
      if (value !== undefined) {
        configTables.setAppSetting(key, value, true)
        this.store.delete(key)
      }
    }

    const customPrompts = this.customPromptsStore.get('prompts') || []
    configTables.setAppSetting('customPrompts', customPrompts, true)
    this.customPromptsStore.set('prompts', [])
    this.customPromptsCache = null

    const systemPrompts = this.systemPromptsStore.get('prompts') || []
    configTables.setAppSetting('systemPrompts', systemPrompts, true)
    this.systemPromptsStore.set('prompts', [])

    const knowledgeConfigs = this.knowledgeConfHelper.getKnowledgeConfigs()
    configTables.setAppSetting('knowledgeConfigs', knowledgeConfigs, true)
    this.knowledgeConfHelper.setKnowledgeConfigs([])

    configTables.markConfigMigrationApplied(migrationId)
  }

  private attachDbBackedConfigStores(sqlitePresenter: SQLitePresenter): void {
    const configTables = sqlitePresenter.configTables
    const legacyMcpStore = this.mcpConfHelper.getStoreForMigration()
    const legacyAcpStore = this.acpCatalogConfigAdapter.getStoreForMigration()

    this.store.attachDatabase(configTables)
    this.modelStatusHelper.clearModelStatusCache()
    this.providerModelHelper.setStoreFactory(
      (providerId) => new ProviderModelDbStore(providerId, configTables)
    )
    this.modelConfigHelper.setStore(
      new ModelConfigDbStore(configTables) as unknown as StoreLike<any>
    )
    this.mcpConfHelper.setStore(
      new McpDbStore(legacyMcpStore, configTables) as unknown as StoreLike<any>
    )
    this.acpCatalogConfigAdapter.setStore(
      new AcpDbStore(legacyAcpStore, configTables) as unknown as StoreLike<any>
    )
    this.providerHelper.getProviders()
    this.syncAcpProviderEnabled(this.acpCatalogConfigAdapter.getGlobalEnabled())
  }

  private readLegacyStringArray(key: string): string[] | null {
    const value = this.store.get(key)
    if (!Array.isArray(value)) {
      return null
    }
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  }

  private readLegacyNumberRecord(key: string): Record<string, number> {
    const value = this.store.get(key)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1])
      )
    )
  }

  private readLegacyModelStatuses(): Array<[string, boolean]> {
    const rawStore = this.store.store as Record<string, unknown>
    return Object.entries(rawStore).filter(
      (entry): entry is [string, boolean] =>
        entry[0].startsWith('model_status_') && typeof entry[1] === 'boolean'
    )
  }

  private parseLegacyModelStatusKey(
    statusKey: string,
    providerIds: string[]
  ): { providerId: string; modelId: string } {
    const suffix = statusKey.slice('model_status_'.length)
    const matchedProvider = [...providerIds]
      .sort((a, b) => b.length - a.length)
      .find((providerId) => suffix.startsWith(`${providerId}_`))

    if (matchedProvider) {
      return {
        providerId: matchedProvider,
        modelId: suffix.slice(matchedProvider.length + 1)
      }
    }

    const separatorIndex = suffix.indexOf('_')
    if (separatorIndex === -1) {
      return { providerId: '', modelId: suffix }
    }

    return {
      providerId: suffix.slice(0, separatorIndex),
      modelId: suffix.slice(separatorIndex + 1)
    }
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

    let migratedVersion = this.getSetting<number>('unifiedAgentsMigrationVersion') ?? 0
    let registryAgentsSynced = false
    if (migratedVersion < 1) {
      this.acpCatalogConfigAdapter.getManualAgents().forEach((agent) => {
        repository.createManualAcpAgent(agent)
      })

      this.syncRegistryAgentsToRepository(
        this.acpCatalogConfigAdapter.getRegistryStates(),
        this.acpCatalogConfigAdapter.getInstallStates()
      )
      registryAgentsSynced = true
      migratedVersion = 1
    }

    if (migratedVersion < 2) {
      for (const agent of repository.listAgents({ agentType: 'deepchat' })) {
        const config = repository.getDeepChatAgentConfig(agent.id) ?? {}
        if (agent.id !== BUILTIN_DEEPCHAT_AGENT_ID && !Array.isArray(config.disabledAgentTools)) {
          continue
        }

        const disabledAgentTools = mergeDefaultDisabledAgentTools(config.disabledAgentTools)
        if (
          !Array.isArray(config.disabledAgentTools) ||
          disabledAgentTools.length !== config.disabledAgentTools.length ||
          disabledAgentTools.some((tool) => !config.disabledAgentTools?.includes(tool))
        ) {
          repository.updateDeepChatAgent(agent.id, {
            config: { disabledAgentTools }
          })
        }
      }
      this.store.set('unifiedAgentsMigrationVersion', UNIFIED_AGENTS_MIGRATION_VERSION)
    }

    if (!registryAgentsSynced) {
      this.syncRegistryAgentsToRepository()
    }
  }

  private reconcileLegacyBuiltinAgentSelections(): void {
    const config = this.getBuiltinDeepChatConfig()
    const updates: Partial<DeepChatAgentConfig> = {}

    const legacyDefaultModel = getLiveLegacyModelSelection(
      this.store.get('defaultModel') as unknown
    )
    if (legacyDefaultModel && shouldReplaceBuiltinModelSelection(config.defaultModelPreset)) {
      updates.defaultModelPreset = legacyDefaultModel
    }

    const legacyAssistantModel = getLiveLegacyModelSelection(
      this.store.get('assistantModel') as unknown
    )
    if (legacyAssistantModel && shouldReplaceBuiltinModelSelection(config.assistantModel)) {
      updates.assistantModel = legacyAssistantModel
    }

    const legacyVisionSelection = this.store.get('defaultVisionModel') as unknown
    const legacyVisionModel = getLiveLegacyModelSelection(legacyVisionSelection)
    if (legacyVisionModel && shouldReplaceBuiltinModelSelection(config.visionModel)) {
      updates.visionModel = legacyVisionModel
    }

    if (Object.keys(updates).length > 0) {
      this.updateBuiltinDeepChatConfig(updates)
    }

    if (legacyVisionSelection !== undefined) {
      this.store.delete('defaultVisionModel')
    }
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
      disabledAgentTools: [...DEFAULT_DISABLED_AGENT_TOOLS],
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
    return withDeepChatAgentDefaults(
      this.agentRepository?.resolveDeepChatAgentConfig(BUILTIN_DEEPCHAT_AGENT_ID) ?? {}
    )
  }

  private updateBuiltinDeepChatConfig(updates: Partial<DeepChatAgentConfig>): void {
    if (!this.agentRepository) {
      return
    }

    const updated = this.agentRepository.updateDeepChatAgent(BUILTIN_DEEPCHAT_AGENT_ID, {
      config: updates
    })
    if (updated && hasMemoryMaintenanceTriggerConfigUpdate(updates)) {
      this.notifyDeepChatAgentMemoryMaintenanceConfigChanged(BUILTIN_DEEPCHAT_AGENT_ID)
    }
    this.notifyAgentCatalogChanged()
  }

  private cleanupDeprecatedBuiltinAgentSelections(): void {
    const config = this.getBuiltinDeepChatConfig()
    const updates: Partial<DeepChatAgentConfig> = {}

    if (isDeprecatedBuiltinModelSelection(config.defaultModelPreset)) {
      updates.defaultModelPreset = null
    }

    if (isDeprecatedBuiltinModelSelection(config.assistantModel)) {
      updates.assistantModel = null
    }

    if (isDeprecatedBuiltinModelSelection(config.visionModel)) {
      updates.visionModel = null
    }

    if (isDeprecatedBuiltinModelSelection(config.imageGenerationModel)) {
      updates.imageGenerationModel = null
    }

    if (Object.keys(updates).length > 0) {
      this.updateBuiltinDeepChatConfig(updates)
    }
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
      return this.store.get<T>(key)
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
          return
        }
        if (key === 'default_system_prompt') {
          this.updateBuiltinDeepChatConfig({
            systemPrompt: typeof value === 'string' ? value : ''
          })
          return
        }
      }

      this.store.set(key, value)

      const trackedChange = toTrackedSettingsChangePayload(key, value)
      if (trackedChange) {
        publishDeepchatEvent('settings.changed', {
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
    emitLanguageChanged(this)

    try {
      this.runtimeEffects.refreshFloatingLanguage()
    } catch (error) {
      console.error('Failed to refresh floating widget language:', error)
    }
    void this.runtimeEffects
      .refreshTabLanguage()
      .catch((error) => console.error('Failed to refresh tab language:', error))
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
      'he-IL',
      'es-ES',
      'de-DE',
      'tr-TR',
      'id-ID',
      'ms-MY',
      'it-IT',
      'pl-PL',
      'vi-VN'
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
    this.runtimeEffects.applyProxyMode(mode)
  }

  // Get custom proxy address
  getCustomProxyUrl(): string {
    return this.getSetting<string>('customProxyUrl') || ''
  }

  // Set custom proxy address
  setCustomProxyUrl(url: string): void {
    this.setSetting('customProxyUrl', url)
    this.runtimeEffects.applyCustomProxyUrl(url)
  }

  // Get search preview setting status
  getCopyWithCotEnabled(): boolean {
    return this.uiSettingsHelper.getCopyWithCotEnabled()
  }

  setCopyWithCotEnabled(enabled: boolean): void {
    this.uiSettingsHelper.setCopyWithCotEnabled(enabled)
  }

  setTraceDebugEnabled(enabled: boolean): void {
    this.uiSettingsHelper.setTraceDebugEnabled(enabled)
  }

  // ===================== MCP configuration related methods =====================

  // Get MCP server configuration
  async getMcpServers(): Promise<Record<string, MCPServerConfig>> {
    return await this.mcpConfHelper.getMcpServers()
  }

  // Set MCP server configuration
  async setMcpServers(servers: Record<string, MCPServerConfig>): Promise<void> {
    await this.mcpConfHelper.setMcpServers(servers)
    await this.notifyMcpConfigChanged()
  }

  getEnabledMcpServers(): Promise<string[]> {
    return this.mcpConfHelper.getEnabledMcpServers()
  }

  async setMcpServerEnabled(serverName: string, enabled: boolean): Promise<void> {
    await this.mcpConfHelper.setMcpServerEnabled(serverName, enabled)
    await this.notifyMcpConfigChanged()
  }

  // Get MCP enabled status
  getMcpEnabled(): Promise<boolean> {
    return this.mcpConfHelper.getMcpEnabled()
  }

  // Set MCP enabled status
  async setMcpEnabled(enabled: boolean): Promise<void> {
    await this.mcpConfHelper.setMcpEnabled(enabled)
    await this.notifyMcpConfigChanged()
  }

  // Add MCP server
  async addMcpServer(name: string, config: MCPServerConfig): Promise<boolean> {
    const added = await this.mcpConfHelper.addMcpServer(name, config)
    await this.notifyMcpConfigChanged()
    return added
  }

  // Remove MCP server
  async removeMcpServer(name: string): Promise<void> {
    await this.mcpConfHelper.removeMcpServer(name)
    await this.notifyMcpConfigChanged()
  }

  // Update MCP server configuration
  async updateMcpServer(name: string, config: Partial<MCPServerConfig>): Promise<void> {
    await this.mcpConfHelper.updateMcpServer(name, config)
    await this.notifyMcpConfigChanged()
  }

  private syncAcpProviderEnabled(enabled: boolean): void {
    const provider = this.getProviderById('acp')
    if (!provider || provider.enable === enabled) {
      return
    }
    logger.info(`[ACP] syncAcpProviderEnabled: updating provider enable state to ${enabled}`)
    this.updateProviderAtomic('acp', { enable: enabled })
  }

  async getAcpEnabled(): Promise<boolean> {
    return this.acpCatalogConfigAdapter.getGlobalEnabled()
  }

  async setAcpEnabled(enabled: boolean): Promise<void> {
    const enabledAgentIds = enabled ? [] : (await this.getAcpAgents()).map((agent) => agent.id)
    const changed = this.acpCatalogConfigAdapter.setGlobalEnabled(enabled)
    if (!changed) return

    logger.info('[ACP] setAcpEnabled: updating global toggle to', enabled)
    if (!enabled && enabledAgentIds.length > 0) {
      await this.refreshAcpProviderAgents(enabledAgentIds)
    }
    this.syncAcpProviderEnabled(enabled)

    if (!enabled) {
      logger.info('[ACP] Disabling: clearing provider models and status cache')
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
        enabled: this.acpCatalogConfigAdapter.getRegistryStates()[agent.id]?.enabled ?? false,
        envOverride: this.acpCatalogConfigAdapter.getRegistryStates()[agent.id]?.envOverride,
        installState: this.acpCatalogConfigAdapter.getInstallStates()[agent.id] ?? null
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
    const previousAgents = this.acpRegistryService.listAgents()
    const refreshedAgents = await this.acpRegistryService.refresh(force)
    this.syncRegistryAgentsToRepository()
    const changedAgentIds = findChangedAcpRegistryAgentIds(previousAgents, refreshedAgents)
    if (changedAgentIds.length > 0) {
      await this.refreshAcpProviderAgents(changedAgentIds)
    }
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
    this.notifyAcpAgentsChanged([registryAgent.id])

    try {
      const installedState = await this.acpLaunchSpecService.ensureRegistryAgentInstalled(
        registryAgent,
        currentState
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
      this.notifyAcpAgentsChanged([registryAgent.id])
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
    this.notifyAcpAgentsChanged([registryAgent.id])
    await this.refreshAcpProviderAgents([registryAgent.id])

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
      this.notifyAcpAgentsChanged([registryAgent.id])
      throw error
    }
  }

  async uninstallAcpRegistryAgent(agentId: string): Promise<void> {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const registryAgent = this.getRegistryAgentOrThrow(resolvedId)
    const agentRepository = this.getAgentRepositoryOrThrow()
    if (agentRepository.hasAgentSessions(registryAgent.id)) {
      throw new Error(
        'ACP registry agent still has related conversations. Move or delete them first.'
      )
    }

    const currentState = agentRepository.getAgentInstallState(registryAgent.id)

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

    const updated = agentRepository.clearRegistryAcpAgentInstallation(
      registryAgent.id,
      uninstalledState
    )
    if (!updated) {
      throw new Error(
        `ACP registry agent not found or still has related conversations: ${registryAgent.id}`
      )
    }

    this.handleAcpAgentsMutated([registryAgent.id])
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
    const acpEnabled = this.acpCatalogConfigAdapter.getGlobalEnabled()
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
    return this.acpCatalogConfigAdapter.getSharedMcpSelections()
  }

  async setAcpSharedMcpSelections(mcpIds: string[]): Promise<void> {
    await this.acpCatalogConfigAdapter.setSharedMcpSelections(mcpIds)
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
    const config = this.getAgentRepositoryOrThrow().getDeepChatAgentConfig(agentId)
    return config ? withDeepChatAgentDefaults(config) : null
  }

  async resolveDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig> {
    return withDeepChatAgentDefaults(
      this.getAgentRepositoryOrThrow().resolveDeepChatAgentConfig(
        agentId || BUILTIN_DEEPCHAT_AGENT_ID
      )
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
    this.notifyAgentCatalogChanged()
    return created
  }

  async updateDeepChatAgent(
    agentId: string,
    updates: UpdateDeepChatAgentInput
  ): Promise<Agent | null> {
    const updated = this.getAgentRepositoryOrThrow().updateDeepChatAgent(agentId, updates)
    if (updated) {
      if (hasMemoryMaintenanceTriggerConfigUpdate(updates.config)) {
        this.notifyDeepChatAgentMemoryMaintenanceConfigChanged(agentId)
      }
      this.notifyAgentCatalogChanged()
    }
    return updated
  }

  async deleteDeepChatAgent(agentId: string): Promise<boolean> {
    return (await this.deleteDeepChatAgentWithCleanup(agentId)).removed
  }

  async deleteDeepChatAgentWithCleanup(
    agentId: string
  ): Promise<{ removed: boolean; cleanupPendingRestart: boolean }> {
    const repository = this.getAgentRepositoryOrThrow()
    if (!repository.canDeleteDeepChatAgent(agentId)) {
      return { removed: false, cleanupPendingRestart: false }
    }
    const cleanup = this.deepChatAgentDeleteCleanup
      ? await this.deepChatAgentDeleteCleanup(agentId)
      : { cleanupPendingRestart: false }
    const removed = repository.deleteDeepChatAgent(agentId)
    if (removed) {
      this.notifyAgentCatalogChanged()
    }
    return {
      removed,
      cleanupPendingRestart: removed && cleanup.cleanupPendingRestart
    }
  }

  async getAgentMcpSelections(agentId: string, isBuiltin?: boolean): Promise<string[]> {
    return await this.acpCatalogConfigAdapter.getAgentMcpSelections(agentId, isBuiltin)
  }

  async setAgentMcpSelections(
    agentId: string,
    isBuiltin: boolean,
    mcpIds: string[]
  ): Promise<void> {
    await this.acpCatalogConfigAdapter.setAgentMcpSelections(agentId, isBuiltin, mcpIds)
    this.handleAcpAgentsMutated()
  }

  async addMcpToAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void> {
    await this.acpCatalogConfigAdapter.addMcpToAgent(agentId, isBuiltin, mcpId)
    this.handleAcpAgentsMutated()
  }

  async removeMcpFromAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void> {
    await this.acpCatalogConfigAdapter.removeMcpFromAgent(agentId, isBuiltin, mcpId)
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
    this.notifyAcpAgentsChanged(agentIds)
    void this.refreshAcpProviderAgents(agentIds)
  }

  private async refreshAcpProviderAgents(agentIds?: string[]): Promise<void> {
    try {
      await this.runtimeEffects.refreshAcpProviderAgents(agentIds)
    } catch (error) {
      console.warn('[ACP] Failed to refresh agent processes after config change:', error)
    }
  }

  private notifyAcpAgentsChanged(agentIds?: string[]) {
    if (!this.agentRepository || this.isAttachingAgentRepository) {
      this.pendingAgentCatalogChanged = true
      this.pendingAcpAgentModelsChanged = true
      logger.info('[ACP] agent changes deferred until unified agent repository is attached')
      return
    }

    emitModelsChanged('acp')
    this.agentCatalogEventSink.publishChanged(agentIds)
    emitAcpAgentModelsChanged()
    this.publishAgentSessionListRefreshed()
  }

  notifyAgentCatalogChanged(agentIds?: string[]) {
    if (!this.agentRepository || this.isAttachingAgentRepository) {
      this.pendingAgentCatalogChanged = true
      logger.info('Agent catalog change deferred until unified agent repository is attached')
      return
    }

    this.agentCatalogEventSink.publishChanged(agentIds)
    this.publishAgentSessionListRefreshed()
  }

  private publishAgentSessionListRefreshed(): void {
    publishDeepchatEvent('sessions.updated', {
      sessionIds: [],
      reason: 'list-refreshed'
    })
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
    this.providerModelHelper.invalidateProviderModelsCache(providerId)
    emitModelConfigChanged(providerId, modelId, storedConfig as unknown as Record<string, unknown>)
  }

  /**
   * Reset model configuration for a specific provider and model
   * @param modelId - The model ID
   * @param providerId - The provider ID
   */
  resetModelConfig(modelId: string, providerId: string): void {
    this.modelConfigHelper.resetModelConfig(modelId, providerId)
    this.providerModelHelper.invalidateProviderModelsCache(providerId)
    emitModelConfigReset(providerId, modelId)
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
    emitModelConfigsImported(overwrite)
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
        emitSystemThemeChanged(nativeTheme.shouldUseDarkColors)

        try {
          void this.runtimeEffects.refreshFloatingTheme()
        } catch (error) {
          console.error('Failed to refresh floating widget theme:', error)
        }
      }
    })
  }

  async setTheme(theme: 'dark' | 'light' | 'system'): Promise<boolean> {
    nativeTheme.themeSource = theme
    this.setSetting('appTheme', theme)
    emitThemeChanged(this)

    try {
      void this.runtimeEffects.refreshFloatingTheme()
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

  // 获取所有自定义 prompts (with cache)
  async getCustomPrompts(): Promise<Prompt[]> {
    // Check cache first
    if (this.customPromptsCache !== null) {
      return this.customPromptsCache
    }

    // Load from store and cache it
    try {
      const prompts = this.store.isDatabaseAttached
        ? this.getSetting<Prompt[]>('customPrompts') || []
        : this.customPromptsStore.get('prompts') || []
      this.customPromptsCache = prompts
      logger.info(`[Config] Custom prompts cache loaded: ${prompts.length} prompts`)
      return prompts
    } catch (error) {
      console.error('[Config] Failed to load custom prompts:', error)
      this.customPromptsCache = []
      return []
    }
  }

  // 保存自定义 prompts (with cache update)
  async setCustomPrompts(prompts: Prompt[]): Promise<void> {
    if (this.store.isDatabaseAttached) {
      this.setSetting('customPrompts', prompts)
    } else {
      await this.customPromptsStore.set('prompts', prompts)
    }
    this.clearCustomPromptsCache()
    logger.info(`[Config] Custom prompts cache updated: ${prompts.length} prompts`)
    await emitCustomPromptsChanged(this)
  }

  // 添加单个 prompt (optimized with cache)
  async addCustomPrompt(prompt: Prompt): Promise<void> {
    const prompts = await this.getCustomPrompts()
    const updatedPrompts = [...prompts, prompt] // Create new array
    await this.setCustomPrompts(updatedPrompts)
    logger.info(`[Config] Added custom prompt: ${prompt.name}`)
  }

  // 更新单个 prompt (optimized with cache)
  async updateCustomPrompt(promptId: string, updates: Partial<Prompt>): Promise<void> {
    const prompts = await this.getCustomPrompts()
    const index = prompts.findIndex((p) => p.id === promptId)
    if (index !== -1) {
      const updatedPrompts = [...prompts] // Create new array
      updatedPrompts[index] = { ...updatedPrompts[index], ...updates }
      await this.setCustomPrompts(updatedPrompts)
      logger.info(`[Config] Updated custom prompt: ${promptId}`)
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
    logger.info(`[Config] Deleted custom prompt: ${promptId}`)
  }

  /**
   * 清除自定义 prompts 缓存
   * 这将强制下次访问时重新加载
   */
  clearCustomPromptsCache(): void {
    logger.info('[Config] Clearing custom prompts cache')
    this.customPromptsCache = null
  }

  // 获取默认系统提示词
  async getDefaultSystemPrompt(): Promise<string> {
    if (this.store.isDatabaseAttached) {
      const prompts = await this.getSystemPrompts()
      const defaultPrompt = prompts.find((prompt) => prompt.isDefault)
      return defaultPrompt?.content ?? this.getSetting<string>('default_system_prompt') ?? ''
    }
    return this.systemPromptHelper.getDefaultSystemPrompt()
  }

  async setDefaultSystemPrompt(prompt: string): Promise<void> {
    if (this.store.isDatabaseAttached) {
      this.setSetting('default_system_prompt', prompt)
      await this.publishSystemPromptState()
      return
    }
    return this.systemPromptHelper.setDefaultSystemPrompt(prompt)
  }

  async resetToDefaultPrompt(): Promise<void> {
    if (this.store.isDatabaseAttached) {
      this.setSetting('default_system_prompt', DEFAULT_SYSTEM_PROMPT)
      await this.publishSystemPromptState()
      return
    }
    return this.systemPromptHelper.resetToDefaultPrompt()
  }

  async clearSystemPrompt(): Promise<void> {
    if (this.store.isDatabaseAttached) {
      this.setSetting('default_system_prompt', '')
      await this.publishSystemPromptState()
      return
    }
    return this.systemPromptHelper.clearSystemPrompt()
  }

  async getSystemPrompts(): Promise<SystemPrompt[]> {
    if (this.store.isDatabaseAttached) {
      return this.getSetting<SystemPrompt[]>('systemPrompts') || []
    }
    return this.systemPromptHelper.getSystemPrompts()
  }

  async setSystemPrompts(prompts: SystemPrompt[]): Promise<void> {
    if (!this.store.isDatabaseAttached) {
      return this.systemPromptHelper.setSystemPrompts(prompts)
    }

    this.setSetting('systemPrompts', prompts)
    publishDeepchatEvent('config.systemPrompts.changed', {
      prompts,
      defaultPromptId: await this.getDefaultSystemPromptId(),
      prompt: await this.getDefaultSystemPrompt(),
      version: Date.now()
    })
  }

  async addSystemPrompt(prompt: SystemPrompt): Promise<void> {
    if (this.store.isDatabaseAttached) {
      const prompts = await this.getSystemPrompts()
      await this.setSystemPrompts([...prompts, prompt])
      return
    }
    return this.systemPromptHelper.addSystemPrompt(prompt)
  }

  async updateSystemPrompt(promptId: string, updates: Partial<SystemPrompt>): Promise<void> {
    if (this.store.isDatabaseAttached) {
      const prompts = await this.getSystemPrompts()
      const index = prompts.findIndex((prompt) => prompt.id === promptId)
      if (index === -1) {
        return
      }
      const nextPrompts = [...prompts]
      nextPrompts[index] = { ...nextPrompts[index], ...updates }
      await this.setSystemPrompts(nextPrompts)
      return
    }
    return this.systemPromptHelper.updateSystemPrompt(promptId, updates)
  }

  async deleteSystemPrompt(promptId: string): Promise<void> {
    if (this.store.isDatabaseAttached) {
      const prompts = await this.getSystemPrompts()
      await this.setSystemPrompts(prompts.filter((prompt) => prompt.id !== promptId))
      return
    }
    return this.systemPromptHelper.deleteSystemPrompt(promptId)
  }

  async setDefaultSystemPromptId(promptId: string): Promise<void> {
    if (this.store.isDatabaseAttached) {
      const prompts = await this.getSystemPrompts()
      const updatedPrompts = prompts.map((prompt) => ({ ...prompt, isDefault: false }))

      if (promptId === 'empty') {
        await this.setSystemPrompts(updatedPrompts)
        await this.clearSystemPrompt()
        await this.publishSystemPromptState()
        return
      }

      const targetIndex = updatedPrompts.findIndex((prompt) => prompt.id === promptId)
      if (targetIndex !== -1) {
        updatedPrompts[targetIndex].isDefault = true
        await this.setSystemPrompts(updatedPrompts)
        await this.setDefaultSystemPrompt(updatedPrompts[targetIndex].content)
        await this.publishSystemPromptState()
      } else {
        await this.setSystemPrompts(updatedPrompts)
      }
      return
    }
    return this.systemPromptHelper.setDefaultSystemPromptId(promptId)
  }

  async getDefaultSystemPromptId(): Promise<string> {
    if (this.store.isDatabaseAttached) {
      const prompts = await this.getSystemPrompts()
      const defaultPrompt = prompts.find((prompt) => prompt.isDefault)
      if (defaultPrompt) {
        return defaultPrompt.id
      }

      const storedPrompt = this.getSetting<string>('default_system_prompt')
      if (!storedPrompt || storedPrompt.trim() === '') {
        return 'empty'
      }

      return prompts.find((prompt) => prompt.id === 'default')?.id || 'default'
    }
    return this.systemPromptHelper.getDefaultSystemPromptId()
  }

  private async publishSystemPromptState(): Promise<void> {
    publishDeepchatEvent('config.systemPrompts.changed', {
      prompts: await this.getSystemPrompts(),
      defaultPromptId: await this.getDefaultSystemPromptId(),
      prompt: await this.getDefaultSystemPrompt(),
      version: Date.now()
    })
  }

  // 获取知识库配置
  getKnowledgeConfigs(): BuiltinKnowledgeConfig[] {
    const configs = this.store.isDatabaseAttached
      ? this.getSetting<BuiltinKnowledgeConfig[]>('knowledgeConfigs') || []
      : this.knowledgeConfHelper.getKnowledgeConfigs()
    const migratedConfigs = this.mcpConfHelper.migrateBuiltinKnowledgeConfigsFromEnv(configs)

    if (migratedConfigs !== configs) {
      if (this.store.isDatabaseAttached) {
        this.setSetting('knowledgeConfigs', migratedConfigs)
      } else {
        this.knowledgeConfHelper.setKnowledgeConfigs(migratedConfigs)
      }
    }

    return migratedConfigs
  }

  // 设置知识库配置
  setKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): void {
    if (this.store.isDatabaseAttached) {
      this.setSetting('knowledgeConfigs', configs)
    } else {
      this.knowledgeConfHelper.setKnowledgeConfigs(configs)
    }
    void this.notifyMcpConfigChanged().catch((error) => {
      console.error('Failed to notify MCP config change after knowledge config update:', error)
    })
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
    return KnowledgeConfHelper.diffKnowledgeConfigs(this.getKnowledgeConfigs(), newConfigs)
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
    const result = await this.mcpConfHelper.batchImportMcpServers(servers, options)
    await this.notifyMcpConfigChanged()
    return result
  }

  // 根据包名查找服务器
  async findMcpServerByPackage(packageName: string): Promise<string | null> {
    return this.mcpConfHelper.findServerByPackage(packageName)
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
  }
}
