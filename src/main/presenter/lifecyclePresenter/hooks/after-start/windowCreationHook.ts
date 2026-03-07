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
  priority: 1,
  critical: true,
  execute: async (_context: LifecycleContext) => {
    console.log('windowCreationHook: Creating initial application window')

    // Ensure presenter is available
    if (!presenter) {
      throw new Error('windowCreationHook: Presenter not initialized')
    }

    // If no windows exist, create main window (first app startup)
    if (presenter.windowPresenter.getAllWindows().length === 0) {
      console.log('windowCreationHook: Creating initial app window on app startup')
      try {
        const windowId = await presenter.windowPresenter.createAppWindow({
          initialRoute: 'chat'
        })
        if (windowId) {
          console.log(
            `windowCreationHook: Initial app window created successfully with ID: ${windowId}`
          )
        } else {
          throw new Error('windowCreationHook: Failed to create initial app window - returned null')
        }
      } catch (error) {
        console.error('windowCreationHook: Error creating initial app window:', error)
        throw error
      }
    } else {
      console.log('windowCreationHook: App windows already exist, skipping initial window creation')
    }

    // Register global shortcuts
    presenter.shortcutPresenter.registerShortcuts()

    console.log('windowCreationHook: Initial application window created successfully')
  }
}
