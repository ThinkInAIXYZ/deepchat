import { describe, expect, it, vi } from 'vitest'

const setupStore = async (options?: {
  activeNewSession?: { id: string } | null
  activeLegacySession?: { sessionId: string } | null
}) => {
  vi.resetModules()

  const configPresenter = {
    getEnabledProviders: vi.fn().mockReturnValue(['openai'])
  }
  const newAgentPresenter = {
    getActiveSession: vi.fn().mockResolvedValue(options?.activeNewSession ?? null)
  }
  const sessionPresenter = {
    getActiveSession: vi.fn().mockResolvedValue(options?.activeLegacySession ?? null)
  }

  vi.doMock('pinia', () => ({
    defineStore: (_id: string, setup: () => unknown) => setup
  }))

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => {
      if (name === 'configPresenter') return configPresenter
      if (name === 'newAgentPresenter') return newAgentPresenter
      return sessionPresenter
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
  return { store, newAgentPresenter, sessionPresenter }
}

describe('pageRouter.initialize', () => {
  it('prefers new-agent active session over legacy presenter', async () => {
    const { store, newAgentPresenter, sessionPresenter } = await setupStore({
      activeNewSession: { id: 'new-session-1' },
      activeLegacySession: { sessionId: 'legacy-session-1' }
    })

    await store.initialize()

    expect(newAgentPresenter.getActiveSession).toHaveBeenCalledWith(1)
    expect(sessionPresenter.getActiveSession).not.toHaveBeenCalled()
    expect(store.route.value).toEqual({ name: 'chat', sessionId: 'new-session-1' })
  })

  it('defaults to new thread when no new-agent active session exists', async () => {
    const { store, sessionPresenter } = await setupStore({
      activeNewSession: null,
      activeLegacySession: { sessionId: 'legacy-session-2' }
    })

    await store.initialize()

    expect(sessionPresenter.getActiveSession).not.toHaveBeenCalled()
    expect(store.route.value).toEqual({ name: 'newThread' })
  })
})
