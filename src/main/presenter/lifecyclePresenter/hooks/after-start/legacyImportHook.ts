import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'

export const legacyImportHook: LifecycleHook = {
  name: 'legacy-import',
  phase: LifecyclePhase.AFTER_START,
  priority: 20,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('legacyImportHook: Presenter not initialized')
    }

    const agentSessionPresenter = presenter.agentSessionPresenter as unknown as {
      startLegacyImport?: () => Promise<void>
    }
    if (!agentSessionPresenter.startLegacyImport) {
      return
    }

    // Fire and forget to avoid blocking app startup.
    void agentSessionPresenter.startLegacyImport().catch((error) => {
      console.error('legacyImportHook: failed to start legacy import task:', error)
    })
  }
}
