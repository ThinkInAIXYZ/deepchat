/**
 * PGlite Presenter - Unified database presenter for conversational and vector data
 */
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import path from 'path'
import fs from 'fs'
import {
  IndexOptions,
  ISQLitePresenter,
  IVectorDatabasePresenter,
  CONVERSATION,
  CONVERSATION_SETTINGS,
  SQLITE_MESSAGE,
  KnowledgeFileMessage,
  KnowledgeChunkMessage,
  KnowledgeTaskStatus,
  VectorInsertOptions,
  QueryOptions,
  QueryResult
} from '@shared/presenter'

// Import schema management components
import { PGliteSchemaManager, SchemaMigration, MigrationResult } from './schema'
import { PGliteMigrationEngine } from './migration'
import { PGliteDataValidator } from './validation'

// Re-export IndexOptions for use in other modules
export type { IndexOptions }

/**
 * Unified PGlite presenter interface combining SQLite and vector database operations
 * Extends both ISQLitePresenter and IVectorDatabasePresenter to provide a single interface
 * for all database operations in the unified PGlite architecture
 */
export interface IPGlitePresenter
  extends Omit<ISQLitePresenter, 'close' | 'runTransaction'>,
    Omit<IVectorDatabasePresenter, 'initialize'> {
  // PGlite-specific configuration and initialization (overrides IVectorDatabasePresenter.initialize)
  initialize(config: PGliteConfig): Promise<void>

  // Enhanced transaction management with nested transaction support (overrides ISQLitePresenter.runTransaction)
  beginTransaction(): Promise<void>
  commitTransaction(): Promise<void>
  rollbackTransaction(): Promise<void>
  runTransaction(operations: () => Promise<void>): Promise<void>

  // Schema versioning and migration management
  getCurrentSchemaVersion(): Promise<number>
  migrateSchema(targetVersion: number): Promise<void>

  // Database health and integrity validation
  validateIntegrity(): Promise<ValidationResult>

  // PGlite-specific connection management
  isConnected(): boolean
  reconnect(): Promise<void>

  // Override close method to use async version from IVectorDatabasePresenter
  close(): Promise<void>
}

/**
 * PGlite-specific configuration interface
 * Provides comprehensive configuration options for PGlite database initialization
 */
export interface PGliteConfig {
  // Database file path
  dbPath: string

  // Extensions to load (pgvector is loaded by default)
  extensions?: string[]

  // Vector configuration
  vectorDimensions?: number
  indexOptions?: IndexOptions

  // Connection and performance settings
  connectionTimeout?: number
  queryTimeout?: number
  maxConnections?: number

  // Schema and migration settings
  autoMigrate?: boolean
  schemaValidation?: boolean

  // Backup and recovery settings
  enableBackups?: boolean
  backupInterval?: number
  maxBackupFiles?: number

  // Logging and debugging
  enableQueryLogging?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error'

  // Memory and performance tuning
  sharedBuffers?: string
  workMem?: string
  maintenanceWorkMem?: string
}

/**
 * Database validation result interface
 * Provides detailed information about database integrity and health checks
 */
export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]

  // Detailed validation metrics
  tableCount: number
  recordCounts: Record<string, number>
  indexHealth: Record<string, boolean>

  // Performance metrics
  queryPerformance?: {
    averageQueryTime: number
    slowQueries: Array<{ query: string; duration: number }>
  }

  // Schema validation
  schemaVersion: number
  pendingMigrations: number[]

  // Data integrity checks
  orphanedRecords: Record<string, number>
  constraintViolations: string[]

  // Vector-specific validation
  vectorIndexStatus?: {
    totalVectors: number
    indexedVectors: number
    indexEfficiency: number
  }
}

/**
 * Schema migration definition interface
 * Defines the structure for database schema migrations with rollback support
 */
export interface SchemaMigration {
  version: number
  description: string
  upScript: string
  downScript?: string
  dependencies?: number[]
  appliedAt?: number
  checksum?: string
}

/**
 * Migration execution result interface
 * Provides detailed information about migration execution results
 */
export interface MigrationResult {
  success: boolean
  version: number
  description: string
  executionTime: number
  errors: string[]
  warnings: string[]
  rollbackAvailable: boolean
}

/**
 * PGlite Presenter implementation
 * Unified database presenter that implements both SQLite and vector database operations
 * This is a partial implementation - full implementation will be completed in subsequent tasks
 */
export class PGlitePresenter implements IPGlitePresenter {
  private db!: PGlite
  private readonly dbPath: string
  private config!: PGliteConfig
  private isInitialized = false
  private inTransaction = false
  private connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected'
  private readonly maxRetries = 3
  private readonly retryDelay = 1000 // 1 second

  // Schema management components
  private schemaManager!: PGliteSchemaManager
  private migrationEngine!: PGliteMigrationEngine
  private dataValidator!: PGliteDataValidator

  // Schema version constants
  private static readonly CURRENT_SCHEMA_VERSION = 1
  private static readonly SCHEMA_VERSION_TABLE = 'schema_versions'
  private static readonly MIGRATION_METADATA_TABLE = 'migration_metadata'

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  // ==================== Connection Management ====================

  isConnected(): boolean {
    return this.connectionStatus === 'connected' && this.isInitialized
  }

  async reconnect(): Promise<void> {
    console.log('[PGlite] Attempting to reconnect to database')

    try {
      if (this.isConnected()) {
        await this.close()
      }

      this.connectionStatus = 'connecting'
      await this.open()
      this.connectionStatus = 'connected'

      console.log('[PGlite] Successfully reconnected to database')
    } catch (error) {
      this.connectionStatus = 'error'
      console.error('[PGlite] Failed to reconnect:', error)
      throw new Error(`Failed to reconnect to database: ${error}`)
    }
  }

  private async retryConnection(operation: () => Promise<void>): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await operation()
        return
      } catch (error) {
        lastError = error as Error

        console.warn(`[PGlite] Connection attempt ${attempt + 1} failed:`, error)

        if (attempt < this.maxRetries) {
          console.log(`[PGlite] Retrying in ${this.retryDelay}ms...`)
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay))
        }
      }
    }

    this.connectionStatus = 'error'
    throw new Error(
      `Connection failed after ${this.maxRetries + 1} attempts. Last error: ${lastError?.message}`
    )
  }

  // ==================== Core Database Management ====================

  async initialize(config: PGliteConfig): Promise<void> {
    if (this.isInitialized) {
      throw new Error('PGlite presenter is already initialized')
    }

    this.config = {
      // Set default values
      connectionTimeout: 30000,
      queryTimeout: 30000,
      maxConnections: 1,
      autoMigrate: true,
      schemaValidation: true,
      enableBackups: true,
      backupInterval: 24 * 60 * 60 * 1000, // 24 hours
      maxBackupFiles: 5,
      enableQueryLogging: false,
      logLevel: 'info',
      vectorDimensions: 1536,
      ...config
    }

    await this.retryConnection(async () => {
      this.connectionStatus = 'connecting'

      console.log(`[PGlite] Initializing PGlite database at ${this.dbPath}`)

      // Ensure directory exists
      const dbDir = path.dirname(this.dbPath)
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true })
      }

      // Initialize PGlite with vector extension
      this.db = new PGlite(this.dbPath, {
        extensions: {
          vector
        }
      })

      // Test connection
      await this.db.query('SELECT 1')

      // Initialize schema management components
      this.schemaManager = new PGliteSchemaManager(this.config.vectorDimensions || 1536)
      this.migrationEngine = new PGliteMigrationEngine(this.config.vectorDimensions || 1536)
      this.dataValidator = new PGliteDataValidator()

      // Create initial schema
      await this.createInitialSchema()

      this.isInitialized = true
      this.connectionStatus = 'connected'
      console.log(`[PGlite] Database initialized successfully`)
    })
  }

  async open(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    if (!fs.existsSync(this.dbPath)) {
      throw new Error('Database does not exist, please initialize first.')
    }

    await this.retryConnection(async () => {
      this.connectionStatus = 'connecting'

      console.log(`[PGlite] Opening PGlite database at ${this.dbPath}`)

      this.db = new PGlite(this.dbPath, {
        extensions: {
          vector
        }
      })

      // Test connection
      await this.db.query('SELECT 1')

      // Initialize schema management components
      this.schemaManager = new PGliteSchemaManager(this.config?.vectorDimensions || 1536)
      this.migrationEngine = new PGliteMigrationEngine(this.config?.vectorDimensions || 1536)
      this.dataValidator = new PGliteDataValidator()

      // Run any pending schema migrations
      if (this.config?.autoMigrate) {
        await this.runMigrations()
      }

      // Validate schema if enabled
      if (this.config?.schemaValidation) {
        const validation = await this.validateIntegrity()
        if (!validation.isValid) {
          throw new Error(`Schema validation failed: ${validation.errors.join(', ')}`)
        }
      }

      this.isInitialized = true
      this.connectionStatus = 'connected'
      console.log(`[PGlite] Database opened successfully`)
    })
  }

  async close(): Promise<void> {
    if (!this.isInitialized) {
      return
    }

    try {
      this.connectionStatus = 'disconnected'

      // Rollback any pending transactions
      if (this.inTransaction) {
        console.warn('[PGlite] Rolling back pending transaction before closing')
        await this.rollbackTransaction()
      }

      // Close the database connection
      if (this.db) {
        await this.db.close()
      }

      this.isInitialized = false
      console.log('[PGlite] Database closed successfully')
    } catch (error) {
      console.error('[PGlite] Error closing database:', error)
      this.connectionStatus = 'error'
      throw new Error(`Failed to close database: ${error}`)
    }
  }

  // ==================== Transaction Management ====================

  async beginTransaction(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Database not initialized')
    }

    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    if (this.inTransaction) {
      throw new Error('Transaction already in progress')
    }

    try {
      await this.db.exec('BEGIN')
      this.inTransaction = true
      console.log('[PGlite] Transaction started')
    } catch (error) {
      console.error('[PGlite] Failed to begin transaction:', error)
      throw new Error(`Failed to begin transaction: ${error}`)
    }
  }

  async commitTransaction(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress')
    }

    try {
      await this.db.exec('COMMIT')
      this.inTransaction = false
      console.log('[PGlite] Transaction committed')
    } catch (error) {
      console.error('[PGlite] Failed to commit transaction:', error)
      this.inTransaction = false
      throw new Error(`Failed to commit transaction: ${error}`)
    }
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress')
    }

    try {
      await this.db.exec('ROLLBACK')
      this.inTransaction = false
      console.log('[PGlite] Transaction rolled back')
    } catch (error) {
      console.error('[PGlite] Failed to rollback transaction:', error)
      this.inTransaction = false
      throw new Error(`Failed to rollback transaction: ${error}`)
    }
  }

  async runTransaction(operations: () => Promise<void>): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    await this.beginTransaction()
    try {
      await operations()
      await this.commitTransaction()
    } catch (error) {
      try {
        await this.rollbackTransaction()
      } catch (rollbackError) {
        console.error('[PGlite] Failed to rollback transaction after error:', rollbackError)
      }
      throw error
    }
  }

  // ==================== Schema Management ====================

  private async createInitialSchema(): Promise<void> {
    try {
      console.log('[PGlite] Creating initial database schema using schema manager')

      // Use the schema manager for unified schema creation
      const schemaManager = new PGliteSchemaManager(this.config.vectorDimensions || 1536)
      await schemaManager.createSchema(this.db)

      console.log('[PGlite] Initial schema created successfully')
    } catch (error) {
      console.error('[PGlite] Failed to create initial schema:', error)
      throw new Error(`Schema creation failed: ${error}`)
    }
  }

  async getCurrentSchemaVersion(): Promise<number> {
    if (!this.schemaManager) {
      // Fallback for cases where schema manager isn't initialized yet
      try {
        const result = await this.db.query(
          `SELECT version FROM ${PGlitePresenter.SCHEMA_VERSION_TABLE} ORDER BY version DESC LIMIT 1`
        )
        return result.rows.length > 0 ? (result.rows[0] as any).version : 0
      } catch {
        return 0
      }
    }

    return this.schemaManager.getCurrentVersion(this.db)
  }

  /**
   * Gets all applied schema versions with their metadata
   * Supports requirement 5.3 for schema versioning and rollback capabilities
   */
  async getAppliedMigrations(): Promise<SchemaMigration[]> {
    if (!this.migrationEngine) {
      // Fallback implementation
      try {
        const result = await this.db.query(
          `SELECT version, applied_at, description FROM ${PGlitePresenter.SCHEMA_VERSION_TABLE} ORDER BY version ASC`
        )
        return result.rows.map((row: any) => ({
          version: row.version,
          description: row.description,
          appliedAt: row.applied_at,
          upScript: '',
          downScript: '',
          dependencies: []
        }))
      } catch {
        return []
      }
    }

    const history = await this.migrationEngine.getMigrationHistory(this.db)
    return history
      .filter((h) => !h.isRollback && h.success)
      .map((h) => ({
        version: h.version,
        description: h.description,
        appliedAt: h.appliedAt,
        upScript: '',
        downScript: '',
        dependencies: []
      }))
  }

  /**
   * Checks if a migration can be rolled back
   * Supports requirement 5.3 for rollback capabilities
   */
  async canRollbackMigration(version: number): Promise<boolean> {
    if (!this.migrationEngine) {
      return false
    }

    try {
      const plan = await this.migrationEngine.createMigrationPlan(this.db, version - 1)
      return plan.isRollback && plan.migrations.length > 0
    } catch {
      return false
    }
  }

  /**
   * Enhanced schema migration with rollback support and dependency checking
   * Supports requirements 5.3 and 5.4 for schema versioning and backward compatibility
   */
  async migrateSchema(targetVersion: number): Promise<MigrationResult[]> {
    if (!this.migrationEngine) {
      throw new Error('Migration engine not initialized')
    }

    console.log(`[PGlite] Starting schema migration to version ${targetVersion}`)

    try {
      // Create migration plan
      const plan = await this.migrationEngine.createMigrationPlan(this.db, targetVersion)

      // Execute migration plan
      const results = await this.migrationEngine.executeMigrationPlan(this.db, plan, {
        progressCallback: (progress) => {
          console.log(
            `[PGlite] Migration progress: ${progress.percentage.toFixed(1)}% - ${progress.currentStep}`
          )
        }
      })

      const finalVersion = await this.getCurrentSchemaVersion()
      console.log(`[PGlite] Schema migration completed. Final version: v${finalVersion}`)

      return results
    } catch (error) {
      console.error(`[PGlite] Schema migration failed:`, error)
      throw new Error(`Schema migration failed: ${error}`)
    }
  }

  /**
   * Runs pending migrations automatically
   * Supports requirement 5.4 for backward compatibility
   */
  private async runMigrations(): Promise<void> {
    if (!this.migrationEngine) {
      console.warn('[PGlite] Migration engine not initialized, skipping automatic migrations')
      return
    }

    const currentVersion = await this.getCurrentSchemaVersion()
    const targetVersion = PGlitePresenter.CURRENT_SCHEMA_VERSION

    if (currentVersion < targetVersion) {
      console.log(
        `[PGlite] Running automatic migrations from v${currentVersion} to v${targetVersion}`
      )
      const results = await this.migrateSchema(targetVersion)

      const failedMigrations = results.filter((r) => !r.success)
      if (failedMigrations.length > 0) {
        throw new Error(
          `Automatic migration failed: ${failedMigrations.map((r) => r.errors.join(', ')).join('; ')}`
        )
      }
    }
  }

  /**
   * Enhanced data validation and integrity checking
   * Supports requirements 2.4, 9.1, 9.2 for comprehensive validation
   */
  async validateIntegrity(): Promise<ValidationResult> {
    if (!this.dataValidator || !this.schemaManager) {
      throw new Error('Validation components not initialized')
    }

    console.log('[PGlite] Starting comprehensive data validation')

    try {
      // Run database validation
      const validationResult = await this.dataValidator.validateDatabase(this.db)

      // Run schema validation
      const schemaValidation = await this.schemaManager.validateSchema(this.db)

      // Run integrity check
      const integrityCheck = await this.dataValidator.checkDataIntegrity(this.db)

      // Combine results into ValidationResult format
      const result: ValidationResult = {
        isValid: validationResult.isValid && schemaValidation.isValid && integrityCheck.isValid,
        errors: [
          ...validationResult.errors.map((e) => e.message),
          ...schemaValidation.errors,
          ...integrityCheck.issues
            .filter((i) => i.severity === 'critical')
            .map((i) => i.description)
        ],
        warnings: [
          ...validationResult.warnings.map((w) => w.message),
          ...schemaValidation.warnings,
          ...integrityCheck.issues.filter((i) => i.severity === 'major').map((i) => i.description)
        ],
        tableCount: Object.keys(integrityCheck.statistics.totalRecords).length,
        recordCounts: integrityCheck.statistics.totalRecords,
        indexHealth: {}, // Would be populated by index health checks
        schemaVersion: schemaValidation.schemaVersion,
        pendingMigrations: await this.getPendingMigrations(),
        orphanedRecords: integrityCheck.statistics.orphanedRecords,
        constraintViolations: integrityCheck.issues
          .filter((i) => i.type === 'constraint')
          .map((i) => i.description),
        vectorIndexStatus: {
          totalVectors: integrityCheck.statistics.totalRecords.knowledge_vectors || 0,
          indexedVectors: integrityCheck.statistics.totalRecords.knowledge_vectors || 0,
          indexEfficiency: 1.0 // Simplified - would calculate actual efficiency
        }
      }

      console.log(
        `[PGlite] Validation completed. Valid: ${result.isValid}, Errors: ${result.errors.length}, Warnings: ${result.warnings.length}`
      )

      return result
    } catch (error) {
      console.error('[PGlite] Validation failed:', error)
      throw new Error(`Validation failed: ${error}`)
    }
  }

  /**
   * Validates schema compatibility for backward compatibility
   * Supports requirement 5.4 for backward compatibility for at least 2 major versions
   */
  async validateSchemaCompatibility(): Promise<{ compatible: boolean; issues: string[] }> {
    if (!this.schemaManager) {
      throw new Error('Schema manager not initialized')
    }

    const schemaValidation = await this.schemaManager.validateSchema(this.db)
    const currentVersion = schemaValidation.schemaVersion
    const issues: string[] = []

    // Check if current version is within supported range (2 major versions back)
    const minSupportedVersion = Math.max(1, PGlitePresenter.CURRENT_SCHEMA_VERSION - 2)

    if (currentVersion < minSupportedVersion) {
      issues.push(
        `Schema version ${currentVersion} is too old. Minimum supported version is ${minSupportedVersion}`
      )
    }

    if (currentVersion > PGlitePresenter.CURRENT_SCHEMA_VERSION) {
      issues.push(
        `Schema version ${currentVersion} is newer than supported version ${PGlitePresenter.CURRENT_SCHEMA_VERSION}`
      )
    }

    // Add schema validation issues
    issues.push(...schemaValidation.errors)
    issues.push(...schemaValidation.warnings)

    return {
      compatible: issues.length === 0,
      issues
    }
  }

  /**
   * Get pending migrations that need to be applied
   * Supports requirement 5.4 for backward compatibility tracking
   */
  async getPendingMigrations(): Promise<number[]> {
    if (!this.schemaManager) {
      return []
    }

    const pendingMigrations = await this.schemaManager.getPendingMigrations(this.db)
    return pendingMigrations.map((m) => m.version)
  }

  // ==================== Error Recovery ====================

  /**
   * Attempts to recover from database errors by performing various recovery operations
   * This method implements requirement 1.4 for rollback capabilities
   */
  async recoverFromError(error: Error): Promise<boolean> {
    console.log('[PGlite] Attempting error recovery:', error.message)

    try {
      // Step 1: Check if database file exists and is accessible
      if (!fs.existsSync(this.dbPath)) {
        console.error('[PGlite] Database file does not exist, cannot recover')
        return false
      }

      // Step 2: Try to reconnect
      try {
        await this.reconnect()
        console.log('[PGlite] Successfully reconnected during recovery')
        return true
      } catch (reconnectError) {
        console.warn('[PGlite] Reconnection failed during recovery:', reconnectError)
      }

      // Step 3: Check if it's a transaction-related error
      if (this.inTransaction) {
        try {
          await this.rollbackTransaction()
          console.log('[PGlite] Rolled back transaction during recovery')
        } catch (rollbackError) {
          console.warn('[PGlite] Failed to rollback transaction during recovery:', rollbackError)
          this.inTransaction = false // Force reset transaction state
        }
      }

      // Step 4: Try to reinitialize with current config
      if (this.config) {
        try {
          this.isInitialized = false
          this.connectionStatus = 'disconnected'
          await this.initialize(this.config)
          console.log('[PGlite] Successfully reinitialized during recovery')
          return true
        } catch (initError) {
          console.error('[PGlite] Failed to reinitialize during recovery:', initError)
        }
      }

      // Step 5: Validate integrity if we managed to connect
      if (this.isConnected()) {
        const validation = await this.validateIntegrity()
        if (!validation.isValid) {
          console.warn(
            '[PGlite] Database integrity issues found during recovery:',
            validation.errors
          )
          return false
        }
        return true
      }

      console.error('[PGlite] All recovery attempts failed')
      return false
    } catch (recoveryError) {
      console.error('[PGlite] Error during recovery process:', recoveryError)
      return false
    }
  }

  /**
   * Creates a backup of the current database for rollback purposes
   * This supports requirement 1.4 for rollback capabilities
   */
  async createRecoveryBackup(): Promise<string | null> {
    try {
      if (!fs.existsSync(this.dbPath)) {
        console.warn('[PGlite] Cannot create backup: database file does not exist')
        return null
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = `${this.dbPath}.backup.${timestamp}`

      // Copy the database file
      fs.copyFileSync(this.dbPath, backupPath)

      console.log(`[PGlite] Recovery backup created at: ${backupPath}`)
      return backupPath
    } catch (error) {
      console.error('[PGlite] Failed to create recovery backup:', error)
      return null
    }
  }

  /**
   * Restores database from a backup file
   * This supports requirement 1.4 for rollback capabilities
   */
  async restoreFromBackup(backupPath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(backupPath)) {
        console.error('[PGlite] Backup file does not exist:', backupPath)
        return false
      }

      // Close current connection
      if (this.isConnected()) {
        await this.close()
      }

      // Restore from backup
      fs.copyFileSync(backupPath, this.dbPath)

      // Reopen database
      if (this.config) {
        await this.initialize(this.config)
      } else {
        await this.open()
      }

      console.log(`[PGlite] Successfully restored from backup: ${backupPath}`)
      return true
    } catch (error) {
      console.error('[PGlite] Failed to restore from backup:', error)
      return false
    }
  }

  // ==================== Health Checks ====================

  /**
   * Performs a quick health check for monitoring purposes
   * Supports database health monitoring requirements
   */
  async performHealthCheck(): Promise<{
    healthy: boolean
    issues: string[]
    metrics: Record<string, any>
  }> {
    const issues: string[] = []
    const metrics: Record<string, any> = {}

    try {
      // Check connection
      if (!this.isConnected()) {
        issues.push('Database not connected')
        return { healthy: false, issues, metrics }
      }

      // Quick connectivity test
      const startTime = Date.now()
      await this.db.query('SELECT 1')
      metrics.connectionLatency = Date.now() - startTime

      // Check transaction state
      metrics.inTransaction = this.inTransaction

      // Get basic metrics
      const schemaVersion = await this.getCurrentSchemaVersion()
      metrics.schemaVersion = schemaVersion

      // Check if schema is up to date
      if (schemaVersion < PGlitePresenter.CURRENT_SCHEMA_VERSION) {
        issues.push(
          `Schema version ${schemaVersion} is behind current version ${PGlitePresenter.CURRENT_SCHEMA_VERSION}`
        )
      }

      // Quick table existence check
      const criticalTables = ['conversations', 'messages', 'knowledge_files']
      for (const table of criticalTables) {
        try {
          const result = await this.db.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
            [table]
          )
          if (!(result.rows[0] as any).exists) {
            issues.push(`Critical table '${table}' is missing`)
          }
        } catch (error) {
          issues.push(`Failed to check table '${table}': ${error}`)
        }
      }

      metrics.lastHealthCheck = Date.now()
    } catch (error) {
      issues.push(`Health check failed: ${error}`)
    }

    return {
      healthy: issues.length === 0,
      issues,
      metrics
    }
  }

  // ==================== ISQLitePresenter Methods ====================
  // These methods will be fully implemented in task 2.2

  async createConversation(
    _title: string,
    _settings?: Partial<CONVERSATION_SETTINGS>
  ): Promise<string> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async deleteConversation(_conversationId: string): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async renameConversation(_conversationId: string, _title: string): Promise<CONVERSATION> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async getConversation(_conversationId: string): Promise<CONVERSATION> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async updateConversation(_conversationId: string, _data: Partial<CONVERSATION>): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async getConversationList(
    _page: number,
    _pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async getConversationCount(): Promise<number> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async insertMessage(
    _conversationId: string,
    _content: string,
    _role: string,
    _parentId: string,
    _metadata: string,
    _orderSeq: number,
    _tokenCount: number,
    _status: string,
    _isContextEdge: number,
    _isVariant: number
  ): Promise<string> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async queryMessages(_conversationId: string): Promise<Array<SQLITE_MESSAGE>> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async deleteAllMessages(): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async getMessage(_messageId: string): Promise<SQLITE_MESSAGE | null> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async getMessageVariants(_messageId: string): Promise<SQLITE_MESSAGE[]> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async updateMessage(
    _messageId: string,
    _data: {
      content?: string
      status?: string
      metadata?: string
      isContextEdge?: number
      tokenCount?: number
    }
  ): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async deleteMessage(_messageId: string): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async getMaxOrderSeq(_conversationId: string): Promise<number> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async addMessageAttachment(
    _messageId: string,
    _attachmentType: string,
    _attachmentData: string
  ): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async getMessageAttachments(_messageId: string, _type: string): Promise<{ content: string }[]> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async getLastUserMessage(_conversationId: string): Promise<SQLITE_MESSAGE | null> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async getMainMessageByParentId(
    _conversationId: string,
    _parentId: string
  ): Promise<SQLITE_MESSAGE | null> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async deleteAllMessagesInConversation(_conversationId: string): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  // ==================== IVectorDatabasePresenter Methods ====================
  // These methods will be fully implemented in task 2.2

  async destroy(): Promise<void> {
    await this.close()
  }

  async insertVector(_opts: VectorInsertOptions): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async insertVectors(_records: Array<VectorInsertOptions>): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async similarityQuery(_vector: number[], _options: QueryOptions): Promise<QueryResult[]> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async deleteVectorsByFile(_id: string): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async insertFile(_file: KnowledgeFileMessage): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async updateFile(_file: KnowledgeFileMessage): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async queryFile(_id: string): Promise<KnowledgeFileMessage | null> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async queryFiles(_where: Partial<KnowledgeFileMessage>): Promise<KnowledgeFileMessage[]> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async listFiles(): Promise<KnowledgeFileMessage[]> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async deleteFile(_id: string): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async insertChunks(_chunks: KnowledgeChunkMessage[]): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async updateChunkStatus(
    _chunkId: string,
    _status: KnowledgeTaskStatus,
    _error?: string
  ): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async queryChunks(_where: Partial<KnowledgeChunkMessage>): Promise<KnowledgeChunkMessage[]> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async deleteChunksByFile(_fileId: string): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async pauseAllRunningTasks(): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async resumeAllPausedTasks(): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }
}
