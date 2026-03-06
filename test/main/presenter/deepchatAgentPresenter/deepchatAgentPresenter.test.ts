import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

vi.mock('@/presenter', () => ({
  presenter: {
    skillPresenter: {
      getMetadataList: vi.fn().mockResolvedValue([]),
      getActiveSkills: vi.fn().mockResolvedValue([]),
      loadSkillContent: vi.fn().mockResolvedValue(null)
    },
    commandPermissionService: {
      extractCommandSignature: vi.fn().mockReturnValue('mock-signature'),
      approve: vi.fn()
    },
    filePermissionService: { approve: vi.fn() },
    settingsPermissionService: { approve: vi.fn() },
    mcpPresenter: {
      grantPermission: vi.fn().mockResolvedValue(undefined)
    }
  }
}))

vi.mock('@/presenter/agentPresenter/message/systemEnvPromptBuilder', () => ({
  buildRuntimeCapabilitiesPrompt: vi.fn(() => 'RUNTIME_CAPABILITIES'),
  buildSystemEnvPrompt: vi.fn(
    async (options?: { providerId?: string; modelId?: string; now?: Date }) => {
      const providerId = options?.providerId || 'unknown-provider'
      const modelId = options?.modelId || 'unknown-model'
      const dateText = (options?.now ?? new Date()).toDateString()
      return ['ENV_BLOCK', `MODEL:${providerId}/${modelId}`, `DATE:${dateText}`].join('\n')
    }
  )
}))

// Mock processStream to avoid timer/async complexity
vi.mock('@/presenter/deepchatAgentPresenter/process', () => ({
  processStream: vi.fn().mockResolvedValue({ status: 'completed' })
}))

import { eventBus } from '@/eventbus'
import { processStream } from '@/presenter/deepchatAgentPresenter/process'
import { presenter } from '@/presenter'
import { buildSystemEnvPrompt } from '@/presenter/agentPresenter/message/systemEnvPromptBuilder'

function createMockSqlitePresenter() {
  const summaryState = {
    summary_text: null,
    summary_cursor_order_seq: 1,
    summary_updated_at: null
  }
  return {
    deepchatSessionsTable: {
      create: vi.fn(),
      get: vi.fn(),
      getGenerationSettings: vi.fn(),
      getSummaryState: vi.fn(() => ({ ...summaryState })),
      updatePermissionMode: vi.fn(),
      updateGenerationSettings: vi.fn(),
      updateSummaryState: vi.fn((_id: string, nextState: any) => {
        summaryState.summary_text = nextState.summaryText ?? null
        summaryState.summary_cursor_order_seq = nextState.summaryCursorOrderSeq ?? 1
        summaryState.summary_updated_at = nextState.summaryUpdatedAt ?? null
      }),
      resetSummaryState: vi.fn(() => {
        summaryState.summary_text = null
        summaryState.summary_cursor_order_seq = 1
        summaryState.summary_updated_at = null
      }),
      delete: vi.fn()
    },
    deepchatMessagesTable: {
      insert: vi.fn(),
      updateContent: vi.fn(),
      updateStatus: vi.fn(),
      updateContentAndStatus: vi.fn(),
      getBySession: vi.fn().mockReturnValue([]),
      getByStatus: vi.fn().mockReturnValue([]),
      getIdsBySession: vi.fn().mockReturnValue([]),
      getIdsFromOrderSeq: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      getMaxOrderSeq: vi.fn().mockReturnValue(0),
      deleteBySession: vi.fn(),
      deleteFromOrderSeq: vi.fn(),
      recoverPendingMessages: vi.fn().mockReturnValue(0)
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
    }),
    generateText: vi.fn().mockResolvedValue({
      content: ['## Current Goal', '- Continue the session safely'].join('\n')
    })
  } as any
}

function createMockConfigPresenter() {
  return {
    getModelConfig: vi.fn().mockReturnValue({
      temperature: 0.7,
      maxTokens: 4096,
      contextLength: 128000,
      thinkingBudget: 512,
      reasoningEffort: 'medium',
      verbosity: 'medium'
    }),
    getDefaultModel: vi.fn().mockReturnValue({ providerId: 'openai', modelId: 'gpt-4' }),
    getDefaultSystemPrompt: vi.fn().mockResolvedValue('You are a helpful assistant.'),
    supportsReasoningCapability: vi.fn().mockReturnValue(true),
    getThinkingBudgetRange: vi.fn().mockReturnValue({ min: 0, max: 8192, default: 512 }),
    supportsReasoningEffortCapability: vi.fn().mockReturnValue(true),
    getReasoningEffortDefault: vi.fn().mockReturnValue('medium'),
    supportsVerbosityCapability: vi.fn().mockReturnValue(true),
    getVerbosityDefault: vi.fn().mockReturnValue('medium'),
    getSkillsEnabled: vi.fn().mockReturnValue(true),
    getSetting: vi.fn().mockReturnValue(undefined)
  } as any
}

function createMockToolPresenter(toolDefs: any[] = []) {
  return {
    getAllToolDefinitions: vi.fn().mockResolvedValue(toolDefs),
    callTool: vi.fn().mockResolvedValue({
      content: 'tool result',
      rawData: { toolCallId: 'tc1', content: 'tool result', isError: false }
    }),
    buildToolSystemPrompt: vi.fn().mockReturnValue('')
  } as any
}

describe('DeepChatAgentPresenter', () => {
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let llmProvider: ReturnType<typeof createMockLlmProviderPresenter>
  let configPresenter: ReturnType<typeof createMockConfigPresenter>
  let toolPresenter: ReturnType<typeof createMockToolPresenter>
  let agent: DeepChatAgentPresenter

  beforeEach(() => {
    vi.clearAllMocks()
    const skillPresenter = presenter.skillPresenter as {
      getMetadataList: ReturnType<typeof vi.fn>
      getActiveSkills: ReturnType<typeof vi.fn>
      loadSkillContent: ReturnType<typeof vi.fn>
    }
    skillPresenter.getMetadataList.mockResolvedValue([])
    skillPresenter.getActiveSkills.mockResolvedValue([])
    skillPresenter.loadSkillContent.mockResolvedValue(null)
    sqlitePresenter = createMockSqlitePresenter()
    llmProvider = createMockLlmProviderPresenter()
    configPresenter = createMockConfigPresenter()
    toolPresenter = createMockToolPresenter()
    agent = new DeepChatAgentPresenter(llmProvider, configPresenter, sqlitePresenter, toolPresenter)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('constructor (crash recovery)', () => {
    it('calls pending status query on init', () => {
      expect(sqlitePresenter.deepchatMessagesTable.getByStatus).toHaveBeenCalledWith('pending')
    })

    it('logs recovered count when > 0', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      sqlitePresenter.deepchatMessagesTable.getByStatus.mockReturnValue([
        {
          id: 'm1',
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', content: 'partial', status: 'pending', timestamp: 1 }
          ])
        }
      ])

      new DeepChatAgentPresenter(llmProvider, configPresenter, sqlitePresenter, toolPresenter)

      expect(consoleSpy).toHaveBeenCalledWith(
        'DeepChatAgent: recovered 1 pending messages to error status'
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
        'gpt-4',
        'full_access',
        expect.objectContaining({
          systemPrompt: 'You are a helpful assistant.',
          temperature: 0.7,
          contextLength: 128000,
          maxTokens: 4096
        })
      )

      const state = await agent.getSessionState('s1')
      expect(state).toEqual({
        status: 'idle',
        providerId: 'openai',
        modelId: 'gpt-4',
        permissionMode: 'full_access'
      })
    })

    it('applies provided permission mode', async () => {
      await agent.initSession('s1', {
        providerId: 'openai',
        modelId: 'gpt-4',
        permissionMode: 'default'
      })

      expect(sqlitePresenter.deepchatSessionsTable.create).toHaveBeenCalledWith(
        's1',
        'openai',
        'gpt-4',
        'default',
        expect.objectContaining({
          systemPrompt: 'You are a helpful assistant.',
          temperature: 0.7,
          contextLength: 128000,
          maxTokens: 4096
        })
      )

      const state = await agent.getSessionState('s1')
      expect(state?.permissionMode).toBe('default')
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
        model_id: 'gpt-4',
        permission_mode: 'full_access'
      })

      const state = await agent.getSessionState('s1')
      expect(state).toEqual({
        status: 'idle',
        providerId: 'openai',
        modelId: 'gpt-4',
        permissionMode: 'full_access'
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

    it('calls processStream with correct params', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      expect(processStream).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'openai',
          modelId: 'gpt-4',
          io: expect.objectContaining({
            sessionId: 's1',
            messageId: 'mock-msg-id'
          })
        })
      )
    })

    it('includes conversation history in LLM call', async () => {
      // Set up: first user message already in DB as sent
      const existingMessages = [
        {
          id: 'prev-user',
          session_id: 's1',
          order_seq: 1,
          role: 'user',
          content: JSON.stringify({
            text: 'First message',
            files: [],
            links: [],
            search: false,
            think: false
          }),
          status: 'sent',
          is_context_edge: 0,
          metadata: '{}',
          created_at: Date.now(),
          updated_at: Date.now()
        },
        {
          id: 'prev-asst',
          session_id: 's1',
          order_seq: 2,
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', content: 'First reply', status: 'success', timestamp: Date.now() }
          ]),
          status: 'sent',
          is_context_edge: 0,
          metadata: '{}',
          created_at: Date.now(),
          updated_at: Date.now()
        }
      ]
      sqlitePresenter.deepchatMessagesTable.getBySession.mockReturnValue(existingMessages)

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Second message')

      // processStream should receive messages with history
      const callArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArgs.messages[0].role).toBe('system')
      expect(callArgs.messages[0].content).toContain('RUNTIME_CAPABILITIES')
      expect(callArgs.messages[0].content).toContain('You are a helpful assistant.')
      expect(callArgs.messages.slice(1)).toEqual([
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First reply' },
        { role: 'user', content: 'Second message' }
      ])
    })

    it('compacts old turns into summary before building prompt', async () => {
      const longUser = 'U'.repeat(2400)
      const longAssistant = 'A'.repeat(2400)
      sqlitePresenter.deepchatMessagesTable.getBySession.mockReturnValue([
        {
          id: 'u1',
          session_id: 's1',
          order_seq: 1,
          role: 'user',
          content: JSON.stringify({
            text: longUser,
            files: [],
            links: [],
            search: false,
            think: false
          }),
          status: 'sent',
          is_context_edge: 0,
          metadata: '{}',
          created_at: Date.now(),
          updated_at: Date.now()
        },
        {
          id: 'a1',
          session_id: 's1',
          order_seq: 2,
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', content: longAssistant, status: 'success', timestamp: Date.now() }
          ]),
          status: 'sent',
          is_context_edge: 0,
          metadata: '{}',
          created_at: Date.now(),
          updated_at: Date.now()
        },
        {
          id: 'u2',
          session_id: 's1',
          order_seq: 3,
          role: 'user',
          content: JSON.stringify({
            text: longUser,
            files: [],
            links: [],
            search: false,
            think: false
          }),
          status: 'sent',
          is_context_edge: 0,
          metadata: '{}',
          created_at: Date.now(),
          updated_at: Date.now()
        },
        {
          id: 'a2',
          session_id: 's1',
          order_seq: 4,
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', content: longAssistant, status: 'success', timestamp: Date.now() }
          ]),
          status: 'sent',
          is_context_edge: 0,
          metadata: '{}',
          created_at: Date.now(),
          updated_at: Date.now()
        },
        {
          id: 'u3',
          session_id: 's1',
          order_seq: 5,
          role: 'user',
          content: JSON.stringify({
            text: longUser,
            files: [],
            links: [],
            search: false,
            think: false
          }),
          status: 'sent',
          is_context_edge: 0,
          metadata: '{}',
          created_at: Date.now(),
          updated_at: Date.now()
        },
        {
          id: 'a3',
          session_id: 's1',
          order_seq: 6,
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', content: longAssistant, status: 'success', timestamp: Date.now() }
          ]),
          status: 'sent',
          is_context_edge: 0,
          metadata: '{}',
          created_at: Date.now(),
          updated_at: Date.now()
        }
      ])

      await agent.initSession('s1', {
        providerId: 'openai',
        modelId: 'gpt-4',
        generationSettings: {
          contextLength: 2500,
          maxTokens: 512
        }
      })
      await agent.processMessage('s1', 'new prompt')

      expect(llmProvider.generateText).toHaveBeenCalledTimes(1)
      expect(sqlitePresenter.deepchatSessionsTable.updateSummaryState).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          summaryText: expect.stringContaining('## Current Goal'),
          summaryCursorOrderSeq: 3
        })
      )

      const callArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArgs.messages[0].content).toContain('## Conversation Summary')
    })

    it('keeps runtime and env sections when user system prompt is empty', async () => {
      configPresenter.getDefaultSystemPrompt.mockResolvedValue('')

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      const callArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArgs.messages[0].role).toBe('system')
      expect(callArgs.messages[0].content).toContain('RUNTIME_CAPABILITIES')
      expect(callArgs.messages[0].content).toContain('ENV_BLOCK')
      expect(callArgs.messages[1]).toEqual({ role: 'user', content: 'Hello' })
    })

    it('uses session generation settings for context and model config', async () => {
      await agent.initSession('s1', {
        providerId: 'openai',
        modelId: 'gpt-4',
        generationSettings: {
          systemPrompt: 'Custom system prompt',
          temperature: 1.3,
          contextLength: 8192,
          maxTokens: 2048,
          thinkingBudget: 1024,
          reasoningEffort: 'low',
          verbosity: 'high'
        }
      })
      await agent.processMessage('s1', 'Hello')

      const callArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArgs.messages[0].role).toBe('system')
      expect(callArgs.messages[0].content).toContain('Custom system prompt')
      expect(callArgs.messages[0].content.trim().endsWith('Custom system prompt')).toBe(true)
      expect(callArgs.temperature).toBe(1.3)
      expect(callArgs.maxTokens).toBe(2048)
      expect(callArgs.modelConfig.contextLength).toBe(8192)
      expect(callArgs.modelConfig.maxTokens).toBe(2048)
      expect(callArgs.modelConfig.thinkingBudget).toBe(1024)
      expect(callArgs.modelConfig.reasoningEffort).toBe('low')
      expect(callArgs.modelConfig.verbosity).toBe('high')
    })

    it('reuses cached system prompt within the same day', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-03-05T08:00:00.000Z'))
      const envBuilder = buildSystemEnvPrompt as ReturnType<typeof vi.fn>

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'First message')
      await agent.processMessage('s1', 'Second message')

      expect(envBuilder).toHaveBeenCalledTimes(1)

      const firstCallArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const secondCallArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
      expect(firstCallArgs.messages[0].content).toBe(secondCallArgs.messages[0].content)
    })

    it('invalidates cached prompt after system prompt update', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-03-05T08:00:00.000Z'))
      const envBuilder = buildSystemEnvPrompt as ReturnType<typeof vi.fn>

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Before update')

      await agent.updateGenerationSettings('s1', { systemPrompt: 'Updated user prompt' })
      await agent.processMessage('s1', 'After update')

      expect(envBuilder).toHaveBeenCalledTimes(2)

      const secondCallArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
      expect(secondCallArgs.messages[0].content).toContain('Updated user prompt')
    })

    it('invalidates cached prompt across natural days', async () => {
      vi.useFakeTimers()
      const envBuilder = buildSystemEnvPrompt as ReturnType<typeof vi.fn>

      vi.setSystemTime(new Date('2026-03-05T08:00:00.000Z'))
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Day one')

      vi.setSystemTime(new Date('2026-03-06T08:00:00.000Z'))
      await agent.processMessage('s1', 'Day two')

      expect(envBuilder).toHaveBeenCalledTimes(2)

      const firstCallArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const secondCallArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
      expect(firstCallArgs.messages[0].content).toContain('DATE:Thu Mar 05 2026')
      expect(secondCallArgs.messages[0].content).toContain('DATE:Fri Mar 06 2026')
    })

    it('invalidates cached prompt when active skills change', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-03-05T08:00:00.000Z'))
      const envBuilder = buildSystemEnvPrompt as ReturnType<typeof vi.fn>
      const skillPresenter = presenter.skillPresenter as {
        getMetadataList: ReturnType<typeof vi.fn>
        getActiveSkills: ReturnType<typeof vi.fn>
        loadSkillContent: ReturnType<typeof vi.fn>
      }

      skillPresenter.getMetadataList.mockResolvedValue([{ name: 'skill-a' }])
      skillPresenter.getActiveSkills.mockResolvedValueOnce([]).mockResolvedValueOnce(['skill-a'])
      skillPresenter.loadSkillContent.mockResolvedValue({ content: 'Skill A instructions' })

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Before skill activation')
      await agent.processMessage('s1', 'After skill activation')

      expect(envBuilder).toHaveBeenCalledTimes(2)

      const secondCallArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[1][0]
      expect(secondCallArgs.messages[0].content).toContain('## Activated Skills')
      expect(secondCallArgs.messages[0].content).toContain('### skill-a')
      expect(secondCallArgs.messages[0].content).toContain('Skill A instructions')
    })

    it('keeps system prompt section order: runtime -> skills -> env -> tooling -> user prompt', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-03-05T08:00:00.000Z'))
      const skillPresenter = presenter.skillPresenter as {
        getMetadataList: ReturnType<typeof vi.fn>
        getActiveSkills: ReturnType<typeof vi.fn>
        loadSkillContent: ReturnType<typeof vi.fn>
      }
      toolPresenter.buildToolSystemPrompt.mockReturnValue('TOOLING_BLOCK')
      skillPresenter.getMetadataList.mockResolvedValue([{ name: 'skill-a', description: 'desc-a' }])
      skillPresenter.getActiveSkills.mockResolvedValue(['skill-a'])
      skillPresenter.loadSkillContent.mockResolvedValue({ content: 'Skill A body' })

      await agent.initSession('s1', {
        providerId: 'openai',
        modelId: 'gpt-4',
        generationSettings: { systemPrompt: 'USER_CUSTOM_PROMPT' }
      })
      await agent.processMessage('s1', 'Check order')

      const callArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const systemPrompt = String(callArgs.messages[0].content)

      const runtimeIndex = systemPrompt.indexOf('RUNTIME_CAPABILITIES')
      const skillsIndex = systemPrompt.indexOf('## Skills')
      const activeSkillsIndex = systemPrompt.indexOf('## Activated Skills')
      const envIndex = systemPrompt.indexOf('ENV_BLOCK')
      const toolingIndex = systemPrompt.indexOf('TOOLING_BLOCK')
      const userPromptIndex = systemPrompt.indexOf('USER_CUSTOM_PROMPT')

      expect(runtimeIndex).toBeGreaterThanOrEqual(0)
      expect(skillsIndex).toBeGreaterThan(runtimeIndex)
      expect(activeSkillsIndex).toBeGreaterThan(skillsIndex)
      expect(envIndex).toBeGreaterThan(activeSkillsIndex)
      expect(toolingIndex).toBeGreaterThan(envIndex)
      expect(userPromptIndex).toBeGreaterThan(toolingIndex)
      expect(systemPrompt).toContain('- skill-a')
      expect(systemPrompt).toContain('`skill_list`')
      expect(systemPrompt).toContain('`skill_control`')
      expect(systemPrompt).not.toContain('desc-a')
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
      ;(processStream as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('LLM failed'))

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

    it('persists files when message input is object', async () => {
      sqlitePresenter.deepchatMessagesTable.getMaxOrderSeq
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1)

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', {
        text: 'with file',
        files: [
          { name: 'a.md', path: '/tmp/a.md', mimeType: 'text/markdown', content: '# a' } as any
        ]
      })

      const userInsert = sqlitePresenter.deepchatMessagesTable.insert.mock.calls[0][0]
      const parsed = JSON.parse(userInsert.content)
      expect(parsed.text).toBe('with file')
      expect(parsed.files).toHaveLength(1)
      expect(parsed.files[0].name).toBe('a.md')
    })

    it('passes tools from toolPresenter to processStream', async () => {
      const tools = [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'test', icons: '', description: '' }
        }
      ]
      toolPresenter.getAllToolDefinitions.mockResolvedValue(tools)

      await agent.initSession('s1', {
        providerId: 'openai',
        modelId: 'gpt-4',
        projectDir: '/tmp/proj'
      })
      await agent.processMessage('s1', 'Hello')

      expect(toolPresenter.getAllToolDefinitions).toHaveBeenCalledWith(
        expect.objectContaining({
          chatMode: 'agent',
          conversationId: 's1',
          agentWorkspacePath: '/tmp/proj'
        })
      )

      const callArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArgs.tools).toEqual(tools)
    })

    it('passes empty tools when no toolPresenter or no tools', async () => {
      toolPresenter.getAllToolDefinitions.mockResolvedValue([])

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      const callArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArgs.tools).toEqual([])
    })

    it('injects request trace context when trace debug is enabled', async () => {
      configPresenter.getSetting.mockImplementation((key: string) =>
        key === 'traceDebugEnabled' ? true : undefined
      )

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      const callArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const traceContext = callArgs.modelConfig.requestTraceContext

      expect(traceContext).toBeDefined()
      expect(traceContext.enabled).toBe(true)

      await traceContext.persist({
        endpoint: 'https://api.openai.com/v1/responses',
        headers: {
          authorization: 'Bearer sk-very-secret-token'
        },
        body: {
          api_key: 'secret-value-1234',
          nested: {
            token: 'deepchat-token-9999'
          }
        }
      })

      expect(sqlitePresenter.deepchatMessageTracesTable.insert).toHaveBeenCalledTimes(1)
      const inserted = sqlitePresenter.deepchatMessageTracesTable.insert.mock.calls[0][0]
      const headers = JSON.parse(inserted.headersJson) as Record<string, string>
      const body = JSON.parse(inserted.bodyJson) as {
        api_key: string
        nested: { token: string }
      }

      expect(inserted.sessionId).toBe('s1')
      expect(inserted.messageId).toBe('mock-msg-id')
      expect(inserted.providerId).toBe('openai')
      expect(inserted.modelId).toBe('gpt-4')
      expect(inserted.endpoint).toBe('https://api.openai.com/v1/responses')
      expect(inserted.truncated).toBe(false)
      expect(headers.authorization).toMatch(/^Bearer \*+oken$/)
      expect(body.api_key).toMatch(/^\*+1234$/)
      expect(body.nested.token).toMatch(/^\*+9999$/)
    })

    it('does not inject request trace context when trace debug is disabled', async () => {
      configPresenter.getSetting.mockImplementation((key: string) =>
        key === 'traceDebugEnabled' ? false : undefined
      )

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      const callArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArgs.modelConfig.requestTraceContext).toBeUndefined()
      expect(sqlitePresenter.deepchatMessageTracesTable.insert).not.toHaveBeenCalled()
    })
  })

  describe('generation settings', () => {
    it('returns null for unknown session', async () => {
      sqlitePresenter.deepchatSessionsTable.get.mockReturnValue(undefined)
      await expect(agent.getGenerationSettings('unknown')).resolves.toBeNull()
    })

    it('updates generation settings with sanitize and clamp', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })

      const updated = await agent.updateGenerationSettings('s1', {
        temperature: 9,
        contextLength: 1000,
        maxTokens: 999999,
        thinkingBudget: -1,
        reasoningEffort: 'minimal',
        verbosity: 'invalid' as any
      })

      expect(updated.temperature).toBe(2)
      expect(updated.contextLength).toBe(2048)
      expect(updated.maxTokens).toBe(2048)
      expect(updated.thinkingBudget).toBe(0)
      expect(updated.reasoningEffort).toBe('minimal')
      expect(updated.verbosity).toBe('medium')

      expect(sqlitePresenter.deepchatSessionsTable.updateGenerationSettings).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          temperature: 2,
          contextLength: 2048,
          maxTokens: 2048,
          thinkingBudget: 0,
          reasoningEffort: 'minimal',
          verbosity: 'medium'
        })
      )
    })

    it('falls back from old DB rows with null generation fields', async () => {
      sqlitePresenter.deepchatSessionsTable.get.mockReturnValue({
        id: 's2',
        provider_id: 'openai',
        model_id: 'gpt-4',
        permission_mode: 'full_access',
        system_prompt: null,
        temperature: null,
        context_length: null,
        max_tokens: null,
        thinking_budget: null,
        reasoning_effort: null,
        verbosity: null
      })

      const settings = await agent.getGenerationSettings('s2')
      expect(settings).toEqual({
        systemPrompt: 'You are a helpful assistant.',
        temperature: 0.7,
        contextLength: 128000,
        maxTokens: 4096,
        thinkingBudget: 512,
        reasoningEffort: 'medium',
        verbosity: 'medium'
      })
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
      let streamResolve: ((value: any) => void) | undefined
      ;(processStream as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            streamResolve = r
          })
      )
      const processPromise = agent.processMessage('s1', 'Hello')

      // Wait a tick for processMessage to reach processStream
      await new Promise((r) => setTimeout(r, 10))

      // Destroy while processing
      await agent.destroySession('s1')

      // Resolve the stream to avoid hanging
      if (streamResolve) {
        streamResolve(undefined)
      }
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

  describe('summary invalidation', () => {
    it('resets summary when deleting history before cursor', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      sqlitePresenter.deepchatSessionsTable.updateSummaryState('s1', {
        summaryText: 'summary',
        summaryCursorOrderSeq: 10,
        summaryUpdatedAt: Date.now()
      })
      sqlitePresenter.deepchatMessagesTable.get.mockReturnValue({
        id: 'm1',
        session_id: 's1',
        order_seq: 5,
        role: 'user',
        content: JSON.stringify({
          text: 'old',
          files: [],
          links: [],
          search: false,
          think: false
        }),
        status: 'sent',
        is_context_edge: 0,
        metadata: '{}',
        created_at: Date.now(),
        updated_at: Date.now()
      })

      await agent.deleteMessage('s1', 'm1')

      expect(sqlitePresenter.deepchatSessionsTable.resetSummaryState).toHaveBeenCalledWith('s1')
    })
  })

  describe('respondToolInteraction', () => {
    const makeAssistantRow = (overrides?: {
      id?: string
      sessionId?: string
      orderSeq?: number
      status?: 'pending' | 'sent' | 'error'
      blocks?: unknown[]
    }) => {
      const row = {
        id: overrides?.id ?? 'm1',
        session_id: overrides?.sessionId ?? 's1',
        order_seq: overrides?.orderSeq ?? 1,
        role: 'assistant' as const,
        content: JSON.stringify(overrides?.blocks ?? []),
        status: overrides?.status ?? 'pending',
        is_context_edge: 0,
        metadata: '{}',
        created_at: Date.now(),
        updated_at: Date.now()
      }
      sqlitePresenter.deepchatMessagesTable.get.mockImplementation((id: string) =>
        id === row.id ? row : undefined
      )
      sqlitePresenter.deepchatMessagesTable.getBySession.mockReturnValue([row])
      return row
    }

    it('handles question_option and resumes assistant message', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      makeAssistantRow({
        blocks: [
          {
            type: 'tool_call',
            status: 'pending',
            timestamp: 1,
            tool_call: { id: 'tc1', name: 'ask_question', params: '{}', response: '' }
          },
          {
            type: 'action',
            action_type: 'question_request',
            status: 'pending',
            timestamp: 2,
            content: 'Pick one',
            tool_call: { id: 'tc1', name: 'ask_question', params: '{}' },
            extra: {
              needsUserAction: true,
              questionText: 'Pick one',
              questionOptions: [{ label: 'A' }]
            }
          }
        ]
      })

      const result = await agent.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'question_option',
        optionLabel: 'A'
      })

      expect(result).toEqual({ resumed: true })
      expect(sqlitePresenter.deepchatMessagesTable.updateContent).toHaveBeenCalledWith(
        'm1',
        expect.any(String)
      )

      const updatedBlocks = JSON.parse(
        sqlitePresenter.deepchatMessagesTable.updateContent.mock.calls[0][1]
      )
      expect(updatedBlocks[0].tool_call.response).toBe('A')
      expect(updatedBlocks[0].status).toBe('success')
      expect(updatedBlocks[1].status).toBe('success')
      expect(updatedBlocks[1].extra.answerText).toBe('A')
      expect(processStream).toHaveBeenCalledTimes(1)
    })

    it('handles question_other and waits for user message without resume', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      makeAssistantRow({
        blocks: [
          {
            type: 'tool_call',
            status: 'pending',
            timestamp: 1,
            tool_call: { id: 'tc1', name: 'ask_question', params: '{}', response: '' }
          },
          {
            type: 'action',
            action_type: 'question_request',
            status: 'pending',
            timestamp: 2,
            content: 'Pick one',
            tool_call: { id: 'tc1', name: 'ask_question', params: '{}' },
            extra: {
              needsUserAction: true,
              questionText: 'Pick one'
            }
          }
        ]
      })

      const result = await agent.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'question_other'
      })

      expect(result).toEqual({ resumed: false, waitingForUserMessage: true })
      expect(sqlitePresenter.deepchatMessagesTable.updateStatus).toHaveBeenCalledWith('m1', 'sent')
      expect(processStream).not.toHaveBeenCalled()

      const updatedBlocks = JSON.parse(
        sqlitePresenter.deepchatMessagesTable.updateContent.mock.calls[0][1]
      )
      expect(updatedBlocks[0].tool_call.response).toBe(
        'User chose to answer with a follow-up message.'
      )
      expect(updatedBlocks[0].status).toBe('success')
      expect(updatedBlocks[1].status).toBe('success')
    })

    it('enforces pending interaction queue order', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      makeAssistantRow({
        blocks: [
          {
            type: 'tool_call',
            status: 'pending',
            timestamp: 1,
            tool_call: { id: 'tc1', name: 'ask_one', params: '{}', response: '' }
          },
          {
            type: 'action',
            action_type: 'question_request',
            status: 'pending',
            timestamp: 2,
            content: 'First',
            tool_call: { id: 'tc1', name: 'ask_one', params: '{}' },
            extra: { needsUserAction: true, questionText: 'First' }
          },
          {
            type: 'tool_call',
            status: 'pending',
            timestamp: 3,
            tool_call: { id: 'tc2', name: 'ask_two', params: '{}', response: '' }
          },
          {
            type: 'action',
            action_type: 'question_request',
            status: 'pending',
            timestamp: 4,
            content: 'Second',
            tool_call: { id: 'tc2', name: 'ask_two', params: '{}' },
            extra: { needsUserAction: true, questionText: 'Second' }
          }
        ]
      })

      await expect(
        agent.respondToolInteraction('s1', 'm1', 'tc2', {
          kind: 'question_option',
          optionLabel: 'X'
        })
      ).rejects.toThrow('Interaction queue out of order. Please handle the first pending item.')
      expect(sqlitePresenter.deepchatMessagesTable.updateContent).not.toHaveBeenCalled()
    })

    it('does not resume when there are remaining pending interactions', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      makeAssistantRow({
        blocks: [
          {
            type: 'tool_call',
            status: 'pending',
            timestamp: 1,
            tool_call: { id: 'tc1', name: 'ask_one', params: '{}', response: '' }
          },
          {
            type: 'action',
            action_type: 'question_request',
            status: 'pending',
            timestamp: 2,
            content: 'First',
            tool_call: { id: 'tc1', name: 'ask_one', params: '{}' },
            extra: { needsUserAction: true, questionText: 'First' }
          },
          {
            type: 'tool_call',
            status: 'pending',
            timestamp: 3,
            tool_call: { id: 'tc2', name: 'ask_two', params: '{}', response: '' }
          },
          {
            type: 'action',
            action_type: 'question_request',
            status: 'pending',
            timestamp: 4,
            content: 'Second',
            tool_call: { id: 'tc2', name: 'ask_two', params: '{}' },
            extra: { needsUserAction: true, questionText: 'Second' }
          }
        ]
      })

      const result = await agent.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'question_option',
        optionLabel: 'A'
      })

      expect(result).toEqual({ resumed: false })
      expect(sqlitePresenter.deepchatMessagesTable.updateStatus).toHaveBeenCalledWith(
        'm1',
        'pending'
      )
      expect(processStream).not.toHaveBeenCalled()
    })

    it('handles permission grant by executing deferred tool and resuming', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      makeAssistantRow({
        blocks: [
          {
            type: 'tool_call',
            status: 'pending',
            timestamp: 1,
            tool_call: { id: 'tc1', name: 'write_file', params: '{"path":"a.txt"}', response: '' }
          },
          {
            type: 'action',
            action_type: 'tool_call_permission',
            status: 'pending',
            timestamp: 2,
            content: 'Need permission',
            tool_call: { id: 'tc1', name: 'write_file', params: '{"path":"a.txt"}' },
            extra: {
              needsUserAction: true,
              permissionType: 'write',
              permissionRequest: JSON.stringify({
                permissionType: 'write',
                description: 'Need permission',
                toolName: 'write_file',
                serverName: 'agent-filesystem',
                paths: ['a.txt']
              })
            }
          }
        ]
      })
      toolPresenter.callTool.mockResolvedValueOnce({
        content: 'done',
        rawData: { content: 'done', isError: false }
      })

      const result = await agent.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'permission',
        granted: true
      })

      expect(result).toEqual({ resumed: true })
      expect(toolPresenter.callTool).toHaveBeenCalledTimes(1)
      expect(processStream).toHaveBeenCalledTimes(1)

      const updatedBlocks = JSON.parse(
        sqlitePresenter.deepchatMessagesTable.updateContent.mock.calls[0][1]
      )
      expect(updatedBlocks[0].tool_call.response).toBe('done')
      expect(updatedBlocks[0].status).toBe('success')
      expect(updatedBlocks[1].status).toBe('granted')
      expect(updatedBlocks[1].extra.needsUserAction).toBe(false)
    })

    it('handles permission deny and resumes with denial result', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      makeAssistantRow({
        blocks: [
          {
            type: 'tool_call',
            status: 'pending',
            timestamp: 1,
            tool_call: { id: 'tc1', name: 'run_shell', params: '{"command":"dir"}', response: '' }
          },
          {
            type: 'action',
            action_type: 'tool_call_permission',
            status: 'pending',
            timestamp: 2,
            content: 'Need permission',
            tool_call: { id: 'tc1', name: 'run_shell', params: '{"command":"dir"}' },
            extra: { needsUserAction: true, permissionType: 'command' }
          }
        ]
      })

      const result = await agent.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'permission',
        granted: false
      })

      expect(result).toEqual({ resumed: true })
      const updatedBlocks = JSON.parse(
        sqlitePresenter.deepchatMessagesTable.updateContent.mock.calls[0][1]
      )
      expect(updatedBlocks[0].tool_call.response).toBe('User denied the request.')
      expect(updatedBlocks[0].status).toBe('error')
      expect(updatedBlocks[1].status).toBe('denied')
      expect(processStream).toHaveBeenCalledTimes(1)
    })
  })

  describe('permission mode', () => {
    it('setPermissionMode updates runtime and db', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.setPermissionMode('s1', 'default')

      const mode = await agent.getPermissionMode('s1')
      expect(mode).toBe('default')
      expect(sqlitePresenter.deepchatSessionsTable.updatePermissionMode).toHaveBeenCalledWith(
        's1',
        'default'
      )
    })

    it('getPermissionMode falls back to db session row', async () => {
      sqlitePresenter.deepchatSessionsTable.get.mockReturnValue({
        id: 's2',
        provider_id: 'openai',
        model_id: 'gpt-4',
        permission_mode: 'default'
      })

      const mode = await agent.getPermissionMode('s2')
      expect(mode).toBe('default')
    })
  })
})
