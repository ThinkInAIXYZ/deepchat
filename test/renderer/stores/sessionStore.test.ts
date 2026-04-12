import { describe, expect, it, vi } from 'vitest'

type SetupStoreOptions = {
  initialSettings?: Record<string, unknown>
  failGetSetting?: boolean
  failSetSetting?: boolean
}

const SIDEBAR_GROUP_MODE_KEY = 'sidebar_group_mode'

const setupStore = async (options: SetupStoreOptions = {}) => {
  vi.resetModules()

  const agentSessionPresenter = {
    getSessionList: vi.fn().mockResolvedValue([]),
    getActiveSession: vi.fn().mockResolvedValue(null),
    createSession: vi.fn(),
    activateSession: vi.fn(),
    deactivateSession: vi.fn(),
    sendMessage: vi.fn(),
    renameSession: vi.fn(),
    toggleSessionPinned: vi.fn(),
    clearSessionMessages: vi.fn(),
    exportSession: vi.fn(),
    deleteSession: vi.fn()
  }
  const tabPresenter = {
    onRendererTabReady: vi.fn(),
    onRendererTabActivated: vi.fn()
  }
  const pageRouter = {
    goToChat: vi.fn(),
    goToNewThread: vi.fn(),
    currentRoute: 'chat'
  }
  const settings = { ...(options.initialSettings ?? {}) }
  const configPresenter = {
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
  const listeners = new Map<string, Array<(...args: any[]) => void>>()

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: () => unknown) => setup
    }
  })

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => {
      if (name === 'tabPresenter') return tabPresenter
      if (name === 'configPresenter') return configPresenter
      return agentSessionPresenter
    }
  }))

  vi.doMock('@/stores/ui/pageRouter', () => ({
    usePageRouterStore: () => pageRouter
  }))
  const clearStreamingState = vi.fn()
  vi.doMock('@/stores/ui/message', () => ({
    useMessageStore: () => ({
      clearStreamingState,
      loadMessages: vi.fn()
    })
  }))
  ;(window as any).electron = {
    ipcRenderer: {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        const handlers = listeners.get(event) ?? []
        handlers.push(handler)
        listeners.set(event, handlers)
      }),
      removeListener: vi.fn()
    }
  }
  ;(window as any).api = {
    getWebContentsId: vi.fn(() => 1)
  }

  const { useSessionStore } = await import('@/stores/ui/session')
  const { SESSION_EVENTS } = await import('@/events')
  const store = useSessionStore()
  const emitIpc = (event: string, payload?: unknown) => {
    for (const handler of listeners.get(event) ?? []) {
      handler(undefined, payload)
    }
  }
  return {
    store,
    settings,
    configPresenter,
    clearStreamingState,
    agentSessionPresenter,
    pageRouter,
    emitIpc,
    SESSION_EVENTS
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
    const ids = groups.flatMap((group) => group.sessions.map((session) => session.id))

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
      .flatMap((group) => group.sessions.map((session) => session.id))
    const pinnedIds = store.getPinnedSessions(null).map((session) => session.id)

    expect(groupIds).toEqual(['normal-1'])
    expect(pinnedIds).toEqual(['pinned-1'])
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
    expect(groups[0]?.label).toBe('workspace')
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
    const { store, settings, configPresenter } = await setupStore()

    await store.fetchSessions()
    await store.toggleGroupMode()

    expect(store.groupMode.value).toBe('time')
    expect(configPresenter.setSetting).toHaveBeenCalledWith(SIDEBAR_GROUP_MODE_KEY, 'time')
    expect(settings[SIDEBAR_GROUP_MODE_KEY]).toBe('time')
  })

  it('rolls back the group mode when persistence fails', async () => {
    const { store, configPresenter } = await setupStore({
      failSetSetting: true
    })

    await store.fetchSessions()
    await store.toggleGroupMode()

    expect(store.groupMode.value).toBe('project')
    expect(configPresenter.setSetting).toHaveBeenCalledWith(SIDEBAR_GROUP_MODE_KEY, 'time')
  })

  it('serializes concurrent group mode writes and persists the last toggle', async () => {
    const { store, settings, configPresenter } = await setupStore()
    const pendingResolvers: Array<() => void> = []

    await store.fetchSessions()
    configPresenter.setSetting.mockImplementation(async <T>(key: string, value: T) => {
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
    expect(configPresenter.setSetting).toHaveBeenCalledTimes(1)

    pendingResolvers.shift()?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(configPresenter.setSetting).toHaveBeenCalledTimes(2)

    pendingResolvers.shift()?.()
    await Promise.all([firstToggle, secondToggle])

    expect(settings[SIDEBAR_GROUP_MODE_KEY]).toBe('project')
  })
})

describe('sessionStore streaming cleanup', () => {
  it('clears streaming state when switching active session', async () => {
    const { store, clearStreamingState, agentSessionPresenter } = await setupStore()
    store.activeSessionId.value = 'session-a'

    await store.selectSession('session-b')

    expect(agentSessionPresenter.activateSession).toHaveBeenCalledWith(1, 'session-b')
    expect(clearStreamingState).toHaveBeenCalledTimes(1)
  })

  it('syncs active session from presenter when fetching sessions', async () => {
    const { store, agentSessionPresenter } = await setupStore()
    agentSessionPresenter.getSessionList.mockResolvedValueOnce([
      {
        id: 'session-sync-1',
        title: 'Session Sync',
        agentId: 'deepchat',
        status: 'idle',
        projectDir: null,
        providerId: 'openai',
        modelId: 'gpt-4o',
        isPinned: false,
        isDraft: false,
        createdAt: 1,
        updatedAt: 2
      }
    ])
    agentSessionPresenter.getActiveSession.mockResolvedValueOnce({
      id: 'session-sync-1'
    })

    await store.fetchSessions()

    expect(agentSessionPresenter.getActiveSession).toHaveBeenCalledWith(1)
    expect(store.activeSessionId.value).toBe('session-sync-1')
  })

  it('clears streaming when fetch detects active session switch', async () => {
    const { store, clearStreamingState, agentSessionPresenter } = await setupStore()
    store.activeSessionId.value = 'session-a'
    agentSessionPresenter.getActiveSession.mockResolvedValueOnce({
      id: 'session-b'
    })

    await store.fetchSessions()

    expect(clearStreamingState).toHaveBeenCalledTimes(1)
    expect(store.activeSessionId.value).toBe('session-b')
  })

  it('returns to new thread when active session becomes unavailable', async () => {
    const { store, clearStreamingState, agentSessionPresenter, pageRouter } = await setupStore()
    store.activeSessionId.value = 'session-a'
    pageRouter.currentRoute = 'chat'
    agentSessionPresenter.getActiveSession.mockResolvedValueOnce(null)

    await store.fetchSessions()

    expect(clearStreamingState).toHaveBeenCalledTimes(1)
    expect(store.activeSessionId.value).toBeNull()
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
  })

  it('reloads sessions when the session list update event fires', async () => {
    const { agentSessionPresenter, emitIpc, SESSION_EVENTS } = await setupStore()

    emitIpc(SESSION_EVENTS.LIST_UPDATED)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(agentSessionPresenter.getSessionList).toHaveBeenCalledTimes(1)
    expect(agentSessionPresenter.getActiveSession).toHaveBeenCalledTimes(1)
  })

  it('routes to chat when an external session activation targets this renderer', async () => {
    const { store, pageRouter, emitIpc, SESSION_EVENTS } = await setupStore()

    emitIpc(SESSION_EVENTS.ACTIVATED, {
      webContentsId: 1,
      sessionId: 'session-external'
    })

    expect(store.activeSessionId.value).toBe('session-external')
    expect(pageRouter.goToChat).toHaveBeenCalledWith('session-external')
  })
})
