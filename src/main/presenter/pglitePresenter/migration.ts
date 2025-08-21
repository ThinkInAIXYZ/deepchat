/**
 * PGlite Migration System
 * Handles schema migration execution, rollback, and version management
 * Also includes data migration from legacy SQLite and DuckDB databases
 * Supports requirements 5.3, 5.4 for schema versioning and rollback capabilities
 * Supports requirements 2.1, 2.3, 8.3 for data migration and preservation
 */

import { SchemaMigration, MigrationResult, PGliteSchemaManager } from './schema'

// Data migration interfaces
export interface DataMigrationOptions {
  batchSize?: number
  progressCallback?: (progress: DataMigrationProgress) => void
  validateData?: boolean
  continueOnError?: boolean
  dryRun?: boolean
}

export interface DataMigrationProgress {
  phase: 'conversations' | 'messages' | 'attachments' | 'files' | 'chunks' | 'vectors'
  currentTable: string
  recordsProcessed: number
  totalRecords: number
  percentage: number
  startTime: number
  estimatedTimeRemaining?: number
  errors?: string[]
  warnings?: string[]
}

export interface DataMigrationResult {
  success: boolean
  phase: string
  recordsMigrated: number
  recordsSkipped: number
  errors: string[]
  warnings: string[]
  executionTime: number
  dataIntegrityChecks?: {
    sourceRecords: number
    targetRecords: number
    checksumMatch: boolean
  }
}

export interface LegacyDatabaseConnection {
  type: 'sqlite' | 'duckdb'
  connection: any
  path: string
}

// Data type mapping interfaces
export interface DataTypeMapping {
  sourceColumn: string
  targetColumn: string
  sourceType: string
  targetType: string
  transform?: (value: any) => any
  validate?: (value: any) => boolean
}

export interface TableMigrationConfig {
  sourceTable: string
  targetTable: string
  mappings: DataTypeMapping[]
  batchSize: number
  orderBy?: string
  whereClause?: string
  customTransform?: (sourceRow: any) => any
}

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
  // Migration timeout constant (currently unused but kept for future use)
  // private static readonly MIGRATION_TIMEOUT = 300000 // 5 minutes default
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
/**
 * Data Migration Engine for migrating from legacy SQLite and DuckDB databases to PGlite
 * Implements requirements 2.1, 2.3, 8.3 for data migration and preservation
 */
export class PGliteDataMigrator {
  private static readonly DEFAULT_BATCH_SIZE = 1000

  /**
   * Migrate conversational data from SQLite to PGlite
   * Supports requirements 2.1, 2.3, 8.3 for conversation and message data migration
   */
  async migrateConversationalData(
    sqliteConnection: LegacyDatabaseConnection,
    pgliteDb: any,
    options: DataMigrationOptions = {}
  ): Promise<DataMigrationResult> {
    const startTime = Date.now()
    const result: DataMigrationResult = {
      success: false,
      phase: 'conversational-data',
      recordsMigrated: 0,
      recordsSkipped: 0,
      errors: [],
      warnings: [],
      executionTime: 0
    }

    console.log('[PGlite Data Migration] Starting conversational data migration from SQLite')

    try {
      if (sqliteConnection.type !== 'sqlite') {
        throw new Error('Invalid connection type for conversational data migration')
      }

      const sqlite = sqliteConnection.connection
      const batchSize = options.batchSize || PGliteDataMigrator.DEFAULT_BATCH_SIZE

      // Phase 1: Migrate conversations
      await this.updateProgress(
        'conversations',
        'Migrating conversations...',
        0,
        0,
        options.progressCallback
      )

      const conversationResult = await this.migrateConversations(
        sqlite,
        pgliteDb,
        batchSize,
        options
      )
      result.recordsMigrated += conversationResult.recordsMigrated
      result.recordsSkipped += conversationResult.recordsSkipped
      result.errors.push(...conversationResult.errors)
      result.warnings.push(...conversationResult.warnings)

      // Phase 2: Migrate messages
      await this.updateProgress('messages', 'Migrating messages...', 0, 0, options.progressCallback)

      const messageResult = await this.migrateMessages(sqlite, pgliteDb, batchSize, options)
      result.recordsMigrated += messageResult.recordsMigrated
      result.recordsSkipped += messageResult.recordsSkipped
      result.errors.push(...messageResult.errors)
      result.warnings.push(...messageResult.warnings)

      // Phase 3: Migrate message attachments
      await this.updateProgress(
        'attachments',
        'Migrating message attachments...',
        0,
        0,
        options.progressCallback
      )

      const attachmentResult = await this.migrateMessageAttachments(
        sqlite,
        pgliteDb,
        batchSize,
        options
      )
      result.recordsMigrated += attachmentResult.recordsMigrated
      result.recordsSkipped += attachmentResult.recordsSkipped
      result.errors.push(...attachmentResult.errors)
      result.warnings.push(...attachmentResult.warnings)

      // Data integrity validation
      if (options.validateData) {
        console.log('[PGlite Data Migration] Validating migrated conversational data')
        const integrityCheck = await this.validateConversationalDataIntegrity(sqlite, pgliteDb)
        result.dataIntegrityChecks = integrityCheck

        if (!integrityCheck.checksumMatch) {
          result.warnings.push(
            'Data integrity check failed - record counts or checksums do not match'
          )
        }
      }

      result.success = result.errors.length === 0
      result.executionTime = Date.now() - startTime

      console.log(
        `[PGlite Data Migration] Conversational data migration completed. ` +
          `Migrated: ${result.recordsMigrated}, Skipped: ${result.recordsSkipped}, ` +
          `Errors: ${result.errors.length}, Time: ${result.executionTime}ms`
      )

      return result
    } catch (error) {
      result.success = false
      result.errors.push(`Conversational data migration failed: ${error}`)
      result.executionTime = Date.now() - startTime

      console.error('[PGlite Data Migration] Conversational data migration failed:', error)
      return result
    }
  }

  /**
   * Migrate vector data from DuckDB to PGlite
   * Supports requirements 2.1, 2.3, 4.5 for vector data migration
   */
  async migrateVectorData(
    duckdbConnection: LegacyDatabaseConnection,
    pgliteDb: any,
    options: DataMigrationOptions = {}
  ): Promise<DataMigrationResult> {
    const startTime = Date.now()
    const result: DataMigrationResult = {
      success: false,
      phase: 'vector-data',
      recordsMigrated: 0,
      recordsSkipped: 0,
      errors: [],
      warnings: [],
      executionTime: 0
    }

    console.log('[PGlite Data Migration] Starting vector data migration from DuckDB')

    try {
      if (duckdbConnection.type !== 'duckdb') {
        throw new Error('Invalid connection type for vector data migration')
      }

      const duckdb = duckdbConnection.connection
      const batchSize = options.batchSize || PGliteDataMigrator.DEFAULT_BATCH_SIZE

      // Phase 1: Migrate knowledge files
      await this.updateProgress(
        'files',
        'Migrating knowledge files...',
        0,
        0,
        options.progressCallback
      )

      const fileResult = await this.migrateKnowledgeFiles(duckdb, pgliteDb, batchSize, options)
      result.recordsMigrated += fileResult.recordsMigrated
      result.recordsSkipped += fileResult.recordsSkipped
      result.errors.push(...fileResult.errors)
      result.warnings.push(...fileResult.warnings)

      // Phase 2: Migrate knowledge chunks
      await this.updateProgress(
        'chunks',
        'Migrating knowledge chunks...',
        0,
        0,
        options.progressCallback
      )

      const chunkResult = await this.migrateKnowledgeChunks(duckdb, pgliteDb, batchSize, options)
      result.recordsMigrated += chunkResult.recordsMigrated
      result.recordsSkipped += chunkResult.recordsSkipped
      result.errors.push(...chunkResult.errors)
      result.warnings.push(...chunkResult.warnings)

      // Phase 3: Migrate vector embeddings
      await this.updateProgress(
        'vectors',
        'Migrating vector embeddings...',
        0,
        0,
        options.progressCallback
      )

      const vectorResult = await this.migrateVectorEmbeddings(duckdb, pgliteDb, batchSize, options)
      result.recordsMigrated += vectorResult.recordsMigrated
      result.recordsSkipped += vectorResult.recordsSkipped
      result.errors.push(...vectorResult.errors)
      result.warnings.push(...vectorResult.warnings)

      // Data integrity validation
      if (options.validateData) {
        console.log('[PGlite Data Migration] Validating migrated vector data')
        const integrityCheck = await this.validateVectorDataIntegrity(duckdb, pgliteDb)
        result.dataIntegrityChecks = integrityCheck

        if (!integrityCheck.checksumMatch) {
          result.warnings.push(
            'Vector data integrity check failed - record counts or checksums do not match'
          )
        }
      }

      result.success = result.errors.length === 0
      result.executionTime = Date.now() - startTime

      console.log(
        `[PGlite Data Migration] Vector data migration completed. ` +
          `Migrated: ${result.recordsMigrated}, Skipped: ${result.recordsSkipped}, ` +
          `Errors: ${result.errors.length}, Time: ${result.executionTime}ms`
      )

      return result
    } catch (error) {
      result.success = false
      result.errors.push(`Vector data migration failed: ${error}`)
      result.executionTime = Date.now() - startTime

      console.error('[PGlite Data Migration] Vector data migration failed:', error)
      return result
    }
  }

  /**
   * Migrate conversations from SQLite to PGlite
   */
  private async migrateConversations(
    sqlite: any,
    pgliteDb: any,
    batchSize: number,
    options: DataMigrationOptions
  ): Promise<DataMigrationResult> {
    const result: DataMigrationResult = {
      success: false,
      phase: 'conversations',
      recordsMigrated: 0,
      recordsSkipped: 0,
      errors: [],
      warnings: [],
      executionTime: 0
    }

    try {
      // Get total count for progress tracking
      const countResult = sqlite.prepare('SELECT COUNT(*) as count FROM conversations').get()
      const totalRecords = countResult.count

      console.log(`[PGlite Data Migration] Migrating ${totalRecords} conversations`)

      if (totalRecords === 0) {
        result.success = true
        return result
      }

      // Define data type mappings
      const mappings: DataTypeMapping[] = [
        {
          sourceColumn: 'conv_id',
          targetColumn: 'conv_id',
          sourceType: 'TEXT',
          targetType: 'TEXT'
        },
        { sourceColumn: 'title', targetColumn: 'title', sourceType: 'TEXT', targetType: 'TEXT' },
        {
          sourceColumn: 'created_at',
          targetColumn: 'created_at',
          sourceType: 'INTEGER',
          targetType: 'BIGINT'
        },
        {
          sourceColumn: 'updated_at',
          targetColumn: 'updated_at',
          sourceType: 'INTEGER',
          targetType: 'BIGINT'
        },
        {
          sourceColumn: 'is_pinned',
          targetColumn: 'is_pinned',
          sourceType: 'INTEGER',
          targetType: 'INTEGER'
        },
        {
          sourceColumn: 'is_new',
          targetColumn: 'is_new',
          sourceType: 'INTEGER',
          targetType: 'INTEGER'
        },
        {
          sourceColumn: 'settings',
          targetColumn: 'settings',
          sourceType: 'TEXT',
          targetType: 'JSONB',
          transform: (value: any) => {
            if (!value) return '{}'
            try {
              // Ensure it's valid JSON
              const parsed = typeof value === 'string' ? JSON.parse(value) : value
              return JSON.stringify(parsed)
            } catch {
              return '{}'
            }
          }
        }
      ]

      // Process in batches
      let offset = 0
      let processedRecords = 0

      while (offset < totalRecords) {
        const batch = sqlite
          .prepare(
            `SELECT * FROM conversations ORDER BY created_at LIMIT ${batchSize} OFFSET ${offset}`
          )
          .all()

        if (batch.length === 0) break

        // Begin transaction for batch
        await pgliteDb.exec('BEGIN')

        try {
          for (const row of batch) {
            if (options.dryRun) {
              console.log(
                `[PGlite Data Migration] DRY RUN: Would migrate conversation ${row.conv_id}`
              )
              result.recordsMigrated++
              continue
            }

            // Transform data according to mappings
            const transformedData: any = {}
            for (const mapping of mappings) {
              let value = row[mapping.sourceColumn]

              if (mapping.transform) {
                value = mapping.transform(value)
              }

              if (mapping.validate && !mapping.validate(value)) {
                result.warnings.push(
                  `Invalid data for ${mapping.sourceColumn} in conversation ${row.conv_id}`
                )
                continue
              }

              transformedData[mapping.targetColumn] = value
            }

            // Insert into PGlite
            const insertQuery = `
              INSERT INTO conversations (conv_id, title, created_at, updated_at, is_pinned, is_new, settings)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (conv_id) DO UPDATE SET
                title = EXCLUDED.title,
                updated_at = EXCLUDED.updated_at,
                is_pinned = EXCLUDED.is_pinned,
                is_new = EXCLUDED.is_new,
                settings = EXCLUDED.settings
            `

            await pgliteDb.query(insertQuery, [
              transformedData.conv_id,
              transformedData.title,
              transformedData.created_at,
              transformedData.updated_at,
              transformedData.is_pinned || 0,
              transformedData.is_new || 1,
              transformedData.settings
            ])

            result.recordsMigrated++
          }

          await pgliteDb.exec('COMMIT')
          processedRecords += batch.length
          offset += batchSize

          // Update progress
          const percentage = (processedRecords / totalRecords) * 100
          await this.updateProgress(
            'conversations',
            `Migrated ${processedRecords}/${totalRecords} conversations`,
            processedRecords,
            totalRecords,
            options.progressCallback,
            percentage
          )
        } catch (error) {
          await pgliteDb.exec('ROLLBACK')

          if (options.continueOnError) {
            result.errors.push(`Batch error at offset ${offset}: ${error}`)
            result.recordsSkipped += batch.length
            offset += batchSize
          } else {
            throw error
          }
        }
      }

      result.success = true
      console.log(
        `[PGlite Data Migration] Successfully migrated ${result.recordsMigrated} conversations`
      )
    } catch (error) {
      result.errors.push(`Conversation migration failed: ${error}`)
      console.error('[PGlite Data Migration] Conversation migration error:', error)
    }

    return result
  }

  /**
   * Migrate messages from SQLite to PGlite
   */
  private async migrateMessages(
    sqlite: any,
    pgliteDb: any,
    batchSize: number,
    options: DataMigrationOptions
  ): Promise<DataMigrationResult> {
    const result: DataMigrationResult = {
      success: false,
      phase: 'messages',
      recordsMigrated: 0,
      recordsSkipped: 0,
      errors: [],
      warnings: [],
      executionTime: 0
    }

    try {
      // Get total count for progress tracking
      const countResult = sqlite.prepare('SELECT COUNT(*) as count FROM messages').get()
      const totalRecords = countResult.count

      console.log(`[PGlite Data Migration] Migrating ${totalRecords} messages`)

      if (totalRecords === 0) {
        result.success = true
        return result
      }

      // Define data type mappings
      const mappings: DataTypeMapping[] = [
        { sourceColumn: 'msg_id', targetColumn: 'msg_id', sourceType: 'TEXT', targetType: 'TEXT' },
        {
          sourceColumn: 'conversation_id',
          targetColumn: 'conversation_id',
          sourceType: 'TEXT',
          targetType: 'TEXT'
        },
        {
          sourceColumn: 'parent_id',
          targetColumn: 'parent_id',
          sourceType: 'TEXT',
          targetType: 'TEXT'
        },
        { sourceColumn: 'role', targetColumn: 'role', sourceType: 'TEXT', targetType: 'TEXT' },
        {
          sourceColumn: 'content',
          targetColumn: 'content',
          sourceType: 'TEXT',
          targetType: 'TEXT'
        },
        {
          sourceColumn: 'created_at',
          targetColumn: 'created_at',
          sourceType: 'INTEGER',
          targetType: 'BIGINT'
        },
        {
          sourceColumn: 'order_seq',
          targetColumn: 'order_seq',
          sourceType: 'INTEGER',
          targetType: 'INTEGER'
        },
        {
          sourceColumn: 'token_count',
          targetColumn: 'token_count',
          sourceType: 'INTEGER',
          targetType: 'INTEGER'
        },
        { sourceColumn: 'status', targetColumn: 'status', sourceType: 'TEXT', targetType: 'TEXT' },
        {
          sourceColumn: 'metadata',
          targetColumn: 'metadata',
          sourceType: 'TEXT',
          targetType: 'JSONB',
          transform: (value: any) => {
            if (!value) return '{}'
            try {
              const parsed = typeof value === 'string' ? JSON.parse(value) : value
              return JSON.stringify(parsed)
            } catch {
              return '{}'
            }
          }
        },
        {
          sourceColumn: 'is_context_edge',
          targetColumn: 'is_context_edge',
          sourceType: 'INTEGER',
          targetType: 'INTEGER'
        },
        {
          sourceColumn: 'is_variant',
          targetColumn: 'is_variant',
          sourceType: 'INTEGER',
          targetType: 'INTEGER'
        }
      ]

      // Process in batches
      let offset = 0
      let processedRecords = 0

      while (offset < totalRecords) {
        const batch = sqlite
          .prepare(`SELECT * FROM messages ORDER BY created_at LIMIT ${batchSize} OFFSET ${offset}`)
          .all()

        if (batch.length === 0) break

        // Begin transaction for batch
        await pgliteDb.exec('BEGIN')

        try {
          for (const row of batch) {
            if (options.dryRun) {
              console.log(`[PGlite Data Migration] DRY RUN: Would migrate message ${row.msg_id}`)
              result.recordsMigrated++
              continue
            }

            // Transform data according to mappings
            const transformedData: any = {}
            for (const mapping of mappings) {
              let value = row[mapping.sourceColumn]

              if (mapping.transform) {
                value = mapping.transform(value)
              }

              if (mapping.validate && !mapping.validate(value)) {
                result.warnings.push(
                  `Invalid data for ${mapping.sourceColumn} in message ${row.msg_id}`
                )
                continue
              }

              transformedData[mapping.targetColumn] = value
            }

            // Insert into PGlite
            const insertQuery = `
              INSERT INTO messages (
                msg_id, conversation_id, parent_id, role, content, created_at, 
                order_seq, token_count, status, metadata, is_context_edge, is_variant
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              ON CONFLICT (msg_id) DO UPDATE SET
                conversation_id = EXCLUDED.conversation_id,
                parent_id = EXCLUDED.parent_id,
                role = EXCLUDED.role,
                content = EXCLUDED.content,
                order_seq = EXCLUDED.order_seq,
                token_count = EXCLUDED.token_count,
                status = EXCLUDED.status,
                metadata = EXCLUDED.metadata,
                is_context_edge = EXCLUDED.is_context_edge,
                is_variant = EXCLUDED.is_variant
            `

            await pgliteDb.query(insertQuery, [
              transformedData.msg_id,
              transformedData.conversation_id,
              transformedData.parent_id || '',
              transformedData.role,
              transformedData.content,
              transformedData.created_at,
              transformedData.order_seq || 0,
              transformedData.token_count || 0,
              transformedData.status || 'sent',
              transformedData.metadata,
              transformedData.is_context_edge || 0,
              transformedData.is_variant || 0
            ])

            result.recordsMigrated++
          }

          await pgliteDb.exec('COMMIT')
          processedRecords += batch.length
          offset += batchSize

          // Update progress
          const percentage = (processedRecords / totalRecords) * 100
          await this.updateProgress(
            'messages',
            `Migrated ${processedRecords}/${totalRecords} messages`,
            processedRecords,
            totalRecords,
            options.progressCallback,
            percentage
          )
        } catch (error) {
          await pgliteDb.exec('ROLLBACK')

          if (options.continueOnError) {
            result.errors.push(`Batch error at offset ${offset}: ${error}`)
            result.recordsSkipped += batch.length
            offset += batchSize
          } else {
            throw error
          }
        }
      }

      result.success = true
      console.log(
        `[PGlite Data Migration] Successfully migrated ${result.recordsMigrated} messages`
      )
    } catch (error) {
      result.errors.push(`Message migration failed: ${error}`)
      console.error('[PGlite Data Migration] Message migration error:', error)
    }

    return result
  }

  /**
   * Migrate message attachments from SQLite to PGlite
   */
  private async migrateMessageAttachments(
    sqlite: any,
    pgliteDb: any,
    batchSize: number,
    options: DataMigrationOptions
  ): Promise<DataMigrationResult> {
    const result: DataMigrationResult = {
      success: false,
      phase: 'attachments',
      recordsMigrated: 0,
      recordsSkipped: 0,
      errors: [],
      warnings: [],
      executionTime: 0
    }

    try {
      // Check if message_attachments table exists in SQLite
      const tableExists = sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='message_attachments'`)
        .get()

      if (!tableExists) {
        console.log(
          '[PGlite Data Migration] No message_attachments table found in SQLite, skipping'
        )
        result.success = true
        return result
      }

      // Get total count for progress tracking
      const countResult = sqlite.prepare('SELECT COUNT(*) as count FROM message_attachments').get()
      const totalRecords = countResult.count

      console.log(`[PGlite Data Migration] Migrating ${totalRecords} message attachments`)

      if (totalRecords === 0) {
        result.success = true
        return result
      }

      // Process in batches
      let offset = 0
      let processedRecords = 0

      while (offset < totalRecords) {
        const batch = sqlite
          .prepare(
            `SELECT * FROM message_attachments ORDER BY created_at LIMIT ${batchSize} OFFSET ${offset}`
          )
          .all()

        if (batch.length === 0) break

        // Begin transaction for batch
        await pgliteDb.exec('BEGIN')

        try {
          for (const row of batch) {
            if (options.dryRun) {
              console.log(`[PGlite Data Migration] DRY RUN: Would migrate attachment ${row.id}`)
              result.recordsMigrated++
              continue
            }

            // Insert into PGlite
            const insertQuery = `
              INSERT INTO message_attachments (message_id, attachment_type, attachment_data, created_at)
              VALUES ($1, $2, $3, $4)
            `

            await pgliteDb.query(insertQuery, [
              row.message_id,
              row.attachment_type,
              row.attachment_data,
              row.created_at || Date.now()
            ])

            result.recordsMigrated++
          }

          await pgliteDb.exec('COMMIT')
          processedRecords += batch.length
          offset += batchSize

          // Update progress
          const percentage = (processedRecords / totalRecords) * 100
          await this.updateProgress(
            'attachments',
            `Migrated ${processedRecords}/${totalRecords} attachments`,
            processedRecords,
            totalRecords,
            options.progressCallback,
            percentage
          )
        } catch (error) {
          await pgliteDb.exec('ROLLBACK')

          if (options.continueOnError) {
            result.errors.push(`Batch error at offset ${offset}: ${error}`)
            result.recordsSkipped += batch.length
            offset += batchSize
          } else {
            throw error
          }
        }
      }

      result.success = true
      console.log(
        `[PGlite Data Migration] Successfully migrated ${result.recordsMigrated} message attachments`
      )
    } catch (error) {
      result.errors.push(`Message attachment migration failed: ${error}`)
      console.error('[PGlite Data Migration] Message attachment migration error:', error)
    }

    return result
  }

  /**
   * Migrate knowledge files from DuckDB to PGlite
   */
  private async migrateKnowledgeFiles(
    duckdb: any,
    pgliteDb: any,
    batchSize: number,
    options: DataMigrationOptions
  ): Promise<DataMigrationResult> {
    const result: DataMigrationResult = {
      success: false,
      phase: 'files',
      recordsMigrated: 0,
      recordsSkipped: 0,
      errors: [],
      warnings: [],
      executionTime: 0
    }

    try {
      // Get total count for progress tracking
      const countResult = await duckdb.run('SELECT COUNT(*) as count FROM files')
      const totalRecords = countResult[0]?.count || 0

      console.log(`[PGlite Data Migration] Migrating ${totalRecords} knowledge files`)

      if (totalRecords === 0) {
        result.success = true
        return result
      }

      // Process in batches
      let offset = 0
      let processedRecords = 0

      while (offset < totalRecords) {
        const batch = await duckdb.run(
          `SELECT * FROM files ORDER BY uploaded_at LIMIT ${batchSize} OFFSET ${offset}`
        )

        if (batch.length === 0) break

        // Begin transaction for batch
        await pgliteDb.exec('BEGIN')

        try {
          for (const row of batch) {
            if (options.dryRun) {
              console.log(`[PGlite Data Migration] DRY RUN: Would migrate file ${row.id}`)
              result.recordsMigrated++
              continue
            }

            // Transform metadata if needed
            let metadata = '{}'
            if (row.metadata) {
              try {
                metadata =
                  typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata)
              } catch {
                metadata = '{}'
              }
            }

            // Insert into PGlite
            const insertQuery = `
              INSERT INTO knowledge_files (id, name, path, mime_type, status, uploaded_at, metadata)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                path = EXCLUDED.path,
                mime_type = EXCLUDED.mime_type,
                status = EXCLUDED.status,
                metadata = EXCLUDED.metadata
            `

            await pgliteDb.query(insertQuery, [
              row.id,
              row.name,
              row.path,
              row.mime_type,
              row.status,
              row.uploaded_at,
              metadata
            ])

            result.recordsMigrated++
          }

          await pgliteDb.exec('COMMIT')
          processedRecords += batch.length
          offset += batchSize

          // Update progress
          const percentage = (processedRecords / totalRecords) * 100
          await this.updateProgress(
            'files',
            `Migrated ${processedRecords}/${totalRecords} files`,
            processedRecords,
            totalRecords,
            options.progressCallback,
            percentage
          )
        } catch (error) {
          await pgliteDb.exec('ROLLBACK')

          if (options.continueOnError) {
            result.errors.push(`Batch error at offset ${offset}: ${error}`)
            result.recordsSkipped += batch.length
            offset += batchSize
          } else {
            throw error
          }
        }
      }

      result.success = true
      console.log(
        `[PGlite Data Migration] Successfully migrated ${result.recordsMigrated} knowledge files`
      )
    } catch (error) {
      result.errors.push(`Knowledge file migration failed: ${error}`)
      console.error('[PGlite Data Migration] Knowledge file migration error:', error)
    }

    return result
  }

  /**
   * Migrate knowledge chunks from DuckDB to PGlite
   */
  private async migrateKnowledgeChunks(
    duckdb: any,
    pgliteDb: any,
    batchSize: number,
    options: DataMigrationOptions
  ): Promise<DataMigrationResult> {
    const result: DataMigrationResult = {
      success: false,
      phase: 'chunks',
      recordsMigrated: 0,
      recordsSkipped: 0,
      errors: [],
      warnings: [],
      executionTime: 0
    }

    try {
      // Get total count for progress tracking
      const countResult = await duckdb.run('SELECT COUNT(*) as count FROM chunks')
      const totalRecords = countResult[0]?.count || 0

      console.log(`[PGlite Data Migration] Migrating ${totalRecords} knowledge chunks`)

      if (totalRecords === 0) {
        result.success = true
        return result
      }

      // Process in batches
      let offset = 0
      let processedRecords = 0

      while (offset < totalRecords) {
        const batch = await duckdb.run(
          `SELECT * FROM chunks ORDER BY chunk_index LIMIT ${batchSize} OFFSET ${offset}`
        )

        if (batch.length === 0) break

        // Begin transaction for batch
        await pgliteDb.exec('BEGIN')

        try {
          for (const row of batch) {
            if (options.dryRun) {
              console.log(`[PGlite Data Migration] DRY RUN: Would migrate chunk ${row.id}`)
              result.recordsMigrated++
              continue
            }

            // Insert into PGlite
            const insertQuery = `
              INSERT INTO knowledge_chunks (id, file_id, chunk_index, content, status, error)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (id) DO UPDATE SET
                file_id = EXCLUDED.file_id,
                chunk_index = EXCLUDED.chunk_index,
                content = EXCLUDED.content,
                status = EXCLUDED.status,
                error = EXCLUDED.error
            `

            await pgliteDb.query(insertQuery, [
              row.id,
              row.file_id,
              row.chunk_index,
              row.content,
              row.status,
              row.error || ''
            ])

            result.recordsMigrated++
          }

          await pgliteDb.exec('COMMIT')
          processedRecords += batch.length
          offset += batchSize

          // Update progress
          const percentage = (processedRecords / totalRecords) * 100
          await this.updateProgress(
            'chunks',
            `Migrated ${processedRecords}/${totalRecords} chunks`,
            processedRecords,
            totalRecords,
            options.progressCallback,
            percentage
          )
        } catch (error) {
          await pgliteDb.exec('ROLLBACK')

          if (options.continueOnError) {
            result.errors.push(`Batch error at offset ${offset}: ${error}`)
            result.recordsSkipped += batch.length
            offset += batchSize
          } else {
            throw error
          }
        }
      }

      result.success = true
      console.log(
        `[PGlite Data Migration] Successfully migrated ${result.recordsMigrated} knowledge chunks`
      )
    } catch (error) {
      result.errors.push(`Knowledge chunk migration failed: ${error}`)
      console.error('[PGlite Data Migration] Knowledge chunk migration error:', error)
    }

    return result
  }

  /**
   * Migrate vector embeddings from DuckDB to PGlite
   * Supports requirement 4.5 for vector dimension validation and embedding data preservation
   */
  private async migrateVectorEmbeddings(
    duckdb: any,
    pgliteDb: any,
    batchSize: number,
    options: DataMigrationOptions
  ): Promise<DataMigrationResult> {
    const result: DataMigrationResult = {
      success: false,
      phase: 'vectors',
      recordsMigrated: 0,
      recordsSkipped: 0,
      errors: [],
      warnings: [],
      executionTime: 0
    }

    try {
      // Get total count for progress tracking
      const countResult = await duckdb.run('SELECT COUNT(*) as count FROM vectors')
      const totalRecords = countResult[0]?.count || 0

      console.log(`[PGlite Data Migration] Migrating ${totalRecords} vector embeddings`)

      if (totalRecords === 0) {
        result.success = true
        return result
      }

      // Validate vector dimensions first
      const dimensionCheck = await duckdb.run(`
        SELECT DISTINCT array_length(embedding, 1) as dimension, COUNT(*) as count
        FROM vectors 
        WHERE embedding IS NOT NULL
        GROUP BY array_length(embedding, 1)
      `)

      if (dimensionCheck.length > 1) {
        result.warnings.push(
          `Inconsistent vector dimensions found: ${dimensionCheck.map((d: any) => `${d.dimension}(${d.count})`).join(', ')}`
        )
      }

      // Process in batches with optimized vector insertion
      let offset = 0
      let processedRecords = 0

      while (offset < totalRecords) {
        const batch = await duckdb.run(
          `SELECT * FROM vectors ORDER BY created_at LIMIT ${batchSize} OFFSET ${offset}`
        )

        if (batch.length === 0) break

        // Begin transaction for batch
        await pgliteDb.exec('BEGIN')

        try {
          // Prepare batch insert for better performance
          const insertQuery = `
            INSERT INTO knowledge_vectors (id, file_id, chunk_id, embedding, created_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET
              file_id = EXCLUDED.file_id,
              chunk_id = EXCLUDED.chunk_id,
              embedding = EXCLUDED.embedding,
              created_at = EXCLUDED.created_at
          `

          for (const row of batch) {
            if (options.dryRun) {
              console.log(`[PGlite Data Migration] DRY RUN: Would migrate vector ${row.id}`)
              result.recordsMigrated++
              continue
            }

            // Validate and transform embedding
            let embedding = row.embedding
            if (embedding) {
              // Convert DuckDB array format to PostgreSQL vector format
              if (Array.isArray(embedding)) {
                embedding = `[${embedding.join(',')}]`
              } else if (typeof embedding === 'string' && !embedding.startsWith('[')) {
                // Handle string representation of arrays
                try {
                  const parsed = JSON.parse(embedding)
                  if (Array.isArray(parsed)) {
                    embedding = `[${parsed.join(',')}]`
                  }
                } catch {
                  result.warnings.push(`Invalid embedding format for vector ${row.id}`)
                  result.recordsSkipped++
                  continue
                }
              }
            } else {
              result.warnings.push(`Null embedding for vector ${row.id}`)
              result.recordsSkipped++
              continue
            }

            await pgliteDb.query(insertQuery, [
              row.id,
              row.file_id,
              row.chunk_id,
              embedding,
              row.created_at || Date.now()
            ])

            result.recordsMigrated++
          }

          await pgliteDb.exec('COMMIT')
          processedRecords += batch.length
          offset += batchSize

          // Update progress
          const percentage = (processedRecords / totalRecords) * 100
          await this.updateProgress(
            'vectors',
            `Migrated ${processedRecords}/${totalRecords} vectors`,
            processedRecords,
            totalRecords,
            options.progressCallback,
            percentage
          )
        } catch (error) {
          await pgliteDb.exec('ROLLBACK')

          if (options.continueOnError) {
            result.errors.push(`Batch error at offset ${offset}: ${error}`)
            result.recordsSkipped += batch.length
            offset += batchSize
          } else {
            throw error
          }
        }
      }

      result.success = true
      console.log(
        `[PGlite Data Migration] Successfully migrated ${result.recordsMigrated} vector embeddings`
      )
    } catch (error) {
      result.errors.push(`Vector embedding migration failed: ${error}`)
      console.error('[PGlite Data Migration] Vector embedding migration error:', error)
    }

    return result
  }

  /**
   * Validate conversational data integrity between source and target
   * Supports requirement 2.4 for data integrity verification
   */
  private async validateConversationalDataIntegrity(
    sqlite: any,
    pgliteDb: any
  ): Promise<{ sourceRecords: number; targetRecords: number; checksumMatch: boolean }> {
    try {
      // Count records in source
      const sourceConversations = sqlite
        .prepare('SELECT COUNT(*) as count FROM conversations')
        .get().count
      const sourceMessages = sqlite.prepare('SELECT COUNT(*) as count FROM messages').get().count
      const sourceTotal = sourceConversations + sourceMessages

      // Count records in target
      const targetConversationsResult = await pgliteDb.query(
        'SELECT COUNT(*) as count FROM conversations'
      )
      const targetMessagesResult = await pgliteDb.query('SELECT COUNT(*) as count FROM messages')
      const targetTotal =
        targetConversationsResult.rows[0].count + targetMessagesResult.rows[0].count

      // Simple checksum validation (record counts match)
      const checksumMatch = sourceTotal === targetTotal

      console.log(
        `[PGlite Data Migration] Integrity check - Source: ${sourceTotal}, Target: ${targetTotal}, Match: ${checksumMatch}`
      )

      return {
        sourceRecords: sourceTotal,
        targetRecords: targetTotal,
        checksumMatch
      }
    } catch (error) {
      console.error('[PGlite Data Migration] Integrity validation failed:', error)
      return {
        sourceRecords: 0,
        targetRecords: 0,
        checksumMatch: false
      }
    }
  }

  /**
   * Validate vector data integrity between source and target
   * Supports requirement 2.4 for data integrity verification
   */
  private async validateVectorDataIntegrity(
    duckdb: any,
    pgliteDb: any
  ): Promise<{ sourceRecords: number; targetRecords: number; checksumMatch: boolean }> {
    try {
      // Count records in source
      const sourceFiles = await duckdb.run('SELECT COUNT(*) as count FROM files')
      const sourceChunks = await duckdb.run('SELECT COUNT(*) as count FROM chunks')
      const sourceVectors = await duckdb.run('SELECT COUNT(*) as count FROM vectors')
      const sourceTotal =
        (sourceFiles[0]?.count || 0) +
        (sourceChunks[0]?.count || 0) +
        (sourceVectors[0]?.count || 0)

      // Count records in target
      const targetFilesResult = await pgliteDb.query(
        'SELECT COUNT(*) as count FROM knowledge_files'
      )
      const targetChunksResult = await pgliteDb.query(
        'SELECT COUNT(*) as count FROM knowledge_chunks'
      )
      const targetVectorsResult = await pgliteDb.query(
        'SELECT COUNT(*) as count FROM knowledge_vectors'
      )
      const targetTotal =
        targetFilesResult.rows[0].count +
        targetChunksResult.rows[0].count +
        targetVectorsResult.rows[0].count

      // Simple checksum validation (record counts match)
      const checksumMatch = sourceTotal === targetTotal

      console.log(
        `[PGlite Data Migration] Vector integrity check - Source: ${sourceTotal}, Target: ${targetTotal}, Match: ${checksumMatch}`
      )

      return {
        sourceRecords: sourceTotal,
        targetRecords: targetTotal,
        checksumMatch
      }
    } catch (error) {
      console.error('[PGlite Data Migration] Vector integrity validation failed:', error)
      return {
        sourceRecords: 0,
        targetRecords: 0,
        checksumMatch: false
      }
    }
  }

  /**
   * Update migration progress
   */
  private async updateProgress(
    phase: DataMigrationProgress['phase'],
    _currentStep: string,
    recordsProcessed: number,
    totalRecords: number,
    progressCallback?: (progress: DataMigrationProgress) => void,
    percentage?: number
  ): Promise<void> {
    if (!progressCallback) return

    const calculatedPercentage =
      percentage || (totalRecords > 0 ? (recordsProcessed / totalRecords) * 100 : 0)

    const progress: DataMigrationProgress = {
      phase,
      currentTable: phase,
      recordsProcessed,
      totalRecords,
      percentage: calculatedPercentage,
      startTime: Date.now()
    }

    try {
      progressCallback(progress)
    } catch (error) {
      console.warn('[PGlite Data Migration] Progress callback error:', error)
    }
  }
}
/**
 * Comprehensive Data Validation and Verification Engine
 * Implements requirements 2.4, 8.4, 9.4 for data validation and migration reporting
 */
export class PGliteDataValidator {
  private static readonly CHECKSUM_ALGORITHM = 'sha256'

  /**
   * Validate data integrity between source and target databases
   * Supports requirements 2.4, 8.4, 9.4 for comprehensive data validation
   */
  async validateDataIntegrity(
    sourceConnections: LegacyDatabaseConnection[],
    targetDb: any,
    options: {
      includeChecksums?: boolean
      validateRelationships?: boolean
      generateReport?: boolean
    } = {}
  ): Promise<DataIntegrityValidationResult> {
    const startTime = Date.now()
    const result: DataIntegrityValidationResult = {
      isValid: true,
      summary: {
        totalTables: 0,
        validTables: 0,
        invalidTables: 0,
        totalRecords: 0,
        validRecords: 0,
        invalidRecords: 0,
        executionTime: 0
      },
      tableValidations: [],
      relationshipValidations: [],
      checksumValidations: [],
      errors: [],
      warnings: [],
      detailedReport: null
    }

    console.log('[PGlite Data Validation] Starting comprehensive data integrity validation')

    try {
      // Validate each source database
      for (const sourceConnection of sourceConnections) {
        if (sourceConnection.type === 'sqlite') {
          const sqliteValidation = await this.validateSQLiteDataIntegrity(
            sourceConnection,
            targetDb,
            options
          )
          this.mergeValidationResults(result, sqliteValidation)
        } else if (sourceConnection.type === 'duckdb') {
          const duckdbValidation = await this.validateDuckDBDataIntegrity(
            sourceConnection,
            targetDb,
            options
          )
          this.mergeValidationResults(result, duckdbValidation)
        }
      }

      // Validate relationships if requested
      if (options.validateRelationships) {
        const relationshipValidation = await this.validateDataRelationships(targetDb)
        result.relationshipValidations = relationshipValidation.violations
        if (relationshipValidation.violations.length > 0) {
          result.isValid = false
          result.errors.push(...relationshipValidation.violations.map((v) => v.description))
        }
      }

      // Generate detailed report if requested
      if (options.generateReport) {
        result.detailedReport = await this.generateMigrationReport(
          result,
          sourceConnections,
          targetDb
        )
      }

      result.summary.executionTime = Date.now() - startTime
      result.summary.validTables = result.tableValidations.filter((t) => t.isValid).length
      result.summary.invalidTables = result.tableValidations.filter((t) => !t.isValid).length
      result.summary.totalTables = result.tableValidations.length

      console.log(
        `[PGlite Data Validation] Validation completed in ${result.summary.executionTime}ms. ` +
          `Valid: ${result.isValid}, Tables: ${result.summary.validTables}/${result.summary.totalTables}, ` +
          `Records: ${result.summary.validRecords}/${result.summary.totalRecords}`
      )

      return result
    } catch (error) {
      result.isValid = false
      result.errors.push(`Data integrity validation failed: ${error}`)
      result.summary.executionTime = Date.now() - startTime

      console.error('[PGlite Data Validation] Validation failed:', error)
      return result
    }
  }

  /**
   * Validate SQLite data integrity against PGlite target
   */
  private async validateSQLiteDataIntegrity(
    sourceConnection: LegacyDatabaseConnection,
    targetDb: any,
    options: any
  ): Promise<Partial<DataIntegrityValidationResult>> {
    const result: Partial<DataIntegrityValidationResult> = {
      tableValidations: [],
      checksumValidations: [],
      errors: [],
      warnings: []
    }

    const sqlite = sourceConnection.connection

    try {
      // Validate conversations table
      const conversationValidation = await this.validateTableIntegrity(
        'conversations',
        'conversations',
        sqlite,
        targetDb,
        'sqlite',
        options
      )
      result.tableValidations!.push(conversationValidation)

      // Validate messages table
      const messageValidation = await this.validateTableIntegrity(
        'messages',
        'messages',
        sqlite,
        targetDb,
        'sqlite',
        options
      )
      result.tableValidations!.push(messageValidation)

      // Validate message_attachments table if it exists
      const attachmentTableExists = sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='message_attachments'`)
        .get()

      if (attachmentTableExists) {
        const attachmentValidation = await this.validateTableIntegrity(
          'message_attachments',
          'message_attachments',
          sqlite,
          targetDb,
          'sqlite',
          options
        )
        result.tableValidations!.push(attachmentValidation)
      }

      // Generate checksums if requested
      if (options.includeChecksums) {
        const conversationChecksum = await this.generateTableChecksum(
          sqlite,
          'conversations',
          'sqlite'
        )
        const messageChecksum = await this.generateTableChecksum(sqlite, 'messages', 'sqlite')

        const targetConversationChecksum = await this.generateTableChecksum(
          targetDb,
          'conversations',
          'pglite'
        )
        const targetMessageChecksum = await this.generateTableChecksum(
          targetDb,
          'messages',
          'pglite'
        )

        result.checksumValidations!.push({
          table: 'conversations',
          sourceChecksum: conversationChecksum,
          targetChecksum: targetConversationChecksum,
          isValid: conversationChecksum === targetConversationChecksum
        })

        result.checksumValidations!.push({
          table: 'messages',
          sourceChecksum: messageChecksum,
          targetChecksum: targetMessageChecksum,
          isValid: messageChecksum === targetMessageChecksum
        })
      }
    } catch (error) {
      result.errors!.push(`SQLite validation failed: ${error}`)
    }

    return result
  }

  /**
   * Validate DuckDB data integrity against PGlite target
   */
  private async validateDuckDBDataIntegrity(
    sourceConnection: LegacyDatabaseConnection,
    targetDb: any,
    options: any
  ): Promise<Partial<DataIntegrityValidationResult>> {
    const result: Partial<DataIntegrityValidationResult> = {
      tableValidations: [],
      checksumValidations: [],
      errors: [],
      warnings: []
    }

    const duckdb = sourceConnection.connection

    try {
      // Validate files table
      const fileValidation = await this.validateTableIntegrity(
        'files',
        'knowledge_files',
        duckdb,
        targetDb,
        'duckdb',
        options
      )
      result.tableValidations!.push(fileValidation)

      // Validate chunks table
      const chunkValidation = await this.validateTableIntegrity(
        'chunks',
        'knowledge_chunks',
        duckdb,
        targetDb,
        'duckdb',
        options
      )
      result.tableValidations!.push(chunkValidation)

      // Validate vectors table
      const vectorValidation = await this.validateTableIntegrity(
        'vectors',
        'knowledge_vectors',
        duckdb,
        targetDb,
        'duckdb',
        options
      )
      result.tableValidations!.push(vectorValidation)

      // Validate vector dimensions specifically
      const dimensionValidation = await this.validateVectorDimensions(duckdb, targetDb)
      if (!dimensionValidation.isValid) {
        result.warnings!.push(...dimensionValidation.issues)
      }

      // Generate checksums if requested
      if (options.includeChecksums) {
        const fileChecksum = await this.generateTableChecksum(duckdb, 'files', 'duckdb')
        const chunkChecksum = await this.generateTableChecksum(duckdb, 'chunks', 'duckdb')
        const vectorChecksum = await this.generateTableChecksum(duckdb, 'vectors', 'duckdb')

        const targetFileChecksum = await this.generateTableChecksum(
          targetDb,
          'knowledge_files',
          'pglite'
        )
        const targetChunkChecksum = await this.generateTableChecksum(
          targetDb,
          'knowledge_chunks',
          'pglite'
        )
        const targetVectorChecksum = await this.generateTableChecksum(
          targetDb,
          'knowledge_vectors',
          'pglite'
        )

        result.checksumValidations!.push({
          table: 'files/knowledge_files',
          sourceChecksum: fileChecksum,
          targetChecksum: targetFileChecksum,
          isValid: fileChecksum === targetFileChecksum
        })

        result.checksumValidations!.push({
          table: 'chunks/knowledge_chunks',
          sourceChecksum: chunkChecksum,
          targetChecksum: targetChunkChecksum,
          isValid: chunkChecksum === targetChunkChecksum
        })

        result.checksumValidations!.push({
          table: 'vectors/knowledge_vectors',
          sourceChecksum: vectorChecksum,
          targetChecksum: targetVectorChecksum,
          isValid: vectorChecksum === targetVectorChecksum
        })
      }
    } catch (error) {
      result.errors!.push(`DuckDB validation failed: ${error}`)
    }

    return result
  }

  /**
   * Validate individual table integrity between source and target
   */
  private async validateTableIntegrity(
    sourceTable: string,
    targetTable: string,
    sourceDb: any,
    targetDb: any,
    sourceType: 'sqlite' | 'duckdb',
    _options: any
  ): Promise<TableValidationResult> {
    const result: TableValidationResult = {
      sourceTable,
      targetTable,
      isValid: true,
      sourceRecordCount: 0,
      targetRecordCount: 0,
      recordCountMatch: false,
      sampleValidation: null,
      issues: []
    }

    try {
      // Get record counts
      if (sourceType === 'sqlite') {
        const sourceCount = sourceDb.prepare(`SELECT COUNT(*) as count FROM ${sourceTable}`).get()
        result.sourceRecordCount = sourceCount.count
      } else {
        const sourceCount = await sourceDb.run(`SELECT COUNT(*) as count FROM ${sourceTable}`)
        result.sourceRecordCount = sourceCount[0]?.count || 0
      }

      const targetCount = await targetDb.query(`SELECT COUNT(*) as count FROM ${targetTable}`)
      result.targetRecordCount = targetCount.rows[0].count

      result.recordCountMatch = result.sourceRecordCount === result.targetRecordCount

      if (!result.recordCountMatch) {
        result.isValid = false
        result.issues.push(
          `Record count mismatch: source ${result.sourceRecordCount}, target ${result.targetRecordCount}`
        )
      }

      // Sample validation - check a few records for data consistency
      if (result.sourceRecordCount > 0 && result.targetRecordCount > 0) {
        const sampleValidation = await this.validateSampleRecords(
          sourceTable,
          targetTable,
          sourceDb,
          targetDb,
          sourceType,
          Math.min(10, result.sourceRecordCount) // Sample up to 10 records
        )
        result.sampleValidation = sampleValidation

        if (!sampleValidation.isValid) {
          result.isValid = false
          result.issues.push(...sampleValidation.issues)
        }
      }

      console.log(
        `[PGlite Data Validation] Table ${sourceTable}->${targetTable}: ` +
          `${result.isValid ? 'VALID' : 'INVALID'} (${result.sourceRecordCount}->${result.targetRecordCount})`
      )
    } catch (error) {
      result.isValid = false
      result.issues.push(`Table validation failed: ${error}`)
    }

    return result
  }

  /**
   * Validate sample records between source and target tables
   */
  private async validateSampleRecords(
    sourceTable: string,
    targetTable: string,
    sourceDb: any,
    targetDb: any,
    sourceType: 'sqlite' | 'duckdb',
    sampleSize: number
  ): Promise<SampleValidationResult> {
    const result: SampleValidationResult = {
      isValid: true,
      samplesChecked: 0,
      samplesValid: 0,
      issues: []
    }

    try {
      // Get sample records from source
      let sampleRecords: any[] = []

      if (sourceType === 'sqlite') {
        sampleRecords = sourceDb
          .prepare(`SELECT * FROM ${sourceTable} ORDER BY RANDOM() LIMIT ${sampleSize}`)
          .all()
      } else {
        sampleRecords = await sourceDb.run(
          `SELECT * FROM ${sourceTable} ORDER BY RANDOM() LIMIT ${sampleSize}`
        )
      }

      result.samplesChecked = sampleRecords.length

      // Check each sample record in target
      for (const sourceRecord of sampleRecords) {
        const isValid = await this.validateSingleRecord(
          sourceRecord,
          sourceTable,
          targetTable,
          targetDb,
          sourceType
        )

        if (isValid) {
          result.samplesValid++
        } else {
          result.isValid = false
          result.issues.push(`Sample record validation failed for ID: ${sourceRecord.id}`)
        }
      }
    } catch (error) {
      result.isValid = false
      result.issues.push(`Sample validation failed: ${error}`)
    }

    return result
  }

  /**
   * Validate a single record exists and matches in target table
   */
  private async validateSingleRecord(
    sourceRecord: any,
    sourceTable: string,
    targetTable: string,
    targetDb: any,
    _sourceType: 'sqlite' | 'duckdb'
  ): Promise<boolean> {
    try {
      // Determine the primary key column based on table
      let pkColumn = 'id'
      if (sourceTable === 'conversations') pkColumn = 'conv_id'
      if (sourceTable === 'messages') pkColumn = 'msg_id'

      const pkValue = sourceRecord[pkColumn]
      if (!pkValue) return false

      // Check if record exists in target
      const targetRecord = await targetDb.query(
        `SELECT * FROM ${targetTable} WHERE ${pkColumn} = $1`,
        [pkValue]
      )

      if (targetRecord.rows.length === 0) {
        return false
      }

      // Basic field comparison (simplified - in practice would do deep comparison)
      const target = targetRecord.rows[0]

      // Check key fields based on table type
      if (sourceTable === 'conversations') {
        return target.title === sourceRecord.title && target.created_at === sourceRecord.created_at
      } else if (sourceTable === 'messages') {
        return (
          target.conversation_id === sourceRecord.conversation_id &&
          target.role === sourceRecord.role &&
          target.content === sourceRecord.content
        )
      } else if (sourceTable === 'files') {
        return (
          target.name === sourceRecord.name &&
          target.path === sourceRecord.path &&
          target.status === sourceRecord.status
        )
      }

      return true
    } catch (error) {
      console.warn(`[PGlite Data Validation] Single record validation error:`, error)
      return false
    }
  }

  /**
   * Validate vector dimensions consistency
   */
  private async validateVectorDimensions(
    duckdb: any,
    pgliteDb: any
  ): Promise<{ isValid: boolean; issues: string[] }> {
    const issues: string[] = []

    try {
      // Check source vector dimensions
      const sourceDimensions = await duckdb.run(`
        SELECT DISTINCT array_length(embedding, 1) as dimension, COUNT(*) as count
        FROM vectors 
        WHERE embedding IS NOT NULL
        GROUP BY array_length(embedding, 1)
      `)

      // Check target vector dimensions
      const targetDimensions = await pgliteDb.query(`
        SELECT DISTINCT array_length(embedding, 1) as dimension, COUNT(*) as count
        FROM knowledge_vectors 
        WHERE embedding IS NOT NULL
        GROUP BY array_length(embedding, 1)
      `)

      // Compare dimensions
      if (sourceDimensions.length !== targetDimensions.rows.length) {
        issues.push(
          `Vector dimension count mismatch: source has ${sourceDimensions.length} different dimensions, ` +
            `target has ${targetDimensions.rows.length}`
        )
      }

      // Check for inconsistent dimensions within each database
      if (sourceDimensions.length > 1) {
        issues.push(
          `Source has inconsistent vector dimensions: ${sourceDimensions.map((d: any) => `${d.dimension}(${d.count})`).join(', ')}`
        )
      }

      if (targetDimensions.rows.length > 1) {
        issues.push(
          `Target has inconsistent vector dimensions: ${targetDimensions.rows.map((d: any) => `${d.dimension}(${d.count})`).join(', ')}`
        )
      }
    } catch (error) {
      issues.push(`Vector dimension validation failed: ${error}`)
    }

    return {
      isValid: issues.length === 0,
      issues
    }
  }

  /**
   * Validate data relationships and foreign key constraints
   */
  private async validateDataRelationships(
    targetDb: any
  ): Promise<{ violations: RelationshipViolation[] }> {
    const violations: RelationshipViolation[] = []

    try {
      // Check messages -> conversations relationship
      const orphanedMessages = await targetDb.query(`
        SELECT COUNT(*) as count, array_agg(msg_id) as msg_ids
        FROM messages m 
        LEFT JOIN conversations c ON m.conversation_id = c.conv_id 
        WHERE c.conv_id IS NULL
      `)

      if (orphanedMessages.rows[0].count > 0) {
        violations.push({
          type: 'orphaned_records',
          table: 'messages',
          description: `Found ${orphanedMessages.rows[0].count} messages without valid conversations`,
          affectedRecords: orphanedMessages.rows[0].count,
          severity: 'critical'
        })
      }

      // Check knowledge_chunks -> knowledge_files relationship
      const orphanedChunks = await targetDb.query(`
        SELECT COUNT(*) as count
        FROM knowledge_chunks kc 
        LEFT JOIN knowledge_files kf ON kc.file_id = kf.id 
        WHERE kf.id IS NULL
      `)

      if (orphanedChunks.rows[0].count > 0) {
        violations.push({
          type: 'orphaned_records',
          table: 'knowledge_chunks',
          description: `Found ${orphanedChunks.rows[0].count} chunks without valid files`,
          affectedRecords: orphanedChunks.rows[0].count,
          severity: 'critical'
        })
      }

      // Check knowledge_vectors -> knowledge_chunks relationship
      const orphanedVectors = await targetDb.query(`
        SELECT COUNT(*) as count
        FROM knowledge_vectors kv 
        LEFT JOIN knowledge_chunks kc ON kv.chunk_id = kc.id 
        WHERE kc.id IS NULL
      `)

      if (orphanedVectors.rows[0].count > 0) {
        violations.push({
          type: 'orphaned_records',
          table: 'knowledge_vectors',
          description: `Found ${orphanedVectors.rows[0].count} vectors without valid chunks`,
          affectedRecords: orphanedVectors.rows[0].count,
          severity: 'critical'
        })
      }

      // Check for duplicate primary keys
      const duplicateConversations = await targetDb.query(`
        SELECT conv_id, COUNT(*) as count 
        FROM conversations 
        GROUP BY conv_id 
        HAVING COUNT(*) > 1
      `)

      if (duplicateConversations.rows.length > 0) {
        violations.push({
          type: 'duplicate_records',
          table: 'conversations',
          description: `Found ${duplicateConversations.rows.length} duplicate conversation IDs`,
          affectedRecords: duplicateConversations.rows.length,
          severity: 'major'
        })
      }
    } catch (error) {
      violations.push({
        type: 'validation_error',
        table: 'unknown',
        description: `Relationship validation failed: ${error}`,
        affectedRecords: 0,
        severity: 'critical'
      })
    }

    return { violations }
  }

  /**
   * Generate table checksum for integrity verification
   */
  private async generateTableChecksum(
    db: any,
    tableName: string,
    dbType: 'sqlite' | 'duckdb' | 'pglite'
  ): Promise<string> {
    try {
      const crypto = require('crypto')
      let data = ''

      if (dbType === 'sqlite') {
        const records = db.prepare(`SELECT * FROM ${tableName} ORDER BY rowid`).all()
        data = JSON.stringify(records)
      } else if (dbType === 'duckdb') {
        const records = await db.run(`SELECT * FROM ${tableName} ORDER BY 1`)
        data = JSON.stringify(records)
      } else {
        const result = await db.query(`SELECT * FROM ${tableName} ORDER BY 1`)
        data = JSON.stringify(result.rows)
      }

      return crypto.createHash(PGliteDataValidator.CHECKSUM_ALGORITHM).update(data).digest('hex')
    } catch (error) {
      console.warn(`[PGlite Data Validation] Checksum generation failed for ${tableName}:`, error)
      return 'error'
    }
  }

  /**
   * Generate detailed migration report
   * Supports requirement 8.4 for detailed migration reports
   */
  private async generateMigrationReport(
    validationResult: DataIntegrityValidationResult,
    sourceConnections: LegacyDatabaseConnection[],
    _targetDb: any
  ): Promise<MigrationReport> {
    const report: MigrationReport = {
      generatedAt: Date.now(),
      migrationSummary: {
        sourceConnections: sourceConnections.length,
        totalSourceRecords: 0,
        totalTargetRecords: 0,
        migrationSuccess: validationResult.isValid,
        executionTime: validationResult.summary.executionTime
      },
      tableReports: [],
      integrityChecks: {
        recordCountChecks: validationResult.tableValidations.map((t) => ({
          table: `${t.sourceTable} -> ${t.targetTable}`,
          sourceCount: t.sourceRecordCount,
          targetCount: t.targetRecordCount,
          match: t.recordCountMatch
        })),
        checksumChecks: validationResult.checksumValidations.map((c) => ({
          table: c.table,
          sourceChecksum: c.sourceChecksum,
          targetChecksum: c.targetChecksum,
          match: c.isValid
        })),
        relationshipChecks: validationResult.relationshipValidations.map((r) => ({
          type: r.type,
          table: r.table,
          description: r.description,
          severity: r.severity,
          affectedRecords: r.affectedRecords
        }))
      },
      recommendations: [],
      errors: validationResult.errors,
      warnings: validationResult.warnings
    }

    // Calculate totals
    report.migrationSummary.totalSourceRecords = validationResult.tableValidations.reduce(
      (sum, t) => sum + t.sourceRecordCount,
      0
    )
    report.migrationSummary.totalTargetRecords = validationResult.tableValidations.reduce(
      (sum, t) => sum + t.targetRecordCount,
      0
    )

    // Generate table reports
    for (const tableValidation of validationResult.tableValidations) {
      report.tableReports.push({
        tableName: `${tableValidation.sourceTable} -> ${tableValidation.targetTable}`,
        recordCount: tableValidation.targetRecordCount,
        validationStatus: tableValidation.isValid ? 'valid' : 'invalid',
        issues: tableValidation.issues,
        sampleValidation: tableValidation.sampleValidation
      })
    }

    // Generate recommendations
    if (!validationResult.isValid) {
      report.recommendations.push('Review and fix data integrity issues before proceeding')
    }

    if (validationResult.relationshipValidations.length > 0) {
      report.recommendations.push('Fix orphaned records and relationship violations')
    }

    if (validationResult.checksumValidations.some((c) => !c.isValid)) {
      report.recommendations.push('Investigate checksum mismatches - data may be corrupted')
    }

    if (validationResult.warnings.length > 0) {
      report.recommendations.push('Review warnings for potential data quality issues')
    }

    return report
  }

  /**
   * Merge validation results from multiple sources
   */
  private mergeValidationResults(
    target: DataIntegrityValidationResult,
    source: Partial<DataIntegrityValidationResult>
  ): void {
    if (source.tableValidations) {
      target.tableValidations.push(...source.tableValidations)
    }
    if (source.checksumValidations) {
      target.checksumValidations.push(...source.checksumValidations)
    }
    if (source.errors) {
      target.errors.push(...source.errors)
    }
    if (source.warnings) {
      target.warnings.push(...source.warnings)
    }

    // Update validity
    if (
      source.tableValidations?.some((t) => !t.isValid) ||
      source.checksumValidations?.some((c) => !c.isValid) ||
      (source.errors && source.errors.length > 0)
    ) {
      target.isValid = false
    }
  }
}

// Additional interfaces for comprehensive validation
export interface DataIntegrityValidationResult {
  isValid: boolean
  summary: {
    totalTables: number
    validTables: number
    invalidTables: number
    totalRecords: number
    validRecords: number
    invalidRecords: number
    executionTime: number
  }
  tableValidations: TableValidationResult[]
  relationshipValidations: RelationshipViolation[]
  checksumValidations: ChecksumValidationResult[]
  errors: string[]
  warnings: string[]
  detailedReport: MigrationReport | null
}

export interface TableValidationResult {
  sourceTable: string
  targetTable: string
  isValid: boolean
  sourceRecordCount: number
  targetRecordCount: number
  recordCountMatch: boolean
  sampleValidation: SampleValidationResult | null
  issues: string[]
}

export interface SampleValidationResult {
  isValid: boolean
  samplesChecked: number
  samplesValid: number
  issues: string[]
}

export interface ChecksumValidationResult {
  table: string
  sourceChecksum: string
  targetChecksum: string
  isValid: boolean
}

export interface RelationshipViolation {
  type: 'orphaned_records' | 'duplicate_records' | 'constraint_violation' | 'validation_error'
  table: string
  description: string
  affectedRecords: number
  severity: 'critical' | 'major' | 'minor'
}

export interface MigrationReport {
  generatedAt: number
  migrationSummary: {
    sourceConnections: number
    totalSourceRecords: number
    totalTargetRecords: number
    migrationSuccess: boolean
    executionTime: number
  }
  tableReports: Array<{
    tableName: string
    recordCount: number
    validationStatus: 'valid' | 'invalid'
    issues: string[]
    sampleValidation: SampleValidationResult | null
  }>
  integrityChecks: {
    recordCountChecks: Array<{
      table: string
      sourceCount: number
      targetCount: number
      match: boolean
    }>
    checksumChecks: Array<{
      table: string
      sourceChecksum: string
      targetChecksum: string
      match: boolean
    }>
    relationshipChecks: Array<{
      type: string
      table: string
      description: string
      severity: string
      affectedRecords: number
    }>
  }
  recommendations: string[]
  errors: string[]
  warnings: string[]
}
