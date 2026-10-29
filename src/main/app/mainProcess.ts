import { electronApp } from '@electron-toolkit/utils'
import { app, safeStorage } from 'electron'
import path from 'node:path'
import { credentialCrypto } from './credentialCrypto'
import { proxyConfig } from '@/platform/proxy'
import type { StartupWorkloadCoordinator } from '@/app/startupWorkloadCoordinator'
import { createMainProcessControl, type MainProcessControl } from './composition'
import { registerProtocols } from './protocols'
import { McpAppSandboxRegistry } from '@/mcp/apps/sandboxRegistry'
import { SplashWindow } from './splashWindow'
import { providerDbLoader } from '@/provider/providerDbLoader'
import { mainLogger, setMainLoggingEnabled } from '@/logging'
import { initializeCoreProfile } from './profileStartup'

export type { MainProcessControl } from './composition'

export async function startMainProcess(
  startupWorkloadCoordinator: StartupWorkloadCoordinator,
  startupRunId: string,
  requestUpdateInstall: (installAction: () => void) => Promise<void>
): Promise<MainProcessControl> {
  const splashWindow = new SplashWindow()
  let mainProcess: MainProcessControl | undefined
  let profile: Awaited<ReturnType<typeof initializeCoreProfile>> | undefined

  await splashWindow.create()

  try {
    electronApp.setAppUserModelId('com.wefonk.deepchat')
    profile = await initializeCoreProfile({
      userDataDirectory: app.getPath('userData'),
      homeDirectory: app.getPath('home'),
      currentAppVersion: app.getVersion(),
      crypto: {
        ...credentialCrypto,
        getBackend: async () =>
          process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
      },
      host: {
        setLoggingEnabled: async (enabled) => setMainLoggingEnabled(enabled),
        showDatabaseUnlockProgress: async (payload, options) =>
          splashWindow.showDatabaseUnlockProgress(payload, options),
        requestDatabaseUnlock: (payload) => splashWindow.requestDatabaseUnlock(payload),
        requestDatabaseRecovery: (payload) => splashWindow.requestDatabaseRecovery(payload),
        quit: async () => app.quit()
      },
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
    const mcpAppSandboxRegistry = new McpAppSandboxRegistry()
    proxyConfig.initFromConfig(
      profile.proxySettings.getMode(),
      profile.proxySettings.getCustomUrl()
    )
    const mcpAppDesktop = await registerProtocols(
      mcpAppSandboxRegistry,
      async (url) => (await mainProcess?.resolveWorkspacePreviewRequest(url)) ?? null
    )

    mainProcess = await createMainProcessControl({
      ...profile,
      providerCatalogBootstrap: {
        userDataDirectory: app.getPath('userData'),
        builtInCatalogPath: path.join(
          app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath(),
          'resources',
          'model-db',
          'providers.json'
        )
      },
      mcpAppSandboxRegistry,
      mcpAppDesktop,
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
    providerDbLoader.stop()
    await splashWindow.close()
    if (mainProcess) {
      await mainProcess.stopForCleanup()
    } else {
      await providerDbLoader.drain()
      profile?.closeProfile()
    }
    throw error
  }
}
