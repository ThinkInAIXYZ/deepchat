import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import { AcpRegistryMigrationService } from '@/presenter/configPresenter/acpRegistryMigrationService'

export const acpRegistryMigrationHook: LifecycleHook = {
  name: 'acp-registry-migration',
  phase: LifecyclePhase.AFTER_START,
  priority: 0,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter?.configPresenter || !presenter?.sqlitePresenter) {
      throw new Error('acpRegistryMigrationHook: Presenter not initialized')
    }

    const service = new AcpRegistryMigrationService(
      presenter.configPresenter,
      presenter.sqlitePresenter
    )

    try {
      await service.runIfNeeded()
    } catch (error) {
      console.error('acpRegistryMigrationHook: failed to migrate ACP registry references:', error)
    }

    try {
      await service.compensateEnabledRegistryAgentInstalls()
    } catch (error) {
      console.error('acpRegistryMigrationHook: failed to compensate ACP install states:', error)
    }
  }
}
