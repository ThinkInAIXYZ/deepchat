import logger from '@shared/logger'
/**
 * Presenter lifecycle hook
 */

import { LifecyclePhase } from '@shared/lifecycle'
import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { getInstance } from '@/presenter'

export const presenterInitHook: LifecycleHook = {
  name: 'presenter-initialization',
  phase: LifecyclePhase.READY,
  priority: 1,
  critical: true, // Presenter initialization is critical for app functionality
  async execute(context: LifecycleContext): Promise<void> {
    // init presenter
    logger.info('presenterInitHook: Create Presenter Instance')
    const presenter = getInstance(context.manager)
    presenter.deeplinkPresenter.init()
    presenter.init()
    context.presenter = presenter
  }
}
