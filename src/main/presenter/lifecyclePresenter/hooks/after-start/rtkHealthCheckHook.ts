import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import type {
  StartupWorkloadCoordinator,
  StartupWorkloadTaskContext
} from '@/presenter/startupWorkloadCoordinator'

export const rtkHealthCheckHook: LifecycleHook = {
  name: 'rtk-health-check',
  phase: LifecyclePhase.AFTER_START,
  priority: 20,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('rtkHealthCheckHook: Presenter not initialized')
    }

    const agentSessionPresenter = presenter.agentSessionPresenter as unknown as {
      startRtkHealthCheckTask?: (taskContext?: StartupWorkloadTaskContext) => Promise<void>
    }
    if (!agentSessionPresenter.startRtkHealthCheckTask) {
      return
    }

    const startupWorkloadCoordinator =
      presenter.getStartupWorkloadCoordinator() as StartupWorkloadCoordinator
    void startupWorkloadCoordinator
      .scheduleTask({
        id: 'main:rtk-health-check',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.rtkHealthCheck',
        run: async (taskContext) => {
          await agentSessionPresenter.startRtkHealthCheckTask?.(taskContext)
        }
      })
      .catch((error) => {
        console.error('rtkHealthCheckHook: failed to start RTK health check:', error)
      })
  }
}
