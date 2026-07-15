import logger from '@shared/logger'
/**
 * Presenter lifecycle hook
 */

import { LifecyclePhase } from '@shared/lifecycle'
import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { getInstance } from '@/presenter'
import type { IConfigPresenter, ISQLitePresenter } from '@shared/presenter'
import type { DatabaseSecurityPresenter } from '@/presenter/databaseSecurityPresenter'
import type { StartupWorkloadCoordinator } from '@/presenter/startupWorkloadCoordinator'

export const presenterInitHook: LifecycleHook = {
  name: 'presenter-initialization',
  phase: LifecyclePhase.READY,
  priority: 1,
  critical: true, // Presenter initialization is critical for app functionality
  async execute(context: LifecycleContext): Promise<void> {
    if (
      !context.config ||
      !context.database ||
      !context.databaseSecurity ||
      !context.startupWorkloadCoordinator ||
      typeof context.startupRunId !== 'string'
    ) {
      throw new Error('presenterInitHook: startup dependencies are incomplete')
    }

    // init presenter
    logger.info('presenterInitHook: Create Presenter Instance')
    const presenter = getInstance({
      configPresenter: context.config as IConfigPresenter,
      sqlitePresenter: context.database as ISQLitePresenter,
      databaseSecurityPresenter: context.databaseSecurity as DatabaseSecurityPresenter,
      startupWorkloadCoordinator: context.startupWorkloadCoordinator as StartupWorkloadCoordinator
    })
    presenter.deeplinkPresenter.init()
    presenter.init(context.startupRunId)
    context.presenter = presenter
  }
}
