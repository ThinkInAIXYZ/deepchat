import logger from '@shared/logger'
/**
 * Ensure ACP-related processes/PTYs are terminated during shutdown
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'
import { killTerminal } from '@/agent/acp/launch/acpInitHelper'

export const acpCleanupHook: LifecycleHook = {
  name: 'acp-cleanup',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 6,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    logger.info('[Lifecycle][ACP] acpCleanupHook: shutting down ACP resources')

    try {
      killTerminal()
    } catch (error) {
      console.warn('[Lifecycle][ACP] acpCleanupHook: failed to kill ACP init terminal:', error)
    }

    try {
      const llmPresenter = presenter?.llmproviderPresenter
      // The composition owner closes direct instances before the shared process/session runtime.
      const runtimeOwner = llmPresenter as { shutdownAcpRuntime?: () => Promise<void> } | undefined
      if (runtimeOwner?.shutdownAcpRuntime) {
        await runtimeOwner.shutdownAcpRuntime()
      }
    } catch (error) {
      console.warn('[Lifecycle][ACP] acpCleanupHook: failed to shut down ACP runtime:', error)
    }
  }
}
