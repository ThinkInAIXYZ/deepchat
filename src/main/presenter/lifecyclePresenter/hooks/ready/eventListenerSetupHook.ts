import logger from '@shared/logger'
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
    logger.info('eventListenerSetupHook: Setting up application event listeners')

    // Ensure presenter is available
    if (!presenter) {
      throw new Error('eventListenerSetupHook: Presenter not initialized')
    }

    // Add F12 DevTools support for new windows in development, ignore CmdOrControl + R in production
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Restore a main window hidden by close-to-tray when the Dock activates the app.
    // Keep native macOS Hide behavior intact by restoring only explicitly tracked close events.
    app.on('activate', function () {
      if (presenter.windowPresenter.restoreMainWindowHiddenByClose()) {
        return
      }

      const allWindows = presenter.windowPresenter.getAllWindows()
      if (allWindows.length === 0) {
        presenter.windowPresenter.createAppWindow({
          initialRoute: 'chat'
        })
      }
    })

    // Electron exposes no dedicated event for the application-level native macOS Hide command.
    // Wait for AppKit to update the hidden state before clearing close-to-hide restoration.
    app.on('did-resign-active', () => {
      setTimeout(() => {
        if (app.isHidden()) {
          presenter.windowPresenter.clearMainWindowHiddenByClose()
        }
      }, 0)
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
    eventBus.on(TRAY_EVENTS.CHECK_FOR_UPDATES, async () => {
      try {
        const settingsWindowId = await presenter.windowPresenter.createSettingsWindow()
        if (settingsWindowId == null) {
          console.warn('eventListenerSetupHook: Failed to open settings window for update check.')
          return
        }

        const navigateToAbout = () => {
          presenter.windowPresenter.sendSettingsNavigation(settingsWindowId, {
            routeName: 'settings-about'
          })
        }

        const triggerUpdateCheck = () => {
          presenter.windowPresenter.sendSettingsCheckForUpdates(settingsWindowId)
        }

        navigateToAbout()
        triggerUpdateCheck()
      } catch (error) {
        console.error(
          'eventListenerSetupHook: Failed to route tray update check to settings window:',
          error
        )
      }
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

    logger.info('eventListenerSetupHook: Application event listeners set up successfully')
  }
}
