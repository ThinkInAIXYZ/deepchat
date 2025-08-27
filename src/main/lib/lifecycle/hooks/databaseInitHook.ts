import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { DatabaseInitializer } from '../DatabaseInitializer'
import { LifecyclePhase } from '@shared/lifecycle'

/**
 * Database initialization hook for the init phase
 * This hook initializes the database and makes it available to other components
 */
export const databaseInitHook: LifecycleHook = {
  name: 'database-initialization',
  phase: LifecyclePhase.INIT,
  priority: 2, // Execute after config init
  critical: true, // Database initialization is critical for app functionality
  async execute(context: LifecycleContext): Promise<void> {
    console.log('DatabaseInitHook: Starting database initialization')

    try {
      // Create database initializer
      const dbInitializer = new DatabaseInitializer()

      // Initialize database
      const database = await dbInitializer.initialize()

      // Perform migrations
      await dbInitializer.migrate()

      // Store database in context for other hooks
      context.database = database

      console.log('DatabaseInitHook: Database initialization completed successfully')
    } catch (error) {
      console.error('DatabaseInitHook: Database initialization failed:', error)
      throw error // Re-throw to halt the init phase since this is critical
    }
  }
}
