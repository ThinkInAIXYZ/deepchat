import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import type {
  StartupWorkloadCoordinator,
  StartupWorkloadTaskContext
} from '@/presenter/startupWorkloadCoordinator'

export const usageStatsBackfillHook: LifecycleHook = {
  name: 'usage-stats-backfill',
  phase: LifecyclePhase.AFTER_START,
  priority: 21,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('usageStatsBackfillHook: Presenter not initialized')
    }

    const agentSessionPresenter = presenter.agentSessionPresenter as unknown as {
      startUsageStatsBackfillTask?: (taskContext?: StartupWorkloadTaskContext) => Promise<void>
    }
    if (!agentSessionPresenter.startUsageStatsBackfillTask) {
      return
    }

    const startupWorkloadCoordinator =
      presenter.getStartupWorkloadCoordinator() as StartupWorkloadCoordinator
    void startupWorkloadCoordinator
      .scheduleTask({
        id: 'main:usage-stats-backfill',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.usageStatsBackfill',
        run: async (taskContext) => {
          await agentSessionPresenter.startUsageStatsBackfillTask?.(taskContext)
        }
      })
      .catch((error) => {
        console.error('usageStatsBackfillHook: failed to start usage stats backfill:', error)
      })
  }
}
