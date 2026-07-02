import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const cronJobsStopHook: LifecycleHook = {
  name: 'cron-jobs-stop',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 29,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      return
    }
    await presenter.cronJobs.stop()
  }
}
