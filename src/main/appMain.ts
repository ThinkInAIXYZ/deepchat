import logger from '@shared/logger'
import { app, dialog } from 'electron'
import { StartupWorkloadCoordinator } from './app/startupWorkloadCoordinator'
import log from 'electron-log'
import { registerWorkspacePreviewSchemes } from './workspace/workspacePreviewProtocol'
import {
  findDeepLinkArg,
  findStartupDeepLink,
  isDeepLinkUrl,
  storeStartupDeepLink
} from './lib/startupDeepLink'
import { isInsecureTlsAllowed } from './lib/insecureTls'
import { ensureRegularAppOnMac } from './lib/activateApp'
import { startMainProcess, type MainProcessControl } from './app/mainProcess'

let appStarted = false
const APP_NAME = 'DeepChat'

export function startApp(): void {
  if (appStarted) {
    return
  }
  appStarted = true

  const e2eUserDataDir = process.env.DEEPCHAT_E2E_USER_DATA_DIR?.trim()
  if (e2eUserDataDir) {
    app.setPath('userData', e2eUserDataDir)
  }

  app.setName(APP_NAME)
  if (process.platform === 'darwin') {
    if (app.isReady()) {
      ensureRegularAppOnMac()
    } else {
      app.once('ready', () => {
        ensureRegularAppOnMac()
      })
    }
  }

  registerWorkspacePreviewSchemes()

  let mainProcess: MainProcessControl | undefined
  let allowQuit = false
  let shutdownPromise: Promise<void> | undefined

  // Handle unhandled exceptions to prevent app crash or error dialogs
  process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception:', error)

    const msg = error.message || 'Unknown error'
    const isNetworkError = [
      'net::ERR',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'Network Error',
      'fetch failed'
    ].some((k) => msg.includes(k))

    if (isNetworkError) {
      mainProcess?.notifyUnhandledError(error)
    }
  })

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled Rejection:', reason)
  })

  // Set application command line arguments
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required') // Allow video autoplay
  app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100') // Set WebRTC max CPU usage
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096') // Set V8 heap memory size
  if (isInsecureTlsAllowed()) {
    // This disables certificate validation app-wide, so keep it limited to local debugging.
    app.commandLine.appendSwitch('ignore-certificate-errors')
  }

  // Set platform-specific command line arguments
  if (process.platform == 'win32') {
    // Windows platform specific parameters (currently commented out)
    // app.commandLine.appendSwitch('in-process-gpu')
    // app.commandLine.appendSwitch('wm-window-animations-disabled')
  }
  if (process.platform === 'darwin') {
    // macOS platform specific parameters
    app.commandLine.appendSwitch('disable-features', 'DesktopCaptureMacV2,IOSurfaceCapturer')
  }

  const gotSingleInstanceLock = app.requestSingleInstanceLock()
  if (!gotSingleInstanceLock) {
    logger.info('Another DeepChat instance is already running. Exiting current process.')
    app.quit()
    return
  }

  logger.info('Main process starting, checking for deeplink...')
  logger.info('Startup arguments received', { argc: process.argv.length })
  const startupDeepLink = findStartupDeepLink(process.argv, process.env)
  if (startupDeepLink) {
    logger.info('Found startup deeplink during initialization')
    storeStartupDeepLink(startupDeepLink)
  } else {
    logger.info('No startup deeplink detected during initialization')
  }

  const focusExistingAppWindow = () => {
    mainProcess?.focusPrimaryWindow()
  }

  const routeIncomingDeeplink = (url: string, source: string) => {
    if (!isDeepLinkUrl(url)) {
      return
    }

    logger.info(source)
    const normalizedUrl = storeStartupDeepLink(url)
    if (!normalizedUrl) {
      return
    }

    if (mainProcess && app.isReady()) {
      void mainProcess.handleDeepLink(normalizedUrl)
    }
  }

  // Listen for open-url events that might occur during startup
  // This must be set before app.whenReady() because open-url events can fire before that
  app.on('open-url', (event, url) => {
    event.preventDefault()
    routeIncomingDeeplink(url, 'Received open-url event')
  })

  // Also listen for second-instance events (Windows/Linux)
  if (gotSingleInstanceLock) {
    app.on('second-instance', (_event, commandLine) => {
      logger.info('Received second-instance event', { argc: commandLine.length })
      focusExistingAppWindow()

      const deepLinkUrl = findDeepLinkArg(commandLine)
      if (deepLinkUrl) {
        routeIncomingDeeplink(deepLinkUrl, 'Received second-instance deeplink')
      }
    })
  }

  const startupWorkloadCoordinator = new StartupWorkloadCoordinator()
  const mainStartupRunId = startupWorkloadCoordinator.createRun('main')

  const requestUpdateInstall = async (installAction: () => void): Promise<void> => {
    const activeMainProcess = mainProcess
    if (!activeMainProcess) {
      throw new Error('Cannot install update before main process startup completes')
    }
    if (shutdownPromise) {
      throw new Error('Cannot install update while application shutdown is already in progress')
    }

    activeMainProcess.clearPermissionCaches()
    shutdownPromise = activeMainProcess.stop()
    await shutdownPromise
    allowQuit = true
    installAction()
  }

  app.whenReady().then(async () => {
    ensureRegularAppOnMac()
    try {
      logger.info('main: Application startup')
      mainProcess = await startMainProcess(
        startupWorkloadCoordinator,
        mainStartupRunId,
        requestUpdateInstall
      )
      logger.info('main: Application startup completed successfully')
    } catch (error) {
      console.error('main: Application startup failed:', error)
      dialog.showErrorBox(
        'Application startup failed',
        error instanceof Error ? error.message : String(error)
      )
      allowQuit = true
      app.quit()
    }
  })

  app.on('before-quit', (event) => {
    mainProcess?.clearPermissionCaches()
    if (allowQuit) {
      return
    }

    event.preventDefault()
    if (shutdownPromise) {
      return
    }

    shutdownPromise = (async () => {
      const activeMainProcess = mainProcess
      if (!activeMainProcess) {
        allowQuit = true
        app.quit()
        return
      }

      const confirmed = await activeMainProcess.confirmShutdown()
      if (!confirmed) {
        activeMainProcess.cancelShutdown()
        shutdownPromise = undefined
        return
      }

      try {
        await activeMainProcess.stop()
      } catch (error) {
        logger.error('main: Application shutdown failed:', error)
      }

      allowQuit = true
      app.quit()
    })()
  })

  // Handle window-all-closed event
  app.on('window-all-closed', () => {
    mainProcess?.clearPermissionCaches()
    if (!mainProcess) return

    if (!mainProcess.hasMainWindows()) {
      // When only floating button windows exist, quit app on non-macOS platforms
      logger.info('main: All main windows closed, requesting shutdown')
      app.quit() // Keep this event to avoid unexpected situations
    }
  })
}
