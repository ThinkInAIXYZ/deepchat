/**
 * Comprehensive unit tests for PGlite Presenter CRUD operations
 * Tests for task 11.1 implementation - covers all database operations
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PGlitePresenter,
  IPGlitePresenter,
  PGliteConfig,
  ValidationResult
} from '../../../src/main/presenter/pglitePresenter'
import { CONVERSATION, CONVERSATION_SETTINGS, SQLITE_MESSAGE } from '@shared/presenter'

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

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-id-123')
}))

// Mock schema management components
vi.mock('../../../src/main/presenter/pglitePresenter/schema', () => ({
  PGliteSchemaManager: vi.fn().mockImplementation(() => ({
    createSchema: vi.fn().mockResolvedValue(undefined),
    getCurrentVersion: vi.fn().mockResolvedValue(1),
    validateSchema: vi.fn().mockResolvedValue({
      isValid: true,
      errors: [],
      warnings: [],
      schemaVersion: 1
    }),
    getPendingMigrations: vi.fn().mockResolvedValue([])
  }))
}))

vi.mock('../../../src/main/presenter/pglitePresenter/migration', () => ({
  PGliteMigrationEngine: vi.fn().mockImplementation(() => ({
    getMigrationHistory: vi.fn().mockResolvedValue([]),
    createMigrationPlan: vi.fn().mockResolvedValue({ migrations: [], isRollback: false }),
    executeMigrationPlan: vi.fn().mockResolvedValue([])
  }))
}))

vi.mock('../../../src/main/presenter/pglitePresenter/validation', () => ({
  PGliteDataValidator: vi.fn().mockImplementation(() => ({
    validateDatabase: vi.fn().mockResolvedValue({
      isValid: true,
      errors: [],
      warnings: []
    }),
    checkDataIntegrity: vi.fn().mockResolvedValue({
      isValid: true,
      issues: [],
      statistics: {
        totalRecords: { conversations: 0, messages: 0, knowledge_vectors: 0 },
        orphanedRecords: {}
      }
    })
  }))
}))

describe('PGlitePresenter - CRUD Operations', () => {
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

    // Mock successful operations by default
    mockDb.exec.mockResolvedValue(undefined)
    mockDb.query.mockResolvedValue({ rows: [], affectedRows: 1 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Initialization and Connection Management', () => {
    it('should initialize successfully with valid config', async () => {
      const newPresenter = new PGlitePresenter('/mock/new.db')

      await expect(newPresenter.initialize(mockConfig)).resolves.not.toThrow()
      expect(newPresenter.isConnected()).toBe(true)
    })

    it('should throw error when initializing already initialized presenter', async () => {
      await expect(presenter.initialize(mockConfig)).rejects.toThrow(
        'PGlite presenter is already initialized'
      )
    })

    it('should handle connection failures with retry', async () => {
      const newPresenter = new PGlitePresenter('/mock/fail.db')
      mockDb.query
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce({ rows: [] })

      await expect(newPresenter.initialize(mockConfig)).resolves.not.toThrow()
    })

    it('should fail after max retries', async () => {
      const newPresenter = new PGlitePresenter('/mock/fail.db')
      mockDb.query.mockRejectedValue(new Error('Connection failed'))

      await expect(newPresenter.initialize(mockConfig)).rejects.toThrow(
        'Connection failed after 4 attempts'
      )
    })

    it('should reconnect successfully', async () => {
      mockDb.close.mockResolvedValue(undefined)

      await expect(presenter.reconnect()).resolves.not.toThrow()
      expect(mockDb.close).toHaveBeenCalled()
    })

    it('should close database properly', async () => {
      await expect(presenter.close()).resolves.not.toThrow()
      expect(mockDb.close).toHaveBeenCalled()
      expect(presenter.isConnected()).toBe(false)
    })
  })

  describe('Conversation CRUD Operations', () => {
    const mockConversation: CONVERSATION = {
      id: 'conv-123',
      title: 'Test Conversation',
      createdAt: 1234567890,
      updatedAt: 1234567890,
      is_pinned: 0,
      is_new: 1,
      settings: {
        systemPrompt: '',
        temperature: 0.7,
        contextLength: 4000,
        maxTokens: 2000,
        providerId: 'openai',
        modelId: 'gpt-4',
        artifacts: 0
      }
    }

    it('should create conversation successfully', async () => {
      const conversationId = await presenter.createConversation('Test Conversation')

      expect(conversationId).toBe('mock-id-123')
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO conversations'),
        expect.arrayContaining(['mock-id-123', 'Test Conversation'])
      )
    })

    it('should create conversation with custom settings', async () => {
      const customSettings: Partial<CONVERSATION_SETTINGS> = {
        temperature: 0.9,
        modelId: 'gpt-3.5-turbo'
      }

      await presenter.createConversation('Test Conversation', customSettings)

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO conversations'),
        expect.arrayContaining([
          'mock-id-123',
          'Test Conversation',
          expect.any(Number),
          expect.any(Number),
          0,
          1,
          expect.stringContaining('"temperature":0.9')
        ])
      )
    })

    it('should get conversation by ID', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-123',
            title: 'Test Conversation',
            created_at: 1234567890,
            updated_at: 1234567890,
            is_pinned: 0,
            is_new: 1,
            settings: JSON.stringify(mockConversation.settings)
          }
        ]
      })

      const conversation = await presenter.getConversation('conv-123')

      expect(conversation).toEqual(mockConversation)
      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('SELECT conv_id as id'), [
        'conv-123'
      ])
    })

    it('should throw error when conversation not found', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] })

      await expect(presenter.getConversation('nonexistent')).rejects.toThrow(
        'Conversation nonexistent not found'
      )
    })

    it('should handle malformed settings JSON gracefully', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-123',
            title: 'Test Conversation',
            created_at: 1234567890,
            updated_at: 1234567890,
            is_pinned: 0,
            is_new: 1,
            settings: 'invalid-json'
          }
        ]
      })

      const conversation = await presenter.getConversation('conv-123')

      expect(conversation.settings).toEqual(
        expect.objectContaining({
          systemPrompt: '',
          temperature: 0.7,
          providerId: 'openai',
          modelId: 'gpt-4'
        })
      )
    })

    it('should update conversation successfully', async () => {
      // Mock getting current conversation for settings merge
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-123',
            title: 'Old Title',
            created_at: 1234567890,
            updated_at: 1234567890,
            is_pinned: 0,
            is_new: 1,
            settings: JSON.stringify(mockConversation.settings)
          }
        ]
      })

      await presenter.updateConversation('conv-123', {
        title: 'New Title',
        is_pinned: 1
      })

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE conversations SET'),
        expect.arrayContaining(['New Title', 1, expect.any(Number), 'conv-123'])
      )
    })

    it('should rename conversation and return updated conversation', async () => {
      // Mock the update operation
      mockDb.query.mockResolvedValueOnce({ affectedRows: 1 })

      // Mock getting the updated conversation
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-123',
            title: 'New Title',
            created_at: 1234567890,
            updated_at: 1234567890,
            is_pinned: 0,
            is_new: 0,
            settings: JSON.stringify(mockConversation.settings)
          }
        ]
      })

      const updatedConversation = await presenter.renameConversation('conv-123', 'New Title')

      expect(updatedConversation.title).toBe('New Title')
      expect(updatedConversation.is_new).toBe(0)
    })

    it('should delete conversation and associated messages', async () => {
      await presenter.deleteConversation('conv-123')

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM message_attachments'),
        ['conv-123']
      )
      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM messages'), [
        'conv-123'
      ])
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM conversations'),
        ['conv-123']
      )
    })

    it('should get conversation list with pagination', async () => {
      // Mock count query
      mockDb.query.mockResolvedValueOnce({ rows: [{ count: 10 }] })

      // Mock list query
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-1',
            title: 'Conversation 1',
            created_at: 1234567890,
            updated_at: 1234567890,
            is_pinned: 0,
            is_new: 1,
            settings: JSON.stringify(mockConversation.settings)
          },
          {
            id: 'conv-2',
            title: 'Conversation 2',
            created_at: 1234567891,
            updated_at: 1234567891,
            is_pinned: 1,
            is_new: 0,
            settings: JSON.stringify(mockConversation.settings)
          }
        ]
      })

      const result = await presenter.getConversationList(1, 5)

      expect(result.total).toBe(10)
      expect(result.list).toHaveLength(2)
      expect(result.list[0].id).toBe('conv-1')
      expect(result.list[1].id).toBe('conv-2')
    })

    it('should get conversation count', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [{ count: 42 }] })

      const count = await presenter.getConversationCount()

      expect(count).toBe(42)
      expect(mockDb.query).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM conversations')
    })
  })

  describe('Message CRUD Operations', () => {
    const mockMessage: SQLITE_MESSAGE = {
      id: 'msg-123',
      conversation_id: 'conv-123',
      parent_id: '',
      content: 'Test message',
      role: 'user',
      created_at: 1234567890,
      order_seq: 0,
      token_count: 10,
      status: 'sent',
      metadata: '{}',
      is_context_edge: 0,
      is_variant: 0
    }

    it('should insert message successfully', async () => {
      const messageId = await presenter.insertMessage(
        'conv-123',
        'Test message',
        'user',
        '',
        '{}',
        0,
        10,
        'pending',
        0,
        0
      )

      expect(messageId).toBe('mock-id-123')
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO messages'),
        expect.arrayContaining([
          'mock-id-123',
          'conv-123',
          '',
          'Test message',
          'user',
          expect.any(Number),
          0,
          10,
          'pending',
          '{}',
          0,
          0
        ])
      )
    })

    it('should update message successfully', async () => {
      await presenter.updateMessage('msg-123', {
        content: 'Updated content',
        status: 'sent',
        tokenCount: 15
      })

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE messages SET'),
        expect.arrayContaining(['Updated content', 'sent', 15, 'msg-123'])
      )
    })

    it('should delete message and attachments', async () => {
      await presenter.deleteMessage('msg-123')

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM message_attachments'),
        ['msg-123']
      )
      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM messages'), [
        'msg-123'
      ])
    })

    it('should query messages for conversation', async () => {
      // Mock main messages query
      mockDb.query.mockResolvedValueOnce({
        rows: [mockMessage]
      })

      // Mock variants query (empty for user message)
      mockDb.query.mockResolvedValue({ rows: [] })

      const messages = await presenter.queryMessages('conv-123')

      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual(mockMessage)
    })

    it('should query messages with variants for assistant messages', async () => {
      const assistantMessage = {
        ...mockMessage,
        id: 'msg-assistant',
        role: 'assistant',
        parent_id: 'msg-user'
      }

      const variant = {
        ...mockMessage,
        id: 'msg-variant',
        role: 'assistant',
        parent_id: 'msg-user',
        is_variant: 1,
        content: 'Variant response'
      }

      // Mock main messages query
      mockDb.query.mockResolvedValueOnce({
        rows: [assistantMessage]
      })

      // Mock variants query
      mockDb.query.mockResolvedValueOnce({
        rows: [variant]
      })

      const messages = await presenter.queryMessages('conv-123')

      expect(messages).toHaveLength(1)
      expect(messages[0].variants).toHaveLength(1)
      expect(messages[0].variants![0].content).toBe('Variant response')
    })
  })

  describe('Error Handling', () => {
    it('should throw error when database not connected', async () => {
      presenter['connectionStatus'] = 'disconnected'

      await expect(presenter.createConversation('Test')).rejects.toThrow('Database not connected')
    })

    it('should handle database query errors', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Database error'))

      await expect(presenter.createConversation('Test')).rejects.toThrow(
        'Failed to create conversation: Database error'
      )
    })

    it('should handle transaction errors in delete operations', async () => {
      mockDb.exec.mockRejectedValueOnce(new Error('Transaction failed'))

      await expect(presenter.deleteConversation('conv-123')).rejects.toThrow('Transaction failed')
    })

    it('should recover from errors successfully', async () => {
      const error = new Error('Test error')

      const recovered = await presenter.recoverFromError(error)

      expect(recovered).toBe(true)
    })

    it('should fail recovery when database file missing', async () => {
      const fs = await import('fs')
      vi.mocked(fs.default.existsSync).mockReturnValueOnce(false)

      const error = new Error('Test error')
      const recovered = await presenter.recoverFromError(error)

      expect(recovered).toBe(false)
    })
  })

  describe('Validation and Integrity', () => {
    it('should validate integrity successfully', async () => {
      const result = await presenter.validateIntegrity()

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
      expect(result.schemaVersion).toBe(1)
    })

    it('should perform health check successfully', async () => {
      mockDb.query.mockImplementation((query: string) => {
        if (query === 'SELECT 1') {
          return Promise.resolve({ rows: [{ '?column?': 1 }] })
        }
        if (query.includes('information_schema.tables')) {
          return Promise.resolve({ rows: [{ exists: true }] })
        }
        return Promise.resolve({ rows: [] })
      })

      const healthCheck = await presenter.performHealthCheck()

      expect(healthCheck.healthy).toBe(true)
      expect(healthCheck.issues).toHaveLength(0)
      expect(healthCheck.metrics.connectionLatency).toBeGreaterThanOrEqual(0)
    })

    it('should detect health issues when disconnected', async () => {
      presenter['connectionStatus'] = 'disconnected'

      const healthCheck = await presenter.performHealthCheck()

      expect(healthCheck.healthy).toBe(false)
      expect(healthCheck.issues).toContain('Database not connected')
    })
  })

  describe('Backup and Recovery', () => {
    it('should create recovery backup successfully', async () => {
      const backupPath = await presenter.createRecoveryBackup()

      expect(backupPath).toMatch(/\.backup\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)
    })

    it('should restore from backup successfully', async () => {
      const restored = await presenter.restoreFromBackup('/mock/backup.db')

      expect(restored).toBe(true)
    })

    it('should fail to restore from non-existent backup', async () => {
      const fs = await import('fs')
      vi.mocked(fs.default.existsSync).mockReturnValueOnce(false)

      const restored = await presenter.restoreFromBackup('/nonexistent/backup.db')

      expect(restored).toBe(false)
    })
  })
})
