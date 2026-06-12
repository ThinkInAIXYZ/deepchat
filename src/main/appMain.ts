import logger from '@shared/logger'
import { app, dialog } from 'electron'
import { LifecycleManager, registerCoreHooks } from './presenter/lifecyclePresenter'
import { getInstance, Presenter } from './presenter'
import { electronApp } from '@electron-toolkit/utils'
import log from 'electron-log'
import { registerWorkspacePreviewSchemes } from './presenter/workspacePresenter/workspacePreviewProtocol'
import { publishDeepchatEvent } from './routes/publishDeepchatEvent'
import {
  findDeepLinkArg,
  findStartupDeepLink,
  isDeepLinkUrl,
  storeStartupDeepLink
} from './lib/startupDeepLink'
import { isInsecureTlsAllowed } from './lib/insecureTls'
import { activateAppOnMac, ensureRegularAppOnMac } from './lib/activateApp'

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
      // Send error to renderer to show a toast notification
      // This is "elegant" and non-blocking
      publishDeepchatEvent('notification.error', {
        id: Date.now().toString(),
        title: 'Network Error',
        message: msg,
        type: 'error'
      })
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

  // Initialize presenter after ready
  let presenter: Presenter | undefined

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
    const targetWindow = presenter?.windowPresenter.getAllWindows()[0]
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }

    if (targetWindow.isMinimized()) {
      targetWindow.restore()
    }
    targetWindow.show()
    targetWindow.focus()
    activateAppOnMac()
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

    if (presenter && app.isReady()) {
      void presenter.deeplinkPresenter.handleDeepLink(normalizedUrl)
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

  // Initialize lifecycle manager and register core hooks
  const lifecycleManager = new LifecycleManager()
  registerCoreHooks(lifecycleManager)

  function clearPresenterPermissionCaches(activePresenter?: Presenter): void {
    if (!activePresenter) return

    activePresenter.commandPermissionService.clearAll()
    activePresenter.filePermissionService.clearAll()
    activePresenter.settingsPermissionService.clearAll()
  }

  // Start the lifecycle management system instead of using app.whenReady()
  app.whenReady().then(async () => {
    ensureRegularAppOnMac()
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.wefonk.deepchat')
    try {
      logger.info('main: Application lifecycle startup')
      await lifecycleManager.start()
      presenter = getInstance(lifecycleManager)
      logger.info('main: Application lifecycle startup completed successfully')
    } catch (error) {
      console.error('main: Application lifecycle startup failed:', error)
      dialog.showErrorBox(
        'Application startup failed',
        error instanceof Error ? error.message : String(error)
      )
      app.quit() // Serious error, exit the program
    }
  })

  app.on('before-quit', () => {
    clearPresenterPermissionCaches(presenter)
  })

  // Handle window-all-closed event
  app.on('window-all-closed', () => {
    clearPresenterPermissionCaches(presenter)
    if (!presenter) return

    // Check if there are any non-floating-button windows
    const mainWindows = presenter.windowPresenter.getAllWindows()

    if (mainWindows.length === 0) {
      // When only floating button windows exist, quit app on non-macOS platforms
      logger.info('main: All main windows closed, requesting shutdown')
      app.quit() // Keep this event to avoid unexpected situations
    }
  })
}
