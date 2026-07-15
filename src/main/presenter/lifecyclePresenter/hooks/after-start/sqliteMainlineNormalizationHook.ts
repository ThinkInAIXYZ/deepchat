import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import { runMainlineNormalizationMigration } from '@/presenter/startupMigrations/sessionDataMigrations'

export const sqliteMainlineNormalizationHook: LifecycleHook = {
  name: 'sqlite-mainline-normalization',
  phase: LifecyclePhase.AFTER_START,
  priority: 22,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('sqliteMainlineNormalizationHook: Presenter not initialized')
    }

    void presenter.startupWorkloadCoordinator
      .scheduleTask({
        id: 'main:sqlite-mainline-normalization',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.sqliteMainlineNormalization',
        run: async (taskContext) => {
          await runMainlineNormalizationMigration(
            {
              sqlitePresenter: presenter.sessionDataMigrationSQLite,
              configPresenter: presenter.configPresenter
            },
            taskContext
          )
        }
      })
      .catch((error) => {
        console.error(
          'sqliteMainlineNormalizationHook: failed to start normalization backfill:',
          error
        )
      })
  }
}
