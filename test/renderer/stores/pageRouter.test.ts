import { describe, expect, it, vi } from 'vitest'

const setupStore = async (options?: { activeNewSession?: { id: string } | null }) => {
  vi.resetModules()
  const newAgentPresenter = {
    getActiveSession: vi.fn().mockResolvedValue(options?.activeNewSession ?? null)
  }

  vi.doMock('pinia', () => ({
    defineStore: (_id: string, setup: () => unknown) => setup
  }))

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => {
      if (name === 'newAgentPresenter') return newAgentPresenter
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
    newAgentPresenter
  }
}

describe('pageRouter.initialize', () => {
  it('uses the active new-agent session when it exists', async () => {
    const { store, newAgentPresenter } = await setupStore({
      activeNewSession: { id: 'new-session-1' }
    })

    await store.initialize()

    expect(newAgentPresenter.getActiveSession).toHaveBeenCalledWith(1)
    expect(store.route.value).toEqual({ name: 'chat', sessionId: 'new-session-1' })
  })

  it('defaults to new thread when no new-agent active session exists', async () => {
    const { store, newAgentPresenter } = await setupStore({
      activeNewSession: null
    })

    await store.initialize()

    expect(newAgentPresenter.getActiveSession).toHaveBeenCalledWith(1)
    expect(store.route.value).toEqual({ name: 'newThread' })
  })

  it('allows manually going to new thread', async () => {
    const { store } = await setupStore({
      activeNewSession: null
    })
    store.goToNewThread()

    expect(store.route.value).toEqual({ name: 'newThread' })
  })

  it('falls back to new thread when active session lookup fails', async () => {
    vi.resetModules()

    const newAgentPresenter = {
      getActiveSession: vi.fn().mockRejectedValue(new Error('boom'))
    }

    vi.doMock('pinia', () => ({
      defineStore: (_id: string, setup: () => unknown) => setup
    }))

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'newAgentPresenter') return newAgentPresenter
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
