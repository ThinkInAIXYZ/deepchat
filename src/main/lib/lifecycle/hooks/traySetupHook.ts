/**
 * Tray setup hook for after-start phase
 * Initializes the system tray icon and menu
 */

import { LifecycleHook, LifecycleContext } from '../types'
import { presenter } from '../../../presenter'

export const traySetupHook: LifecycleHook = {
  name: 'tray-setup',
  priority: 10,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    console.log('Setting up system tray')

    // Ensure presenter is available
    if (!presenter) {
      throw new Error('Presenter not initialized - database hook should run first')
    }

    // Initialize tray icon and menu, store presenter instance
    presenter.setupTray()

    console.log('System tray set up successfully')
  }
}
