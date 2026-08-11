import { app, dialog } from 'electron'
import { StartupWorkloadCoordinator } from './app/startupWorkloadCoordinator'
import { registerWorkspacePreviewSchemes } from './workspace/workspacePreviewProtocol'
import { registerMcpAppScheme } from './mcp/apps/sandboxProtocol'
import {
  findDeepLinkArg,
  findStartupDeepLink,
  isDeepLinkUrl,
  storeStartupDeepLink
} from './lib/startupDeepLink'
import { isInsecureTlsAllowed } from './lib/insecureTls'
import { ensureRegularAppOnMac } from './lib/activateApp'
import { startMainProcess, type MainProcessControl } from './app/mainProcess'
import type { MainShutdownActionClaim } from './app/mainShutdownCoordinator'
import { mainLogger, reportMainProcessFatal, reportNativeMainError } from './logging'
import { classifyMainLogError, type MainLogShutdownReason } from './logging/mainLogEvents'
import { elapsedMonotonicMs, readMonotonicNow } from './lib/monotonicTime'

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
  registerMcpAppScheme()

  let mainProcess: MainProcessControl | undefined
  let allowQuit = false
  let shutdownPromise: Promise<void> | undefined
  let shutdownReason: MainLogShutdownReason = 'app_quit'

  // Handle unhandled exceptions to prevent app crash or error dialogs
  process.on('uncaughtException', (error) => {
    reportMainProcessFatal('process.uncaught_exception', error)
  })

  process.on('unhandledRejection', (reason) => {
    reportMainProcessFatal('process.unhandled_rejection', reason)
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
    app.quit()
    return
  }

  const startupDeepLink = findStartupDeepLink(process.argv, process.env)
  if (startupDeepLink) {
    storeStartupDeepLink(startupDeepLink)
  }

  const focusExistingAppWindow = () => {
    mainProcess?.focusPrimaryWindow()
  }

  const routeIncomingDeeplink = (url: string) => {
    if (!isDeepLinkUrl(url)) {
      return
    }

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
    routeIncomingDeeplink(url)
  })

  // Also listen for second-instance events (Windows/Linux)
  if (gotSingleInstanceLock) {
    app.on('second-instance', (_event, commandLine) => {
      focusExistingAppWindow()

      const deepLinkUrl = findDeepLinkArg(commandLine)
      if (deepLinkUrl) {
        routeIncomingDeeplink(deepLinkUrl)
      }
    })
  }

  const startupWorkloadCoordinator = new StartupWorkloadCoordinator()
  const mainStartupRunId = startupWorkloadCoordinator.createRun('main')
  const startupStartedAt = readMonotonicNow()
  mainLogger.emit('app.startup.started', {
    startupRunId: mainStartupRunId,
    argumentCount: process.argv.length,
    deepLinkPresent: startupDeepLink !== null
  })

  const requestUpdateInstall = async (installAction: () => void): Promise<void> => {
    const activeMainProcess = mainProcess
    if (!activeMainProcess) {
      throw new Error('Cannot install update before main process startup completes')
    }
    if (shutdownPromise) {
      throw new Error('Cannot install update while application shutdown is already in progress')
    }

    activeMainProcess.clearPermissionCaches()
    let actionClaim: MainShutdownActionClaim | undefined
    shutdownPromise = (async () => {
      actionClaim = await activeMainProcess.stop('update_install')
      if (!actionClaim) {
        throw new Error('Application shutdown is already owned by another action')
      }
    })()
    try {
      await shutdownPromise
      if (!actionClaim) throw new Error('Application shutdown claim is unavailable')
      allowQuit = true
      await actionClaim.run(installAction)
    } catch (error) {
      allowQuit = false
      actionClaim?.abandon()
      shutdownPromise = undefined
      throw error
    }
  }

  app.whenReady().then(async () => {
    ensureRegularAppOnMac()
    try {
      mainProcess = await startMainProcess(
        startupWorkloadCoordinator,
        mainStartupRunId,
        requestUpdateInstall
      )
      const durationMs = elapsedMonotonicMs(startupStartedAt)
      mainLogger.emit('app.startup.terminal', {
        startupRunId: mainStartupRunId,
        outcome: 'completed',
        ...(durationMs === undefined ? {} : { durationMs })
      })
    } catch (error) {
      reportNativeMainError('main: Application startup failed:', error)
      const durationMs = elapsedMonotonicMs(startupStartedAt)
      mainLogger.emit('app.startup.terminal', {
        startupRunId: mainStartupRunId,
        outcome: 'failed',
        ...(durationMs === undefined ? {} : { durationMs }),
        error: classifyMainLogError(error)
      })
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
        shutdownReason = 'app_quit'
        return
      }

      let actionClaim: MainShutdownActionClaim | undefined
      try {
        actionClaim = await activeMainProcess.stop(shutdownReason)
        if (!actionClaim) {
          shutdownPromise = undefined
          shutdownReason = 'app_quit'
          return
        }
      } catch (error) {
        reportNativeMainError('main: Application shutdown teardown failed:', error)
        // Teardown is one-shot and may already have dismantled application services. Continue with
        // the emergency quit rather than leave a partially stopped process that cannot retry it.
      }

      allowQuit = true
      try {
        if (actionClaim) {
          await actionClaim.run(() => app.quit())
        } else {
          app.quit()
        }
      } catch (error) {
        reportNativeMainError('main: Application shutdown action failed:', error)
        allowQuit = false
        actionClaim?.abandon()
        shutdownPromise = undefined
        shutdownReason = 'app_quit'
      }
    })()
  })

  // Handle window-all-closed event
  app.on('window-all-closed', () => {
    mainProcess?.clearPermissionCaches()
    if (!mainProcess) return

    if (!mainProcess.hasMainWindows()) {
      // When only floating button windows exist, quit app on non-macOS platforms
      shutdownReason = 'all_windows_closed'
      app.quit() // Keep this event to avoid unexpected situations
    }
  })
}
