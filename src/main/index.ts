import { app } from 'electron'
import { LifecycleManager, registerCoreHooks } from './lib/lifecycle'
import { getInstance, Presenter } from './presenter'

app.setAppUserModelId('com.deepchat.app')

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
  try {
    await lifecycleManager.start()
    presenter = getInstance(lifecycleManager)
    console.log('Application lifecycle startup completed successfully')
  } catch (error) {
    console.error('Application lifecycle startup failed:', error)
    app.quit()
  }
})

// Handle window-all-closed event
// macOS platform will remain in Dock, Windows will remain in tray
// Floating button windows are not counted as main windows
app.on('window-all-closed', () => {
  if (!presenter) return

  // Check if there are any non-floating-button windows
  const mainWindows = presenter.windowPresenter.getAllWindows()

  if (mainWindows.length === 0) {
    // When only floating button windows exist, quit app on non-macOS platforms
    if (process.platform !== 'darwin') {
      console.log('main: All main windows closed on non-macOS platform, requesting shutdown')
      lifecycleManager.requestShutdown()
    } else {
      console.log('main: All main windows closed on macOS, keeping app running in dock')
    }
  }
})

// Handle will-quit event for final resource cleanup (like destroying tray)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.on('will-quit', (_event) => {
  console.log('main: app will-quit event triggered.')

  if (!presenter) return

  // Destroy tray icon
  if (presenter.trayPresenter) {
    console.log('main: Destroying tray during will-quit.')
    presenter.trayPresenter.destroy()
  } else {
    console.warn('main: TrayPresenter not found in presenter during will-quit.')
  }

  // Call presenter's destroy method for other cleanup
  if (presenter.destroy) {
    console.log('main: Calling presenter.destroy() during will-quit.')
    presenter.destroy()
  }
})

// Handle before-quit event - destroy floating button to ensure app can exit properly
app.on('before-quit', () => {
  if (!presenter) return

  try {
    presenter.floatingButtonPresenter.destroy()
  } catch (error) {
    console.error('main: Error destroying floating button during before-quit:', error)
  }
})
