import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import type {
  StartupWorkloadCoordinator,
  StartupWorkloadTaskContext
} from '@/presenter/startupWorkloadCoordinator'

export const disabledSearchToolCleanupHook: LifecycleHook = {
  name: 'disabled-search-tool-cleanup',
  phase: LifecyclePhase.AFTER_START,
  priority: 23,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('disabledSearchToolCleanupHook: Presenter not initialized')
    }

    const agentSessionPresenter = presenter.agentSessionPresenter as unknown as {
      startDisabledSearchToolCleanupBackfillTask?: (
        taskContext?: StartupWorkloadTaskContext
      ) => Promise<void>
    }
    if (!agentSessionPresenter.startDisabledSearchToolCleanupBackfillTask) {
      return
    }

    const startupWorkloadCoordinator =
      presenter.getStartupWorkloadCoordinator() as StartupWorkloadCoordinator
    void startupWorkloadCoordinator
      .scheduleTask({
        id: 'main:disabled-search-tool-cleanup',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.disabledSearchToolCleanup',
        run: async (taskContext) => {
          await agentSessionPresenter.startDisabledSearchToolCleanupBackfillTask?.(taskContext)
        }
      })
      .catch((error) => {
        console.error(
          'disabledSearchToolCleanupHook: failed to start disabled search tool cleanup:',
          error
        )
      })
  }
}
