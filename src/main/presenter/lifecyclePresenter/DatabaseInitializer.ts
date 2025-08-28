import { app } from 'electron'
import path from 'path'
import { SQLitePresenter } from '@/presenter/sqlitePresenter'

/**
 * Database initialization interface
 */
export interface IDatabaseInitializer {
  initialize(): Promise<SQLitePresenter>
  migrate(): Promise<void>
  validateConnection(): Promise<boolean>
}

/**
 * DatabaseInitializer handles database initialization during the init phase,
 * separate from presenter construction
 */
export class DatabaseInitializer implements IDatabaseInitializer {
  private dbPath: string
  private password?: string
  private database?: SQLitePresenter

  constructor(password?: string) {
    // Initialize database path
    const dbDir = path.join(app.getPath('userData'), 'app_db')
    this.dbPath = path.join(dbDir, 'chat.db')
    this.password = password
  }

  /**
   * Initialize the database connection and perform setup
   */
  async initialize(): Promise<SQLitePresenter> {
    try {
      console.log('DatabaseInitializer: Starting database initialization')

      // Create SQLitePresenter instance
      this.database = new SQLitePresenter(this.dbPath, this.password)

      // Validate the connection
      const isValid = await this.validateConnection()
      if (!isValid) {
        throw new Error('Database connection validation failed')
      }

      console.log('DatabaseInitializer: Database initialization completed successfully')
      return this.database
    } catch (error) {
      console.error('DatabaseInitializer: Database initialization failed:', error)
      throw error
    }
  }

  /**
   * Perform database migrations
   */
  async migrate(): Promise<void> {
    if (!this.database) {
      throw new Error('Database must be initialized before migration')
    }

    try {
      console.log('DatabaseInitializer: Starting database migration')
      // Migration logic is already handled in SQLitePresenter constructor
      // This method is here for future migration needs that might be separate
      console.log('DatabaseInitializer: Database migration completed')
    } catch (error) {
      console.error('DatabaseInitializer: Database migration failed:', error)
      throw error
    }
  }

  /**
   * Validate database connection
   */
  async validateConnection(): Promise<boolean> {
    if (!this.database) {
      return false
    }

    try {
      // Test basic database functionality
      await this.database.getConversationCount()
      return true
    } catch (error) {
      console.error('DatabaseInitializer: Connection validation failed:', error)
      return false
    }
  }
}
