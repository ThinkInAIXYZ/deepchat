import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import { rtkRuntimeService } from '@/agent/shared/process/rtkRuntimeService'

export const rtkHealthCheckHook: LifecycleHook = {
  name: 'rtk-health-check',
  phase: LifecyclePhase.AFTER_START,
  priority: 20,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('rtkHealthCheckHook: Presenter not initialized')
    }

    void presenter.startupWorkloadCoordinator
      .scheduleTask({
        id: 'main:rtk-health-check',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.rtkHealthCheck',
        run: async (taskContext) => {
          taskContext.reportProgress(0)
          await taskContext.yield()
          await rtkRuntimeService.startHealthCheck()
          taskContext.reportProgress(1)
        }
      })
      .catch((error) => {
        console.error('rtkHealthCheckHook: failed to start RTK health check:', error)
      })
  }
}
