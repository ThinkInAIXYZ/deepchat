import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'

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
      startDisabledSearchToolCleanupBackfill?: () => Promise<void>
    }
    if (!agentSessionPresenter.startDisabledSearchToolCleanupBackfill) {
      return
    }

    void agentSessionPresenter.startDisabledSearchToolCleanupBackfill().catch((error) => {
      console.error(
        'disabledSearchToolCleanupHook: failed to start disabled search tool cleanup:',
        error
      )
    })
  }
}
