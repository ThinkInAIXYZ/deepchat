import { describe, expect, it, vi } from 'vitest'

const setupStore = async (options?: {
  activeAgentSession?: { id: string } | null
  resolution?: Record<string, unknown> | null
}) => {
  vi.resetModules()
  const sessionClient = {
    getActive: vi.fn().mockResolvedValue({
      session: options?.activeAgentSession ?? null,
      resolution: options?.resolution
    })
  }

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: () => unknown) => setup
    }
  })

  vi.doMock('../../../src/renderer/api/SessionClient', () => ({
    createSessionClient: vi.fn(() => sessionClient)
  }))

  const { usePageRouterStore } = await import('@/stores/ui/pageRouter')
  const store = usePageRouterStore()

  return {
    store,
    sessionClient
  }
}

describe('pageRouter.initialize', () => {
  it('uses a seeded active session id without performing an IPC lookup', async () => {
    const { store, sessionClient } = await setupStore({
      activeAgentSession: { id: 'new-session-1' }
    })

    await store.initialize({ activeSessionId: 'seeded-session' })

    expect(sessionClient.getActive).not.toHaveBeenCalled()
    expect(store.route.value).toEqual({ name: 'chat', sessionId: 'seeded-session' })
  })

  it('clears stale errors when using a seeded active session id', async () => {
    const { store } = await setupStore({
      activeAgentSession: { id: 'new-session-1' }
    })

    store.error.value = 'previous error'

    await store.initialize({ activeSessionId: 'seeded-session' })

    expect(store.error.value).toBeNull()
    expect(store.route.value).toEqual({ name: 'chat', sessionId: 'seeded-session' })
  })

  it('uses the active agent session when it exists', async () => {
    const { store, sessionClient } = await setupStore({
      activeAgentSession: { id: 'new-session-1' }
    })

    await store.initialize()

    expect(sessionClient.getActive).toHaveBeenCalledTimes(1)
    expect(store.route.value).toEqual({ name: 'chat', sessionId: 'new-session-1' })
  })

  it('defaults to new thread when no active agent session exists', async () => {
    const { store, sessionClient } = await setupStore({
      activeAgentSession: null
    })

    await store.initialize()

    expect(sessionClient.getActive).toHaveBeenCalledTimes(1)
    expect(store.route.value).toEqual({ name: 'newThread' })
  })

  it.each(['unavailable', 'transient_error'] as const)(
    'keeps the bound route for a public %s result',
    async (availability) => {
      const { store } = await setupStore({
        activeAgentSession: null,
        resolution: {
          availability,
          sessionId: 'bound-session'
        }
      })

      await store.initialize()

      expect(store.route.value).toEqual({ name: 'chat', sessionId: 'bound-session' })
    }
  )

  it('opens a new thread for authoritative bound missing', async () => {
    const { store } = await setupStore({
      activeAgentSession: null,
      resolution: {
        availability: 'missing',
        sessionId: 'deleted-session'
      }
    })

    await store.initialize()

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

    const sessionClient = {
      getActive: vi.fn().mockRejectedValue(new Error('boom'))
    }

    vi.doMock('pinia', async () => {
      const actual = await vi.importActual<typeof import('pinia')>('pinia')
      return {
        ...actual,
        defineStore: (_id: string, setup: () => unknown) => setup
      }
    })

    vi.doMock('../../../src/renderer/api/SessionClient', () => ({
      createSessionClient: vi.fn(() => sessionClient)
    }))

    const { usePageRouterStore } = await import('@/stores/ui/pageRouter')
    const store = usePageRouterStore()

    await store.initialize()

    expect(store.route.value).toEqual({ name: 'newThread' })
    expect(store.error.value).toContain('boom')
  })
})
