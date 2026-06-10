import logger from '@shared/logger'
import { ILifecycleManager } from '@shared/presenter'
import * as hooks from './hooks'

/**
 * Register core application hooks with the lifecycle manager
 * This function should be called during lifecycle manager initialization
 */
export function registerCoreHooks(lifecycleManager: ILifecycleManager): void {
  logger.info('Registering core application lifecycle hooks')
  Object.keys(hooks).forEach((key) => {
    lifecycleManager.registerHook(hooks[key])
  })
}
