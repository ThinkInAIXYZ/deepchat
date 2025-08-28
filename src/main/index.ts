import { app, dialog } from 'electron'
import { LifecycleManager, registerCoreHooks } from './presenter/lifecyclePresenter'
import { getInstance, Presenter } from './presenter'
import { electronApp } from '@electron-toolkit/utils'

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
