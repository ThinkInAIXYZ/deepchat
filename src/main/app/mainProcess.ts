import { electronApp } from '@electron-toolkit/utils'
import { createMainProcessControl, type MainProcessControl } from './composition'
import { registerProtocols } from './protocols'
import { SplashWindow } from './splashWindow'

export type { MainProcessControl } from './composition'

export async function startMainProcess(
  startupRunId: string,
  requestUpdateInstall: (installAction: () => void) => Promise<void>,
  signal: AbortSignal
): Promise<MainProcessControl> {
  signal.throwIfAborted()
  const splashWindow = new SplashWindow()
  let mainProcess: MainProcessControl | undefined
  const cancelStartup = () => splashWindow.cancelDatabaseStartup()
  signal.addEventListener('abort', cancelStartup, { once: true })
  try {
    await splashWindow.create()
    signal.throwIfAborted()
    electronApp.setAppUserModelId('com.wefonk.deepchat')
    const mcpAppDesktop = await registerProtocols(
      {
        getProtocolPolicy: async (instanceId) =>
          (await mainProcess?.mcpAppSandbox.getProtocolPolicy(instanceId)) ?? null,
        requestBrowserPermission: async (...args) =>
          (await mainProcess?.mcpAppSandbox.requestBrowserPermission(...args)) ?? false
      },
      async (url) => (await mainProcess?.resolveWorkspacePreviewRequest(url)) ?? null
    )
    signal.throwIfAborted()

    mainProcess = await createMainProcessControl({
      mcpAppDesktop,
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
    await mainProcess?.stopForCleanup()
    throw error
  } finally {
    signal.removeEventListener('abort', cancelStartup)
  }
}
