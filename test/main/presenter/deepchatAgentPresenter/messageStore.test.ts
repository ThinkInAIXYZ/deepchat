import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeepChatMessageStore } from '@/presenter/deepchatAgentPresenter/messageStore'

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'mock-msg-id') }))

function createMockSqlitePresenter() {
  return {
    deepchatMessagesTable: {
      insert: vi.fn(),
      updateContent: vi.fn(),
      updateContentAndStatus: vi.fn(),
      getBySession: vi.fn().mockReturnValue([]),
      getIdsBySession: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      getMaxOrderSeq: vi.fn().mockReturnValue(0),
      deleteBySession: vi.fn(),
      recoverPendingMessages: vi.fn().mockReturnValue(0)
    }
  } as any
}

describe('DeepChatMessageStore', () => {
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let store: DeepChatMessageStore

  beforeEach(() => {
    sqlitePresenter = createMockSqlitePresenter()
    store = new DeepChatMessageStore(sqlitePresenter)
  })

  describe('createUserMessage', () => {
    it('inserts a user message with JSON content', () => {
      const content = { text: 'hello', files: [], links: [], search: false, think: false }
      const id = store.createUserMessage('s1', 1, content)

      expect(id).toBe('mock-msg-id')
      expect(sqlitePresenter.deepchatMessagesTable.insert).toHaveBeenCalledWith({
        id: 'mock-msg-id',
        sessionId: 's1',
        orderSeq: 1,
        role: 'user',
        content: JSON.stringify(content),
        status: 'sent'
      })
    })
  })

  describe('createAssistantMessage', () => {
    it('inserts a pending assistant message with empty blocks', () => {
      const id = store.createAssistantMessage('s1', 2)

      expect(id).toBe('mock-msg-id')
      expect(sqlitePresenter.deepchatMessagesTable.insert).toHaveBeenCalledWith({
        id: 'mock-msg-id',
        sessionId: 's1',
        orderSeq: 2,
        role: 'assistant',
        content: '[]',
        status: 'pending'
      })
    })
  })

  describe('updateAssistantContent', () => {
    it('updates content as JSON', () => {
      const blocks = [
        { type: 'content' as const, content: 'hi', status: 'pending' as const, timestamp: 1000 }
      ]
      store.updateAssistantContent('m1', blocks)

      expect(sqlitePresenter.deepchatMessagesTable.updateContent).toHaveBeenCalledWith(
        'm1',
        JSON.stringify(blocks)
      )
    })
  })

  describe('finalizeAssistantMessage', () => {
    it('updates content, status to sent, and metadata', () => {
      const blocks = [
        { type: 'content' as const, content: 'done', status: 'success' as const, timestamp: 1000 }
      ]
      const metadata = '{"totalTokens":100}'
      store.finalizeAssistantMessage('m1', blocks, metadata)

      expect(sqlitePresenter.deepchatMessagesTable.updateContentAndStatus).toHaveBeenCalledWith(
        'm1',
        JSON.stringify(blocks),
        'sent',
        metadata
      )
    })
  })

  describe('setMessageError', () => {
    it('updates content and status to error', () => {
      const blocks = [
        { type: 'error' as const, content: 'failed', status: 'error' as const, timestamp: 1000 }
      ]
      store.setMessageError('m1', blocks)

      expect(sqlitePresenter.deepchatMessagesTable.updateContentAndStatus).toHaveBeenCalledWith(
        'm1',
        JSON.stringify(blocks),
        'error'
      )
    })
  })

  describe('getMessages', () => {
    it('maps DB rows to ChatMessageRecord', () => {
      sqlitePresenter.deepchatMessagesTable.getBySession.mockReturnValue([
        {
          id: 'm1',
          session_id: 's1',
          order_seq: 1,
          role: 'user',
          content: '{"text":"hi"}',
          status: 'sent',
          is_context_edge: 0,
          metadata: '{}',
          created_at: 1000,
          updated_at: 1000
        }
      ])

      const messages = store.getMessages('s1')
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual({
        id: 'm1',
        sessionId: 's1',
        orderSeq: 1,
        role: 'user',
        content: '{"text":"hi"}',
        status: 'sent',
        isContextEdge: 0,
        metadata: '{}',
        createdAt: 1000,
        updatedAt: 1000
      })
    })
  })

  describe('getMessageIds', () => {
    it('delegates to table', () => {
      sqlitePresenter.deepchatMessagesTable.getIdsBySession.mockReturnValue(['m1', 'm2'])
      expect(store.getMessageIds('s1')).toEqual(['m1', 'm2'])
    })
  })

  describe('getMessage', () => {
    it('returns mapped record when found', () => {
      sqlitePresenter.deepchatMessagesTable.get.mockReturnValue({
        id: 'm1',
        session_id: 's1',
        order_seq: 1,
        role: 'user',
        content: '{}',
        status: 'sent',
        is_context_edge: 0,
        metadata: '{}',
        created_at: 1000,
        updated_at: 1000
      })

      const msg = store.getMessage('m1')
      expect(msg).not.toBeNull()
      expect(msg!.sessionId).toBe('s1')
    })

    it('returns null when not found', () => {
      sqlitePresenter.deepchatMessagesTable.get.mockReturnValue(undefined)
      expect(store.getMessage('missing')).toBeNull()
    })
  })

  describe('getNextOrderSeq', () => {
    it('returns max + 1', () => {
      sqlitePresenter.deepchatMessagesTable.getMaxOrderSeq.mockReturnValue(5)
      expect(store.getNextOrderSeq('s1')).toBe(6)
    })

    it('returns 1 when no messages exist', () => {
      sqlitePresenter.deepchatMessagesTable.getMaxOrderSeq.mockReturnValue(0)
      expect(store.getNextOrderSeq('s1')).toBe(1)
    })
  })

  describe('deleteBySession', () => {
    it('delegates to table', () => {
      store.deleteBySession('s1')
      expect(sqlitePresenter.deepchatMessagesTable.deleteBySession).toHaveBeenCalledWith('s1')
    })
  })

  describe('recoverPendingMessages', () => {
    it('delegates and returns count', () => {
      sqlitePresenter.deepchatMessagesTable.recoverPendingMessages.mockReturnValue(3)
      expect(store.recoverPendingMessages()).toBe(3)
    })
  })
})
