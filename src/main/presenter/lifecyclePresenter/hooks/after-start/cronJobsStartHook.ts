import logger from '@shared/logger'
import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter, getMainKernelRouteRuntime } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const cronJobsStartHook: LifecycleHook = {
  name: 'cron-jobs-start',
  phase: LifecyclePhase.AFTER_START,
  priority: 21,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('cronJobsStartHook: Presenter not initialized')
    }

    try {
      getMainKernelRouteRuntime()
    } catch (error) {
      console.warn(
        '[cronJobsStartHook] Failed to prime route runtime; cron jobs cannot create sessions until routes initialize:',
        error
      )
    }

    presenter.cronJobs.start()
    logger.info('cronJobsStartHook: Scheduler reconciled')
  }
}
