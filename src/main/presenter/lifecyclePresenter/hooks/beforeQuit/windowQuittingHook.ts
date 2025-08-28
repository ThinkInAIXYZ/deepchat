/**
 * presenter setup hook for after-start phase
 * Initializes the system presenter icon and menu
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const windowQuittingHook: LifecycleHook = {
  name: 'window-quitting',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: Number.MAX_VALUE, // make sure presenter be destroyed lastest
  critical: false,
  execute: async (_context: LifecycleContext) => {
    // Ensure presenter is available
    if (!presenter) {
      throw new Error('presenterDestroyHook: Presenter has been destroyed')
    }
    presenter.windowPresenter.setApplicationQuitting(true)
    presenter.windowPresenter.destroyFloatingChatWindow()
  }
}
