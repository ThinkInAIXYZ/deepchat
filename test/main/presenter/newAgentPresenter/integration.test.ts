import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NewAgentPresenter } from '@/presenter/newAgentPresenter/index'
import { DeepChatAgentPresenter } from '@/presenter/deepchatAgentPresenter/index'
import { NewSessionHooksBridge } from '@/presenter/hooksNotifications/newSessionBridge'

vi.mock('nanoid', () => {
  let counter = 0
  return { nanoid: vi.fn(() => `id-${++counter}`) }
})

vi.mock('@/eventbus', () => ({
  eventBus: { sendToRenderer: vi.fn(), sendToMain: vi.fn(), on: vi.fn() },
  SendTarget: { ALL_WINDOWS: 'all' }
}))

vi.mock('@/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/events')>()
  return {
    ...actual,
    SESSION_EVENTS: {
      LIST_UPDATED: 'session:list-updated',
      ACTIVATED: 'session:activated',
      DEACTIVATED: 'session:deactivated',
      STATUS_CHANGED: 'session:status-changed',
      COMPACTION_UPDATED: 'session:compaction-updated'
    },
    STREAM_EVENTS: {
      RESPONSE: 'stream:response',
      END: 'stream:end',
      ERROR: 'stream:error'
    }
  }
})

vi.mock('@/presenter', () => ({
  presenter: {
    commandPermissionService: {
      extractCommandSignature: vi.fn().mockReturnValue('mock-signature'),
      approve: vi.fn(),
      clearConversation: vi.fn()
    },
    filePermissionService: { approve: vi.fn(), clearConversation: vi.fn() },
    settingsPermissionService: { approve: vi.fn(), clearConversation: vi.fn() },
    mcpPresenter: {
      grantPermission: vi.fn().mockResolvedValue(undefined)
    }
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
      create: vi.fn(
        (
          id: string,
          agentId: string,
          title: string,
          projectDir: string | null,
          options?: { isDraft?: boolean }
        ) => {
          const now = Date.now()
          sessionsStore.set(id, {
            id,
            agent_id: agentId,
            title,
            project_dir: projectDir,
            is_pinned: 0,
            is_draft: options?.isDraft ? 1 : 0,
            created_at: now,
            updated_at: now
          })
        }
      ),
      get: vi.fn((id: string) => sessionsStore.get(id)),
      list: vi.fn(() => Array.from(sessionsStore.values())),
      getDisabledAgentTools: vi.fn().mockReturnValue([]),
      updateDisabledAgentTools: vi.fn(),
      update: vi.fn(),
      delete: vi.fn((id: string) => sessionsStore.delete(id))
    },
    deepchatSessionsTable: {
      create: vi.fn(
        (
          id: string,
          providerId: string,
          modelId: string,
          permissionMode: 'default' | 'full_access' = 'full_access',
          generationSettings: {
            systemPrompt?: string
            temperature?: number
            contextLength?: number
            maxTokens?: number
            thinkingBudget?: number
            reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
            verbosity?: 'low' | 'medium' | 'high'
          } = {}
        ) => {
          deepchatSessionsStore.set(id, {
            id,
            provider_id: providerId,
            model_id: modelId,
            permission_mode: permissionMode,
            system_prompt: generationSettings.systemPrompt ?? null,
            temperature: generationSettings.temperature ?? null,
            context_length: generationSettings.contextLength ?? null,
            max_tokens: generationSettings.maxTokens ?? null,
            thinking_budget: generationSettings.thinkingBudget ?? null,
            reasoning_effort: generationSettings.reasoningEffort ?? null,
            verbosity: generationSettings.verbosity ?? null,
            summary_text: null,
            summary_cursor_order_seq: 1,
            summary_updated_at: null
          })
        }
      ),
      get: vi.fn((id: string) => deepchatSessionsStore.get(id)),
      getGenerationSettings: vi.fn((id: string) => {
        const row = deepchatSessionsStore.get(id)
        if (!row) return null
        return {
          ...(row.system_prompt !== null ? { systemPrompt: row.system_prompt } : {}),
          ...(row.temperature !== null ? { temperature: row.temperature } : {}),
          ...(row.context_length !== null ? { contextLength: row.context_length } : {}),
          ...(row.max_tokens !== null ? { maxTokens: row.max_tokens } : {}),
          ...(row.thinking_budget !== null ? { thinkingBudget: row.thinking_budget } : {}),
          ...(row.reasoning_effort !== null ? { reasoningEffort: row.reasoning_effort } : {}),
          ...(row.verbosity !== null ? { verbosity: row.verbosity } : {})
        }
      }),
      getSummaryState: vi.fn((id: string) => {
        const row = deepchatSessionsStore.get(id)
        if (!row) {
          return null
        }
        return {
          summary_text: row.summary_text ?? null,
          summary_cursor_order_seq: row.summary_cursor_order_seq ?? 1,
          summary_updated_at: row.summary_updated_at ?? null
        }
      }),
      updatePermissionMode: vi.fn((id: string, mode: 'default' | 'full_access') => {
        const row = deepchatSessionsStore.get(id)
        if (row) {
          row.permission_mode = mode
        }
      }),
      updateSessionModel: vi.fn((id: string, providerId: string, modelId: string) => {
        const row = deepchatSessionsStore.get(id)
        if (!row) return
        row.provider_id = providerId
        row.model_id = modelId
      }),
      updateGenerationSettings: vi.fn((id: string, settings: Record<string, unknown>) => {
        const row = deepchatSessionsStore.get(id)
        if (!row) return
        if ('systemPrompt' in settings) row.system_prompt = settings.systemPrompt ?? null
        if ('temperature' in settings) row.temperature = settings.temperature ?? null
        if ('contextLength' in settings) row.context_length = settings.contextLength ?? null
        if ('maxTokens' in settings) row.max_tokens = settings.maxTokens ?? null
        if ('thinkingBudget' in settings) row.thinking_budget = settings.thinkingBudget ?? null
        if ('reasoningEffort' in settings) row.reasoning_effort = settings.reasoningEffort ?? null
        if ('verbosity' in settings) row.verbosity = settings.verbosity ?? null
      }),
      updateSummaryState: vi.fn(
        (
          id: string,
          state: {
            summaryText: string | null
            summaryCursorOrderSeq: number
            summaryUpdatedAt: number | null
          }
        ) => {
          const row = deepchatSessionsStore.get(id)
          if (!row) return
          row.summary_text = state.summaryText
          row.summary_cursor_order_seq = state.summaryCursorOrderSeq
          row.summary_updated_at = state.summaryUpdatedAt
        }
      ),
      updateSummaryStateIfMatches: vi.fn(
        (
          id: string,
          state: {
            summaryText: string | null
            summaryCursorOrderSeq: number
            summaryUpdatedAt: number | null
          },
          expectedState: {
            summaryText: string | null
            summaryCursorOrderSeq: number
            summaryUpdatedAt: number | null
          }
        ) => {
          const row = deepchatSessionsStore.get(id)
          if (!row) return false
          if (
            row.summary_text !== (expectedState.summaryText ?? null) ||
            row.summary_cursor_order_seq !== (expectedState.summaryCursorOrderSeq ?? 1) ||
            row.summary_updated_at !== (expectedState.summaryUpdatedAt ?? null)
          ) {
            return false
          }

          row.summary_text = state.summaryText ?? null
          row.summary_cursor_order_seq = state.summaryCursorOrderSeq ?? 1
          row.summary_updated_at = state.summaryUpdatedAt ?? null
          return true
        }
      ),
      resetSummaryState: vi.fn((id: string) => {
        const row = deepchatSessionsStore.get(id)
        if (!row) return
        row.summary_text = null
        row.summary_cursor_order_seq = 1
        row.summary_updated_at = null
      }),
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
          metadata: row.metadata ?? '{}',
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
      getBySessionUpToOrderSeq: vi.fn((sessionId: string, maxOrderSeq: number) => {
        return messagesList
          .filter((m) => m.session_id === sessionId && m.order_seq <= maxOrderSeq)
          .sort((a: any, b: any) => a.order_seq - b.order_seq)
      }),
      getByStatus: vi.fn((status: string) =>
        messagesList.filter((m) => m.status === status).sort((a, b) => b.updated_at - a.updated_at)
      ),
      getIdsBySession: vi.fn((sessionId: string) => {
        return messagesList
          .filter((m) => m.session_id === sessionId)
          .sort((a: any, b: any) => a.order_seq - b.order_seq)
          .map((m: any) => m.id)
      }),
      getIdsFromOrderSeq: vi.fn((sessionId: string, fromOrderSeq: number) => {
        return messagesList
          .filter((m) => m.session_id === sessionId && m.order_seq >= fromOrderSeq)
          .map((m: any) => m.id)
      }),
      get: vi.fn((id: string) => messagesStore.get(id)),
      getLastUserMessageBeforeOrAtOrderSeq: vi.fn((sessionId: string, orderSeq: number) => {
        return messagesList
          .filter((m) => m.session_id === sessionId && m.role === 'user' && m.order_seq <= orderSeq)
          .sort((a: any, b: any) => b.order_seq - a.order_seq)[0]
      }),
      getMaxOrderSeq: vi.fn((sessionId: string) => {
        const msgs = messagesList.filter((m) => m.session_id === sessionId)
        if (msgs.length === 0) return 0
        return Math.max(...msgs.map((m: any) => m.order_seq))
      }),
      delete: vi.fn((id: string) => {
        messagesStore.delete(id)
        messagesList = messagesList.filter((item) => item.id !== id)
      }),
      deleteFromOrderSeq: vi.fn((sessionId: string, fromOrderSeq: number) => {
        const idsToDelete = messagesList
          .filter((m) => m.session_id === sessionId && m.order_seq >= fromOrderSeq)
          .map((m) => m.id)

        messagesList = messagesList.filter(
          (m) => !(m.session_id === sessionId && m.order_seq >= fromOrderSeq)
        )
        for (const id of idsToDelete) {
          messagesStore.delete(id)
        }
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
    deepchatMessageTracesTable: {
      insert: vi.fn().mockReturnValue(1),
      listByMessageId: vi.fn().mockReturnValue([]),
      countByMessageId: vi.fn().mockReturnValue(0),
      deleteByMessageIds: vi.fn(),
      deleteBySessionId: vi.fn()
    },
    deepchatMessageSearchResultsTable: {
      add: vi.fn(),
      listByMessageId: vi.fn().mockReturnValue([]),
      deleteByMessageIds: vi.fn(),
      deleteBySessionId: vi.fn()
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
    }),
    generateText: vi.fn().mockResolvedValue({
      content: ['## Current Goal', '- Continue the conversation'].join('\n')
    }),
    summaryTitles: vi.fn().mockResolvedValue('Generated Integration Title')
  } as any
}

function createMockConfigPresenter() {
  return {
    getDefaultModel: vi.fn().mockReturnValue({ providerId: 'openai', modelId: 'gpt-4' }),
    getModelConfig: vi
      .fn()
      .mockReturnValue({ temperature: 0.7, maxTokens: 4096, contextLength: 128000 }),
    getDefaultSystemPrompt: vi.fn().mockResolvedValue('You are a helpful assistant.'),
    getAutoCompactionEnabled: vi.fn().mockReturnValue(true),
    getAutoCompactionTriggerThreshold: vi.fn().mockReturnValue(80),
    getAutoCompactionRetainRecentPairs: vi.fn().mockReturnValue(2),
    supportsReasoningCapability: vi.fn().mockReturnValue(false),
    getThinkingBudgetRange: vi.fn().mockReturnValue({}),
    supportsReasoningEffortCapability: vi.fn().mockReturnValue(false),
    getReasoningEffortDefault: vi.fn().mockReturnValue(undefined),
    supportsVerbosityCapability: vi.fn().mockReturnValue(false),
    getVerbosityDefault: vi.fn().mockReturnValue(undefined),
    getSkillsEnabled: vi.fn().mockReturnValue(false),
    getSetting: vi.fn().mockReturnValue(undefined),
    getAcpAgents: vi.fn().mockResolvedValue([])
  } as any
}

function createMockToolPresenter() {
  return {
    getAllToolDefinitions: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockResolvedValue({
      content: 'tool result',
      rawData: { toolCallId: 'tc1', content: 'tool result', isError: false }
    }),
    buildToolSystemPrompt: vi.fn().mockReturnValue('')
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

    const deepchatAgent = new DeepChatAgentPresenter(
      llmProvider,
      configPresenter,
      sqlitePresenter,
      createMockToolPresenter()
    )
    agentPresenter = new NewAgentPresenter(
      deepchatAgent as any,
      llmProvider,
      configPresenter,
      sqlitePresenter
    )
  })

  it('createSession → new_sessions row + deepchat_sessions row + messages + events', async () => {
    const session = await agentPresenter.createSession(
      {
        agentId: 'deepchat',
        message: 'Tell me a joke',
        files: [
          {
            name: 'notes.txt',
            path: '/tmp/proj/notes.txt',
            mimeType: 'text/plain',
            content: 'hello file'
          } as any
        ],
        projectDir: '/tmp/proj'
      },
      1
    )

    // Wait for non-blocking processMessage to complete
    await new Promise((r) => setTimeout(r, 50))

    // 1. new_sessions row created
    expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
      expect.any(String),
      'deepchat',
      'Tell me a joke',
      '/tmp/proj',
      expect.objectContaining({ isDraft: false })
    )

    // 2. deepchat_sessions row created
    expect(sqlitePresenter.deepchatSessionsTable.create).toHaveBeenCalledWith(
      expect.any(String),
      'openai',
      'gpt-4',
      'full_access',
      expect.objectContaining({
        systemPrompt: 'You are a helpful assistant.',
        temperature: 0.7,
        contextLength: 128000,
        maxTokens: 4096
      })
    )

    // 3. Messages created (user + assistant)
    expect(sqlitePresenter.deepchatMessagesTable.insert).toHaveBeenCalledTimes(2)

    const userInsert = sqlitePresenter.deepchatMessagesTable.insert.mock.calls[0][0]
    expect(userInsert.role).toBe('user')
    const userContent = JSON.parse(userInsert.content)
    expect(userContent.text).toBe('Tell me a joke')
    expect(userContent.files).toHaveLength(1)

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

  it('clearSessionMessages clears messages but keeps session row', async () => {
    const session = await agentPresenter.createSession(
      { agentId: 'deepchat', message: 'To clear' },
      1
    )

    await new Promise((r) => setTimeout(r, 50))

    await agentPresenter.clearSessionMessages(session.id)

    expect(sqlitePresenter.deepchatMessagesTable.deleteBySession).toHaveBeenCalledWith(session.id)
    expect(sqlitePresenter.newSessionsTable.delete).not.toHaveBeenCalledWith(session.id)

    const remainingSession = sqlitePresenter.newSessionsTable.get(session.id)
    expect(remainingSession).toBeTruthy()
  })
})

describe('Integration: ACP hooks bridge', () => {
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let llmProvider: ReturnType<typeof createMockLlmProviderPresenter>
  let configPresenter: ReturnType<typeof createMockConfigPresenter>
  let agentPresenter: NewAgentPresenter
  let hookDispatcher: { dispatchEvent: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    sqlitePresenter = createMockSqlitePresenter()
    llmProvider = createMockLlmProviderPresenter()
    configPresenter = createMockConfigPresenter()
    configPresenter.getAcpAgents.mockResolvedValue([{ id: 'coder', name: 'Coder' }])
    hookDispatcher = { dispatchEvent: vi.fn() }

    const deepchatAgent = new DeepChatAgentPresenter(
      llmProvider,
      configPresenter,
      sqlitePresenter,
      createMockToolPresenter(),
      new NewSessionHooksBridge(hookDispatcher)
    )
    agentPresenter = new NewAgentPresenter(
      deepchatAgent as any,
      llmProvider,
      configPresenter,
      sqlitePresenter
    )
  })

  it('dispatches lifecycle hooks for ACP sessions through the new bridge', async () => {
    const session = await agentPresenter.createSession(
      {
        agentId: 'coder',
        providerId: 'acp',
        modelId: 'coder',
        message: 'Inspect workspace',
        projectDir: '/tmp/acp-project'
      },
      1
    )

    await new Promise((r) => setTimeout(r, 50))

    expect(session.agentId).toBe('coder')
    expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
      'UserPromptSubmit',
      expect.objectContaining({
        conversationId: session.id,
        agentId: 'coder',
        workdir: '/tmp/acp-project',
        providerId: 'acp',
        modelId: 'coder',
        promptPreview: 'Inspect workspace'
      })
    )
    expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
      'SessionStart',
      expect.objectContaining({
        conversationId: session.id,
        agentId: 'coder',
        workdir: '/tmp/acp-project',
        providerId: 'acp',
        modelId: 'coder'
      })
    )
    expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
      'Stop',
      expect.objectContaining({
        conversationId: session.id,
        stop: expect.objectContaining({ userStop: false })
      })
    )
    expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
      'SessionEnd',
      expect.objectContaining({
        conversationId: session.id
      })
    )
  })
})

describe('Integration: multi-turn context', () => {
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let llmProvider: ReturnType<typeof createMockLlmProviderPresenter>
  let configPresenter: ReturnType<typeof createMockConfigPresenter>
  let agentPresenter: NewAgentPresenter

  beforeEach(() => {
    vi.clearAllMocks()
    sqlitePresenter = createMockSqlitePresenter()
    llmProvider = createMockLlmProviderPresenter()
    configPresenter = createMockConfigPresenter()

    const deepchatAgent = new DeepChatAgentPresenter(
      llmProvider,
      configPresenter,
      sqlitePresenter,
      createMockToolPresenter()
    )
    agentPresenter = new NewAgentPresenter(
      deepchatAgent as any,
      llmProvider,
      configPresenter,
      sqlitePresenter
    )
  })

  it('second message includes first exchange in LLM context', async () => {
    // Send first message
    const session = await agentPresenter.createSession(
      { agentId: 'deepchat', message: 'Hello', projectDir: null },
      1
    )

    // Wait for first processMessage to complete
    await new Promise((r) => setTimeout(r, 50))

    // Send second message
    await agentPresenter.sendMessage(session.id, 'Follow up question')

    // Wait for second processMessage to complete
    await new Promise((r) => setTimeout(r, 50))

    // Verify coreStream was called twice
    const providerInstance = llmProvider.getProviderInstance.mock.results[0].value
    expect(providerInstance.coreStream).toHaveBeenCalledTimes(2)

    // Second call should include history
    const secondCallMessages = providerInstance.coreStream.mock.calls[1][0]
    expect(secondCallMessages[0].role).toBe('system')
    expect(secondCallMessages[0].content).toContain('You are a helpful assistant.')
    expect(secondCallMessages[0].content).toContain('## Runtime Capabilities')
    // Should contain prior user and assistant messages before the new user message
    expect(secondCallMessages.length).toBeGreaterThanOrEqual(3) // system + at least history + new user
    expect(secondCallMessages[secondCallMessages.length - 1]).toEqual({
      role: 'user',
      content: 'Follow up question'
    })
  })

  it('supports both string and object sendMessage input', async () => {
    const session = await agentPresenter.createSession(
      { agentId: 'deepchat', message: 'Hello', projectDir: null },
      1
    )
    await new Promise((r) => setTimeout(r, 50))

    await agentPresenter.sendMessage(session.id, 'Follow up (string)')
    await new Promise((r) => setTimeout(r, 50))

    await agentPresenter.sendMessage(session.id, {
      text: 'Follow up (object)',
      files: [{ name: 'a.md', path: '/tmp/a.md', mimeType: 'text/markdown', content: '# a' } as any]
    })
    await new Promise((r) => setTimeout(r, 50))

    const messages = sqlitePresenter.deepchatMessagesTable.getBySession(session.id)
    const userMessages = messages.filter((m: any) => m.role === 'user')
    const lastUser = userMessages[userMessages.length - 1]
    expect(lastUser).toBeTruthy()
    const lastUserContent = JSON.parse(lastUser.content)
    expect(lastUserContent.text).toBe('Follow up (object)')
    expect(lastUserContent.files).toHaveLength(1)
  })
})

describe('Integration: crash recovery', () => {
  it('pending messages are recovered to error status on init', () => {
    const sqlitePresenter = createMockSqlitePresenter()
    const llmProvider = createMockLlmProviderPresenter()
    const configPresenter = createMockConfigPresenter()

    sqlitePresenter.deepchatMessagesTable.getByStatus.mockReturnValue([
      {
        id: 'm1',
        role: 'assistant',
        content: JSON.stringify([{ type: 'content', status: 'pending', timestamp: 1 }])
      },
      {
        id: 'm2',
        role: 'assistant',
        content: JSON.stringify([{ type: 'content', status: 'pending', timestamp: 1 }])
      }
    ])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Creating the agent triggers crash recovery
    new DeepChatAgentPresenter(
      llmProvider,
      configPresenter,
      sqlitePresenter,
      createMockToolPresenter()
    )

    expect(sqlitePresenter.deepchatMessagesTable.getByStatus).toHaveBeenCalledWith('pending')
    expect(sqlitePresenter.deepchatMessagesTable.updateStatus).toHaveBeenCalledTimes(2)
    expect(consoleSpy).toHaveBeenCalledWith(
      'DeepChatAgent: recovered 2 pending messages to error status'
    )

    consoleSpy.mockRestore()
  })
})
