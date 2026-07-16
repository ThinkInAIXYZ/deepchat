import logger from '@shared/logger'
import type { DatabaseSchemaDiagnosis, DatabaseSchemaIssue } from '@shared/types/databaseSchema'
import { app } from 'electron'
import path from 'path'
import {
  isDestructiveDatabaseError,
  repairSQLiteDatabaseFile,
  MainDatabase
} from '@/data/mainDatabase'
import { getStartupSchemaCatalog } from '@/data/schemaCatalog'
import { classifySchemaError } from '@/data/schemaErrorClassifier'
import type { SchemaTableSpec } from '@/data/schemaTypes'

type DatabaseInitializerOptions = {
  password?: string
  dbPath?: string
}

/**
 * Database initialization interface
 */
export interface IDatabaseInitializer {
  initialize(): Promise<MainDatabase>
  migrate(): Promise<void>
  validateConnection(): Promise<boolean>
}

/**
 * DatabaseInitializer opens and validates the main database before module construction.
 */
export class DatabaseInitializer implements IDatabaseInitializer {
  private dbPath: string
  private password?: string
  private database?: MainDatabase

  constructor(options?: DatabaseInitializerOptions) {
    // Initialize database path
    const dbDir = path.join(app.getPath('userData'), 'app_db')
    this.dbPath = options?.dbPath ?? path.join(dbDir, 'agent.db')
    this.password = options?.password
  }

  /**
   * Initialize the database connection and perform setup
   */
  async initialize(): Promise<MainDatabase> {
    let repairAttempted = false

    try {
      logger.info('DatabaseInitializer: Starting database initialization')

      while (true) {
        try {
          this.database = new MainDatabase(this.dbPath, this.password)

          const isValid = await this.validateConnection()
          if (!isValid) {
            throw new Error('Database connection validation failed')
          }

          // Startup checks use the fresh-install catalog so automatic repair does not create
          // retired legacy conversation tables. Manual settings repair still uses the full catalog.
          const startupDiagnosis = await this.diagnoseStartupSchema()
          if (!startupDiagnosis) {
            logger.info('DatabaseInitializer: Database initialization completed successfully')
            return this.database
          }

          const { catalog, diagnosis } = startupDiagnosis
          if (diagnosis.repairableIssues.length > 0) {
            if (repairAttempted) {
              console.warn(
                `DatabaseInitializer: Startup schema repair left repairable issues; continuing initialization: ${this.formatSchemaIssues(
                  diagnosis.repairableIssues
                )}`
              )
              this.warnManualSchemaIssues(diagnosis)
              logger.info(
                'DatabaseInitializer: Database initialization continued with residual startup schema issues'
              )
              return this.database
            }

            repairAttempted = true
            console.warn(
              `DatabaseInitializer: Attempting one-off schema repair for ${this.formatSchemaIssues(
                diagnosis.repairableIssues
              )}`
            )
            this.database.close()
            this.database = undefined
            this.repairStartupSchema(catalog)
            continue
          }

          this.warnManualSchemaIssues(diagnosis)

          logger.info('DatabaseInitializer: Database initialization completed successfully')
          return this.database
        } catch (error) {
          this.database?.close()
          this.database = undefined

          const classified = classifySchemaError(error)
          const shouldRepair =
            !repairAttempted && !isDestructiveDatabaseError(error) && classified !== null

          if (!shouldRepair) {
            throw error
          }

          repairAttempted = true
          console.warn(
            `DatabaseInitializer: Attempting one-off schema repair for ${classified.dedupeKey}`
          )
          // Construction-time schema failures use the same startup catalog for the same reason:
          // keep boot-time repair scoped to tables that fresh initialization owns.
          this.repairStartupSchema(getStartupSchemaCatalog())
        }
      }
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
      logger.info('DatabaseInitializer: Starting database migration')
      // Migration logic is already handled in MainDatabase constructor
      // This method is here for future migration needs that might be separate
      logger.info('DatabaseInitializer: Database migration completed')
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
      // Test basic database functionality without relying on any specific table.
      await this.database.runTransaction(() => {})
      return true
    } catch (error) {
      console.error('DatabaseInitializer: Connection validation failed:', error)
      return false
    }
  }

  private formatSchemaIssues(issues: DatabaseSchemaIssue[]): string {
    return issues
      .map((issue) => `${issue.kind}:${issue.table}.${issue.name}`)
      .slice(0, 8)
      .join(', ')
  }

  private async diagnoseStartupSchema(): Promise<{
    catalog: SchemaTableSpec[]
    diagnosis: DatabaseSchemaDiagnosis
  } | null> {
    if (!this.database) {
      return null
    }

    const start = performance.now()
    try {
      const catalog = getStartupSchemaCatalog()
      return {
        catalog,
        diagnosis: await this.database.diagnoseSchema(catalog)
      }
    } catch (error) {
      console.warn(
        'DatabaseInitializer: Startup schema diagnosis failed; continuing startup:',
        error
      )
      return null
    } finally {
      logger.info(
        `DatabaseInitializer: phase=diagnose duration=${(performance.now() - start).toFixed(2)}ms`
      )
    }
  }

  private repairStartupSchema(catalog: SchemaTableSpec[]): void {
    const start = performance.now()
    try {
      repairSQLiteDatabaseFile(this.dbPath, this.password, { catalog })
    } finally {
      logger.info(
        `DatabaseInitializer: phase=repair duration=${(performance.now() - start).toFixed(2)}ms`
      )
    }
  }

  private warnManualSchemaIssues(diagnosis: DatabaseSchemaDiagnosis): void {
    if (diagnosis.manualIssues.length === 0) {
      return
    }

    console.warn(
      `DatabaseInitializer: Manual database schema action may be required: ${this.formatSchemaIssues(
        diagnosis.manualIssues
      )}`
    )
  }
}
