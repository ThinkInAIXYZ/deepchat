/**
 * Tray destroy hook
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const trayDestroyHook: LifecycleHook = {
  name: 'tray-destroy',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 10,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    console.log('trayDestroyHook: Destroy system tray')

    // Ensure presenter is available
    if (!presenter) {
      throw new Error('trayDestroyHook: Presenter has been destroyed')
    }

    // Destroy tray icon
    if (presenter.trayPresenter) {
      console.log('trayDestroyHook: Destroying tray during will-quit.')
      presenter.trayPresenter.destroy()
    } else {
      console.warn('trayDestroyHook: TrayPresenter not found in presenter during will-quit.')
    }

    console.log('trayDestroyHook: System tray destroyed successfully')
  }
}
