import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GUIDED_ONBOARDING_RESUME_REQUESTED_EVENT,
  GUIDED_ONBOARDING_RESUME_STORAGE_KEY
} from '@/lib/onboardingResume'

type SessionListTestItem = {
  id: string
  title?: string
  label?: string
  sessions: Array<{ id: string }>
}

type SetupStoreOptions = {
  initialSettings?: Record<string, unknown>
  failGetSetting?: boolean
  failSetSetting?: boolean
  selectedAgentId?: string | null
  enabledAgents?: Array<{ id: string; name?: string; type?: 'deepchat' | 'acp'; enabled?: boolean }>
  onboardingCurrentStepId?:
    | 'provider'
    | 'first-chat'
    | 'switch-model'
    | 'mcp'
    | 'skills'
    | 'plugins'
    | null
}

const SIDEBAR_GROUP_MODE_KEY = 'sidebar_group_mode'
const CREATE_OPERATION_ID = '11111111-1111-4111-8111-111111111111'

afterEach(() => {
  window.sessionStorage.removeItem(GUIDED_ONBOARDING_RESUME_STORAGE_KEY)
})

const createSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  title: 'Session',
  agentId: 'deepchat',
  status: 'none',
  projectDir: '/tmp/workspace',
  providerId: 'openai',
  modelId: 'gpt-4',
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular',
  parentSessionId: null,
  subagentEnabled: false,
  subagentMeta: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

const createOperation = (overrides: Record<string, unknown> = {}) => ({
  operationId: CREATE_OPERATION_ID,
  sessionId: 'session-1',
  state: 'succeeded',
  stage: 'completed',
  code: null,
  dismissedAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

const setupStore = async (options: SetupStoreOptions = {}) => {
  vi.resetModules()
  const sessionListeners: Array<(payload: any) => void> = []
  const sessionStatusListeners: Array<(payload: any) => void> = []

  const sessionClient = {
    list: vi.fn().mockResolvedValue({ sessions: [] }),
    getActive: vi.fn().mockResolvedValue({ session: null }),
    listLightweight: vi.fn().mockResolvedValue({
      items: [],
      hasMore: false,
      nextCursor: null
    }),
    getLightweightByIds: vi.fn().mockResolvedValue([]),
    createOperationId: vi.fn(() => CREATE_OPERATION_ID),
    create: vi.fn().mockResolvedValue({
      kind: 'operation',
      operation: createOperation(),
      session: createSession()
    }),
    getCreateOperation: vi.fn().mockResolvedValue({
      operation: createOperation(),
      session: createSession()
    }),
    listCreateOperations: vi.fn().mockResolvedValue({
      items: [],
      hasMore: false,
      nextCursor: null
    }),
    dismissCreateOperation: vi.fn().mockResolvedValue({ operation: null }),
    setSessionModel: vi
      .fn()
      .mockImplementation(async (_sessionId: string, providerId: string, modelId: string) =>
        createSession({ providerId, modelId })
      ),
    toggleSessionPinned: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue({ activated: true }),
    deactivate: vi.fn().mockResolvedValue({ deactivated: true }),
    onUpdated: vi.fn((listener: (payload: any) => void) => {
      sessionListeners.push(listener)
      return () => undefined
    }),
    onStatusChanged: vi.fn((listener: (payload: any) => void) => {
      sessionStatusListeners.push(listener)
      return () => undefined
    })
  }
  const chatClient = {
    sendMessage: vi.fn().mockResolvedValue({
      accepted: true,
      requestId: null,
      messageId: null
    })
  }
  const tabClient = {
    notifyRendererReady: vi.fn().mockResolvedValue(undefined),
    notifyRendererActivated: vi.fn().mockResolvedValue(undefined)
  }
  const pageRouter = {
    goToChat: vi.fn(),
    goToNewThread: vi.fn(),
    currentRoute: 'chat',
    chatSessionId: null as string | null
  }
  pageRouter.goToChat.mockImplementation((sessionId: string) => {
    pageRouter.currentRoute = 'chat'
    pageRouter.chatSessionId = sessionId
  })
  pageRouter.goToNewThread.mockImplementation(() => {
    pageRouter.currentRoute = 'newThread'
    pageRouter.chatSessionId = null
  })
  const onboardingCurrentStepId = options.onboardingCurrentStepId ?? null
  const resolveOnboardingStateAfterCompletion = (stepId: 'first-chat' | 'switch-model') => ({
    version: 1,
    status: 'active' as const,
    startedAt: 1,
    completedAt: null,
    lastActiveAt: 2,
    currentStepId: stepId === 'switch-model' ? 'first-chat' : null,
    steps: [
      {
        id: 'provider',
        required: true,
        status: 'completed' as const,
        startedAt: 1,
        completedAt: 1,
        skippedAt: null
      },
      {
        id: 'mcp',
        required: false,
        status: 'skipped' as const,
        startedAt: null,
        completedAt: null,
        skippedAt: 1
      },
      {
        id: 'skills',
        required: false,
        status: 'skipped' as const,
        startedAt: null,
        completedAt: null,
        skippedAt: 1
      },
      {
        id: 'plugins',
        required: false,
        status: 'skipped' as const,
        startedAt: null,
        completedAt: null,
        skippedAt: 1
      },
      {
        id: 'switch-model',
        required: true,
        status: stepId === 'switch-model' ? ('completed' as const) : ('completed' as const),
        startedAt: 1,
        completedAt: 2,
        skippedAt: null
      },
      {
        id: 'first-chat',
        required: true,
        status: stepId === 'first-chat' ? ('completed' as const) : ('pending' as const),
        startedAt: stepId === 'first-chat' ? 1 : null,
        completedAt: stepId === 'first-chat' ? 2 : null,
        skippedAt: null
      }
    ]
  })
  const onboardingClient = {
    getState: vi.fn().mockResolvedValue({
      version: 1,
      status: onboardingCurrentStepId ? 'active' : 'idle',
      startedAt: onboardingCurrentStepId ? 1 : null,
      completedAt: null,
      lastActiveAt: 1,
      currentStepId: onboardingCurrentStepId,
      steps: [
        {
          id: 'provider',
          required: true,
          status: onboardingCurrentStepId === 'provider' ? 'in_progress' : 'pending',
          startedAt: onboardingCurrentStepId === 'provider' ? 1 : null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'mcp',
          required: false,
          status: onboardingCurrentStepId === 'mcp' ? 'in_progress' : 'pending',
          startedAt: onboardingCurrentStepId === 'mcp' ? 1 : null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'skills',
          required: false,
          status: onboardingCurrentStepId === 'skills' ? 'in_progress' : 'pending',
          startedAt: onboardingCurrentStepId === 'skills' ? 1 : null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'plugins',
          required: false,
          status: onboardingCurrentStepId === 'plugins' ? 'in_progress' : 'pending',
          startedAt: onboardingCurrentStepId === 'plugins' ? 1 : null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'switch-model',
          required: true,
          status: onboardingCurrentStepId === 'switch-model' ? 'in_progress' : 'pending',
          startedAt: onboardingCurrentStepId === 'switch-model' ? 1 : null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'first-chat',
          required: true,
          status: onboardingCurrentStepId === 'first-chat' ? 'in_progress' : 'pending',
          startedAt: onboardingCurrentStepId === 'first-chat' ? 1 : null,
          completedAt: null,
          skippedAt: null
        }
      ]
    }),
    setStepStatus: vi
      .fn()
      .mockImplementation(async ({ stepId }: { stepId: 'first-chat' | 'switch-model' }) =>
        resolveOnboardingStateAfterCompletion(stepId)
      ),
    complete: vi.fn().mockResolvedValue({
      version: 1,
      status: 'completed',
      startedAt: 1,
      completedAt: 3,
      lastActiveAt: 3,
      currentStepId: null,
      steps: []
    })
  }
  const agentStore = reactive({
    selectedAgentId: options.selectedAgentId ?? null,
    enabledAgents: (options.enabledAgents ?? []).map((agent) => ({
      name: agent.name ?? agent.id,
      type: agent.type ?? 'deepchat',
      enabled: agent.enabled ?? true,
      ...agent
    })),
    setSelectedAgent: vi.fn((id: string | null) => {
      agentStore.selectedAgentId = id
    })
  })
  const settings = { ...(options.initialSettings ?? {}) }
  const configClient = {
    getSetting: vi.fn(async <T>(key: string) => {
      if (options.failGetSetting) {
        throw new Error('failed to read setting')
      }
      return settings[key] as T | undefined
    }),
    setSetting: vi.fn(async <T>(key: string, value: T) => {
      if (options.failSetSetting) {
        throw new Error('failed to write setting')
      }
      settings[key] = value
    })
  }
  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: () => unknown) => setup
    }
  })

  vi.doMock('../../../src/renderer/api/ConfigClient', () => ({
    createConfigClient: vi.fn(() => configClient)
  }))
  vi.doMock('../../../src/renderer/api/OnboardingClient', () => ({
    createOnboardingClient: vi.fn(() => onboardingClient)
  }))
  vi.doMock('../../../src/renderer/api/SessionClient', () => ({
    createSessionClient: vi.fn(() => sessionClient)
  }))
  vi.doMock('../../../src/renderer/api/ChatClient', () => ({
    createChatClient: vi.fn(() => chatClient)
  }))
  vi.doMock('@api/TabClient', () => ({
    createTabClient: vi.fn(() => tabClient)
  }))

  vi.doMock('@/stores/ui/pageRouter', () => ({
    usePageRouterStore: () => pageRouter
  }))
  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))
  const clearStreamingState = vi.fn()
  const clearMessages = vi.fn()
  const setCurrentSessionId = vi.fn()
  vi.doMock('@/stores/ui/message', () => ({
    useMessageStore: () => ({
      clearStreamingState,
      clear: clearMessages,
      loadMessages: vi.fn(),
      setCurrentSessionId
    })
  }))
  ;(window as any).deepchat = {
    ...((window as any).deepchat ?? {}),
    invoke: vi.fn(async (routeName: string) => {
      if (routeName === 'window.getRuntimeIdentity') {
        return {
          windowId: 1,
          webContentsId: 1
        }
      }

      return {}
    })
  }

  const { useSessionStore } = await import('@/stores/ui/session')
  const store = useSessionStore()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const emitSessionUpdate = (payload: unknown) => {
    for (const handler of sessionListeners) {
      handler(payload)
    }
  }
  const emitSessionStatusChange = (payload: unknown) => {
    for (const handler of sessionStatusListeners) {
      handler(payload)
    }
  }
  return {
    store,
    settings,
    configClient,
    clearStreamingState,
    clearMessages,
    setCurrentSessionId,
    sessionClient,
    chatClient,
    onboardingClient,
    tabClient,
    agentStore,
    pageRouter,
    emitSessionUpdate,
    emitSessionStatusChange
  }
}

describe('sessionStore public availability', () => {
  it('keeps availability separate from generation status for all non-missing states', async () => {
    const { store, clearMessages, pageRouter } = await setupStore()
    store.sessions.value = [createSession()]
    store.activeSessionId.value = 'session-1'

    store.applySessionRestoreOutcome({
      sessionId: 'session-1',
      session: createSession({ status: 'idle' }),
      resolution: {
        availability: 'available',
        session: createSession({ status: 'idle' })
      }
    })
    expect(store.activeSessionAvailability.value?.availability).toBe('available')
    expect(store.activeSession.value?.status).toBe('none')

    store.applySessionRestoreOutcome({
      sessionId: 'session-1',
      session: null,
      resolution: {
        availability: 'unavailable',
        sessionId: 'session-1',
        record: createSession(),
        reason: 'agent_unknown'
      }
    })
    expect(store.activeSessionAvailability.value?.availability).toBe('unavailable')
    expect(store.activeSessionId.value).toBe('session-1')

    store.applySessionRestoreOutcome({
      sessionId: 'session-1',
      session: null,
      resolution: {
        availability: 'transient_error',
        sessionId: 'session-1',
        record: null,
        error: {
          code: 'SESSION_RESOLUTION_FAILED',
          stage: 'state_read',
          retryable: true
        }
      }
    })
    expect(store.activeSessionAvailability.value?.availability).toBe('transient_error')
    expect(store.activeSessionId.value).toBe('session-1')
    expect(clearMessages).not.toHaveBeenCalled()
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()
  })

  it('treats route rejection and a legacy null payload as local transient state', async () => {
    const { store, clearMessages, pageRouter } = await setupStore()
    store.sessions.value = [createSession()]
    store.activeSessionId.value = 'session-1'

    store.applySessionRestoreOutcome({
      sessionId: 'session-1',
      session: null,
      rendererTransient: true
    })
    expect(store.activeSessionAvailability.value).toEqual({
      availability: 'transient_error',
      sessionId: 'session-1',
      source: 'renderer'
    })

    store.applySessionRestoreOutcome({ sessionId: 'session-1', session: null })
    expect(store.activeSessionAvailability.value?.source).toBe('legacy')
    expect(store.activeSessionId.value).toBe('session-1')
    expect(clearMessages).not.toHaveBeenCalled()
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()
  })

  it('clears local active state and navigates only for authoritative missing', async () => {
    const { store, clearMessages, pageRouter } = await setupStore()
    store.sessions.value = [createSession()]
    store.activeSessionId.value = 'session-1'

    store.applySessionRestoreOutcome({
      sessionId: 'session-1',
      session: null,
      resolution: { availability: 'missing', sessionId: 'session-1' }
    })

    expect(store.activeSessionId.value).toBeNull()
    expect(store.availabilityBySessionId.value['session-1']).toMatchObject({
      availability: 'missing',
      source: 'main'
    })
    expect(store.missingSessionNoticeSequence.value).toBe(1)
    expect(clearMessages).toHaveBeenCalledTimes(1)
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
  })

  it('keeps selected identity and cached state when getActive rejects without a resolution', async () => {
    const { store, sessionClient, pageRouter, clearMessages } = await setupStore()
    store.sessions.value = [createSession()]
    sessionClient.getActive.mockRejectedValueOnce(new Error('transport failed'))

    await store.selectSession('session-1')

    expect(store.activeSessionId.value).toBe('session-1')
    expect(store.activeSessionAvailability.value).toEqual({
      availability: 'transient_error',
      sessionId: 'session-1',
      source: 'renderer'
    })
    expect(clearMessages).not.toHaveBeenCalled()
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-1')
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()
  })

  it('converges a selected bound missing response without navigating back to chat', async () => {
    const { store, sessionClient, pageRouter } = await setupStore()
    store.sessions.value = [createSession()]
    sessionClient.getActive.mockResolvedValueOnce({
      session: null,
      resolution: { availability: 'missing', sessionId: 'session-1' }
    })

    await store.selectSession('session-1')

    expect(store.activeSessionId.value).toBeNull()
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
    expect(pageRouter.goToChat).not.toHaveBeenCalled()
  })

  it('distinguishes authoritative unbound from a legacy absent resolution', async () => {
    const { store, sessionClient, pageRouter, clearMessages } = await setupStore()
    store.sessions.value = [createSession()]
    sessionClient.getActive.mockResolvedValueOnce({ session: null, resolution: null })

    await store.selectSession('session-1')

    expect(store.activeSessionId.value).toBeNull()
    expect(store.availabilityBySessionId.value['session-1']).toBeUndefined()
    expect(store.missingSessionNoticeSequence.value).toBe(0)
    expect(clearMessages).toHaveBeenCalledTimes(1)
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
    expect(pageRouter.goToChat).not.toHaveBeenCalled()

    pageRouter.goToNewThread.mockClear()
    clearMessages.mockClear()
    sessionClient.getActive.mockResolvedValueOnce({ session: null })

    await store.selectSession('session-1')

    expect(store.activeSessionId.value).toBe('session-1')
    expect(store.activeSessionAvailability.value).toEqual({
      availability: 'transient_error',
      sessionId: 'session-1',
      source: 'legacy'
    })
    expect(clearMessages).not.toHaveBeenCalled()
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-1')
  })

  it('does not apply a getActive result for a different bound session', async () => {
    const { store, sessionClient, pageRouter } = await setupStore()
    store.sessions.value = [createSession({ id: 'session-a' }), createSession({ id: 'session-b' })]
    sessionClient.getActive.mockResolvedValueOnce({
      session: createSession({ id: 'session-b', providerId: 'acp', modelId: 'dimcode' }),
      resolution: {
        availability: 'available',
        session: createSession({ id: 'session-b', providerId: 'acp', modelId: 'dimcode' })
      }
    })

    await store.selectSession('session-a')

    expect(store.activeSessionId.value).toBe('session-a')
    expect(store.availabilityBySessionId.value['session-a']).toBeUndefined()
    expect(store.availabilityBySessionId.value['session-b']).toBeUndefined()
    expect(pageRouter.goToChat).not.toHaveBeenCalled()
  })

  it('bounds availability to the active session and current lightweight list', async () => {
    const { store, sessionClient } = await setupStore()
    store.sessions.value = [
      createSession({ id: 'session-active' }),
      createSession({ id: 'session-kept' }),
      createSession({ id: 'session-pruned' })
    ]
    store.activeSessionId.value = 'session-active'
    store.applySessionRestoreOutcome({
      sessionId: 'session-active',
      session: null,
      rendererTransient: true
    })
    for (const sessionId of ['session-kept', 'session-pruned']) {
      store.applySessionRestoreOutcome({
        sessionId,
        session: null,
        resolution: {
          availability: 'unavailable',
          sessionId,
          record: createSession({ id: sessionId }),
          reason: 'agent_unknown'
        }
      })
    }
    store.applySessionRestoreOutcome({
      sessionId: 'session-never-owned',
      session: null,
      rendererTransient: true
    })
    sessionClient.listLightweight.mockResolvedValueOnce({
      items: [createSession({ id: 'session-kept' })],
      hasMore: false,
      nextCursor: null
    })

    await store.fetchSessions()

    expect(store.availabilityBySessionId.value).toMatchObject({
      'session-active': {
        availability: 'transient_error',
        source: 'renderer'
      },
      'session-kept': {
        availability: 'unavailable',
        source: 'main'
      }
    })
    expect(store.availabilityBySessionId.value['session-pruned']).toBeUndefined()
    expect(store.availabilityBySessionId.value['session-never-owned']).toBeUndefined()
  })

  it('releases active-only availability when the session is closed', async () => {
    const { store } = await setupStore()
    store.activeSessionId.value = 'session-active-only'
    store.applySessionRestoreOutcome({
      sessionId: 'session-active-only',
      session: null,
      rendererTransient: true
    })

    await store.closeSession()

    expect(store.activeSessionId.value).toBeNull()
    expect(store.availabilityBySessionId.value).toEqual({})
  })
})

describe('sessionStore.getFilteredGroups', () => {
  it('hides draft sessions from grouped sidebar lists', async () => {
    const { store } = await setupStore({
      initialSettings: {
        [SIDEBAR_GROUP_MODE_KEY]: 'time'
      }
    })
    await store.fetchSessions()
    const now = Date.now()

    store.sessions.value = [
      {
        id: 'draft-1',
        title: 'Draft',
        agentId: 'acp-agent',
        status: 'none',
        projectDir: '/tmp/workspace',
        providerId: 'acp',
        modelId: 'acp-agent',
        isPinned: false,
        isDraft: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'real-1',
        title: 'Real Chat',
        agentId: 'acp-agent',
        status: 'none',
        projectDir: '/tmp/workspace',
        providerId: 'acp',
        modelId: 'acp-agent',
        isPinned: false,
        isDraft: false,
        createdAt: now,
        updatedAt: now
      }
    ]

    const groups = store.getFilteredGroups(null)
    const ids = groups.flatMap((group: SessionListTestItem) =>
      group.sessions.map((session: { id: string }) => session.id)
    )

    expect(groups[0]?.labelKey).toBe('common.time.today')
    expect(ids).toEqual(['real-1'])
  })

  it('hides pinned sessions from grouped list and exposes them in pinned list', async () => {
    const { store } = await setupStore()
    const now = Date.now()

    store.sessions.value = [
      {
        id: 'pinned-1',
        title: 'Pinned',
        agentId: 'deepchat',
        status: 'none',
        projectDir: '/tmp/workspace',
        providerId: 'openai',
        modelId: 'gpt-4',
        isPinned: true,
        isDraft: false,
        createdAt: now - 100,
        updatedAt: now
      },
      {
        id: 'normal-1',
        title: 'Normal',
        agentId: 'deepchat',
        status: 'none',
        projectDir: '/tmp/workspace',
        providerId: 'openai',
        modelId: 'gpt-4',
        isPinned: false,
        isDraft: false,
        createdAt: now - 200,
        updatedAt: now - 200
      }
    ]

    const groupIds = store
      .getFilteredGroups(null)
      .flatMap((group: SessionListTestItem) =>
        group.sessions.map((session: { id: string }) => session.id)
      )
    const pinnedIds = store.getPinnedSessions(null).map((session: { id: string }) => session.id)

    expect(groupIds).toEqual(['normal-1'])
    expect(pinnedIds).toEqual(['pinned-1'])
  })

  it('sorts fetched sessions alphabetically by title', async () => {
    const { store, sessionClient } = await setupStore()

    sessionClient.listLightweight.mockResolvedValueOnce({
      items: [
        createSession({ id: 'session-c', title: 'Zulu', updatedAt: 30 }),
        createSession({ id: 'session-a', title: 'Alpha', updatedAt: 10 }),
        createSession({ id: 'session-b', title: 'Bravo', updatedAt: 20 })
      ],
      hasMore: false,
      nextCursor: null
    })

    await store.fetchSessions()

    expect(store.sessions.value.map((session: { title: string }) => session.title)).toEqual([
      'Alpha',
      'Bravo',
      'Zulu'
    ])
  })

  it('uses the last path segment for Windows project labels', async () => {
    const { store } = await setupStore()
    const now = Date.now()

    await store.fetchSessions()
    store.sessions.value = [
      {
        id: 'windows-1',
        title: 'Windows Chat',
        agentId: 'deepchat',
        status: 'none',
        projectDir: 'C:\\Users\\DeepChat\\workspace',
        providerId: 'openai',
        modelId: 'gpt-4',
        isPinned: false,
        isDraft: false,
        createdAt: now,
        updatedAt: now
      }
    ]

    const groups = store.getFilteredGroups(null)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.id).toBe('C:\\Users\\DeepChat\\workspace')
    expect(groups[0]?.label).toBe('workspace')
  })

  it('keeps a stable unique id for project groups with the same folder name', async () => {
    const { store } = await setupStore()
    const now = Date.now()

    await store.fetchSessions()
    store.sessions.value = [
      {
        id: 'project-1',
        title: 'Workspace A',
        agentId: 'deepchat',
        status: 'none',
        projectDir: '/tmp/company-a/deepchat',
        providerId: 'openai',
        modelId: 'gpt-4',
        isPinned: false,
        isDraft: false,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'project-2',
        title: 'Workspace B',
        agentId: 'deepchat',
        status: 'none',
        projectDir: '/tmp/company-b/deepchat',
        providerId: 'openai',
        modelId: 'gpt-4',
        isPinned: false,
        isDraft: false,
        createdAt: now - 1,
        updatedAt: now - 1
      }
    ]

    const groups = store.getFilteredGroups(null)

    expect(groups).toHaveLength(2)
    expect(groups.map((group: SessionListTestItem) => group.id)).toEqual([
      '/tmp/company-a/deepchat',
      '/tmp/company-b/deepchat'
    ])
    expect(groups.map((group: SessionListTestItem) => group.label)).toEqual([
      'deepchat',
      'deepchat'
    ])
  })

  it('sorts sessions inside project groups by most recent update', async () => {
    const { store } = await setupStore()
    const now = Date.now()

    await store.fetchSessions()
    store.sessions.value = [
      createSession({
        id: 'old-alpha',
        title: 'Alpha',
        projectDir: '/tmp/workspace',
        updatedAt: now - 10_000
      }),
      createSession({
        id: 'new-zulu',
        title: 'Zulu',
        projectDir: '/tmp/workspace',
        updatedAt: now
      }),
      createSession({
        id: 'middle-bravo',
        title: 'Bravo',
        projectDir: '/tmp/workspace',
        updatedAt: now - 5_000
      })
    ]

    const groups = store.getFilteredGroups(null)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.sessions.map((session: { id: string }) => session.id)).toEqual([
      'new-zulu',
      'middle-bravo',
      'old-alpha'
    ])
  })

  it('keeps pinned sessions alphabetically sorted after pinning', async () => {
    const { store } = await setupStore()

    store.sessions.value = [
      createSession({ id: 'bravo-pinned', title: 'Bravo', isPinned: true, updatedAt: 10 }),
      createSession({ id: 'target', title: 'Zulu', isPinned: false, updatedAt: 5 }),
      createSession({ id: 'grouped-alpha', title: 'Alpha', isPinned: false, updatedAt: 20 })
    ]

    await store.toggleSessionPinned('target', true)

    expect(store.getPinnedSessions(null).map((session: { id: string }) => session.id)).toEqual([
      'bravo-pinned',
      'target'
    ])
  })

  it('keeps grouped sessions alphabetically sorted after unpinning', async () => {
    const { store } = await setupStore({
      initialSettings: {
        [SIDEBAR_GROUP_MODE_KEY]: 'time'
      }
    })
    const now = Date.now()

    await store.fetchSessions()
    store.sessions.value = [
      createSession({ id: 'target', title: 'Zulu', isPinned: true, updatedAt: now - 10 }),
      createSession({
        id: 'grouped-existing',
        title: 'Alpha',
        isPinned: false,
        updatedAt: now - 1000
      })
    ]

    await store.toggleSessionPinned('target', false)

    const groupedIds = store
      .getFilteredGroups(null)
      .flatMap((group: { sessions: Array<{ id: string }> }) =>
        group.sessions.map((session: { id: string }) => session.id)
      )
    expect(groupedIds).toEqual(['grouped-existing', 'target'])
  })
})

describe('sessionStore group mode preferences', () => {
  it('falls back to project when no saved preference exists', async () => {
    const { store } = await setupStore()

    await store.fetchSessions()

    expect(store.groupMode.value).toBe('project')
  })

  it('restores the saved group mode preference', async () => {
    const { store } = await setupStore({
      initialSettings: {
        [SIDEBAR_GROUP_MODE_KEY]: 'time'
      }
    })

    await store.fetchSessions()

    expect(store.groupMode.value).toBe('time')
  })

  it('falls back to project when the saved preference is invalid', async () => {
    const { store } = await setupStore({
      initialSettings: {
        [SIDEBAR_GROUP_MODE_KEY]: 'invalid-mode'
      }
    })

    await store.fetchSessions()

    expect(store.groupMode.value).toBe('project')
  })

  it('persists toggled group mode changes', async () => {
    const { store, settings, configClient } = await setupStore()

    await store.fetchSessions()
    await store.toggleGroupMode()

    expect(store.groupMode.value).toBe('time')
    expect(configClient.setSetting).toHaveBeenCalledWith(SIDEBAR_GROUP_MODE_KEY, 'time')
    expect(settings[SIDEBAR_GROUP_MODE_KEY]).toBe('time')
  })

  it('rolls back the group mode when persistence fails', async () => {
    const { store, configClient } = await setupStore({
      failSetSetting: true
    })

    await store.fetchSessions()
    await store.toggleGroupMode()

    expect(store.groupMode.value).toBe('project')
    expect(configClient.setSetting).toHaveBeenCalledWith(SIDEBAR_GROUP_MODE_KEY, 'time')
  })

  it('serializes concurrent group mode writes and persists the last toggle', async () => {
    const { store, settings, configClient } = await setupStore()
    const pendingResolvers: Array<() => void> = []

    await store.fetchSessions()
    configClient.setSetting.mockImplementation(async <T>(key: string, value: T) => {
      await new Promise<void>((resolve) => {
        pendingResolvers.push(() => {
          settings[key] = value
          resolve()
        })
      })
    })

    const firstToggle = store.toggleGroupMode()
    const secondToggle = store.toggleGroupMode()

    await Promise.resolve()

    expect(store.groupMode.value).toBe('project')
    expect(configClient.setSetting).toHaveBeenCalledTimes(1)

    pendingResolvers.shift()?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(configClient.setSetting).toHaveBeenCalledTimes(2)

    pendingResolvers.shift()?.()
    await Promise.all([firstToggle, secondToggle])

    expect(settings[SIDEBAR_GROUP_MODE_KEY]).toBe('project')
  })
})

describe('sessionStore.startNewConversation', () => {
  it('selects the first enabled agent from the all-agents welcome state', async () => {
    const { store, agentStore, pageRouter, sessionClient } = await setupStore({
      selectedAgentId: null,
      enabledAgents: [{ id: 'deepchat' }, { id: 'acp-a', type: 'acp' }]
    })

    await store.startNewConversation({ refresh: true })

    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('deepchat')
    expect(sessionClient.deactivate).not.toHaveBeenCalled()
    expect(pageRouter.goToNewThread).toHaveBeenCalledWith({ refresh: true })
  })

  it('keeps the active session agent when all agents is selected during a chat', async () => {
    const { store, agentStore, pageRouter, sessionClient } = await setupStore({
      selectedAgentId: null,
      enabledAgents: []
    })

    store.sessions.value = [createSession({ id: 'session-active', agentId: 'acp-a' })]
    store.activeSessionId.value = 'session-active'

    await store.startNewConversation({ refresh: true })

    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('acp-a')
    expect(sessionClient.deactivate).toHaveBeenCalledTimes(1)
    expect(store.activeSessionId.value).toBeNull()
    expect(pageRouter.goToNewThread).toHaveBeenCalledWith({ refresh: true })
  })

  it('preserves the selected agent when one is already chosen', async () => {
    const { store, agentStore, pageRouter, sessionClient } = await setupStore({
      selectedAgentId: 'acp-a',
      enabledAgents: [{ id: 'acp-a', type: 'acp' }]
    })

    await store.startNewConversation({ refresh: true })

    expect(agentStore.setSelectedAgent).not.toHaveBeenCalled()
    expect(sessionClient.deactivate).not.toHaveBeenCalled()
    expect(pageRouter.goToNewThread).toHaveBeenCalledWith({ refresh: true })
  })
})

describe('sessionStore onboarding progress', () => {
  it('marks the first-chat step complete after creating the first session', async () => {
    const { store, onboardingClient, pageRouter, sessionClient } = await setupStore({
      onboardingCurrentStepId: 'first-chat'
    })

    await store.createSession({
      agentId: 'deepchat',
      message: 'hello onboarding',
      projectDir: '/tmp/workspace',
      providerId: 'openai',
      modelId: 'gpt-4'
    })

    expect(sessionClient.create).toHaveBeenCalledWith(
      {
        agentId: 'deepchat',
        message: 'hello onboarding',
        projectDir: '/tmp/workspace',
        providerId: 'openai',
        modelId: 'gpt-4'
      },
      CREATE_OPERATION_ID
    )
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-1')
    expect(onboardingClient.getState).toHaveBeenCalledTimes(1)
    expect(onboardingClient.setStepStatus).toHaveBeenCalledWith({
      stepId: 'first-chat',
      status: 'completed'
    })
  })

  it('marks the first-chat step complete after a successful send', async () => {
    const { store, chatClient, onboardingClient } = await setupStore({
      onboardingCurrentStepId: 'first-chat'
    })

    await store.sendMessage('session-1', 'hello onboarding')

    expect(chatClient.sendMessage).toHaveBeenCalledWith('session-1', 'hello onboarding')
    expect(onboardingClient.getState).toHaveBeenCalledTimes(1)
    expect(onboardingClient.setStepStatus).toHaveBeenCalledWith({
      stepId: 'first-chat',
      status: 'completed'
    })
  })

  it('requests a welcome-guide resume when a pending chat onboarding step completes', async () => {
    window.sessionStorage.setItem(
      GUIDED_ONBOARDING_RESUME_STORAGE_KEY,
      JSON.stringify({
        stepId: 'first-chat',
        trigger: 'step-completed',
        createdAt: Date.now()
      })
    )

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const { store } = await setupStore({
      onboardingCurrentStepId: 'first-chat'
    })

    await store.sendMessage('session-1', 'hello onboarding')

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: GUIDED_ONBOARDING_RESUME_REQUESTED_EVENT,
        detail: {
          trigger: 'step-completed'
        }
      })
    )

    dispatchSpy.mockRestore()
  })

  it('marks the switch-model step complete after a successful model change', async () => {
    const { store, sessionClient, onboardingClient } = await setupStore({
      onboardingCurrentStepId: 'switch-model'
    })

    await store.setSessionModel('session-1', 'anthropic', 'claude-3-7-sonnet')

    expect(sessionClient.setSessionModel).toHaveBeenCalledWith(
      'session-1',
      'anthropic',
      'claude-3-7-sonnet'
    )
    expect(onboardingClient.getState).toHaveBeenCalledTimes(1)
    expect(onboardingClient.setStepStatus).toHaveBeenCalledWith({
      stepId: 'switch-model',
      status: 'completed'
    })
  })

  it('does not update onboarding progress when the guide is idle', async () => {
    const { store, onboardingClient } = await setupStore()

    await store.sendMessage('session-1', 'outside onboarding')

    expect(onboardingClient.getState).toHaveBeenCalledTimes(1)
    expect(onboardingClient.setStepStatus).not.toHaveBeenCalled()
  })
})

describe('sessionStore create operation intent', () => {
  it('activates a current success exactly once across early and late activation events', async () => {
    const { store, sessionClient, pageRouter, emitSessionUpdate, onboardingClient } =
      await setupStore({ onboardingCurrentStepId: 'first-chat' })
    sessionClient.activate.mockImplementationOnce(async (sessionId: string) => {
      emitSessionUpdate({
        sessionIds: [sessionId],
        reason: 'activated',
        webContentsId: 1,
        activeSessionId: sessionId
      })
      return { activated: true }
    })

    const activated = await store.createSession({ agentId: 'deepchat', message: 'hello' })

    expect(activated).toBe(true)
    expect(sessionClient.activate).toHaveBeenCalledTimes(1)
    expect(pageRouter.goToChat).toHaveBeenCalledTimes(1)
    expect(onboardingClient.setStepStatus).toHaveBeenCalledTimes(1)

    emitSessionUpdate({
      sessionIds: ['session-1'],
      reason: 'activated',
      webContentsId: 1,
      activeSessionId: 'session-1'
    })
    await Promise.resolve()

    expect(pageRouter.goToChat).toHaveBeenCalledTimes(1)
  })

  it('reconciles a pending current intent with the same id and then activates', async () => {
    const { store, sessionClient, pageRouter } = await setupStore()
    sessionClient.create.mockResolvedValueOnce({
      kind: 'operation',
      operation: createOperation({ state: 'pending', stage: 'runtime_ready' }),
      session: null
    })

    await expect(store.createSession({ agentId: 'deepchat', message: 'slow' })).resolves.toBe(false)
    const token = store.currentCreateIntent.value?.token
    expect(token).toBeTypeOf('number')
    expect(store.currentCreateIntent.value?.status).toBe('pending')
    expect(store.currentCreateIntent.value).not.toHaveProperty('input')
    expect(store.currentCreateIntent.value).not.toHaveProperty('message')
    expect(store.currentCreateIntent.value).not.toHaveProperty('files')

    await expect(store.reconcileCurrentCreateIntent(token as number)).resolves.toBe(true)

    expect(sessionClient.create).toHaveBeenCalledWith(
      { agentId: 'deepchat', message: 'slow' },
      CREATE_OPERATION_ID
    )
    expect(sessionClient.getCreateOperation).toHaveBeenCalledWith(CREATE_OPERATION_ID)
    expect(sessionClient.activate).toHaveBeenCalledTimes(1)
    expect(pageRouter.goToChat).toHaveBeenCalledTimes(1)
  })

  it('keeps a late success stale after the intent leaves and never activates it', async () => {
    const { store, sessionClient, pageRouter } = await setupStore()
    let resolveCreate: (value: unknown) => void = () => undefined
    sessionClient.create.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve
      })
    )

    const creating = store.createSession({ agentId: 'deepchat', message: 'slow' })
    const token = store.currentCreateIntent.value?.token
    store.invalidateCurrentCreateIntent(token)
    resolveCreate({
      kind: 'operation',
      operation: createOperation(),
      session: createSession()
    })

    await expect(creating).resolves.toBe(false)
    expect(sessionClient.activate).not.toHaveBeenCalled()
    expect(pageRouter.goToChat).not.toHaveBeenCalled()
    expect(store.sessions.value.map((session: { id: string }) => session.id)).toContain('session-1')
  })

  it('retains the previous binding and skips navigation/onboarding when activation rejects', async () => {
    const { store, sessionClient, pageRouter, onboardingClient } = await setupStore({
      onboardingCurrentStepId: 'first-chat'
    })
    store.sessions.value = [createSession({ id: 'session-previous' })]
    store.activeSessionId.value = 'session-previous'
    sessionClient.activate.mockRejectedValueOnce(new Error('activation failed'))

    await expect(store.createSession({ agentId: 'deepchat', message: 'hello' })).resolves.toBe(
      false
    )

    expect(store.activeSessionId.value).toBe('session-previous')
    expect(store.currentCreateIntent.value?.status).toBe('activation_failed')
    expect(pageRouter.goToChat).not.toHaveBeenCalled()
    expect(onboardingClient.setStepStatus).not.toHaveBeenCalled()
    expect(store.sessions.value.map((session: { id: string }) => session.id)).toContain('session-1')
  })

  it('accepts an authoritative active-session read when the activation response is lost', async () => {
    const { store, sessionClient, pageRouter } = await setupStore()
    sessionClient.activate.mockRejectedValueOnce(new Error('response lost'))
    sessionClient.getActive.mockResolvedValueOnce({ session: createSession() })

    await expect(store.createSession({ agentId: 'deepchat', message: 'hello' })).resolves.toBe(true)

    expect(sessionClient.getActive).toHaveBeenCalledTimes(1)
    expect(store.activeSessionId.value).toBe('session-1')
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-1')
  })

  it('does not swallow a different external activation while local activation is pending', async () => {
    const { store, sessionClient, pageRouter, emitSessionUpdate } = await setupStore()
    let resolveLocalActivation: () => void = () => undefined
    sessionClient.activate.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveLocalActivation = resolve
      })
    )
    sessionClient.getActive.mockResolvedValueOnce({
      session: createSession({ id: 'session-external', agentId: 'dimcode' })
    })
    store.sessions.value = [createSession({ id: 'session-external', agentId: 'dimcode' })]

    const creating = store.createSession({ agentId: 'deepchat', message: 'hello' })
    await vi.waitFor(() => expect(sessionClient.activate).toHaveBeenCalledTimes(1))
    emitSessionUpdate({
      sessionIds: ['session-external'],
      reason: 'activated',
      webContentsId: 1,
      activeSessionId: 'session-external'
    })
    await Promise.resolve()
    resolveLocalActivation()

    await expect(creating).resolves.toBe(false)
    await vi.waitFor(() => expect(store.activeSessionId.value).toBe('session-external'))
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-external')
    expect(pageRouter.goToChat).not.toHaveBeenCalledWith('session-1')
  })

  it.each(['failed', 'unknown'] as const)(
    'keeps a %s outcome checkable without starting another create',
    async (state) => {
      const { store, sessionClient } = await setupStore()
      sessionClient.create.mockResolvedValueOnce({
        kind: 'operation',
        operation: createOperation({ state, stage: 'runtime_ready' }),
        session: null
      })

      await store.createSession({ agentId: 'deepchat', message: 'hello' })

      expect(store.currentCreateIntent.value?.status).toBe(state)
      expect(sessionClient.create).toHaveBeenCalledTimes(1)
      expect(sessionClient.activate).not.toHaveBeenCalled()
    }
  )

  it.each(['existing', 'conflict'] as const)(
    'reads a structured %s outcome without associating the requested id',
    async (kind) => {
      const { store, sessionClient } = await setupStore()
      const oldOperation = createOperation({
        operationId: '22222222-2222-4222-8222-222222222222',
        state: 'unknown'
      })
      sessionClient.create.mockResolvedValueOnce({
        kind,
        code: kind === 'existing' ? 'CREATE_OPERATION_EXISTS' : 'CREATE_OPERATION_CONFLICT',
        operation: oldOperation
      })

      await store.createSession({ agentId: 'deepchat', message: 'hello' })
      const token = store.currentCreateIntent.value?.token
      sessionClient.getCreateOperation.mockResolvedValueOnce({
        operation: oldOperation,
        session: kind === 'existing' ? createSession() : null
      })
      await store.reconcileCurrentCreateIntent(token as number)

      expect(store.currentCreateIntent.value).toMatchObject({
        requestedOperationId: CREATE_OPERATION_ID,
        status: kind,
        operation: oldOperation
      })
      expect(sessionClient.getCreateOperation).toHaveBeenCalledWith(oldOperation.operationId)
      expect(sessionClient.activate).not.toHaveBeenCalled()
    }
  )

  it('keeps transport query errors on the same operation id without create retry', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.create.mockRejectedValueOnce(new Error('transport failed'))
    sessionClient.getCreateOperation.mockRejectedValueOnce(new Error('query failed'))

    await store.createSession({ agentId: 'deepchat', message: 'hello' })

    expect(store.currentCreateIntent.value).toMatchObject({
      requestedOperationId: CREATE_OPERATION_ID,
      status: 'query_error'
    })
    expect(sessionClient.create).toHaveBeenCalledTimes(1)
    expect(sessionClient.getCreateOperation).toHaveBeenCalledWith(CREATE_OPERATION_ID)
  })

  it('pages, dismisses, and checks content-free recovery identities without activation', async () => {
    const { store, sessionClient } = await setupStore()
    const first = createOperation({ state: 'unknown' })
    const second = createOperation({
      operationId: '22222222-2222-4222-8222-222222222222',
      sessionId: 'session-2',
      createdAt: 0,
      updatedAt: 0
    })
    sessionClient.listCreateOperations
      .mockResolvedValueOnce({
        items: [first],
        hasMore: true,
        nextCursor: { createdAt: 1, operationId: CREATE_OPERATION_ID }
      })
      .mockResolvedValueOnce({ items: [second], hasMore: false, nextCursor: null })
    sessionClient.dismissCreateOperation.mockResolvedValueOnce({
      operation: { ...first, dismissedAt: 10 }
    })
    sessionClient.getCreateOperation.mockResolvedValueOnce({
      operation: { ...first, dismissedAt: 10 },
      session: null
    })

    await store.loadCreateOperationHistory()
    await store.loadNextCreateOperationHistoryPage()
    await store.dismissCreateOperation(CREATE_OPERATION_ID)
    await store.checkCreateOperation(CREATE_OPERATION_ID)

    expect(store.createOperationHistory.value).toHaveLength(2)
    expect(store.createOperationHistory.value[0]).not.toHaveProperty('message')
    expect(store.createOperationHistory.value[0]).not.toHaveProperty('files')
    expect(store.createOperationHistory.value[0]?.dismissedAt).toBe(10)
    expect(sessionClient.activate).not.toHaveBeenCalled()
  })

  it('removes old succeeded identities when an authoritative reset page is empty', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.listCreateOperations
      .mockResolvedValueOnce({ items: [createOperation()], hasMore: false, nextCursor: null })
      .mockResolvedValueOnce({ items: [], hasMore: false, nextCursor: null })

    await store.loadCreateOperationHistory()
    expect(store.createOperationHistory.value).toHaveLength(1)

    await store.loadCreateOperationHistory()

    expect(store.createOperationHistory.value).toEqual([])
  })

  it('removes a checked identity when the service no longer has it', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.listCreateOperations.mockResolvedValueOnce({
      items: [createOperation()],
      hasMore: false,
      nextCursor: null
    })
    sessionClient.getCreateOperation.mockResolvedValueOnce({ operation: null, session: null })

    await store.loadCreateOperationHistory()
    await store.checkCreateOperation(CREATE_OPERATION_ID)

    expect(store.createOperationHistory.value).toEqual([])
  })

  it('preserves an operation updated while an authoritative reset is in flight', async () => {
    const { store, sessionClient } = await setupStore()
    const initial = createOperation({ state: 'pending', stage: 'runtime_ready' })
    const updated = createOperation({ state: 'unknown', stage: 'runtime_ready', updatedAt: 2 })
    let resolveReset: (value: {
      items: Array<ReturnType<typeof createOperation>>
      hasMore: boolean
      nextCursor: null
    }) => void = () => undefined
    sessionClient.listCreateOperations
      .mockResolvedValueOnce({ items: [initial], hasMore: false, nextCursor: null })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveReset = resolve
        })
      )
    sessionClient.getCreateOperation.mockResolvedValueOnce({ operation: updated, session: null })

    await store.loadCreateOperationHistory()
    const resetting = store.loadCreateOperationHistory()
    await vi.waitFor(() => expect(sessionClient.listCreateOperations).toHaveBeenCalledTimes(2))
    await store.checkCreateOperation(CREATE_OPERATION_ID)
    resolveReset({ items: [], hasMore: false, nextCursor: null })
    await resetting

    expect(store.createOperationHistory.value).toEqual([updated])
  })

  it('merges next pages with stable sorting and operation-id deduplication', async () => {
    const { store, sessionClient } = await setupStore()
    const first = createOperation({ createdAt: 10, updatedAt: 10 })
    const updatedFirst = createOperation({ state: 'failed', createdAt: 10, updatedAt: 11 })
    const second = createOperation({
      operationId: '22222222-2222-4222-8222-222222222222',
      sessionId: 'session-2',
      createdAt: 20,
      updatedAt: 20
    })
    sessionClient.listCreateOperations
      .mockResolvedValueOnce({
        items: [first],
        hasMore: true,
        nextCursor: { createdAt: 10, operationId: CREATE_OPERATION_ID }
      })
      .mockResolvedValueOnce({
        items: [updatedFirst, second],
        hasMore: false,
        nextCursor: null
      })

    await store.loadCreateOperationHistory()
    await store.loadNextCreateOperationHistoryPage()

    expect(store.createOperationHistory.value).toEqual([second, updatedFirst])
  })
})

describe('sessionStore streaming cleanup', () => {
  it('clears streaming state when switching active session', async () => {
    const { store, clearStreamingState, setCurrentSessionId, sessionClient, agentStore } =
      await setupStore({
        selectedAgentId: 'deepchat'
      })
    store.activeSessionId.value = 'session-a'
    store.sessions.value = [createSession({ id: 'session-b', agentId: 'acp-a' })]

    await store.selectSession('session-b')

    expect(sessionClient.activate).toHaveBeenCalledWith('session-b')
    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('acp-a')
    expect(clearStreamingState).toHaveBeenCalledTimes(1)
    expect(setCurrentSessionId).toHaveBeenCalledWith('session-b')
  })

  it('hydrates the selected active session before routing to chat', async () => {
    const { store, sessionClient, pageRouter, agentStore } = await setupStore({
      selectedAgentId: 'deepchat'
    })
    store.sessions.value = [createSession({ id: 'session-acp', agentId: 'dimcode' })]
    sessionClient.getActive.mockResolvedValueOnce({
      session: createSession({
        id: 'session-acp',
        title: 'ACP Session',
        agentId: 'dimcode',
        status: 'generating',
        projectDir: '/tmp/acp',
        providerId: 'acp',
        modelId: 'dimcode'
      })
    })

    await store.selectSession('session-acp')

    expect(sessionClient.activate).toHaveBeenCalledWith('session-acp')
    expect(sessionClient.getActive).toHaveBeenCalledTimes(1)
    expect(store.activeSession.value?.providerId).toBe('acp')
    expect(store.activeSession.value?.modelId).toBe('dimcode')
    expect(store.activeSession.value?.status).toBe('working')
    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('dimcode')
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-acp')
    expect(pageRouter.goToChat.mock.invocationCallOrder[0]).toBeGreaterThan(
      sessionClient.getActive.mock.invocationCallOrder[0]
    )
  })

  it('still routes when selected session hydration fails', async () => {
    const { store, sessionClient, pageRouter } = await setupStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    sessionClient.getActive.mockRejectedValueOnce(new Error('restore failed'))

    try {
      await store.selectSession('session-fallback')

      expect(sessionClient.activate).toHaveBeenCalledWith('session-fallback')
      expect(warnSpy).toHaveBeenCalledWith(
        '[sessionStore] Failed to hydrate selected session:',
        expect.any(Error)
      )
      expect(pageRouter.goToChat).toHaveBeenCalledWith('session-fallback')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('hydrates active session and selected agent from the bootstrap shell', async () => {
    const { store, setCurrentSessionId, agentStore } = await setupStore({
      selectedAgentId: 'deepchat'
    })

    await store.applyBootstrapShell({
      activeSessionId: 'session-sync-1',
      activeSession: {
        id: 'session-sync-1',
        title: 'Session Sync',
        agentId: 'acp-sync',
        status: 'idle',
        projectDir: null,
        providerId: 'acp',
        modelId: 'acp-sync',
        isPinned: false,
        isDraft: false,
        sessionKind: 'regular',
        parentSessionId: null,
        subagentEnabled: false,
        subagentMeta: null,
        createdAt: 1,
        updatedAt: 2
      }
    })

    expect(store.activeSessionId.value).toBe('session-sync-1')
    expect(setCurrentSessionId).toHaveBeenCalledWith('session-sync-1')
    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('acp-sync')
  })

  it('clears streaming when bootstrap shell switches the active session', async () => {
    const { store, clearStreamingState } = await setupStore()
    store.activeSessionId.value = 'session-a'

    await store.applyBootstrapShell({
      activeSessionId: 'session-b',
      activeSession: {
        id: 'session-b',
        title: 'Session B',
        agentId: 'deepchat',
        status: 'idle',
        projectDir: null,
        providerId: 'openai',
        modelId: 'gpt-4.1',
        isPinned: false,
        isDraft: false,
        sessionKind: 'regular',
        parentSessionId: null,
        subagentEnabled: false,
        subagentMeta: null,
        createdAt: 1,
        updatedAt: 2
      }
    })

    expect(clearStreamingState).toHaveBeenCalledTimes(1)
    expect(store.activeSessionId.value).toBe('session-b')
  })

  it('returns to new thread when the current window receives a deactivation event', async () => {
    const { store, clearStreamingState, setCurrentSessionId, pageRouter, emitSessionUpdate } =
      await setupStore()
    store.activeSessionId.value = 'session-a'
    pageRouter.currentRoute = 'chat'

    emitSessionUpdate({
      sessionIds: [],
      reason: 'deactivated',
      webContentsId: 1
    })

    expect(clearStreamingState).toHaveBeenCalledTimes(1)
    expect(store.activeSessionId.value).toBeNull()
    expect(setCurrentSessionId).toHaveBeenCalledWith(null)
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
  })

  it('reloads sessions when the session list update event fires', async () => {
    const { sessionClient, emitSessionUpdate } = await setupStore()

    emitSessionUpdate({
      sessionIds: [],
      reason: 'list-refreshed'
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sessionClient.listLightweight).toHaveBeenCalledTimes(1)
  })

  it('routes to chat and syncs the selected agent on external session activation', async () => {
    const { store, pageRouter, emitSessionUpdate, agentStore } = await setupStore({
      selectedAgentId: 'deepchat'
    })
    store.sessions.value = [createSession({ id: 'session-external', agentId: 'agent-b' })]

    emitSessionUpdate({
      sessionIds: ['session-external'],
      reason: 'activated',
      webContentsId: 1,
      activeSessionId: 'session-external'
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.activeSessionId.value).toBe('session-external')
    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('agent-b')
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-external')
  })

  it('hydrates the activated session before routing from the activation event', async () => {
    const { store, pageRouter, emitSessionUpdate, sessionClient } = await setupStore()
    store.sessions.value = [createSession({ id: 'session-event', agentId: 'dimcode' })]
    sessionClient.getActive.mockResolvedValueOnce({
      session: createSession({
        id: 'session-event',
        agentId: 'dimcode',
        providerId: 'acp',
        modelId: 'dimcode'
      })
    })

    emitSessionUpdate({
      sessionIds: ['session-event'],
      reason: 'activated',
      webContentsId: 1,
      activeSessionId: 'session-event'
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.activeSession.value?.providerId).toBe('acp')
    expect(store.activeSession.value?.modelId).toBe('dimcode')
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-event')
    expect(pageRouter.goToChat.mock.invocationCallOrder[0]).toBeGreaterThan(
      sessionClient.getActive.mock.invocationCallOrder[0]
    )
  })

  it('keeps the current session summary without repeating duplicate activation navigation', async () => {
    const { store, pageRouter, emitSessionUpdate, sessionClient } = await setupStore()
    store.sessions.value = [createSession({ id: 'session-acp', agentId: 'dimcode' })]
    sessionClient.getActive.mockResolvedValueOnce({
      session: createSession({
        id: 'session-acp',
        agentId: 'dimcode',
        providerId: 'acp',
        modelId: 'dimcode'
      })
    })
    await store.selectSession('session-acp')
    pageRouter.goToChat.mockClear()
    emitSessionUpdate({
      sessionIds: ['session-acp'],
      reason: 'activated',
      webContentsId: 1,
      activeSessionId: 'session-acp'
    })

    expect(store.activeSession.value?.providerId).toBe('acp')
    expect(store.activeSession.value?.modelId).toBe('dimcode')
    expect(pageRouter.goToChat).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sessionClient.getActive).toHaveBeenCalledTimes(1)
    expect(pageRouter.goToChat).not.toHaveBeenCalled()
  })

  it('does not route stale activation after the window is deactivated', async () => {
    const { store, pageRouter, emitSessionUpdate, sessionClient, tabClient } = await setupStore()
    store.sessions.value = [createSession({ id: 'session-stale', agentId: 'dimcode' })]
    let resolveActiveSession: (value: { session: ReturnType<typeof createSession> }) => void = () =>
      undefined
    sessionClient.getActive.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveActiveSession = resolve
      })
    )

    emitSessionUpdate({
      sessionIds: ['session-stale'],
      reason: 'activated',
      webContentsId: 1,
      activeSessionId: 'session-stale'
    })
    await Promise.resolve()

    emitSessionUpdate({
      sessionIds: [],
      reason: 'deactivated',
      webContentsId: 1
    })

    resolveActiveSession({
      session: createSession({
        id: 'session-stale',
        agentId: 'dimcode',
        providerId: 'acp',
        modelId: 'dimcode'
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.activeSessionId.value).toBeNull()
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
    expect(pageRouter.goToChat).not.toHaveBeenCalledWith('session-stale')
    expect(tabClient.notifyRendererActivated).not.toHaveBeenCalledWith('session-stale')
  })

  it('lets the latest IPC activation win before either hydration outcome is applied', async () => {
    const { store, pageRouter, emitSessionUpdate, sessionClient } = await setupStore()
    store.sessions.value = [
      createSession({ id: 'session-a', agentId: 'deepchat' }),
      createSession({ id: 'session-b', agentId: 'dimcode' })
    ]
    let resolveSessionA: (value: { session: ReturnType<typeof createSession> }) => void = () =>
      undefined
    let resolveSessionB: (value: { session: ReturnType<typeof createSession> }) => void = () =>
      undefined
    sessionClient.getActive
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSessionA = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSessionB = resolve
        })
      )

    emitSessionUpdate({
      sessionIds: ['session-a'],
      reason: 'activated',
      webContentsId: 1,
      activeSessionId: 'session-a'
    })
    await Promise.resolve()
    emitSessionUpdate({
      sessionIds: ['session-b'],
      reason: 'activated',
      webContentsId: 1,
      activeSessionId: 'session-b'
    })
    await Promise.resolve()

    resolveSessionB({
      session: createSession({
        id: 'session-b',
        agentId: 'dimcode',
        providerId: 'acp',
        modelId: 'dimcode'
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    resolveSessionA({
      session: createSession({ id: 'session-a', providerId: 'openai', modelId: 'gpt-4' })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.activeSessionId.value).toBe('session-b')
    expect(store.activeSessionAvailability.value).toMatchObject({
      availability: 'available',
      sessionId: 'session-b'
    })
    expect(store.availabilityBySessionId.value['session-a']).toBeUndefined()
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-b')
    expect(pageRouter.goToChat).not.toHaveBeenCalledWith('session-a')
  })

  it('lets the latest selected session win when hydration resolves out of order', async () => {
    const { store, pageRouter, sessionClient } = await setupStore()
    store.sessions.value = [
      createSession({ id: 'session-a', agentId: 'deepchat' }),
      createSession({ id: 'session-b', agentId: 'dimcode' })
    ]
    let resolveSessionA: (value: { session: ReturnType<typeof createSession> }) => void = () =>
      undefined
    sessionClient.getActive
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSessionA = resolve
        })
      )
      .mockResolvedValueOnce({
        session: createSession({
          id: 'session-b',
          agentId: 'dimcode',
          providerId: 'acp',
          modelId: 'dimcode'
        })
      })

    const firstSelection = store.selectSession('session-a')
    await Promise.resolve()
    await store.selectSession('session-b')

    resolveSessionA({
      session: createSession({
        id: 'session-a',
        providerId: 'openai',
        modelId: 'gpt-4'
      })
    })
    await firstSelection

    expect(store.activeSessionId.value).toBe('session-b')
    expect(store.activeSessionAvailability.value).toMatchObject({
      availability: 'available',
      sessionId: 'session-b'
    })
    expect(store.availabilityBySessionId.value['session-a']).toBeUndefined()
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-b')
    expect(pageRouter.goToChat).not.toHaveBeenCalledWith('session-a')
  })

  it('ignores a stale activation rejection after a newer selection completes', async () => {
    const { store, pageRouter, sessionClient } = await setupStore()
    store.sessions.value = [
      createSession({ id: 'session-a', agentId: 'deepchat' }),
      createSession({ id: 'session-b', agentId: 'dimcode' })
    ]
    let rejectSessionA: (reason?: unknown) => void = () => undefined
    sessionClient.activate
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectSessionA = reject
        })
      )
      .mockResolvedValueOnce({ activated: true })
    sessionClient.getActive.mockResolvedValueOnce({
      session: createSession({
        id: 'session-b',
        agentId: 'dimcode',
        providerId: 'acp',
        modelId: 'dimcode'
      }),
      resolution: {
        availability: 'available',
        session: createSession({
          id: 'session-b',
          agentId: 'dimcode',
          providerId: 'acp',
          modelId: 'dimcode'
        })
      }
    })

    const staleSelection = store.selectSession('session-a')
    await Promise.resolve()
    await store.selectSession('session-b')
    const completedSummary = { ...store.activeSession.value }
    const completedAvailability = { ...store.activeSessionAvailability.value }

    rejectSessionA(new Error('late activation failure'))
    await staleSelection

    expect(store.activeSessionId.value).toBe('session-b')
    expect(store.error.value).toBeNull()
    expect(store.activeSession.value).toEqual(completedSummary)
    expect(store.activeSessionAvailability.value).toEqual(completedAvailability)
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-b')
    expect(pageRouter.goToChat).not.toHaveBeenCalledWith('session-a')
  })

  it('updates the local session status immediately from the session status event', async () => {
    const { store, emitSessionStatusChange } = await setupStore()
    store.sessions.value = [createSession({ id: 'session-status', status: 'none' })]
    store.activeSessionId.value = 'session-status'

    emitSessionStatusChange({
      sessionId: 'session-status',
      status: 'generating'
    })

    expect(store.activeSession.value?.status).toBe('working')

    emitSessionStatusChange({
      sessionId: 'session-status',
      status: 'idle'
    })

    expect(store.activeSession.value?.status).toBe('none')
  })
})

describe('sessionStore pagination', () => {
  it('deduplicates concurrent initial fetch requests and allows a later fetch', async () => {
    const { store, sessionClient } = await setupStore()
    let resolveInitialFetch: (value: {
      items: unknown[]
      hasMore: boolean
      nextCursor: null
    }) => void = () => undefined
    const initialFetchPromise = new Promise<{
      items: unknown[]
      hasMore: boolean
      nextCursor: null
    }>((resolve) => {
      resolveInitialFetch = resolve
    })

    sessionClient.listLightweight.mockReturnValueOnce(initialFetchPromise)

    const firstFetch = store.fetchSessions()
    const secondFetch = store.fetchSessions()

    expect(secondFetch).toBe(firstFetch)
    await Promise.resolve()
    expect(sessionClient.listLightweight).toHaveBeenCalledTimes(1)

    resolveInitialFetch({ items: [], hasMore: false, nextCursor: null })
    await firstFetch
    await secondFetch

    sessionClient.listLightweight.mockResolvedValueOnce({
      items: [],
      hasMore: false,
      nextCursor: null
    })

    await store.fetchSessions()

    expect(sessionClient.listLightweight).toHaveBeenCalledTimes(2)
  })

  it('does not deduplicate next-page loading while an initial fetch is in flight', async () => {
    const { store, sessionClient } = await setupStore()

    sessionClient.listLightweight.mockResolvedValueOnce({
      items: [createSession({ id: 'session-a', title: 'Alpha', updatedAt: 30 })],
      hasMore: true,
      nextCursor: { updatedAt: 30, id: 'session-a' }
    })
    await store.fetchSessions()

    let resolveInitialFetch: (value: {
      items: unknown[]
      hasMore: boolean
      nextCursor: null
    }) => void = () => undefined
    const initialFetchPromise = new Promise<{
      items: unknown[]
      hasMore: boolean
      nextCursor: null
    }>((resolve) => {
      resolveInitialFetch = resolve
    })

    sessionClient.listLightweight.mockReturnValueOnce(initialFetchPromise).mockResolvedValueOnce({
      items: [createSession({ id: 'session-b', title: 'Bravo', updatedAt: 20 })],
      hasMore: false,
      nextCursor: null
    })

    const initialFetch = store.fetchSessions()
    await Promise.resolve()
    await store.loadNextPage()

    expect(sessionClient.listLightweight).toHaveBeenCalledTimes(3)
    expect(sessionClient.listLightweight.mock.calls.at(-1)?.[0]).toMatchObject({
      includeSubagents: false,
      cursor: { updatedAt: 30, id: 'session-a' }
    })

    resolveInitialFetch({ items: [], hasMore: false, nextCursor: null })
    await initialFetch
  })

  it('excludes subagent sessions from the initial sidebar page request', async () => {
    const { store, sessionClient } = await setupStore()

    await store.fetchSessions()

    expect(sessionClient.listLightweight).toHaveBeenCalledWith(
      expect.objectContaining({ includeSubagents: false })
    )
  })

  it('keeps excluding subagents when loading the next page', async () => {
    const { store, sessionClient } = await setupStore()

    sessionClient.listLightweight.mockResolvedValueOnce({
      items: [createSession({ id: 'session-a', title: 'Alpha', updatedAt: 30 })],
      hasMore: true,
      nextCursor: { updatedAt: 30, id: 'session-a' }
    })
    await store.fetchSessions()

    sessionClient.listLightweight.mockImplementationOnce(async (input: { cursor?: unknown }) => {
      structuredClone(input.cursor)
      return {
        items: [createSession({ id: 'session-b', title: 'Bravo', updatedAt: 20 })],
        hasMore: false,
        nextCursor: null
      }
    })
    await store.loadNextPage()

    const lastCall = sessionClient.listLightweight.mock.calls.at(-1)?.[0]
    expect(lastCall).toMatchObject({
      includeSubagents: false,
      cursor: { updatedAt: 30, id: 'session-a' }
    })
    expect(lastCall.cursor).not.toBe(store.nextCursor?.value)
    expect(store.hasMore.value).toBe(false)
    expect(store.sessions.value.map((session: { id: string }) => session.id)).toEqual([
      'session-a',
      'session-b'
    ])
  })

  it('does not request more pages once hasMore is false', async () => {
    const { store, sessionClient } = await setupStore()

    sessionClient.listLightweight.mockResolvedValueOnce({
      items: [createSession({ id: 'session-a', title: 'Alpha', updatedAt: 30 })],
      hasMore: false,
      nextCursor: null
    })
    await store.fetchSessions()

    const callsAfterInitial = sessionClient.listLightweight.mock.calls.length
    await store.loadNextPage()

    expect(sessionClient.listLightweight.mock.calls.length).toBe(callsAfterInitial)
  })
})
