import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import { runDisabledAgentToolCapabilityCleanupMigration } from '@/presenter/startupMigrations/sessionDataMigrations'

export const disabledAgentToolCleanupHook: LifecycleHook = {
  name: 'disabled-agent-tool-cleanup',
  phase: LifecyclePhase.AFTER_START,
  priority: 23,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      throw new Error('disabledAgentToolCleanupHook: Presenter not initialized')
    }

    void presenter.startupWorkloadCoordinator
      .scheduleTask({
        id: 'main:disabled-agent-tool-cleanup',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.disabledAgentToolCleanup',
        run: async (taskContext) => {
          await runDisabledAgentToolCapabilityCleanupMigration(
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
          'disabledAgentToolCleanupHook: failed to start disabled Agent tool cleanup:',
          error
        )
      })
  }
}
