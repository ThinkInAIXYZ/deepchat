import logger from '@shared/logger'
import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'

export const memoryMaintenanceStartHook: LifecycleHook = {
  name: 'memory-maintenance-start',
  phase: LifecyclePhase.AFTER_START,
  priority: 30,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('memoryMaintenanceStartHook: Presenter not initialized')
    }

    presenter.memoryPresenter.startBackgroundMaintenance()
    logger.info('memoryMaintenanceStartHook: Memory maintenance started')
  }
}
