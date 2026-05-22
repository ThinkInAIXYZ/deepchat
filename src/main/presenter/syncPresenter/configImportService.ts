import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { IModelConfig, LLM_PROVIDER, MCPServerConfig, MODEL_META } from '@shared/presenter'
import { ConfigTables } from '../sqlitePresenter/tables/configTables'
import { openSQLiteDatabase } from '../sqlitePresenter'

export const CURRENT_SYNC_BACKUP_VERSION = 2
export const CURRENT_SYNC_CONFIG_SCHEMA_VERSION = 1

export type SyncBackupManifest = {
  version: number
  createdAt?: number
  files?: string[]
  configStorage?: 'sqlite' | string
  configSchemaVersion?: number
  databaseEncrypted?: boolean
  databaseCipher?: 'sqlcipher' | string
}

export type SyncConfigImportMode = 'increment' | 'overwrite'

type ProviderModelsPayload = {
  providerId: string
  source: 'provider' | 'custom'
  models: MODEL_META[]
}

type ModelStatusPayload = {
  statusKey: string
  providerId: string
  modelId: string
  enabled: boolean
}

type LegacyConfigPayload = {
  providers: LLM_PROVIDER[]
  providerOrder: string[]
  providerTimestamps: Record<string, number>
  providerModels: ProviderModelsPayload[]
  modelStatuses: ModelStatusPayload[]
  modelConfigs: Record<string, IModelConfig | Record<string, unknown>>
  mcpServers: Record<string, MCPServerConfig>
  mcpSettings: Record<string, unknown>
  agentSettings: Record<string, unknown>
  appSettings: Record<string, unknown>
  customPrompts: Array<Record<string, unknown>>
  systemPrompts: Array<Record<string, unknown>>
  sharedAgentMcpSelections: string[]
  sections: {
    providers: boolean
    providerModels: boolean
    modelStatuses: boolean
    modelConfigs: boolean
    mcp: boolean
    acp: boolean
    sensitiveAppSettings: boolean
    customPrompts: boolean
    systemPrompts: boolean
  }
}

const LEGACY_CONFIG_PATHS = {
  appSettings: path.join('configs', 'app-settings.json'),
  customPrompts: path.join('configs', 'custom_prompts.json'),
  systemPrompts: path.join('configs', 'system_prompts.json'),
  mcpSettings: path.join('configs', 'mcp-settings.json'),
  modelConfig: path.join('configs', 'model-config.json'),
  acpAgents: path.join('configs', 'acp_agents.json'),
  providerModelsDir: path.join('configs', 'provider_models')
}

const LEGACY_MCP_SETTING_EXCLUDE_KEYS = new Set(['mcpServers', 'defaultServer', 'defaultServers'])
const LEGACY_SENSITIVE_APP_SETTING_KEYS = [
  'remoteControl',
  'mcprouterApiKey',
  'nowledgeMemConfig',
  'hooksNotifications'
]
const LEGACY_SENSITIVE_SQLITE_KEYS = [
  ...LEGACY_SENSITIVE_APP_SETTING_KEYS,
  'customPrompts',
  'systemPrompts'
]

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

const normalizeNumberRecord = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1])
    )
  )
}

const getStatusKey = (providerId: string, modelId: string): string =>
  `model_status_${providerId}_${modelId.replace(/\./g, '-')}`

export class SyncConfigImportService {
  constructor(
    private readonly targetDbPath: string,
    private readonly openDatabase: (dbPath: string) => Database.Database = openSQLiteDatabase
  ) {}

  readManifest(extractionDir: string): SyncBackupManifest | null {
    return this.readJsonFile<SyncBackupManifest>(path.join(extractionDir, 'manifest.json'))
  }

  importLegacyConfig(extractionDir: string, mode: SyncConfigImportMode): void {
    const payload = this.readLegacyConfigPayload(extractionDir)
    if (!this.hasPayloadData(payload)) {
      return
    }

    const db = this.openDatabase(this.targetDbPath)
    try {
      const configTables = new ConfigTables(db)
      configTables.createTable()
      this.applyLegacyConfigPayload(configTables, payload, mode)
      configTables.markConfigMigrationApplied()
    } finally {
      db.close()
    }
  }

  ensureConfigMigrationMarker(): void {
    const db = this.openDatabase(this.targetDbPath)
    try {
      const configTables = new ConfigTables(db)
      configTables.createTable()
      configTables.markConfigMigrationApplied()
    } finally {
      db.close()
    }
  }

  private readLegacyConfigPayload(extractionDir: string): LegacyConfigPayload {
    const payload: LegacyConfigPayload = {
      providers: [],
      providerOrder: [],
      providerTimestamps: {},
      providerModels: [],
      modelStatuses: [],
      modelConfigs: {},
      mcpServers: {},
      mcpSettings: {},
      agentSettings: {},
      appSettings: {},
      customPrompts: [],
      systemPrompts: [],
      sharedAgentMcpSelections: [],
      sections: {
        providers: false,
        providerModels: false,
        modelStatuses: false,
        modelConfigs: false,
        mcp: false,
        acp: false,
        sensitiveAppSettings: false,
        customPrompts: false,
        systemPrompts: false
      }
    }

    this.readLegacyAppSettings(extractionDir, payload)
    this.readLegacyProviderModelStores(extractionDir, payload)
    this.readLegacyModelConfig(extractionDir, payload)
    this.readLegacyMcpSettings(extractionDir, payload)
    this.readLegacyAcpAgents(extractionDir, payload)
    this.readLegacyPromptStores(extractionDir, payload)

    return payload
  }

  private readLegacyAppSettings(extractionDir: string, payload: LegacyConfigPayload): void {
    const appSettings = this.readJsonFile<Record<string, unknown>>(
      path.join(extractionDir, LEGACY_CONFIG_PATHS.appSettings)
    )
    if (!appSettings) {
      return
    }

    if (Array.isArray(appSettings.providers)) {
      payload.sections.providers = true
      payload.providers = appSettings.providers.filter(this.isProvider)
    }
    if (Array.isArray(appSettings.providerOrder) || isRecord(appSettings.providerTimestamps)) {
      payload.sections.providers = true
    }
    payload.providerOrder = normalizeStringArray(appSettings.providerOrder)
    payload.providerTimestamps = normalizeNumberRecord(appSettings.providerTimestamps)

    const providerIds = this.collectProviderIds(payload, appSettings)
    for (const [key, value] of Object.entries(appSettings)) {
      if (LEGACY_SENSITIVE_APP_SETTING_KEYS.includes(key) && value !== undefined) {
        payload.sections.sensitiveAppSettings = true
        payload.appSettings[key] = clone(value)
        continue
      }

      if (key.startsWith('model_status_') && typeof value === 'boolean') {
        payload.sections.modelStatuses = true
        const parsed = this.parseModelStatusKey(key, providerIds)
        payload.modelStatuses.push({
          statusKey: key,
          providerId: parsed.providerId,
          modelId: parsed.modelId,
          enabled: value
        })
        continue
      }

      if (key.startsWith('custom_models_') && Array.isArray(value)) {
        payload.sections.providerModels = true
        const providerId = key.slice('custom_models_'.length)
        this.addProviderModels(payload, providerId, 'custom', value)
        continue
      }

      if (key.endsWith('_models') && Array.isArray(value)) {
        payload.sections.providerModels = true
        const providerId = key.slice(0, -'_models'.length)
        if (providerId) {
          this.addProviderModels(payload, providerId, 'provider', value)
        }
      }
    }
  }

  private readLegacyPromptStores(extractionDir: string, payload: LegacyConfigPayload): void {
    const customPrompts = this.readPromptStore(
      path.join(extractionDir, LEGACY_CONFIG_PATHS.customPrompts)
    )
    if (customPrompts) {
      payload.sections.customPrompts = true
      payload.customPrompts = customPrompts
    }

    const systemPrompts = this.readPromptStore(
      path.join(extractionDir, LEGACY_CONFIG_PATHS.systemPrompts)
    )
    if (systemPrompts) {
      payload.sections.systemPrompts = true
      payload.systemPrompts = systemPrompts
    }
  }

  private readLegacyProviderModelStores(extractionDir: string, payload: LegacyConfigPayload): void {
    const candidateDirs = [
      path.join(extractionDir, LEGACY_CONFIG_PATHS.providerModelsDir),
      path.join(extractionDir, 'provider_models')
    ]

    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        continue
      }

      for (const fileName of fs.readdirSync(dir)) {
        if (!fileName.startsWith('models_') || !fileName.endsWith('.json')) {
          continue
        }
        const providerId = decodeURIComponent(fileName.slice('models_'.length, -'.json'.length))
        const store = this.readJsonFile<Record<string, unknown>>(path.join(dir, fileName))
        if (!store) {
          continue
        }
        payload.sections.providerModels = true
        this.addProviderModels(payload, providerId, 'provider', store.models)
        this.addProviderModels(payload, providerId, 'custom', store.custom_models)
      }
    }
  }

  private readLegacyModelConfig(extractionDir: string, payload: LegacyConfigPayload): void {
    const modelConfig = this.readJsonFile<Record<string, IModelConfig | Record<string, unknown>>>(
      path.join(extractionDir, LEGACY_CONFIG_PATHS.modelConfig)
    )
    if (!modelConfig) {
      return
    }
    payload.sections.modelConfigs = true
    payload.modelConfigs = {
      ...payload.modelConfigs,
      ...modelConfig
    }
  }

  private readLegacyMcpSettings(extractionDir: string, payload: LegacyConfigPayload): void {
    const mcpSettings = this.readJsonFile<Record<string, unknown>>(
      path.join(extractionDir, LEGACY_CONFIG_PATHS.mcpSettings)
    )
    if (!mcpSettings) {
      return
    }
    payload.sections.mcp = true

    const defaultServers = new Set([
      ...normalizeStringArray(mcpSettings.defaultServers),
      ...normalizeStringArray(
        typeof mcpSettings.defaultServer === 'string' ? [mcpSettings.defaultServer] : []
      )
    ])

    if (isRecord(mcpSettings.mcpServers)) {
      payload.mcpServers = Object.fromEntries(
        Object.entries(mcpSettings.mcpServers)
          .filter((entry): entry is [string, MCPServerConfig] => isRecord(entry[1]))
          .map(([name, config]) => [
            name,
            {
              ...(clone(config) as MCPServerConfig),
              enabled:
                defaultServers.has(name) || typeof config.enabled !== 'boolean'
                  ? defaultServers.has(name)
                  : config.enabled
            }
          ])
      )
    }

    for (const [key, value] of Object.entries(mcpSettings)) {
      if (LEGACY_MCP_SETTING_EXCLUDE_KEYS.has(key) || value === undefined) {
        continue
      }
      payload.mcpSettings[key] = clone(value)
    }
  }

  private readLegacyAcpAgents(extractionDir: string, payload: LegacyConfigPayload): void {
    const acpAgents = this.readJsonFile<Record<string, unknown>>(
      path.join(extractionDir, LEGACY_CONFIG_PATHS.acpAgents)
    )
    if (!acpAgents) {
      return
    }
    payload.sections.acp = true

    if (typeof acpAgents.enabled === 'boolean') {
      payload.agentSettings.enabled = acpAgents.enabled
    }
    if (typeof acpAgents.version === 'string') {
      payload.agentSettings.version = acpAgents.version
    }

    const selections = normalizeStringArray(acpAgents.sharedMcpSelections)
    if (selections.length > 0) {
      payload.sharedAgentMcpSelections = selections
    }
  }

  private applyLegacyConfigPayload(
    configTables: ConfigTables,
    payload: LegacyConfigPayload,
    mode: SyncConfigImportMode
  ): void {
    const overwrite = mode === 'overwrite'

    if (overwrite) {
      if (payload.sections.providers) {
        configTables.replaceProviders(
          payload.providers,
          payload.providerOrder,
          payload.providerTimestamps
        )
      }
      if (payload.sections.providers || payload.sections.providerModels) {
        configTables.clearAllProviderModels()
      }
      if (
        payload.sections.providers ||
        payload.sections.modelStatuses ||
        payload.sections.providerModels
      ) {
        configTables.clearModelStatuses()
      }
      if (payload.sections.modelConfigs) {
        configTables.clearModelConfigStore()
      }
      if (payload.sections.mcp) {
        configTables.replaceMcpServers({})
        configTables.clearMcpSettings()
      }
      if (payload.sections.acp) {
        configTables.clearAgentSettings()
        configTables.clearAgentMcpSelections()
      }
      if (
        payload.sections.sensitiveAppSettings ||
        payload.sections.customPrompts ||
        payload.sections.systemPrompts
      ) {
        for (const key of LEGACY_SENSITIVE_SQLITE_KEYS) {
          configTables.deleteAppSetting(key)
        }
      }
    }

    if (payload.providers.length > 0) {
      if (!overwrite) {
        this.mergeProviders(configTables, payload)
      }
    }

    if (payload.providerModels.length > 0) {
      this.mergeProviderModels(configTables, payload.providerModels, overwrite)
    }

    if (payload.modelStatuses.length > 0) {
      for (const status of payload.modelStatuses) {
        if (overwrite || !configTables.hasModelStatus(status.statusKey)) {
          configTables.setModelStatus(
            status.statusKey,
            status.providerId,
            status.modelId,
            status.enabled
          )
        }
      }
    }

    if (Object.keys(payload.modelConfigs).length > 0) {
      for (const [cacheKey, config] of Object.entries(payload.modelConfigs)) {
        if (overwrite || !configTables.hasModelConfigStoreEntry(cacheKey)) {
          configTables.setModelConfigStoreEntry(cacheKey, config)
        }
      }
    }

    if (Object.keys(payload.mcpServers).length > 0) {
      if (overwrite) {
        const merged = {
          ...configTables.listMcpServers(),
          ...payload.mcpServers
        }
        configTables.replaceMcpServers(merged)
      } else {
        const merged = {
          ...payload.mcpServers,
          ...configTables.listMcpServers()
        }
        configTables.replaceMcpServers(merged)
      }
    }

    if (Object.keys(payload.mcpSettings).length > 0) {
      for (const [key, value] of Object.entries(payload.mcpSettings)) {
        if (overwrite || configTables.getMcpSetting(key) === undefined) {
          configTables.setMcpSetting(key, value)
        }
      }
    }

    if (Object.keys(payload.agentSettings).length > 0) {
      for (const [key, value] of Object.entries(payload.agentSettings)) {
        if (overwrite || configTables.getAgentSetting(key) === undefined) {
          configTables.setAgentSetting(key, value)
        }
      }
    }

    if (payload.sharedAgentMcpSelections.length > 0) {
      if (overwrite) {
        configTables.setAgentMcpSelections(payload.sharedAgentMcpSelections)
      } else if (configTables.getAgentMcpSelections().length === 0) {
        configTables.setAgentMcpSelections(payload.sharedAgentMcpSelections)
      }
    }

    this.applySensitiveAppSettings(configTables, payload, overwrite)
  }

  private applySensitiveAppSettings(
    configTables: ConfigTables,
    payload: LegacyConfigPayload,
    overwrite: boolean
  ): void {
    for (const [key, value] of Object.entries(payload.appSettings)) {
      if (overwrite || !configTables.hasAppSetting(key)) {
        configTables.setAppSetting(key, value, true)
      }
    }

    if (payload.sections.customPrompts) {
      this.mergeAppSettingArray(configTables, 'customPrompts', payload.customPrompts, overwrite)
    }
    if (payload.sections.systemPrompts) {
      this.mergeAppSettingArray(configTables, 'systemPrompts', payload.systemPrompts, overwrite)
    }

    if (
      Object.keys(payload.appSettings).length > 0 ||
      payload.sections.customPrompts ||
      payload.sections.systemPrompts
    ) {
      configTables.markConfigMigrationApplied('sensitive-config-sqlite-v1')
    }
  }

  private mergeAppSettingArray(
    configTables: ConfigTables,
    key: string,
    incoming: Array<Record<string, unknown>>,
    overwrite: boolean
  ): void {
    if (overwrite) {
      configTables.setAppSetting(key, incoming, true)
      return
    }

    const existing = configTables.getAppSetting<Array<Record<string, unknown>>>(key) || []
    const existingIds = new Set(
      existing
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
    const merged = [...existing]
    for (const item of incoming) {
      const id = item.id
      if (typeof id !== 'string' || existingIds.has(id)) {
        continue
      }
      merged.push(item)
      existingIds.add(id)
    }
    if (merged.length !== existing.length || !configTables.hasAppSetting(key)) {
      configTables.setAppSetting(key, merged, true)
    }
  }

  private mergeProviders(configTables: ConfigTables, payload: LegacyConfigPayload): void {
    const existingProviders = configTables.listProviders()
    const existingIds = new Set(existingProviders.map((provider) => provider.id))
    const providersToAdd = payload.providers.filter((provider) => !existingIds.has(provider.id))

    providersToAdd.forEach((provider) => {
      configTables.upsertProvider(provider, {
        lastUsedAt: payload.providerTimestamps[provider.id] ?? null
      })
    })

    if (providersToAdd.length > 0 && payload.providerOrder.length > 0) {
      const existingOrder = configTables.getProviderOrder()
      const appendedOrder = payload.providerOrder.filter((providerId) =>
        providersToAdd.some((provider) => provider.id === providerId)
      )
      configTables.setProviderOrder([...existingOrder, ...appendedOrder])
    }
  }

  private mergeProviderModels(
    configTables: ConfigTables,
    providerModels: ProviderModelsPayload[],
    overwrite: boolean
  ): void {
    for (const group of this.groupProviderModels(providerModels)) {
      if (overwrite) {
        configTables.replaceProviderModels(group.providerId, group.source, group.models)
        continue
      }

      const existing = configTables.listProviderModels(group.providerId, group.source)
      const existingIds = new Set(existing.map((model) => model.id))
      const missingModels = group.models.filter((model) => !existingIds.has(model.id))
      if (missingModels.length > 0) {
        configTables.replaceProviderModels(group.providerId, group.source, [
          ...existing,
          ...missingModels
        ])
      }
    }
  }

  private groupProviderModels(providerModels: ProviderModelsPayload[]): ProviderModelsPayload[] {
    const grouped = new Map<string, ProviderModelsPayload>()

    for (const group of providerModels) {
      const key = `${group.providerId}:${group.source}`
      const existingGroup = grouped.get(key)
      if (!existingGroup) {
        grouped.set(key, {
          providerId: group.providerId,
          source: group.source,
          models: [...group.models]
        })
        continue
      }

      const existingModelIds = new Set(existingGroup.models.map((model) => model.id))
      for (const model of group.models) {
        if (existingModelIds.has(model.id)) {
          continue
        }
        existingGroup.models.push(model)
        existingModelIds.add(model.id)
      }
    }

    return [...grouped.values()]
  }

  private addProviderModels(
    payload: LegacyConfigPayload,
    providerId: string,
    source: 'provider' | 'custom',
    value: unknown
  ): void {
    if (!providerId || !Array.isArray(value)) {
      return
    }

    const models: MODEL_META[] = []
    for (const item of value) {
      if (!this.isModelMeta(item)) {
        continue
      }

      const { enabled, ...modelWithoutEnabled } = item as MODEL_META & { enabled?: unknown }
      if (typeof enabled === 'boolean') {
        payload.modelStatuses.push({
          statusKey: getStatusKey(providerId, item.id),
          providerId,
          modelId: item.id.replace(/\./g, '-'),
          enabled
        })
      }

      models.push({
        ...modelWithoutEnabled,
        providerId,
        isCustom: source === 'custom' ? true : modelWithoutEnabled.isCustom
      } as MODEL_META)
    }

    if (models.length > 0) {
      payload.providerModels.push({ providerId, source, models })
    }
  }

  private collectProviderIds(
    payload: LegacyConfigPayload,
    appSettings: Record<string, unknown>
  ): string[] {
    const ids = new Set(payload.providers.map((provider) => provider.id))
    for (const key of Object.keys(appSettings)) {
      if (key.startsWith('custom_models_')) {
        ids.add(key.slice('custom_models_'.length))
      } else if (key.endsWith('_models')) {
        ids.add(key.slice(0, -'_models'.length))
      }
    }
    return [...ids].filter(Boolean)
  }

  private parseModelStatusKey(
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

  private hasPayloadData(payload: LegacyConfigPayload): boolean {
    return (
      payload.providers.length > 0 ||
      payload.providerModels.length > 0 ||
      payload.modelStatuses.length > 0 ||
      Object.keys(payload.modelConfigs).length > 0 ||
      Object.keys(payload.mcpServers).length > 0 ||
      Object.keys(payload.mcpSettings).length > 0 ||
      Object.keys(payload.agentSettings).length > 0 ||
      Object.keys(payload.appSettings).length > 0 ||
      payload.customPrompts.length > 0 ||
      payload.systemPrompts.length > 0 ||
      payload.sharedAgentMcpSelections.length > 0 ||
      Object.values(payload.sections).some(Boolean)
    )
  }

  private readPromptStore(filePath: string): Array<Record<string, unknown>> | null {
    const store = this.readJsonFile<{ prompts?: unknown }>(filePath)
    if (!store) {
      return null
    }
    if (!Array.isArray(store.prompts)) {
      return []
    }
    return store.prompts.filter(isRecord).map(clone)
  }

  private readJsonFile<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) {
      return null
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      return isRecord(parsed) ? (parsed as T) : null
    } catch (error) {
      console.warn('Failed to read sync config JSON:', filePath, error)
      return null
    }
  }

  private isProvider(value: unknown): value is LLM_PROVIDER {
    return isRecord(value) && typeof value.id === 'string' && typeof value.apiType === 'string'
  }

  private isModelMeta(value: unknown): value is MODEL_META {
    return isRecord(value) && typeof value.id === 'string'
  }
}
