/**
 * Database initialization hook for the init phase
 * This hook initializes the database and makes it available to other components
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { DatabaseInitializer } from '../../DatabaseInitializer'
import { LifecyclePhase } from '@shared/lifecycle'

export const databaseInitHook: LifecycleHook = {
  name: 'database-initialization',
  phase: LifecyclePhase.INIT,
  priority: 2, // Execute after config init
  critical: true,
  async execute(context: LifecycleContext): Promise<void> {
    console.log('databaseInitHook: DatabaseInitHook: Starting database initialization')

    try {
      // Create database initializer
      const dbInitializer = new DatabaseInitializer()

      // Initialize database
      const database = await dbInitializer.initialize()

      // Perform migrations
      await dbInitializer.migrate()

      // Store database in context for other hooks
      context.database = database

      console.log('databaseInitHook: Database initialization completed successfully')
    } catch (error) {
      console.error('databaseInitHook: Database initialization failed:', error)
      throw error
    }
  }
}
