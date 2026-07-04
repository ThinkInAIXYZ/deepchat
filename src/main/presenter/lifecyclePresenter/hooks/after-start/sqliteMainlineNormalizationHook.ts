import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import type {
  StartupWorkloadCoordinator,
  StartupWorkloadTaskContext
} from '@/presenter/startupWorkloadCoordinator'

export const sqliteMainlineNormalizationHook: LifecycleHook = {
  name: 'sqlite-mainline-normalization',
  phase: LifecyclePhase.AFTER_START,
  priority: 22,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('sqliteMainlineNormalizationHook: Presenter not initialized')
    }

    const agentSessionPresenter = presenter.agentSessionPresenter as unknown as {
      startMainlineNormalizationBackfillTask?: (
        taskContext?: StartupWorkloadTaskContext
      ) => Promise<void>
    }
    if (!agentSessionPresenter.startMainlineNormalizationBackfillTask) {
      return
    }

    const startupWorkloadCoordinator =
      presenter.getStartupWorkloadCoordinator() as StartupWorkloadCoordinator
    void startupWorkloadCoordinator
      .scheduleTask({
        id: 'main:sqlite-mainline-normalization',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.sqliteMainlineNormalization',
        run: async (taskContext) => {
          await agentSessionPresenter.startMainlineNormalizationBackfillTask?.(taskContext)
        }
      })
      .catch((error) => {
        console.error(
          'sqliteMainlineNormalizationHook: failed to start normalization backfill:',
          error
        )
      })
  }
}
