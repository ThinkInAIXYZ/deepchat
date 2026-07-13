import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import { runDisabledSearchToolCleanupMigration } from '@/presenter/startupMigrations/sessionDataMigrations'

export const disabledSearchToolCleanupHook: LifecycleHook = {
  name: 'disabled-search-tool-cleanup',
  phase: LifecyclePhase.AFTER_START,
  priority: 23,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('disabledSearchToolCleanupHook: Presenter not initialized')
    }

    void presenter.startupWorkloadCoordinator
      .scheduleTask({
        id: 'main:disabled-search-tool-cleanup',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.disabledSearchToolCleanup',
        run: async (taskContext) => {
          await runDisabledSearchToolCleanupMigration(
            {
              sqlitePresenter: presenter.sessionDataMigrationSQLite,
              configPresenter: presenter.configPresenter,
              appSessionService: presenter.appSessionService
            },
            taskContext
          )
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
