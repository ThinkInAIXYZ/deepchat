import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeepChatAgentPresenter } from '@/presenter/deepchatAgentPresenter/index'

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'mock-msg-id') }))

// Mock eventBus
vi.mock('@/eventbus', () => ({
  eventBus: { sendToRenderer: vi.fn() },
  SendTarget: { ALL_WINDOWS: 'all' }
}))

vi.mock('@/events', () => ({
  SESSION_EVENTS: {
    LIST_UPDATED: 'session:list-updated',
    ACTIVATED: 'session:activated',
    DEACTIVATED: 'session:deactivated',
    STATUS_CHANGED: 'session:status-changed'
  },
  STREAM_EVENTS: {
    RESPONSE: 'stream:response',
    END: 'stream:end',
    ERROR: 'stream:error'
  }
}))

// Mock streamHandler to avoid timer/async complexity
vi.mock('@/presenter/deepchatAgentPresenter/streamHandler', () => ({
  handleStream: vi.fn().mockResolvedValue(undefined)
}))

import { eventBus } from '@/eventbus'
import { handleStream } from '@/presenter/deepchatAgentPresenter/streamHandler'

function createMockSqlitePresenter() {
  return {
    deepchatSessionsTable: {
      create: vi.fn(),
      get: vi.fn(),
      delete: vi.fn()
    },
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

function createMockCoreStream() {
  return async function* () {
    yield { type: 'text', content: 'Hello' }
    yield { type: 'stop', stop_reason: 'end_turn' }
  }
}

function createMockLlmProviderPresenter() {
  return {
    getProviderInstance: vi.fn().mockReturnValue({
      coreStream: vi.fn().mockReturnValue(createMockCoreStream()())
    })
  } as any
}

function createMockConfigPresenter() {
  return {
    getModelConfig: vi.fn().mockReturnValue({ temperature: 0.7, maxTokens: 4096 }),
    getDefaultModel: vi.fn().mockReturnValue({ providerId: 'openai', modelId: 'gpt-4' })
  } as any
}

describe('DeepChatAgentPresenter', () => {
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let llmProvider: ReturnType<typeof createMockLlmProviderPresenter>
  let configPresenter: ReturnType<typeof createMockConfigPresenter>
  let agent: DeepChatAgentPresenter

  beforeEach(() => {
    vi.clearAllMocks()
    sqlitePresenter = createMockSqlitePresenter()
    llmProvider = createMockLlmProviderPresenter()
    configPresenter = createMockConfigPresenter()
    agent = new DeepChatAgentPresenter(llmProvider, configPresenter, sqlitePresenter)
  })

  describe('constructor (crash recovery)', () => {
    it('calls recoverPendingMessages on init', () => {
      expect(sqlitePresenter.deepchatMessagesTable.recoverPendingMessages).toHaveBeenCalledTimes(1)
    })

    it('logs recovered count when > 0', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      sqlitePresenter.deepchatMessagesTable.recoverPendingMessages.mockReturnValue(5)

      new DeepChatAgentPresenter(llmProvider, configPresenter, sqlitePresenter)

      expect(consoleSpy).toHaveBeenCalledWith(
        'DeepChatAgent: recovered 5 pending messages to error status'
      )
      consoleSpy.mockRestore()
    })
  })

  describe('initSession', () => {
    it('creates DB session and sets runtime state', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })

      expect(sqlitePresenter.deepchatSessionsTable.create).toHaveBeenCalledWith(
        's1',
        'openai',
        'gpt-4'
      )

      const state = await agent.getSessionState('s1')
      expect(state).toEqual({
        status: 'idle',
        providerId: 'openai',
        modelId: 'gpt-4'
      })
    })
  })

  describe('getSessionState', () => {
    it('returns runtime state if available', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      const state = await agent.getSessionState('s1')
      expect(state!.status).toBe('idle')
    })

    it('rebuilds from DB when runtime state missing', async () => {
      sqlitePresenter.deepchatSessionsTable.get.mockReturnValue({
        id: 's1',
        provider_id: 'openai',
        model_id: 'gpt-4'
      })

      const state = await agent.getSessionState('s1')
      expect(state).toEqual({
        status: 'idle',
        providerId: 'openai',
        modelId: 'gpt-4'
      })
    })

    it('returns null for unknown session', async () => {
      sqlitePresenter.deepchatSessionsTable.get.mockReturnValue(undefined)
      const state = await agent.getSessionState('unknown')
      expect(state).toBeNull()
    })
  })

  describe('processMessage', () => {
    it('creates user and assistant messages with correct order_seq', async () => {
      sqlitePresenter.deepchatMessagesTable.getMaxOrderSeq
        .mockReturnValueOnce(0) // user message: seq 1
        .mockReturnValueOnce(1) // assistant message: seq 2

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      // User message insert
      const userInsert = sqlitePresenter.deepchatMessagesTable.insert.mock.calls[0][0]
      expect(userInsert.role).toBe('user')
      expect(userInsert.orderSeq).toBe(1)
      expect(userInsert.status).toBe('sent')
      expect(JSON.parse(userInsert.content)).toEqual({
        text: 'Hello',
        files: [],
        links: [],
        search: false,
        think: false
      })

      // Assistant message insert
      const assistantInsert = sqlitePresenter.deepchatMessagesTable.insert.mock.calls[1][0]
      expect(assistantInsert.role).toBe('assistant')
      expect(assistantInsert.orderSeq).toBe(2)
      expect(assistantInsert.status).toBe('pending')
      expect(assistantInsert.content).toBe('[]')
    })

    it('calls LLM coreStream with correct parameters', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      const providerInstance = llmProvider.getProviderInstance.mock.results[0].value
      expect(providerInstance.coreStream).toHaveBeenCalledWith(
        [{ role: 'user', content: 'Hello' }],
        'gpt-4',
        expect.any(Object),
        0.7,
        4096,
        []
      )
    })

    it('calls handleStream with correct context', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      expect(handleStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sessionId: 's1',
          messageId: 'mock-msg-id'
        })
      )
    })

    it('transitions status: idle → generating → idle', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      // Should emit generating then idle
      const statusCalls = (eventBus.sendToRenderer as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any[]) => c[0] === 'session:status-changed'
      )
      expect(statusCalls).toHaveLength(2)
      expect(statusCalls[0][2]).toEqual({ sessionId: 's1', status: 'generating' })
      expect(statusCalls[1][2]).toEqual({ sessionId: 's1', status: 'idle' })
    })

    it('transitions to error status on exception', async () => {
      ;(handleStream as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('LLM failed'))

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      const statusCalls = (eventBus.sendToRenderer as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any[]) => c[0] === 'session:status-changed'
      )
      expect(statusCalls[statusCalls.length - 1][2]).toEqual({
        sessionId: 's1',
        status: 'error'
      })
    })

    it('throws for unknown session', async () => {
      await expect(agent.processMessage('unknown', 'hi')).rejects.toThrow(
        'Session unknown not found'
      )
    })
  })

  describe('destroySession', () => {
    it('cleans up messages, session record, and runtime state', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.destroySession('s1')

      expect(sqlitePresenter.deepchatMessagesTable.deleteBySession).toHaveBeenCalledWith('s1')
      expect(sqlitePresenter.deepchatSessionsTable.delete).toHaveBeenCalledWith('s1')

      const state = await agent.getSessionState('s1')
      // State should be rebuilt from DB (which returns undefined) → null
      expect(state).toBeNull()
    })

    it('aborts in-progress generation', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })

      // Start a message that won't complete immediately
      let streamResolve: () => void
      ;(handleStream as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            streamResolve = r
          })
      )
      const processPromise = agent.processMessage('s1', 'Hello')

      // Destroy while processing
      await agent.destroySession('s1')

      // Resolve the stream to avoid hanging
      streamResolve!()
      await processPromise.catch(() => {}) // ignore error from status update on destroyed session
    })
  })

  describe('cancelGeneration', () => {
    it('sets status back to idle', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.cancelGeneration('s1')

      const state = await agent.getSessionState('s1')
      expect(state!.status).toBe('idle')
    })
  })

  describe('getMessages / getMessageIds / getMessage', () => {
    it('delegates to messageStore', async () => {
      const messages = await agent.getMessages('s1')
      expect(messages).toEqual([])

      const ids = await agent.getMessageIds('s1')
      expect(ids).toEqual([])

      sqlitePresenter.deepchatMessagesTable.get.mockReturnValue(undefined)
      const msg = await agent.getMessage('nonexistent')
      expect(msg).toBeNull()
    })
  })
})
