/**
 * Unit tests for PGlite Presenter schema migration and versioning
 * Tests for task 11.1 implementation - covers schema management and migration
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PGlitePresenter,
  PGliteConfig,
  SchemaMigration,
  MigrationResult
} from '../../../src/main/presenter/pglitePresenter'

// Mock PGlite and dependencies
vi.mock('@electric-sql/pglite', () => ({
  PGlite: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
    exec: vi.fn(),
    close: vi.fn()
  }))
}))

vi.mock('@electric-sql/pglite/vector', () => ({
  vector: {}
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn()
  }
}))

vi.mock('path', () => ({
  default: {
    dirname: vi.fn().mockReturnValue('/mock/dir'),
    join: vi.fn((...args) => args.join('/'))
  }
}))

// Mock schema management components with more detailed implementations
const mockSchemaManager = {
  createSchema: vi.fn().mockResolvedValue(undefined),
  getCurrentVersion: vi.fn().mockResolvedValue(1),
  validateSchema: vi.fn().mockResolvedValue({
    isValid: true,
    errors: [],
    warnings: [],
    schemaVersion: 1
  }),
  getPendingMigrations: vi.fn().mockResolvedValue([])
}

const mockMigrationEngine = {
  getMigrationHistory: vi.fn().mockResolvedValue([
    {
      version: 1,
      description: 'Initial schema',
      appliedAt: 1234567890,
      success: true,
      isRollback: false
    }
  ]),
  createMigrationPlan: vi.fn().mockResolvedValue({
    migrations: [
      {
        version: 2,
        description: 'Add new columns',
        upScript: 'ALTER TABLE test ADD COLUMN new_col TEXT',
        downScript: 'ALTER TABLE test DROP COLUMN new_col'
      }
    ],
    isRollback: false
  }),
  executeMigrationPlan: vi.fn().mockResolvedValue([
    {
      success: true,
      version: 2,
      description: 'Add new columns',
      executionTime: 100,
      errors: [],
      warnings: [],
      rollbackAvailable: true
    }
  ])
}

const mockDataValidator = {
  validateDatabase: vi.fn().mockResolvedValue({
    isValid: true,
    errors: [],
    warnings: []
  }),
  checkDataIntegrity: vi.fn().mockResolvedValue({
    isValid: true,
    issues: [],
    statistics: {
      totalRecords: { conversations: 10, messages: 50, knowledge_vectors: 100 },
      orphanedRecords: {}
    }
  })
}

vi.mock('../../../src/main/presenter/pglitePresenter/schema', () => ({
  PGliteSchemaManager: vi.fn().mockImplementation(() => mockSchemaManager)
}))

vi.mock('../../../src/main/presenter/pglitePresenter/migration', () => ({
  PGliteMigrationEngine: vi.fn().mockImplementation(() => mockMigrationEngine)
}))

vi.mock('../../../src/main/presenter/pglitePresenter/validation', () => ({
  PGliteDataValidator: vi.fn().mockImplementation(() => mockDataValidator)
}))

describe('PGlitePresenter - Schema Migration and Versioning', () => {
  let presenter: PGlitePresenter
  const mockDb = {
    query: vi.fn(),
    exec: vi.fn(),
    close: vi.fn()
  }

  const mockConfig: PGliteConfig = {
    dbPath: '/mock/test.db',
    vectorDimensions: 1536,
    autoMigrate: true,
    schemaValidation: true
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    presenter = new PGlitePresenter('/mock/test.db')

    // Set up the mock database
    presenter['db'] = mockDb as any
    presenter['config'] = mockConfig
    presenter['isInitialized'] = true
    presenter['connectionStatus'] = 'connected'

    // Set up mock components
    presenter['schemaManager'] = mockSchemaManager as any
    presenter['migrationEngine'] = mockMigrationEngine as any
    presenter['dataValidator'] = mockDataValidator as any

    // Mock successful operations by default
    mockDb.exec.mockResolvedValue(undefined)
    mockDb.query.mockResolvedValue({ rows: [], affectedRows: 1 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Schema Version Management', () => {
    it('should get current schema version from schema manager', async () => {
      mockSchemaManager.getCurrentVersion.mockResolvedValueOnce(2)

      const version = await presenter.getCurrentSchemaVersion()

      expect(version).toBe(2)
      expect(mockSchemaManager.getCurrentVersion).toHaveBeenCalledWith(mockDb)
    })

    it('should fallback to direct query when schema manager not available', async () => {
      presenter['schemaManager'] = null as any
      mockDb.query.mockResolvedValueOnce({
        rows: [{ version: 3 }]
      })

      const version = await presenter.getCurrentSchemaVersion()

      expect(version).toBe(3)
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT version FROM schema_versions')
      )
    })

    it('should return 0 when no schema version exists', async () => {
      presenter['schemaManager'] = null as any
      mockDb.query.mockResolvedValueOnce({ rows: [] })

      const version = await presenter.getCurrentSchemaVersion()

      expect(version).toBe(0)
    })

    it('should handle schema version query errors gracefully', async () => {
      presenter['schemaManager'] = null as any
      mockDb.query.mockRejectedValueOnce(new Error('Table does not exist'))

      const version = await presenter.getCurrentSchemaVersion()

      expect(version).toBe(0)
    })
  })

  describe('Migration History and Status', () => {
    it('should get applied migrations from migration engine', async () => {
      const migrations = await presenter.getAppliedMigrations()

      expect(migrations).toHaveLength(1)
      expect(migrations[0].version).toBe(1)
      expect(migrations[0].description).toBe('Initial schema')
      expect(migrations[0].appliedAt).toBe(1234567890)
      expect(mockMigrationEngine.getMigrationHistory).toHaveBeenCalledWith(mockDb)
    })

    it('should fallback to direct query for applied migrations', async () => {
      presenter['migrationEngine'] = null as any
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            version: 1,
            applied_at: 1234567890,
            description: 'Initial schema'
          }
        ]
      })

      const migrations = await presenter.getAppliedMigrations()

      expect(migrations).toHaveLength(1)
      expect(migrations[0].version).toBe(1)
    })

    it('should check if migration can be rolled back', async () => {
      mockMigrationEngine.createMigrationPlan.mockResolvedValueOnce({
        migrations: [{ version: 1 }],
        isRollback: true
      })

      const canRollback = await presenter.canRollbackMigration(2)

      expect(canRollback).toBe(true)
      expect(mockMigrationEngine.createMigrationPlan).toHaveBeenCalledWith(mockDb, 1)
    })

    it('should return false when rollback not available', async () => {
      mockMigrationEngine.createMigrationPlan.mockResolvedValueOnce({
        migrations: [],
        isRollback: false
      })

      const canRollback = await presenter.canRollbackMigration(2)

      expect(canRollback).toBe(false)
    })

    it('should get pending migrations', async () => {
      mockSchemaManager.getPendingMigrations.mockResolvedValueOnce([
        { version: 2, description: 'Add new feature' },
        { version: 3, description: 'Update indexes' }
      ])

      const pending = await presenter.getPendingMigrations()

      expect(pending).toEqual([2, 3])
      expect(mockSchemaManager.getPendingMigrations).toHaveBeenCalledWith(mockDb)
    })
  })

  describe('Schema Migration Execution', () => {
    it('should execute schema migration successfully', async () => {
      mockSchemaManager.getCurrentVersion.mockResolvedValueOnce(2)

      await presenter.migrateSchema(2)

      expect(mockMigrationEngine.createMigrationPlan).toHaveBeenCalledWith(mockDb, 2)
      expect(mockMigrationEngine.executeMigrationPlan).toHaveBeenCalledWith(
        mockDb,
        expect.any(Object),
        expect.objectContaining({
          progressCallback: expect.any(Function)
        })
      )
    })

    it('should handle migration progress callbacks', async () => {
      let progressCallbackCalled = false

      mockMigrationEngine.executeMigrationPlan.mockImplementationOnce(async (db, plan, options) => {
        if (options.progressCallback) {
          options.progressCallback({
            percentage: 50,
            currentStep: 'Applying migration v2'
          })
          progressCallbackCalled = true
        }
        return [
          {
            success: true,
            version: 2,
            description: 'Test migration',
            executionTime: 100,
            errors: [],
            warnings: [],
            rollbackAvailable: true
          }
        ]
      })

      await presenter.migrateSchema(2)

      expect(progressCallbackCalled).toBe(true)
    })

    it('should throw error when migration engine not initialized', async () => {
      presenter['migrationEngine'] = null as any

      await expect(presenter.migrateSchema(2)).rejects.toThrow('Migration engine not initialized')
    })

    it('should handle migration execution errors', async () => {
      mockMigrationEngine.executeMigrationPlan.mockRejectedValueOnce(new Error('Migration failed'))

      await expect(presenter.migrateSchema(2)).rejects.toThrow(
        'Schema migration failed: Migration failed'
      )
    })

    it('should run automatic migrations on initialization', async () => {
      const newPresenter = new PGlitePresenter('/mock/auto-migrate.db')

      // Mock current version as 0, target as 1
      mockSchemaManager.getCurrentVersion.mockResolvedValueOnce(0)

      await newPresenter.initialize(mockConfig)

      expect(mockMigrationEngine.createMigrationPlan).toHaveBeenCalled()
      expect(mockMigrationEngine.executeMigrationPlan).toHaveBeenCalled()
    })

    it('should skip automatic migrations when disabled', async () => {
      const configWithoutAutoMigrate = { ...mockConfig, autoMigrate: false }
      const newPresenter = new PGlitePresenter('/mock/no-auto-migrate.db')

      await newPresenter.initialize(configWithoutAutoMigrate)

      expect(mockMigrationEngine.executeMigrationPlan).not.toHaveBeenCalled()
    })
  })

  describe('Schema Validation', () => {
    it('should validate schema compatibility successfully', async () => {
      mockSchemaManager.validateSchema.mockResolvedValueOnce({
        isValid: true,
        errors: [],
        warnings: [],
        schemaVersion: 1
      })

      const compatibility = await presenter.validateSchemaCompatibility()

      expect(compatibility.compatible).toBe(true)
      expect(compatibility.issues).toHaveLength(0)
    })

    it('should detect schema version too old', async () => {
      mockSchemaManager.validateSchema.mockResolvedValueOnce({
        isValid: true,
        errors: [],
        warnings: [],
        schemaVersion: -1 // Very old version
      })

      const compatibility = await presenter.validateSchemaCompatibility()

      expect(compatibility.compatible).toBe(false)
      expect(compatibility.issues).toContain(
        expect.stringContaining('Schema version -1 is too old')
      )
    })

    it('should detect schema version too new', async () => {
      mockSchemaManager.validateSchema.mockResolvedValueOnce({
        isValid: true,
        errors: [],
        warnings: [],
        schemaVersion: 10 // Future version
      })

      const compatibility = await presenter.validateSchemaCompatibility()

      expect(compatibility.compatible).toBe(false)
      expect(compatibility.issues).toContain(
        expect.stringContaining('Schema version 10 is newer than supported')
      )
    })

    it('should include schema validation errors in compatibility check', async () => {
      mockSchemaManager.validateSchema.mockResolvedValueOnce({
        isValid: false,
        errors: ['Missing table: conversations'],
        warnings: ['Index performance warning'],
        schemaVersion: 1
      })

      const compatibility = await presenter.validateSchemaCompatibility()

      expect(compatibility.compatible).toBe(false)
      expect(compatibility.issues).toContain('Missing table: conversations')
      expect(compatibility.issues).toContain('Index performance warning')
    })

    it('should validate database integrity comprehensively', async () => {
      const result = await presenter.validateIntegrity()

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
      expect(result.schemaVersion).toBe(1)
      expect(result.recordCounts).toEqual({
        conversations: 10,
        messages: 50,
        knowledge_vectors: 100
      })
      expect(result.vectorIndexStatus?.totalVectors).toBe(100)
    })

    it('should handle validation component failures', async () => {
      mockDataValidator.validateDatabase.mockRejectedValueOnce(new Error('Validation failed'))

      await expect(presenter.validateIntegrity()).rejects.toThrow(
        'Validation failed: Validation failed'
      )
    })

    it('should combine multiple validation results', async () => {
      mockDataValidator.validateDatabase.mockResolvedValueOnce({
        isValid: false,
        errors: [{ message: 'Data error' }],
        warnings: [{ message: 'Data warning' }]
      })

      mockSchemaManager.validateSchema.mockResolvedValueOnce({
        isValid: false,
        errors: ['Schema error'],
        warnings: ['Schema warning'],
        schemaVersion: 1
      })

      mockDataValidator.checkDataIntegrity.mockResolvedValueOnce({
        isValid: false,
        issues: [
          { severity: 'critical', description: 'Critical issue' },
          { severity: 'major', description: 'Major issue' }
        ],
        statistics: {
          totalRecords: { conversations: 0 },
          orphanedRecords: { messages: 5 }
        }
      })

      const result = await presenter.validateIntegrity()

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Data error')
      expect(result.errors).toContain('Schema error')
      expect(result.errors).toContain('Critical issue')
      expect(result.warnings).toContain('Data warning')
      expect(result.warnings).toContain('Schema warning')
      expect(result.warnings).toContain('Major issue')
    })
  })

  describe('Schema Initialization', () => {
    it('should create initial schema during initialization', async () => {
      const newPresenter = new PGlitePresenter('/mock/new-schema.db')

      await newPresenter.initialize(mockConfig)

      expect(mockSchemaManager.createSchema).toHaveBeenCalledWith(mockDb)
    })

    it('should handle schema creation failures', async () => {
      mockSchemaManager.createSchema.mockRejectedValueOnce(new Error('Schema creation failed'))

      const newPresenter = new PGlitePresenter('/mock/fail-schema.db')

      await expect(newPresenter.initialize(mockConfig)).rejects.toThrow('Schema creation failed')
    })

    it('should validate schema after initialization when enabled', async () => {
      const newPresenter = new PGlitePresenter('/mock/validate-schema.db')

      await newPresenter.initialize(mockConfig)

      expect(mockDataValidator.validateDatabase).toHaveBeenCalled()
      expect(mockSchemaManager.validateSchema).toHaveBeenCalled()
    })

    it('should skip schema validation when disabled', async () => {
      const configWithoutValidation = { ...mockConfig, schemaValidation: false }
      const newPresenter = new PGlitePresenter('/mock/no-validation.db')

      await newPresenter.initialize(configWithoutValidation)

      // Validation should not be called during initialization
      expect(mockDataValidator.validateDatabase).not.toHaveBeenCalled()
    })
  })

  describe('Migration Error Handling', () => {
    it('should handle migration plan creation errors', async () => {
      mockMigrationEngine.createMigrationPlan.mockRejectedValueOnce(
        new Error('Plan creation failed')
      )

      await expect(presenter.migrateSchema(2)).rejects.toThrow(
        'Schema migration failed: Plan creation failed'
      )
    })

    it('should handle migration execution errors with rollback', async () => {
      mockMigrationEngine.executeMigrationPlan.mockResolvedValueOnce([
        {
          success: false,
          version: 2,
          description: 'Failed migration',
          executionTime: 50,
          errors: ['SQL syntax error'],
          warnings: [],
          rollbackAvailable: true
        }
      ])

      // Should not throw but log the errors
      await presenter.migrateSchema(2)

      expect(mockMigrationEngine.executeMigrationPlan).toHaveBeenCalled()
    })

    it('should handle missing migration engine gracefully', async () => {
      presenter['migrationEngine'] = null as any

      const canRollback = await presenter.canRollbackMigration(2)
      expect(canRollback).toBe(false)

      const pending = await presenter.getPendingMigrations()
      expect(pending).toEqual([])
    })
  })

  describe('Schema Version Constants and Limits', () => {
    it('should respect current schema version constant', async () => {
      // Access the static constant
      const currentVersion = (PGlitePresenter as any).CURRENT_SCHEMA_VERSION
      expect(typeof currentVersion).toBe('number')
      expect(currentVersion).toBeGreaterThan(0)
    })

    it('should use correct schema version table name', async () => {
      const tableName = (PGlitePresenter as any).SCHEMA_VERSION_TABLE
      expect(tableName).toBe('schema_versions')
    })

    it('should calculate minimum supported version correctly', async () => {
      // Test the backward compatibility logic (2 major versions back)
      mockSchemaManager.validateSchema.mockResolvedValueOnce({
        isValid: true,
        errors: [],
        warnings: [],
        schemaVersion: 1 // Assuming current version is 1, min should be max(1, 1-2) = 1
      })

      const compatibility = await presenter.validateSchemaCompatibility()
      expect(compatibility.compatible).toBe(true)
    })
  })
})
