/**
 * Unit tests for PGlite Presenter transaction management and schema versioning
 * Tests for task 2.3 implementation - focused on specific methods
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  PGlitePresenter,
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
    existsSync: vi.fn().mockReturnValue(false),
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

describe('PGlitePresenter - Transaction Management and Schema Versioning', () => {
  let presenter: PGlitePresenter
  const mockDb = {
    query: vi.fn(),
    exec: vi.fn(),
    close: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    presenter = new PGlitePresenter('/mock/test.db')
    // Set up the mock database
    presenter['db'] = mockDb as any
    presenter['isInitialized'] = true
    presenter['connectionStatus'] = 'connected'
  })

  describe('Transaction Management', () => {
    it('should track transaction state correctly', async () => {
      // Mock successful transaction operations
      mockDb.exec.mockResolvedValue(undefined)

      // Test begin transaction
      await presenter.beginTransaction()
      expect(presenter['inTransaction']).toBe(true)
      expect(mockDb.exec).toHaveBeenCalledWith('BEGIN')

      // Test commit transaction
      await presenter.commitTransaction()
      expect(presenter['inTransaction']).toBe(false)
      expect(mockDb.exec).toHaveBeenCalledWith('COMMIT')
    })

    it('should handle transaction rollback', async () => {
      mockDb.exec.mockResolvedValue(undefined)

      await presenter.beginTransaction()
      expect(presenter['inTransaction']).toBe(true)

      await presenter.rollbackTransaction()
      expect(presenter['inTransaction']).toBe(false)
      expect(mockDb.exec).toHaveBeenCalledWith('ROLLBACK')
    })

    it('should prevent double begin transaction', async () => {
      mockDb.exec.mockResolvedValue(undefined)

      await presenter.beginTransaction()
      await expect(presenter.beginTransaction()).rejects.toThrow('Transaction already in progress')
    })

    it('should prevent commit without begin', async () => {
      await expect(presenter.commitTransaction()).rejects.toThrow('No transaction in progress')
    })

    it('should prevent rollback without begin', async () => {
      await expect(presenter.rollbackTransaction()).rejects.toThrow('No transaction in progress')
    })

    it('should execute runTransaction correctly', async () => {
      mockDb.exec.mockResolvedValue(undefined)
      let operationExecuted = false

      await presenter.runTransaction(async () => {
        operationExecuted = true
      })

      expect(operationExecuted).toBe(true)
      expect(presenter['inTransaction']).toBe(false)
      expect(mockDb.exec).toHaveBeenCalledWith('BEGIN')
      expect(mockDb.exec).toHaveBeenCalledWith('COMMIT')
    })

    it('should rollback on runTransaction failure', async () => {
      mockDb.exec.mockResolvedValue(undefined)

      await expect(
        presenter.runTransaction(async () => {
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')

      expect(presenter['inTransaction']).toBe(false)
      expect(mockDb.exec).toHaveBeenCalledWith('BEGIN')
      expect(mockDb.exec).toHaveBeenCalledWith('ROLLBACK')
    })
  })

  describe('Schema Versioning', () => {
    it('should get current schema version', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{ version: 1 }]
      })

      const version = await presenter.getCurrentSchemaVersion()
      expect(version).toBe(1)
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT version FROM schema_versions')
      )
    })

    it('should return 0 when no schema version exists', async () => {
      mockDb.query.mockResolvedValue({ rows: [] })

      const version = await presenter.getCurrentSchemaVersion()
      expect(version).toBe(0)
    })

    it('should handle schema version query errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Table does not exist'))

      const version = await presenter.getCurrentSchemaVersion()
      expect(version).toBe(0)
    })

    it('should get applied migrations', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{ version: 1, applied_at: 1234567890, description: 'Initial schema' }]
      })

      const migrations = await presenter.getAppliedMigrations()
      expect(migrations).toHaveLength(1)
      expect(migrations[0].version).toBe(1)
      expect(migrations[0].description).toBe('Initial schema')
      expect(migrations[0].appliedAt).toBe(1234567890)
    })

    it('should get pending migrations', async () => {
      // Mock current version as 0, so version 1 should be pending
      mockDb.query.mockResolvedValue({ rows: [] })

      const pendingMigrations = await presenter.getPendingMigrations()
      expect(Array.isArray(pendingMigrations)).toBe(true)
      // Should include the initial migration
      expect(pendingMigrations.length).toBeGreaterThan(0)
    })

    it('should check rollback capability', async () => {
      // Mock current version as 1
      mockDb.query.mockResolvedValue({
        rows: [{ version: 1 }]
      })

      const canRollback = await presenter.canRollbackMigration(1)
      expect(canRollback).toBe(true) // Initial migration has rollback script
    })

    it('should validate schema compatibility', async () => {
      // Mock table existence checks
      mockDb.query.mockImplementation((query: string) => {
        if (query.includes('information_schema.tables')) {
          return Promise.resolve({ rows: [{ exists: true }] })
        }
        if (query.includes('SELECT version FROM schema_versions')) {
          return Promise.resolve({ rows: [{ version: 1 }] })
        }
        return Promise.resolve({ rows: [] })
      })

      const compatibility = await presenter.validateSchemaCompatibility()
      expect(compatibility.compatible).toBe(true)
      expect(compatibility.issues).toHaveLength(0)
    })

    it('should detect schema compatibility issues', async () => {
      // Mock current version as too old
      mockDb.query.mockImplementation((query: string) => {
        if (query.includes('SELECT version FROM schema_versions')) {
          return Promise.resolve({ rows: [{ version: -1 }] }) // Very old version
        }
        if (query.includes('information_schema.tables')) {
          return Promise.resolve({ rows: [{ exists: false }] }) // Missing tables
        }
        return Promise.resolve({ rows: [] })
      })

      const compatibility = await presenter.validateSchemaCompatibility()
      expect(compatibility.compatible).toBe(false)
      expect(compatibility.issues.length).toBeGreaterThan(0)
    })
  })

  describe('Database Health Checks', () => {
    it('should perform health check successfully', async () => {
      mockDb.query.mockImplementation((query: string) => {
        if (query === 'SELECT 1') {
          return Promise.resolve({ rows: [{ '?column?': 1 }] })
        }
        if (query.includes('SELECT version FROM schema_versions')) {
          return Promise.resolve({ rows: [{ version: 1 }] })
        }
        if (query.includes('information_schema.tables')) {
          return Promise.resolve({ rows: [{ exists: true }] })
        }
        return Promise.resolve({ rows: [] })
      })

      const healthCheck = await presenter.performHealthCheck()
      expect(healthCheck.healthy).toBe(true)
      expect(healthCheck.issues).toHaveLength(0)
      expect(healthCheck.metrics).toBeDefined()
      expect(healthCheck.metrics.schemaVersion).toBe(1)
      expect(healthCheck.metrics.connectionLatency).toBeGreaterThanOrEqual(0)
    })

    it('should detect health issues', async () => {
      // Mock disconnected state
      presenter['connectionStatus'] = 'disconnected'

      const healthCheck = await presenter.performHealthCheck()
      expect(healthCheck.healthy).toBe(false)
      expect(healthCheck.issues).toContain('Database not connected')
    })
  })

  describe('Connection Management', () => {
    it('should check connection status', () => {
      expect(presenter.isConnected()).toBe(true)

      presenter['connectionStatus'] = 'disconnected'
      expect(presenter.isConnected()).toBe(false)
    })

    it('should handle connection status changes', () => {
      presenter['connectionStatus'] = 'connecting'
      expect(presenter.isConnected()).toBe(false)

      presenter['connectionStatus'] = 'error'
      expect(presenter.isConnected()).toBe(false)

      presenter['connectionStatus'] = 'connected'
      expect(presenter.isConnected()).toBe(true)
    })
  })
})
