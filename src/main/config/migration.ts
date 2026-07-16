import { app } from 'electron'
import ElectronStore from 'electron-store'
import path from 'node:path'
import type {
  IModelConfig,
  LLM_PROVIDER,
  MCPServerConfig,
  MODEL_META,
  Prompt,
  SystemPrompt
} from '@shared/presenter'
import type { BuiltinKnowledgeConfig } from '@shared/types/knowledge'
import type { SettingsDatabase } from '@/settings/data/database'
import { SENSITIVE_APP_SETTING_KEYS } from '@/settings/appSettingsDbStore'
import type { SettingsStore } from '@/config/settingsStore'
import { DEFAULT_SYSTEM_PROMPT } from '@/agent/promptSettings'
import type { ProviderDatabase } from '@/provider/data/database'

const MODEL_CONFIG_META_KEY = '__meta__'
const PROVIDER_MODELS_DIR = 'provider_models'

interface LegacyModelConfigMeta {
  lastRefreshVersion?: string
  userConfigKeys?: string[]
}

export interface ConfigMigrationResult {
  previousAppVersion: string | undefined
  appVersionChanged: boolean
}

export function migrateConfigStorage(options: {
  database: SettingsDatabase
  providerDatabase: ProviderDatabase
  settings: SettingsStore
  mcpSettings: Record<string, unknown>
  acpCatalog: { enabled: boolean; sharedMcpSelections: string[] }
  userDataPath: string
  currentAppVersion?: string
}): ConfigMigrationResult {
  const currentAppVersion = options.currentAppVersion ?? app.getVersion()
  const previousAppVersion = options.settings.get<string>('appVersion')

  migrateBusinessConfigToSqlite(options, currentAppVersion)
  migrateSensitiveConfigToSqlite(options)

  const appVersionChanged = previousAppVersion !== currentAppVersion
  if (appVersionChanged) {
    options.settings.set('appVersion', currentAppVersion)
  }

  return { previousAppVersion, appVersionChanged }
}

function migrateBusinessConfigToSqlite(
  options: Parameters<typeof migrateConfigStorage>[0],
  currentAppVersion: string
): void {
  const settingsTables = options.database.settingsTables
  if (settingsTables.hasConfigMigration()) {
    return
  }
  const providerSettings = options.providerDatabase.settingsTable

  const providers = options.settings.get<LLM_PROVIDER[]>('providers') ?? []
  const providerIds = providers.map((provider) => provider.id)
  const providerOrder = readStringArray(options.settings.get('providerOrder')) ?? providerIds
  const providerTimestamps = readNumberRecord(options.settings.get('providerTimestamps'))

  providerSettings.replaceProviders(providers, providerOrder, providerTimestamps)

  for (const provider of providers) {
    const storeName = `models_${encodeURIComponent(provider.id).replace(/\*/g, '%2A')}`
    const store = new ElectronStore<{ models: MODEL_META[]; custom_models: MODEL_META[] }>({
      name: storeName,
      cwd: path.join(options.userDataPath, PROVIDER_MODELS_DIR),
      defaults: { models: [], custom_models: [] }
    })
    providerSettings.replaceProviderModels(provider.id, 'provider', store.get('models', []))
    providerSettings.replaceProviderModels(provider.id, 'custom', store.get('custom_models', []))
  }

  for (const [statusKey, enabled] of readLegacyModelStatuses(options.settings.store)) {
    const parsed = parseLegacyModelStatusKey(statusKey, providerIds)
    providerSettings.setModelStatus(statusKey, parsed.providerId, parsed.modelId, enabled)
  }

  for (const [cacheKey, config] of Object.entries(readLegacyModelConfigs(currentAppVersion))) {
    providerSettings.setModelConfigStoreEntry(cacheKey, config)
  }

  const mcpServers = options.mcpSettings.mcpServers
  if (mcpServers && typeof mcpServers === 'object' && !Array.isArray(mcpServers)) {
    settingsTables.replaceMcpServers(mcpServers as Record<string, MCPServerConfig>)
  }
  for (const [key, value] of Object.entries(options.mcpSettings)) {
    if (key !== 'mcpServers' && value !== undefined) {
      settingsTables.setMcpSetting(key, value)
    }
  }

  settingsTables.setAgentSetting('enabled', options.acpCatalog.enabled)
  settingsTables.setAgentSetting('version', '4')
  settingsTables.setAgentMcpSelections(options.acpCatalog.sharedMcpSelections)
  settingsTables.markConfigMigrationApplied()
}

function migrateSensitiveConfigToSqlite(options: Parameters<typeof migrateConfigStorage>[0]): void {
  const settingsTables = options.database.settingsTables
  const migrationId = 'sensitive-config-sqlite-v1'
  if (settingsTables.hasConfigMigration(migrationId)) {
    return
  }

  for (const key of SENSITIVE_APP_SETTING_KEYS) {
    if (key === 'customPrompts' || key === 'systemPrompts' || key === 'knowledgeConfigs') {
      continue
    }
    const value = options.settings.get(key)
    if (value !== undefined) {
      settingsTables.setAppSetting(key, value, true)
      options.settings.delete(key)
    }
  }

  const customPromptsStore = new ElectronStore<{ prompts: Prompt[] }>({
    name: 'custom_prompts',
    defaults: { prompts: [] }
  })
  settingsTables.setAppSetting('customPrompts', customPromptsStore.get('prompts', []), true)
  customPromptsStore.set('prompts', [])

  const systemPromptsStore = new ElectronStore<{ prompts: SystemPrompt[] }>({
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
  settingsTables.setAppSetting('systemPrompts', systemPromptsStore.get('prompts', []), true)
  systemPromptsStore.set('prompts', [])

  const knowledgeStore = new ElectronStore<{ knowledgeConfigs: BuiltinKnowledgeConfig[] }>({
    name: 'knowledge-configs',
    defaults: { knowledgeConfigs: [] }
  })
  settingsTables.setAppSetting('knowledgeConfigs', knowledgeStore.get('knowledgeConfigs', []), true)
  knowledgeStore.set('knowledgeConfigs', [])

  settingsTables.markConfigMigrationApplied(migrationId)
}

function readLegacyModelConfigs(currentAppVersion: string): Record<string, IModelConfig> {
  const store = new ElectronStore<Record<string, IModelConfig | LegacyModelConfigMeta>>({
    name: 'model-config'
  })
  const snapshot = store.store
  const meta = snapshot[MODEL_CONFIG_META_KEY] as LegacyModelConfigMeta | undefined
  const entries = Object.entries(snapshot).filter(([key]) => key !== MODEL_CONFIG_META_KEY)

  if (meta) {
    const allowedKeys =
      meta.lastRefreshVersion === currentAppVersion
        ? null
        : new Set(meta.userConfigKeys?.filter((key) => typeof key === 'string') ?? [])
    return Object.fromEntries(
      entries.filter(([key, value]) => value && (!allowedKeys || allowedKeys.has(key)))
    ) as Record<string, IModelConfig>
  }

  return Object.fromEntries(
    entries.flatMap(([key, value]) => {
      const entry = value as IModelConfig | undefined
      const isUserConfig = entry?.source === 'user' || entry?.config?.isUserDefined === true
      if (!entry || !isUserConfig) {
        return []
      }
      return [
        [
          key,
          {
            ...entry,
            source: 'user',
            config: { ...entry.config, isUserDefined: true }
          }
        ]
      ]
    })
  )
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function readNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1])
    )
  )
}

function readLegacyModelStatuses(store: Record<string, unknown>): Array<[string, boolean]> {
  return Object.entries(store).filter(
    (entry): entry is [string, boolean] =>
      entry[0].startsWith('model_status_') && typeof entry[1] === 'boolean'
  )
}

function parseLegacyModelStatusKey(
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
