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
    getSessionState: vi.fn().mockResolvedValue({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    }),
    processMessage: vi.fn().mockResolvedValue(undefined),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    getMessageIds: vi.fn().mockResolvedValue([]),
    getMessage: vi.fn().mockResolvedValue(null),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    getGenerationSettings: vi.fn().mockResolvedValue({
      systemPrompt: 'Default prompt',
      temperature: 0.7,
      contextLength: 128000,
      maxTokens: 4096
    }),
    updateGenerationSettings: vi.fn().mockImplementation((_: string, patch: any) =>
      Promise.resolve({
        systemPrompt: 'Default prompt',
        temperature: patch.temperature ?? 0.7,
        contextLength: patch.contextLength ?? 128000,
        maxTokens: patch.maxTokens ?? 4096,
        thinkingBudget: patch.thinkingBudget,
        reasoningEffort: patch.reasoningEffort,
        verbosity: patch.verbosity
      })
    )
  }
}

function createMockConfigPresenter() {
  return {
    getDefaultModel: vi.fn().mockReturnValue({ providerId: 'openai', modelId: 'gpt-4' }),
    getModelConfig: vi.fn().mockReturnValue({}),
    getSetting: vi.fn().mockReturnValue(undefined),
    getAcpAgents: vi.fn().mockResolvedValue([])
  } as any
}

function createMockLlmProviderPresenter() {
  return {
    summaryTitles: vi.fn().mockResolvedValue('Async Generated Title'),
    prepareAcpSession: vi.fn().mockResolvedValue(undefined),
    clearAcpSession: vi.fn().mockResolvedValue(undefined),
    getAcpSessionCommands: vi
      .fn()
      .mockResolvedValue([
        { name: 'review', description: 'run review', input: { hint: 'ticket id' } }
      ])
  } as any
}

function createMockSkillPresenter() {
  return {
    setActiveSkills: vi.fn().mockResolvedValue(undefined),
    clearNewAgentSessionSkills: vi.fn().mockResolvedValue(undefined)
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
      getIdsFromOrderSeq: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      getMaxOrderSeq: vi.fn().mockReturnValue(0),
      deleteBySession: vi.fn(),
      recoverPendingMessages: vi.fn().mockReturnValue(0)
    },
    deepchatMessageTracesTable: {
      listByMessageId: vi.fn().mockReturnValue([]),
      countByMessageId: vi.fn().mockReturnValue(0)
    }
  } as any
}

describe('NewAgentPresenter', () => {
  let deepChatAgent: ReturnType<typeof createMockDeepChatAgent>
  let llmProviderPresenter: ReturnType<typeof createMockLlmProviderPresenter>
  let configPresenter: ReturnType<typeof createMockConfigPresenter>
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let skillPresenter: ReturnType<typeof createMockSkillPresenter>
  let presenter: NewAgentPresenter

  beforeEach(() => {
    vi.clearAllMocks()
    deepChatAgent = createMockDeepChatAgent()
    llmProviderPresenter = createMockLlmProviderPresenter()
    configPresenter = createMockConfigPresenter()
    sqlitePresenter = createMockSqlitePresenter()
    skillPresenter = createMockSkillPresenter()
    presenter = new NewAgentPresenter(
      deepChatAgent as any,
      llmProviderPresenter,
      configPresenter,
      sqlitePresenter,
      skillPresenter
    )
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
      expect(deepChatAgent.initSession).toHaveBeenCalledWith('mock-session-id', {
        providerId: 'openai',
        modelId: 'gpt-4',
        projectDir: '/tmp/proj',
        permissionMode: 'full_access'
      })
      await new Promise((r) => setTimeout(r, 0))
      expect(deepChatAgent.processMessage).toHaveBeenCalledWith('mock-session-id', 'Hello world', {
        projectDir: '/tmp/proj'
      })
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
        modelId: 'gpt-4',
        projectDir: null,
        permissionMode: 'full_access'
      })
      // processMessage is called non-blocking, so we give it a tick
      await new Promise((r) => setTimeout(r, 0))
      expect(deepChatAgent.processMessage).toHaveBeenCalledWith('mock-session-id', 'Hello', {
        projectDir: null
      })
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
        modelId: 'gpt-4',
        projectDir: null,
        permissionMode: 'full_access'
      })
    })

    it('uses input provider/model when specified', async () => {
      await presenter.createSession(
        { agentId: 'deepchat', message: 'Hi', providerId: 'anthropic', modelId: 'claude-3' },
        1
      )

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(expect.any(String), {
        providerId: 'anthropic',
        modelId: 'claude-3',
        projectDir: null,
        permissionMode: 'full_access'
      })
    })

    it('uses input permission mode when specified', async () => {
      await presenter.createSession(
        {
          agentId: 'deepchat',
          message: 'Hi',
          providerId: 'anthropic',
          modelId: 'claude-3',
          permissionMode: 'default'
        },
        1
      )

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(expect.any(String), {
        providerId: 'anthropic',
        modelId: 'claude-3',
        projectDir: null,
        permissionMode: 'default'
      })
    })

    it('passes generationSettings to agent.initSession', async () => {
      await presenter.createSession(
        {
          agentId: 'deepchat',
          message: 'Hi',
          generationSettings: {
            systemPrompt: 'Custom prompt',
            temperature: 1.1,
            contextLength: 8192,
            maxTokens: 2048,
            reasoningEffort: 'low'
          }
        },
        1
      )

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(expect.any(String), {
        providerId: 'openai',
        modelId: 'gpt-4',
        projectDir: null,
        permissionMode: 'full_access',
        generationSettings: {
          systemPrompt: 'Custom prompt',
          temperature: 1.1,
          contextLength: 8192,
          maxTokens: 2048,
          reasoningEffort: 'low'
        }
      })
    })

    it('throws when no provider/model available', async () => {
      configPresenter.getDefaultModel.mockReturnValue(null)

      await expect(
        presenter.createSession({ agentId: 'deepchat', message: 'Hi' }, 1)
      ).rejects.toThrow('No provider or model configured')
    })

    it('applies active skills before first message processing', async () => {
      await presenter.createSession(
        {
          agentId: 'deepchat',
          message: 'Hello',
          activeSkills: ['skill-a', 'skill-b']
        },
        1
      )

      expect(skillPresenter.setActiveSkills).toHaveBeenCalledWith('mock-session-id', [
        'skill-a',
        'skill-b'
      ])
    })

    it('generates title asynchronously without blocking createSession', async () => {
      const sessions = new Map<string, any>()
      sqlitePresenter.newSessionsTable.create.mockImplementation(
        (id: string, agentId: string, title: string, projectDir: string | null) => {
          sessions.set(id, {
            id,
            agent_id: agentId,
            title,
            project_dir: projectDir,
            is_pinned: 0,
            created_at: Date.now(),
            updated_at: Date.now()
          })
        }
      )
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) => sessions.get(id))
      sqlitePresenter.newSessionsTable.update.mockImplementation((id: string, fields: any) => {
        const row = sessions.get(id)
        if (!row) return
        sessions.set(id, {
          ...row,
          ...fields,
          updated_at: Date.now()
        })
      })

      deepChatAgent.getMessages.mockResolvedValue([
        {
          id: 'u1',
          sessionId: 'mock-session-id',
          orderSeq: 1,
          role: 'user',
          content: JSON.stringify({ text: 'Please summarize this chat', files: [], links: [] }),
          status: 'sent',
          isContextEdge: 0,
          metadata: '{}',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'a1',
          sessionId: 'mock-session-id',
          orderSeq: 2,
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', content: 'Summary body', status: 'success', timestamp: Date.now() }
          ]),
          status: 'sent',
          isContextEdge: 0,
          metadata: '{}',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ])

      await presenter.createSession({ agentId: 'deepchat', message: 'Please summarize' }, 1)
      await new Promise((r) => setTimeout(r, 20))

      expect(llmProviderPresenter.summaryTitles).toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('mock-session-id', {
        title: 'Async Generated Title'
      })
    })
  })

  describe('sendMessage', () => {
    it('promotes draft session before first message', async () => {
      configPresenter.getAcpAgents.mockResolvedValue([
        { id: 'acp-coder', name: 'ACP Coder', command: 'acp-coder' }
      ])

      const row = {
        id: 's-draft',
        agent_id: 'acp-coder',
        title: 'New Chat',
        project_dir: '/tmp/workspace',
        is_pinned: 0,
        is_draft: 1,
        created_at: 1000,
        updated_at: 1000
      }
      sqlitePresenter.newSessionsTable.get.mockImplementation(() => row)
      sqlitePresenter.newSessionsTable.update.mockImplementation((_: string, fields: any) => {
        if (fields.title !== undefined) row.title = fields.title
        if (fields.is_draft !== undefined) row.is_draft = fields.is_draft
      })

      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      await presenter.sendMessage('s-draft', 'Hello ACP')

      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s-draft', {
        is_draft: 0,
        title: 'Hello ACP'
      })
      expect(eventBus.sendToRenderer).toHaveBeenCalledWith('session:list-updated', 'all')
      expect(deepChatAgent.processMessage).toHaveBeenCalledWith('s-draft', 'Hello ACP', {
        projectDir: '/tmp/workspace'
      })
    })

    it('routes to correct agent', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: '/tmp/workspace',
        is_pinned: 0,
        is_draft: 0,
        created_at: 1000,
        updated_at: 1000
      })

      await presenter.sendMessage('s1', 'Follow-up')
      expect(deepChatAgent.processMessage).toHaveBeenCalledWith('s1', 'Follow-up', {
        projectDir: '/tmp/workspace'
      })
    })

    it('throws for unknown session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)
      await expect(presenter.sendMessage('unknown', 'hi')).rejects.toThrow(
        'Session not found: unknown'
      )
    })
  })

  describe('ensureAcpDraftSession', () => {
    it('creates draft session and prepares ACP session setup', async () => {
      configPresenter.getAcpAgents.mockResolvedValue([
        { id: 'acp-coder', name: 'ACP Coder', command: 'acp-coder' }
      ])

      sqlitePresenter.newSessionsTable.list.mockReturnValue([])
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) => {
        if (id !== 'mock-session-id') return undefined
        return {
          id,
          agent_id: 'acp-coder',
          title: 'New Chat',
          project_dir: '/tmp/workspace',
          is_pinned: 0,
          is_draft: 1,
          created_at: 1000,
          updated_at: 1000
        }
      })

      deepChatAgent.getSessionState.mockResolvedValueOnce(null).mockResolvedValueOnce({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      const session = await presenter.ensureAcpDraftSession({
        agentId: 'acp-coder',
        projectDir: '/tmp/workspace'
      })

      expect(deepChatAgent.initSession).toHaveBeenCalledWith('mock-session-id', {
        providerId: 'acp',
        modelId: 'acp-coder',
        projectDir: '/tmp/workspace',
        permissionMode: 'full_access'
      })
      expect(llmProviderPresenter.prepareAcpSession).toHaveBeenCalledWith(
        'mock-session-id',
        'acp-coder',
        '/tmp/workspace'
      )
      expect(deepChatAgent.processMessage).not.toHaveBeenCalled()
      expect(session.isDraft).toBe(true)
      expect(session.providerId).toBe('acp')
    })

    it('reuses existing empty draft session for same agent and project', async () => {
      configPresenter.getAcpAgents.mockResolvedValue([
        { id: 'acp-coder', name: 'ACP Coder', command: 'acp-coder' }
      ])

      const draftRow = {
        id: 'draft-1',
        agent_id: 'acp-coder',
        title: 'New Chat',
        project_dir: '/tmp/workspace',
        is_pinned: 0,
        is_draft: 1,
        created_at: 1000,
        updated_at: 2000
      }
      sqlitePresenter.newSessionsTable.list.mockReturnValue([draftRow])
      sqlitePresenter.newSessionsTable.get.mockReturnValue(draftRow)
      deepChatAgent.getMessageIds.mockResolvedValue([])
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      const session = await presenter.ensureAcpDraftSession({
        agentId: 'acp-coder',
        projectDir: '/tmp/workspace'
      })

      expect(sqlitePresenter.newSessionsTable.create).not.toHaveBeenCalled()
      expect(llmProviderPresenter.prepareAcpSession).toHaveBeenCalledWith(
        'draft-1',
        'acp-coder',
        '/tmp/workspace'
      )
      expect(session.id).toBe('draft-1')
      expect(session.isDraft).toBe(true)
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

  describe('message traces', () => {
    it('lists message traces from sqlite table', async () => {
      sqlitePresenter.deepchatMessageTracesTable.listByMessageId.mockReturnValue([
        {
          id: 't2',
          message_id: 'm1',
          session_id: 's1',
          provider_id: 'openai',
          model_id: 'gpt-4o',
          request_seq: 2,
          endpoint: 'https://api.openai.com/v1/responses',
          headers_json: '{"authorization":"Bearer ****1234"}',
          body_json: '{"stream":true}',
          truncated: 1,
          created_at: 1234
        }
      ])

      const traces = await presenter.listMessageTraces('m1')
      expect(traces).toEqual([
        {
          id: 't2',
          messageId: 'm1',
          sessionId: 's1',
          providerId: 'openai',
          modelId: 'gpt-4o',
          requestSeq: 2,
          endpoint: 'https://api.openai.com/v1/responses',
          headersJson: '{"authorization":"Bearer ****1234"}',
          bodyJson: '{"stream":true}',
          truncated: true,
          createdAt: 1234
        }
      ])
    })

    it('returns empty list for blank message id', async () => {
      const traces = await presenter.listMessageTraces('  ')
      expect(traces).toEqual([])
      expect(sqlitePresenter.deepchatMessageTracesTable.listByMessageId).not.toHaveBeenCalled()
    })

    it('returns trace count by message id', async () => {
      sqlitePresenter.deepchatMessageTracesTable.countByMessageId.mockReturnValue(3)
      await expect(presenter.getMessageTraceCount('m1')).resolves.toBe(3)
      expect(sqlitePresenter.deepchatMessageTracesTable.countByMessageId).toHaveBeenCalledWith('m1')
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

    it('clears ACP runtime session before deleting ACP session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's-acp',
        agent_id: 'acp-coder',
        title: 'ACP Session',
        project_dir: '/tmp/workspace',
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })
      configPresenter.getAcpAgents.mockResolvedValue([
        { id: 'acp-coder', name: 'ACP Coder', command: 'acp-coder' }
      ])
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      await presenter.deleteSession('s-acp')

      expect(llmProviderPresenter.clearAcpSession).toHaveBeenCalledWith('s-acp')
      expect(deepChatAgent.destroySession).toHaveBeenCalledWith('s-acp')
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

  describe('generation settings', () => {
    it('delegates getSessionGenerationSettings to agent', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })

      const settings = await presenter.getSessionGenerationSettings('s1')

      expect(deepChatAgent.getGenerationSettings).toHaveBeenCalledWith('s1')
      expect(settings).toEqual({
        systemPrompt: 'Default prompt',
        temperature: 0.7,
        contextLength: 128000,
        maxTokens: 4096
      })
    })

    it('delegates updateSessionGenerationSettings to agent', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })

      const updated = await presenter.updateSessionGenerationSettings('s1', {
        temperature: 1.4,
        reasoningEffort: 'high'
      })

      expect(deepChatAgent.updateGenerationSettings).toHaveBeenCalledWith('s1', {
        temperature: 1.4,
        reasoningEffort: 'high'
      })
      expect(updated.temperature).toBe(1.4)
      expect(updated.reasoningEffort).toBe('high')
    })

    it('throws when generation settings methods target unknown session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)

      await expect(presenter.getSessionGenerationSettings('unknown')).rejects.toThrow(
        'Session not found: unknown'
      )
      await expect(
        presenter.updateSessionGenerationSettings('unknown', { temperature: 1 })
      ).rejects.toThrow('Session not found: unknown')
    })
  })

  describe('setSessionModel', () => {
    it('updates deepchat session model and emits LIST_UPDATED', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        permissionMode: 'full_access'
      })

      const updated = await presenter.setSessionModel('s1', 'anthropic', 'claude-3-5-sonnet')

      expect(deepChatAgent.setSessionModel).toHaveBeenCalledWith(
        's1',
        'anthropic',
        'claude-3-5-sonnet'
      )
      expect(updated.providerId).toBe('anthropic')
      expect(updated.modelId).toBe('claude-3-5-sonnet')
      expect(eventBus.sendToRenderer).toHaveBeenCalledWith('session:list-updated', 'all')
    })

    it('rejects ACP session model switching', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's-acp',
        agent_id: 'acp-coder',
        title: 'ACP',
        project_dir: '/tmp/workspace',
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })
      configPresenter.getAcpAgents.mockResolvedValue([
        { id: 'acp-coder', name: 'ACP Coder', command: 'acp-coder' }
      ])

      await expect(presenter.setSessionModel('s-acp', 'openai', 'gpt-4')).rejects.toThrow(
        'ACP session model is locked.'
      )
      expect(deepChatAgent.setSessionModel).not.toHaveBeenCalled()
    })
  })

  describe('deleteSession', () => {
    it('clears new-agent skill cache on delete', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })

      await presenter.deleteSession('s1')
      expect(skillPresenter.clearNewAgentSessionSkills).toHaveBeenCalledWith('s1')
    })
  })

  describe('getAgents', () => {
    it('returns registered agents', async () => {
      const agents = await presenter.getAgents()
      expect(agents).toHaveLength(1)
      expect(agents[0].id).toBe('deepchat')
      expect(agents[0].name).toBe('DeepChat')
    })

    it('includes ACP agents from config', async () => {
      configPresenter.getAcpAgents.mockResolvedValue([
        { id: 'acp-coder', name: 'ACP Coder', command: 'acp-coder' }
      ])

      const agents = await presenter.getAgents()
      expect(agents.some((agent: any) => agent.id === 'acp-coder' && agent.type === 'acp')).toBe(
        true
      )
    })
  })

  describe('getAcpSessionCommands', () => {
    it('returns empty list for non-ACP sessions', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })

      const commands = await presenter.getAcpSessionCommands('s1')
      expect(commands).toEqual([])
      expect(llmProviderPresenter.getAcpSessionCommands).not.toHaveBeenCalled()
    })

    it('fetches commands for ACP-backed sessions', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's-acp',
        agent_id: 'acp-coder',
        title: 'ACP',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })
      configPresenter.getAcpAgents.mockResolvedValue([
        { id: 'acp-coder', name: 'ACP Coder', command: 'acp-coder' }
      ])
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      const commands = await presenter.getAcpSessionCommands('s-acp')

      expect(llmProviderPresenter.getAcpSessionCommands).toHaveBeenCalledWith('s-acp')
      expect(commands).toHaveLength(1)
      expect(commands[0].name).toBe('review')
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
