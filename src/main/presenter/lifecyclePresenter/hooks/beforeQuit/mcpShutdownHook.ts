import logger from '@shared/logger'
import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import { presenter } from '@/presenter'

export const mcpShutdownHook: LifecycleHook = {
  name: 'mcp-shutdown',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 5,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    if (!presenter) {
      logger.info('mcpShutdownHook: Presenter is not available, skipping MCP shutdown')
      return
    }

    logger.info('mcpShutdownHook: Shutting down MCP servers before presenter teardown')

    try {
      await presenter.mcpPresenter.shutdown()
      logger.info('mcpShutdownHook: MCP servers shut down successfully')
    } catch (error) {
      logger.warn('mcpShutdownHook: Failed to shut down MCP servers during before-quit:', error)
    }
  }
}
