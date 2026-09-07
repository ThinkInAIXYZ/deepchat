import { app } from 'electron'
import ElectronStore from 'electron-store'
import path from 'node:path'
import type { Prompt, SystemPrompt } from '@shared/types/prompt'
import type { MCPServerConfig } from '@shared/types/mcp'
import type { IModelConfig, LLM_PROVIDER, MODEL_META } from '@shared/types/provider'
import type { BuiltinKnowledgeConfig } from '@shared/types/knowledge'
import type { SettingsDatabase } from '@/settings/data/database'
import { SENSITIVE_APP_SETTING_KEYS } from '@/settings/appSettingsDbStore'
import type { SettingsStore } from '@/config/settingsStore'
import { DEFAULT_SYSTEM_PROMPT } from '@/agent/promptSettings'
import type { ProviderDatabase } from '@/provider/data/database'
import type { McpDatabase } from '@/mcp/data/database'
import type { AgentDatabase } from '@/agent/data/database'
import {
  LEGACY_MODEL_CONFIG_META_KEY,
  normalizeUserModelConfigEntry,
  USER_MODEL_CONFIG_MIGRATION_ID
} from '@/provider/userModelConfig'
import { RAW_PROVIDER_MODEL_FACTS_MIGRATION_ID } from '@/provider/providerModelFacts'

const PROVIDER_MODELS_DIR = 'provider_models'
const APP_STARTUP_STATE_MIGRATION_ID = 'app-startup-state-v1'
const LEGACY_APP_STARTUP_STATE_KEYS = [
  'sqlite-mainline-normalization-v1',
  'agent-disabled-search-tool-cleanup-v1'
] as const

interface LegacyModelConfigMeta {
  userConfigKeys?: unknown
}

export interface ConfigMigrationResult {
  previousAppVersion: string | undefined
  appVersionChanged: boolean
}

export function migrateConfigStorage(options: {
  database: SettingsDatabase
  providerDatabase: ProviderDatabase
  mcpDatabase: McpDatabase
  agentDatabase: AgentDatabase
  settings: SettingsStore
  mcpSettings: Record<string, unknown>
  acpCatalog: { enabled: boolean; sharedMcpSelections: string[] }
  userDataPath: string
  currentAppVersion?: string
}): ConfigMigrationResult {
  const currentAppVersion = options.currentAppVersion ?? app.getVersion()
  const previousAppVersion = options.settings.get<string>('appVersion')

  migrateBusinessConfigToSqlite(options)
  migrateProviderModelsToRawFacts(options)
  migrateModelConfigsToUserOnly(options)
  migrateSensitiveConfigToSqlite(options)
  migrateAppStartupState(options)

  const appVersionChanged = previousAppVersion !== currentAppVersion
  if (appVersionChanged) {
    options.settings.set('appVersion', currentAppVersion)
  }

  return { previousAppVersion, appVersionChanged }
}

function migrateBusinessConfigToSqlite(options: Parameters<typeof migrateConfigStorage>[0]): void {
  const appSettingsTable = options.database.appSettingsTable
  if (appSettingsTable.hasConfigMigration()) {
    return
  }
  const providerSettings = options.providerDatabase.settingsTable
  const mcpSettings = options.mcpDatabase.settingsTable
  const agentSettings = options.agentDatabase.catalogSettingsTable

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

  for (const [cacheKey, config] of Object.entries(readLegacyModelConfigs())) {
    providerSettings.setModelConfigStoreEntry(cacheKey, config)
  }

  const mcpServers = options.mcpSettings.mcpServers
  if (mcpServers && typeof mcpServers === 'object' && !Array.isArray(mcpServers)) {
    mcpSettings.replaceMcpServers(mcpServers as Record<string, MCPServerConfig>)
  }
  for (const [key, value] of Object.entries(options.mcpSettings)) {
    if (key !== 'mcpServers' && value !== undefined) {
      mcpSettings.setMcpSetting(key, value)
    }
  }

  agentSettings.setAgentSetting('enabled', options.acpCatalog.enabled)
  agentSettings.setAgentSetting('version', '4')
  agentSettings.setAgentMcpSelections(options.acpCatalog.sharedMcpSelections)
  appSettingsTable.markConfigMigrationApplied()
}

function migrateProviderModelsToRawFacts(
  options: Parameters<typeof migrateConfigStorage>[0]
): void {
  const appSettingsTable = options.database.appSettingsTable
  if (appSettingsTable.hasConfigMigration(RAW_PROVIDER_MODEL_FACTS_MIGRATION_ID)) {
    return
  }

  const result = options.providerDatabase.settingsTable.migrateProviderModelsToRawFacts()
  console.info(
    `[Config] Migrated ${result.updated} of ${result.scanned} provider models to raw facts`
  )
  appSettingsTable.markConfigMigrationApplied(RAW_PROVIDER_MODEL_FACTS_MIGRATION_ID)
}

function migrateModelConfigsToUserOnly(options: Parameters<typeof migrateConfigStorage>[0]): void {
  const appSettingsTable = options.database.appSettingsTable
  if (appSettingsTable.hasConfigMigration(USER_MODEL_CONFIG_MIGRATION_ID)) {
    return
  }

  const result = options.providerDatabase.settingsTable.migrateModelConfigsToUserOnly()
  console.info(
    `[Config] Migrated model configs to user-only storage: ${result.preserved} preserved, ${result.removed} removed`
  )
  appSettingsTable.markConfigMigrationApplied(USER_MODEL_CONFIG_MIGRATION_ID)
}

function migrateSensitiveConfigToSqlite(options: Parameters<typeof migrateConfigStorage>[0]): void {
  const appSettingsTable = options.database.appSettingsTable
  const migrationId = 'sensitive-config-sqlite-v1'
  if (appSettingsTable.hasConfigMigration(migrationId)) {
    return
  }

  for (const key of SENSITIVE_APP_SETTING_KEYS) {
    if (key === 'customPrompts' || key === 'systemPrompts' || key === 'knowledgeConfigs') {
      continue
    }
    const value = options.settings.get(key)
    if (value !== undefined) {
      appSettingsTable.setAppSetting(key, value, true)
      options.settings.delete(key)
    }
  }

  const customPromptsStore = new ElectronStore<{ prompts: Prompt[] }>({
    name: 'custom_prompts',
    defaults: { prompts: [] }
  })
  appSettingsTable.setAppSetting('customPrompts', customPromptsStore.get('prompts', []), true)
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
  appSettingsTable.setAppSetting('systemPrompts', systemPromptsStore.get('prompts', []), true)
  systemPromptsStore.set('prompts', [])

  const knowledgeStore = new ElectronStore<{ knowledgeConfigs: BuiltinKnowledgeConfig[] }>({
    name: 'knowledge-configs',
    defaults: { knowledgeConfigs: [] }
  })
  appSettingsTable.setAppSetting(
    'knowledgeConfigs',
    knowledgeStore.get('knowledgeConfigs', []),
    true
  )
  knowledgeStore.set('knowledgeConfigs', [])

  appSettingsTable.markConfigMigrationApplied(migrationId)
}

function migrateAppStartupState(options: Parameters<typeof migrateConfigStorage>[0]): void {
  const appSettingsTable = options.database.appSettingsTable
  if (appSettingsTable.hasConfigMigration(APP_STARTUP_STATE_MIGRATION_ID)) {
    return
  }

  const agentSettings = options.agentDatabase.catalogSettingsTable
  for (const key of LEGACY_APP_STARTUP_STATE_KEYS) {
    const value = agentSettings.getAgentSetting(key)
    if (value === undefined) continue
    appSettingsTable.setAppSetting(key, value, false)
    agentSettings.deleteAgentSetting(key)
  }
  appSettingsTable.markConfigMigrationApplied(APP_STARTUP_STATE_MIGRATION_ID)
}

function readLegacyModelConfigs(): Record<string, IModelConfig> {
  const store = new ElectronStore<Record<string, IModelConfig | LegacyModelConfigMeta>>({
    name: 'model-config'
  })
  const snapshot = store.store
  const meta = snapshot[LEGACY_MODEL_CONFIG_META_KEY] as LegacyModelConfigMeta | undefined
  const legacyUserKeys = new Set(
    Array.isArray(meta?.userConfigKeys)
      ? meta.userConfigKeys.filter(
          (key): key is string => typeof key === 'string' && key.length > 0
        )
      : []
  )

  return Object.fromEntries(
    Object.entries(snapshot).flatMap(([key, value]) => {
      if (key === LEGACY_MODEL_CONFIG_META_KEY) {
        return []
      }
      const entry = normalizeUserModelConfigEntry(value, {
        legacyUserKey: legacyUserKeys.has(key)
      })
      return entry ? [[key, entry]] : []
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
