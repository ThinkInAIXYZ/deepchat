import { electronApp } from '@electron-toolkit/utils'
import { setLoggingEnabled } from '@shared/logger'
import { ConfigService, createSettingsStore } from '@/config'
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
    const configService = new ConfigService(settingsStore, privacySettings, mcpSettings)
    setLoggingEnabled(settingsStore.get<boolean>('loggingEnabled') ?? false)
    proxyConfig.initFromConfig(proxySettings.getMode(), proxySettings.getCustomUrl())

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
    await registerProtocols()

    mainProcess = await createMainProcessControl({
      configService,
      settingsStore,
      secretStore,
      privacySettings,
      proxySettings,
      mcpSettings,
      database,
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
