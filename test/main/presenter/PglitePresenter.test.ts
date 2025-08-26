import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PglitePresenter } from '../../../src/main/presenter/pglitePresenter'
import fs from 'fs'
import { CONVERSATION_SETTINGS } from '../../../src/shared/presenter'

// Mock PGLite
vi.mock('@electric-sql/pglite', () => ({
  PGlite: vi.fn().mockImplementation(() => ({
    exec: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn().mockImplementation((fn) => fn()),
    close: vi.fn().mockResolvedValue(undefined)
  }))
}))

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    unlinkSync: vi.fn()
  }
}))

describe('PglitePresenter', () => {
  let presenter: PglitePresenter
  const testDbPath = '/tmp/test_chat.pglite'

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock fs.existsSync to return false for clean setup
    vi.mocked(fs.existsSync).mockReturnValue(false)
    presenter = new PglitePresenter(testDbPath)
  })

  afterEach(async () => {
    if (presenter) {
      await presenter.close()
    }
  })

  describe('Interface Compatibility', () => {
    it('should implement ISQLitePresenter interface', () => {
      // Check that all required methods exist
      expect(typeof presenter.close).toBe('function')
      expect(typeof presenter.createConversation).toBe('function')
      expect(typeof presenter.deleteConversation).toBe('function')
      expect(typeof presenter.renameConversation).toBe('function')
      expect(typeof presenter.getConversation).toBe('function')
      expect(typeof presenter.updateConversation).toBe('function')
      expect(typeof presenter.getConversationList).toBe('function')
      expect(typeof presenter.getConversationCount).toBe('function')
      expect(typeof presenter.insertMessage).toBe('function')
      expect(typeof presenter.queryMessages).toBe('function')
      expect(typeof presenter.deleteAllMessages).toBe('function')
      expect(typeof presenter.runTransaction).toBe('function')
      expect(typeof presenter.getMessage).toBe('function')
      expect(typeof presenter.getMessageVariants).toBe('function')
      expect(typeof presenter.updateMessage).toBe('function')
      expect(typeof presenter.deleteMessage).toBe('function')
      expect(typeof presenter.getMaxOrderSeq).toBe('function')
      expect(typeof presenter.addMessageAttachment).toBe('function')
      expect(typeof presenter.getMessageAttachments).toBe('function')
      expect(typeof presenter.getLastUserMessage).toBe('function')
      expect(typeof presenter.getMainMessageByParentId).toBe('function')
      expect(typeof presenter.deleteAllMessagesInConversation).toBe('function')
    })

    it('should create conversation with correct interface', async () => {
      const mockPgLite = (presenter as any).pgLite
      mockPgLite.query.mockResolvedValueOnce({ rows: [] })

      const settings: Partial<CONVERSATION_SETTINGS> = {
        systemPrompt: 'Test prompt',
        temperature: 0.8,
        contextLength: 4000,
        maxTokens: 2000
      }

      const conversationId = await presenter.createConversation('Test Conversation', settings)

      expect(typeof conversationId).toBe('string')
      expect(conversationId).toHaveLength(21) // nanoid generates 21 character IDs by default
      expect(mockPgLite.query).toHaveBeenCalled()
    })

    it('should get conversation with correct format', async () => {
      const mockPgLite = (presenter as any).pgLite
      const mockConversation = {
        conv_id: 'test-conv-id',
        title: 'Test Conversation',
        created_at: Date.now(),
        updated_at: Date.now(),
        system_prompt: 'Test prompt',
        temperature: 0.7,
        context_length: 4000,
        max_tokens: 2000,
        provider_id: 'openai',
        model_id: 'gpt-4',
        is_new: 1,
        artifacts: 0,
        is_pinned: 0,
        enabled_mcp_tools: '[]',
        thinking_budget: null,
        reasoning_effort: null,
        verbosity: null
      }

      mockPgLite.query.mockResolvedValueOnce({ rows: [mockConversation] })

      const conversation = await presenter.getConversation('test-conv-id')

      expect(conversation).toEqual({
        id: 'test-conv-id',
        title: 'Test Conversation',
        createdAt: mockConversation.created_at,
        updatedAt: mockConversation.updated_at,
        systemPrompt: 'Test prompt',
        temperature: 0.7,
        contextLength: 4000,
        maxTokens: 2000,
        providerId: 'openai',
        modelId: 'gpt-4',
        isNew: 1,
        artifacts: 0,
        isPinned: 0,
        enabledMcpTools: [],
        thinkingBudget: null,
        reasoningEffort: null,
        verbosity: null
      })
    })

    it('should insert message with correct interface', async () => {
      const mockPgLite = (presenter as any).pgLite
      mockPgLite.query.mockResolvedValueOnce({ rows: [] })

      const messageId = await presenter.insertMessage(
        'conv-id',
        'Hello world',
        'user',
        'parent-id',
        '{}',
        1,
        10,
        'pending',
        0,
        0
      )

      expect(typeof messageId).toBe('string')
      expect(messageId).toHaveLength(21) // nanoid generates 21 character IDs
      expect(mockPgLite.query).toHaveBeenCalled()
    })

    it('should query messages with correct format', async () => {
      const mockPgLite = (presenter as any).pgLite
      const mockMessage = {
        message_id: 'msg-id',
        conv_id: 'conv-id',
        parent_id: 'parent-id',
        role: 'user',
        content: 'Hello world',
        created_at: Date.now(),
        order_seq: 1,
        token_count: 10,
        status: 'pending',
        metadata: '{}',
        is_context_edge: 0,
        is_variant: 0
      }

      mockPgLite.query.mockResolvedValueOnce({ rows: [mockMessage] })

      const messages = await presenter.queryMessages('conv-id')

      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual({
        id: 'msg-id',
        conversation_id: 'conv-id',
        parent_id: 'parent-id',
        role: 'user',
        content: 'Hello world',
        created_at: mockMessage.created_at,
        order_seq: 1,
        token_count: 10,
        status: 'pending',
        metadata: '{}',
        is_context_edge: 0,
        is_variant: 0
      })
    })

    it('should handle transaction correctly', async () => {
      const mockPgLite = (presenter as any).pgLite
      const transactionFn = vi.fn().mockResolvedValue(undefined)

      await presenter.runTransaction(transactionFn)

      expect(mockPgLite.transaction).toHaveBeenCalledWith(transactionFn)
    })
  })

  describe('Database Operations', () => {
    it('should handle conversation list with pagination', async () => {
      const mockPgLite = (presenter as any).pgLite
      const mockConversations = [
        {
          conv_id: 'conv1',
          title: 'Conversation 1',
          created_at: Date.now(),
          updated_at: Date.now(),
          system_prompt: '',
          temperature: 0.7,
          context_length: 4000,
          max_tokens: 2000,
          provider_id: 'openai',
          model_id: 'gpt-4',
          is_new: 0,
          artifacts: 0,
          is_pinned: 0,
          enabled_mcp_tools: '[]',
          thinking_budget: null,
          reasoning_effort: null,
          verbosity: null
        }
      ]

      mockPgLite.query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] }) // count query
        .mockResolvedValueOnce({ rows: mockConversations }) // list query

      const result = await presenter.getConversationList(1, 10)

      expect(result).toEqual({
        total: 1,
        list: expect.arrayContaining([
          expect.objectContaining({
            id: 'conv1',
            title: 'Conversation 1'
          })
        ])
      })
    })

    it('should handle message attachments', async () => {
      const mockPgLite = (presenter as any).pgLite
      mockPgLite.query.mockResolvedValueOnce({ rows: [] })

      await presenter.addMessageAttachment('msg-id', 'image', 'base64data')

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO message_attachments'),
        expect.arrayContaining(['msg-id', 'image', 'base64data'])
      )
    })

    it('should get message attachments with correct format', async () => {
      const mockPgLite = (presenter as any).pgLite
      mockPgLite.query.mockResolvedValueOnce({
        rows: [{ attachment_data: 'base64data' }]
      })

      const attachments = await presenter.getMessageAttachments('msg-id', 'image')

      expect(attachments).toEqual([{ content: 'base64data' }])
    })
  })

  describe('Error Handling', () => {
    it('should throw error when conversation not found', async () => {
      const mockPgLite = (presenter as any).pgLite
      mockPgLite.query.mockResolvedValueOnce({ rows: [] })

      await expect(presenter.getConversation('non-existent')).rejects.toThrow(
        'Conversation not found: non-existent'
      )
    })

    it('should return null when message not found', async () => {
      const mockPgLite = (presenter as any).pgLite
      mockPgLite.query.mockResolvedValueOnce({ rows: [] })

      const message = await presenter.getMessage('non-existent')

      expect(message).toBeNull()
    })
  })

  describe('Data Conversion', () => {
    it('should convert camelCase to snake_case correctly', () => {
      const camelToSnake = (presenter as any).camelToSnake

      expect(camelToSnake('enabledMcpTools')).toBe('enabled_mcp_tools')
      expect(camelToSnake('isContextEdge')).toBe('is_context_edge')
      expect(camelToSnake('reasoningEffort')).toBe('reasoning_effort')
    })

    it('should handle JSON fields correctly', async () => {
      const mockPgLite = (presenter as any).pgLite
      const mockConversation = {
        conv_id: 'test-id',
        title: 'Test',
        created_at: Date.now(),
        updated_at: Date.now(),
        system_prompt: '',
        temperature: 0.7,
        context_length: 4000,
        max_tokens: 2000,
        provider_id: 'openai',
        model_id: 'gpt-4',
        is_new: 0,
        artifacts: 0,
        is_pinned: 0,
        enabled_mcp_tools: '["tool1", "tool2"]', // JSON string
        thinking_budget: null,
        reasoning_effort: null,
        verbosity: null
      }

      mockPgLite.query.mockResolvedValueOnce({ rows: [mockConversation] })

      const conversation = await presenter.getConversation('test-id')

      expect(conversation.enabledMcpTools).toEqual(['tool1', 'tool2'])
    })
  })
})
