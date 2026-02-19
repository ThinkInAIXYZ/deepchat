import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NewAgentPresenter } from '@/presenter/newAgentPresenter/index'

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'mock-session-id') }))

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
  }
}))

import { eventBus } from '@/eventbus'

function createMockDeepChatAgent() {
  return {
    initSession: vi.fn().mockResolvedValue(undefined),
    destroySession: vi.fn().mockResolvedValue(undefined),
    getSessionState: vi
      .fn()
      .mockResolvedValue({ status: 'idle', providerId: 'openai', modelId: 'gpt-4' }),
    processMessage: vi.fn().mockResolvedValue(undefined),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    getMessageIds: vi.fn().mockResolvedValue([]),
    getMessage: vi.fn().mockResolvedValue(null)
  }
}

function createMockConfigPresenter() {
  return {
    getDefaultModel: vi.fn().mockReturnValue({ providerId: 'openai', modelId: 'gpt-4' }),
    getModelConfig: vi.fn().mockReturnValue({})
  } as any
}

function createMockSqlitePresenter() {
  return {
    newSessionsTable: {
      create: vi.fn(),
      get: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      update: vi.fn(),
      delete: vi.fn()
    },
    newProjectsTable: {
      getAll: vi.fn().mockReturnValue([]),
      getRecent: vi.fn().mockReturnValue([])
    },
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

describe('NewAgentPresenter', () => {
  let deepChatAgent: ReturnType<typeof createMockDeepChatAgent>
  let configPresenter: ReturnType<typeof createMockConfigPresenter>
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let presenter: NewAgentPresenter

  beforeEach(() => {
    vi.clearAllMocks()
    deepChatAgent = createMockDeepChatAgent()
    configPresenter = createMockConfigPresenter()
    sqlitePresenter = createMockSqlitePresenter()
    presenter = new NewAgentPresenter(deepChatAgent as any, configPresenter, sqlitePresenter)
  })

  describe('createSession', () => {
    it('creates session with correct parameters', async () => {
      const result = await presenter.createSession(
        { agentId: 'deepchat', message: 'Hello world', projectDir: '/tmp/proj' },
        1
      )

      expect(result.id).toBe('mock-session-id')
      expect(result.agentId).toBe('deepchat')
      expect(result.title).toBe('Hello world')
      expect(result.projectDir).toBe('/tmp/proj')
      expect(result.status).toBe('idle')
    })

    it('derives title from first 50 chars of message', async () => {
      const longMessage = 'A'.repeat(100)
      const result = await presenter.createSession({ agentId: 'deepchat', message: longMessage }, 1)

      expect(result.title).toBe('A'.repeat(50))
    })

    it('defaults to "New Chat" when message is empty', async () => {
      const result = await presenter.createSession({ agentId: 'deepchat', message: '' }, 1)

      expect(result.title).toBe('New Chat')
    })

    it('calls agent.initSession and processMessage', async () => {
      await presenter.createSession({ agentId: 'deepchat', message: 'Hello' }, 1)

      expect(deepChatAgent.initSession).toHaveBeenCalledWith('mock-session-id', {
        providerId: 'openai',
        modelId: 'gpt-4'
      })
      // processMessage is called non-blocking, so we give it a tick
      await new Promise((r) => setTimeout(r, 0))
      expect(deepChatAgent.processMessage).toHaveBeenCalledWith('mock-session-id', 'Hello')
    })

    it('emits ACTIVATED and LIST_UPDATED events', async () => {
      await presenter.createSession({ agentId: 'deepchat', message: 'Hello' }, 42)

      expect(eventBus.sendToRenderer).toHaveBeenCalledWith('session:activated', 'all', {
        webContentsId: 42,
        sessionId: 'mock-session-id'
      })
      expect(eventBus.sendToRenderer).toHaveBeenCalledWith('session:list-updated', 'all')
    })

    it('uses default provider/model from config when not specified', async () => {
      await presenter.createSession({ agentId: 'deepchat', message: 'Hi' }, 1)

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(expect.any(String), {
        providerId: 'openai',
        modelId: 'gpt-4'
      })
    })

    it('uses input provider/model when specified', async () => {
      await presenter.createSession(
        { agentId: 'deepchat', message: 'Hi', providerId: 'anthropic', modelId: 'claude-3' },
        1
      )

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(expect.any(String), {
        providerId: 'anthropic',
        modelId: 'claude-3'
      })
    })

    it('throws when no provider/model available', async () => {
      configPresenter.getDefaultModel.mockReturnValue(null)

      await expect(
        presenter.createSession({ agentId: 'deepchat', message: 'Hi' }, 1)
      ).rejects.toThrow('No provider or model configured')
    })
  })

  describe('sendMessage', () => {
    it('routes to correct agent', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })

      await presenter.sendMessage('s1', 'Follow-up')
      expect(deepChatAgent.processMessage).toHaveBeenCalledWith('s1', 'Follow-up')
    })

    it('throws for unknown session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)
      await expect(presenter.sendMessage('unknown', 'hi')).rejects.toThrow(
        'Session not found: unknown'
      )
    })
  })

  describe('getSessionList', () => {
    it('enriches sessions with agent state', async () => {
      sqlitePresenter.newSessionsTable.list.mockReturnValue([
        {
          id: 's1',
          agent_id: 'deepchat',
          title: 'Chat 1',
          project_dir: null,
          is_pinned: 0,
          created_at: 1000,
          updated_at: 2000
        }
      ])

      const sessions = await presenter.getSessionList()
      expect(sessions).toHaveLength(1)
      expect(sessions[0].status).toBe('idle')
      expect(sessions[0].providerId).toBe('openai')
      expect(sessions[0].modelId).toBe('gpt-4')
    })
  })

  describe('getSession', () => {
    it('returns enriched session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })

      const session = await presenter.getSession('s1')
      expect(session).not.toBeNull()
      expect(session!.status).toBe('idle')
    })

    it('returns null for unknown session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)
      expect(await presenter.getSession('unknown')).toBeNull()
    })
  })

  describe('activateSession', () => {
    it('binds window and emits ACTIVATED', async () => {
      await presenter.activateSession(42, 's1')
      expect(eventBus.sendToRenderer).toHaveBeenCalledWith('session:activated', 'all', {
        webContentsId: 42,
        sessionId: 's1'
      })
    })
  })

  describe('deactivateSession', () => {
    it('unbinds window and emits DEACTIVATED', async () => {
      await presenter.deactivateSession(42)
      expect(eventBus.sendToRenderer).toHaveBeenCalledWith('session:deactivated', 'all', {
        webContentsId: 42
      })
    })
  })

  describe('deleteSession', () => {
    it('destroys agent session, deletes record, emits LIST_UPDATED', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })

      await presenter.deleteSession('s1')
      expect(deepChatAgent.destroySession).toHaveBeenCalledWith('s1')
      expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith('s1')
      expect(eventBus.sendToRenderer).toHaveBeenCalledWith('session:list-updated', 'all')
    })

    it('no-ops for unknown session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)
      await presenter.deleteSession('unknown') // should not throw
      expect(deepChatAgent.destroySession).not.toHaveBeenCalled()
    })
  })

  describe('cancelGeneration', () => {
    it('delegates to agent', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })

      await presenter.cancelGeneration('s1')
      expect(deepChatAgent.cancelGeneration).toHaveBeenCalledWith('s1')
    })
  })

  describe('getAgents', () => {
    it('returns registered agents', async () => {
      const agents = await presenter.getAgents()
      expect(agents).toHaveLength(1)
      expect(agents[0].id).toBe('deepchat')
      expect(agents[0].name).toBe('DeepChat')
    })
  })

  describe('getActiveSession', () => {
    it('returns null when no session bound', async () => {
      expect(await presenter.getActiveSession(99)).toBeNull()
    })

    it('returns session when bound', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })

      await presenter.activateSession(1, 's1')
      const session = await presenter.getActiveSession(1)
      expect(session).not.toBeNull()
      expect(session!.id).toBe('s1')
    })
  })
})
