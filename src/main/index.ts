import { app, dialog } from 'electron'
import { LifecycleManager, registerCoreHooks } from './presenter/lifecyclePresenter'
import { getInstance, Presenter } from './presenter'
import { electronApp } from '@electron-toolkit/utils'
import log from 'electron-log'
import { eventBus, SendTarget } from './eventbus'
import { NOTIFICATION_EVENTS } from './events'

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
    eventBus.sendToRenderer(NOTIFICATION_EVENTS.SHOW_ERROR, SendTarget.ALL_WINDOWS, {
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
app.commandLine.appendSwitch('ignore-certificate-errors') // Ignore certificate errors (for dev or specific scenarios)

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

// Check for startup deeplink before any other initialization
let startupDeepLink: string | null = null

console.log('Main process starting, checking for deeplink...')

// Check command line arguments for deeplink first
console.log('Full command line arguments:', process.argv)
const deepLinkArg = process.argv.find((arg) => {
  return arg.startsWith('deepchat://') || arg.includes('deepchat://') || arg.match(/^deepchat:/)
})

if (deepLinkArg) {
  console.log('Found startup deeplink in command line:', deepLinkArg)
  startupDeepLink = deepLinkArg
} else {
  console.log('No startup deeplink found in command line arguments')
}

// Check for deeplink in environment variables (macOS sometimes passes it this way)
const envDeepLink = process.env.DEEPLINK_URL || process.env.deepchat_deeplink
if (envDeepLink) {
  console.log('Found deeplink in environment variables:', envDeepLink)
  startupDeepLink = envDeepLink
}

// Listen for open-url events that might occur during startup
// This must be set before app.whenReady() because open-url events can fire before that
app.on('open-url', (event, url) => {
  event.preventDefault()
  console.log('Received open-url event during startup:', url)
  if (url.startsWith('deepchat://')) {
    console.log('Setting startup deeplink from open-url event:', url)
    startupDeepLink = url
    process.env.STARTUP_DEEPLINK = url
  }
})

// Also listen for second-instance events (Windows/Linux)
app.on('second-instance', (_event, commandLine) => {
  console.log('Received second-instance event with command line:', commandLine)
  const deepLinkUrl = commandLine.find((arg) => arg.startsWith('deepchat://'))
  if (deepLinkUrl) {
    console.log('Found deeplink in second-instance command line:', deepLinkUrl)
    startupDeepLink = deepLinkUrl
    process.env.STARTUP_DEEPLINK = deepLinkUrl
  }
})

// Store the startup deeplink for later use
if (startupDeepLink) {
  console.log('Final startup deeplink detected:', startupDeepLink)
  process.env.STARTUP_DEEPLINK = startupDeepLink
} else {
  console.log('No startup deeplink detected during initialization')
}

// Initialize lifecycle manager and register core hooks
const lifecycleManager = new LifecycleManager()
registerCoreHooks(lifecycleManager)

// Initialize presenter after ready
let presenter: Presenter
// Start the lifecycle management system instead of using app.whenReady()
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.wefonk.deepchat')
  try {
    console.log('main: Application lifecycle startup')
    await lifecycleManager.start()
    presenter = getInstance(lifecycleManager)
    console.log('main: Application lifecycle startup completed successfully')
  } catch (error) {
    console.error('main: Application lifecycle startup failed:', error)
    dialog.showErrorBox(
      'Application startup failed',
      error instanceof Error ? error.message : String(error)
    )
    app.quit() // Serious error, exit the program
  }
})

// Handle window-all-closed event
app.on('window-all-closed', () => {
  if (!presenter) return

  // Check if there are any non-floating-button windows
  const mainWindows = presenter.windowPresenter.getAllWindows()

  if (mainWindows.length === 0) {
    // When only floating button windows exist, quit app on non-macOS platforms
    console.log('main: All main windows closed, requesting shutdown')
    app.quit() // Keep this event to avoid unexpected situations
  }
})
