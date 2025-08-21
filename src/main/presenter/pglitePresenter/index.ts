/**
 * PGlite Presenter - Unified database presenter for conversational and vector data
 */
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { nanoid } from 'nanoid'
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
import { PGliteSchemaManager } from './schema'
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
  async migrateSchema(targetVersion: number): Promise<void> {
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

      // Log results but don't return them to match interface
      results.forEach((result) => {
        if (result.success) {
          console.log(`[PGlite] Migration v${result.version} completed: ${result.description}`)
        } else {
          console.error(`[PGlite] Migration v${result.version} failed: ${result.errors.join(', ')}`)
        }
      })
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
      try {
        await this.migrateSchema(targetVersion)
        console.log('[PGlite] Automatic migrations completed successfully')
      } catch (error) {
        throw new Error(`Automatic migration failed: ${error}`)
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

  // ==================== Conversation Management Methods ====================
  // Task 4.1: Migrate conversation management methods

  /**
   * Creates a new conversation with the specified title and settings
   * Supports requirements 5.1 and 6.2 for conversation management
   */
  async createConversation(
    title: string,
    settings?: Partial<CONVERSATION_SETTINGS>
  ): Promise<string> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const conversationId = nanoid()
      const now = Date.now()

      // Set default settings
      const defaultSettings: CONVERSATION_SETTINGS = {
        systemPrompt: '',
        temperature: 0.7,
        contextLength: 4000,
        maxTokens: 2000,
        providerId: 'openai',
        modelId: 'gpt-4',
        artifacts: 0,
        enabledMcpTools: undefined,
        thinkingBudget: undefined,
        reasoningEffort: undefined,
        verbosity: undefined
      }

      const finalSettings = { ...defaultSettings, ...settings }

      const query = `
        INSERT INTO conversations (
          conv_id, title, created_at, updated_at, is_pinned, is_new, settings
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `

      await this.db.query(query, [
        conversationId,
        title,
        now,
        now,
        0, // Default is_pinned to 0
        1, // Default is_new to 1
        JSON.stringify(finalSettings)
      ])

      console.log(`[PGlite] Created conversation: ${conversationId}`)
      return conversationId
    } catch (error) {
      console.error('[PGlite] Failed to create conversation:', error)
      throw new Error(`Failed to create conversation: ${error}`)
    }
  }

  /**
   * Deletes a conversation and all associated messages
   * Supports requirements 5.1 and 6.2 for conversation management
   */
  async deleteConversation(conversationId: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      await this.runTransaction(async () => {
        // Delete message attachments first
        await this.db.query(
          `DELETE FROM message_attachments 
           WHERE message_id IN (
             SELECT msg_id FROM messages WHERE conversation_id = $1
           )`,
          [conversationId]
        )

        // Delete messages
        await this.db.query('DELETE FROM messages WHERE conversation_id = $1', [conversationId])

        // Delete conversation
        const result = await this.db.query('DELETE FROM conversations WHERE conv_id = $1', [
          conversationId
        ])

        if (result.affectedRows === 0) {
          throw new Error(`Conversation ${conversationId} not found`)
        }
      })

      console.log(`[PGlite] Deleted conversation: ${conversationId}`)
    } catch (error) {
      console.error('[PGlite] Failed to delete conversation:', error)
      throw new Error(`Failed to delete conversation: ${error}`)
    }
  }

  /**
   * Renames a conversation and returns the updated conversation
   * Supports requirements 5.1 and 6.2 for conversation management
   */
  async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const now = Date.now()

      const result = await this.db.query(
        `UPDATE conversations 
         SET title = $1, is_new = 0, updated_at = $2 
         WHERE conv_id = $3`,
        [title, now, conversationId]
      )

      if (result.affectedRows === 0) {
        throw new Error(`Conversation ${conversationId} not found`)
      }

      console.log(`[PGlite] Renamed conversation: ${conversationId}`)
      return await this.getConversation(conversationId)
    } catch (error) {
      console.error('[PGlite] Failed to rename conversation:', error)
      throw new Error(`Failed to rename conversation: ${error}`)
    }
  }

  /**
   * Retrieves a conversation by ID
   * Supports requirements 5.1 and 6.2 for conversation management
   */
  async getConversation(conversationId: string): Promise<CONVERSATION> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const result = await this.db.query(
        `SELECT conv_id as id, title, created_at, updated_at, is_pinned, is_new, settings
         FROM conversations 
         WHERE conv_id = $1`,
        [conversationId]
      )

      if (result.rows.length === 0) {
        throw new Error(`Conversation ${conversationId} not found`)
      }

      const row = result.rows[0] as any
      let settings: CONVERSATION_SETTINGS

      try {
        settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings
      } catch (error) {
        console.warn(`[PGlite] Failed to parse settings for conversation ${conversationId}:`, error)
        // Fallback to default settings
        settings = {
          systemPrompt: '',
          temperature: 0.7,
          contextLength: 4000,
          maxTokens: 2000,
          providerId: 'openai',
          modelId: 'gpt-4',
          artifacts: 0
        }
      }

      return {
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        is_pinned: row.is_pinned,
        is_new: row.is_new,
        settings
      }
    } catch (error) {
      console.error('[PGlite] Failed to get conversation:', error)
      throw new Error(`Failed to get conversation: ${error}`)
    }
  }

  /**
   * Updates a conversation with partial data
   * Supports requirements 5.1 and 6.2 for conversation management
   */
  async updateConversation(conversationId: string, data: Partial<CONVERSATION>): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const updates: string[] = []
      const params: any[] = []
      let paramIndex = 1

      if (data.title !== undefined) {
        updates.push(`title = $${paramIndex++}`)
        params.push(data.title)
      }

      if (data.is_new !== undefined) {
        updates.push(`is_new = $${paramIndex++}`)
        params.push(data.is_new)
      }

      if (data.is_pinned !== undefined) {
        updates.push(`is_pinned = $${paramIndex++}`)
        params.push(data.is_pinned)
      }

      if (data.settings !== undefined) {
        // Get current conversation to merge settings
        const current = await this.getConversation(conversationId)
        const mergedSettings = { ...current.settings, ...data.settings }
        updates.push(`settings = $${paramIndex++}`)
        params.push(JSON.stringify(mergedSettings))
      }

      if (updates.length > 0) {
        updates.push(`updated_at = $${paramIndex++}`)
        params.push(data.updatedAt || Date.now())

        params.push(conversationId) // Add conversationId as the last parameter

        const query = `UPDATE conversations SET ${updates.join(', ')} WHERE conv_id = $${paramIndex}`
        const result = await this.db.query(query, params)

        if (result.affectedRows === 0) {
          throw new Error(`Conversation ${conversationId} not found`)
        }

        console.log(`[PGlite] Updated conversation: ${conversationId}`)
      }
    } catch (error) {
      console.error('[PGlite] Failed to update conversation:', error)
      throw new Error(`Failed to update conversation: ${error}`)
    }
  }

  /**
   * Retrieves a paginated list of conversations
   * Supports requirements 5.1 and 6.2 for conversation management
   */
  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const offset = (page - 1) * pageSize

      // Get total count
      const countResult = await this.db.query('SELECT COUNT(*) as count FROM conversations')
      const total = (countResult.rows[0] as any).count

      // Get paginated results
      const result = await this.db.query(
        `SELECT conv_id as id, title, created_at, updated_at, is_pinned, is_new, settings
         FROM conversations 
         ORDER BY updated_at DESC 
         LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      )

      const list: CONVERSATION[] = result.rows.map((row: any) => {
        let settings: CONVERSATION_SETTINGS

        try {
          settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings
        } catch (error) {
          console.warn(`[PGlite] Failed to parse settings for conversation ${row.id}:`, error)
          // Fallback to default settings
          settings = {
            systemPrompt: '',
            temperature: 0.7,
            contextLength: 4000,
            maxTokens: 2000,
            providerId: 'openai',
            modelId: 'gpt-4',
            artifacts: 0
          }
        }

        return {
          id: row.id,
          title: row.title,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          is_pinned: row.is_pinned,
          is_new: row.is_new,
          settings
        }
      })

      return { total, list }
    } catch (error) {
      console.error('[PGlite] Failed to get conversation list:', error)
      throw new Error(`Failed to get conversation list: ${error}`)
    }
  }

  /**
   * Gets the total count of conversations
   * Supports requirements 5.1 and 6.2 for conversation management
   */
  async getConversationCount(): Promise<number> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const result = await this.db.query('SELECT COUNT(*) as count FROM conversations')
      return (result.rows[0] as any).count
    } catch (error) {
      console.error('[PGlite] Failed to get conversation count:', error)
      throw new Error(`Failed to get conversation count: ${error}`)
    }
  }

  // ==================== Message Operations and Relationships ====================
  // Task 4.2: Migrate message operations and relationships

  /**
   * Inserts a new message into the database
   * Supports requirements 5.1 and 6.2 for message operations
   */
  async insertMessage(
    conversationId: string,
    content: string,
    role: string,
    parentId: string,
    metadata: string = '{}',
    orderSeq: number = 0,
    tokenCount: number = 0,
    status: string = 'pending',
    isContextEdge: number = 0,
    isVariant: number = 0
  ): Promise<string> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const messageId = nanoid()
      const now = Date.now()

      const query = `
        INSERT INTO messages (
          msg_id, conversation_id, parent_id, content, role, created_at,
          order_seq, token_count, status, metadata, is_context_edge, is_variant
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `

      await this.db.query(query, [
        messageId,
        conversationId,
        parentId,
        content,
        role,
        now,
        orderSeq,
        tokenCount,
        status,
        metadata,
        isContextEdge,
        isVariant
      ])

      console.log(`[PGlite] Inserted message: ${messageId}`)
      return messageId
    } catch (error) {
      console.error('[PGlite] Failed to insert message:', error)
      throw new Error(`Failed to insert message: ${error}`)
    }
  }

  /**
   * Updates an existing message with partial data
   * Supports requirements 5.1 and 6.2 for message operations
   */
  async updateMessage(
    messageId: string,
    data: {
      content?: string
      status?: string
      metadata?: string
      isContextEdge?: number
      tokenCount?: number
    }
  ): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const updates: string[] = []
      const params: any[] = []
      let paramIndex = 1

      if (data.content !== undefined) {
        updates.push(`content = $${paramIndex++}`)
        params.push(data.content)
      }

      if (data.status !== undefined) {
        updates.push(`status = $${paramIndex++}`)
        params.push(data.status)
      }

      if (data.metadata !== undefined) {
        updates.push(`metadata = $${paramIndex++}`)
        params.push(data.metadata)
      }

      if (data.isContextEdge !== undefined) {
        updates.push(`is_context_edge = $${paramIndex++}`)
        params.push(data.isContextEdge)
      }

      if (data.tokenCount !== undefined) {
        updates.push(`token_count = $${paramIndex++}`)
        params.push(data.tokenCount)
      }

      if (updates.length > 0) {
        params.push(messageId) // Add messageId as the last parameter

        const query = `UPDATE messages SET ${updates.join(', ')} WHERE msg_id = $${paramIndex}`
        const result = await this.db.query(query, params)

        if (result.affectedRows === 0) {
          throw new Error(`Message ${messageId} not found`)
        }

        console.log(`[PGlite] Updated message: ${messageId}`)
      }
    } catch (error) {
      console.error('[PGlite] Failed to update message:', error)
      throw new Error(`Failed to update message: ${error}`)
    }
  }

  /**
   * Deletes a message and its attachments
   * Supports requirements 5.1 and 6.2 for message operations
   */
  async deleteMessage(messageId: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      await this.runTransaction(async () => {
        // Delete message attachments first
        await this.db.query('DELETE FROM message_attachments WHERE message_id = $1', [messageId])

        // Delete the message
        const result = await this.db.query('DELETE FROM messages WHERE msg_id = $1', [messageId])

        if (result.affectedRows === 0) {
          throw new Error(`Message ${messageId} not found`)
        }
      })

      console.log(`[PGlite] Deleted message: ${messageId}`)
    } catch (error) {
      console.error('[PGlite] Failed to delete message:', error)
      throw new Error(`Failed to delete message: ${error}`)
    }
  }

  /**
   * Queries all messages for a conversation with variant handling
   * Supports requirements 5.1 and 6.2 for message operations and parent-child relationships
   */
  async queryMessages(conversationId: string): Promise<Array<SQLITE_MESSAGE>> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      // First get all non-variant messages
      const mainMessagesResult = await this.db.query(
        `SELECT 
           msg_id as id, conversation_id, parent_id, content, role, created_at, 
           order_seq, token_count, status, metadata, is_context_edge, is_variant
         FROM messages 
         WHERE conversation_id = $1 AND is_variant != 1
         ORDER BY created_at ASC, order_seq ASC`,
        [conversationId]
      )

      const mainMessages = mainMessagesResult.rows as SQLITE_MESSAGE[]

      // For each assistant message, get its variants
      const messagesWithVariants = await Promise.all(
        mainMessages.map(async (msg) => {
          if (msg.role === 'assistant' && msg.parent_id !== '') {
            const variantsResult = await this.db.query(
              `SELECT 
                 msg_id as id, conversation_id, parent_id, content, role, created_at,
                 order_seq, token_count, status, metadata, is_context_edge, is_variant
               FROM messages 
               WHERE parent_id = $1 AND is_variant = 1
               ORDER BY created_at ASC`,
              [msg.parent_id]
            )

            const variants = variantsResult.rows as SQLITE_MESSAGE[]
            if (variants.length > 0) {
              return { ...msg, variants }
            }
          }
          return msg
        })
      )

      return messagesWithVariants
    } catch (error) {
      console.error('[PGlite] Failed to query messages:', error)
      throw new Error(`Failed to query messages: ${error}`)
    }
  }

  /**
   * Gets a single message by ID
   * Supports requirements 5.1 and 6.2 for message operations
   */
  async getMessage(messageId: string): Promise<SQLITE_MESSAGE | null> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const result = await this.db.query(
        `SELECT 
           msg_id as id, conversation_id, parent_id, content, role, created_at,
           order_seq, token_count, status, metadata, is_context_edge, is_variant
         FROM messages 
         WHERE msg_id = $1`,
        [messageId]
      )

      return result.rows.length > 0 ? (result.rows[0] as SQLITE_MESSAGE) : null
    } catch (error) {
      console.error('[PGlite] Failed to get message:', error)
      throw new Error(`Failed to get message: ${error}`)
    }
  }

  /**
   * Gets message variants for a given message
   * Supports requirements 5.1 and 6.2 for message variant handling
   */
  async getMessageVariants(messageId: string): Promise<SQLITE_MESSAGE[]> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const result = await this.db.query(
        `SELECT 
           msg_id as id, conversation_id, parent_id, content, role, created_at,
           order_seq, token_count, status, metadata, is_context_edge, is_variant
         FROM messages 
         WHERE parent_id = $1
         ORDER BY created_at ASC`,
        [messageId]
      )

      return result.rows as SQLITE_MESSAGE[]
    } catch (error) {
      console.error('[PGlite] Failed to get message variants:', error)
      throw new Error(`Failed to get message variants: ${error}`)
    }
  }

  /**
   * Gets the maximum order sequence for a conversation
   * Supports requirements 5.1 and 6.2 for message ordering
   */
  async getMaxOrderSeq(conversationId: string): Promise<number> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const result = await this.db.query(
        'SELECT MAX(order_seq) as max_seq FROM messages WHERE conversation_id = $1',
        [conversationId]
      )

      return (result.rows[0] as any)?.max_seq || 0
    } catch (error) {
      console.error('[PGlite] Failed to get max order sequence:', error)
      throw new Error(`Failed to get max order sequence: ${error}`)
    }
  }

  /**
   * Gets the last user message in a conversation
   * Supports requirements 5.1 and 6.2 for message operations
   */
  async getLastUserMessage(conversationId: string): Promise<SQLITE_MESSAGE | null> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const result = await this.db.query(
        `SELECT 
           msg_id as id, conversation_id, parent_id, content, role, created_at,
           order_seq, token_count, status, metadata, is_context_edge, is_variant
         FROM messages 
         WHERE conversation_id = $1 AND role = 'user'
         ORDER BY created_at DESC 
         LIMIT 1`,
        [conversationId]
      )

      return result.rows.length > 0 ? (result.rows[0] as SQLITE_MESSAGE) : null
    } catch (error) {
      console.error('[PGlite] Failed to get last user message:', error)
      throw new Error(`Failed to get last user message: ${error}`)
    }
  }

  /**
   * Gets the main message by parent ID with variants
   * Supports requirements 5.1 and 6.2 for parent-child relationship management
   */
  async getMainMessageByParentId(
    conversationId: string,
    parentId: string
  ): Promise<SQLITE_MESSAGE | null> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      // Get the main message (non-variant)
      const mainResult = await this.db.query(
        `SELECT 
           msg_id as id, conversation_id, parent_id, content, role, created_at,
           order_seq, token_count, status, metadata, is_context_edge, is_variant
         FROM messages 
         WHERE conversation_id = $1 AND parent_id = $2 AND is_variant = 0
         ORDER BY created_at ASC 
         LIMIT 1`,
        [conversationId, parentId]
      )

      if (mainResult.rows.length === 0) {
        return null
      }

      const mainMessage = mainResult.rows[0] as SQLITE_MESSAGE

      // Get variants for this message
      const variantsResult = await this.db.query(
        `SELECT 
           msg_id as id, conversation_id, parent_id, content, role, created_at,
           order_seq, token_count, status, metadata, is_context_edge, is_variant
         FROM messages 
         WHERE conversation_id = $1 AND parent_id = $2 AND is_variant = 1
         ORDER BY created_at ASC`,
        [conversationId, parentId]
      )

      const variants = variantsResult.rows as SQLITE_MESSAGE[]
      if (variants.length > 0) {
        mainMessage.variants = variants
      }

      return mainMessage
    } catch (error) {
      console.error('[PGlite] Failed to get main message by parent ID:', error)
      throw new Error(`Failed to get main message by parent ID: ${error}`)
    }
  }

  /**
   * Deletes all messages (for cleanup operations)
   * Supports requirements 5.1 and 6.2 for message operations
   */
  async deleteAllMessages(): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      await this.runTransaction(async () => {
        // Delete all message attachments first
        await this.db.query('DELETE FROM message_attachments')

        // Delete all messages
        await this.db.query('DELETE FROM messages')
      })

      console.log('[PGlite] Deleted all messages')
    } catch (error) {
      console.error('[PGlite] Failed to delete all messages:', error)
      throw new Error(`Failed to delete all messages: ${error}`)
    }
  }

  /**
   * Deletes all messages in a specific conversation
   * Supports requirements 5.1 and 6.2 for message operations
   */
  async deleteAllMessagesInConversation(conversationId: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      await this.runTransaction(async () => {
        // Delete message attachments for this conversation
        await this.db.query(
          `DELETE FROM message_attachments 
           WHERE message_id IN (
             SELECT msg_id FROM messages WHERE conversation_id = $1
           )`,
          [conversationId]
        )

        // Delete messages for this conversation
        await this.db.query('DELETE FROM messages WHERE conversation_id = $1', [conversationId])
      })

      console.log(`[PGlite] Deleted all messages in conversation: ${conversationId}`)
    } catch (error) {
      console.error('[PGlite] Failed to delete all messages in conversation:', error)
      throw new Error(`Failed to delete all messages in conversation: ${error}`)
    }
  }

  // ==================== Message Attachment and Metadata Handling ====================
  // Task 4.3: Add message attachment and metadata handling

  /**
   * Adds an attachment to a message
   * Supports requirements 5.1 and 5.5 for message attachment operations and JSONB metadata storage
   */
  async addMessageAttachment(
    messageId: string,
    attachmentType: string,
    attachmentData: string
  ): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const now = Date.now()

      const query = `
        INSERT INTO message_attachments (message_id, attachment_type, attachment_data, created_at)
        VALUES ($1, $2, $3, $4)
      `

      await this.db.query(query, [messageId, attachmentType, attachmentData, now])

      console.log(`[PGlite] Added attachment to message: ${messageId}`)
    } catch (error) {
      console.error('[PGlite] Failed to add message attachment:', error)
      throw new Error(`Failed to add message attachment: ${error}`)
    }
  }

  /**
   * Gets attachments for a message by type
   * Supports requirements 5.1 and 5.5 for message attachment operations
   */
  async getMessageAttachments(messageId: string, type: string): Promise<{ content: string }[]> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const result = await this.db.query(
        `SELECT attachment_data as content 
         FROM message_attachments 
         WHERE message_id = $1 AND attachment_type = $2
         ORDER BY created_at ASC`,
        [messageId, type]
      )

      return result.rows as { content: string }[]
    } catch (error) {
      console.error('[PGlite] Failed to get message attachments:', error)
      throw new Error(`Failed to get message attachments: ${error}`)
    }
  }

  /**
   * Gets all attachments for a message (all types)
   * Supports requirements 5.1 and 5.5 for comprehensive attachment retrieval
   */
  async getAllMessageAttachments(messageId: string): Promise<
    Array<{
      id: number
      type: string
      content: string
      createdAt: number
    }>
  > {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const result = await this.db.query(
        `SELECT id, attachment_type as type, attachment_data as content, created_at
         FROM message_attachments 
         WHERE message_id = $1
         ORDER BY created_at ASC`,
        [messageId]
      )

      return result.rows as Array<{
        id: number
        type: string
        content: string
        createdAt: number
      }>
    } catch (error) {
      console.error('[PGlite] Failed to get all message attachments:', error)
      throw new Error(`Failed to get all message attachments: ${error}`)
    }
  }

  /**
   * Deletes a specific attachment by ID
   * Supports requirements 5.1 and 5.5 for attachment management
   */
  async deleteMessageAttachment(attachmentId: number): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const result = await this.db.query('DELETE FROM message_attachments WHERE id = $1', [
        attachmentId
      ])

      if (result.affectedRows === 0) {
        throw new Error(`Attachment ${attachmentId} not found`)
      }

      console.log(`[PGlite] Deleted attachment: ${attachmentId}`)
    } catch (error) {
      console.error('[PGlite] Failed to delete message attachment:', error)
      throw new Error(`Failed to delete message attachment: ${error}`)
    }
  }

  /**
   * Deletes all attachments for a message
   * Supports requirements 5.1 and 5.5 for attachment cleanup
   */
  async deleteAllMessageAttachments(messageId: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      await this.db.query('DELETE FROM message_attachments WHERE message_id = $1', [messageId])

      console.log(`[PGlite] Deleted all attachments for message: ${messageId}`)
    } catch (error) {
      console.error('[PGlite] Failed to delete all message attachments:', error)
      throw new Error(`Failed to delete all message attachments: ${error}`)
    }
  }

  /**
   * Updates message metadata with JSONB support
   * Supports requirements 5.1 and 5.5 for JSONB metadata storage and querying
   */
  async updateMessageMetadata(messageId: string, metadata: Record<string, any>): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      // Convert metadata to JSON string for compatibility with existing interface
      const metadataJson = JSON.stringify(metadata)

      const result = await this.db.query('UPDATE messages SET metadata = $1 WHERE msg_id = $2', [
        metadataJson,
        messageId
      ])

      if (result.affectedRows === 0) {
        throw new Error(`Message ${messageId} not found`)
      }

      console.log(`[PGlite] Updated metadata for message: ${messageId}`)
    } catch (error) {
      console.error('[PGlite] Failed to update message metadata:', error)
      throw new Error(`Failed to update message metadata: ${error}`)
    }
  }

  /**
   * Queries messages by metadata criteria using JSONB operations
   * Supports requirements 5.1 and 5.5 for JSONB metadata querying
   */
  async queryMessagesByMetadata(
    conversationId: string,
    metadataQuery: Record<string, any>
  ): Promise<SQLITE_MESSAGE[]> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      // For PostgreSQL JSONB queries, we can use the @> operator for containment
      // However, since we're storing as TEXT for compatibility, we'll use a simple JSON search
      const metadataJson = JSON.stringify(metadataQuery)

      const result = await this.db.query(
        `SELECT 
           msg_id as id, conversation_id, parent_id, content, role, created_at,
           order_seq, token_count, status, metadata, is_context_edge, is_variant
         FROM messages 
         WHERE conversation_id = $1 AND metadata::jsonb @> $2::jsonb
         ORDER BY created_at ASC`,
        [conversationId, metadataJson]
      )

      return result.rows as SQLITE_MESSAGE[]
    } catch (error) {
      // Fallback to text-based search if JSONB operations fail
      console.warn('[PGlite] JSONB query failed, falling back to text search:', error)

      try {
        // Simple text-based search as fallback
        const searchTerms = Object.entries(metadataQuery).map(([key, value]) => {
          return `"${key}":"${value}"`
        })

        let query = `SELECT 
           msg_id as id, conversation_id, parent_id, content, role, created_at,
           order_seq, token_count, status, metadata, is_context_edge, is_variant
         FROM messages 
         WHERE conversation_id = $1`

        const params: any[] = [conversationId]

        searchTerms.forEach((term, index) => {
          query += ` AND metadata LIKE $${index + 2}`
          params.push(`%${term}%`)
        })

        query += ' ORDER BY created_at ASC'

        const fallbackResult = await this.db.query(query, params)
        return fallbackResult.rows as SQLITE_MESSAGE[]
      } catch (fallbackError) {
        console.error('[PGlite] Failed to query messages by metadata:', fallbackError)
        throw new Error(`Failed to query messages by metadata: ${fallbackError}`)
      }
    }
  }

  /**
   * Gets message metadata as a parsed object
   * Supports requirements 5.1 and 5.5 for metadata retrieval
   */
  async getMessageMetadata(messageId: string): Promise<Record<string, any> | null> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const result = await this.db.query('SELECT metadata FROM messages WHERE msg_id = $1', [
        messageId
      ])

      if (result.rows.length === 0) {
        return null
      }

      const metadataString = (result.rows[0] as any).metadata
      if (!metadataString) {
        return {}
      }

      try {
        return JSON.parse(metadataString)
      } catch (parseError) {
        console.warn(`[PGlite] Failed to parse metadata for message ${messageId}:`, parseError)
        return {}
      }
    } catch (error) {
      console.error('[PGlite] Failed to get message metadata:', error)
      throw new Error(`Failed to get message metadata: ${error}`)
    }
  }

  /**
   * Merges additional metadata into existing message metadata
   * Supports requirements 5.1 and 5.5 for metadata management
   */
  async mergeMessageMetadata(
    messageId: string,
    additionalMetadata: Record<string, any>
  ): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      // Get existing metadata
      const existingMetadata = (await this.getMessageMetadata(messageId)) || {}

      // Merge with additional metadata
      const mergedMetadata = { ...existingMetadata, ...additionalMetadata }

      // Update the message
      await this.updateMessageMetadata(messageId, mergedMetadata)

      console.log(`[PGlite] Merged metadata for message: ${messageId}`)
    } catch (error) {
      console.error('[PGlite] Failed to merge message metadata:', error)
      throw new Error(`Failed to merge message metadata: ${error}`)
    }
  }

  // ==================== IVectorDatabasePresenter Methods ====================
  // These methods will be fully implemented in task 2.2

  async destroy(): Promise<void> {
    await this.close()
  }

  /**
   * Insert a single vector embedding into the database
   * Supports requirements 4.1, 4.2, 4.3, 4.4 for vector storage and search
   */
  async insertVector(opts: VectorInsertOptions): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      // Verify that the file exists
      const file = await this.queryFile(opts.fileId)
      if (!file) {
        throw new Error(`File with ID ${opts.fileId} does not exist`)
      }

      const query = `
        INSERT INTO knowledge_vectors (
          id, file_id, chunk_id, embedding, created_at
        ) VALUES ($1, $2, $3, $4, $5)
      `

      const vectorId = nanoid()
      const now = Date.now()

      await this.db.query(query, [
        vectorId,
        opts.fileId,
        opts.chunkId,
        `[${opts.vector.join(',')}]`, // Store as pgvector format
        now
      ])

      console.log(`[PGlite] Inserted vector: ${vectorId} for chunk: ${opts.chunkId}`)
    } catch (error) {
      console.error('[PGlite] Failed to insert vector:', error)
      throw new Error(`Failed to insert vector: ${error}`)
    }
  }

  /**
   * Batch insert multiple vector embeddings for performance optimization
   * Supports requirements 4.1, 4.2, 4.3, 4.4 for vector storage and search
   */
  async insertVectors(records: Array<VectorInsertOptions>): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    if (!records.length) {
      return
    }

    try {
      // Use batch insert for performance optimization
      const valuesSql = records
        .map((_, index) => {
          const baseIndex = index * 5
          return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5})`
        })
        .join(', ')

      const query = `
        INSERT INTO knowledge_vectors (
          id, file_id, chunk_id, embedding, created_at
        ) VALUES ${valuesSql}
      `

      const params: any[] = []
      const now = Date.now()

      for (const record of records) {
        params.push(
          nanoid(),
          record.fileId,
          record.chunkId,
          `[${record.vector.join(',')}]`, // Store as pgvector format
          now
        )
      }

      await this.db.query(query, params)

      console.log(`[PGlite] Inserted ${records.length} vectors`)
    } catch (error) {
      console.error('[PGlite] Failed to insert vectors:', error)
      throw new Error(`Failed to insert vectors: ${error}`)
    }
  }

  /**
   * Perform similarity search using pgvector for cosine, L2, and inner product metrics
   * Supports requirements 4.1, 4.2, 4.3, 4.4 for vector search capabilities
   */
  async similarityQuery(vector: number[], options: QueryOptions): Promise<QueryResult[]> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      // Determine the distance function and operator based on metric
      let distanceFunction: string
      let orderDirection: string

      switch (options.metric) {
        case 'cosine':
          distanceFunction = 'embedding <=> $1' // Cosine distance operator
          orderDirection = 'ASC' // Lower distance = more similar
          break
        case 'l2':
          distanceFunction = 'embedding <-> $1' // L2 distance operator
          orderDirection = 'ASC' // Lower distance = more similar
          break
        case 'ip':
          distanceFunction = 'embedding <#> $1' // Inner product operator (negative)
          orderDirection = 'ASC' // pgvector returns negative inner product, so ASC for highest similarity
          break
        default:
          throw new Error(`Unsupported metric type: ${options.metric}`)
      }

      const query = `
        SELECT 
          v.id,
          ${distanceFunction} AS distance,
          c.content,
          f.name,
          f.path
        FROM knowledge_vectors v
        LEFT JOIN knowledge_chunks c ON c.id = v.chunk_id
        LEFT JOIN knowledge_files f ON f.id = v.file_id
        ORDER BY distance ${orderDirection}
        LIMIT $2
      `

      // Convert vector to pgvector format (array string)
      const vectorString = `[${vector.join(',')}]`

      const result = await this.db.query(query, [vectorString, options.topK])

      return result.rows.map((row: any) => ({
        id: row.id,
        metadata: {
          from: row.name || 'Unknown',
          filePath: row.path || '',
          content: row.content || ''
        },
        distance: Number(row.distance)
      }))
    } catch (error) {
      console.error('[PGlite] Failed to perform similarity query:', error)
      throw new Error(`Failed to perform similarity query: ${error}`)
    }
  }

  /**
   * Delete all vector embeddings associated with a file
   * Supports requirements 4.1, 4.2, 4.3, 4.4 for vector storage and search
   */
  async deleteVectorsByFile(id: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const result = await this.db.query(`DELETE FROM knowledge_vectors WHERE file_id = $1`, [id])

      console.log(`[PGlite] Deleted ${result.affectedRows} vectors for file: ${id}`)
    } catch (error) {
      console.error('[PGlite] Failed to delete vectors by file:', error)
      throw new Error(`Failed to delete vectors by file: ${error}`)
    }
  }

  /**
   * Insert a new knowledge file into the database
   * Supports requirements 4.1, 4.2, 5.2 for knowledge file management
   */
  async insertFile(file: KnowledgeFileMessage): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const query = `
        INSERT INTO knowledge_files (
          id, name, path, mime_type, status, uploaded_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `

      await this.db.query(query, [
        file.id,
        file.name,
        file.path,
        file.mimeType,
        file.status,
        file.uploadedAt,
        JSON.stringify(file.metadata)
      ])

      console.log(`[PGlite] Inserted knowledge file: ${file.id}`)
    } catch (error) {
      console.error('[PGlite] Failed to insert knowledge file:', error)
      throw new Error(`Failed to insert knowledge file: ${error}`)
    }
  }

  /**
   * Update an existing knowledge file in the database
   * Supports requirements 4.1, 4.2, 5.2 for knowledge file management
   */
  async updateFile(file: KnowledgeFileMessage): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const query = `
        UPDATE knowledge_files
        SET name = $2, path = $3, mime_type = $4, status = $5, uploaded_at = $6, metadata = $7
        WHERE id = $1
      `

      const result = await this.db.query(query, [
        file.id,
        file.name,
        file.path,
        file.mimeType,
        file.status,
        file.uploadedAt,
        JSON.stringify(file.metadata)
      ])

      if (result.affectedRows === 0) {
        throw new Error(`Knowledge file with ID ${file.id} not found`)
      }

      console.log(`[PGlite] Updated knowledge file: ${file.id}`)
    } catch (error) {
      console.error('[PGlite] Failed to update knowledge file:', error)
      throw new Error(`Failed to update knowledge file: ${error}`)
    }
  }

  /**
   * Query a single knowledge file by ID
   * Supports requirements 4.1, 4.2, 5.2 for knowledge file management
   */
  async queryFile(id: string): Promise<KnowledgeFileMessage | null> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const query = `SELECT * FROM knowledge_files WHERE id = $1`
      const result = await this.db.query(query, [id])

      if (result.rows.length === 0) {
        return null
      }

      const row = result.rows[0] as any
      return this.toKnowledgeFileMessage(row)
    } catch (error) {
      console.error('[PGlite] Failed to query knowledge file:', error)
      throw new Error(`Failed to query knowledge file: ${error}`)
    }
  }

  /**
   * Query knowledge files by partial match conditions
   * Supports requirements 4.1, 4.2, 5.2 for knowledge file management
   */
  async queryFiles(where: Partial<KnowledgeFileMessage>): Promise<KnowledgeFileMessage[]> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      // Convert camelCase to snake_case for database column names
      const camelToSnake = (key: string) =>
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

      const entries = Object.entries(where).filter(([, value]) => value !== undefined)

      let query = `SELECT * FROM knowledge_files`
      const params: any[] = []

      if (entries.length > 0) {
        const conditions = entries
          .map(([key], index) => {
            const columnName = camelToSnake(key)
            return `${columnName} = $${index + 1}`
          })
          .join(' AND ')
        query += ` WHERE ${conditions}`
        params.push(
          ...entries.map(([, value]) => {
            // Handle metadata field specially since it's stored as JSONB
            if (typeof value === 'object' && value !== null) {
              return JSON.stringify(value)
            }
            return value
          })
        )
      }

      query += ` ORDER BY uploaded_at DESC`

      const result = await this.db.query(query, params)
      return result.rows.map((row: any) => this.toKnowledgeFileMessage(row))
    } catch (error) {
      console.error('[PGlite] Failed to query knowledge files:', error)
      throw new Error(`Failed to query knowledge files: ${error}`)
    }
  }

  /**
   * List all knowledge files in the database
   * Supports requirements 4.1, 4.2, 5.2 for knowledge file management
   */
  async listFiles(): Promise<KnowledgeFileMessage[]> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const query = `SELECT * FROM knowledge_files ORDER BY uploaded_at DESC`
      const result = await this.db.query(query)
      return result.rows.map((row: any) => this.toKnowledgeFileMessage(row))
    } catch (error) {
      console.error('[PGlite] Failed to list knowledge files:', error)
      throw new Error(`Failed to list knowledge files: ${error}`)
    }
  }

  /**
   * Delete a knowledge file and all associated chunks and vectors
   * Supports requirements 4.1, 4.2, 5.2 for knowledge file management
   */
  async deleteFile(id: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      await this.runTransaction(async () => {
        // Delete in order: vectors -> chunks -> file (due to foreign key constraints)
        await this.db.query(`DELETE FROM knowledge_vectors WHERE file_id = $1`, [id])
        await this.db.query(`DELETE FROM knowledge_chunks WHERE file_id = $1`, [id])

        const result = await this.db.query(`DELETE FROM knowledge_files WHERE id = $1`, [id])

        if (result.affectedRows === 0) {
          throw new Error(`Knowledge file with ID ${id} not found`)
        }
      })

      console.log(`[PGlite] Deleted knowledge file and associated data: ${id}`)
    } catch (error) {
      console.error('[PGlite] Failed to delete knowledge file:', error)
      throw new Error(`Failed to delete knowledge file: ${error}`)
    }
  }

  /**
   * Batch insert knowledge chunks into the database
   * Supports requirements 4.1, 4.2, 5.2 for knowledge chunk management
   */
  async insertChunks(chunks: KnowledgeChunkMessage[]): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    if (!chunks.length) {
      return
    }

    try {
      // Use batch insert for performance optimization
      const valuesSql = chunks
        .map((_, index) => {
          const baseIndex = index * 6
          return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6})`
        })
        .join(', ')

      const query = `
        INSERT INTO knowledge_chunks (
          id, file_id, chunk_index, content, status, error
        ) VALUES ${valuesSql}
      `

      const params: any[] = []
      for (const chunk of chunks) {
        params.push(
          chunk.id,
          chunk.fileId,
          chunk.chunkIndex,
          chunk.content,
          chunk.status,
          chunk.error ?? ''
        )
      }

      await this.db.query(query, params)

      console.log(`[PGlite] Inserted ${chunks.length} knowledge chunks`)
    } catch (error) {
      console.error('[PGlite] Failed to insert knowledge chunks:', error)
      throw new Error(`Failed to insert knowledge chunks: ${error}`)
    }
  }

  /**
   * Update the status of a knowledge chunk
   * Supports requirements 4.1, 4.2, 5.2 for knowledge chunk management
   */
  async updateChunkStatus(
    chunkId: string,
    status: KnowledgeTaskStatus,
    error?: string
  ): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      const query = `
        UPDATE knowledge_chunks
        SET status = $2, error = $3
        WHERE id = $1
      `

      const result = await this.db.query(query, [chunkId, status, error ?? ''])

      if (result.affectedRows === 0) {
        throw new Error(`Knowledge chunk with ID ${chunkId} not found`)
      }

      console.log(`[PGlite] Updated chunk status: ${chunkId} -> ${status}`)
    } catch (error) {
      console.error('[PGlite] Failed to update chunk status:', error)
      throw new Error(`Failed to update chunk status: ${error}`)
    }
  }

  /**
   * Query knowledge chunks by partial match conditions
   * Supports requirements 4.1, 4.2, 5.2 for knowledge chunk management
   */
  async queryChunks(where: Partial<KnowledgeChunkMessage>): Promise<KnowledgeChunkMessage[]> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      // Convert camelCase to snake_case for database column names
      const camelToSnake = (key: string) =>
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

      const entries = Object.entries(where).filter(([, value]) => value !== undefined)

      let query = `SELECT * FROM knowledge_chunks`
      const params: any[] = []

      if (entries.length > 0) {
        const conditions = entries
          .map(([key], index) => {
            const columnName = camelToSnake(key)
            return `${columnName} = $${index + 1}`
          })
          .join(' AND ')
        query += ` WHERE ${conditions}`
        params.push(...entries.map(([, value]) => value))
      }

      query += ` ORDER BY chunk_index ASC`

      const result = await this.db.query(query, params)
      return result.rows.map((row: any) => this.toKnowledgeChunkMessage(row))
    } catch (error) {
      console.error('[PGlite] Failed to query knowledge chunks:', error)
      throw new Error(`Failed to query knowledge chunks: ${error}`)
    }
  }

  /**
   * Delete all knowledge chunks associated with a file
   * Supports requirements 4.1, 4.2, 5.2 for knowledge chunk management
   */
  async deleteChunksByFile(fileId: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Database not connected')
    }

    try {
      await this.runTransaction(async () => {
        // Delete vectors first due to foreign key constraints
        await this.db.query(`DELETE FROM knowledge_vectors WHERE file_id = $1`, [fileId])

        const result = await this.db.query(`DELETE FROM knowledge_chunks WHERE file_id = $1`, [
          fileId
        ])

        console.log(`[PGlite] Deleted ${result.affectedRows} chunks for file: ${fileId}`)
      })
    } catch (error) {
      console.error('[PGlite] Failed to delete chunks by file:', error)
      throw new Error(`Failed to delete chunks by file: ${error}`)
    }
  }

  async pauseAllRunningTasks(): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  async resumeAllPausedTasks(): Promise<void> {
    throw new Error('Method not implemented - will be implemented in future tasks')
  }

  // ==================== Helper Methods ====================

  /**
   * Helper method to convert database row to KnowledgeFileMessage
   * Handles data type conversion and JSON parsing for metadata
   */
  private toKnowledgeFileMessage(row: any): KnowledgeFileMessage {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      mimeType: row.mime_type,
      status: row.status,
      uploadedAt: Number(row.uploaded_at),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    }
  }

  /**
   * Helper method to convert database row to KnowledgeChunkMessage
   * Handles data type conversion for chunk data
   */
  private toKnowledgeChunkMessage(row: any): KnowledgeChunkMessage {
    return {
      id: row.id,
      fileId: row.file_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      status: row.status,
      error: row.error || undefined
    }
  }
}
