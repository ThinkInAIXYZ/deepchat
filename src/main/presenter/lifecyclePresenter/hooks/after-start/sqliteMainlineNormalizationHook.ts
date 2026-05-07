import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'

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
      startMainlineNormalizationBackfill?: () => Promise<void>
    }
    if (!agentSessionPresenter.startMainlineNormalizationBackfill) {
      return
    }

    void agentSessionPresenter.startMainlineNormalizationBackfill().catch((error) => {
      console.error(
        'sqliteMainlineNormalizationHook: failed to start normalization backfill:',
        error
      )
    })
  }
}
