/**
 * Scheduled tasks stop hook for beforeQuit phase
 * Stops the scheduler utility process during shutdown.
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const scheduledTasksStopHook: LifecycleHook = {
  name: 'scheduled-tasks-stop',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 30,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      return
    }
    presenter.scheduledTasks.stop()
  }
}
