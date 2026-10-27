import { electronApp } from '@electron-toolkit/utils'
import { app, safeStorage } from 'electron'
import ElectronStore from 'electron-store'
import path from 'node:path'
import { SettingsStore } from '@/config/settingsStore'
import type { StoreLike } from '@/config/storeLike'
import { SecretStore } from '@/config/secretStore'
import { credentialCrypto } from './credentialCrypto'
import {
  DatabaseSecurityService,
  DEFAULT_DATABASE_SECURITY_METADATA,
  type DatabaseSecurityMetadata
} from './databaseSecurity'
import { proxyConfig } from '@/platform/proxy'
import type { StartupWorkloadCoordinator } from '@/app/startupWorkloadCoordinator'
import { createMainProcessControl, type MainProcessControl } from './composition'
import { initializeMainDatabaseWithRecovery } from './databaseStartup'
import { registerProtocols } from './protocols'
import { McpAppSandboxRegistry } from '@/mcp/apps/sandboxRegistry'
import { SplashWindow } from './splashWindow'
import { PrivacySettings } from './privacy'
import { ProxySettings } from '@/platform/proxySettings'
import { McpSettings } from '@/mcp/settings'
import { AcpCatalogSettings } from '@/agent/acp/catalog/settings'
import { SettingsDatabase } from '@/settings/data/database'
import { migrateConfigStorage } from '@/config/migration'
import { ProviderDatabase } from '@/provider/data/database'
import { McpDatabase } from '@/mcp/data/database'
import { AgentDatabase } from '@/agent/data/database'
import { mainLogger, setMainLoggingEnabled } from '@/logging'

export type { MainProcessControl } from './composition'

export async function startMainProcess(
  startupWorkloadCoordinator: StartupWorkloadCoordinator,
  startupRunId: string,
  requestUpdateInstall: (installAction: () => void) => Promise<void>
): Promise<MainProcessControl> {
  const splashWindow = new SplashWindow()
  let mainProcess: MainProcessControl | undefined
  let database: Awaited<ReturnType<typeof initializeMainDatabaseWithRecovery>> | undefined

  await splashWindow.create()

  try {
    electronApp.setAppUserModelId('com.wefonk.deepchat')
    const currentAppVersion = app.getVersion()
    const settingsStore = createSettingsStore(currentAppVersion)
    setMainLoggingEnabled(settingsStore.get<boolean>('loggingEnabled') ?? false)
    const secretStore = new SecretStore(settingsStore, credentialCrypto)
    const privacySettings = new PrivacySettings(settingsStore)
    const proxySettings = new ProxySettings(settingsStore)
    const mcpSettings = new McpSettings(secretStore)
    const mcpAppSandboxRegistry = new McpAppSandboxRegistry()
    const acpCatalogSettings = new AcpCatalogSettings({ mcpSettings })
    const databaseSecurityService = new DatabaseSecurityService({
      dbPath: path.join(app.getPath('userData'), 'app_db', 'agent.db'),
      metadata: new ElectronStore<{ metadata: DatabaseSecurityMetadata }>({
        name: 'database-security',
        defaults: { metadata: { ...DEFAULT_DATABASE_SECURITY_METADATA } }
      }),
      crypto: {
        ...credentialCrypto,
        getBackend: async () =>
          process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
      }
    })
    const securityStatus = await databaseSecurityService.getStatus()
    splashWindow.showDatabaseUnlockProgress(
      {
        active: securityStatus.enabled,
        safeStorageAvailable: securityStatus.safeStorageAvailable
      },
      { skipDelay: securityStatus.enabled }
    )
    database = await initializeMainDatabaseWithRecovery({
      security: databaseSecurityService,
      splash: splashWindow,
      observe: (observation) => {
        const context = {
          ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
          repairAttempted: observation.repairAttempted,
          schemaDiagnosis: observation.schemaDiagnosis,
          repairableIssueCount: observation.repairableIssueCount,
          manualIssueCount: observation.manualIssueCount
        }
        if (observation.outcome === 'failed') {
          mainLogger.emit('database.initialization.terminal', {
            ...context,
            outcome: 'failed',
            error: observation.error
          })
        } else {
          mainLogger.emit('database.initialization.terminal', {
            ...context,
            outcome: 'completed'
          })
        }
      }
    })
    splashWindow.showDatabaseUnlockProgress({
      active: false,
      safeStorageAvailable: (await databaseSecurityService.getStatus()).safeStorageAvailable
    })
    const settingsDatabase = new SettingsDatabase(database)
    const providerDatabase = new ProviderDatabase(database)
    const mcpDatabase = new McpDatabase(database)
    const agentDatabase = new AgentDatabase(database)
    const configMigration = migrateConfigStorage({
      database: settingsDatabase,
      providerDatabase,
      mcpDatabase,
      agentDatabase,
      settings: settingsStore,
      mcpSettings: mcpSettings.getMigrationSnapshot(),
      acpCatalog: acpCatalogSettings.getMigrationSnapshot(),
      userDataPath: app.getPath('userData'),
      currentAppVersion
    })
    settingsStore.attachDatabase(settingsDatabase)
    mcpSettings.connectDatabase(mcpDatabase)
    acpCatalogSettings.connectDatabase(agentDatabase)
    if (configMigration.appVersionChanged) {
      mcpSettings.onUpgrade(configMigration.previousAppVersion)
    }
    proxyConfig.initFromConfig(proxySettings.getMode(), proxySettings.getCustomUrl())
    await registerProtocols(mcpAppSandboxRegistry)

    mainProcess = await createMainProcessControl({
      previousAppVersion: configMigration.previousAppVersion,
      currentAppVersion,
      settingsStore,
      secretStore,
      privacySettings,
      proxySettings,
      mcpSettings,
      mcpAppSandboxRegistry,
      acpCatalogSettings,
      database,
      settingsDatabase,
      providerDatabase,
      agentDatabase,
      databaseSecurityService,
      startupWorkloadCoordinator,
      startupRunId,
      requestUpdateInstall,
      onWindowCreated: (isMainWindow) => splashWindow.handleWindowCreated(isMainWindow),
      splash: splashWindow,
      bindControl: (control) => {
        mainProcess = control
      }
    })

    await splashWindow.close()
    return mainProcess
  } catch (error) {
    await splashWindow.close()
    if (mainProcess) {
      await mainProcess.stopForCleanup()
    } else {
      database?.close()
    }
    throw error
  }
}

function createSettingsStore(currentAppVersion: string): SettingsStore {
  const userDataPath = app.getPath('userData')
  return new SettingsStore(
    new ElectronStore<Record<string, unknown>>({
      name: 'app-settings',
      defaults: {
        language: 'system',
        providers: [],
        closeToQuit: false,
        proxyMode: 'system',
        customProxyUrl: '',
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
        appVersion: currentAppVersion,
        hooksNotifications: { hooks: [] },
        agentCommandShell: { preference: 'auto' }
      }
    }) as unknown as StoreLike<Record<string, unknown>>
  )
}
