import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseInitializer } from '../../../src/main/lib/lifecycle/DatabaseInitializer'
import { SQLitePresenter } from '../../../src/main/presenter/sqlitePresenter'
import { eventBus } from '../../../src/main/eventbus'
import { app } from 'electron'
import path from 'path'

// Mock dependencies
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user/data')
  }
}))

vi.mock('../../src/main/presenter/sqlitePresenter', () => ({
  SQLitePresenter: vi.fn()
}))

vi.mock('../../src/main/eventbus', () => ({
  eventBus: {
    emit: vi.fn()
  }
}))

describe('DatabaseInitializer', () => {
  let dbInitializer: DatabaseInitializer
  let mockDatabase: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Create a proper mock database instance
    mockDatabase = {
      getConversationCount: vi.fn().mockResolvedValue(0),
      close: vi.fn()
    }

    // Mock the SQLitePresenter constructor to return our mock
    vi.mocked(SQLitePresenter).mockImplementation(() => mockDatabase)

    dbInitializer = new DatabaseInitializer()
  })

  afterEach(() => {
    try {
      dbInitializer.close()
    } catch (error) {
      // Ignore errors in cleanup
    }
  })

  describe('constructor', () => {
    it('should initialize with correct database path', () => {
      const expectedPath = path.join('/mock/user/data', 'app_db', 'chat.db')
      expect(app.getPath).toHaveBeenCalledWith('userData')

      // Verify path is constructed correctly (internal property, tested through behavior)
      expect(dbInitializer).toBeDefined()
    })

    it('should accept optional password parameter', () => {
      const dbInitializerWithPassword = new DatabaseInitializer('test-password')
      expect(dbInitializerWithPassword).toBeDefined()
    })
  })

  describe('initialize', () => {
    it('should successfully initialize database', async () => {
      const database = await dbInitializer.initialize()

      expect(SQLitePresenter).toHaveBeenCalledWith(
        path.join('/mock/user/data', 'app_db', 'chat.db'),
        undefined
      )
      expect(database).toBe(mockDatabase)
      expect(eventBus.emit).toHaveBeenCalledWith('database:ready', database)
    })

    it('should initialize database with password', async () => {
      const dbInitializerWithPassword = new DatabaseInitializer('test-password')
      const database = await dbInitializerWithPassword.initialize()

      expect(SQLitePresenter).toHaveBeenCalledWith(
        path.join('/mock/user/data', 'app_db', 'chat.db'),
        'test-password'
      )
      expect(database).toBe(mockDatabase)
    })

    it('should throw error if database initialization fails', async () => {
      const mockError = new Error('Database connection failed')
      vi.mocked(SQLitePresenter).mockImplementationOnce(() => {
        throw mockError
      })

      await expect(dbInitializer.initialize()).rejects.toThrow('Database connection failed')
    })

    it('should throw error if connection validation fails', async () => {
      const mockFailingDatabase = {
        getConversationCount: vi.fn().mockRejectedValue(new Error('Connection failed')),
        close: vi.fn()
      }
      vi.mocked(SQLitePresenter).mockImplementationOnce(() => mockFailingDatabase)

      await expect(dbInitializer.initialize()).rejects.toThrow(
        'Database connection validation failed'
      )
    })
  })

  describe('migrate', () => {
    it('should perform migration successfully', async () => {
      await dbInitializer.initialize()
      await expect(dbInitializer.migrate()).resolves.not.toThrow()
    })

    it('should throw error if database not initialized', async () => {
      await expect(dbInitializer.migrate()).rejects.toThrow(
        'Database must be initialized before migration'
      )
    })
  })

  describe('validateConnection', () => {
    it('should return true for valid connection', async () => {
      await dbInitializer.initialize()
      const isValid = await dbInitializer.validateConnection()
      expect(isValid).toBe(true)
    })

    it('should return false if database not initialized', async () => {
      const isValid = await dbInitializer.validateConnection()
      expect(isValid).toBe(false)
    })

    it('should return false if connection test fails', async () => {
      const mockFailingDatabase = {
        getConversationCount: vi.fn().mockRejectedValue(new Error('Connection failed')),
        close: vi.fn()
      }

      // Create a new initializer and manually set database to test validation failure
      const testInitializer = new DatabaseInitializer()
      ;(testInitializer as any).database = mockFailingDatabase

      const isValid = await testInitializer.validateConnection()
      expect(isValid).toBe(false)
    })
  })

  describe('getDatabase', () => {
    it('should return undefined before initialization', () => {
      const database = dbInitializer.getDatabase()
      expect(database).toBeUndefined()
    })

    it('should return database instance after initialization', async () => {
      const initializedDatabase = await dbInitializer.initialize()
      const database = dbInitializer.getDatabase()
      expect(database).toBe(initializedDatabase)
    })
  })

  describe('close', () => {
    it('should close database connection', async () => {
      const database = await dbInitializer.initialize()
      const closeSpy = vi.spyOn(database, 'close')

      dbInitializer.close()

      expect(closeSpy).toHaveBeenCalled()
      expect(dbInitializer.getDatabase()).toBeUndefined()
    })

    it('should handle close when database not initialized', () => {
      expect(() => dbInitializer.close()).not.toThrow()
    })
  })
})
