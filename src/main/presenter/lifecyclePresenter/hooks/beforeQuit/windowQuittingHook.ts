/**
 * window quitting flag setup hook
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const windowQuittingHook: LifecycleHook = {
  name: 'window-quitting',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 10, // make sure presenter be destroyed lastest
  critical: false,
  execute: async (_context: LifecycleContext) => {
    // Ensure presenter is available
    if (!presenter) {
      throw new Error('windowQuittingHook: Presenter has been destroyed')
    }
    presenter.windowPresenter.setApplicationQuitting(true)
    presenter.windowPresenter.destroyFloatingChatWindow()
  }
}
