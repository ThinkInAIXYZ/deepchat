import logger from '@shared/logger'
import type { DatabaseSchemaDiagnosis, DatabaseSchemaIssue } from '@shared/types/databaseSchema'
import type { DatabaseRepairReason } from '@shared/notifications'
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
import { MAX_MAIN_LOG_DURATION_MS } from '@/logging/mainLogEvents'
import { elapsedMonotonicMs, readMonotonicNow, type MonotonicClock } from '@/lib/monotonicTime'

type DatabaseInitializerOptions = {
  password?: string
  dbPath?: string
  observe?: (observation: DatabaseInitializationObservation) => void | Promise<void>
  now?: MonotonicClock
}

export type DatabaseSchemaDiagnosisOutcome = 'completed' | 'unavailable' | 'not_completed'

export type DatabaseInitializationObservation = {
  durationMs?: number
  repairAttempted: boolean
  schemaDiagnosis: DatabaseSchemaDiagnosisOutcome
  repairableIssueCount: number
  manualIssueCount: number
} & (
  | { outcome: 'completed' }
  | {
      outcome: 'failed'
      error:
        | { category: 'integrity' | 'persistence' }
        | { category: 'schema'; reason: DatabaseRepairReason }
    }
)

type StartupSchemaDiagnosisResult =
  | {
      outcome: 'completed'
      catalog: SchemaTableSpec[]
      diagnosis: DatabaseSchemaDiagnosis
    }
  | { outcome: 'unavailable' }

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
  private readonly observe: (observation: DatabaseInitializationObservation) => void | Promise<void>
  private readonly now?: MonotonicClock

  constructor(options?: DatabaseInitializerOptions) {
    // Initialize database path
    const dbDir = path.join(app.getPath('userData'), 'app_db')
    this.dbPath = options?.dbPath ?? path.join(dbDir, 'agent.db')
    this.password = options?.password
    this.observe = options?.observe ?? (() => undefined)
    this.now = options?.now
  }

  /**
   * Initialize the database connection and perform setup
   */
  async initialize(): Promise<MainDatabase> {
    const startedAt = readMonotonicNow(this.now)
    let repairAttempted = false
    let schemaDiagnosis: DatabaseSchemaDiagnosisOutcome = 'not_completed'
    let repairableIssueCount = 0
    let manualIssueCount = 0

    try {
      logger.info('DatabaseInitializer: Starting database initialization')

      while (true) {
        schemaDiagnosis = 'not_completed'
        repairableIssueCount = 0
        manualIssueCount = 0
        try {
          this.database = new MainDatabase(this.dbPath, this.password)

          const isValid = await this.validateConnection()
          if (!isValid) {
            throw new Error('Database connection validation failed')
          }

          // Startup checks use the fresh-install catalog so automatic repair does not create
          // retired legacy conversation tables. Manual settings repair still uses the full catalog.
          const startupDiagnosis = await this.diagnoseStartupSchema()
          if (startupDiagnosis.outcome === 'unavailable') {
            schemaDiagnosis = 'unavailable'
            repairableIssueCount = 0
            manualIssueCount = 0
            logger.info('DatabaseInitializer: Database initialization completed successfully')
            this.notifyInitializationObserver({
              outcome: 'completed',
              ...this.durationContext(startedAt),
              repairAttempted,
              schemaDiagnosis,
              repairableIssueCount,
              manualIssueCount
            })
            return this.database
          }

          const { catalog, diagnosis } = startupDiagnosis
          schemaDiagnosis = 'completed'
          repairableIssueCount = diagnosis.repairableIssues.length
          manualIssueCount = diagnosis.manualIssues.length
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
              this.notifyInitializationObserver({
                outcome: 'completed',
                ...this.durationContext(startedAt),
                repairAttempted,
                schemaDiagnosis,
                repairableIssueCount,
                manualIssueCount
              })
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
          this.notifyInitializationObserver({
            outcome: 'completed',
            ...this.durationContext(startedAt),
            repairAttempted,
            schemaDiagnosis,
            repairableIssueCount,
            manualIssueCount
          })
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
      this.notifyInitializationObserver({
        outcome: 'failed',
        ...this.durationContext(startedAt),
        repairAttempted,
        schemaDiagnosis,
        repairableIssueCount,
        manualIssueCount,
        error: this.classifyInitializationFailure(error)
      })
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

  private async diagnoseStartupSchema(): Promise<StartupSchemaDiagnosisResult> {
    if (!this.database) {
      return { outcome: 'unavailable' }
    }

    const start = readMonotonicNow()
    try {
      const catalog = getStartupSchemaCatalog()
      return {
        outcome: 'completed',
        catalog,
        diagnosis: await this.database.diagnoseSchema(catalog)
      }
    } catch (error) {
      console.warn(
        'DatabaseInitializer: Startup schema diagnosis failed; continuing startup:',
        error
      )
      return { outcome: 'unavailable' }
    } finally {
      this.logPhaseDuration('diagnose', start)
    }
  }

  private repairStartupSchema(catalog: SchemaTableSpec[]): void {
    const start = readMonotonicNow()
    try {
      repairSQLiteDatabaseFile(this.dbPath, this.password, { catalog })
    } finally {
      this.logPhaseDuration('repair', start)
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

  private durationContext(startedAt: number | undefined): { durationMs?: number } {
    const elapsed = elapsedMonotonicMs(startedAt, this.now)
    return elapsed === undefined ? {} : { durationMs: Math.min(elapsed, MAX_MAIN_LOG_DURATION_MS) }
  }

  private logPhaseDuration(phase: 'diagnose' | 'repair', startedAt: number | undefined): void {
    const elapsed = elapsedMonotonicMs(startedAt)
    logger.info(
      elapsed === undefined
        ? `DatabaseInitializer: phase=${phase} completed`
        : `DatabaseInitializer: phase=${phase} duration=${elapsed.toFixed(2)}ms`
    )
  }

  private notifyInitializationObserver(observation: DatabaseInitializationObservation): void {
    try {
      void Promise.resolve(this.observe(observation)).catch(() => undefined)
    } catch {
      // Diagnostics must not alter database initialization or recovery behavior.
    }
  }

  private classifyInitializationFailure(
    error: unknown
  ):
    | { category: 'integrity' | 'persistence' }
    | { category: 'schema'; reason: DatabaseRepairReason } {
    try {
      if (isDestructiveDatabaseError(error)) return { category: 'integrity' }
      const schemaError = classifySchemaError(error)
      return schemaError
        ? { category: 'schema', reason: schemaError.reason }
        : { category: 'persistence' }
    } catch {
      return { category: 'persistence' }
    }
  }
}
