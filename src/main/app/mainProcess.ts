import { electronApp } from '@electron-toolkit/utils'
import { setLoggingEnabled } from '@shared/logger'
import { ConfigService } from '@/config'
import { DatabaseSecurityPresenter } from '@/presenter/databaseSecurityPresenter'
import { proxyConfig } from '@/presenter/proxyConfig'
import type { StartupWorkloadCoordinator } from '@/presenter/startupWorkloadCoordinator'
import { createMainProcessControl, type MainProcessControl } from './composition'
import { DatabaseInitializer } from './databaseInitializer'
import { registerProtocols } from './protocols'
import { SplashWindow } from './splashWindow'

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
    const configService = new ConfigService()
    setLoggingEnabled(configService.getLoggingEnabled())
    proxyConfig.initFromConfig(configService.getProxyMode(), configService.getCustomProxyUrl())

    const databaseSecurityPresenter = new DatabaseSecurityPresenter()
    const securityStatus = databaseSecurityPresenter.getStatus()
    splashWindow.showDatabaseUnlockProgress(
      {
        active: securityStatus.enabled,
        safeStorageAvailable: securityStatus.safeStorageAvailable
      },
      { skipDelay: securityStatus.enabled }
    )
    const password = await databaseSecurityPresenter.resolveStartupPassword((request) =>
      splashWindow.requestDatabaseUnlock(request)
    )
    splashWindow.showDatabaseUnlockProgress({
      active: false,
      safeStorageAvailable: databaseSecurityPresenter.getStatus().safeStorageAvailable
    })

    const databaseInitializer = new DatabaseInitializer({ password })
    database = await databaseInitializer.initialize()
    await databaseInitializer.migrate()
    await registerProtocols()

    mainProcess = await createMainProcessControl({
      configService,
      sqlitePresenter: database,
      databaseSecurityPresenter,
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
