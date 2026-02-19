import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NewAgentPresenter } from '@/presenter/newAgentPresenter/index'
import { DeepChatAgentPresenter } from '@/presenter/deepchatAgentPresenter/index'

vi.mock('nanoid', () => {
  let counter = 0
  return { nanoid: vi.fn(() => `id-${++counter}`) }
})

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

import { eventBus } from '@/eventbus'

function createMockSqlitePresenter() {
  // In-memory storage for integration-level testing
  const sessionsStore = new Map<string, any>()
  const deepchatSessionsStore = new Map<string, any>()
  const messagesStore = new Map<string, any>()
  let messagesList: any[] = []

  return {
    newSessionsTable: {
      create: vi.fn((id: string, agentId: string, title: string, projectDir: string | null) => {
        const now = Date.now()
        sessionsStore.set(id, {
          id,
          agent_id: agentId,
          title,
          project_dir: projectDir,
          is_pinned: 0,
          created_at: now,
          updated_at: now
        })
      }),
      get: vi.fn((id: string) => sessionsStore.get(id)),
      list: vi.fn(() => Array.from(sessionsStore.values())),
      update: vi.fn(),
      delete: vi.fn((id: string) => sessionsStore.delete(id))
    },
    deepchatSessionsTable: {
      create: vi.fn((id: string, providerId: string, modelId: string) => {
        deepchatSessionsStore.set(id, { id, provider_id: providerId, model_id: modelId })
      }),
      get: vi.fn((id: string) => deepchatSessionsStore.get(id)),
      delete: vi.fn((id: string) => deepchatSessionsStore.delete(id))
    },
    deepchatMessagesTable: {
      insert: vi.fn((row: any) => {
        const now = Date.now()
        const record = {
          ...row,
          session_id: row.sessionId,
          order_seq: row.orderSeq,
          is_context_edge: 0,
          metadata: '{}',
          created_at: now,
          updated_at: now
        }
        messagesStore.set(row.id, record)
        messagesList.push(record)
      }),
      updateContent: vi.fn((id: string, content: string) => {
        const msg = messagesStore.get(id)
        if (msg) msg.content = content
      }),
      updateContentAndStatus: vi.fn(
        (id: string, content: string, status: string, metadata?: string) => {
          const msg = messagesStore.get(id)
          if (msg) {
            msg.content = content
            msg.status = status
            if (metadata) msg.metadata = metadata
          }
        }
      ),
      updateStatus: vi.fn((id: string, status: string) => {
        const msg = messagesStore.get(id)
        if (msg) msg.status = status
      }),
      getBySession: vi.fn((sessionId: string) => {
        return messagesList
          .filter((m) => m.session_id === sessionId)
          .sort((a: any, b: any) => a.order_seq - b.order_seq)
      }),
      getIdsBySession: vi.fn((sessionId: string) => {
        return messagesList
          .filter((m) => m.session_id === sessionId)
          .sort((a: any, b: any) => a.order_seq - b.order_seq)
          .map((m: any) => m.id)
      }),
      get: vi.fn((id: string) => messagesStore.get(id)),
      getMaxOrderSeq: vi.fn((sessionId: string) => {
        const msgs = messagesList.filter((m) => m.session_id === sessionId)
        if (msgs.length === 0) return 0
        return Math.max(...msgs.map((m: any) => m.order_seq))
      }),
      deleteBySession: vi.fn((sessionId: string) => {
        messagesList = messagesList.filter((m) => m.session_id !== sessionId)
        for (const [id, msg] of messagesStore) {
          if (msg.session_id === sessionId) messagesStore.delete(id)
        }
      }),
      recoverPendingMessages: vi.fn(() => {
        let count = 0
        for (const msg of messagesStore.values()) {
          if (msg.status === 'pending') {
            msg.status = 'error'
            count++
          }
        }
        return count
      })
    },
    // Expose internal stores for assertion
    _sessionsStore: sessionsStore,
    _deepchatSessionsStore: deepchatSessionsStore,
    _messagesStore: messagesStore,
    _getMessagesList: () => messagesList
  } as any
}

function createMockLlmProviderPresenter() {
  return {
    getProviderInstance: vi.fn().mockReturnValue({
      coreStream: vi.fn(function () {
        return (async function* () {
          yield { type: 'text', content: 'Hello from LLM' }
          yield {
            type: 'usage',
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
          }
          yield { type: 'stop', stop_reason: 'end_turn' }
        })()
      })
    })
  } as any
}

function createMockConfigPresenter() {
  return {
    getDefaultModel: vi.fn().mockReturnValue({ providerId: 'openai', modelId: 'gpt-4' }),
    getModelConfig: vi.fn().mockReturnValue({ temperature: 0.7, maxTokens: 4096 })
  } as any
}

describe('Integration: createSession end-to-end', () => {
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let llmProvider: ReturnType<typeof createMockLlmProviderPresenter>
  let configPresenter: ReturnType<typeof createMockConfigPresenter>
  let agentPresenter: NewAgentPresenter

  beforeEach(() => {
    vi.clearAllMocks()
    sqlitePresenter = createMockSqlitePresenter()
    llmProvider = createMockLlmProviderPresenter()
    configPresenter = createMockConfigPresenter()

    const deepchatAgent = new DeepChatAgentPresenter(llmProvider, configPresenter, sqlitePresenter)
    agentPresenter = new NewAgentPresenter(deepchatAgent as any, configPresenter, sqlitePresenter)
  })

  it('createSession → new_sessions row + deepchat_sessions row + messages + events', async () => {
    const session = await agentPresenter.createSession(
      { agentId: 'deepchat', message: 'Tell me a joke', projectDir: '/tmp/proj' },
      1
    )

    // Wait for non-blocking processMessage to complete
    await new Promise((r) => setTimeout(r, 50))

    // 1. new_sessions row created
    expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
      expect.any(String),
      'deepchat',
      'Tell me a joke',
      '/tmp/proj'
    )

    // 2. deepchat_sessions row created
    expect(sqlitePresenter.deepchatSessionsTable.create).toHaveBeenCalledWith(
      expect.any(String),
      'openai',
      'gpt-4'
    )

    // 3. Messages created (user + assistant)
    expect(sqlitePresenter.deepchatMessagesTable.insert).toHaveBeenCalledTimes(2)

    const userInsert = sqlitePresenter.deepchatMessagesTable.insert.mock.calls[0][0]
    expect(userInsert.role).toBe('user')
    const userContent = JSON.parse(userInsert.content)
    expect(userContent.text).toBe('Tell me a joke')

    const assistantInsert = sqlitePresenter.deepchatMessagesTable.insert.mock.calls[1][0]
    expect(assistantInsert.role).toBe('assistant')
    expect(assistantInsert.status).toBe('pending')

    // 4. Assistant message finalized with content
    expect(sqlitePresenter.deepchatMessagesTable.updateContentAndStatus).toHaveBeenCalled()

    // 5. Events emitted with conversationId
    const activatedCalls = (eventBus.sendToRenderer as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: any[]) => c[0] === 'session:activated'
    )
    expect(activatedCalls.length).toBeGreaterThanOrEqual(1)
    expect(activatedCalls[0][2].webContentsId).toBe(1)
    expect(activatedCalls[0][2].sessionId).toBe(session.id)

    // Stream events should carry conversationId (sessionId)
    const streamEndCalls = (eventBus.sendToRenderer as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: any[]) => c[0] === 'stream:end'
    )
    expect(streamEndCalls.length).toBeGreaterThanOrEqual(1)
    expect(streamEndCalls[0][2].conversationId).toBe(session.id)
  })

  it('session list returns enriched sessions', async () => {
    await agentPresenter.createSession({ agentId: 'deepchat', message: 'Hello' }, 1)

    // Wait for processMessage to complete
    await new Promise((r) => setTimeout(r, 50))

    const sessions = await agentPresenter.getSessionList()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].status).toBe('idle')
    expect(sessions[0].providerId).toBe('openai')
  })

  it('deleteSession cleans up all data', async () => {
    const session = await agentPresenter.createSession(
      { agentId: 'deepchat', message: 'To delete' },
      1
    )

    await new Promise((r) => setTimeout(r, 50))

    await agentPresenter.deleteSession(session.id)

    expect(sqlitePresenter.deepchatMessagesTable.deleteBySession).toHaveBeenCalledWith(session.id)
    expect(sqlitePresenter.deepchatSessionsTable.delete).toHaveBeenCalledWith(session.id)
    expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith(session.id)
  })
})

describe('Integration: crash recovery', () => {
  it('pending messages are recovered to error status on init', () => {
    const sqlitePresenter = createMockSqlitePresenter()
    const llmProvider = createMockLlmProviderPresenter()
    const configPresenter = createMockConfigPresenter()

    // Simulate a pending message in the DB
    sqlitePresenter.deepchatMessagesTable.recoverPendingMessages.mockReturnValue(2)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Creating the agent triggers crash recovery
    new DeepChatAgentPresenter(llmProvider, configPresenter, sqlitePresenter)

    expect(sqlitePresenter.deepchatMessagesTable.recoverPendingMessages).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      'DeepChatAgent: recovered 2 pending messages to error status'
    )

    consoleSpy.mockRestore()
  })
})
