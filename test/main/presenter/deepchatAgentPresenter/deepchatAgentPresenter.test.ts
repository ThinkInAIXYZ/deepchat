import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import type { DeepChatSessionState } from '@shared/types/agent-interface'
import { DeepChatAgentPresenter } from '@/presenter/deepchatAgentPresenter/index'
import { NewSessionHooksBridge } from '@/presenter/hooksNotifications/newSessionBridge'

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
    STATUS_CHANGED: 'session:status-changed',
    COMPACTION_UPDATED: 'session:compaction-updated',
    PENDING_INPUTS_UPDATED: 'session:pending-inputs-updated'
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

vi.mock('@/lib/agentRuntime/systemEnvPromptBuilder', () => ({
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
import {
  buildRuntimeCapabilitiesPrompt,
  buildSystemEnvPrompt
} from '@/lib/agentRuntime/systemEnvPromptBuilder'

function createMockSqlitePresenter() {
  const summaryState = {
    summary_text: null,
    summary_cursor_order_seq: 1,
    summary_updated_at: null
  }
  return {
    newSessionsTable: {
      get: vi.fn(),
      getDisabledAgentTools: vi.fn().mockReturnValue([])
    },
    deepchatSessionsTable: {
      create: vi.fn(),
      get: vi.fn(),
      getGenerationSettings: vi.fn(),
      getSummaryState: vi.fn(() => ({ ...summaryState })),
      updatePermissionMode: vi.fn(),
      updateSessionModel: vi.fn(),
      updateGenerationSettings: vi.fn(),
      updateSummaryState: vi.fn((_id: string, nextState: any) => {
        summaryState.summary_text = nextState.summaryText ?? null
        summaryState.summary_cursor_order_seq = nextState.summaryCursorOrderSeq ?? 1
        summaryState.summary_updated_at = nextState.summaryUpdatedAt ?? null
      }),
      updateSummaryStateIfMatches: vi.fn((_id: string, nextState: any, expectedState: any) => {
        if (
          summaryState.summary_text !== (expectedState.summaryText ?? null) ||
          summaryState.summary_cursor_order_seq !== (expectedState.summaryCursorOrderSeq ?? 1) ||
          summaryState.summary_updated_at !== (expectedState.summaryUpdatedAt ?? null)
        ) {
          return false
        }

        summaryState.summary_text = nextState.summaryText ?? null
        summaryState.summary_cursor_order_seq = nextState.summaryCursorOrderSeq ?? 1
        summaryState.summary_updated_at = nextState.summaryUpdatedAt ?? null
        return true
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
      delete: vi.fn(),
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
    },
    deepchatPendingInputsTable: {
      insert: vi.fn(),
      get: vi.fn(),
      listBySession: vi.fn().mockReturnValue([]),
      listClaimed: vi.fn().mockReturnValue([]),
      listActiveBySession: vi.fn().mockReturnValue([]),
      countActiveBySession: vi.fn().mockReturnValue(0),
      update: vi.fn(),
      delete: vi.fn(),
      deleteBySession: vi.fn()
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
    getReasoningPortrait: vi.fn().mockImplementation((providerId: string, modelId: string) => {
      if (providerId === 'gemini' && modelId === 'gemini-2.5-pro') {
        return {
          supported: true,
          defaultEnabled: true,
          mode: 'budget',
          budget: { min: 0, max: 8192, default: -1, auto: -1, off: 0 }
        }
      }
      return {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        budget: { min: 0, max: 8192, default: 512 },
        effort: 'medium',
        effortOptions: ['minimal', 'low', 'medium', 'high'],
        verbosity: 'medium',
        verbosityOptions: ['low', 'medium', 'high']
      }
    }),
    supportsReasoningCapability: vi.fn().mockReturnValue(true),
    getThinkingBudgetRange: vi.fn().mockReturnValue({ min: 0, max: 8192, default: 512 }),
    supportsReasoningEffortCapability: vi.fn().mockReturnValue(true),
    getReasoningEffortDefault: vi.fn().mockReturnValue('medium'),
    supportsVerbosityCapability: vi.fn().mockReturnValue(true),
    getVerbosityDefault: vi.fn().mockReturnValue('medium'),
    getSkillsEnabled: vi.fn().mockReturnValue(true),
    getAutoCompactionEnabled: vi.fn().mockReturnValue(true),
    getAutoCompactionTriggerThreshold: vi.fn().mockReturnValue(80),
    getAutoCompactionRetainRecentPairs: vi.fn().mockReturnValue(2),
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
  let hookDispatcher: { dispatchEvent: ReturnType<typeof vi.fn> }
  let tempHome: string | null = null
  let getPathSpy: ReturnType<typeof vi.spyOn> | null = null

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
    hookDispatcher = { dispatchEvent: vi.fn() }
    agent = new DeepChatAgentPresenter(
      llmProvider,
      configPresenter,
      sqlitePresenter,
      toolPresenter,
      new NewSessionHooksBridge(hookDispatcher)
    )
  })

  afterEach(async () => {
    vi.useRealTimers()
    getPathSpy?.mockRestore()
    getPathSpy = null
    if (tempHome) {
      await fs.rm(tempHome, { recursive: true, force: true })
      tempHome = null
    }
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

    it('only recovers claimed pending inputs for sessions that still exist', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      sqlitePresenter.deepchatPendingInputsTable.listClaimed.mockReturnValue([
        {
          id: 'pending-existing',
          session_id: 's1',
          mode: 'queue',
          state: 'claimed',
          payload_json: '{"text":"hello","files":[]}',
          queue_order: 1,
          claimed_at: 123,
          consumed_at: null,
          created_at: 1,
          updated_at: 1
        },
        {
          id: 'pending-missing',
          session_id: 'missing-session',
          mode: 'queue',
          state: 'claimed',
          payload_json: '{"text":"orphan","files":[]}',
          queue_order: 2,
          claimed_at: 456,
          consumed_at: null,
          created_at: 2,
          updated_at: 2
        }
      ])
      sqlitePresenter.deepchatSessionsTable.get.mockImplementation((sessionId: string) =>
        sessionId === 's1' ? { id: 's1' } : null
      )

      new DeepChatAgentPresenter(llmProvider, configPresenter, sqlitePresenter, toolPresenter)

      expect(sqlitePresenter.deepchatPendingInputsTable.update).toHaveBeenCalledTimes(1)
      expect(sqlitePresenter.deepchatPendingInputsTable.update).toHaveBeenCalledWith(
        'pending-existing',
        {
          state: 'pending',
          claimed_at: null
        }
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        'DeepChatAgent: recovered 1 sessions with claimed pending inputs'
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

    it('dispatches lifecycle hooks through new session bridge', async () => {
      ;(processStream as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
        status: 'completed',
        stopReason: 'complete',
        usage: { totalTokens: 3 }
      }))

      await agent.initSession('s1', {
        agentId: 'deepchat',
        providerId: 'openai',
        modelId: 'gpt-4',
        projectDir: '/tmp/project'
      })
      await agent.processMessage('s1', 'Hello bridge')

      expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'UserPromptSubmit',
        expect.objectContaining({
          conversationId: 's1',
          agentId: 'deepchat',
          workdir: '/tmp/project',
          promptPreview: 'Hello bridge'
        })
      )
      expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'SessionStart',
        expect.objectContaining({
          conversationId: 's1',
          agentId: 'deepchat',
          workdir: '/tmp/project'
        })
      )
      expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'Stop',
        expect.objectContaining({
          conversationId: 's1',
          stop: expect.objectContaining({ reason: 'complete', userStop: false })
        })
      )
      expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'SessionEnd',
        expect.objectContaining({
          conversationId: 's1'
        })
      )
    })

    it('rehydrates agentId from persisted new session rows before dispatching hooks', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'coder'
      })
      sqlitePresenter.deepchatSessionsTable.get.mockReturnValue({
        id: 's1',
        provider_id: 'acp',
        model_id: 'coder',
        permission_mode: 'full_access'
      })
      ;(processStream as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
        status: 'completed',
        stopReason: 'complete'
      }))

      await agent.getSessionState('s1')
      await agent.processMessage('s1', 'Reopened session', { projectDir: '/tmp/project' })

      expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'UserPromptSubmit',
        expect.objectContaining({
          conversationId: 's1',
          agentId: 'coder'
        })
      )
    })

    it('dispatches tool and permission hooks through process callbacks', async () => {
      ;(processStream as ReturnType<typeof vi.fn>).mockImplementationOnce(async (params) => {
        params.hooks?.onPreToolUse?.({
          callId: 'tool-1',
          name: 'write_file',
          params: '{"path":"a.txt"}'
        })
        params.hooks?.onPermissionRequest?.(
          {
            permissionType: 'write',
            description: 'Need permission'
          },
          {
            callId: 'tool-1',
            name: 'write_file',
            params: '{"path":"a.txt"}'
          }
        )
        params.hooks?.onPostToolUseFailure?.({
          callId: 'tool-1',
          name: 'write_file',
          params: '{"path":"a.txt"}',
          error: 'permission denied'
        })
        return {
          status: 'error',
          stopReason: 'error',
          errorMessage: 'permission denied'
        }
      })

      await agent.initSession('s1', { agentId: 'coder', providerId: 'acp', modelId: 'coder' })
      await agent.processMessage('s1', 'Run tool')

      expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'PreToolUse',
        expect.objectContaining({
          conversationId: 's1',
          agentId: 'coder',
          tool: expect.objectContaining({ callId: 'tool-1', name: 'write_file' })
        })
      )
      expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'PermissionRequest',
        expect.objectContaining({
          conversationId: 's1',
          permission: expect.objectContaining({ permissionType: 'write' })
        })
      )
      expect(hookDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'PostToolUseFailure',
        expect.objectContaining({
          conversationId: 's1',
          tool: expect.objectContaining({ error: 'permission denied' })
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
      sqlitePresenter.deepchatMessagesTable.getMaxOrderSeq
        .mockReturnValueOnce(2)
        .mockReturnValueOnce(3)

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
      sqlitePresenter.deepchatMessagesTable.getMaxOrderSeq
        .mockReturnValueOnce(6)
        .mockReturnValueOnce(7)
        .mockReturnValueOnce(8)

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
      expect(
        sqlitePresenter.deepchatSessionsTable.updateSummaryStateIfMatches
      ).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          summaryText: expect.stringContaining('## Current Goal'),
          summaryCursorOrderSeq: 3
        }),
        expect.objectContaining({
          summaryText: null,
          summaryCursorOrderSeq: 1,
          summaryUpdatedAt: null
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
      toolPresenter.getAllToolDefinitions.mockResolvedValueOnce([
        {
          type: 'function',
          source: 'agent',
          function: {
            name: 'skill_list',
            description: 'skill list',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'agent-skills', icons: '', description: '' }
        },
        {
          type: 'function',
          source: 'agent',
          function: {
            name: 'skill_control',
            description: 'skill control',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'agent-skills', icons: '', description: '' }
        }
      ])
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

    it('derives runtime capabilities from the current enabled agent tools', async () => {
      const runtimeBuilder = buildRuntimeCapabilitiesPrompt as ReturnType<typeof vi.fn>
      toolPresenter.getAllToolDefinitions.mockResolvedValueOnce([
        {
          type: 'function',
          source: 'agent',
          function: {
            name: 'exec',
            description: 'exec',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'agent-filesystem', icons: '', description: '' }
        },
        {
          type: 'function',
          source: 'agent',
          function: {
            name: 'skill_list',
            description: 'skill list',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'agent-skills', icons: '', description: '' }
        }
      ])

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Inspect tools')

      expect(runtimeBuilder).toHaveBeenCalledWith({
        hasYoBrowser: false,
        hasExec: true,
        hasProcess: false
      })
      expect(toolPresenter.buildToolSystemPrompt).toHaveBeenCalledWith({
        conversationId: 's1',
        toolDefinitions: expect.arrayContaining([
          expect.objectContaining({
            function: expect.objectContaining({ name: 'exec' })
          })
        ])
      })
    })

    it('omits skill metadata when skill management tools are unavailable', async () => {
      const skillPresenter = presenter.skillPresenter as {
        getMetadataList: ReturnType<typeof vi.fn>
        getActiveSkills: ReturnType<typeof vi.fn>
        loadSkillContent: ReturnType<typeof vi.fn>
      }

      skillPresenter.getMetadataList.mockResolvedValue([{ name: 'skill-a' }])
      skillPresenter.getActiveSkills.mockResolvedValue([])
      toolPresenter.getAllToolDefinitions.mockResolvedValueOnce([
        {
          type: 'function',
          source: 'agent',
          function: {
            name: 'exec',
            description: 'exec',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'agent-filesystem', icons: '', description: '' }
        }
      ])

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'No skill tools')

      const callArgs = (processStream as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const systemPrompt = String(callArgs.messages[0].content)

      expect(systemPrompt).not.toContain('## Skills')
      expect(systemPrompt).not.toContain('- skill-a')
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

    it('emits a refresh for the persisted user message before streaming starts', async () => {
      let refreshCountAtStreamStart = 0
      ;(processStream as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        refreshCountAtStreamStart = (
          eventBus.sendToRenderer as ReturnType<typeof vi.fn>
        ).mock.calls.filter((call: any[]) => call[0] === 'stream:end').length
        return { status: 'completed' }
      })

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      expect(refreshCountAtStreamStart).toBe(1)
    })

    it('finalizes the assistant placeholder when streaming setup fails', async () => {
      ;(processStream as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('LLM failed'))
      sqlitePresenter.deepchatMessagesTable.get.mockReturnValue({
        id: 'mock-msg-id',
        session_id: 's1',
        order_seq: 2,
        role: 'assistant',
        content: '[]',
        status: 'pending',
        is_context_edge: 0,
        metadata: null,
        created_at: 1,
        updated_at: 1
      })

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      const [messageId, contentJson, status] =
        sqlitePresenter.deepchatMessagesTable.updateContentAndStatus.mock.calls[0]
      expect(messageId).toBe('mock-msg-id')
      expect(status).toBe('error')
      expect(JSON.parse(contentJson)).toEqual([
        {
          type: 'error',
          content: 'LLM failed',
          status: 'error',
          timestamp: expect.any(Number)
        }
      ])
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

    it('passes preserveInterleavedReasoning into next-turn compaction checks', async () => {
      const prepareForNextUserTurn = vi
        .spyOn((agent as any).compactionService, 'prepareForNextUserTurn')
        .mockReturnValue(null)

      await agent.initSession('s1', {
        providerId: 'openai',
        modelId: 'gpt-4',
        generationSettings: {
          forceInterleavedThinkingCompat: true
        }
      })
      await agent.processMessage('s1', 'Hello')

      expect(prepareForNextUserTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          preserveInterleavedReasoning: true
        })
      )
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

    it('persists interleaved reasoning gaps into traces when trace debug is enabled', async () => {
      configPresenter.getSetting.mockImplementation((key: string) =>
        key === 'traceDebugEnabled' ? true : undefined
      )
      ;(processStream as ReturnType<typeof vi.fn>).mockImplementationOnce(async (args) => {
        args.hooks?.onInterleavedReasoningGap?.({
          providerId: 'zenmux',
          modelId: 'moonshotai/kimi-k2.5',
          providerDbSourceUrl: 'https://example.com/dist/all.json',
          reasoningContentLength: 42,
          toolCallCount: 1
        })
        return { status: 'completed' }
      })

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.processMessage('s1', 'Hello')

      expect(sqlitePresenter.deepchatMessageTracesTable.insert).toHaveBeenCalledTimes(1)
      const inserted = sqlitePresenter.deepchatMessageTracesTable.insert.mock.calls[0][0]
      const body = JSON.parse(inserted.bodyJson) as {
        providerId: string
        modelId: string
        providerDbSourceUrl: string
        reasoningContentLength: number
        toolCallCount: number
      }

      expect(inserted.endpoint).toBe('deepchat://interleaved-reasoning-gap')
      expect(body).toEqual({
        providerId: 'zenmux',
        modelId: 'moonshotai/kimi-k2.5',
        providerDbSourceUrl: 'https://example.com/dist/all.json',
        reasoningContentLength: 42,
        toolCallCount: 1
      })
    })
  })

  describe('generation settings', () => {
    it('returns null for unknown session', async () => {
      sqlitePresenter.deepchatSessionsTable.get.mockReturnValue(undefined)
      await expect(agent.getGenerationSettings('unknown')).resolves.toBeNull()
    })

    it('updates generation settings with minimal validation and keeps invalid fields unchanged', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })

      const updated = await agent.updateGenerationSettings('s1', {
        temperature: 9,
        contextLength: 1000,
        maxTokens: 999999,
        thinkingBudget: -1,
        reasoningEffort: 'minimal',
        verbosity: 'invalid' as any
      })

      expect(updated.temperature).toBe(9)
      expect(updated.contextLength).toBe(128000)
      expect(updated.maxTokens).toBe(4096)
      expect(updated.thinkingBudget).toBe(512)
      expect(updated.reasoningEffort).toBe('minimal')
      expect(updated.verbosity).toBe('medium')

      expect(sqlitePresenter.deepchatSessionsTable.updateGenerationSettings).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          temperature: 9,
          contextLength: 128000,
          maxTokens: 4096,
          thinkingBudget: 512,
          reasoningEffort: 'minimal',
          verbosity: 'medium'
        })
      )
    })

    it('inherits interleaved thinking defaults and allows explicit session disable', async () => {
      configPresenter.getModelConfig.mockReturnValue({
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 128000,
        thinkingBudget: 512,
        reasoningEffort: 'medium',
        verbosity: 'medium',
        forceInterleavedThinkingCompat: true
      })
      configPresenter.getReasoningPortrait.mockReturnValue({
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        interleaved: true,
        budget: { min: 0, max: 8192, default: 512 },
        effort: 'medium',
        effortOptions: ['minimal', 'low', 'medium', 'high'],
        verbosity: 'medium',
        verbosityOptions: ['low', 'medium', 'high']
      })

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })

      const defaults = await agent.getGenerationSettings('s1')
      expect(defaults?.forceInterleavedThinkingCompat).toBe(true)
      expect(sqlitePresenter.deepchatSessionsTable.create).toHaveBeenCalledWith(
        's1',
        'openai',
        'gpt-4',
        'full_access',
        expect.objectContaining({
          forceInterleavedThinkingCompat: true
        })
      )

      const disabled = await agent.updateGenerationSettings('s1', {
        forceInterleavedThinkingCompat: false
      })

      expect(disabled.forceInterleavedThinkingCompat).toBe(false)
      expect(
        sqlitePresenter.deepchatSessionsTable.updateGenerationSettings
      ).toHaveBeenLastCalledWith(
        's1',
        expect.objectContaining({
          forceInterleavedThinkingCompat: false
        })
      )

      const interleavedConfig = (agent as any).resolveInterleavedReasoningConfig(
        'openai',
        'gpt-4',
        disabled
      )
      expect(interleavedConfig.preserveReasoningContent).toBe(false)

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
        verbosity: null,
        force_interleaved_thinking_compat: 0
      })

      const persisted = await agent.getGenerationSettings('s2')
      expect(persisted?.forceInterleavedThinkingCompat).toBe(false)
    })

    it('treats legacy negative thinking budget rows as disabled and ignores new negative updates', async () => {
      sqlitePresenter.deepchatSessionsTable.get.mockReturnValue({
        id: 's2',
        provider_id: 'gemini',
        model_id: 'gemini-2.5-pro',
        permission_mode: 'full_access',
        system_prompt: 'You are a helpful assistant.',
        temperature: 0.7,
        context_length: 128000,
        max_tokens: 4096,
        thinking_budget: -1,
        reasoning_effort: 'medium',
        verbosity: 'medium',
        force_interleaved_thinking_compat: null
      })

      const persisted = await agent.getGenerationSettings('s2')
      expect(persisted).not.toHaveProperty('thinkingBudget')

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      const updated = await agent.updateGenerationSettings('s1', {
        thinkingBudget: -1
      })

      expect(updated.thinkingBudget).toBe(512)
      expect(sqlitePresenter.deepchatSessionsTable.updateGenerationSettings).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          thinkingBudget: 512
        })
      )
    })

    it('normalizes reasoning effort by portrait option set instead of provider id', async () => {
      configPresenter.getReasoningPortrait.mockImplementation(
        (providerId: string, modelId: string) => {
          if (providerId === 'xai' && modelId === 'grok-3-mini-fast-beta') {
            return {
              supported: true,
              defaultEnabled: true,
              mode: 'effort',
              effort: 'low',
              effortOptions: ['low', 'high'],
              verbosity: 'medium',
              verbosityOptions: ['low', 'medium', 'high']
            }
          }
          return {
            supported: true,
            defaultEnabled: true,
            mode: 'effort',
            budget: { min: 0, max: 8192, default: 512 },
            effort: 'medium',
            effortOptions: ['minimal', 'low', 'medium', 'high'],
            verbosity: 'medium',
            verbosityOptions: ['low', 'medium', 'high']
          }
        }
      )

      await agent.initSession('s1', { providerId: 'xai', modelId: 'grok-3-mini-fast-beta' })

      const updated = await agent.updateGenerationSettings('s1', {
        reasoningEffort: 'minimal'
      })

      expect(updated.reasoningEffort).toBe('low')
      expect(sqlitePresenter.deepchatSessionsTable.updateGenerationSettings).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          reasoningEffort: 'low'
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
        verbosity: null,
        force_interleaved_thinking_compat: null
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

    it('keeps system prompt and resets other settings to the new model defaults', async () => {
      configPresenter.getModelConfig.mockImplementation((modelId: string, providerId: string) => {
        if (providerId === 'anthropic' && modelId === 'claude-3-5-sonnet') {
          return {
            temperature: 0.2,
            maxTokens: 2048,
            contextLength: 32000,
            thinkingBudget: 256,
            reasoningEffort: 'low',
            verbosity: 'high'
          }
        }
        return {
          temperature: 0.7,
          maxTokens: 4096,
          contextLength: 128000,
          thinkingBudget: 512,
          reasoningEffort: 'medium',
          verbosity: 'medium'
        }
      })
      configPresenter.getThinkingBudgetRange.mockImplementation(
        (providerId: string, modelId: string) => {
          if (providerId === 'anthropic' && modelId === 'claude-3-5-sonnet') {
            return { min: 0, max: 4096, default: 256 }
          }
          return { min: 0, max: 8192, default: 512 }
        }
      )
      configPresenter.getReasoningEffortDefault.mockImplementation(
        (providerId: string, modelId: string) => {
          if (providerId === 'anthropic' && modelId === 'claude-3-5-sonnet') {
            return 'low'
          }
          return 'medium'
        }
      )
      configPresenter.getVerbosityDefault.mockImplementation(
        (providerId: string, modelId: string) => {
          if (providerId === 'anthropic' && modelId === 'claude-3-5-sonnet') {
            return 'high'
          }
          return 'medium'
        }
      )

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.updateGenerationSettings('s1', {
        systemPrompt: 'Keep this prompt',
        temperature: 1.5,
        contextLength: 64000,
        maxTokens: 1234,
        thinkingBudget: 1024,
        reasoningEffort: 'minimal',
        verbosity: 'low'
      })

      await agent.setSessionModel('s1', 'anthropic', 'claude-3-5-sonnet')

      expect(sqlitePresenter.deepchatSessionsTable.updateSessionModel).toHaveBeenCalledWith(
        's1',
        'anthropic',
        'claude-3-5-sonnet'
      )

      const updated = await agent.getGenerationSettings('s1')
      expect(updated).toEqual({
        systemPrompt: 'Keep this prompt',
        temperature: 0.2,
        contextLength: 32000,
        maxTokens: 2048,
        thinkingBudget: 256,
        reasoningEffort: 'low',
        verbosity: 'high'
      })
    })

    it('drops unsupported reasoning and verbosity settings when switching models', async () => {
      configPresenter.getModelConfig.mockImplementation((modelId: string, providerId: string) => {
        if (providerId === 'openai' && modelId === 'gpt-4o-mini') {
          return {
            temperature: 0.4,
            maxTokens: 1024,
            contextLength: 8192
          }
        }
        return {
          temperature: 0.7,
          maxTokens: 4096,
          contextLength: 128000,
          thinkingBudget: 512,
          reasoningEffort: 'medium',
          verbosity: 'medium'
        }
      })
      configPresenter.supportsReasoningCapability.mockImplementation(
        (providerId: string, modelId: string) =>
          !(providerId === 'openai' && modelId === 'gpt-4o-mini')
      )
      configPresenter.supportsReasoningEffortCapability.mockImplementation(
        (providerId: string, modelId: string) =>
          !(providerId === 'openai' && modelId === 'gpt-4o-mini')
      )
      configPresenter.supportsVerbosityCapability.mockImplementation(
        (providerId: string, modelId: string) =>
          !(providerId === 'openai' && modelId === 'gpt-4o-mini')
      )

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      await agent.updateGenerationSettings('s1', {
        systemPrompt: 'Keep this prompt',
        thinkingBudget: 1024,
        reasoningEffort: 'high',
        verbosity: 'high'
      })

      await agent.setSessionModel('s1', 'openai', 'gpt-4o-mini')

      const updated = await agent.getGenerationSettings('s1')
      expect(updated).toEqual({
        systemPrompt: 'Keep this prompt',
        temperature: 0.4,
        contextLength: 8192,
        maxTokens: 1024
      })
    })

    it('rejects model switching while the session is generating', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      ;((agent as any).runtimeState as Map<string, DeepChatSessionState>).set('s1', {
        status: 'generating',
        providerId: 'openai',
        modelId: 'gpt-4',
        permissionMode: 'full_access'
      })

      await expect(agent.setSessionModel('s1', 'anthropic', 'claude-3-5-sonnet')).rejects.toThrow(
        'Cannot switch model while session is generating.'
      )
      expect(sqlitePresenter.deepchatSessionsTable.updateSessionModel).not.toHaveBeenCalled()
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

    it('finalizes the active assistant message on stop', async () => {
      let resolveRun: ((value: any) => void) | null = null
      ;(processStream as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRun = resolve
          })
      )
      sqlitePresenter.deepchatMessagesTable.get.mockReturnValue({
        id: 'mock-msg-id',
        session_id: 's1',
        order_seq: 2,
        role: 'assistant',
        content: '[]',
        status: 'pending',
        is_context_edge: 0,
        metadata: null,
        created_at: 1,
        updated_at: 1
      })

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      const processPromise = agent.processMessage('s1', 'Hello')
      await new Promise((resolve) => setTimeout(resolve, 10))

      await agent.cancelGeneration('s1')
      resolveRun?.({
        status: 'aborted',
        stopReason: 'user_stop',
        errorMessage: 'common.error.userCanceledGeneration'
      })
      await processPromise

      const [messageId, contentJson, status] =
        sqlitePresenter.deepchatMessagesTable.updateContentAndStatus.mock.calls[0]
      expect(messageId).toBe('mock-msg-id')
      expect(status).toBe('error')
      expect(JSON.parse(contentJson)).toEqual([
        {
          type: 'error',
          content: 'common.error.userCanceledGeneration',
          status: 'error',
          timestamp: expect.any(Number)
        }
      ])
      expect((await agent.getSessionState('s1'))!.status).toBe('idle')
    })

    it('ignores stale run completion after a newer turn starts', async () => {
      let resolveFirstRun: ((value: any) => void) | null = null
      ;(processStream as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstRun = resolve
            })
        )
        .mockResolvedValueOnce({
          status: 'completed',
          stopReason: 'complete'
        })
      sqlitePresenter.deepchatMessagesTable.get.mockReturnValue({
        id: 'mock-msg-id',
        session_id: 's1',
        order_seq: 2,
        role: 'assistant',
        content: '[]',
        status: 'pending',
        is_context_edge: 0,
        metadata: null,
        created_at: 1,
        updated_at: 1
      })

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      const firstProcess = agent.processMessage('s1', 'First')
      await new Promise((resolve) => setTimeout(resolve, 10))

      await agent.cancelGeneration('s1')
      await agent.processMessage('s1', 'Second')

      resolveFirstRun?.({
        status: 'aborted',
        stopReason: 'user_stop',
        errorMessage: 'common.error.userCanceledGeneration'
      })
      await firstProcess

      const stopCalls = hookDispatcher.dispatchEvent.mock.calls.filter(
        (call: any[]) => call[0] === 'Stop'
      )
      expect(stopCalls).toHaveLength(2)
      expect(stopCalls[0][1]).toEqual(
        expect.objectContaining({
          stop: expect.objectContaining({ reason: 'user_stop', userStop: true })
        })
      )
      expect(stopCalls[1][1]).toEqual(
        expect.objectContaining({
          stop: expect.objectContaining({ reason: 'complete', userStop: false })
        })
      )
    })
  })

  describe('queuePendingInput', () => {
    it('claims immediately runnable turns instead of exposing a queued item first', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })

      const claimedRecord = {
        id: 'q1',
        sessionId: 's1',
        mode: 'queue',
        state: 'claimed',
        payload: { text: 'Hello', files: [] },
        queueOrder: 1,
        claimedAt: 1,
        consumedAt: null,
        createdAt: 1,
        updatedAt: 1
      }
      const queueSpy = vi
        .spyOn((agent as any).pendingInputCoordinator, 'queuePendingInput')
        .mockReturnValue(claimedRecord)
      const processSpy = vi.spyOn(agent, 'processMessage').mockResolvedValue()

      const result = await agent.queuePendingInput('s1', 'Hello')

      expect(queueSpy).toHaveBeenCalledWith('s1', 'Hello', { state: 'claimed' })
      expect(processSpy).toHaveBeenCalledWith(
        's1',
        claimedRecord.payload,
        expect.objectContaining({
          pendingQueueItemId: claimedRecord.id
        })
      )
      expect(result).toBe(claimedRecord)
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
      expect(eventBus.sendToRenderer).toHaveBeenCalledWith('session:compaction-updated', 'all', {
        sessionId: 's1',
        status: 'idle',
        cursorOrderSeq: 1,
        summaryUpdatedAt: null
      })
    })
  })

  describe('session compaction state', () => {
    const createSentTurnRecords = (turnCount: number) => {
      const longUser = 'U'.repeat(2400)
      const longAssistant = 'A'.repeat(2400)
      const records: any[] = []

      for (let index = 0; index < turnCount; index += 1) {
        const orderBase = index * 2
        records.push({
          id: `u${index + 1}`,
          session_id: 's1',
          order_seq: orderBase + 1,
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
        })
        records.push({
          id: `a${index + 1}`,
          session_id: 's1',
          order_seq: orderBase + 2,
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', content: longAssistant, status: 'success', timestamp: Date.now() }
          ]),
          status: 'sent',
          is_context_edge: 0,
          metadata: '{}',
          created_at: Date.now(),
          updated_at: Date.now()
        })
      }

      return records
    }

    it('emits compacting before compacted on successful compaction', async () => {
      sqlitePresenter.deepchatMessagesTable.getBySession.mockReturnValue(createSentTurnRecords(3))
      sqlitePresenter.deepchatMessagesTable.getMaxOrderSeq
        .mockReturnValueOnce(6)
        .mockReturnValueOnce(7)
        .mockReturnValueOnce(8)

      await agent.initSession('s1', {
        providerId: 'openai',
        modelId: 'gpt-4',
        generationSettings: {
          contextLength: 2500,
          maxTokens: 512
        }
      })
      await agent.processMessage('s1', 'new prompt')

      const compactionCalls = (eventBus.sendToRenderer as ReturnType<typeof vi.fn>).mock.calls
        .filter((call: any[]) => call[0] === 'session:compaction-updated')
        .map((call: any[]) => call[2])

      expect(compactionCalls).toEqual([
        {
          sessionId: 's1',
          status: 'compacting',
          cursorOrderSeq: 3,
          summaryUpdatedAt: null
        },
        expect.objectContaining({
          sessionId: 's1',
          status: 'compacted',
          cursorOrderSeq: 3
        })
      ])

      const insertRows = sqlitePresenter.deepchatMessagesTable.insert.mock.calls.map(
        ([row]: any[]) => row
      )
      expect(insertRows[0]).toEqual(
        expect.objectContaining({
          role: 'assistant',
          orderSeq: 7,
          status: 'sent'
        })
      )
      expect(JSON.parse(insertRows[0].metadata)).toEqual({
        messageType: 'compaction',
        compactionStatus: 'compacting',
        summaryUpdatedAt: null
      })

      expect(insertRows[1]).toEqual(
        expect.objectContaining({
          role: 'user',
          orderSeq: 8,
          status: 'sent'
        })
      )

      const compactionInsert = sqlitePresenter.deepchatMessagesTable.insert.mock.calls.find(
        ([row]: any[]) =>
          typeof row?.metadata === 'string' && row.metadata.includes('"messageType":"compaction"')
      )?.[0]
      expect(compactionInsert).toEqual(
        expect.objectContaining({
          sessionId: 's1',
          orderSeq: 7,
          role: 'assistant',
          status: 'sent'
        })
      )
      expect(JSON.parse(compactionInsert.metadata)).toEqual({
        messageType: 'compaction',
        compactionStatus: 'compacting',
        summaryUpdatedAt: null
      })

      const finalizedCompaction =
        sqlitePresenter.deepchatMessagesTable.updateContentAndStatus.mock.calls.find(
          ([, , , metadata]: any[]) =>
            typeof metadata === 'string' && metadata.includes('"messageType":"compaction"')
        )
      expect(finalizedCompaction).toEqual([
        'mock-msg-id',
        expect.any(String),
        'sent',
        expect.stringContaining('"compactionStatus":"compacted"')
      ])
    })

    it('falls back to the previous compacted state when compaction fails', async () => {
      await agent.initSession('s1', {
        providerId: 'openai',
        modelId: 'gpt-4',
        generationSettings: {
          contextLength: 2500,
          maxTokens: 512
        }
      })
      sqlitePresenter.deepchatSessionsTable.updateSummaryState('s1', {
        summaryText: 'old summary',
        summaryCursorOrderSeq: 3,
        summaryUpdatedAt: 111
      })
      llmProvider.generateText.mockRejectedValueOnce(new Error('boom'))
      sqlitePresenter.deepchatMessagesTable.getBySession.mockReturnValue(createSentTurnRecords(4))
      sqlitePresenter.deepchatMessagesTable.getMaxOrderSeq
        .mockReturnValueOnce(8)
        .mockReturnValueOnce(9)
        .mockReturnValueOnce(10)

      await agent.processMessage('s1', 'new prompt')

      const compactionCalls = (eventBus.sendToRenderer as ReturnType<typeof vi.fn>).mock.calls
        .filter((call: any[]) => call[0] === 'session:compaction-updated')
        .map((call: any[]) => call[2])

      expect(compactionCalls).toEqual([
        {
          sessionId: 's1',
          status: 'compacting',
          cursorOrderSeq: 5,
          summaryUpdatedAt: 111
        },
        {
          sessionId: 's1',
          status: 'compacted',
          cursorOrderSeq: 3,
          summaryUpdatedAt: 111
        }
      ])
      expect(sqlitePresenter.deepchatMessagesTable.delete).toHaveBeenCalledWith('mock-msg-id')
    })

    it('emits idle when clearMessages resets compaction state', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      sqlitePresenter.deepchatSessionsTable.updateSummaryState('s1', {
        summaryText: 'summary',
        summaryCursorOrderSeq: 3,
        summaryUpdatedAt: 111
      })

      await agent.clearMessages('s1')

      expect(eventBus.sendToRenderer).toHaveBeenCalledWith('session:compaction-updated', 'all', {
        sessionId: 's1',
        status: 'idle',
        cursorOrderSeq: 1,
        summaryUpdatedAt: null
      })
    })

    it('returns persisted compacted state for reopened sessions', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      sqlitePresenter.deepchatSessionsTable.updateSummaryState('s1', {
        summaryText: 'summary',
        summaryCursorOrderSeq: 7,
        summaryUpdatedAt: 222
      })
      sqlitePresenter.deepchatSessionsTable.get.mockReturnValue({
        id: 's1',
        provider_id: 'openai',
        model_id: 'gpt-4',
        permission_mode: 'full_access'
      })

      const reopenedAgent = new DeepChatAgentPresenter(
        llmProvider,
        configPresenter,
        sqlitePresenter,
        toolPresenter
      )
      const compactionState = await reopenedAgent.getSessionCompactionState('s1')

      expect(compactionState).toEqual({
        status: 'compacted',
        cursorOrderSeq: 7,
        summaryUpdatedAt: 222
      })
    })

    it('reconciles runtime idle cache with persisted compacted state', async () => {
      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      sqlitePresenter.deepchatSessionsTable.updateSummaryState('s1', {
        summaryText: 'summary',
        summaryCursorOrderSeq: 3,
        summaryUpdatedAt: 333
      })

      const compactionState = await agent.getSessionCompactionState('s1')

      expect(compactionState).toEqual({
        status: 'compacted',
        cursorOrderSeq: 3,
        summaryUpdatedAt: 333
      })
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
      toolPresenter.getAllToolDefinitions.mockResolvedValueOnce([
        {
          type: 'function',
          source: 'agent',
          function: {
            name: 'write_file',
            description: 'write file',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'agent-filesystem', icons: '', description: '' }
        }
      ])

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

    it('offloads deferred tool results before resume', async () => {
      tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-deferred-offload-'))
      getPathSpy = vi.spyOn(app, 'getPath').mockReturnValue(tempHome)

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      makeAssistantRow({
        blocks: [
          {
            type: 'tool_call',
            status: 'pending',
            timestamp: 1,
            tool_call: {
              id: 'tc1',
              name: 'cdp_send',
              params: '{"method":"Page.captureScreenshot"}',
              response: ''
            }
          },
          {
            type: 'action',
            action_type: 'tool_call_permission',
            status: 'pending',
            timestamp: 2,
            content: 'Need permission',
            tool_call: {
              id: 'tc1',
              name: 'cdp_send',
              params: '{"method":"Page.captureScreenshot"}'
            },
            extra: {
              needsUserAction: true,
              permissionType: 'write',
              permissionRequest: JSON.stringify({
                permissionType: 'write',
                description: 'Need permission',
                toolName: 'cdp_send',
                serverName: 'yo-browser'
              })
            }
          }
        ]
      })
      toolPresenter.getAllToolDefinitions.mockResolvedValueOnce([
        {
          type: 'function',
          function: {
            name: 'cdp_send',
            description: 'CDP send',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'yo-browser', icons: '', description: '' }
        }
      ])
      toolPresenter.callTool.mockResolvedValueOnce({
        content: JSON.stringify({ data: 'x'.repeat(7000) }),
        rawData: { content: JSON.stringify({ data: 'x'.repeat(7000) }), isError: false }
      })

      const result = await agent.respondToolInteraction('s1', 'm1', 'tc1', {
        kind: 'permission',
        granted: true
      })

      expect(result).toEqual({ resumed: true })
      const updatedBlocks = JSON.parse(
        sqlitePresenter.deepchatMessagesTable.updateContent.mock.calls[0][1]
      )
      expect(updatedBlocks[0].tool_call.response).toContain('[Tool output offloaded]')
      expect(updatedBlocks[0].tool_call.response).toContain('tool_tc1')
      expect(updatedBlocks[0].tool_call.response).toContain('.offload')
      expect(updatedBlocks[0].tool_call.response).not.toContain(tempHome!)
      expect(updatedBlocks[0].status).toBe('success')
      expect(processStream).toHaveBeenCalledTimes(1)
    })

    it('cleans deferred offload files when resume budget downgrades the tool result', async () => {
      tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-deferred-cleanup-'))
      getPathSpy = vi.spyOn(app, 'getPath').mockReturnValue(tempHome)

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })
      makeAssistantRow({
        blocks: [
          {
            type: 'tool_call',
            status: 'pending',
            timestamp: 1,
            tool_call: {
              id: 'tc1',
              name: 'cdp_send',
              params: '{"method":"Page.captureScreenshot"}',
              response: ''
            }
          },
          {
            type: 'action',
            action_type: 'tool_call_permission',
            status: 'pending',
            timestamp: 2,
            content: 'Need permission',
            tool_call: {
              id: 'tc1',
              name: 'cdp_send',
              params: '{"method":"Page.captureScreenshot"}'
            },
            extra: {
              needsUserAction: true,
              permissionType: 'write',
              permissionRequest: JSON.stringify({
                permissionType: 'write',
                description: 'Need permission',
                toolName: 'cdp_send',
                serverName: 'yo-browser'
              })
            }
          }
        ]
      })
      toolPresenter.getAllToolDefinitions.mockResolvedValueOnce([
        {
          type: 'function',
          function: {
            name: 'cdp_send',
            description: 'CDP send',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'yo-browser', icons: '', description: '' }
        }
      ])
      toolPresenter.callTool.mockResolvedValueOnce({
        content: JSON.stringify({ data: 'x'.repeat(7000) }),
        rawData: { content: JSON.stringify({ data: 'x'.repeat(7000) }), isError: false }
      })

      const hasContextBudgetSpy = vi.spyOn((agent as any).toolOutputGuard, 'hasContextBudget')
      hasContextBudgetSpy.mockReturnValueOnce(false).mockReturnValueOnce(true)

      try {
        const result = await agent.respondToolInteraction('s1', 'm1', 'tc1', {
          kind: 'permission',
          granted: true
        })

        expect(result).toEqual({ resumed: true })
        const updateCalls = sqlitePresenter.deepchatMessagesTable.updateContent.mock.calls
        const updatedBlocks = JSON.parse(updateCalls[updateCalls.length - 1][1])
        expect(updatedBlocks[0].tool_call.response).toContain(
          'remaining context window is insufficient'
        )
        expect(updatedBlocks[0].tool_call.response).not.toContain('[Tool output offloaded]')
        const postToolUseCalls = hookDispatcher.dispatchEvent.mock.calls.filter(
          ([event]) => event === 'PostToolUse'
        )
        const postToolUseFailureCalls = hookDispatcher.dispatchEvent.mock.calls.filter(
          ([event]) => event === 'PostToolUseFailure'
        )
        expect(postToolUseCalls).toHaveLength(0)
        expect(postToolUseFailureCalls).toHaveLength(1)
        expect(postToolUseFailureCalls[0][1]).toEqual(
          expect.objectContaining({
            conversationId: 's1',
            tool: expect.objectContaining({
              callId: 'tc1',
              error: expect.stringContaining('remaining context window is insufficient')
            })
          })
        )
        await expect(
          fs.access(path.join(tempHome, '.deepchat', 'sessions', 's1', 'tool_tc1.offload'))
        ).rejects.toThrow()
        expect(processStream).toHaveBeenCalledTimes(1)
      } finally {
        hasContextBudgetSpy.mockRestore()
      }
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
      const postToolUseCalls = hookDispatcher.dispatchEvent.mock.calls.filter(
        ([event]) => event === 'PostToolUse'
      )
      const postToolUseFailureCalls = hookDispatcher.dispatchEvent.mock.calls.filter(
        ([event]) => event === 'PostToolUseFailure'
      )
      expect(postToolUseCalls).toHaveLength(0)
      expect(postToolUseFailureCalls).toHaveLength(1)
      expect(postToolUseFailureCalls[0][1]).toEqual(
        expect.objectContaining({
          conversationId: 's1',
          tool: expect.objectContaining({
            callId: 'tc1',
            error: 'User denied the request.'
          })
        })
      )
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

  describe('disabled tools', () => {
    it('returns a disabled error when a deferred tool call is no longer enabled', async () => {
      sqlitePresenter.newSessionsTable.getDisabledAgentTools.mockReturnValue(['exec'])
      toolPresenter.getAllToolDefinitions.mockResolvedValueOnce([])

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })

      const result = await (agent as any).executeDeferredToolCall('s1', {
        id: 'tc1',
        name: 'exec',
        params: '{"command":"npm test"}'
      })

      expect(result).toEqual(
        expect.objectContaining({
          isError: true,
          responseText: "Tool 'exec' is disabled for the current session."
        })
      )
    })

    it('passes providerId when executing a deferred MCP tool call', async () => {
      toolPresenter.getAllToolDefinitions.mockResolvedValueOnce([
        {
          type: 'function',
          function: {
            name: 'echo',
            description: 'Echo tool',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'test-server', icons: '', description: '' }
        }
      ])
      toolPresenter.callTool.mockResolvedValueOnce({
        content: 'tool result',
        rawData: { toolCallId: 'tc1', content: 'tool result', isError: false }
      })

      await agent.initSession('s1', { providerId: 'openai', modelId: 'gpt-4' })

      await (agent as any).executeDeferredToolCall('s1', {
        id: 'tc1',
        name: 'echo',
        params: '{}'
      })

      expect(toolPresenter.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 's1',
          providerId: 'openai'
        })
      )
    })
  })
})
