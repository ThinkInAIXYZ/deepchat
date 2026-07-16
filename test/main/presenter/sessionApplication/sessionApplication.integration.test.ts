import { AppSessionService } from '@/agent/shared/appSessionService'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nanoid } from 'nanoid'
import { AgentManager } from '@/agent/manager/agentManager'
import { createDirectAcpAgentBackend } from '@/agent/manager/directAcpAgentBackend'
import { AgentUnavailableError } from '@/agent/shared/agentCatalogCodec'
import type { AcpAgentDescriptor } from '@/agent/shared/agentDescriptors'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { SubagentTapeLinkInput } from '@shared/types/agent-interface'
import { AgentRepository } from '@/presenter/agentRepository'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import { createDeepChatAgentBackendFixture } from '../../agent/manager/deepChatAgentBackendFixture'
import { createProjectionCoordinatorFixture } from './projectionCoordinatorFixture'
import { createAssignmentCoordinatorFixture } from './assignmentCoordinatorFixture'

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'mock-session-id') }))

vi.mock('@/eventbus', () => ({
  eventBus: { sendToMain: vi.fn(), on: vi.fn() }
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
    }
  }
})

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

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

const linkTape = vi.fn((input: SubagentTapeLinkInput) =>
  Promise.resolve({
    linkEntry: { sessionId: input.parentSessionId, entryId: 1 },
    childSessionId: input.childSessionId,
    childHeadEntryId: 2,
    childEntryCount: 2,
    outcome: input.outcome
  })
)

import { eventBus } from '@/eventbus'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'

function expectSessionsUpdated(payload: Record<string, unknown>) {
  expect(publishDeepchatEvent).toHaveBeenCalledWith(
    'sessions.updated',
    expect.objectContaining(payload)
  )
}

function createMockDeepChatAgent() {
  return {
    initSession: vi.fn().mockResolvedValue(undefined),
    destroySession: vi.fn().mockResolvedValue(undefined),
    invalidateSessionSystemPromptCache: vi.fn(),
    getSessionState: vi.fn().mockResolvedValue({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    }),
    getSessionListState: vi.fn().mockResolvedValue({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    }),
    waitForFirstTurnReady: vi.fn(
      async (_sessionId: string, options?: { timeoutMs?: number }) =>
        await new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), options?.timeoutMs ?? 250)
        )
    ),
    processMessage: vi.fn().mockResolvedValue({
      requestId: null,
      messageId: null
    }),
    queuePendingInput: vi.fn().mockResolvedValue({
      id: 'queued-1',
      sessionId: 's1',
      mode: 'queue',
      state: 'pending',
      payload: { text: 'queued', files: [] },
      queueOrder: 1,
      claimedAt: null,
      consumedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }),
    updateQueuedInput: vi.fn().mockResolvedValue({}),
    moveQueuedInput: vi.fn().mockResolvedValue([]),
    convertPendingInputToSteer: vi.fn().mockResolvedValue({}),
    steerPendingInput: vi.fn().mockResolvedValue({}),
    deletePendingInput: vi.fn().mockResolvedValue(undefined),
    steerActiveTurn: vi.fn().mockResolvedValue(undefined),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    clearMessages: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    listMessagesPage: vi.fn().mockResolvedValue({ messages: [], nextCursor: null, hasMore: false }),
    hasMessages: vi.fn().mockResolvedValue(false),
    listPendingInputs: vi.fn().mockResolvedValue([]),
    linkSubagentTape: linkTape,
    getActiveGeneration: vi.fn().mockReturnValue(null),
    cancelGenerationByEventId: vi.fn().mockResolvedValue(false),
    getSessionCompactionState: vi.fn().mockResolvedValue({
      status: 'idle',
      cursorOrderSeq: 1,
      summaryUpdatedAt: null
    }),
    compactSession: vi.fn().mockResolvedValue({
      compacted: false,
      state: { status: 'idle', cursorOrderSeq: 1, summaryUpdatedAt: null }
    }),
    getMessageIds: vi.fn().mockResolvedValue([]),
    getMessage: vi.fn().mockResolvedValue(null),
    getTapeInfo: vi.fn().mockResolvedValue({}),
    searchTape: vi.fn().mockResolvedValue([]),
    getTapeContext: vi.fn().mockResolvedValue({}),
    listTapeAnchors: vi.fn().mockResolvedValue([]),
    handoffTape: vi.fn().mockResolvedValue({}),
    listMessageViewManifests: vi.fn().mockResolvedValue([]),
    exportMessageTapeReplaySlice: vi.fn().mockResolvedValue(null),
    prepareRetryMessage: vi
      .fn()
      .mockResolvedValue({ content: { text: 'retry', files: [] }, projectDir: null }),
    retryMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editUserMessage: vi.fn().mockResolvedValue({}),
    forkSessionFromMessage: vi.fn().mockResolvedValue(undefined),
    respondToolInteraction: vi.fn().mockResolvedValue({ resumed: false }),
    getPermissionMode: vi.fn().mockResolvedValue('full_access'),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setSessionAgentContext: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    setSessionProjectDir: vi.fn().mockResolvedValue(undefined),
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
    getDefaultProjectPath: vi.fn().mockReturnValue(null),
    getModelConfig: vi.fn().mockReturnValue({}),
    getSetting: vi.fn().mockReturnValue(undefined),
    getAcpAgents: vi.fn().mockResolvedValue([]),
    getAcpEnabled: vi.fn().mockResolvedValue(true),
    listAgents: vi
      .fn()
      .mockResolvedValue([{ id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true }]),
    getDeepChatAgentConfig: vi.fn().mockResolvedValue({}),
    updateDeepChatAgent: vi.fn().mockResolvedValue(null),
    getAgentType: vi.fn().mockImplementation(async (agentId: string) => {
      if (agentId === 'deepchat') {
        return 'deepchat'
      }
      return agentId.startsWith('acp') ? 'acp' : null
    }),
    resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({})
  } as any
}

function createMockLlmProviderPresenter() {
  return {
    summaryTitles: vi.fn().mockResolvedValue('Async Generated Title'),
    generateText: vi.fn().mockResolvedValue({
      content: ['## Current Goal', '- Continue the conversation'].join('\n')
    }),
    setAcpWorkdir: vi.fn().mockResolvedValue(undefined),
    clearAcpSession: vi.fn().mockResolvedValue(undefined),
    getAcpSessionCommands: vi
      .fn()
      .mockResolvedValue([
        { name: 'review', description: 'run review', input: { hint: 'ticket id' } }
      ]),
    getAcpSessionConfigOptions: vi.fn().mockResolvedValue({
      source: 'configOptions',
      options: [
        {
          id: 'model',
          label: 'Model',
          type: 'select',
          category: 'model',
          currentValue: 'gpt-5',
          options: [
            { value: 'gpt-5', label: 'gpt-5' },
            { value: 'gpt-5-mini', label: 'gpt-5-mini' }
          ]
        }
      ]
    }),
    setAcpSessionConfigOption: vi
      .fn()
      .mockImplementation(
        async (_sessionId: string, configId: string, value: string | boolean) => ({
          source: 'configOptions',
          options: [
            {
              id: configId,
              label: 'Model',
              type: 'select',
              category: 'model',
              currentValue: value,
              options: [
                { value: 'gpt-5', label: 'gpt-5' },
                { value: 'gpt-5-mini', label: 'gpt-5-mini' }
              ]
            }
          ]
        })
      )
  } as any
}

function createMockDirectAcpControl() {
  return {
    prepare: vi.fn().mockResolvedValue(undefined),
    updateWorkdir: vi.fn(async (workdir: string | null) => workdir ?? ''),
    getModes: vi.fn().mockResolvedValue(null),
    setMode: vi.fn().mockResolvedValue(undefined),
    getConfigOptions: vi.fn().mockResolvedValue({
      source: 'configOptions',
      options: [
        {
          id: 'model',
          label: 'Model',
          type: 'select',
          category: 'model',
          currentValue: 'gpt-5',
          options: [
            { value: 'gpt-5', label: 'gpt-5' },
            { value: 'gpt-5-mini', label: 'gpt-5-mini' }
          ]
        }
      ]
    }),
    setConfigOption: vi.fn(async (configId: string, value: string | boolean) => ({
      source: 'configOptions',
      options: [
        {
          id: configId,
          label: 'Model',
          type: 'select',
          category: 'model',
          currentValue: value,
          options: [
            { value: 'gpt-5', label: 'gpt-5' },
            { value: 'gpt-5-mini', label: 'gpt-5-mini' }
          ]
        }
      ]
    })),
    getCommands: vi
      .fn()
      .mockResolvedValue([
        { name: 'review', description: 'run review', input: { hint: 'ticket id' } }
      ])
  }
}

function createMockSkillPresenter() {
  return {
    setActiveSkills: vi.fn().mockResolvedValue([]),
    clearNewAgentSessionSkills: vi.fn().mockResolvedValue(undefined)
  } as any
}

function createMockSqlitePresenter() {
  const db = {
    prepare: vi.fn((sql: string) => ({
      all: vi.fn((...args: unknown[]) => {
        if (sql.includes('FROM new_sessions')) {
          return [
            {
              id: 'session-1',
              title: 'Release checklist',
              projectDir: '/repo',
              updatedAt: 200
            }
          ]
        }

        if (sql.includes('FROM deepchat_messages')) {
          return [
            {
              id: 'message-1',
              sessionId: 'session-1',
              title: 'Release checklist',
              role: 'assistant',
              content: JSON.stringify([
                { type: 'text', content: 'pnpm run build still fails on arm64' }
              ]),
              updatedAt: 100
            }
          ]
        }

        throw new Error(`Unexpected SQL in test: ${sql} with args ${JSON.stringify(args)}`)
      })
    }))
  }

  return {
    db,
    getDatabase: vi.fn(() => db),
    configTables: {
      getAgentSetting: vi.fn().mockReturnValue(null),
      setAgentSetting: vi.fn()
    },
    newSessionsTable: {
      create: vi.fn(),
      get: vi.fn().mockReturnValue({
        id: 'session-1',
        agent_id: 'deepchat',
        title: 'Release checklist',
        project_dir: '/repo',
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 100,
        updated_at: 200
      }),
      getMany: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      listPage: vi.fn().mockReturnValue({
        rows: [],
        hasMore: false
      }),
      getDisabledAgentTools: vi.fn().mockReturnValue([]),
      updateDisabledAgentTools: vi.fn(),
      updateAgentId: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    newProjectsTable: {
      getAll: vi.fn().mockReturnValue([]),
      getRecent: vi.fn().mockReturnValue([])
    },
    newEnvironmentsTable: {
      syncPath: vi.fn(),
      listPathsForSession: vi.fn().mockReturnValue([]),
      syncForSession: vi.fn()
    },
    deepchatSessionsTable: {
      create: vi.fn(),
      get: vi.fn(),
      getGenerationSettings: vi.fn(),
      getSummaryState: vi.fn().mockReturnValue(null),
      updatePermissionMode: vi.fn(),
      updateGenerationSettings: vi.fn(),
      updateSummaryState: vi.fn(),
      resetSummaryState: vi.fn(),
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
      countByMessageId: vi.fn().mockReturnValue(0),
      maxRequestSeqByMessageId: vi.fn().mockReturnValue(0)
    },
    deepchatSearchDocumentsTable: {
      upsert: vi.fn(),
      refreshSessionTitle: vi.fn(),
      deleteBySession: vi.fn(),
      searchFts: vi.fn().mockReturnValue([]),
      searchLike: vi.fn().mockReturnValue([])
    },
    deepchatSessionMetadataTable: {
      get: vi.fn().mockReturnValue(null),
      upsert: vi.fn(),
      delete: vi.fn()
    },
    deepchatMessageSearchResultsTable: {
      listByMessageId: vi.fn().mockReturnValue([])
    }
  } as any
}

function installSessionStore(sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>) {
  const rows = new Map<string, any>()
  sqlitePresenter.newSessionsTable.create.mockImplementation(
    (
      id: string,
      agentId: string,
      title: string,
      projectDir: string | null,
      options: Record<string, unknown> = {}
    ) => {
      rows.set(id, {
        id,
        agent_id: agentId,
        title,
        project_dir: projectDir,
        is_pinned: 0,
        is_draft: options.isDraft ? 1 : 0,
        session_kind: options.sessionKind ?? 'regular',
        parent_session_id: options.parentSessionId ?? null,
        subagent_enabled: 0,
        subagent_meta_json: options.subagentMetaJson ?? null,
        created_at: Date.now(),
        updated_at: Date.now()
      })
    }
  )
  sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) => rows.get(id))
  sqlitePresenter.newSessionsTable.list.mockImplementation((filters: any) =>
    Array.from(rows.values()).filter(
      (row) =>
        (!filters?.agentId || row.agent_id === filters.agentId) &&
        (filters?.parentSessionId === undefined ||
          row.parent_session_id === filters.parentSessionId)
    )
  )
  sqlitePresenter.newSessionsTable.update.mockImplementation((id: string, fields: any) => {
    const row = rows.get(id)
    if (!row) return
    rows.set(id, { ...row, ...fields, updated_at: Date.now() })
  })
  sqlitePresenter.newSessionsTable.delete.mockImplementation((id: string) => rows.delete(id))
  return rows
}

function createDescriptorIndependentDeleteHarness(options: {
  sessions: Array<{
    id: string
    agentId: string
    sessionKind?: 'regular' | 'subagent'
    parentSessionId?: string | null
  }>
  agents?: Array<{
    id: string
    agentType: 'deepchat' | 'acp'
    source: 'builtin' | 'manual' | 'registry'
    configJson: string | null
    enabled?: boolean
  }>
}) {
  const now = Date.now()
  const sqlitePresenter = createMockSqlitePresenter()
  const sessions = new Map(
    options.sessions.map((session) => [
      session.id,
      {
        id: session.id,
        agent_id: session.agentId,
        title: session.id,
        project_dir: null,
        is_pinned: 0,
        is_draft: 0,
        session_kind: session.sessionKind ?? 'regular',
        parent_session_id: session.parentSessionId ?? null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: now,
        updated_at: now
      }
    ])
  )
  const agents = new Map(
    (options.agents ?? []).map((agent) => [
      agent.id,
      {
        id: agent.id,
        agent_type: agent.agentType,
        source: agent.source,
        name: agent.id,
        enabled: agent.enabled === false ? 0 : 1,
        protected: agent.source === 'builtin' ? 1 : 0,
        description: null,
        icon: null,
        avatar_json: null,
        config_json: agent.configJson,
        state_json: null,
        created_at: now,
        updated_at: now
      }
    ])
  )
  const deleteSessionRow = vi.fn((sessionId: string) => sessions.delete(sessionId))
  const sqliteWithAgents = {
    ...sqlitePresenter,
    agentsTable: {
      get: (agentId: string) => agents.get(agentId),
      list: () => [...agents.values()]
    },
    newSessionsTable: {
      ...sqlitePresenter.newSessionsTable,
      get: (sessionId: string) => sessions.get(sessionId),
      list: (filters?: { agentId?: string; parentSessionId?: string }) =>
        [...sessions.values()].filter(
          (row) =>
            (!filters?.agentId || row.agent_id === filters.agentId) &&
            (filters?.parentSessionId === undefined ||
              row.parent_session_id === filters.parentSessionId)
        ),
      delete: deleteSessionRow
    }
  } as any
  const repository = new AgentRepository(sqliteWithAgents)
  const resolveExecutableDescriptor = vi.spyOn(repository, 'resolveExecutableDescriptor')
  const appSessionService = new AppSessionService({
    newSessionsTable: sqliteWithAgents.newSessionsTable,
    deepchatSessionMetadataTable: sqliteWithAgents.deepchatSessionMetadataTable,
    deepchatSearchDocumentsTable: sqliteWithAgents.deepchatSearchDocumentsTable,
    newEnvironmentsTable: sqliteWithAgents.newEnvironmentsTable
  })
  const deepchatImplementation = createMockDeepChatAgent()
  const directRuntimeCleanup = vi.fn().mockResolvedValue(undefined)
  const deleteDurableSession = vi.fn().mockResolvedValue(undefined)
  const resolveInput = vi
    .fn()
    .mockRejectedValue(new AgentUnavailableError('fixture-agent', 'invalid-config', 'acp'))
  const manager = new AgentManager(repository, appSessionService, {
    deepchat: createDeepChatAgentBackendFixture(deepchatImplementation as never),
    acp: createDirectAcpAgentBackend({
      runtime: { cleanupSession: directRuntimeCleanup } as never,
      sessionState: deepchatImplementation,
      transcript: deepchatImplementation,
      tape: deepchatImplementation,
      deleteDurableSession,
      resolveInput
    })
  })
  const skillPresenter = createMockSkillPresenter()
  const sessionPermissionPort = {
    clearSessionPermissions: vi.fn(),
    approvePermission: vi.fn().mockResolvedValue(undefined)
  }
  const llmProviderPresenter = createMockLlmProviderPresenter()
  const configPresenter = createMockConfigPresenter()
  const sharedData = {
    sessionState: deepchatImplementation,
    transcript: deepchatImplementation,
    transcriptMutation: deepchatImplementation,
    tape: deepchatImplementation
  } as any
  const projection = createProjectionCoordinatorFixture({
    agentManager: manager,
    appSessionService,
    llmProviderPresenter,
    configPresenter,
    sqlitePresenter: sqliteWithAgents,
    sharedData
  })
  const sessionApplications = createAssignmentCoordinatorFixture({
    agentManager: manager,
    appSessionService,
    configPresenter,
    sqlitePresenter: sqliteWithAgents,
    sharedData,
    projection,
    acp: llmProviderPresenter,
    skillPresenter,
    sessionPermissionPort
  })
  return {
    lifecycle: sessionApplications.lifecycle,
    turn: sessionApplications.turn,
    assignment: sessionApplications.assignment,
    projection,
    manager,
    sessions,
    deleteSessionRow,
    resolveExecutableDescriptor,
    deepchatImplementation,
    directRuntimeCleanup,
    deleteDurableSession,
    resolveInput,
    skillPresenter,
    sessionPermissionPort
  }
}

describe('Session application coordinators', () => {
  let deepChatAgent: ReturnType<typeof createMockDeepChatAgent>
  let llmProviderPresenter: ReturnType<typeof createMockLlmProviderPresenter>
  let configPresenter: ReturnType<typeof createMockConfigPresenter>
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let skillPresenter: ReturnType<typeof createMockSkillPresenter>
  let closeDirectAcpSession: ReturnType<typeof vi.fn>
  let closeDirectAcpRuntime: ReturnType<typeof vi.fn>
  let directAcpControl: ReturnType<typeof createMockDirectAcpControl>
  let sessionUiPort: { refreshSessionUi: ReturnType<typeof vi.fn> }
  let agentManager: {
    resolveBackend: ReturnType<typeof vi.fn>
    resolveSessionBackend: ReturnType<typeof vi.fn>
    resolveSessionHandle: ReturnType<typeof vi.fn>
    resolveTransferSource: ReturnType<typeof vi.fn>
    resolveDeepChatTransferTarget: ReturnType<typeof vi.fn>
    resolveSubagentFacet: ReturnType<typeof vi.fn>
    cleanupSessionBackends: ReturnType<typeof vi.fn>
  }
  let lifecycle: ReturnType<typeof createAssignmentCoordinatorFixture>['lifecycle']
  let turn: ReturnType<typeof createAssignmentCoordinatorFixture>['turn']
  let assignment: ReturnType<typeof createAssignmentCoordinatorFixture>['assignment']
  let projection: ReturnType<typeof createProjectionCoordinatorFixture>

  beforeEach(() => {
    vi.clearAllMocks()
    deepChatAgent = createMockDeepChatAgent()
    llmProviderPresenter = createMockLlmProviderPresenter()
    configPresenter = createMockConfigPresenter()
    sqlitePresenter = createMockSqlitePresenter()
    skillPresenter = createMockSkillPresenter()
    closeDirectAcpSession = vi.fn().mockResolvedValue(undefined)
    closeDirectAcpRuntime = vi.fn().mockResolvedValue(undefined)
    directAcpControl = createMockDirectAcpControl()
    sessionUiPort = { refreshSessionUi: vi.fn() }
    const backend = createDeepChatAgentBackendFixture(deepChatAgent as never)
    const resolveBackend = vi.fn((agentId: string) => {
      if (agentId === 'disabled-agent') throw new Error(`Agent not found: ${agentId}`)
      const kind = agentId.includes('acp') || agentId === 'kimi' ? 'acp' : 'deepchat'
      const descriptor =
        kind === 'acp'
          ? { id: agentId, kind, source: 'manual' }
          : { id: agentId, kind, source: 'manual', config: {} }
      return { kind, descriptor, backend }
    })
    const resolveSessionBackend = vi.fn((sessionId: string) => {
      if (sessionId === 'missing-agent' || sessionId === 's-disabled') {
        throw new Error('Agent not found: disabled-agent')
      }
      const session = sqlitePresenter.newSessionsTable.get(sessionId)
      if (!session) throw new Error(`Session not found: ${sessionId}`)
      return resolveBackend(session.agent_id ?? session.agentId)
    })
    agentManager = {
      resolveBackend,
      resolveSessionBackend,
      resolveSessionHandle: vi.fn((sessionId: string) => {
        const { kind, descriptor, backend } = resolveSessionBackend(sessionId)
        const backendHandle = backend.open(sessionId)
        const handle =
          kind === 'acp'
            ? {
                ...backendHandle,
                kind: 'acp',
                close: async () => {
                  await closeDirectAcpSession(sessionId)
                  await backendHandle.close()
                },
                acp: {
                  ...directAcpControl,
                  closeRuntime: vi.fn().mockResolvedValue(undefined)
                }
              }
            : backendHandle
        return { kind, descriptor, handle }
      }),
      resolveTransferSource: vi.fn((sessionId: string) => {
        const { kind, descriptor, backend } = resolveSessionBackend(sessionId)
        return {
          descriptor,
          handle: agentManager.resolveSessionHandle(sessionId).handle,
          facet: backend.transferSource,
          ...(kind === 'acp' ? { closeRuntime: closeDirectAcpRuntime } : {})
        }
      }),
      resolveDeepChatTransferTarget: vi.fn((agentId: string) => {
        const { descriptor, backend } = resolveBackend(agentId)
        if (descriptor.kind !== 'deepchat' || backend.kind !== 'deepchat') {
          throw new Error(`Agent ${agentId} does not support session transfer.`)
        }
        return { descriptor, facet: backend.transferTarget }
      }),
      resolveSubagentFacet: vi.fn((sessionId: string) => {
        const { descriptor, backend } = resolveSessionBackend(sessionId)
        return { kind: descriptor.kind, descriptor, facet: backend.subagent }
      }),
      cleanupSessionBackends: vi.fn(async (sessionId: string) => {
        await closeDirectAcpSession(sessionId)
      })
    }
    const appSessionService = new AppSessionService({
      newSessionsTable: sqlitePresenter.newSessionsTable,
      deepchatSessionMetadataTable: sqlitePresenter.deepchatSessionMetadataTable,
      deepchatSearchDocumentsTable: sqlitePresenter.deepchatSearchDocumentsTable,
      newEnvironmentsTable: sqlitePresenter.newEnvironmentsTable
    })
    const sharedData = {
      sessionState: deepChatAgent,
      transcript: deepChatAgent,
      transcriptMutation: deepChatAgent,
      tape: deepChatAgent
    } as any
    projection = createProjectionCoordinatorFixture({
      agentManager: agentManager as any,
      appSessionService,
      llmProviderPresenter,
      configPresenter,
      sqlitePresenter,
      sharedData,
      sessionUiPort
    })
    const sessionApplications = createAssignmentCoordinatorFixture({
      agentManager: agentManager as any,
      appSessionService,
      configPresenter,
      sqlitePresenter,
      sharedData,
      projection,
      acp: llmProviderPresenter,
      skillPresenter
    })
    lifecycle = sessionApplications.lifecycle
    turn = sessionApplications.turn
    assignment = sessionApplications.assignment
  })

  it('routes public session operations through the real catalog and manager chain', async () => {
    const now = Date.now()
    const agentRows = new Map<string, any>([
      [
        'deepchat',
        {
          id: 'deepchat',
          agent_type: 'deepchat',
          source: 'builtin',
          name: 'DeepChat',
          enabled: 1,
          protected: 1,
          description: null,
          icon: null,
          avatar_json: null,
          config_json: '{}',
          state_json: null,
          created_at: now,
          updated_at: now
        }
      ],
      [
        'claude-acp',
        {
          id: 'claude-acp',
          agent_type: 'acp',
          source: 'manual',
          name: 'Claude ACP',
          enabled: 1,
          protected: 0,
          description: null,
          icon: null,
          avatar_json: null,
          config_json: JSON.stringify({ command: 'claude-acp' }),
          state_json: '{}',
          created_at: now,
          updated_at: now
        }
      ],
      [
        'broken-acp',
        {
          id: 'broken-acp',
          agent_type: 'acp',
          source: 'manual',
          name: 'Broken ACP',
          enabled: 1,
          protected: 0,
          description: null,
          icon: null,
          avatar_json: null,
          config_json: '{}',
          state_json: '{}',
          created_at: now,
          updated_at: now
        }
      ],
      [
        'unconfigured-acp',
        {
          id: 'unconfigured-acp',
          agent_type: 'acp',
          source: 'manual',
          name: 'Unconfigured ACP',
          enabled: 1,
          protected: 0,
          description: null,
          icon: null,
          avatar_json: null,
          config_json: JSON.stringify({ command: 'unconfigured-acp' }),
          state_json: '{}',
          created_at: now,
          updated_at: now
        }
      ]
    ])
    const sessions = new Map(
      [
        ['deepchat-session', 'deepchat', null],
        ['acp-session', 'claude-code-acp', '/tmp/acp'],
        ['unconfigured-session', 'unconfigured-acp', '/tmp/acp'],
        ['missing-session', 'missing-agent', null],
        ['broken-session', 'broken-acp', null]
      ].map(([id, agentId, projectDir]) => [
        id,
        {
          id,
          agent_id: agentId,
          title: id,
          project_dir: projectDir,
          is_pinned: 0,
          is_draft: 0,
          session_kind: 'regular',
          parent_session_id: null,
          subagent_enabled: 0,
          subagent_meta_json: null,
          created_at: now,
          updated_at: now
        }
      ])
    )
    const sqliteWithAgents = {
      ...sqlitePresenter,
      agentsTable: {
        get: (id: string) => agentRows.get(id),
        list: () => [...agentRows.values()]
      },
      newSessionsTable: {
        ...sqlitePresenter.newSessionsTable,
        get: (id: string) => sessions.get(id),
        list: (filters?: { agentId?: string; parentSessionId?: string }) =>
          [...sessions.values()].filter(
            (row) =>
              (!filters?.agentId || row.agent_id === filters.agentId) &&
              (filters?.parentSessionId === undefined ||
                row.parent_session_id === filters.parentSessionId)
          ),
        delete: (id: string) => sessions.delete(id)
      }
    } as any
    const repository = new AgentRepository(sqliteWithAgents)
    const deepchatImplementation = {
      ...createMockDeepChatAgent(),
      getSessionState: vi.fn().mockResolvedValue({ providerId: 'openai', modelId: 'gpt-4' }),
      hasMessages: vi.fn(async (sessionId: string) => sessionId !== 'acp-session'),
      getMessages: vi.fn(async (sessionId: string) =>
        sessionId === 'acp-session'
          ? [
              {
                id: 'acp-user',
                sessionId,
                orderSeq: 1,
                role: 'user',
                content: JSON.stringify({ text: 'Hello', files: [] }),
                status: 'sent'
              },
              {
                id: 'acp-assistant',
                sessionId,
                orderSeq: 2,
                role: 'assistant',
                content: JSON.stringify([
                  { type: 'content', content: 'Hi', status: 'success', timestamp: now }
                ]),
                status: 'sent'
              }
            ]
          : []
      ),
      listPendingInputs: vi.fn().mockResolvedValue([]),
      setSessionAgentContext: vi.fn().mockResolvedValue(undefined),
      linkSubagentTape: linkTape,
      getActiveGeneration: vi.fn().mockReturnValue(null),
      cancelGenerationByEventId: vi.fn().mockResolvedValue(false),
      processMessage: vi
        .fn()
        .mockResolvedValue({ requestId: 'deepchat-request', messageId: 'deepchat-message' })
    } as any
    const appSessionService = new AppSessionService({
      newSessionsTable: sqliteWithAgents.newSessionsTable,
      deepchatSessionMetadataTable: sqliteWithAgents.deepchatSessionMetadataTable,
      deepchatSearchDocumentsTable: sqliteWithAgents.deepchatSearchDocumentsTable,
      newEnvironmentsTable: sqliteWithAgents.newEnvironmentsTable
    })
    const directAcpInstance = {
      snapshot: vi.fn().mockResolvedValue({ status: 'idle' }),
      getWorkdir: vi.fn().mockReturnValue('/tmp/acp'),
      waitForFirstTurnReady: vi.fn().mockResolvedValue(true)
    }
    const directAcpRuntime = {
      getOrHydrate: vi.fn().mockResolvedValue(directAcpInstance),
      queuePendingInput: vi.fn().mockResolvedValue({ id: 'acp-pending' }),
      steer: vi.fn().mockResolvedValue({ id: 'acp-steer' }),
      close: vi.fn().mockResolvedValue(undefined),
      cleanupSession: vi.fn().mockResolvedValue(undefined)
    }
    const acpConfigs = new Map([
      [
        'claude-acp',
        {
          id: 'claude-acp',
          name: 'Claude ACP',
          command: 'claude-acp',
          source: 'manual' as const
        }
      ]
    ])
    const resolveDirectAcpInput = vi.fn(
      async (sessionId: AppSessionId, descriptor: AcpAgentDescriptor) => {
        const session = appSessionService.get(sessionId)
        const agent = acpConfigs.get(descriptor.id)
        if (
          !session ||
          resolveAcpAgentAlias(session.agentId) !== descriptor.id ||
          !agent ||
          agent.source !== descriptor.source
        ) {
          throw new AgentUnavailableError(descriptor.id, 'invalid-config', 'acp')
        }
        return {
          sessionId,
          descriptor,
          agent,
          scope: session.sessionKind === 'subagent' ? 'subagent' : 'regular',
          workdir: session.projectDir?.trim() ?? ''
        }
      }
    )
    const realManager = new AgentManager(repository, appSessionService, {
      deepchat: createDeepChatAgentBackendFixture(deepchatImplementation),
      acp: createDirectAcpAgentBackend({
        runtime: directAcpRuntime as never,
        sessionState: deepchatImplementation,
        transcript: deepchatImplementation,
        tape: deepchatImplementation,
        deleteDurableSession: vi.fn().mockResolvedValue(undefined),
        resolveInput: resolveDirectAcpInput
      })
    })
    const integratedSharedData = {
      sessionState: deepchatImplementation,
      transcript: deepchatImplementation,
      transcriptMutation: deepchatImplementation,
      tape: deepchatImplementation
    } as any
    const projection = createProjectionCoordinatorFixture({
      agentManager: realManager,
      appSessionService,
      llmProviderPresenter,
      configPresenter,
      sqlitePresenter: sqliteWithAgents,
      sharedData: integratedSharedData
    })
    const sessionApplications = createAssignmentCoordinatorFixture({
      agentManager: realManager,
      appSessionService,
      configPresenter,
      sqlitePresenter: sqliteWithAgents,
      sharedData: integratedSharedData,
      projection,
      acp: llmProviderPresenter,
      skillPresenter
    })
    await expect(
      sessionApplications.turn.sendMessage('deepchat-session', 'Hello')
    ).resolves.toEqual({
      requestId: null,
      messageId: null
    })
    await expect(sessionApplications.turn.sendMessage('acp-session', 'Hello')).resolves.toEqual({
      requestId: null,
      messageId: null
    })
    await sessionApplications.turn.queuePendingInput('acp-session', 'Later')
    await sessionApplications.turn.steerActiveTurn('acp-session', 'Now')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(deepchatImplementation.queuePendingInput).toHaveBeenCalledWith(
      'deepchat-session',
      { text: 'Hello', files: [] },
      expect.objectContaining({ source: 'send', projectDir: null })
    )
    expect(directAcpRuntime.queuePendingInput).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'acp-session',
        workdir: '/tmp/acp',
        descriptor: expect.objectContaining({ id: 'claude-acp', kind: 'acp' })
      }),
      { text: 'Hello', files: [] }
    )
    expect(directAcpRuntime.queuePendingInput).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'acp-session' }),
      { text: 'Later', files: [] }
    )
    expect(directAcpRuntime.steer).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'acp-session' }),
      { text: 'Now', files: [] }
    )
    expect(llmProviderPresenter.summaryTitles).toHaveBeenCalledOnce()
    expect(llmProviderPresenter.summaryTitles).toHaveBeenCalledWith(
      expect.any(Array),
      'acp',
      'claude-acp'
    )
    await expect(
      sessionApplications.turn.sendMessage('unconfigured-session', 'Hello')
    ).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE', reason: 'invalid-config' })
    await expect(
      sessionApplications.lifecycle.deleteSession('unconfigured-session')
    ).resolves.toBeUndefined()
    expect(directAcpRuntime.cleanupSession).toHaveBeenCalledWith('unconfigured-session')
    expect(deepchatImplementation.queuePendingInput).toHaveBeenCalledTimes(1)
    expect(llmProviderPresenter.setAcpWorkdir).not.toHaveBeenCalled()
    await expect(
      sessionApplications.turn.sendMessage('missing-session', 'Hello')
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' })
    await expect(
      sessionApplications.turn.sendMessage('broken-session', 'Hello')
    ).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE', reason: 'missing-manual-command' })
  })

  it.each([
    {
      caseName: 'a missing agent row',
      agentId: 'missing-agent',
      agent: null
    },
    {
      caseName: 'malformed manual ACP JSON',
      agentId: 'malformed-manual',
      agent: {
        id: 'malformed-manual',
        agentType: 'acp' as const,
        source: 'manual' as const,
        configJson: '{'
      }
    },
    {
      caseName: 'a manual ACP agent without a command',
      agentId: 'commandless-manual',
      agent: {
        id: 'commandless-manual',
        agentType: 'acp' as const,
        source: 'manual' as const,
        configJson: '{}'
      }
    },
    {
      caseName: 'a registry ACP agent without a reference',
      agentId: 'missing-registry-reference',
      agent: {
        id: 'missing-registry-reference',
        agentType: 'acp' as const,
        source: 'registry' as const,
        configJson: '{}'
      }
    },
    {
      caseName: 'a disabled registry ACP agent',
      agentId: 'disabled-registry',
      agent: {
        id: 'disabled-registry',
        agentType: 'acp' as const,
        source: 'registry' as const,
        configJson: JSON.stringify({
          version: '1.0.0',
          distribution: { npx: { package: '@test/disabled-registry' } }
        }),
        enabled: false
      }
    },
    {
      caseName: 'a valid descriptor whose current launch config is missing',
      agentId: 'unconfigured-manual',
      agent: {
        id: 'unconfigured-manual',
        agentType: 'acp' as const,
        source: 'manual' as const,
        configJson: JSON.stringify({ command: 'unconfigured-manual' })
      }
    }
  ])('deletes a session with $caseName without descriptor routing', async ({ agentId, agent }) => {
    const harness = createDescriptorIndependentDeleteHarness({
      sessions: [{ id: 'delete-target', agentId }],
      agents: agent ? [agent] : []
    })

    await expect(harness.lifecycle.deleteSession('delete-target')).resolves.toBeUndefined()

    expect(harness.resolveExecutableDescriptor).not.toHaveBeenCalled()
    expect(harness.resolveInput).not.toHaveBeenCalled()
    expect(harness.directRuntimeCleanup).toHaveBeenCalledExactlyOnceWith('delete-target')
    expect(harness.deleteDurableSession).toHaveBeenCalledExactlyOnceWith('delete-target')
    expect(harness.deepchatImplementation.destroySession).toHaveBeenCalledExactlyOnceWith(
      'delete-target'
    )
    expect(harness.sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledExactlyOnceWith(
      'delete-target'
    )
    expect(harness.skillPresenter.clearNewAgentSessionSkills).toHaveBeenCalledExactlyOnceWith(
      'delete-target'
    )
    expect(harness.deleteSessionRow).toHaveBeenCalledExactlyOnceWith('delete-target')
    expect(harness.sessions.has('delete-target')).toBe(false)
    expect(harness.deepchatImplementation.processMessage).not.toHaveBeenCalled()
    expect(harness.deepchatImplementation.queuePendingInput).not.toHaveBeenCalled()
    expect(harness.deepchatImplementation.cancelGeneration).not.toHaveBeenCalled()
    expect(harness.directRuntimeCleanup.mock.invocationCallOrder[0]).toBeLessThan(
      harness.deleteDurableSession.mock.invocationCallOrder[0]
    )
    expect(harness.deleteDurableSession.mock.invocationCallOrder[0]).toBeLessThan(
      harness.deepchatImplementation.destroySession.mock.invocationCallOrder[0]
    )
    expect(harness.deepchatImplementation.destroySession.mock.invocationCallOrder[0]).toBeLessThan(
      harness.sessionPermissionPort.clearSessionPermissions.mock.invocationCallOrder[0]
    )
    expect(
      harness.sessionPermissionPort.clearSessionPermissions.mock.invocationCallOrder[0]
    ).toBeLessThan(harness.skillPresenter.clearNewAgentSessionSkills.mock.invocationCallOrder[0])
    expect(
      harness.skillPresenter.clearNewAgentSessionSkills.mock.invocationCallOrder[0]
    ).toBeLessThan(harness.deleteSessionRow.mock.invocationCallOrder[0])
  })

  it('continues parent deletion after descriptor-independent malformed child cleanup', async () => {
    const harness = createDescriptorIndependentDeleteHarness({
      sessions: [
        { id: 'parent-session', agentId: 'deepchat' },
        {
          id: 'malformed-child',
          agentId: 'malformed-child-agent',
          sessionKind: 'subagent',
          parentSessionId: 'parent-session'
        }
      ],
      agents: [
        {
          id: 'deepchat',
          agentType: 'deepchat',
          source: 'builtin',
          configJson: '{}'
        },
        {
          id: 'malformed-child-agent',
          agentType: 'acp',
          source: 'manual',
          configJson: '{'
        }
      ]
    })

    await expect(harness.lifecycle.deleteSession('parent-session')).resolves.toBeUndefined()

    expect(harness.resolveExecutableDescriptor).not.toHaveBeenCalled()
    expect(harness.resolveInput).not.toHaveBeenCalled()
    expect(harness.directRuntimeCleanup.mock.calls).toEqual([
      ['malformed-child'],
      ['parent-session']
    ])
    expect(harness.deleteDurableSession.mock.calls).toEqual([
      ['malformed-child'],
      ['parent-session']
    ])
    expect(harness.deepchatImplementation.destroySession.mock.calls).toEqual([
      ['malformed-child'],
      ['parent-session']
    ])
    expect(harness.deleteSessionRow.mock.calls).toEqual([['malformed-child'], ['parent-session']])
    expect(harness.sessions.size).toBe(0)
  })

  it('keeps hydrated DeepChat deletion on the descriptor-independent cleanup path', async () => {
    const harness = createDescriptorIndependentDeleteHarness({
      sessions: [{ id: 'deepchat-session', agentId: 'deepchat' }],
      agents: [
        {
          id: 'deepchat',
          agentType: 'deepchat',
          source: 'builtin',
          configJson: '{}'
        }
      ]
    })
    const resolved = harness.manager.resolveSessionHandle('deepchat-session' as AppSessionId)
    await resolved.handle.snapshot()
    harness.resolveExecutableDescriptor.mockClear()

    await expect(harness.lifecycle.deleteSession('deepchat-session')).resolves.toBeUndefined()

    expect(harness.resolveExecutableDescriptor).not.toHaveBeenCalled()
    expect(harness.deepchatImplementation.cancelGeneration).toHaveBeenCalledExactlyOnceWith(
      'deepchat-session'
    )
    expect(harness.deepchatImplementation.destroySession).toHaveBeenCalledExactlyOnceWith(
      'deepchat-session'
    )
    expect(harness.deleteSessionRow).toHaveBeenCalledExactlyOnceWith('deepchat-session')
  })

  it('keeps valid direct ACP deletion on the descriptor-independent cleanup path', async () => {
    const harness = createDescriptorIndependentDeleteHarness({
      sessions: [{ id: 'direct-session', agentId: 'direct-agent' }],
      agents: [
        {
          id: 'direct-agent',
          agentType: 'acp',
          source: 'manual',
          configJson: JSON.stringify({ command: 'direct-agent' })
        }
      ]
    })
    expect(harness.manager.resolveBackend('direct-agent').descriptor).toMatchObject({
      id: 'direct-agent',
      kind: 'acp'
    })
    harness.resolveExecutableDescriptor.mockClear()

    await expect(harness.lifecycle.deleteSession('direct-session')).resolves.toBeUndefined()

    expect(harness.resolveExecutableDescriptor).not.toHaveBeenCalled()
    expect(harness.resolveInput).not.toHaveBeenCalled()
    expect(harness.directRuntimeCleanup).toHaveBeenCalledExactlyOnceWith('direct-session')
    expect(harness.deleteDurableSession).toHaveBeenCalledExactlyOnceWith('direct-session')
    expect(harness.deepchatImplementation.destroySession).toHaveBeenCalledExactlyOnceWith(
      'direct-session'
    )
    expect(harness.deleteSessionRow).toHaveBeenCalledExactlyOnceWith('direct-session')
  })

  describe('createSession', () => {
    it('creates session with correct parameters', async () => {
      const result = await lifecycle.createSession(
        { agentId: 'deepchat', message: 'Hello world', projectDir: '/tmp/proj' },
        1
      )

      expect(result.id).toBe('mock-session-id')
      expect(result.agentId).toBe('deepchat')
      expect(result.title).toBe('Hello world')
      expect(result.projectDir).toBe('/tmp/proj')
      expect(result.status).toBe('idle')
      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        'mock-session-id',
        expect.objectContaining({
          agentId: 'deepchat',
          providerId: 'openai',
          modelId: 'gpt-4',
          projectDir: '/tmp/proj',
          permissionMode: 'full_access'
        })
      )
      await new Promise((r) => setTimeout(r, 0))
      expect(deepChatAgent.queuePendingInput).toHaveBeenCalledWith(
        'mock-session-id',
        { text: 'Hello world', files: [] },
        {
          source: 'send',
          projectDir: '/tmp/proj'
        }
      )
    })

    it('derives title from first 50 chars of message', async () => {
      const longMessage = 'A'.repeat(100)
      const result = await lifecycle.createSession({ agentId: 'deepchat', message: longMessage }, 1)

      expect(result.title).toBe('A'.repeat(50))
    })

    it('defaults to "New Chat" when message is empty', async () => {
      const result = await lifecycle.createSession({ agentId: 'deepchat', message: '' }, 1)

      expect(result.title).toBe('New Chat')
      expect(llmProviderPresenter.summaryTitles).not.toHaveBeenCalled()
    })

    it('calls agent.initSession and queues the first message', async () => {
      await lifecycle.createSession({ agentId: 'deepchat', message: 'Hello' }, 1)

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        'mock-session-id',
        expect.objectContaining({
          agentId: 'deepchat',
          providerId: 'openai',
          modelId: 'gpt-4',
          projectDir: null,
          permissionMode: 'full_access'
        })
      )
      // The first message is queued non-blocking, so we give it a tick
      await new Promise((r) => setTimeout(r, 0))
      expect(deepChatAgent.queuePendingInput).toHaveBeenCalledWith(
        'mock-session-id',
        { text: 'Hello', files: [] },
        {
          source: 'send',
          projectDir: null
        }
      )
    })

    it('passes project directory to queued first messages', async () => {
      const queuePendingInput = vi.fn().mockResolvedValue({
        id: 'q1',
        sessionId: 'mock-session-id',
        mode: 'queue',
        state: 'claimed',
        payload: { text: 'Hello', files: [] },
        queueOrder: 1,
        claimedAt: 1,
        consumedAt: null,
        createdAt: 1,
        updatedAt: 1
      })
      deepChatAgent.queuePendingInput.mockImplementation(queuePendingInput)

      await lifecycle.createSession(
        { agentId: 'deepchat', message: 'Hello', projectDir: '/tmp/proj' },
        1
      )

      expect(queuePendingInput).toHaveBeenCalledWith(
        'mock-session-id',
        { text: 'Hello', files: [] },
        { source: 'send', projectDir: '/tmp/proj' }
      )
      expect(deepChatAgent.processMessage).not.toHaveBeenCalled()
    })

    it('publishes typed created session update', async () => {
      await lifecycle.createSession({ agentId: 'deepchat', message: 'Hello' }, 42)

      expectSessionsUpdated({
        sessionIds: ['mock-session-id'],
        reason: 'created',
        activeSessionId: 'mock-session-id',
        webContentsId: 42
      })
    })

    it('uses default provider/model from config when not specified', async () => {
      await lifecycle.createSession({ agentId: 'deepchat', message: 'Hi' }, 1)

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          agentId: 'deepchat',
          providerId: 'openai',
          modelId: 'gpt-4',
          projectDir: null,
          permissionMode: 'full_access'
        })
      )
    })

    it('uses the DeepChat agent default directory when createSession does not provide one', async () => {
      configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({
        defaultProjectPath: '/workspaces/agent-default'
      })

      await lifecycle.createSession({ agentId: 'deepchat', message: 'Hi' }, 1)

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          projectDir: '/workspaces/agent-default'
        })
      )
      expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
        'mock-session-id',
        'deepchat',
        'Hi',
        '/workspaces/agent-default',
        expect.any(Object)
      )
    })

    it('falls back to the global default directory when the DeepChat agent has none', async () => {
      configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({})
      configPresenter.getDefaultProjectPath.mockReturnValue('/workspaces/global-default')

      await lifecycle.createSession({ agentId: 'deepchat', message: 'Hi' }, 1)

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          projectDir: '/workspaces/global-default'
        })
      )
      expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
        'mock-session-id',
        'deepchat',
        'Hi',
        '/workspaces/global-default',
        expect.any(Object)
      )
    })

    it('honors explicit null projectDir without applying default directory fallbacks', async () => {
      configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({
        defaultProjectPath: '/workspaces/agent-default'
      })
      configPresenter.getDefaultProjectPath.mockReturnValue('/workspaces/global-default')

      await lifecycle.createSession({ agentId: 'deepchat', message: 'Hi', projectDir: null }, 1)

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          projectDir: null
        })
      )
      expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
        'mock-session-id',
        'deepchat',
        'Hi',
        null,
        expect.any(Object)
      )
    })

    it('uses input provider/model when specified', async () => {
      await lifecycle.createSession(
        { agentId: 'deepchat', message: 'Hi', providerId: 'anthropic', modelId: 'claude-3' },
        1
      )

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          agentId: 'deepchat',
          providerId: 'anthropic',
          modelId: 'claude-3',
          projectDir: null,
          permissionMode: 'full_access'
        })
      )
    })

    it('uses input permission mode when specified', async () => {
      await lifecycle.createSession(
        {
          agentId: 'deepchat',
          message: 'Hi',
          providerId: 'anthropic',
          modelId: 'claude-3',
          permissionMode: 'default'
        },
        1
      )

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          agentId: 'deepchat',
          providerId: 'anthropic',
          modelId: 'claude-3',
          projectDir: null,
          permissionMode: 'default'
        })
      )
    })

    it('passes generationSettings to agent.initSession', async () => {
      await lifecycle.createSession(
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

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          agentId: 'deepchat',
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
      )
    })

    it('persists disabled agent tools for deepchat sessions', async () => {
      await lifecycle.createSession(
        {
          agentId: 'deepchat',
          message: 'Hi',
          disabledAgentTools: ['exec', 'exec', 'cdp_send']
        },
        1
      )

      expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
        'mock-session-id',
        'deepchat',
        'Hi',
        null,
        expect.objectContaining({
          isDraft: false,
          disabledAgentTools: expect.arrayContaining(['cdp_send', 'exec'])
        })
      )
    })

    it('throws when no provider/model available', async () => {
      configPresenter.getDefaultModel.mockReturnValue(null)

      await expect(
        lifecycle.createSession({ agentId: 'deepchat', message: 'Hi' }, 1)
      ).rejects.toThrow('No provider or model configured')
    })

    it('passes active skills as initial message-scoped skills without pinning the session', async () => {
      await lifecycle.createSession(
        {
          agentId: 'deepchat',
          message: 'Hello',
          activeSkills: ['skill-a', 'skill-b']
        },
        1
      )

      expect(skillPresenter.setActiveSkills).not.toHaveBeenCalled()
      expect(deepChatAgent.queuePendingInput).toHaveBeenCalledWith(
        'mock-session-id',
        {
          text: 'Hello',
          files: [],
          activeSkills: ['skill-a', 'skill-b']
        },
        expect.objectContaining({ source: 'send' })
      )
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

      await lifecycle.createSession({ agentId: 'deepchat', message: 'Please summarize' }, 1)
      await new Promise((r) => setTimeout(r, 20))

      expect(llmProviderPresenter.summaryTitles).toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('mock-session-id', {
        title: 'Async Generated Title'
      })
    })

    it('waits for persisted first-turn messages before generating title', async () => {
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

      let messagesReady = false
      deepChatAgent.getMessages.mockImplementation(async () =>
        messagesReady
          ? [
              {
                id: 'u1',
                sessionId: 'mock-session-id',
                orderSeq: 1,
                role: 'user',
                content: JSON.stringify({ text: 'Please summarize this chat', files: [] }),
                status: 'sent',
                isContextEdge: 0,
                metadata: '{}',
                createdAt: Date.now(),
                updatedAt: Date.now()
              } as any
            ]
          : []
      )

      vi.useFakeTimers()
      try {
        await lifecycle.createSession({ agentId: 'deepchat', message: 'Please summarize' }, 1)
        await vi.advanceTimersByTimeAsync(20)
        expect(llmProviderPresenter.summaryTitles).not.toHaveBeenCalled()

        messagesReady = true
        await vi.advanceTimersByTimeAsync(300)

        expect(llmProviderPresenter.summaryTitles).toHaveBeenCalled()
        expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('mock-session-id', {
          title: 'Async Generated Title'
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it('generates title after first-turn readiness before session is idle', async () => {
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

      let resolveReady: (ready: boolean) => void = () => undefined
      const readyPromise = new Promise<boolean>((resolve) => {
        resolveReady = resolve
      })
      deepChatAgent.waitForFirstTurnReady.mockImplementation(() => readyPromise)
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'generating',
        providerId: 'openai',
        modelId: 'gpt-4',
        permissionMode: 'full_access'
      })
      deepChatAgent.getMessages.mockResolvedValue([
        {
          id: 'u1',
          sessionId: 'mock-session-id',
          orderSeq: 1,
          role: 'user',
          content: JSON.stringify({ text: 'Please summarize this chat', files: [] }),
          status: 'sent',
          isContextEdge: 0,
          metadata: '{}',
          createdAt: Date.now(),
          updatedAt: Date.now()
        } as any,
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
        } as any
      ])

      vi.useFakeTimers()
      try {
        await lifecycle.createSession({ agentId: 'deepchat', message: 'Please summarize' }, 1)
        await vi.advanceTimersByTimeAsync(20)
        expect(llmProviderPresenter.summaryTitles).not.toHaveBeenCalled()

        resolveReady(true)
        await vi.advanceTimersByTimeAsync(0)
        await Promise.resolve()

        expect(llmProviderPresenter.summaryTitles).toHaveBeenCalled()
        expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('mock-session-id', {
          title: 'Async Generated Title'
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not start title generation after a manual rename wins the first CAS check', async () => {
      const rows = installSessionStore(sqlitePresenter)
      let resolveMessages: (messages: any[]) => void = () => undefined
      deepChatAgent.getMessages.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveMessages = resolve
          })
      )

      await lifecycle.createSession({ agentId: 'deepchat', message: 'Original prompt' }, 1)
      await projection.renameSession('mock-session-id', 'Manual title')
      resolveMessages([
        {
          id: 'u1',
          sessionId: 'mock-session-id',
          orderSeq: 1,
          role: 'user',
          content: JSON.stringify({ text: 'Original prompt', files: [] }),
          status: 'sent'
        }
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(llmProviderPresenter.summaryTitles).not.toHaveBeenCalled()
      expect(rows.get('mock-session-id')?.title).toBe('Manual title')
    })

    it('does not overwrite a manual rename after title generation starts', async () => {
      const rows = installSessionStore(sqlitePresenter)
      deepChatAgent.getMessages.mockResolvedValueOnce([
        {
          id: 'u1',
          sessionId: 'mock-session-id',
          orderSeq: 1,
          role: 'user',
          content: JSON.stringify({ text: 'Original prompt', files: [] }),
          status: 'sent'
        }
      ])
      let resolveTitle: (title: string) => void = () => undefined
      llmProviderPresenter.summaryTitles.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTitle = resolve
          })
      )

      await lifecycle.createSession({ agentId: 'deepchat', message: 'Original prompt' }, 1)
      await vi.waitFor(() => expect(llmProviderPresenter.summaryTitles).toHaveBeenCalledOnce())
      await projection.renameSession('mock-session-id', 'Manual title')
      resolveTitle('Generated title')
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(rows.get('mock-session-id')?.title).toBe('Manual title')
      expect(sqlitePresenter.newSessionsTable.update).not.toHaveBeenCalledWith('mock-session-id', {
        title: 'Generated title'
      })
    })

    it('falls back to the execution model when the preferred assistant model fails', async () => {
      installSessionStore(sqlitePresenter)
      configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({
        assistantModel: { providerId: 'anthropic', modelId: 'claude-assistant' }
      })
      deepChatAgent.getMessages.mockResolvedValueOnce([
        {
          id: 'u1',
          sessionId: 'mock-session-id',
          orderSeq: 1,
          role: 'user',
          content: JSON.stringify({ text: 'Original prompt', files: [] }),
          status: 'sent'
        }
      ])
      llmProviderPresenter.summaryTitles
        .mockRejectedValueOnce(new Error('assistant unavailable'))
        .mockResolvedValueOnce('Fallback title')

      await lifecycle.createSession(
        {
          agentId: 'deepchat',
          message: 'Original prompt',
          providerId: 'openai',
          modelId: 'gpt-4'
        },
        1
      )
      await vi.waitFor(() =>
        expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('mock-session-id', {
          title: 'Fallback title'
        })
      )

      expect(llmProviderPresenter.summaryTitles).toHaveBeenNthCalledWith(
        1,
        expect.any(Array),
        'anthropic',
        'claude-assistant'
      )
      expect(llmProviderPresenter.summaryTitles).toHaveBeenNthCalledWith(
        2,
        expect.any(Array),
        'openai',
        'gpt-4'
      )
    })

    it('syncs ACP-as-LLM workdir persistence before the first provider message runs', async () => {
      configPresenter.getAcpAgents.mockResolvedValue([
        { id: 'acp-coder', name: 'ACP Coder', command: 'acp-coder' }
      ])
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      await lifecycle.createSession(
        {
          agentId: 'acp-coder',
          message: 'Hello ACP',
          projectDir: '/tmp/workspace',
          providerId: 'acp',
          modelId: 'acp-coder'
        },
        1
      )

      expect(llmProviderPresenter.setAcpWorkdir).toHaveBeenCalledWith(
        'mock-session-id',
        'acp-coder',
        '/tmp/workspace'
      )
      expect(directAcpControl.updateWorkdir).not.toHaveBeenCalled()
      await new Promise((r) => setTimeout(r, 0))
      expect(deepChatAgent.queuePendingInput).toHaveBeenCalledWith(
        'mock-session-id',
        { text: 'Hello ACP', files: [] },
        {
          source: 'send',
          projectDir: '/tmp/workspace'
        }
      )
    })

    it('aborts ACP-as-LLM session creation when workdir sync fails', async () => {
      configPresenter.getAcpAgents.mockResolvedValue([
        { id: 'acp-coder', name: 'ACP Coder', command: 'acp-coder' }
      ])
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })
      llmProviderPresenter.setAcpWorkdir.mockRejectedValueOnce(new Error('sync failed'))

      await expect(
        lifecycle.createSession(
          {
            agentId: 'acp-coder',
            message: 'Hello ACP',
            projectDir: '/tmp/workspace',
            providerId: 'acp',
            modelId: 'acp-coder'
          },
          1
        )
      ).rejects.toThrow('sync failed')

      expect(deepChatAgent.destroySession).toHaveBeenCalledWith('mock-session-id')
      expect(llmProviderPresenter.clearAcpSession).toHaveBeenCalledWith('mock-session-id')
      expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith('mock-session-id')
      expect(deepChatAgent.processMessage).not.toHaveBeenCalled()
    })

    it('rethrows the initialization error after every rollback cleanup fails', async () => {
      const initializationError = new Error('workdir initialization failed')
      const clearError = new Error('compatibility cleanup failed')
      const closeError = new Error('runtime close failed')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      llmProviderPresenter.setAcpWorkdir.mockRejectedValueOnce(initializationError)
      llmProviderPresenter.clearAcpSession.mockRejectedValueOnce(clearError)
      deepChatAgent.destroySession.mockRejectedValueOnce(closeError)

      await expect(
        lifecycle.createSession(
          {
            agentId: 'deepchat',
            message: 'Hello ACP',
            projectDir: '/tmp/workspace',
            providerId: 'acp',
            modelId: 'acp-coder'
          },
          1
        )
      ).rejects.toBe(initializationError)

      expect(llmProviderPresenter.clearAcpSession).toHaveBeenCalledWith('mock-session-id')
      expect(deepChatAgent.destroySession).toHaveBeenCalledWith('mock-session-id')
      expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith('mock-session-id')
      expect(llmProviderPresenter.clearAcpSession.mock.invocationCallOrder[0]).toBeLessThan(
        deepChatAgent.destroySession.mock.invocationCallOrder[0]
      )
      expect(deepChatAgent.destroySession.mock.invocationCallOrder[0]).toBeLessThan(
        sqlitePresenter.newSessionsTable.delete.mock.invocationCallOrder[0]
      )
      expect(projection.getActiveId(1)).toBeNull()
      expect(publishDeepchatEvent).not.toHaveBeenCalled()
      expect(sessionUiPort.refreshSessionUi).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        '[SessionLifecycleCoordinator] Failed to clear ACP session after initialization error mock-session-id:',
        clearError
      )
      expect(warnSpy).toHaveBeenCalledWith(
        '[SessionLifecycleCoordinator] Failed to cleanup session runtime after initialization error mock-session-id:',
        closeError
      )
      warnSpy.mockRestore()
    })
  })

  describe('createDetachedSession', () => {
    it('creates a detached session without window activation', async () => {
      const result = await lifecycle.createDetachedSession({
        title: 'Remote Session',
        agentId: 'deepchat'
      })

      expect(result.id).toBe('mock-session-id')
      expect(result.title).toBe('Remote Session')
      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        'mock-session-id',
        expect.objectContaining({
          agentId: 'deepchat',
          providerId: 'openai',
          modelId: 'gpt-4',
          projectDir: null,
          permissionMode: 'full_access'
        })
      )
      expectSessionsUpdated({ reason: 'created', sessionIds: ['mock-session-id'] })
    })

    it('inherits deepchat agent defaults for detached sessions', async () => {
      configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({
        defaultModelPreset: {
          providerId: 'anthropic',
          modelId: 'claude-3-7-sonnet'
        },
        defaultProjectPath: '/workspaces/remote-default',
        permissionMode: 'default',
        disabledAgentTools: ['find'],
        systemPrompt: 'Remote agent prompt'
      })
      configPresenter.getAgentType.mockResolvedValue('deepchat')

      await lifecycle.createDetachedSession({
        title: 'Remote Agent Session',
        agentId: 'deepchat-remote'
      })

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        'mock-session-id',
        expect.objectContaining({
          agentId: 'deepchat-remote',
          providerId: 'anthropic',
          modelId: 'claude-3-7-sonnet',
          projectDir: '/workspaces/remote-default',
          permissionMode: 'default',
          generationSettings: {
            systemPrompt: 'Remote agent prompt'
          }
        })
      )
      expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
        'mock-session-id',
        'deepchat-remote',
        'Remote Agent Session',
        '/workspaces/remote-default',
        {
          isDraft: false,
          disabledAgentTools: [],
          sessionKind: undefined,
          parentSessionId: undefined,
          subagentMetaJson: null
        }
      )
    })
  })

  describe('draft turn promotion failures', () => {
    it.each([
      ['send', () => turn.sendMessage('s-draft', 'New prompt')],
      ['steer', () => turn.steerActiveTurn('s-draft', 'New prompt')],
      ['queue', () => turn.queuePendingInput('s-draft', 'New prompt')]
    ])('does not roll back draft promotion when %s fails later', async (_name, invoke) => {
      const row = {
        id: 's-draft',
        agent_id: 'deepchat',
        title: 'New Chat',
        project_dir: '/repo',
        is_pinned: 0,
        is_draft: 1,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 1000
      }
      sqlitePresenter.newSessionsTable.get.mockImplementation(() => row)
      sqlitePresenter.newSessionsTable.update.mockImplementation((_: string, fields: any) => {
        if (fields.title !== undefined) row.title = fields.title
        if (fields.is_draft !== undefined) row.is_draft = fields.is_draft
      })
      const runtimeError = new Error(`${_name} runtime failed`)
      deepChatAgent.getSessionState.mockRejectedValueOnce(runtimeError)

      await expect(invoke()).rejects.toBe(runtimeError)

      expect(row).toMatchObject({ is_draft: 0, title: 'New prompt' })
      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s-draft', {
        is_draft: 0,
        title: 'New prompt'
      })
      expectSessionsUpdated({ sessionIds: ['s-draft'], reason: 'updated' })
      expect(deepChatAgent.queuePendingInput).not.toHaveBeenCalled()
      expect(deepChatAgent.steerActiveTurn).not.toHaveBeenCalled()
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

      await turn.sendMessage('s-draft', 'Hello ACP')

      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s-draft', {
        is_draft: 0,
        title: 'Hello ACP'
      })
      expectSessionsUpdated({ reason: 'updated', sessionIds: ['s-draft'] })
      expect(deepChatAgent.queuePendingInput).toHaveBeenCalledWith(
        's-draft',
        { text: 'Hello ACP', files: [] },
        {
          source: 'send',
          projectDir: '/tmp/workspace'
        }
      )
      expect(directAcpControl.updateWorkdir).toHaveBeenCalledWith('/tmp/workspace')
      expect(llmProviderPresenter.setAcpWorkdir).not.toHaveBeenCalled()
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
      deepChatAgent.hasMessages.mockResolvedValue(true)

      await turn.sendMessage('s1', 'Follow-up')
      expect(agentManager.resolveSessionHandle).toHaveBeenCalledWith('s1')
      expect(deepChatAgent.queuePendingInput).toHaveBeenCalledWith(
        's1',
        { text: 'Follow-up', files: [] },
        {
          source: 'send',
          projectDir: '/tmp/workspace'
        }
      )
      expect(deepChatAgent.hasMessages).toHaveBeenCalledWith('s1')
      expect(deepChatAgent.getMessages).not.toHaveBeenCalled()
      expect(deepChatAgent.getMessageIds).not.toHaveBeenCalled()
    })

    it('forwards maxProviderRounds through the turn handle context', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: '/repo',
        is_pinned: 0,
        is_draft: 0,
        created_at: 1000,
        updated_at: 1000
      })
      deepChatAgent.hasMessages.mockResolvedValue(true)
      const send = vi.fn().mockResolvedValue({ requestId: null, messageId: null })
      agentManager.resolveSessionHandle.mockReturnValueOnce({
        handle: {
          kind: 'deepchat',
          snapshot: vi.fn().mockResolvedValue({
            status: 'idle',
            providerId: 'openai',
            modelId: 'gpt-4'
          }),
          send
        }
      })

      await turn.sendMessage('s1', 'Scheduled prompt', { maxProviderRounds: 4 })

      expect(send).toHaveBeenCalledWith({
        content: { text: 'Scheduled prompt', files: [] },
        context: { projectDir: '/repo', maxProviderRounds: 4 },
        queue: { source: 'send', projectDir: '/repo' }
      })
    })

    it('routes active generation submissions to queue', async () => {
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
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'generating',
        providerId: 'openai',
        modelId: 'gpt-4',
        permissionMode: 'full_access'
      })

      await turn.sendMessage('s1', 'Refine this')

      expect(deepChatAgent.queuePendingInput).toHaveBeenCalledWith(
        's1',
        {
          text: 'Refine this',
          files: []
        },
        { source: 'send', projectDir: '/tmp/workspace' }
      )
      expect(deepChatAgent.processMessage).not.toHaveBeenCalled()
    })

    it('throws for unknown session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)
      await expect(turn.sendMessage('unknown', 'hi')).rejects.toThrow('Session not found: unknown')
    })
  })

  describe('queuePendingInput', () => {
    it('passes queue-origin metadata to agents for explicit queued inputs', async () => {
      const queuePendingInput = vi.fn().mockResolvedValue({
        id: 'q1',
        sessionId: 's1',
        mode: 'queue',
        state: 'pending',
        payload: { text: 'Later', files: [] },
        queueOrder: 1,
        claimedAt: null,
        consumedAt: null,
        createdAt: 1,
        updatedAt: 1
      })
      deepChatAgent.queuePendingInput.mockImplementation(queuePendingInput)
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

      await turn.queuePendingInput('s1', 'Later')

      expect(queuePendingInput).toHaveBeenCalledWith(
        's1',
        { text: 'Later', files: [] },
        { source: 'queue', projectDir: '/tmp/workspace' }
      )
    })
  })

  describe('pending input mutations', () => {
    beforeEach(() => {
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
    })

    it('delegates update, move, convert, steer, and delete with normalized inputs', async () => {
      const updated = { id: 'pending-1', payload: { text: 'Updated', files: [] } }
      const moved = [{ id: 'pending-1', queueOrder: 2 }]
      const converted = { id: 'pending-1', mode: 'steer' }
      const steered = { id: 'pending-1', state: 'claimed' }
      deepChatAgent.updateQueuedInput.mockResolvedValueOnce(updated)
      deepChatAgent.moveQueuedInput.mockResolvedValueOnce(moved)
      deepChatAgent.convertPendingInputToSteer.mockResolvedValueOnce(converted)
      deepChatAgent.steerPendingInput.mockResolvedValueOnce(steered)

      await expect(turn.updateQueuedInput('s1', 'pending-1', 'Updated')).resolves.toBe(updated)
      await expect(turn.moveQueuedInput('s1', 'pending-1', 2)).resolves.toBe(moved)
      await expect(turn.convertPendingInputToSteer('s1', 'pending-1')).resolves.toBe(converted)
      await expect(turn.steerPendingInput('s1', 'pending-1')).resolves.toBe(steered)
      await expect(turn.deletePendingInput('s1', 'pending-1')).resolves.toBeUndefined()

      expect(deepChatAgent.updateQueuedInput).toHaveBeenCalledWith('s1', 'pending-1', {
        text: 'Updated',
        files: []
      })
      expect(deepChatAgent.moveQueuedInput).toHaveBeenCalledWith('s1', 'pending-1', 2)
      expect(deepChatAgent.convertPendingInputToSteer).toHaveBeenCalledWith('s1', 'pending-1')
      expect(deepChatAgent.steerPendingInput).toHaveBeenCalledWith('s1', 'pending-1')
      expect(deepChatAgent.deletePendingInput).toHaveBeenCalledWith('s1', 'pending-1')
    })

    it.each([
      ['update', () => turn.updateQueuedInput('missing', 'pending-1', 'Updated')],
      ['move', () => turn.moveQueuedInput('missing', 'pending-1', 1)],
      ['convert', () => turn.convertPendingInputToSteer('missing', 'pending-1')],
      ['steer', () => turn.steerPendingInput('missing', 'pending-1')],
      ['delete', () => turn.deletePendingInput('missing', 'pending-1')]
    ])('rejects %s before resolving a handle for a missing session', async (_name, invoke) => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)

      await expect(invoke()).rejects.toThrow('Session not found: missing')

      expect(agentManager.resolveSessionHandle).not.toHaveBeenCalled()
    })

    it('returns an empty pending list for a missing session without resolving a handle', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)

      await expect(turn.listPendingInputs('missing')).resolves.toEqual([])

      expect(agentManager.resolveSessionHandle).not.toHaveBeenCalled()
    })
  })

  describe('message mutations', () => {
    beforeEach(() => {
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
    })

    it('prepares retry content before sending with refresh metadata', async () => {
      deepChatAgent.prepareRetryMessage.mockResolvedValueOnce({
        content: { text: 'Retry body', files: [] },
        projectDir: '/retry/project'
      })

      await turn.retryMessage('s1', 'message-1')

      expect(deepChatAgent.prepareRetryMessage).toHaveBeenCalledWith('s1', 'message-1')
      expect(deepChatAgent.processMessage).toHaveBeenCalledWith(
        's1',
        { text: 'Retry body', files: [] },
        { projectDir: '/retry/project', emitRefreshBeforeStream: true }
      )
      expect(deepChatAgent.prepareRetryMessage.mock.invocationCallOrder[0]).toBeLessThan(
        deepChatAgent.processMessage.mock.invocationCallOrder[0]
      )
      expect(deepChatAgent.cancelGeneration).not.toHaveBeenCalled()
    })

    it('cancels before deleting and does not mutate when cancellation fails', async () => {
      const cancelError = new Error('cancel failed')
      deepChatAgent.cancelGeneration.mockRejectedValueOnce(cancelError)

      await expect(turn.deleteMessage('s1', 'message-1')).rejects.toBe(cancelError)

      expect(deepChatAgent.deleteMessage).not.toHaveBeenCalled()

      deepChatAgent.cancelGeneration.mockResolvedValueOnce(undefined)
      await turn.deleteMessage('s1', 'message-1')

      expect(deepChatAgent.deleteMessage).toHaveBeenCalledWith('s1', 'message-1')
      expect(deepChatAgent.cancelGeneration.mock.invocationCallOrder.at(-1)).toBeLessThan(
        deepChatAgent.deleteMessage.mock.invocationCallOrder[0]
      )
    })

    it('edits without cancelling the active generation', async () => {
      const edited = { id: 'message-1', sessionId: 's1', role: 'user', content: 'Edited' }
      deepChatAgent.editUserMessage.mockResolvedValueOnce(edited)

      await expect(turn.editUserMessage('s1', 'message-1', 'Edited')).resolves.toBe(edited)

      expect(deepChatAgent.editUserMessage).toHaveBeenCalledWith('s1', 'message-1', 'Edited')
      expect(deepChatAgent.cancelGeneration).not.toHaveBeenCalled()
    })
  })

  describe('setSessionProjectDir', () => {
    it('syncs workspace changes into the active agent runtime', async () => {
      const row = {
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null as string | null,
        is_pinned: 0,
        is_draft: 0,
        created_at: 1000,
        updated_at: 1000
      }
      sqlitePresenter.newSessionsTable.get.mockImplementation(() => row)
      sqlitePresenter.newSessionsTable.update.mockImplementation((_: string, fields: any) => {
        if (fields.project_dir !== undefined) {
          row.project_dir = fields.project_dir
        }
      })

      await assignment.setSessionProjectDir('s1', '/tmp/workspace')

      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s1', {
        project_dir: '/tmp/workspace'
      })
      expect(deepChatAgent.setSessionProjectDir).toHaveBeenCalledWith('s1', '/tmp/workspace')
      expect(sqlitePresenter.newEnvironmentsTable.syncPath).toHaveBeenCalledWith('/tmp/workspace')
    })

    it('keeps the persisted project update when runtime synchronization fails', async () => {
      const row = {
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null as string | null,
        is_pinned: 0,
        is_draft: 0,
        created_at: 1000,
        updated_at: 1000
      }
      sqlitePresenter.newSessionsTable.get.mockImplementation(() => row)
      sqlitePresenter.newSessionsTable.update.mockImplementation((_: string, fields: any) => {
        if (fields.project_dir !== undefined) row.project_dir = fields.project_dir
      })
      const runtimeError = new Error('runtime project update failed')
      deepChatAgent.setSessionProjectDir.mockRejectedValueOnce(runtimeError)

      await expect(assignment.setSessionProjectDir('s1', '/tmp/workspace')).rejects.toBe(
        runtimeError
      )

      expect(row.project_dir).toBe('/tmp/workspace')
      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s1', {
        project_dir: '/tmp/workspace'
      })
      expect(deepChatAgent.setSessionProjectDir).toHaveBeenCalledWith('s1', '/tmp/workspace')
      expect(publishDeepchatEvent).not.toHaveBeenCalled()
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

      const session = await lifecycle.ensureAcpDraftSession({
        agentId: 'acp-coder',
        projectDir: '/tmp/workspace'
      })

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        'mock-session-id',
        expect.objectContaining({
          agentId: 'acp-coder',
          providerId: 'acp',
          modelId: 'acp-coder',
          projectDir: '/tmp/workspace',
          permissionMode: 'full_access'
        })
      )
      expect(directAcpControl.prepare).toHaveBeenCalledOnce()
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
      deepChatAgent.hasMessages.mockResolvedValue(false)
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      const session = await lifecycle.ensureAcpDraftSession({
        agentId: 'acp-coder',
        projectDir: '/tmp/workspace'
      })

      expect(sqlitePresenter.newSessionsTable.create).not.toHaveBeenCalled()
      expect(directAcpControl.prepare).toHaveBeenCalledOnce()
      expect(session.id).toBe('draft-1')
      expect(session.isDraft).toBe(true)
    })
  })

  describe('createSubagentSession', () => {
    it('routes ACP target subagents to the native ACP provider without inheriting parent tooling state', async () => {
      const nanoidMock = nanoid as unknown as ReturnType<typeof vi.fn>
      nanoidMock.mockReturnValueOnce('child-session-acp')
      configPresenter.getAgentType.mockImplementation(async (agentId: string) => {
        if (agentId === 'deepchat') {
          return 'deepchat'
        }
        if (agentId === 'kimi') {
          return 'acp'
        }
        return null
      })

      const sessionRows = new Map<string, any>()
      sqlitePresenter.newSessionsTable.create.mockImplementation(
        (id: string, agentId: string, title: string, projectDir: string | null, options: any) => {
          sessionRows.set(id, {
            id,
            agent_id: agentId,
            title,
            project_dir: projectDir,
            is_pinned: 0,
            is_draft: options?.isDraft ? 1 : 0,
            subagent_enabled: 0,
            session_kind: options?.sessionKind ?? 'regular',
            parent_session_id: options?.parentSessionId ?? null,
            subagent_meta_json: options?.subagentMetaJson ?? null,
            created_at: 1000,
            updated_at: 1000
          })
        }
      )
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) => sessionRows.get(id))
      sqlitePresenter.newSessionsTable.delete.mockImplementation((id: string) => {
        sessionRows.delete(id)
      })

      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'kimi',
        permissionMode: 'full_access'
      })

      const session = await lifecycle.createSubagentSession({
        parentSessionId: 'parent-1',
        agentId: '  kimi-cli  ',
        slotId: 'reviewer',
        displayName: 'Reviewer',
        targetAgentId: 'kimi-cli',
        projectDir: '/tmp/workspace',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        permissionMode: 'full_access',
        generationSettings: {
          systemPrompt: 'Should not be inherited'
        },
        disabledAgentTools: ['exec', 'cdp_send'],
        activeSkills: ['skill-a']
      })

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        'child-session-acp',
        expect.objectContaining({
          agentId: 'kimi',
          providerId: 'acp',
          modelId: 'kimi',
          projectDir: '/tmp/workspace',
          permissionMode: 'full_access',
          generationSettings: {
            systemPrompt: ''
          }
        })
      )
      expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
        'child-session-acp',
        'kimi',
        'Reviewer',
        '/tmp/workspace',
        expect.objectContaining({
          disabledAgentTools: [],
          sessionKind: 'subagent',
          parentSessionId: 'parent-1'
        })
      )
      expect(skillPresenter.setActiveSkills).not.toHaveBeenCalled()
      expect(directAcpControl.updateWorkdir).toHaveBeenCalledWith('/tmp/workspace')
      expect(llmProviderPresenter.setAcpWorkdir).not.toHaveBeenCalled()
      expect(session.id).toBe('child-session-acp')
      expect(session.providerId).toBe('acp')
      expect(session.modelId).toBe('kimi')
      expect(session.sessionKind).toBe('subagent')
      expect(session.parentSessionId).toBe('parent-1')
      expect(session.subagentMeta).toEqual({
        slotId: 'reviewer',
        displayName: 'Reviewer',
        targetAgentId: 'kimi'
      })
    })

    it('retries subagent initialization exactly once when ACP setup fails before the child starts', async () => {
      const nanoidMock = nanoid as unknown as ReturnType<typeof vi.fn>
      nanoidMock.mockReturnValueOnce('child-session-1').mockReturnValueOnce('child-session-2')

      const sessionRows = new Map<string, any>()
      sqlitePresenter.newSessionsTable.create.mockImplementation(
        (id: string, agentId: string, title: string, projectDir: string | null, options: any) => {
          sessionRows.set(id, {
            id,
            agent_id: agentId,
            title,
            project_dir: projectDir,
            is_pinned: 0,
            is_draft: options?.isDraft ? 1 : 0,
            subagent_enabled: 0,
            session_kind: options?.sessionKind ?? 'regular',
            parent_session_id: options?.parentSessionId ?? null,
            subagent_meta_json: options?.subagentMetaJson ?? null,
            created_at: 1000,
            updated_at: 1000
          })
        }
      )
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) => sessionRows.get(id))
      sqlitePresenter.newSessionsTable.delete.mockImplementation((id: string) => {
        sessionRows.delete(id)
      })

      directAcpControl.updateWorkdir
        .mockRejectedValueOnce(new Error('warmup failed'))
        .mockResolvedValueOnce('/tmp/workspace')
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-reviewer',
        permissionMode: 'full_access'
      })

      const session = await lifecycle.createSubagentSession({
        parentSessionId: 'parent-1',
        agentId: 'acp-reviewer',
        slotId: 'reviewer',
        displayName: 'Reviewer',
        targetAgentId: 'acp-reviewer',
        projectDir: '/tmp/workspace',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        permissionMode: 'full_access',
        generationSettings: {
          systemPrompt: 'Should not be inherited'
        },
        disabledAgentTools: ['exec'],
        activeSkills: ['skill-a']
      })

      expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledTimes(2)
      expect(deepChatAgent.initSession).toHaveBeenCalledTimes(2)
      expect(directAcpControl.updateWorkdir).toHaveBeenNthCalledWith(1, '/tmp/workspace')
      expect(directAcpControl.updateWorkdir).toHaveBeenNthCalledWith(2, '/tmp/workspace')
      expect(llmProviderPresenter.setAcpWorkdir).not.toHaveBeenCalled()
      expect(llmProviderPresenter.clearAcpSession).not.toHaveBeenCalled()
      expect(deepChatAgent.destroySession).toHaveBeenCalledTimes(1)
      expect(deepChatAgent.destroySession).toHaveBeenCalledWith('child-session-1')
      expect(closeDirectAcpSession).toHaveBeenCalledOnce()
      expect(closeDirectAcpSession).toHaveBeenCalledWith('child-session-1')
      expect(sessionRows.has('child-session-1')).toBe(false)
      expect(sessionRows.has('child-session-2')).toBe(true)
      expect(session.id).toBe('child-session-2')
      expect(session.providerId).toBe('acp')
      expect(session.modelId).toBe('acp-reviewer')
    })

    it('refreshes the session list only after a child is fully materialized', async () => {
      const nanoidMock = nanoid as unknown as ReturnType<typeof vi.fn>
      nanoidMock.mockReturnValueOnce('child-session-1').mockReturnValueOnce('child-session-2')

      const sessionRows = new Map<string, any>()
      sqlitePresenter.newSessionsTable.create.mockImplementation(
        (id: string, agentId: string, title: string, projectDir: string | null, options: any) => {
          sessionRows.set(id, {
            id,
            agent_id: agentId,
            title,
            project_dir: projectDir,
            is_pinned: 0,
            is_draft: options?.isDraft ? 1 : 0,
            subagent_enabled: 0,
            session_kind: options?.sessionKind ?? 'regular',
            parent_session_id: options?.parentSessionId ?? null,
            subagent_meta_json: options?.subagentMetaJson ?? null,
            created_at: 1000,
            updated_at: 1000
          })
        }
      )
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) => sessionRows.get(id))
      sqlitePresenter.newSessionsTable.delete.mockImplementation((id: string) => {
        sessionRows.delete(id)
      })

      deepChatAgent.getSessionState
        .mockRejectedValueOnce(new Error('state failed'))
        .mockResolvedValueOnce({
          status: 'idle',
          providerId: 'openai',
          modelId: 'gpt-4.1',
          permissionMode: 'full_access'
        })

      const sessionSnapshots: string[][] = []
      ;(publishDeepchatEvent as ReturnType<typeof vi.fn>).mockImplementation((event: string) => {
        if (event === 'sessions.updated') {
          sessionSnapshots.push(Array.from(sessionRows.keys()).sort())
        }
      })

      const session = await lifecycle.createSubagentSession({
        parentSessionId: 'parent-1',
        agentId: 'deepchat',
        slotId: 'reviewer',
        displayName: 'Reviewer',
        targetAgentId: null,
        projectDir: '/tmp/workspace',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        permissionMode: 'full_access'
      })

      expect(deepChatAgent.destroySession).toHaveBeenCalledTimes(1)
      expect(deepChatAgent.destroySession).toHaveBeenCalledWith('child-session-1')
      expect(session.id).toBe('child-session-2')
      expect(sessionSnapshots).toEqual([['child-session-2']])
    })
  })

  describe('subagent tape facets', () => {
    it.each(['deepchat', 'acp-parent'] as const)(
      'routes %s parent Tape links through required facets',
      async (agentId) => {
        sqlitePresenter.newSessionsTable.get.mockImplementation((sessionId: string) => {
          if (sessionId === 'parent') {
            return { id: 'parent', agent_id: agentId, session_kind: 'regular' }
          }
          if (sessionId === 'child') {
            return {
              id: 'child',
              agent_id: agentId,
              session_kind: 'subagent',
              parent_session_id: 'parent'
            }
          }
          return undefined
        })

        const input = {
          parentSessionId: 'parent',
          childSessionId: 'child',
          runId: 'run',
          taskId: 'task',
          slotId: 'reviewer',
          taskTitle: 'Review',
          outcome: 'completed' as const,
          resultSummary: 'Done'
        }
        await assignment.linkSubagentTape(input)

        expect(deepChatAgent.linkSubagentTape).toHaveBeenCalledWith(input)
      }
    )

    it('rejects unrelated children before resolving the subagent facet', async () => {
      sqlitePresenter.newSessionsTable.get.mockImplementation((sessionId: string) => {
        if (sessionId === 'parent') return { id: 'parent', agent_id: 'deepchat' }
        if (sessionId === 'child') return { id: 'child', parent_session_id: 'other' }
        return undefined
      })

      await expect(
        assignment.linkSubagentTape({
          parentSessionId: 'parent',
          childSessionId: 'child',
          runId: 'run',
          taskId: 'task',
          slotId: 'reviewer',
          taskTitle: 'Review',
          outcome: 'completed',
          resultSummary: null
        })
      ).rejects.toThrow('Session child is not a child of parent.')
      expect(agentManager.resolveSubagentFacet).not.toHaveBeenCalled()
      expect(deepChatAgent.linkSubagentTape).not.toHaveBeenCalled()
    })
  })

  describe('forkSession', () => {
    it('deletes the target row and preserves the fork error when runtime cleanup fails', async () => {
      const rows = installSessionStore(sqlitePresenter)
      rows.set('source-session', {
        id: 'source-session',
        agent_id: 'deepchat',
        title: 'Source title',
        project_dir: '/repo',
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 1000
      })
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'openai',
        modelId: 'gpt-4',
        permissionMode: 'default'
      })
      deepChatAgent.getGenerationSettings.mockResolvedValue({
        systemPrompt: 'Keep this',
        temperature: 0.2,
        contextLength: 32000,
        maxTokens: 2048
      })
      const forkError = new Error('fork transcript failed')
      const closeError = new Error('fork runtime close failed')
      deepChatAgent.forkSessionFromMessage.mockRejectedValueOnce(forkError)
      deepChatAgent.destroySession.mockRejectedValueOnce(closeError)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await expect(
        lifecycle.forkSession('source-session', 'message-1', 'Forked title')
      ).rejects.toBe(forkError)

      expect(deepChatAgent.initSession).toHaveBeenCalledWith(
        'mock-session-id',
        expect.objectContaining({
          agentId: 'deepchat',
          providerId: 'openai',
          modelId: 'gpt-4',
          projectDir: '/repo',
          permissionMode: 'default',
          generationSettings: expect.objectContaining({ systemPrompt: 'Keep this' })
        })
      )
      expect(deepChatAgent.forkSessionFromMessage).toHaveBeenCalledWith(
        'source-session',
        'mock-session-id',
        'message-1'
      )
      expect(deepChatAgent.destroySession).toHaveBeenCalledWith('mock-session-id')
      expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith('mock-session-id')
      expect(deepChatAgent.destroySession.mock.invocationCallOrder[0]).toBeLessThan(
        sqlitePresenter.newSessionsTable.delete.mock.invocationCallOrder[0]
      )
      expect(rows.has('mock-session-id')).toBe(false)
      expect(publishDeepchatEvent).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        '[SessionLifecycleCoordinator] Failed to cleanup forked session runtime mock-session-id:',
        closeError
      )
      warnSpy.mockRestore()
    })
  })

  describe('getSessionList', () => {
    it('prefers lightweight session list state when available', async () => {
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
      deepChatAgent.getSessionListState.mockResolvedValue({
        status: 'idle',
        providerId: 'summary-provider',
        modelId: 'summary-model',
        permissionMode: 'full_access'
      })

      const sessions = await projection.listSessions()

      expect(sessions).toHaveLength(1)
      expect(sessions[0].providerId).toBe('summary-provider')
      expect(sessions[0].modelId).toBe('summary-model')
      expect(deepChatAgent.getSessionListState).toHaveBeenCalledWith('s1')
      expect(deepChatAgent.getSessionState).not.toHaveBeenCalled()
    })

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

      const sessions = await projection.listSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0].status).toBe('idle')
      expect(sessions[0].providerId).toBe('openai')
      expect(sessions[0].modelId).toBe('gpt-4')
    })

    it('skips sessions whose agent backend cannot be resolved', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      sqlitePresenter.newSessionsTable.list.mockReturnValue([
        {
          id: 'missing-agent',
          agent_id: 'disabled-agent',
          title: 'Disabled',
          project_dir: null,
          is_pinned: 0,
          created_at: 1000,
          updated_at: 2000
        },
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

      const sessions = await projection.listSessions()

      expect(sessions).toHaveLength(1)
      expect(sessions[0].id).toBe('s1')
      expect(warnSpy).toHaveBeenCalledWith(
        '[SessionProjectionCoordinator] Skipping unavailable session id=missing-agent agent=disabled-agent:',
        expect.any(Error)
      )
      warnSpy.mockRestore()
    })

    it('skips sessions whose state loading fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      sqlitePresenter.newSessionsTable.list.mockReturnValue([
        {
          id: 'broken-state',
          agent_id: 'deepchat',
          title: 'Broken',
          project_dir: null,
          is_pinned: 0,
          created_at: 1000,
          updated_at: 2000
        },
        {
          id: 'healthy-state',
          agent_id: 'deepchat',
          title: 'Healthy',
          project_dir: null,
          is_pinned: 0,
          created_at: 1001,
          updated_at: 2001
        }
      ])
      deepChatAgent.getSessionListState.mockImplementation(async (sessionId: string) => {
        if (sessionId === 'broken-state') {
          throw new Error('state failed')
        }
        return {
          status: 'idle',
          providerId: 'openai',
          modelId: 'gpt-4',
          permissionMode: 'full_access'
        }
      })

      const sessions = await projection.listSessions()

      expect(sessions).toHaveLength(1)
      expect(sessions[0].id).toBe('healthy-state')
      expect(warnSpy).toHaveBeenCalledWith(
        '[SessionProjectionCoordinator] Skipping unavailable session id=broken-state agent=deepchat:',
        expect.any(Error)
      )
      warnSpy.mockRestore()
    })
  })

  describe('lightweight session projection', () => {
    it('reuses the last projected status without hydrating a backend', async () => {
      const row = {
        id: 's1',
        agent_id: 'deepchat',
        title: 'Chat 1',
        project_dir: null,
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 2000
      }
      sqlitePresenter.newSessionsTable.get.mockReturnValue(row)
      sqlitePresenter.newSessionsTable.listPage.mockReturnValue({ rows: [row], hasMore: false })
      deepChatAgent.getSessionState.mockResolvedValueOnce({
        status: 'generating',
        providerId: 'openai',
        modelId: 'gpt-4',
        permissionMode: 'full_access'
      })

      await expect(projection.getSession('s1')).resolves.toMatchObject({ status: 'generating' })
      agentManager.resolveSessionHandle.mockClear()

      await expect(projection.listLightweight()).resolves.toMatchObject({
        items: [expect.objectContaining({ id: 's1', status: 'generating' })],
        nextCursor: null,
        hasMore: false
      })

      expect(agentManager.resolveSessionHandle).not.toHaveBeenCalled()
      expect(deepChatAgent.getSessionListState).not.toHaveBeenCalled()
    })

    it('defaults uncached lightweight rows to idle', async () => {
      const row = {
        id: 's1',
        agent_id: 'deepchat',
        title: 'Chat 1',
        project_dir: null,
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 2000
      }
      sqlitePresenter.newSessionsTable.listPage.mockReturnValue({ rows: [row], hasMore: false })

      const result = await projection.listLightweight()

      expect(result.items).toEqual([expect.objectContaining({ id: 's1', status: 'idle' })])
      expect(agentManager.resolveSessionHandle).not.toHaveBeenCalled()
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

      const session = await projection.getSession('s1')
      expect(session).not.toBeNull()
      expect(session!.status).toBe('idle')
    })

    it('returns null for unknown session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)
      expect(await projection.getSession('unknown')).toBeNull()
    })

    it('returns null when session agent is unavailable', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's-disabled',
        agent_id: 'disabled-agent',
        title: 'Disabled',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })

      expect(await projection.getSession('s-disabled')).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(
        '[SessionProjectionCoordinator] Skipping unavailable session id=s-disabled agent=disabled-agent:',
        expect.any(Error)
      )
      warnSpy.mockRestore()
    })
  })

  describe('getSessionCompactionState', () => {
    it('delegates to the DeepChat backend', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })
      deepChatAgent.getSessionCompactionState.mockResolvedValueOnce({
        status: 'compacted',
        cursorOrderSeq: 9,
        summaryUpdatedAt: 123
      })

      const state = await turn.getSessionCompactionState('s1')

      expect(deepChatAgent.getSessionCompactionState).toHaveBeenCalledWith('s1')
      expect(state).toEqual({
        status: 'compacted',
        cursorOrderSeq: 9,
        summaryUpdatedAt: 123
      })
    })

    it('returns a fixed idle state for direct ACP without invoking DeepChat compaction', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's-acp',
        agent_id: 'acp-coder',
        title: 'ACP',
        project_dir: '/repo',
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })

      await expect(turn.getSessionCompactionState('s-acp')).resolves.toEqual({
        status: 'idle',
        cursorOrderSeq: 1,
        summaryUpdatedAt: null
      })

      expect(deepChatAgent.getSessionCompactionState).not.toHaveBeenCalled()
    })

    it('rejects direct ACP and compatibility ACP manual compaction', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's-acp',
        agent_id: 'acp-coder',
        title: 'ACP',
        project_dir: '/repo',
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })

      await expect(turn.compactSession('s-acp')).rejects.toThrow(
        'Agent acp-coder does not support manual compaction.'
      )

      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's-compat',
        agent_id: 'deepchat',
        title: 'Compatibility ACP',
        project_dir: '/repo',
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })
      deepChatAgent.getSessionState.mockResolvedValueOnce({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      await expect(turn.compactSession('s-compat')).rejects.toThrow(
        'Manual compaction is only available for DeepChat agent sessions.'
      )
      expect(deepChatAgent.compactSession).not.toHaveBeenCalled()
    })

    it('propagates DeepChat compaction failures unchanged', async () => {
      const compactError = new Error('compaction failed')
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })
      deepChatAgent.compactSession.mockRejectedValueOnce(compactError)

      await expect(turn.compactSession('s1')).rejects.toBe(compactError)

      expect(deepChatAgent.compactSession).toHaveBeenCalledWith('s1')
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

      const traces = await projection.listMessageTraces('m1')
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
      const traces = await projection.listMessageTraces('  ')
      expect(traces).toEqual([])
      expect(sqlitePresenter.deepchatMessageTracesTable.listByMessageId).not.toHaveBeenCalled()
    })

    it('returns trace count by message id', async () => {
      sqlitePresenter.deepchatMessageTracesTable.countByMessageId.mockReturnValue(3)
      await expect(projection.getMessageTraceCount('m1')).resolves.toBe(3)
      expect(sqlitePresenter.deepchatMessageTracesTable.countByMessageId).toHaveBeenCalledWith('m1')
    })
  })

  describe('getMessage', () => {
    it('routes global message lookup through AgentManager', async () => {
      const message = { id: 'm1', sessionId: 's1', role: 'assistant' }
      deepChatAgent.getMessage.mockResolvedValue(message as any)

      await expect(projection.getMessage('m1')).resolves.toBe(message)

      expect(deepChatAgent.getMessage).toHaveBeenCalledWith('m1')
    })
  })

  describe('projection read fallbacks', () => {
    it('skips malformed search rows and falls back to legacy unscoped results', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      sqlitePresenter.deepchatMessageSearchResultsTable.listByMessageId.mockReturnValue([
        { content: '{', rank: 1, search_id: 'search-new' },
        {
          content: JSON.stringify({ title: 'Legacy result', url: 'https://example.com' }),
          rank: 2,
          search_id: null
        }
      ])

      await expect(projection.getSearchResults('  message-1  ', 'missing-search')).resolves.toEqual(
        [
          expect.objectContaining({
            title: 'Legacy result',
            url: 'https://example.com',
            rank: 2,
            searchId: undefined
          })
        ]
      )

      expect(
        sqlitePresenter.deepchatMessageSearchResultsTable.listByMessageId
      ).toHaveBeenCalledWith('message-1')
      expect(warnSpy).toHaveBeenCalledWith(
        '[SessionProjectionCoordinator] Failed to parse search result row:',
        expect.any(SyntaxError)
      )
      warnSpy.mockRestore()
    })

    it('returns empty manifest and replay fallbacks when Tape reads fail', async () => {
      sqlitePresenter.deepchatMessagesTable.get.mockReturnValue({
        id: 'message-1',
        session_id: 's1'
      })
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 2000
      })
      deepChatAgent.listMessageViewManifests.mockRejectedValueOnce(new Error('manifest failed'))
      deepChatAgent.exportMessageTapeReplaySlice.mockRejectedValueOnce(new Error('replay failed'))

      await expect(projection.listMessageViewManifests('message-1')).resolves.toEqual([])
      await expect(projection.exportMessageTapeReplaySlice('message-1')).resolves.toBeNull()

      expect(deepChatAgent.listMessageViewManifests).toHaveBeenCalledWith('s1', 'message-1')
      expect(deepChatAgent.exportMessageTapeReplaySlice).toHaveBeenCalledWith(
        's1',
        'message-1',
        undefined
      )
    })
  })

  describe('session update publication', () => {
    it('trims and dedupes ids, applies reason defaults, and refreshes session UI', () => {
      const emit = projection.notify.bind(projection) as (options?: {
        sessionIds?: string[]
      }) => void

      emit({ sessionIds: [' s1 ', 's1', ' ', 's2', 's2'] })

      expect(publishDeepchatEvent).toHaveBeenCalledWith('sessions.updated', {
        sessionIds: ['s1', 's2'],
        reason: 'updated',
        activeSessionId: undefined,
        webContentsId: undefined
      })
      expect(sessionUiPort.refreshSessionUi).toHaveBeenCalledOnce()

      vi.mocked(publishDeepchatEvent).mockClear()
      sessionUiPort.refreshSessionUi.mockClear()
      emit()

      expect(publishDeepchatEvent).toHaveBeenCalledWith('sessions.updated', {
        sessionIds: [],
        reason: 'list-refreshed',
        activeSessionId: undefined,
        webContentsId: undefined
      })
      expect(sessionUiPort.refreshSessionUi).toHaveBeenCalledOnce()
    })
  })

  describe('activateSession', () => {
    it('binds window and publishes typed activated update', async () => {
      await projection.activate(42, 's1')
      expectSessionsUpdated({
        webContentsId: 42,
        sessionIds: ['s1'],
        reason: 'activated',
        activeSessionId: 's1'
      })
      expect(sqlitePresenter.newSessionsTable.get).not.toHaveBeenCalled()
      expect(agentManager.resolveSessionHandle).not.toHaveBeenCalled()
      expect(sessionUiPort.refreshSessionUi).not.toHaveBeenCalled()
    })
  })

  describe('deactivateSession', () => {
    it('unbinds window and publishes typed deactivated update', async () => {
      await projection.deactivate(42)
      expectSessionsUpdated({
        sessionIds: [],
        reason: 'deactivated',
        activeSessionId: null,
        webContentsId: 42
      })
      expect(sessionUiPort.refreshSessionUi).not.toHaveBeenCalled()
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

      await lifecycle.deleteSession('s1')
      expect(deepChatAgent.destroySession).toHaveBeenCalledWith('s1')
      expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith('s1')
      expectSessionsUpdated({ reason: 'deleted', sessionIds: ['s1'] })
    })

    it('no-ops for unknown session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)
      await lifecycle.deleteSession('unknown') // should not throw
      expect(deepChatAgent.destroySession).not.toHaveBeenCalled()
    })

    it('closes direct ACP state without entering the compatibility provider', async () => {
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

      await lifecycle.deleteSession('s-acp')

      expect(llmProviderPresenter.clearAcpSession).not.toHaveBeenCalled()
      expect(deepChatAgent.destroySession).toHaveBeenCalledWith('s-acp')
      expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith('s-acp')
      expect(deepChatAgent.destroySession.mock.invocationCallOrder[0]).toBeLessThan(
        sqlitePresenter.newSessionsTable.delete.mock.invocationCallOrder[0]
      )
    })

    it('still deletes the app row when runtime cleanup fails', async () => {
      const cleanupError = new Error('runtime cleanup failed')
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })
      agentManager.cleanupSessionBackends.mockRejectedValueOnce(cleanupError)

      await expect(lifecycle.deleteSession('s1')).resolves.toBeUndefined()

      expect(deepChatAgent.destroySession).toHaveBeenCalledExactlyOnceWith('s1')
      expect(skillPresenter.clearNewAgentSessionSkills).toHaveBeenCalledWith('s1')
      expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith('s1')
    })

    it('still removes the session row when backend and shared cleanup both fail', async () => {
      const backendError = new Error('backend cleanup failed')
      const sharedError = new Error('shared cleanup failed')
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })
      agentManager.cleanupSessionBackends.mockRejectedValueOnce(backendError)
      deepChatAgent.destroySession.mockRejectedValueOnce(sharedError)

      await expect(lifecycle.deleteSession('s1')).resolves.toBeUndefined()

      expect(deepChatAgent.destroySession).toHaveBeenCalledExactlyOnceWith('s1')
      expect(skillPresenter.clearNewAgentSessionSkills).toHaveBeenCalledWith('s1')
      expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith('s1')
    })

    it('still removes the session row when shared cleanup fails after backend cleanup', async () => {
      const sharedError = new Error('shared cleanup failed')
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })
      deepChatAgent.destroySession.mockRejectedValueOnce(sharedError)

      await expect(lifecycle.deleteSession('s1')).resolves.toBeUndefined()

      expect(agentManager.cleanupSessionBackends).toHaveBeenCalledExactlyOnceWith('s1')
      expect(skillPresenter.clearNewAgentSessionSkills).toHaveBeenCalledWith('s1')
      expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith('s1')
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

      await turn.cancelGeneration('s1')
      expect(deepChatAgent.cancelGeneration).toHaveBeenCalledWith('s1')
    })

    it('is a no-op for a missing session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)

      await expect(turn.cancelGeneration('missing')).resolves.toBeUndefined()

      expect(agentManager.resolveSessionHandle).not.toHaveBeenCalled()
      expect(deepChatAgent.cancelGeneration).not.toHaveBeenCalled()
    })
  })

  describe('respondToolInteraction', () => {
    it('validates the session before delegating the complete interaction identity', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })
      const response = { kind: 'permission' as const, granted: true }
      deepChatAgent.respondToolInteraction.mockResolvedValueOnce({ resumed: true })

      await expect(
        turn.respondToolInteraction('s1', 'message-1', 'tool-1', response)
      ).resolves.toEqual({ resumed: true })

      expect(deepChatAgent.respondToolInteraction).toHaveBeenCalledWith(
        's1',
        'message-1',
        'tool-1',
        response
      )
    })

    it('does not resolve a handle for a missing session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)

      await expect(
        turn.respondToolInteraction('missing', 'message-1', 'tool-1', {
          kind: 'permission',
          granted: true
        })
      ).rejects.toThrow('Session not found: missing')

      expect(agentManager.resolveSessionHandle).not.toHaveBeenCalled()
      expect(deepChatAgent.respondToolInteraction).not.toHaveBeenCalled()
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

      const settings = await assignment.getSessionGenerationSettings('s1')

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

      const updated = await assignment.updateSessionGenerationSettings('s1', {
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

      await expect(assignment.getSessionGenerationSettings('unknown')).rejects.toThrow(
        'Session not found: unknown'
      )
      await expect(
        assignment.updateSessionGenerationSettings('unknown', { temperature: 1 })
      ).rejects.toThrow('Session not found: unknown')
    })
  })

  describe('disabled agent tools', () => {
    it('reads disabled agent tools from session storage', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })
      sqlitePresenter.newSessionsTable.getDisabledAgentTools.mockReturnValue(['exec', 'cdp_send'])

      const disabledTools = await assignment.getSessionDisabledAgentTools('s1')

      expect(disabledTools).toEqual(['exec', 'cdp_send'])
    })

    it('updates disabled agent tools and invalidates the deepchat prompt cache', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })

      const disabledTools = await assignment.updateSessionDisabledAgentTools('s1', [
        'grep',
        'ls',
        'cdp_send',
        'exec',
        'exec'
      ])

      expect(disabledTools).toEqual(['cdp_send', 'exec', 'grep'])
      expect(sqlitePresenter.newSessionsTable.updateDisabledAgentTools).toHaveBeenCalledWith('s1', [
        'cdp_send',
        'exec',
        'grep'
      ])
      expect(deepChatAgent.invalidateSessionSystemPromptCache).toHaveBeenCalledWith('s1')
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

      const updated = await assignment.setSessionModel('s1', 'anthropic', 'claude-3-5-sonnet')

      expect(deepChatAgent.setSessionModel).toHaveBeenCalledWith(
        's1',
        'anthropic',
        'claude-3-5-sonnet'
      )
      expect(updated.providerId).toBe('anthropic')
      expect(updated.modelId).toBe('claude-3-5-sonnet')
      expectSessionsUpdated({ reason: 'updated', sessionIds: ['s1'] })
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

      await expect(assignment.setSessionModel('s-acp', 'openai', 'gpt-4')).rejects.toThrow(
        'ACP session model is locked.'
      )
      expect(deepChatAgent.setSessionModel).not.toHaveBeenCalled()
    })
  })

  describe('agent session transfer', () => {
    it('reports movable sessions and empty drafts before deleting an agent', async () => {
      const rows = [
        {
          id: 's-ready',
          agent_id: 'deepchat-writer',
          title: 'Ready',
          project_dir: '/repo',
          is_pinned: 0,
          is_draft: 0,
          session_kind: 'regular',
          parent_session_id: null,
          subagent_enabled: 0,
          subagent_meta_json: null,
          created_at: 1000,
          updated_at: 1000
        },
        {
          id: 's-draft',
          agent_id: 'deepchat-writer',
          title: 'Draft',
          project_dir: null,
          is_pinned: 0,
          is_draft: 1,
          session_kind: 'regular',
          parent_session_id: null,
          subagent_enabled: 0,
          subagent_meta_json: null,
          created_at: 1000,
          updated_at: 1000
        }
      ]
      sqlitePresenter.newSessionsTable.list.mockImplementation((filters: any) =>
        filters?.parentSessionId ? [] : rows
      )
      configPresenter.getAgentType.mockResolvedValue('deepchat')
      deepChatAgent.hasMessages.mockImplementation(
        async (sessionId: string) => sessionId === 's-ready'
      )

      const impact = await assignment.getAgentTransferImpact('deepchat-writer')

      expect(impact.totalSessions).toBe(2)
      expect(impact.movableSessions).toBe(1)
      expect(impact.emptyDrafts).toBe(1)
      expect(impact.blockedSessions).toBe(0)
      expect(impact.samples.map((sample) => sample.id)).toEqual(['s-ready'])
    })

    it('treats an existence query failure as having messages', async () => {
      sqlitePresenter.newSessionsTable.list.mockImplementation((filters: any) =>
        filters?.parentSessionId
          ? []
          : [
              {
                id: 's-draft',
                agent_id: 'deepchat-writer',
                title: 'Draft',
                project_dir: null,
                is_pinned: 0,
                is_draft: 1,
                session_kind: 'regular',
                parent_session_id: null,
                subagent_enabled: 0,
                subagent_meta_json: null,
                created_at: 1000,
                updated_at: 1000
              }
            ]
      )
      configPresenter.getAgentType.mockResolvedValue('deepchat')
      deepChatAgent.hasMessages.mockRejectedValue(new Error('query failed'))

      const impact = await assignment.getAgentTransferImpact('deepchat-writer')

      expect(impact.movableSessions).toBe(1)
      expect(impact.emptyDrafts).toBe(0)
      expect(deepChatAgent.getMessages).not.toHaveBeenCalled()
      expect(deepChatAgent.getMessageIds).not.toHaveBeenCalled()
    })

    it('blocks transfer when pending input inspection fails', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat-writer',
        title: 'Test',
        project_dir: '/repo',
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 1000
      })
      deepChatAgent.getSessionState.mockResolvedValue({ status: 'idle' })
      deepChatAgent.hasMessages.mockResolvedValue(true)
      deepChatAgent.listPendingInputs.mockRejectedValue(new Error('pending query failed'))

      await expect(assignment.moveSessionToAgent('s1', 'deepchat-coder')).rejects.toThrow(
        'Session s1 cannot be moved: pending-input'
      )

      expect(deepChatAgent.setSessionAgentContext).not.toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.updateAgentId).not.toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.update).not.toHaveBeenCalled()
      expect(llmProviderPresenter.clearAcpSession).not.toHaveBeenCalled()
    })

    it('rejects blank agent ids for destructive agent-session deletion', async () => {
      await expect(assignment.deleteAgentSessions('   ')).rejects.toThrow('Agent id is required.')
      expect(sqlitePresenter.newSessionsTable.list).not.toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.delete).not.toHaveBeenCalled()
    })

    it('moves a completed conversation to the target agent context', async () => {
      const row = {
        id: 's1',
        agent_id: 'deepchat-writer',
        title: 'Test',
        project_dir: '/repo',
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 1,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 1000
      }
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) =>
        id === 's1' ? row : undefined
      )
      sqlitePresenter.newSessionsTable.updateAgentId.mockImplementation(
        (_: string, agentId: string) => {
          row.agent_id = agentId
        }
      )
      sqlitePresenter.newSessionsTable.update.mockImplementation((_: string, fields: any) => {
        if (fields.project_dir !== undefined) {
          row.project_dir = fields.project_dir
        }
      })
      configPresenter.getAgentType.mockImplementation(async (agentId: string) => {
        if (agentId === 'deepchat-writer' || agentId === 'deepchat-coder') {
          return 'deepchat'
        }
        return null
      })
      configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({
        defaultModelPreset: { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' },
        permissionMode: 'default',
        disabledAgentTools: ['agent_filesystem_read_file'],
        subagentEnabled: false
      })
      deepChatAgent.hasMessages.mockResolvedValue(true)
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        permissionMode: 'default'
      })

      const updated = await assignment.moveSessionToAgent('s1', 'deepchat-coder')

      expect(deepChatAgent.setSessionAgentContext).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          agentId: 'deepchat-coder',
          providerId: 'anthropic',
          modelId: 'claude-3-5-sonnet',
          projectDir: '/repo',
          permissionMode: 'default'
        })
      )
      expect(sqlitePresenter.newSessionsTable.updateAgentId).toHaveBeenCalledWith(
        's1',
        'deepchat-coder'
      )
      expect(sqlitePresenter.newSessionsTable.updateDisabledAgentTools).toHaveBeenCalledWith('s1', [
        'agent_filesystem_read_file'
      ])
      expect(deepChatAgent.setSessionAgentContext.mock.invocationCallOrder[0]).toBeLessThan(
        sqlitePresenter.newSessionsTable.updateAgentId.mock.invocationCallOrder[0]
      )
      expect(
        sqlitePresenter.newSessionsTable.updateAgentId.mock.invocationCallOrder[0]
      ).toBeLessThan(sqlitePresenter.newSessionsTable.update.mock.invocationCallOrder[0])
      expect(sqlitePresenter.newSessionsTable.update.mock.invocationCallOrder[0]).toBeLessThan(
        sqlitePresenter.newSessionsTable.updateDisabledAgentTools.mock.invocationCallOrder[0]
      )
      expect(
        sqlitePresenter.newSessionsTable.updateDisabledAgentTools.mock.invocationCallOrder[0]
      ).toBeLessThan(deepChatAgent.getSessionState.mock.invocationCallOrder.at(-1)!)
      expect(updated.agentId).toBe('deepchat-coder')
      expect(updated.providerId).toBe('anthropic')
      expect(row.subagent_enabled).toBe(1)
      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s1', {
        project_dir: '/repo'
      })
      expectSessionsUpdated({ reason: 'updated', sessionIds: ['s1'] })
    })

    it('validates every batch session before applying the first mutation', async () => {
      const rows = [
        {
          id: 's-ready',
          agent_id: 'deepchat-writer',
          title: 'Ready',
          project_dir: '/repo',
          is_pinned: 0,
          is_draft: 0,
          session_kind: 'regular',
          parent_session_id: null,
          subagent_enabled: 0,
          subagent_meta_json: null,
          created_at: 1000,
          updated_at: 1000
        },
        {
          id: 's-active',
          agent_id: 'deepchat-writer',
          title: 'Active',
          project_dir: '/repo',
          is_pinned: 0,
          is_draft: 0,
          session_kind: 'regular',
          parent_session_id: null,
          subagent_enabled: 0,
          subagent_meta_json: null,
          created_at: 1000,
          updated_at: 1000
        }
      ]
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) =>
        rows.find((row) => row.id === id)
      )
      sqlitePresenter.newSessionsTable.list.mockImplementation((filters: any) =>
        filters?.parentSessionId ? [] : rows
      )
      configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({
        defaultModelPreset: { providerId: 'openai', modelId: 'gpt-4.1' }
      })
      deepChatAgent.hasMessages.mockResolvedValue(true)
      deepChatAgent.getSessionState.mockImplementation(async (sessionId: string) => ({
        status: sessionId === 's-active' ? 'generating' : 'idle',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        permissionMode: 'full_access'
      }))

      await expect(
        assignment.moveAgentSessions('deepchat-writer', 'deepchat-coder')
      ).rejects.toThrow('Session s-active cannot be moved: active')

      expect(deepChatAgent.setSessionAgentContext).not.toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.updateAgentId).not.toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.update).not.toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.delete).not.toHaveBeenCalled()
      expect(publishDeepchatEvent).not.toHaveBeenCalled()
    })

    it('moves a direct ACP conversation to DeepChat without entering compatibility cleanup', async () => {
      const row = {
        id: 's-acp',
        agent_id: 'acp-coder',
        title: 'ACP session',
        project_dir: '/repo',
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 1000
      }
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) =>
        id === 's-acp' ? row : undefined
      )
      sqlitePresenter.newSessionsTable.updateAgentId.mockImplementation(
        (_: string, agentId: string) => {
          row.agent_id = agentId
        }
      )
      configPresenter.getAgentType.mockImplementation(async (agentId: string) => {
        if (agentId === 'acp-coder') {
          return 'acp'
        }
        if (agentId === 'deepchat-coder') {
          return 'deepchat'
        }
        return null
      })
      configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({
        defaultModelPreset: { providerId: 'openai', modelId: 'gpt-4.1' },
        permissionMode: 'full_access',
        disabledAgentTools: [],
        subagentEnabled: true
      })
      deepChatAgent.hasMessages.mockResolvedValue(true)
      deepChatAgent.getSessionState.mockImplementation(async () => {
        if (row.agent_id === 'deepchat-coder') {
          return {
            status: 'idle',
            providerId: 'openai',
            modelId: 'gpt-4.1',
            permissionMode: 'full_access'
          }
        }
        return {
          status: 'idle',
          providerId: 'acp',
          modelId: 'acp-coder',
          permissionMode: 'full_access'
        }
      })

      const updated = await assignment.moveSessionToAgent('s-acp', 'deepchat-coder')

      expect(deepChatAgent.setSessionAgentContext).toHaveBeenCalledWith(
        's-acp',
        expect.objectContaining({
          agentId: 'deepchat-coder',
          providerId: 'openai',
          modelId: 'gpt-4.1',
          projectDir: '/repo',
          permissionMode: 'full_access'
        })
      )
      expect(llmProviderPresenter.clearAcpSession).not.toHaveBeenCalled()
      expect(closeDirectAcpRuntime).toHaveBeenCalledOnce()
      expect(closeDirectAcpRuntime.mock.invocationCallOrder[0]).toBeGreaterThan(
        sqlitePresenter.newSessionsTable.updateAgentId.mock.invocationCallOrder[0]
      )
      expect(updated.agentId).toBe('deepchat-coder')
      expect(updated.providerId).toBe('openai')
      expectSessionsUpdated({ reason: 'updated', sessionIds: ['s-acp'] })
    })

    it('keeps the ACP binding when target ownership update fails', async () => {
      const row = {
        id: 's-acp',
        agent_id: 'acp-coder',
        title: 'ACP session',
        project_dir: '/repo',
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 1000
      }
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) =>
        id === 's-acp' ? row : undefined
      )
      sqlitePresenter.newSessionsTable.updateAgentId.mockImplementation(() => {
        throw new Error('ownership update failed')
      })
      configPresenter.getAgentType.mockImplementation(async (agentId: string) => {
        if (agentId === 'acp-coder') {
          return 'acp'
        }
        if (agentId === 'deepchat-coder') {
          return 'deepchat'
        }
        return null
      })
      configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({
        defaultModelPreset: { providerId: 'openai', modelId: 'gpt-4.1' },
        permissionMode: 'full_access',
        disabledAgentTools: [],
        subagentEnabled: true
      })
      deepChatAgent.hasMessages.mockResolvedValue(true)
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      await expect(assignment.moveSessionToAgent('s-acp', 'deepchat-coder')).rejects.toThrow(
        'ownership update failed'
      )

      expect(deepChatAgent.setSessionAgentContext).toHaveBeenCalled()
      expect(llmProviderPresenter.clearAcpSession).not.toHaveBeenCalled()
      expect(closeDirectAcpRuntime).not.toHaveBeenCalled()
    })

    it('reports partial batch transfer failures after earlier sessions move', async () => {
      const rows = new Map<string, any>([
        [
          's-ready-1',
          {
            id: 's-ready-1',
            agent_id: 'deepchat-writer',
            title: 'Ready 1',
            project_dir: '/repo',
            is_pinned: 0,
            is_draft: 0,
            session_kind: 'regular',
            parent_session_id: null,
            subagent_enabled: 1,
            subagent_meta_json: null,
            created_at: 1000,
            updated_at: 1000
          }
        ],
        [
          's-ready-2',
          {
            id: 's-ready-2',
            agent_id: 'deepchat-writer',
            title: 'Ready 2',
            project_dir: '/repo',
            is_pinned: 0,
            is_draft: 0,
            session_kind: 'regular',
            parent_session_id: null,
            subagent_enabled: 1,
            subagent_meta_json: null,
            created_at: 1000,
            updated_at: 1000
          }
        ]
      ])
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) => rows.get(id))
      sqlitePresenter.newSessionsTable.list.mockImplementation((filters: any) => {
        if (filters?.parentSessionId) {
          return []
        }
        return Array.from(rows.values()).filter(
          (row) => !filters?.agentId || row.agent_id === filters.agentId
        )
      })
      sqlitePresenter.newSessionsTable.updateAgentId.mockImplementation(
        (id: string, agentId: string) => {
          if (id === 's-ready-2') {
            throw new Error('ownership update failed')
          }
          const row = rows.get(id)
          row.agent_id = agentId
        }
      )
      sqlitePresenter.newSessionsTable.update.mockImplementation((id: string, fields: any) => {
        const row = rows.get(id)
        if (fields.project_dir !== undefined) {
          row.project_dir = fields.project_dir
        }
      })
      configPresenter.getAgentType.mockImplementation(async (agentId: string) => {
        if (agentId === 'deepchat-writer' || agentId === 'deepchat-coder') {
          return 'deepchat'
        }
        return null
      })
      configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({
        defaultModelPreset: { providerId: 'openai', modelId: 'gpt-4.1' },
        permissionMode: 'full_access',
        disabledAgentTools: [],
        subagentEnabled: true
      })
      deepChatAgent.hasMessages.mockResolvedValue(true)
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        permissionMode: 'full_access'
      })

      await expect(
        assignment.moveAgentSessions('deepchat-writer', 'deepchat-coder')
      ).rejects.toThrow('Partial transfer completed: 1 moved.')

      expect(rows.get('s-ready-1').agent_id).toBe('deepchat-coder')
      expect(rows.get('s-ready-2').agent_id).toBe('deepchat-writer')
      expect(rows.get('s-ready-1').subagent_enabled).toBe(1)
      expect(rows.get('s-ready-2').subagent_enabled).toBe(1)
      expectSessionsUpdated({ reason: 'updated' })
    })

    it('rejects moving a DeepChat conversation to an ACP target', async () => {
      const row = {
        id: 's-deepchat',
        agent_id: 'deepchat-writer',
        title: 'DeepChat session',
        project_dir: '/repo',
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 1000
      }
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) =>
        id === 's-deepchat' ? row : undefined
      )
      configPresenter.getAgentType.mockImplementation(async (agentId: string) => {
        if (agentId === 'deepchat-writer') {
          return 'deepchat'
        }
        if (agentId === 'acp-coder') {
          return 'acp'
        }
        return null
      })
      deepChatAgent.hasMessages.mockResolvedValue(true)

      await expect(assignment.moveSessionToAgent('s-deepchat', 'acp-coder')).rejects.toThrow(
        'Conversation history cannot be moved to ACP agents.'
      )
      expect(deepChatAgent.setSessionAgentContext).not.toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.updateAgentId).not.toHaveBeenCalled()
      expect(llmProviderPresenter.clearAcpSession).not.toHaveBeenCalled()
    })

    it('rejects ACP targets for batch agent transfers before mutating sessions', async () => {
      sqlitePresenter.newSessionsTable.list.mockReturnValue([])
      configPresenter.getAgentType.mockImplementation(async (agentId: string) => {
        if (agentId === 'deepchat-writer') {
          return 'deepchat'
        }
        if (agentId === 'acp-coder') {
          return 'acp'
        }
        return null
      })

      await expect(assignment.moveAgentSessions('deepchat-writer', 'acp-coder')).rejects.toThrow(
        'Conversation history cannot be moved to ACP agents.'
      )
      expect(sqlitePresenter.newSessionsTable.updateAgentId).not.toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.delete).not.toHaveBeenCalled()
    })

    it('rejects DeepChat targets whose default provider is ACP', async () => {
      const row = {
        id: 's-deepchat',
        agent_id: 'deepchat-writer',
        title: 'DeepChat session',
        project_dir: '/repo',
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 1000
      }
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) =>
        id === 's-deepchat' ? row : undefined
      )
      configPresenter.getAgentType.mockImplementation(async (agentId: string) => {
        if (agentId === 'deepchat-writer' || agentId === 'deepchat-acp-default') {
          return 'deepchat'
        }
        return null
      })
      configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({
        defaultModelPreset: { providerId: 'acp', modelId: 'acp-coder' },
        permissionMode: 'full_access',
        disabledAgentTools: [],
        subagentEnabled: false
      })
      deepChatAgent.hasMessages.mockResolvedValue(true)

      await expect(
        assignment.moveSessionToAgent('s-deepchat', 'deepchat-acp-default')
      ).rejects.toThrow('Conversation history cannot be moved to ACP agents.')
      expect(deepChatAgent.setSessionAgentContext).not.toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.updateAgentId).not.toHaveBeenCalled()
      expect(llmProviderPresenter.clearAcpSession).not.toHaveBeenCalled()
    })

    it('rejects moving an ACP conversation to another ACP target', async () => {
      const row = {
        id: 's-acp',
        agent_id: 'acp-coder',
        title: 'ACP session',
        project_dir: '/repo',
        is_pinned: 0,
        is_draft: 0,
        session_kind: 'regular',
        parent_session_id: null,
        subagent_enabled: 0,
        subagent_meta_json: null,
        created_at: 1000,
        updated_at: 1000
      }
      sqlitePresenter.newSessionsTable.get.mockImplementation((id: string) =>
        id === 's-acp' ? row : undefined
      )
      configPresenter.getAgentType.mockImplementation(async (agentId: string) =>
        agentId === 'acp-coder' || agentId === 'acp-reviewer' ? 'acp' : null
      )
      deepChatAgent.hasMessages.mockResolvedValue(true)
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      await expect(assignment.moveSessionToAgent('s-acp', 'acp-reviewer')).rejects.toThrow(
        'Conversation history cannot be moved to ACP agents.'
      )
      expect(deepChatAgent.setSessionAgentContext).not.toHaveBeenCalled()
      expect(sqlitePresenter.newSessionsTable.updateAgentId).not.toHaveBeenCalled()
      expect(llmProviderPresenter.clearAcpSession).not.toHaveBeenCalled()
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

      await lifecycle.deleteSession('s1')
      expect(skillPresenter.clearNewAgentSessionSkills).toHaveBeenCalledWith('s1')
    })
  })

  describe('session management actions', () => {
    it('renames session with trimmed title and emits list update', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Old',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })

      await projection.renameSession('s1', '  New Title  ')

      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s1', {
        title: 'New Title'
      })
      expectSessionsUpdated({ reason: 'updated', sessionIds: ['s1'] })
    })

    it('toggles pinned state and emits list update', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })

      await projection.toggleSessionPinned('s1', true)

      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s1', {
        is_pinned: 1
      })
      expectSessionsUpdated({ reason: 'updated', sessionIds: ['s1'] })
    })

    it('clears session messages and keeps session', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })

      await turn.clearSessionMessages('s1')

      expect(deepChatAgent.clearMessages).toHaveBeenCalledWith('s1')
      expect(deepChatAgent.cancelGeneration.mock.invocationCallOrder[0]).toBeLessThan(
        deepChatAgent.clearMessages.mock.invocationCallOrder[0]
      )
      expect(sqlitePresenter.newSessionsTable.delete).not.toHaveBeenCalled()
      expectSessionsUpdated({ reason: 'updated', sessionIds: ['s1'] })
    })

    it('does not clear messages or publish when cancellation fails', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })
      const cancelError = new Error('cancel failed')
      deepChatAgent.cancelGeneration.mockRejectedValueOnce(cancelError)

      await expect(turn.clearSessionMessages('s1')).rejects.toBe(cancelError)

      expect(deepChatAgent.clearMessages).not.toHaveBeenCalled()
      expect(publishDeepchatEvent).not.toHaveBeenCalled()
      expect(sessionUiPort.refreshSessionUi).not.toHaveBeenCalled()
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

      const commands = await assignment.getAcpSessionCommands('s1')
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

      const commands = await assignment.getAcpSessionCommands('s-acp')

      expect(directAcpControl.getCommands).toHaveBeenCalledOnce()
      expect(llmProviderPresenter.getAcpSessionCommands).not.toHaveBeenCalled()
      expect(commands).toHaveLength(1)
      expect(commands[0].name).toBe('review')
    })

    it('keeps commands available for DeepChat sessions selecting the ACP provider', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's-compat',
        agent_id: 'deepchat',
        title: 'ACP compatibility',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      const commands = await assignment.getAcpSessionCommands('s-compat')

      expect(llmProviderPresenter.getAcpSessionCommands).toHaveBeenCalledWith('s-compat')
      expect(directAcpControl.getCommands).not.toHaveBeenCalled()
      expect(commands[0].name).toBe('review')
    })
  })

  describe('ACP session config options', () => {
    it('returns null for non-ACP sessions', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })

      const result = await assignment.getAcpSessionConfigOptions('s1')

      expect(result).toBeNull()
      expect(llmProviderPresenter.getAcpSessionConfigOptions).not.toHaveBeenCalled()
    })

    it('proxies ACP session config option reads for ACP-backed sessions', async () => {
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
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      const result = await assignment.getAcpSessionConfigOptions('s-acp')

      expect(directAcpControl.getConfigOptions).toHaveBeenCalledOnce()
      expect(llmProviderPresenter.getAcpSessionConfigOptions).not.toHaveBeenCalled()
      expect(result?.options[0].currentValue).toBe('gpt-5')
    })

    it('writes direct ACP session config options through the typed handle', async () => {
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
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      const result = await assignment.setAcpSessionConfigOption('s-acp', 'model', 'gpt-5-mini')

      expect(directAcpControl.setConfigOption).toHaveBeenCalledWith('model', 'gpt-5-mini')
      expect(llmProviderPresenter.setAcpSessionConfigOption).not.toHaveBeenCalled()
      expect(result?.options[0].currentValue).toBe('gpt-5-mini')
    })

    it('keeps config controls available for DeepChat sessions selecting the ACP provider', async () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's-compat',
        agent_id: 'deepchat',
        title: 'ACP compatibility',
        project_dir: '/tmp/workspace',
        is_pinned: 0,
        created_at: 1000,
        updated_at: 1000
      })
      deepChatAgent.getSessionState.mockResolvedValue({
        status: 'idle',
        providerId: 'acp',
        modelId: 'acp-coder',
        permissionMode: 'full_access'
      })

      const state = await assignment.getAcpSessionConfigOptions('s-compat')
      const updated = await assignment.setAcpSessionConfigOption('s-compat', 'model', 'gpt-5-mini')

      expect(llmProviderPresenter.getAcpSessionConfigOptions).toHaveBeenCalledWith('s-compat')
      expect(llmProviderPresenter.setAcpSessionConfigOption).toHaveBeenCalledWith(
        's-compat',
        'model',
        'gpt-5-mini'
      )
      expect(directAcpControl.getConfigOptions).not.toHaveBeenCalled()
      expect(directAcpControl.setConfigOption).not.toHaveBeenCalled()
      expect(state?.options[0].currentValue).toBe('gpt-5')
      expect(updated?.options[0].currentValue).toBe('gpt-5-mini')
    })
  })

  describe('getActiveSession', () => {
    it('returns null when no session bound', async () => {
      expect(await projection.getActive(99)).toBeNull()
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

      await projection.activate(1, 's1')
      const session = await projection.getActive(1)
      expect(session).not.toBeNull()
      expect(session!.id).toBe('s1')
    })

    it('keeps bindings isolated by window', async () => {
      await projection.activate(1, 's1')
      await projection.activate(2, 's2')
      await projection.deactivate(1)

      expect(projection.getActiveId(1)).toBeNull()
      expect(projection.getActiveId(2)).toBe('s2')
    })

    it('returns null and clears binding when bound session becomes unavailable', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await projection.activate(1, 's-disabled')
      vi.mocked(publishDeepchatEvent).mockClear()
      sqlitePresenter.newSessionsTable.get.mockReturnValueOnce({
        id: 's-disabled',
        agent_id: 'disabled-agent',
        title: 'Disabled',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })

      await expect(projection.getActive(1)).resolves.toBeNull()
      expect(publishDeepchatEvent).not.toHaveBeenCalled()

      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's-disabled',
        agent_id: 'deepchat',
        title: 'Recovered',
        project_dir: null,
        is_pinned: 0,
        created_at: 1000,
        updated_at: 2000
      })
      await expect(projection.getActive(1)).resolves.toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(
        '[SessionProjectionCoordinator] Skipping unavailable session id=s-disabled agent=disabled-agent:',
        expect.any(Error)
      )
      warnSpy.mockRestore()
    })
  })
})
