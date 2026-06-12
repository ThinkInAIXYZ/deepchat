import logger from '@shared/logger'
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
      logger.info(
        'windowQuittingHook: Presenter not available, isQuitting flag should already be set by LifecycleManager'
      )
      return
    }

    logger.info(
      'windowQuittingHook: Setting application quitting flag and destroying floating window'
    )
    presenter.windowPresenter.setApplicationQuitting(true)
    presenter.windowPresenter.destroyFloatingChatWindow()
  }
}
