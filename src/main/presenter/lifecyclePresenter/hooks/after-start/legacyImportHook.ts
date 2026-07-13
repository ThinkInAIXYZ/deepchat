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

    void presenter.startupWorkloadCoordinator
      .scheduleTask({
        id: 'main:legacy-import',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.legacyImport',
        run: async () => {
          await presenter.legacyChatImportService.start(false)
        }
      })
      .catch((error) => {
        console.error('legacyImportHook: failed to start legacy import task:', error)
      })
  }
}
