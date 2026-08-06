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
  runtimeIdentity?: Promise<{ windowId: number; webContentsId: number }>
}

const SIDEBAR_GROUP_MODE_KEY = 'sidebar_group_mode'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

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
  subagentMeta: null,
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
    create: vi.fn().mockResolvedValue({
      session: createSession()
    }),
    setSessionModel: vi
      .fn()
      .mockImplementation(async (_sessionId: string, providerId: string, modelId: string) =>
        createSession({ providerId, modelId })
      ),
    renameSession: vi
      .fn()
      .mockImplementation(async (_sessionId: string, title: string) =>
        createSession({ title, revision: 2 })
      ),
    toggleSessionPinned: vi
      .fn()
      .mockImplementation(async (_sessionId: string, pinned: boolean) =>
        createSession({ isPinned: pinned, revision: 2 })
      ),
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
  const pageRouter = {
    goToChat: vi.fn(),
    goToNewThread: vi.fn(),
    currentRoute: 'chat'
  }
  const attachmentPreparationStore = {
    stageInitialDraftRecovery: vi.fn(),
    consumeInitialDraftRecovery: vi.fn(() => null),
    clear: vi.fn()
  }
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
  vi.doMock('@/stores/ui/pageRouter', () => ({
    usePageRouterStore: () => pageRouter
  }))
  vi.doMock('@/stores/ui/attachmentPreparation', () => ({
    useAttachmentPreparationStore: () => attachmentPreparationStore
  }))
  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))
  const clearStreamingState = vi.fn()
  const setCurrentSessionId = vi.fn()
  const invalidateRecentSessionView = vi.fn()
  const purgeSessionTracking = vi.fn()
  vi.doMock('@/stores/ui/message', () => ({
    useMessageStore: () => ({
      clearStreamingState,
      invalidateRecentSessionView,
      purgeSessionTracking,
      loadMessages: vi.fn(),
      setCurrentSessionId
    })
  }))
  ;(window as any).deepchat = {
    ...((window as any).deepchat ?? {}),
    invoke: vi.fn(async (routeName: string) => {
      if (routeName === 'window.getRuntimeIdentity') {
        return (
          options.runtimeIdentity ?? {
            windowId: 1,
            webContentsId: 1
          }
        )
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
    invalidateRecentSessionView,
    purgeSessionTracking,
    setCurrentSessionId,
    sessionClient,
    chatClient,
    onboardingClient,
    agentStore,
    pageRouter,
    attachmentPreparationStore,
    emitSessionUpdate,
    emitSessionStatusChange
  }
}

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
    const { store, sessionClient } = await setupStore()

    store.sessions.value = [
      createSession({ id: 'bravo-pinned', title: 'Bravo', isPinned: true, updatedAt: 10 }),
      createSession({ id: 'target', title: 'Zulu', isPinned: false, updatedAt: 5 }),
      createSession({ id: 'grouped-alpha', title: 'Alpha', isPinned: false, updatedAt: 20 })
    ]
    sessionClient.toggleSessionPinned.mockResolvedValueOnce(
      createSession({ id: 'target', title: 'Zulu', isPinned: true, revision: 2 })
    )

    await store.toggleSessionPinned('target', true)

    expect(store.getPinnedSessions(null).map((session: { id: string }) => session.id)).toEqual([
      'bravo-pinned',
      'target'
    ])
  })

  it('keeps grouped sessions alphabetically sorted after unpinning', async () => {
    const { store, sessionClient } = await setupStore({
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

    sessionClient.toggleSessionPinned.mockResolvedValueOnce(
      createSession({ id: 'target', title: 'Zulu', isPinned: false, revision: 2 })
    )
    await store.toggleSessionPinned('target', false)

    const groupedIds = store
      .getFilteredGroups(null)
      .flatMap((group: { sessions: Array<{ id: string }> }) =>
        group.sessions.map((session: { id: string }) => session.id)
      )
    expect(groupedIds).toEqual(['grouped-existing', 'target'])
  })

  it('builds pinned and project groups from only the requested agent sessions', async () => {
    const { store } = await setupStore()
    const now = Date.now()

    await store.fetchSessions()
    store.sessions.value = [
      createSession({
        id: 'agent-a-pinned',
        title: 'Zulu pinned',
        agentId: 'agent-a',
        isPinned: true,
        updatedAt: now
      }),
      createSession({
        id: 'agent-b-pinned',
        title: 'Alpha pinned',
        agentId: 'agent-b',
        isPinned: true,
        updatedAt: now
      }),
      createSession({
        id: 'agent-a-project',
        title: 'Agent A project',
        agentId: 'agent-a',
        projectDir: '/projects/agent-a',
        updatedAt: now
      }),
      createSession({
        id: 'agent-b-project',
        title: 'Agent B project',
        agentId: 'agent-b',
        projectDir: '/projects/agent-b',
        updatedAt: now
      })
    ]

    expect(store.getPinnedSessions('agent-a').map((session: { id: string }) => session.id)).toEqual(
      ['agent-a-pinned']
    )
    expect(
      store.getFilteredGroups('agent-a').map((group: SessionListTestItem) => ({
        id: group.id,
        sessionIds: group.sessions.map((session) => session.id)
      }))
    ).toEqual([{ id: '/projects/agent-a', sessionIds: ['agent-a-project'] }])
  })

  it('builds time groups from only the requested agent sessions', async () => {
    const { store } = await setupStore({
      initialSettings: {
        [SIDEBAR_GROUP_MODE_KEY]: 'time'
      }
    })
    const now = Date.now()

    await store.fetchSessions()
    store.sessions.value = [
      createSession({
        id: 'agent-a-today',
        agentId: 'agent-a',
        updatedAt: now
      }),
      createSession({
        id: 'agent-a-yesterday',
        agentId: 'agent-a',
        updatedAt: now - 86400000
      }),
      createSession({
        id: 'agent-b-today',
        agentId: 'agent-b',
        updatedAt: now
      }),
      createSession({
        id: 'agent-b-older',
        agentId: 'agent-b',
        updatedAt: now - 14 * 86400000
      })
    ]

    expect(
      store.getFilteredGroups('agent-a').map((group: SessionListTestItem) => ({
        id: group.id,
        sessionIds: group.sessions.map((session) => session.id)
      }))
    ).toEqual([
      { id: 'common.time.today', sessionIds: ['agent-a-today'] },
      { id: 'common.time.yesterday', sessionIds: ['agent-a-yesterday'] }
    ])
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

  it('keeps the active session agent and workspace intent during a chat', async () => {
    const { store, agentStore, pageRouter, sessionClient } = await setupStore({
      selectedAgentId: null,
      enabledAgents: []
    })

    store.sessions.value = [createSession({ id: 'session-active', agentId: 'acp-a' })]
    store.activeSessionId.value = 'session-active'

    await store.startNewConversation({ refresh: true, projectDir: '/work/design' })

    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('acp-a')
    expect(sessionClient.deactivate).toHaveBeenCalledTimes(1)
    expect(store.activeSessionId.value).toBeNull()
    expect(pageRouter.goToNewThread).toHaveBeenCalledWith({ refresh: true })
    expect(store.newConversationProjectDirIntent.value).toEqual({
      id: 1,
      projectDir: '/work/design',
      consumed: false
    })

    store.consumeNewConversationProjectDirIntent(1)

    expect(store.newConversationProjectDirIntent.value?.consumed).toBe(true)
  })

  it('preserves an explicit null workspace intent for Chats', async () => {
    const { store } = await setupStore({
      selectedAgentId: 'deepchat',
      enabledAgents: [{ id: 'deepchat' }]
    })

    await store.startNewConversation({ refresh: true, projectDir: null })

    expect(store.newConversationProjectDirIntent.value).toEqual({
      id: 1,
      projectDir: null,
      consumed: false
    })
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

    expect(sessionClient.create).toHaveBeenCalledWith({
      agentId: 'deepchat',
      message: 'hello onboarding',
      projectDir: '/tmp/workspace',
      providerId: 'openai',
      modelId: 'gpt-4'
    })
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-1')
    expect(store.activeSession.value?.status).toBe('working')
    expect(onboardingClient.getState).toHaveBeenCalledTimes(1)
    expect(onboardingClient.setStepStatus).toHaveBeenCalledWith({
      stepId: 'first-chat',
      status: 'completed'
    })
  })

  it('does not publish a store error when new-session preparation is cancelled', async () => {
    const { store, sessionClient } = await setupStore()
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    sessionClient.create.mockRejectedValueOnce(abortError)
    const input = {
      agentId: 'deepchat',
      message: '',
      files: [{ name: 'scan.png', path: '/tmp/scan.png', mimeType: 'image/png' }]
    }

    await expect(
      store.createSession(input, {
        submissionId: 'submission-1',
        isCancellationRequested: () => true
      })
    ).rejects.toBe(abortError)

    expect(sessionClient.create).toHaveBeenCalledWith(input, {
      submissionId: 'submission-1'
    })
    expect(store.error.value).toBeNull()
  })

  it('stages a rejected initial attachment draft without marking the session working', async () => {
    const { store, onboardingClient, pageRouter, sessionClient, attachmentPreparationStore } =
      await setupStore({ onboardingCurrentStepId: 'first-chat' })
    const summary = {
      status: 'needs_user_action' as const,
      issues: [{ attachmentIndex: 0, reason: 'ocr_empty' as const }],
      suggestedActions: ['retry' as const, 'send_without_image_content' as const]
    }
    const file = {
      name: 'scan.png',
      path: '/tmp/scan.png',
      mimeType: 'image/png',
      requestedRepresentation: 'auto' as const
    }
    sessionClient.create.mockResolvedValueOnce({
      session: createSession(),
      initialTurn: {
        requestId: null,
        messageId: null,
        attachmentPreparation: summary
      }
    })

    const result = await store.createSession({
      agentId: 'deepchat',
      message: '',
      files: [file],
      search: true,
      activeSkills: ['ocr-skill'],
      providerId: 'openai',
      modelId: 'gpt-4'
    })

    expect(result.initialTurn?.attachmentPreparation).toEqual(summary)
    expect(attachmentPreparationStore.stageInitialDraftRecovery).toHaveBeenCalledWith({
      sessionId: 'session-1',
      input: {
        text: '',
        files: [file],
        search: true,
        activeSkills: ['ocr-skill']
      },
      summary
    })
    expect(store.activeSession.value?.status).toBe('none')
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-1')
    expect(onboardingClient.getState).not.toHaveBeenCalled()
  })

  it('hands the first-turn search intent to the chat composer before navigation', async () => {
    const { store, pageRouter } = await setupStore()

    await store.createSession({
      agentId: 'deepchat',
      message: 'Find current prices',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      search: true
    })

    expect(store.getSearchIntent('session-1')).toBe(true)
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-1')
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

  it('restores session status without publishing an error when send preparation is cancelled', async () => {
    const { store, chatClient } = await setupStore()
    store.sessions.value = [createSession({ id: 'session-1', status: 'none' })]
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    chatClient.sendMessage.mockRejectedValueOnce(abortError)

    await expect(
      store.sendMessage('session-1', 'hello', {
        submissionId: 'submission-1',
        isCancellationRequested: () => true
      })
    ).rejects.toBe(abortError)

    expect(chatClient.sendMessage).toHaveBeenCalledWith('session-1', 'hello', {
      submissionId: 'submission-1'
    })
    expect(store.sessions.value[0]?.status).toBe('none')
    expect(store.error.value).toBeNull()
  })

  it('publishes a non-abort send failure even when cancellation was requested', async () => {
    const { store, chatClient } = await setupStore()
    store.sessions.value = [createSession({ id: 'session-1', status: 'none' })]
    chatClient.sendMessage.mockRejectedValueOnce(new Error('OCR runtime unavailable'))

    await expect(
      store.sendMessage('session-1', 'hello', {
        submissionId: 'submission-1',
        isCancellationRequested: () => true
      })
    ).rejects.toThrow('OCR runtime unavailable')

    expect(store.sessions.value[0]?.status).toBe('error')
    expect(store.error.value).toContain('OCR runtime unavailable')
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
        subagentMeta: null,
        createdAt: 1,
        updatedAt: 2
      }
    })

    expect(store.activeSessionId.value).toBe('session-sync-1')
    expect(setCurrentSessionId).toHaveBeenCalledWith('session-sync-1')
    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('acp-sync')
  })

  it('does not let a stale bootstrap shell overwrite a newer canonical session snapshot', async () => {
    const { store } = await setupStore()
    store.sessions.value = [
      createSession({
        id: 'session-sync-1',
        title: 'Current title',
        isPinned: true,
        revision: 3,
        updatedAt: 3
      })
    ]

    await store.applyBootstrapShell({
      activeSessionId: 'session-sync-1',
      activeSession: createSession({
        id: 'session-sync-1',
        title: 'Stale title',
        isPinned: false,
        revision: 2,
        updatedAt: 4
      })
    })

    expect(store.sessions.value).toEqual([
      expect.objectContaining({ id: 'session-sync-1', title: 'Current title', revision: 3 })
    ])
    expect(store.activeSession.value).toEqual(
      expect.objectContaining({ id: 'session-sync-1', title: 'Current title', revision: 3 })
    )
  })

  it('keeps canonical, hydrated, and bootstrap session projections on the newest revision', async () => {
    const { store } = await setupStore()
    const current = createSession({
      id: 'session-sync-1',
      title: 'Current title',
      status: 'generating',
      revision: 3,
      updatedAt: 3,
      providerId: 'acp',
      modelId: 'dimcode'
    })
    store.sessions.value = [current, createSession({ id: 'session-other', revision: 1 })]

    await store.applyBootstrapShell({
      activeSessionId: 'session-sync-1',
      activeSession: current
    })
    store.applyRestoredSession(current)
    store.applyRestoredSession(
      createSession({
        id: 'session-sync-1',
        title: 'Stale title',
        status: 'idle',
        revision: 2,
        updatedAt: 4,
        providerId: 'legacy',
        modelId: 'legacy-model'
      })
    )

    expect(store.sessions.value.find((session) => session.id === 'session-sync-1')).toEqual(
      expect.objectContaining({ title: 'Current title', revision: 3 })
    )
    expect(store.activeSession.value).toEqual(
      expect.objectContaining({
        title: 'Current title',
        revision: 3,
        providerId: 'acp',
        modelId: 'dimcode',
        status: 'working'
      })
    )

    await store.applyBootstrapShell({
      activeSessionId: 'session-other',
      activeSession: createSession({ id: 'session-other', revision: 1 })
    })
    await store.applyBootstrapShell({
      activeSessionId: 'session-sync-1',
      activeSession: createSession({
        id: 'session-sync-1',
        title: 'Stale bootstrap title',
        revision: 2,
        updatedAt: 4
      })
    })

    expect(store.activeSession.value).toEqual(
      expect.objectContaining({ id: 'session-sync-1', title: 'Current title', revision: 3 })
    )
  })

  it('keeps a confirmed proactive policy across active projections and stale reads', async () => {
    const { store } = await setupStore()
    const current = createSession({
      id: 'session-workflow',
      orchestrationPolicy: 'explicit',
      revision: 3,
      updatedAt: 3
    })
    store.sessions.value = [current]
    await store.applyBootstrapShell({
      activeSessionId: 'session-workflow',
      activeSession: current
    })
    store.applyRestoredSession(current)

    store.applyConfirmedOrchestrationPolicy('session-workflow', 'proactive')
    store.applyRestoredSession(
      createSession({
        id: 'session-workflow',
        orchestrationPolicy: 'explicit',
        revision: 3,
        updatedAt: 3
      })
    )

    expect(store.sessions.value[0]?.orchestrationPolicy).toBe('proactive')
    expect(store.activeSession.value?.orchestrationPolicy).toBe('proactive')
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

  it('applies only the latest targeted update after runtime identity resolves', async () => {
    const runtimeIdentity = createDeferred<{ windowId: number; webContentsId: number }>()
    const { store, emitSessionUpdate, pageRouter } = await setupStore({
      runtimeIdentity: runtimeIdentity.promise
    })
    store.sessions.value = [createSession({ id: 'session-early' })]

    emitSessionUpdate({
      sessionIds: ['session-early'],
      reason: 'activated',
      webContentsId: 1,
      activeSessionId: 'session-early'
    })
    emitSessionUpdate({
      sessionIds: [],
      reason: 'deactivated',
      webContentsId: 1
    })

    expect(pageRouter.goToChat).not.toHaveBeenCalled()
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()

    runtimeIdentity.resolve({ windowId: 1, webContentsId: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.activeSessionId.value).toBeNull()
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
    expect(pageRouter.goToChat).not.toHaveBeenCalled()
  })

  it('keeps the current window pending update when another window updates before identity resolves', async () => {
    const runtimeIdentity = createDeferred<{ windowId: number; webContentsId: number }>()
    const { store, emitSessionUpdate, pageRouter } = await setupStore({
      runtimeIdentity: runtimeIdentity.promise
    })
    store.sessions.value = [createSession({ id: 'session-current' })]

    emitSessionUpdate({
      sessionIds: ['session-current'],
      reason: 'activated',
      webContentsId: 1,
      activeSessionId: 'session-current'
    })
    emitSessionUpdate({
      sessionIds: ['session-other'],
      reason: 'activated',
      webContentsId: 2,
      activeSessionId: 'session-other'
    })

    runtimeIdentity.resolve({ windowId: 1, webContentsId: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.activeSessionId.value).toBe('session-current')
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-current')
  })

  it('ignores pending targeted updates for another renderer window', async () => {
    const runtimeIdentity = createDeferred<{ windowId: number; webContentsId: number }>()
    const { store, emitSessionUpdate, pageRouter } = await setupStore({
      runtimeIdentity: runtimeIdentity.promise
    })
    store.sessions.value = [createSession({ id: 'session-other' })]

    emitSessionUpdate({
      sessionIds: ['session-other'],
      reason: 'activated',
      webContentsId: 2,
      activeSessionId: 'session-other'
    })
    runtimeIdentity.resolve({ windowId: 1, webContentsId: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.activeSessionId.value).toBeNull()
    expect(pageRouter.goToChat).not.toHaveBeenCalled()
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

  it('keeps the current session summary while duplicate activation rehydrates', async () => {
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
    let resolveActiveSession: (value: { session: ReturnType<typeof createSession> }) => void = () =>
      undefined
    sessionClient.getActive.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveActiveSession = resolve
      })
    )

    emitSessionUpdate({
      sessionIds: ['session-acp'],
      reason: 'activated',
      webContentsId: 1,
      activeSessionId: 'session-acp'
    })

    expect(store.activeSession.value?.providerId).toBe('acp')
    expect(store.activeSession.value?.modelId).toBe('dimcode')
    expect(pageRouter.goToChat).not.toHaveBeenCalled()

    resolveActiveSession({
      session: createSession({
        id: 'session-acp',
        agentId: 'dimcode',
        providerId: 'acp',
        modelId: 'dimcode'
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-acp')
  })

  it('does not route stale activation after the window is deactivated', async () => {
    const { store, pageRouter, emitSessionUpdate, sessionClient } = await setupStore()
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
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-b')
    expect(pageRouter.goToChat).not.toHaveBeenCalledWith('session-a')
  })

  it('rejects stale session hydration after an A-B-A activation cycle', async () => {
    const { store, sessionClient } = await setupStore()
    store.sessions.value = [
      createSession({ id: 'session-a', title: 'Session A' }),
      createSession({ id: 'session-b', title: 'Session B' })
    ]
    const staleSessionA = createDeferred<{ session: ReturnType<typeof createSession> }>()
    sessionClient.getActive
      .mockReturnValueOnce(staleSessionA.promise)
      .mockResolvedValueOnce({
        session: createSession({ id: 'session-b', title: 'Session B hydrated' })
      })
      .mockResolvedValueOnce({
        session: createSession({ id: 'session-a', title: 'Session A latest', revision: 2 })
      })

    const firstSelection = store.selectSession('session-a')
    await Promise.resolve()
    await store.selectSession('session-b')
    await store.selectSession('session-a')

    expect(store.activeSession.value?.title).toBe('Session A latest')

    staleSessionA.resolve({
      session: createSession({ id: 'session-a', title: 'Session A stale' })
    })
    await firstSelection

    expect(store.activeSession.value?.title).toBe('Session A latest')
  })

  it('does not let a pending close clear a later selected session', async () => {
    const { store, sessionClient, pageRouter } = await setupStore()
    const deactivation = createDeferred<{ deactivated: boolean }>()
    sessionClient.deactivate.mockReturnValueOnce(deactivation.promise)
    store.activeSessionId.value = 'session-a'
    store.sessions.value = [
      createSession({ id: 'session-a' }),
      createSession({ id: 'session-b', agentId: 'dimcode' })
    ]

    const close = store.closeSession()
    await Promise.resolve()
    await store.selectSession('session-b')
    deactivation.resolve({ deactivated: true })
    await close

    expect(store.activeSessionId.value).toBe('session-b')
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-b')
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()
  })

  it('does not let a stale select failure replace a later selection', async () => {
    const { store, sessionClient } = await setupStore()
    const firstActivation = createDeferred<{ activated: boolean }>()
    sessionClient.activate.mockReturnValueOnce(firstActivation.promise)

    const firstSelect = store.selectSession('session-a')
    await Promise.resolve()
    await store.selectSession('session-b')
    firstActivation.reject(new Error('stale activation failure'))
    await firstSelect

    expect(store.activeSessionId.value).toBe('session-b')
    expect(store.error.value).toBeNull()
  })

  it('keeps a created session in the list without reclaiming a later selection', async () => {
    const { store, sessionClient, pageRouter } = await setupStore()
    const pendingCreation = createDeferred<{ session: ReturnType<typeof createSession> }>()
    sessionClient.create.mockReturnValueOnce(pendingCreation.promise)
    store.sessions.value = [createSession({ id: 'session-b', agentId: 'dimcode' })]

    const creation = store.createSession({
      agentId: 'deepchat',
      message: '',
      projectDir: '/tmp/workspace',
      providerId: 'openai',
      modelId: 'gpt-4'
    })
    await Promise.resolve()
    await store.selectSession('session-b')
    pendingCreation.resolve({ session: createSession({ id: 'session-created', title: 'Created' }) })
    await creation

    expect(store.activeSessionId.value).toBe('session-b')
    expect(store.sessions.value.map((session) => session.id)).toContain('session-created')
    expect(pageRouter.goToChat).not.toHaveBeenCalledWith('session-created')
  })

  it('does not let a stale create failure replace a later selection error state', async () => {
    const { store, sessionClient } = await setupStore()
    const pendingCreation = createDeferred<{ session: ReturnType<typeof createSession> }>()
    sessionClient.create.mockReturnValueOnce(pendingCreation.promise)

    const creation = store.createSession({
      agentId: 'deepchat',
      message: '',
      projectDir: '/tmp/workspace',
      providerId: 'openai',
      modelId: 'gpt-4'
    })
    await Promise.resolve()
    await store.selectSession('session-b')
    pendingCreation.reject(new Error('stale create failure'))
    await expect(creation).rejects.toThrow('stale create failure')

    expect(store.activeSessionId.value).toBe('session-b')
    expect(store.error.value).toBeNull()
  })

  it('updates the local session status immediately from the session status event', async () => {
    const { store, emitSessionStatusChange, invalidateRecentSessionView } = await setupStore()
    store.sessions.value = [createSession({ id: 'session-status', status: 'none' })]
    store.activeSessionId.value = 'session-status'

    emitSessionStatusChange({
      sessionId: 'session-status',
      status: 'generating',
      version: 1
    })

    expect(store.activeSession.value?.status).toBe('working')
    expect(invalidateRecentSessionView).toHaveBeenCalledWith('session-status')

    emitSessionStatusChange({
      sessionId: 'session-status',
      status: 'idle',
      version: 2
    })

    expect(store.activeSession.value?.status).toBe('none')
  })

  it('does not let a stale restore snapshot overwrite a newer idle event', async () => {
    const { store, emitSessionStatusChange } = await setupStore()
    store.activeSessionId.value = 'session-status'
    store.sessions.value = [createSession({ id: 'session-status', status: 'working' })]

    emitSessionStatusChange({
      sessionId: 'session-status',
      status: 'idle',
      version: 2
    })
    store.applyRestoredSession(
      createSession({ id: 'session-status', status: 'generating', updatedAt: 2 })
    )

    expect(store.activeSession.value?.status).toBe('none')
  })

  it('does not let a stale restore snapshot overwrite a newer generating event', async () => {
    const { store, emitSessionStatusChange } = await setupStore()
    store.activeSessionId.value = 'session-status'
    store.sessions.value = [createSession({ id: 'session-status', status: 'none' })]

    emitSessionStatusChange({
      sessionId: 'session-status',
      status: 'generating',
      version: 2
    })
    store.applyRestoredSession(
      createSession({ id: 'session-status', status: 'idle', updatedAt: 2 })
    )

    expect(store.activeSession.value?.status).toBe('working')
  })

  it('ignores status events older than the latest observed version', async () => {
    const { store, emitSessionStatusChange, invalidateRecentSessionView } = await setupStore()
    store.activeSessionId.value = 'session-status'
    store.sessions.value = [createSession({ id: 'session-status', status: 'none' })]

    emitSessionStatusChange({
      sessionId: 'session-status',
      status: 'generating',
      version: 2
    })
    emitSessionStatusChange({
      sessionId: 'session-status',
      status: 'idle',
      version: 1
    })

    expect(store.activeSession.value?.status).toBe('working')
    expect(invalidateRecentSessionView).toHaveBeenCalledTimes(1)
  })

  it('purges message tracking when a session is permanently removed', async () => {
    const { store, emitSessionUpdate, invalidateRecentSessionView, purgeSessionTracking } =
      await setupStore()
    store.sessions.value = [createSession({ id: 'session-removed' })]
    store.setSearchIntent('session-removed', true)

    emitSessionUpdate({
      reason: 'deleted',
      sessionIds: ['session-removed']
    })

    expect(invalidateRecentSessionView).toHaveBeenCalledWith('session-removed')
    expect(purgeSessionTracking).toHaveBeenCalledWith('session-removed')
    expect(store.sessions.value).toEqual([])
    expect(store.getSearchIntent('session-removed')).toBe(false)
  })
})

describe('sessionStore pagination', () => {
  it('keeps the newest overlapping session refresh result', async () => {
    const { store, sessionClient } = await setupStore()
    store.sessions.value = [
      createSession({ id: 'session-refresh', title: 'Original', updatedAt: 1 })
    ]
    const firstRefresh = createDeferred<ReturnType<typeof createSession>[]>()
    const secondRefresh = createDeferred<ReturnType<typeof createSession>[]>()
    sessionClient.getLightweightByIds
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise)

    const firstRequest = store.refreshSessionsByIds(['session-refresh'])
    const secondRequest = store.refreshSessionsByIds(['session-refresh'])

    secondRefresh.resolve([createSession({ id: 'session-refresh', title: 'New', updatedAt: 3 })])
    await secondRequest
    firstRefresh.resolve([createSession({ id: 'session-refresh', title: 'Old', updatedAt: 2 })])
    await firstRequest

    expect(store.sessions.value).toEqual([
      expect.objectContaining({ id: 'session-refresh', title: 'New', updatedAt: 3 })
    ])
  })

  it('commits concurrent targeted refreshes for disjoint session IDs', async () => {
    const { store, sessionClient } = await setupStore()
    const refreshA = createDeferred<ReturnType<typeof createSession>[]>()
    const refreshB = createDeferred<ReturnType<typeof createSession>[]>()
    sessionClient.getLightweightByIds
      .mockReturnValueOnce(refreshA.promise)
      .mockReturnValueOnce(refreshB.promise)

    const requestA = store.refreshSessionsByIds(['session-a'])
    const requestB = store.refreshSessionsByIds(['session-b'])

    refreshB.resolve([createSession({ id: 'session-b', title: 'B', updatedAt: 3 })])
    await requestB
    refreshA.resolve([createSession({ id: 'session-a', title: 'A', updatedAt: 2 })])
    await requestA

    expect(store.sessions.value).toEqual([
      expect.objectContaining({ id: 'session-a', title: 'A', updatedAt: 2 }),
      expect.objectContaining({ id: 'session-b', title: 'B', updatedAt: 3 })
    ])
  })

  it('keeps non-overlapping rows from an older targeted batch', async () => {
    const { store, sessionClient } = await setupStore()
    const firstRefresh = createDeferred<ReturnType<typeof createSession>[]>()
    const secondRefresh = createDeferred<ReturnType<typeof createSession>[]>()
    sessionClient.getLightweightByIds
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise)

    const firstRequest = store.refreshSessionsByIds(['session-a', 'session-b'])
    const secondRequest = store.refreshSessionsByIds(['session-b', 'session-c'])

    secondRefresh.resolve([
      createSession({ id: 'session-b', title: 'New B', updatedAt: 4 }),
      createSession({ id: 'session-c', title: 'C', updatedAt: 4 })
    ])
    await secondRequest
    firstRefresh.resolve([
      createSession({ id: 'session-a', title: 'A', updatedAt: 3 }),
      createSession({ id: 'session-b', title: 'Old B', updatedAt: 2 })
    ])
    await firstRequest

    // sortSessions orders the flat list by title collator, not updatedAt.
    expect(store.sessions.value).toEqual([
      expect.objectContaining({ id: 'session-a', title: 'A', updatedAt: 3 }),
      expect.objectContaining({ id: 'session-c', title: 'C', updatedAt: 4 }),
      expect.objectContaining({ id: 'session-b', title: 'New B', updatedAt: 4 })
    ])
  })

  it('does not let an older session update overwrite a newer local session', async () => {
    const { store, sessionClient } = await setupStore()
    store.sessions.value = [createSession({ id: 'session-refresh', title: 'New', updatedAt: 3 })]
    sessionClient.getLightweightByIds.mockResolvedValueOnce([
      createSession({ id: 'session-refresh', title: 'Old', updatedAt: 2 })
    ])

    await store.refreshSessionsByIds(['session-refresh'])

    expect(store.sessions.value).toEqual([
      expect.objectContaining({ id: 'session-refresh', title: 'New', updatedAt: 3 })
    ])
  })

  it('uses durable revision to order snapshots with the same timestamp', async () => {
    const { store, sessionClient } = await setupStore()
    store.sessions.value = [
      createSession({
        id: 'session-refresh',
        title: 'Current title',
        isPinned: true,
        updatedAt: 3,
        revision: 10
      })
    ]
    sessionClient.getLightweightByIds.mockResolvedValueOnce([
      createSession({
        id: 'session-refresh',
        title: 'New title',
        isPinned: false,
        updatedAt: 3,
        revision: 11
      })
    ])

    await store.refreshSessionsByIds(['session-refresh'])

    expect(store.sessions.value).toEqual([
      expect.objectContaining({
        id: 'session-refresh',
        title: 'New title',
        isPinned: false,
        updatedAt: 3,
        revision: 11
      })
    ])
  })

  it('rejects a lower durable revision even when its timestamp is newer', async () => {
    const { store, sessionClient } = await setupStore()
    store.sessions.value = [
      createSession({ id: 'session-refresh', title: 'Current', updatedAt: 3, revision: 11 })
    ]
    sessionClient.getLightweightByIds.mockResolvedValueOnce([
      createSession({ id: 'session-refresh', title: 'Stale', updatedAt: 4, revision: 10 })
    ])

    await store.refreshSessionsByIds(['session-refresh'])

    expect(store.sessions.value[0]).toMatchObject({ title: 'Current', revision: 11 })
  })

  it('does not reinsert a deleted session from a pending targeted refresh', async () => {
    const { store, sessionClient, emitSessionUpdate } = await setupStore()
    const pendingRefresh = createDeferred<ReturnType<typeof createSession>[]>()
    sessionClient.getLightweightByIds.mockReturnValueOnce(pendingRefresh.promise)
    store.sessions.value = [createSession({ id: 'session-deleted' })]

    const refresh = store.refreshSessionsByIds(['session-deleted'])
    await Promise.resolve()
    emitSessionUpdate({ reason: 'deleted', sessionIds: ['session-deleted'] })
    pendingRefresh.resolve([createSession({ id: 'session-deleted', title: 'Stale response' })])
    await refresh

    expect(store.sessions.value).toEqual([])
    expect(store.error.value).toBeNull()
  })

  it('does not reinsert a deleted session from a pending first-page response', async () => {
    const { store, sessionClient, emitSessionUpdate } = await setupStore()
    const pendingFirstPage = createDeferred<{
      items: ReturnType<typeof createSession>[]
      hasMore: boolean
      nextCursor: null
    }>()
    sessionClient.listLightweight.mockReturnValueOnce(pendingFirstPage.promise)

    const fetch = store.fetchSessions()
    await Promise.resolve()
    emitSessionUpdate({ reason: 'deleted', sessionIds: ['session-deleted'] })
    pendingFirstPage.resolve({
      items: [createSession({ id: 'session-deleted', title: 'Stale response' })],
      hasMore: false,
      nextCursor: null
    })
    await fetch

    expect(store.sessions.value).toEqual([])
    expect(store.loading.value).toBe(false)
    expect(store.loadingMore.value).toBe(false)
    expect(store.error.value).toBeNull()
  })

  it('preserves a targeted update that commits while an older first page is pending', async () => {
    const { store, sessionClient } = await setupStore()
    const pendingFirstPage = createDeferred<{
      items: ReturnType<typeof createSession>[]
      hasMore: boolean
      nextCursor: null
    }>()
    sessionClient.listLightweight.mockReturnValueOnce(pendingFirstPage.promise)

    const fetch = store.fetchSessions()
    await vi.waitFor(() => expect(sessionClient.listLightweight).toHaveBeenCalledTimes(1))

    sessionClient.getLightweightByIds.mockResolvedValueOnce([
      createSession({ id: 'session-refresh', title: 'Targeted update', updatedAt: 3 })
    ])
    await store.refreshSessionsByIds(['session-refresh'])

    pendingFirstPage.resolve({
      items: [createSession({ id: 'session-refresh', title: 'Stale first page', updatedAt: 2 })],
      hasMore: false,
      nextCursor: null
    })
    await fetch

    expect(store.sessions.value).toEqual([
      expect.objectContaining({
        id: 'session-refresh',
        title: 'Targeted update',
        updatedAt: 3
      })
    ])
  })

  it('invalidates a pending targeted update after a new full list refresh', async () => {
    const { store, sessionClient } = await setupStore()
    const pendingTargetedUpdate = createDeferred<ReturnType<typeof createSession>[]>()
    sessionClient.getLightweightByIds.mockReturnValueOnce(pendingTargetedUpdate.promise)
    sessionClient.listLightweight.mockResolvedValueOnce({
      items: [createSession({ id: 'session-current', title: 'Current', updatedAt: 40 })],
      hasMore: false,
      nextCursor: null
    })

    const targetedRefresh = store.refreshSessionsByIds(['session-stale'])
    await Promise.resolve()
    await store.fetchSessions()

    pendingTargetedUpdate.resolve([
      createSession({ id: 'session-stale', title: 'Stale', updatedAt: 20 })
    ])
    await targetedRefresh

    expect(store.sessions.value).toEqual([
      expect.objectContaining({ id: 'session-current', title: 'Current', updatedAt: 40 })
    ])
    expect(store.error.value).toBeNull()
  })

  it('prioritizes the active bootstrap session when the first page starts after shell hydration', async () => {
    const { store, sessionClient } = await setupStore()

    await store.applyBootstrapShell({
      activeSessionId: 'bootstrap-session',
      activeSession: createSession({ id: 'bootstrap-session' })
    })
    await store.fetchSessions()

    expect(sessionClient.listLightweight).toHaveBeenCalledWith(
      expect.objectContaining({
        includeSubagents: false,
        prioritizeSessionId: 'bootstrap-session'
      })
    )
  })

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

  it('invalidates a pending pagination response when an initial refresh starts', async () => {
    const { store, sessionClient } = await setupStore()
    const stalePage = createDeferred<{
      items: ReturnType<typeof createSession>[]
      hasMore: boolean
      nextCursor: { updatedAt: number; id: string } | null
    }>()

    sessionClient.listLightweight
      .mockResolvedValueOnce({
        items: [createSession({ id: 'session-a', title: 'Alpha', updatedAt: 30 })],
        hasMore: true,
        nextCursor: { updatedAt: 30, id: 'session-a' }
      })
      .mockReturnValueOnce(stalePage.promise)
      .mockResolvedValueOnce({
        items: [createSession({ id: 'session-c', title: 'Current', updatedAt: 40 })],
        hasMore: true,
        nextCursor: { updatedAt: 40, id: 'session-c' }
      })
    await store.fetchSessions()

    const loadMore = store.loadNextPage()
    await Promise.resolve()
    await store.fetchSessions()

    stalePage.resolve({
      items: [createSession({ id: 'session-b', title: 'Stale', updatedAt: 20 })],
      hasMore: false,
      nextCursor: null
    })
    await loadMore

    expect(store.sessions.value.map((session) => session.id)).toEqual(['session-c'])
    expect(store.hasMore.value).toBe(true)
    expect(store.nextCursor.value).toEqual({ updatedAt: 40, id: 'session-c' })
    expect(store.error.value).toBeNull()
    expect(store.loadingMore.value).toBe(false)
  })

  it('keeps a pending pagination success after refreshing sessions by ID', async () => {
    const { store, sessionClient } = await setupStore()
    const pendingPage = createDeferred<{
      items: ReturnType<typeof createSession>[]
      hasMore: boolean
      nextCursor: { updatedAt: number; id: string } | null
    }>()

    sessionClient.listLightweight
      .mockResolvedValueOnce({
        items: [createSession({ id: 'session-a', title: 'Original', updatedAt: 30 })],
        hasMore: true,
        nextCursor: { updatedAt: 30, id: 'session-a' }
      })
      .mockReturnValueOnce(pendingPage.promise)
    sessionClient.getLightweightByIds.mockResolvedValueOnce([
      createSession({ id: 'session-a', title: 'Refreshed', updatedAt: 40 })
    ])
    await store.fetchSessions()

    const loadMore = store.loadNextPage()
    await Promise.resolve()
    await store.refreshSessionsByIds(['session-a'])

    pendingPage.resolve({
      items: [createSession({ id: 'session-b', title: 'Next page', updatedAt: 20 })],
      hasMore: false,
      nextCursor: null
    })
    await loadMore

    // sortSessions orders the flat list by title collator, not updatedAt.
    expect(store.sessions.value).toEqual([
      expect.objectContaining({ id: 'session-b', title: 'Next page', updatedAt: 20 }),
      expect.objectContaining({ id: 'session-a', title: 'Refreshed', updatedAt: 40 })
    ])
    expect(store.hasMore.value).toBe(false)
    expect(store.nextCursor.value).toBeNull()
    expect(store.error.value).toBeNull()
    expect(store.loadingMore.value).toBe(false)
  })

  it('does not let a stale targeted failure replace a newer targeted error', async () => {
    const { store, sessionClient } = await setupStore()
    const firstRefresh = createDeferred<ReturnType<typeof createSession>[]>()
    const secondRefresh = createDeferred<ReturnType<typeof createSession>[]>()
    sessionClient.getLightweightByIds
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise)

    const firstRequest = store.refreshSessionsByIds(['session-a', 'session-b'])
    const secondRequest = store.refreshSessionsByIds(['session-b', 'session-c'])

    secondRefresh.reject(new Error('new failure'))
    await secondRequest
    expect(store.error.value).toBe('Failed to refresh sessions: Error: new failure')

    firstRefresh.reject(new Error('old failure'))
    await firstRequest

    expect(store.error.value).toBe('Failed to refresh sessions: Error: new failure')
  })

  it('keeps a list error while a background targeted refresh succeeds', async () => {
    const { store, sessionClient } = await setupStore()
    store.error.value = 'Failed to load more sessions: Error: pagination failure'
    sessionClient.getLightweightByIds.mockResolvedValueOnce([
      createSession({ id: 'session-a', title: 'Refreshed', updatedAt: 40 })
    ])

    await store.refreshSessionsByIds(['session-a'])

    expect(store.error.value).toBe('Failed to load more sessions: Error: pagination failure')
    expect(store.sessions.value).toEqual([
      expect.objectContaining({ id: 'session-a', title: 'Refreshed', updatedAt: 40 })
    ])
  })

  it('reports a pending pagination error after refreshing sessions by ID', async () => {
    const { store, sessionClient } = await setupStore()
    const pendingPage = createDeferred<{
      items: ReturnType<typeof createSession>[]
      hasMore: boolean
      nextCursor: { updatedAt: number; id: string } | null
    }>()

    sessionClient.listLightweight
      .mockResolvedValueOnce({
        items: [createSession({ id: 'session-a', title: 'Original', updatedAt: 30 })],
        hasMore: true,
        nextCursor: { updatedAt: 30, id: 'session-a' }
      })
      .mockReturnValueOnce(pendingPage.promise)
    sessionClient.getLightweightByIds.mockResolvedValueOnce([
      createSession({ id: 'session-a', title: 'Refreshed', updatedAt: 40 })
    ])
    await store.fetchSessions()

    const loadMore = store.loadNextPage()
    await Promise.resolve()
    await store.refreshSessionsByIds(['session-a'])

    pendingPage.reject(new Error('pagination failure'))
    await loadMore

    expect(store.sessions.value).toEqual([
      expect.objectContaining({ id: 'session-a', title: 'Refreshed', updatedAt: 40 })
    ])
    expect(store.hasMore.value).toBe(true)
    expect(store.nextCursor.value).toEqual({ updatedAt: 30, id: 'session-a' })
    expect(store.error.value).toBe('Failed to load more sessions: Error: pagination failure')
    expect(store.loadingMore.value).toBe(false)
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
