import logger from '@shared/logger'
/**
 * Scheduled tasks start hook for after-start phase
 *
 * The route runtime owns the wiring between the scheduled tasks service and
 * the session service (for auto-send actions), so we force its construction
 * by reading any route runtime via getRuntime, then call `start()` so the
 * scheduler arms timers and backfills missed one-shot tasks.
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter, getMainKernelRouteRuntime } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const scheduledTasksStartHook: LifecycleHook = {
  name: 'scheduled-tasks-start',
  phase: LifecyclePhase.AFTER_START,
  priority: 20,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('scheduledTasksStartHook: Presenter not initialized')
    }

    // Touch the route runtime so the session creator gets wired up before
    // the scheduler fires anything.
    try {
      getMainKernelRouteRuntime()
    } catch (error) {
      console.warn(
        '[scheduledTasksStartHook] Failed to prime route runtime; auto-send may degrade to draft mode:',
        error
      )
    }

    presenter.scheduledTasks.start()
    logger.info('scheduledTasksStartHook: Scheduler started')
  }
}
