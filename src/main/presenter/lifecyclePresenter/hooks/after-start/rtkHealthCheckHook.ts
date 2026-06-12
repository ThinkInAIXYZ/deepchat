import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'

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
      startRtkHealthCheck?: () => Promise<void>
    }
    if (!agentSessionPresenter.startRtkHealthCheck) {
      return
    }

    void agentSessionPresenter.startRtkHealthCheck().catch((error) => {
      console.error('rtkHealthCheckHook: failed to start RTK health check:', error)
    })
  }
}
