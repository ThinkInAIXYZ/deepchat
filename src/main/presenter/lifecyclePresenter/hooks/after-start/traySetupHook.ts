import logger from '@shared/logger'
/**
 * Tray setup hook for after-start phase
 * Initializes the system tray icon and menu
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const traySetupHook: LifecycleHook = {
  name: 'tray-setup',
  phase: LifecyclePhase.AFTER_START,
  priority: 10,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    logger.info('traySetupHook: Setting up system tray')

    // Ensure presenter is available
    if (!presenter) {
      throw new Error('traySetupHook: Presenter not initialize')
    }

    // Initialize tray icon and menu, store presenter instance
    presenter.setupTray()

    logger.info('traySetupHook: System tray set up successfully')
  }
}
