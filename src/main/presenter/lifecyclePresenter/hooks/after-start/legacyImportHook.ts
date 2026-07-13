import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import type { StartupWorkloadCoordinator } from '@/presenter/startupWorkloadCoordinator'

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
      startLegacyImportTask?: () => Promise<void>
    }
    if (!agentSessionPresenter.startLegacyImportTask) {
      return
    }

    const startupWorkloadCoordinator =
      presenter.getStartupWorkloadCoordinator() as StartupWorkloadCoordinator
    void startupWorkloadCoordinator
      .scheduleTask({
        id: 'main:legacy-import',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.legacyImport',
        run: async () => {
          await agentSessionPresenter.startLegacyImportTask?.()
        }
      })
      .catch((error) => {
        console.error('legacyImportHook: failed to start legacy import task:', error)
      })
  }
}
