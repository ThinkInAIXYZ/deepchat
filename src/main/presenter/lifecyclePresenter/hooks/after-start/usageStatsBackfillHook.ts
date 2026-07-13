import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'

export const usageStatsBackfillHook: LifecycleHook = {
  name: 'usage-stats-backfill',
  phase: LifecyclePhase.AFTER_START,
  priority: 21,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('usageStatsBackfillHook: Presenter not initialized')
    }

    void presenter.startupWorkloadCoordinator
      .scheduleTask({
        id: 'main:usage-stats-backfill',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.usageStatsBackfill',
        run: async (taskContext) => {
          await presenter.usageStatsService.startBackfill(taskContext)
        }
      })
      .catch((error) => {
        console.error('usageStatsBackfillHook: failed to start usage stats backfill:', error)
      })
  }
}
