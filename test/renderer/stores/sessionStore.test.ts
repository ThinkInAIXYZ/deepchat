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
    currentRoute: 'chat'
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
  const setCurrentSessionId = vi.fn()
  vi.doMock('@/stores/ui/message', () => ({
    useMessageStore: () => ({
      clearStreamingState,
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
    setCurrentSessionId,
    sessionClient,
    chatClient,
    onboardingClient,
    agentStore,
    pageRouter,
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

    expect(sessionClient.create).toHaveBeenCalledWith({
      agentId: 'deepchat',
      message: 'hello onboarding',
      projectDir: '/tmp/workspace',
      providerId: 'openai',
      modelId: 'gpt-4'
    })
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

    expect(store.activeSessionId.value).toBe('session-external')
    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('agent-b')
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-external')
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
