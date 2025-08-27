import { describe, it, expect, beforeEach, vi } from 'vitest'
import { databaseInitHook } from '../../../src/main/lib/lifecycle/hooks/databaseInitHook'
import { DatabaseInitializer } from '../../../src/main/lib/lifecycle/DatabaseInitializer'
import { getInstance } from '../../../src/main/presenter'
import { LifecycleContext, LifecyclePhase } from '../../../src/shared/presenter'

// Mock dependencies
vi.mock('../../src/main/lib/lifecycle/DatabaseInitializer')
vi.mock('../../src/main/presenter', () => ({
  initializePresenter: vi.fn()
}))

describe('databaseInitHook', () => {
  let mockContext: LifecycleContext
  let mockDatabase: any
  let mockDbInitializer: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockDatabase = {
      getConversationCount: vi.fn().mockResolvedValue(0),
      close: vi.fn()
    }

    mockDbInitializer = {
      initialize: vi.fn().mockResolvedValue(mockDatabase),
      migrate: vi.fn().mockResolvedValue(undefined)
    }

    vi.mocked(DatabaseInitializer).mockImplementation(() => mockDbInitializer)

    mockContext = {
      phase: LifecyclePhase.INIT,
      manager: {} as any
    }
  })

  describe('hook properties', () => {
    it('should have correct hook configuration', () => {
      expect(databaseInitHook.name).toBe('database-initialization')
      expect(databaseInitHook.priority).toBe(1)
      expect(databaseInitHook.critical).toBe(true)
      expect(databaseInitHook.timeout).toBe(30000)
    })
  })

  describe('execute', () => {
    it('should successfully initialize database and presenter', async () => {
      await databaseInitHook.execute(mockContext)

      expect(DatabaseInitializer).toHaveBeenCalledWith()
      expect(mockDbInitializer.initialize).toHaveBeenCalled()
      expect(mockDbInitializer.migrate).toHaveBeenCalled()
      expect(mockContext.database).toBe(mockDatabase)
      expect(getInstance).toHaveBeenCalledWith(mockDatabase)
    })

    it('should throw error if database initialization fails', async () => {
      const initError = new Error('Database initialization failed')
      mockDbInitializer.initialize.mockRejectedValue(initError)

      await expect(databaseInitHook.execute(mockContext)).rejects.toThrow(
        'Database initialization failed'
      )
      expect(getInstance).not.toHaveBeenCalled()
    })

    it('should throw error if migration fails', async () => {
      const migrationError = new Error('Migration failed')
      mockDbInitializer.migrate.mockRejectedValue(migrationError)

      await expect(databaseInitHook.execute(mockContext)).rejects.toThrow('Migration failed')
      expect(getInstance).not.toHaveBeenCalled()
    })

    it('should throw error if presenter initialization fails', async () => {
      const presenterError = new Error('Presenter initialization failed')
      vi.mocked(getInstance).mockImplementation(() => {
        throw presenterError
      })

      await expect(databaseInitHook.execute(mockContext)).rejects.toThrow(
        'Presenter initialization failed'
      )
    })
  })
})
