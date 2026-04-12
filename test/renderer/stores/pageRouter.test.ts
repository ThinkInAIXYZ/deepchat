import { describe, expect, it, vi } from 'vitest'

const setupStore = async (options?: { activeAgentSession?: { id: string } | null }) => {
  vi.resetModules()
  const agentSessionPresenter = {
    getActiveSession: vi.fn().mockResolvedValue(options?.activeAgentSession ?? null)
  }

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: () => unknown) => setup
    }
  })

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => {
      if (name === 'agentSessionPresenter') return agentSessionPresenter
      return {}
    }
  }))
  ;(window as any).electron = {
    ipcRenderer: {
      on: vi.fn(),
      removeListener: vi.fn()
    }
  }
  ;(window as any).api = {
    getWebContentsId: vi.fn(() => 1)
  }

  const { usePageRouterStore } = await import('@/stores/ui/pageRouter')
  const store = usePageRouterStore()

  return {
    store,
    agentSessionPresenter
  }
}

describe('pageRouter.initialize', () => {
  it('uses the active agent session when it exists', async () => {
    const { store, agentSessionPresenter } = await setupStore({
      activeAgentSession: { id: 'new-session-1' }
    })

    await store.initialize()

    expect(agentSessionPresenter.getActiveSession).toHaveBeenCalledWith(1)
    expect(store.route.value).toEqual({ name: 'chat', sessionId: 'new-session-1' })
  })

  it('defaults to new thread when no active agent session exists', async () => {
    const { store, agentSessionPresenter } = await setupStore({
      activeAgentSession: null
    })

    await store.initialize()

    expect(agentSessionPresenter.getActiveSession).toHaveBeenCalledWith(1)
    expect(store.route.value).toEqual({ name: 'newThread' })
  })

  it('allows manually going to new thread', async () => {
    const { store } = await setupStore({
      activeAgentSession: null
    })
    store.goToNewThread()

    expect(store.route.value).toEqual({ name: 'newThread' })
  })

  it('can force-refresh the new thread view', async () => {
    const { store } = await setupStore({
      activeAgentSession: null
    })

    expect(store.newThreadRefreshKey.value).toBe(0)

    store.goToNewThread({ refresh: true })
    store.goToNewThread({ refresh: true })

    expect(store.route.value).toEqual({ name: 'newThread' })
    expect(store.newThreadRefreshKey.value).toBe(2)
  })

  it('falls back to new thread when active session lookup fails', async () => {
    vi.resetModules()

    const agentSessionPresenter = {
      getActiveSession: vi.fn().mockRejectedValue(new Error('boom'))
    }

    vi.doMock('pinia', async () => {
      const actual = await vi.importActual<typeof import('pinia')>('pinia')
      return {
        ...actual,
        defineStore: (_id: string, setup: () => unknown) => setup
      }
    })

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'agentSessionPresenter') return agentSessionPresenter
        return {}
      }
    }))
    ;(window as any).electron = {
      ipcRenderer: {
        on: vi.fn(),
        removeListener: vi.fn()
      }
    }
    ;(window as any).api = {
      getWebContentsId: vi.fn(() => 1)
    }

    const { usePageRouterStore } = await import('@/stores/ui/pageRouter')
    const store = usePageRouterStore()

    await store.initialize()

    expect(store.route.value).toEqual({ name: 'newThread' })
    expect(store.error.value).toContain('boom')
  })
})
