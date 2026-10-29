import Conf from 'conf'
import path from 'node:path'
import { createSettingsStore } from '@/config/settingsStore'
import type { StoreLike } from '@/config/storeLike'
import { SecretStore } from '@/config/secretStore'
import { McpSettings, createMcpSettingsDefaults } from '@/mcp/settings'
import { AcpCatalogSettings, createAcpCatalogDefaults } from '@/agent/acp/catalog/settings'
import { SettingsDatabase } from '@/settings/data/database'
import { ProviderDatabase } from '@/provider/data/database'
import { McpDatabase } from '@/mcp/data/database'
import { AgentDatabase } from '@/agent/data/database'
import { migrateConfigStorage } from '@/config/migration'
import { PluginToolPolicyStore, type StoredToolPolicy } from '@/plugin/toolPolicyStore'
import type { MainDatabase } from '@/data/mainDatabase'
import type { DatabaseUnlockProgressPayload } from '@shared/contracts/databaseSecurity'
import { PrivacySettings } from './privacy'
import { ProxySettings } from '@/platform/proxySettings'
import {
  DatabaseSecurityService,
  DEFAULT_DATABASE_SECURITY_METADATA,
  type DatabaseSecurityMetadata,
  type DatabaseSecurityCryptoPort
} from './databaseSecurity'
import {
  initializeMainDatabaseWithRecovery,
  type DatabaseStartupPresentation
} from './databaseStartup'
import type { DatabaseInitializationObservation } from './databaseInitializer'

export interface CoreProfileHost extends DatabaseStartupPresentation {
  setLoggingEnabled(enabled: boolean): Promise<void>
  showDatabaseUnlockProgress(
    payload: DatabaseUnlockProgressPayload,
    options?: { skipDelay?: boolean }
  ): Promise<void>
}

export async function initializeCoreProfile(options: {
  userDataDirectory: string
  homeDirectory: string
  currentAppVersion: string
  crypto: DatabaseSecurityCryptoPort
  host: CoreProfileHost
  observe?: (observation: DatabaseInitializationObservation) => void | Promise<void>
}) {
  let database: MainDatabase | undefined
  try {
    const { userDataDirectory, homeDirectory, currentAppVersion } = options
    const settingsStore = createSettingsStore({
      userDataDirectory,
      homeDirectory,
      currentAppVersion
    })
    await options.host.setLoggingEnabled(settingsStore.get<boolean>('loggingEnabled') ?? false)
    const secretStore = new SecretStore(settingsStore, options.crypto)
    const privacySettings = new PrivacySettings(settingsStore)
    const proxySettings = new ProxySettings(settingsStore)
    const mcpSettings = new McpSettings(
      new Conf({
        configName: 'mcp-settings',
        cwd: userDataDirectory,
        projectVersion: currentAppVersion,
        defaults: createMcpSettingsDefaults()
      }) as unknown as StoreLike<ReturnType<typeof createMcpSettingsDefaults>>,
      secretStore
    )
    const acpCatalogSettings = new AcpCatalogSettings({
      mcpSettings,
      store: new Conf({
        configName: 'acp_agents',
        cwd: userDataDirectory,
        projectVersion: currentAppVersion,
        defaults: createAcpCatalogDefaults()
      }) as unknown as StoreLike<ReturnType<typeof createAcpCatalogDefaults>>
    })
    const databaseSecurityService = new DatabaseSecurityService({
      dbPath: path.join(userDataDirectory, 'app_db', 'agent.db'),
      metadata: new Conf<{ metadata: DatabaseSecurityMetadata }>({
        configName: 'database-security',
        cwd: userDataDirectory,
        projectVersion: currentAppVersion,
        defaults: { metadata: { ...DEFAULT_DATABASE_SECURITY_METADATA } }
      }),
      crypto: options.crypto
    })
    const securityStatus = await databaseSecurityService.getStatus()
    await options.host.showDatabaseUnlockProgress(
      {
        active: securityStatus.enabled,
        safeStorageAvailable: securityStatus.safeStorageAvailable
      },
      { skipDelay: securityStatus.enabled }
    )
    database = await initializeMainDatabaseWithRecovery({
      security: databaseSecurityService,
      splash: options.host,
      observe: options.observe
    })
    await options.host.showDatabaseUnlockProgress({
      active: false,
      safeStorageAvailable: (await databaseSecurityService.getStatus()).safeStorageAvailable
    })
    const settingsDatabase = new SettingsDatabase(database)
    const providerDatabase = new ProviderDatabase(database)
    const mcpDatabase = new McpDatabase(database)
    const agentDatabase = new AgentDatabase(database)
    const migration = migrateConfigStorage({
      database: settingsDatabase,
      providerDatabase,
      mcpDatabase,
      agentDatabase,
      settings: settingsStore,
      mcpSettings: mcpSettings.getMigrationSnapshot(),
      acpCatalog: acpCatalogSettings.getMigrationSnapshot(),
      userDataPath: userDataDirectory,
      currentAppVersion
    })
    settingsStore.attachDatabase(settingsDatabase)
    mcpSettings.connectDatabase(mcpDatabase)
    acpCatalogSettings.connectDatabase(agentDatabase)
    if (migration.appVersionChanged) mcpSettings.onUpgrade(migration.previousAppVersion)
    return {
      currentAppVersion,
      previousAppVersion: migration.previousAppVersion,
      settingsStore,
      secretStore,
      privacySettings,
      proxySettings,
      mcpSettings,
      acpCatalogSettings,
      database,
      settingsDatabase,
      providerDatabase,
      agentDatabase,
      databaseSecurityService,
      pluginToolPolicies: new PluginToolPolicyStore(
        new Conf<{ policies: StoredToolPolicy[] }>({
          configName: 'plugin-tool-policies',
          cwd: userDataDirectory,
          projectVersion: currentAppVersion,
          defaults: { policies: [] }
        })
      )
    }
  } catch (error) {
    database?.close()
    throw error
  }
}
