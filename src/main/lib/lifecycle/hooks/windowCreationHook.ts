/**
 * Window creation hook for after-start phase
 * Creates the initial application window and registers shortcuts
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const windowCreationHook: LifecycleHook = {
  name: 'window-creation',
  phase: LifecyclePhase.AFTER_START,
  priority: 20,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    console.log('Creating initial application window')

    // Ensure presenter is available
    if (!presenter) {
      throw new Error('Presenter not initialized - database hook should run first')
    }

    // Immediately perform basic initialization, don't wait for window ready-to-show event
    presenter.init()

    // If no windows exist, create main window (first app startup)
    if (presenter.windowPresenter.getAllWindows().length === 0) {
      console.log('Main: Creating initial shell window on app startup')
      try {
        const windowId = await presenter.windowPresenter.createShellWindow({
          initialTab: {
            url: 'local://chat'
          }
        })
        if (windowId) {
          console.log(`Main: Initial shell window created successfully with ID: ${windowId}`)
        } else {
          console.error('Main: Failed to create initial shell window - returned null')
        }
      } catch (error) {
        console.error('Main: Error creating initial shell window:', error)
      }
    } else {
      console.log('Main: Shell windows already exist, skipping initial window creation')
    }

    // Register global shortcuts
    presenter.shortcutPresenter.registerShortcuts()

    console.log('Initial application window created successfully')
  }
}
