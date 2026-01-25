/**
 * Ensure ACP-related processes/PTYs are terminated during shutdown
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import { killTerminal } from '../initHelper'

export const acpCleanupHook: LifecycleHook = {
  name: 'acp-cleanup',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 6,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    console.log('[Lifecycle][ACP] acpCleanupHook: shutting down ACP resources')

    try {
      killTerminal()
    } catch (error) {
      console.warn('[Lifecycle][ACP] acpCleanupHook: failed to kill ACP init terminal:', error)
    }

    try {
      const llmPresenter = presenter?.llmproviderPresenter
      // Avoid instantiating ACP provider during shutdown; only clean up if already created
      const acpProvider = llmPresenter?.getExistingProviderInstance?.('acp') as
        | { cleanup?: () => Promise<void> }
        | undefined
      if (acpProvider?.cleanup) {
        await acpProvider.cleanup()
      }
    } catch (error) {
      console.warn('[Lifecycle][ACP] acpCleanupHook: failed to cleanup ACP provider:', error)
    }
  }
}
