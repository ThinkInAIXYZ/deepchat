/**
 * Event listener setup hook for ready phase
 * Sets up application event listeners and browser window event handlers
 */

import { app } from 'electron'
import { optimizer } from '@electron-toolkit/utils'
import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { eventBus } from '@/eventbus'
import { WINDOW_EVENTS, TRAY_EVENTS, FLOATING_BUTTON_EVENTS } from '@/events'
import { handleShowHiddenWindow } from '@/utils'
import { presenter } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const eventListenerSetupHook: LifecycleHook = {
  name: 'event-listener-setup',
  phase: LifecyclePhase.READY,
  priority: 10,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    console.log('eventListenerSetupHook: Setting up application event listeners')

    // Ensure presenter is available
    if (!presenter) {
      throw new Error('eventListenerSetupHook: Presenter not initialized')
    }

    // Add F12 DevTools support for new windows in development, ignore CmdOrControl + R in production
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Handle app activation event (like clicking Dock icon on macOS)
    app.on('activate', function () {
      // On macOS, it's common to re-create a window when the dock icon is clicked
      // Also handle showing hidden windows
      const allWindows = presenter.windowPresenter.getAllWindows()
      if (allWindows.length === 0) {
        presenter.windowPresenter.createShellWindow({
          initialTab: {
            url: 'local://chat'
          }
        })
      } else {
        // Try to show the most recently focused window, otherwise show the first window
        const targetWindow = presenter.windowPresenter.getFocusedWindow() || allWindows[0]
        if (!targetWindow.isDestroyed()) {
          targetWindow.show()
          targetWindow.focus() // Ensure window gets focus
        } else {
          console.warn(
            'eventListenerSetupHook: App activated but target window is destroyed, creating new window.'
          )
          presenter.windowPresenter.createShellWindow({
            // If target window is destroyed, create new window
            initialTab: { url: 'local://chat' }
          })
        }
      }
    })

    // Listen for floating button configuration change events
    eventBus.on(FLOATING_BUTTON_EVENTS.ENABLED_CHANGED, async (enabled: boolean) => {
      try {
        await presenter.floatingButtonPresenter.setEnabled(enabled)
      } catch (error) {
        console.error('eventListenerSetupHook: Failed to set floating button enabled state:', error)
      }
    })

    // Tray check for updates
    eventBus.on(TRAY_EVENTS.CHECK_FOR_UPDATES, () => {
      const allWindows = presenter.windowPresenter.getAllWindows()

      // Find target window (focused window or first window)
      const targetWindow = presenter.windowPresenter.getFocusedWindow() || allWindows![0]
      presenter.windowPresenter.show(targetWindow.id)
      targetWindow.focus() // Ensure window is on top

      // Trigger update
      presenter.upgradePresenter.checkUpdate()
    })

    // Listen for show/hide window events (triggered from tray or shortcut or floating window)
    eventBus.on(TRAY_EVENTS.SHOW_HIDDEN_WINDOW, handleShowHiddenWindow)

    // Listen for browser window focus events
    app.on('browser-window-focus', () => {
      // When any window gains focus, register shortcuts
      presenter.shortcutPresenter.registerShortcuts()
      eventBus.sendToMain(WINDOW_EVENTS.APP_FOCUS)
    })

    // Listen for browser window blur events
    app.on('browser-window-blur', () => {
      // Check if all windows have lost focus, if so unregister shortcuts
      // Use short delay to handle focus switching between windows
      setTimeout(() => {
        const allWindows = presenter.windowPresenter.getAllWindows()
        const isAnyWindowFocused = allWindows.some((win) => !win.isDestroyed() && win.isFocused())

        if (!isAnyWindowFocused) {
          presenter.shortcutPresenter.unregisterShortcuts()
          eventBus.sendToMain(WINDOW_EVENTS.APP_BLUR)
        }
      }, 50) // 50ms delay
    })

    console.log('eventListenerSetupHook: Application event listeners set up successfully')
  }
}
