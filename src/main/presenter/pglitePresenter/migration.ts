/**
 * PGlite Migration System
 * Handles schema migration execution, rollback, and version management
 * Supports requirements 5.3, 5.4 for schema versioning and rollback capabilities
 */

import { SchemaMigration, MigrationResult, PGliteSchemaManager } from './schema'

export interface MigrationExecutionOptions {
  dryRun?: boolean
  continueOnError?: boolean
  timeout?: number
  progressCallback?: (progress: MigrationProgress) => void
}

export interface MigrationProgress {
  currentMigration: number
  totalMigrations: number
  currentStep: string
  percentage: number
  startTime: number
  estimatedTimeRemaining?: number
}

export interface MigrationPlan {
  fromVersion: number
  toVersion: number
  migrations: SchemaMigration[]
  isRollback: boolean
  estimatedDuration: number
}

/**
 * Migration Engine for PGlite database
 * Handles migration execution with rollback support and error recovery
 */
export class PGliteMigrationEngine {
  private static readonly MIGRATION_TIMEOUT = 300000 // 5 minutes default
  private static readonly SCHEMA_VERSION_TABLE = 'schema_versions'
  private static readonly MIGRATION_METADATA_TABLE = 'migration_metadata'

  private readonly schemaManager: PGliteSchemaManager

  constructor(vectorDimensions: number = 1536) {
    this.schemaManager = new PGliteSchemaManager(vectorDimensions)
  }

  /**
   * Create a migration plan from current version to target version
   * Supports requirement 5.3 for upgrade path calculation
   */
  async createMigrationPlan(db: any, targetVersion: number): Promise<MigrationPlan> {
    const currentVersion = await this.schemaManager.getCurrentVersion(db)
    const allMigrations = PGliteSchemaManager.getMigrations()

    let migrations: SchemaMigration[]
    let isRollback = false

    if (currentVersion === targetVersion) {
      migrations = []
    } else if (currentVersion < targetVersion) {
      // Forward migration
      migrations = allMigrations
        .filter((m) => m.version > currentVersion && m.version <= targetVersion)
        .sort((a, b) => a.version - b.version)
    } else {
      // Rollback migration
      isRollback = true
      migrations = allMigrations
        .filter((m) => m.version > targetVersion && m.version <= currentVersion)
        .sort((a, b) => b.version - a.version) // Reverse order for rollback
    }

    // Validate migration dependencies
    if (!isRollback) {
      this.validateMigrationDependencies(migrations, currentVersion)
    }

    // Estimate duration (rough estimate: 30 seconds per migration)
    const estimatedDuration = migrations.length * 30000

    return {
      fromVersion: currentVersion,
      toVersion: targetVersion,
      migrations,
      isRollback,
      estimatedDuration
    }
  }

  /**
   * Execute a migration plan with progress tracking and error handling
   * Supports requirements 5.3, 5.4 for migration execution and error recovery
   */
  async executeMigrationPlan(
    db: any,
    plan: MigrationPlan,
    options: MigrationExecutionOptions = {}
  ): Promise<MigrationResult[]> {
    const results: MigrationResult[] = []
    const startTime = Date.now()

    console.log(
      `[PGlite Migration] Executing migration plan: v${plan.fromVersion} -> v${plan.toVersion}`
    )

    if (plan.migrations.length === 0) {
      console.log('[PGlite Migration] No migrations to execute')
      return results
    }

    // Validate pre-conditions
    await this.validatePreConditions(db, plan)

    for (let i = 0; i < plan.migrations.length; i++) {
      const migration = plan.migrations[i]
      const progress: MigrationProgress = {
        currentMigration: i + 1,
        totalMigrations: plan.migrations.length,
        currentStep: `${plan.isRollback ? 'Rolling back' : 'Applying'} migration v${migration.version}`,
        percentage: ((i + 1) / plan.migrations.length) * 100,
        startTime,
        estimatedTimeRemaining: this.calculateEstimatedTime(
          startTime,
          i + 1,
          plan.migrations.length
        )
      }

      // Report progress
      if (options.progressCallback) {
        options.progressCallback(progress)
      }

      try {
        const result = plan.isRollback
          ? await this.rollbackMigration(db, migration, options)
          : await this.applyMigration(db, migration, options)

        results.push(result)

        if (!result.success && !options.continueOnError) {
          console.error(`[PGlite Migration] Migration failed, stopping execution`)
          break
        }
      } catch (error) {
        const errorResult: MigrationResult = {
          success: false,
          version: migration.version,
          description: migration.description,
          executionTime: Date.now() - startTime,
          errors: [`Migration execution failed: ${error}`],
          warnings: [],
          rollbackAvailable: !!migration.downScript
        }

        results.push(errorResult)

        if (!options.continueOnError) {
          console.error(`[PGlite Migration] Critical error, stopping execution:`, error)
          break
        }
      }
    }

    const totalTime = Date.now() - startTime
    console.log(`[PGlite Migration] Migration plan completed in ${totalTime}ms`)

    return results
  }

  /**
   * Apply a single migration with transaction support
   * Supports requirement 5.3 for schema versioning
   */
  async applyMigration(
    db: any,
    migration: SchemaMigration,
    options: MigrationExecutionOptions = {}
  ): Promise<MigrationResult> {
    const startTime = Date.now()
    const result: MigrationResult = {
      success: false,
      version: migration.version,
      description: migration.description,
      executionTime: 0,
      errors: [],
      warnings: [],
      rollbackAvailable: !!migration.downScript
    }

    console.log(
      `[PGlite Migration] Applying migration v${migration.version}: ${migration.description}`
    )

    try {
      // Check if migration is already applied
      const isApplied = await this.isMigrationApplied(db, migration.version)
      if (isApplied) {
        result.warnings.push(`Migration v${migration.version} is already applied`)
        result.success = true
        result.executionTime = Date.now() - startTime
        return result
      }

      // Validate dependencies
      if (migration.dependencies && migration.dependencies.length > 0) {
        await this.validateDependencies(db, migration.dependencies)
      }

      if (options.dryRun) {
        console.log(`[PGlite Migration] DRY RUN: Would apply migration v${migration.version}`)
        result.success = true
        result.executionTime = Date.now() - startTime
        return result
      }

      // Execute migration in transaction
      await this.executeInTransaction(db, async () => {
        // Get the migration script (populate if empty)
        let upScript = migration.upScript
        if (!upScript && migration.version === 1) {
          upScript = this.schemaManager.getCompleteInitialSchema()
        }

        if (upScript) {
          await db.exec(upScript)
        }

        // Record migration in schema_versions table
        await db.query(
          `INSERT INTO ${PGliteMigrationEngine.SCHEMA_VERSION_TABLE} 
           (version, applied_at, description, checksum) VALUES ($1, $2, $3, $4)`,
          [migration.version, Date.now(), migration.description, migration.checksum || '']
        )

        // Record migration metadata
        await this.recordMigrationMetadata(db, migration, true)
      })

      result.success = true
      result.executionTime = Date.now() - startTime

      console.log(
        `[PGlite Migration] Migration v${migration.version} applied successfully in ${result.executionTime}ms`
      )
    } catch (error) {
      result.success = false
      result.errors.push(`Migration failed: ${error}`)
      result.executionTime = Date.now() - startTime

      console.error(`[PGlite Migration] Migration v${migration.version} failed:`, error)

      // Record failed migration
      try {
        await this.recordMigrationMetadata(db, migration, false, String(error))
      } catch (metadataError) {
        console.warn('[PGlite Migration] Failed to record migration metadata:', metadataError)
      }
    }

    return result
  }

  /**
   * Rollback a single migration with transaction support
   * Supports requirement 5.3 for rollback capabilities
   */
  async rollbackMigration(
    db: any,
    migration: SchemaMigration,
    options: MigrationExecutionOptions = {}
  ): Promise<MigrationResult> {
    const startTime = Date.now()
    const result: MigrationResult = {
      success: false,
      version: migration.version,
      description: `Rollback migration v${migration.version}`,
      executionTime: 0,
      errors: [],
      warnings: [],
      rollbackAvailable: false
    }

    console.log(`[PGlite Migration] Rolling back migration v${migration.version}`)

    try {
      // Check if migration can be rolled back
      if (!migration.downScript) {
        throw new Error(`Migration v${migration.version} does not support rollback`)
      }

      // Check if migration is actually applied
      const isApplied = await this.isMigrationApplied(db, migration.version)
      if (!isApplied) {
        result.warnings.push(`Migration v${migration.version} is not applied, nothing to rollback`)
        result.success = true
        result.executionTime = Date.now() - startTime
        return result
      }

      if (options.dryRun) {
        console.log(`[PGlite Migration] DRY RUN: Would rollback migration v${migration.version}`)
        result.success = true
        result.executionTime = Date.now() - startTime
        return result
      }

      // Execute rollback in transaction
      await this.executeInTransaction(db, async () => {
        // Execute rollback script
        await db.exec(migration.downScript!)

        // Remove migration record from schema_versions table
        await db.query(
          `DELETE FROM ${PGliteMigrationEngine.SCHEMA_VERSION_TABLE} WHERE version = $1`,
          [migration.version]
        )

        // Record rollback metadata
        await this.recordMigrationMetadata(db, migration, true, undefined, true)
      })

      result.success = true
      result.executionTime = Date.now() - startTime

      console.log(
        `[PGlite Migration] Migration v${migration.version} rolled back successfully in ${result.executionTime}ms`
      )
    } catch (error) {
      result.success = false
      result.errors.push(`Rollback failed: ${error}`)
      result.executionTime = Date.now() - startTime

      console.error(`[PGlite Migration] Rollback v${migration.version} failed:`, error)
    }

    return result
  }

  /**
   * Validate migration dependencies
   * Supports requirement 5.3 for dependency checking
   */
  private validateMigrationDependencies(
    migrations: SchemaMigration[],
    currentVersion: number
  ): void {
    for (const migration of migrations) {
      if (migration.dependencies && migration.dependencies.length > 0) {
        for (const dep of migration.dependencies) {
          if (dep > currentVersion) {
            const depMigration = migrations.find((m) => m.version === dep)
            if (!depMigration) {
              throw new Error(
                `Migration v${migration.version} depends on v${dep} which is not available`
              )
            }
          }
        }
      }
    }
  }

  /**
   * Validate pre-conditions before executing migration plan
   * Supports requirement 5.4 for error recovery
   */
  private async validatePreConditions(db: any, plan: MigrationPlan): Promise<void> {
    // Check database connection
    try {
      await db.query('SELECT 1')
    } catch (error) {
      throw new Error(`Database connection failed: ${error}`)
    }

    // Validate current schema version
    const currentVersion = await this.schemaManager.getCurrentVersion(db)
    if (currentVersion !== plan.fromVersion) {
      throw new Error(
        `Schema version mismatch: expected v${plan.fromVersion}, found v${currentVersion}`
      )
    }

    // Check for schema corruption
    if (currentVersion > 0) {
      const validation = await this.schemaManager.validateSchema(db)
      if (!validation.isValid) {
        throw new Error(`Schema validation failed: ${validation.errors.join(', ')}`)
      }
    }
  }

  /**
   * Check if a migration is already applied
   */
  private async isMigrationApplied(db: any, version: number): Promise<boolean> {
    try {
      const result = await db.query(
        `SELECT EXISTS(SELECT 1 FROM ${PGliteMigrationEngine.SCHEMA_VERSION_TABLE} WHERE version = $1)`,
        [version]
      )
      return result.rows[0].exists
    } catch {
      return false
    }
  }

  /**
   * Validate migration dependencies
   */
  private async validateDependencies(db: any, dependencies: number[]): Promise<void> {
    for (const dep of dependencies) {
      const isApplied = await this.isMigrationApplied(db, dep)
      if (!isApplied) {
        throw new Error(`Migration dependency v${dep} is not satisfied`)
      }
    }
  }

  /**
   * Execute operations within a transaction
   */
  private async executeInTransaction(db: any, operations: () => Promise<void>): Promise<void> {
    await db.exec('BEGIN')
    try {
      await operations()
      await db.exec('COMMIT')
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Record migration metadata for tracking
   */
  private async recordMigrationMetadata(
    db: any,
    migration: SchemaMigration,
    success: boolean,
    error?: string,
    isRollback: boolean = false
  ): Promise<void> {
    try {
      const metadata = {
        version: migration.version,
        description: migration.description,
        success,
        error: error || null,
        executedAt: Date.now(),
        checksum: migration.checksum || null,
        rollbackAvailable: !!migration.downScript,
        isRollback
      }

      const key = isRollback ? `rollback_${migration.version}` : `migration_${migration.version}`

      await db.query(
        `INSERT INTO ${PGliteMigrationEngine.MIGRATION_METADATA_TABLE} (key, value, created_at) 
         VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, created_at = $3`,
        [key, JSON.stringify(metadata), Date.now()]
      )
    } catch (error) {
      console.warn('[PGlite Migration] Failed to record migration metadata:', error)
    }
  }

  /**
   * Calculate estimated time remaining for migration
   */
  private calculateEstimatedTime(startTime: number, completed: number, total: number): number {
    if (completed === 0) return 0

    const elapsed = Date.now() - startTime
    const averageTime = elapsed / completed
    const remaining = total - completed

    return Math.round(remaining * averageTime)
  }

  /**
   * Get migration history from metadata
   * Supports requirement 5.3 for migration tracking
   */
  async getMigrationHistory(db: any): Promise<
    Array<{
      version: number
      description: string
      appliedAt: number
      success: boolean
      isRollback: boolean
    }>
  > {
    try {
      const result = await db.query(`
        SELECT key, value, created_at
        FROM ${PGliteMigrationEngine.MIGRATION_METADATA_TABLE}
        WHERE key LIKE 'migration_%' OR key LIKE 'rollback_%'
        ORDER BY created_at ASC
      `)

      return result.rows.map((row: any) => {
        const metadata = JSON.parse(row.value)
        return {
          version: metadata.version,
          description: metadata.description,
          appliedAt: metadata.executedAt,
          success: metadata.success,
          isRollback: metadata.isRollback || false
        }
      })
    } catch (error) {
      console.warn('[PGlite Migration] Failed to get migration history:', error)
      return []
    }
  }

  /**
   * Clean up old migration metadata
   * Keeps only the last N migration records
   */
  async cleanupMigrationHistory(db: any, keepCount: number = 50): Promise<void> {
    try {
      await db.query(
        `
        DELETE FROM ${PGliteMigrationEngine.MIGRATION_METADATA_TABLE}
        WHERE key IN (
          SELECT key FROM ${PGliteMigrationEngine.MIGRATION_METADATA_TABLE}
          WHERE key LIKE 'migration_%' OR key LIKE 'rollback_%'
          ORDER BY created_at DESC
          OFFSET $1
        )
      `,
        [keepCount]
      )

      console.log(`[PGlite Migration] Cleaned up migration history, kept ${keepCount} records`)
    } catch (error) {
      console.warn('[PGlite Migration] Failed to cleanup migration history:', error)
    }
  }
}
