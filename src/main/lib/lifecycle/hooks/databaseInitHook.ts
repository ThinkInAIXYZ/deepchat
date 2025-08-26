import { LifecycleHook, LifecycleContext } from '../types'
import { DatabaseInitializer } from '../DatabaseInitializer'

/**
 * Database initialization hook for the init phase
 * This hook initializes the database and makes it available to other components
 */
export const databaseInitHook: LifecycleHook = {
  name: 'database-initialization',
  priority: 1, // Execute early in the init phase
  critical: true, // Database initialization is critical for app functionality
  timeout: 30000, // 30 second timeout for database initialization

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
