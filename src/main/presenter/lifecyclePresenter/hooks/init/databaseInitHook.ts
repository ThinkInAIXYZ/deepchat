import logger from '@shared/logger'
/**
 * Database initialization hook for the init phase
 * This hook initializes the database and makes it available to other components
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { DatabaseInitializer } from '../../DatabaseInitializer'
import { LifecyclePhase } from '@shared/lifecycle'
import { DatabaseSecurityPresenter } from '@/presenter/databaseSecurityPresenter'

export const databaseInitHook: LifecycleHook = {
  name: 'database-initialization',
  phase: LifecyclePhase.INIT,
  priority: 2, // Execute after config init
  critical: true,
  async execute(context: LifecycleContext): Promise<void> {
    logger.info('databaseInitHook: DatabaseInitHook: Starting database initialization')

    try {
      const databaseSecurity = new DatabaseSecurityPresenter()
      context.databaseSecurity = databaseSecurity

      const status = databaseSecurity.getStatus()
      context.splashManager?.showDatabaseUnlockProgress?.(
        {
          active: status.enabled,
          safeStorageAvailable: status.safeStorageAvailable
        },
        { skipDelay: status.enabled }
      )
      const password = await databaseSecurity.resolveStartupPassword(async (request) => {
        return (
          (await context.splashManager?.requestDatabaseUnlock?.({
            reason: request.reason,
            safeStorageAvailable: request.safeStorageAvailable
          })) ?? null
        )
      })
      context.splashManager?.showDatabaseUnlockProgress?.({
        active: false,
        safeStorageAvailable: databaseSecurity.getStatus().safeStorageAvailable
      })

      // Create database initializer
      const dbInitializer = new DatabaseInitializer({ password })

      // Initialize database
      const database = await dbInitializer.initialize()

      // Perform migrations
      await dbInitializer.migrate()

      // Store database in context for other hooks
      context.database = database

      logger.info('databaseInitHook: Database initialization completed successfully')
    } catch (error) {
      console.error('databaseInitHook: Database initialization failed:', error)
      throw error
    }
  }
}
