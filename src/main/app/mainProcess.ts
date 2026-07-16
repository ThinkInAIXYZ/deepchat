import { electronApp } from '@electron-toolkit/utils'
import { app } from 'electron'
import { setLoggingEnabled } from '@shared/logger'
import { ProviderSettings } from '@/provider/settings'
import { createSettingsStore } from '@/config/settingsStore'
import { SecretStore } from '@/config/secretStore'
import { DatabaseSecurityService } from './databaseSecurity'
import { proxyConfig } from '@/platform/proxy'
import type { StartupWorkloadCoordinator } from '@/app/startupWorkloadCoordinator'
import { createMainProcessControl, type MainProcessControl } from './composition'
import { DatabaseInitializer } from './databaseInitializer'
import { registerProtocols } from './protocols'
import { SplashWindow } from './splashWindow'
import { PrivacySettings } from './privacy'
import { ProxySettings } from '@/platform/proxySettings'
import { McpSettings } from '@/mcp/settings'
import { AcpCatalogSettings } from '@/agent/acp/catalog/settings'
import { SettingsDatabase } from '@/settings/data/database'
import { migrateConfigStorage } from '@/config/migration'

export type { MainProcessControl } from './composition'

export async function startMainProcess(
  startupWorkloadCoordinator: StartupWorkloadCoordinator,
  startupRunId: string,
  requestUpdateInstall: (installAction: () => void) => Promise<void>
): Promise<MainProcessControl> {
  const splashWindow = new SplashWindow()
  let mainProcess: MainProcessControl | undefined
  let database: Awaited<ReturnType<DatabaseInitializer['initialize']>> | undefined

  await splashWindow.create()

  try {
    electronApp.setAppUserModelId('com.wefonk.deepchat')
    const settingsStore = createSettingsStore()
    const secretStore = new SecretStore(settingsStore)
    const privacySettings = new PrivacySettings(settingsStore)
    const proxySettings = new ProxySettings(settingsStore)
    const mcpSettings = new McpSettings()
    const acpCatalogSettings = new AcpCatalogSettings({ mcpSettings })
    const databaseSecurityService = new DatabaseSecurityService()
    const securityStatus = databaseSecurityService.getStatus()
    splashWindow.showDatabaseUnlockProgress(
      {
        active: securityStatus.enabled,
        safeStorageAvailable: securityStatus.safeStorageAvailable
      },
      { skipDelay: securityStatus.enabled }
    )
    const password = await databaseSecurityService.resolveStartupPassword((request) =>
      splashWindow.requestDatabaseUnlock(request)
    )
    splashWindow.showDatabaseUnlockProgress({
      active: false,
      safeStorageAvailable: databaseSecurityService.getStatus().safeStorageAvailable
    })

    const databaseInitializer = new DatabaseInitializer({ password })
    database = await databaseInitializer.initialize()
    await databaseInitializer.migrate()
    const settingsDatabase = new SettingsDatabase(database)
    const configMigration = migrateConfigStorage({
      database: settingsDatabase,
      settings: settingsStore,
      mcpSettings: mcpSettings.getMigrationSnapshot(),
      acpCatalog: acpCatalogSettings.getMigrationSnapshot(),
      userDataPath: app.getPath('userData')
    })
    settingsStore.attachDatabase(settingsDatabase)
    mcpSettings.connectDatabase(settingsDatabase)
    acpCatalogSettings.connectDatabase(settingsDatabase)
    if (configMigration.appVersionChanged) {
      mcpSettings.onUpgrade(configMigration.previousAppVersion)
    }
    const providerSettings = new ProviderSettings(
      settingsStore,
      privacySettings,
      settingsDatabase,
      configMigration.previousAppVersion
    )
    setLoggingEnabled(settingsStore.get<boolean>('loggingEnabled') ?? false)
    proxyConfig.initFromConfig(proxySettings.getMode(), proxySettings.getCustomUrl())
    await registerProtocols()

    mainProcess = await createMainProcessControl({
      providerSettings,
      settingsStore,
      secretStore,
      privacySettings,
      proxySettings,
      mcpSettings,
      acpCatalogSettings,
      database,
      settingsDatabase,
      databaseSecurityService,
      startupWorkloadCoordinator,
      startupRunId,
      requestUpdateInstall,
      onWindowCreated: (isMainWindow) => splashWindow.handleWindowCreated(isMainWindow),
      bindControl: (control) => {
        mainProcess = control
      }
    })

    await splashWindow.close()
    return mainProcess
  } catch (error) {
    await splashWindow.close()
    if (mainProcess) {
      await mainProcess.stop()
    } else {
      database?.close()
    }
    throw error
  }
}
