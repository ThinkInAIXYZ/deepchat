import { flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const setupStore = async (options?: {
  hasActiveSession?: boolean
  historyHits?: Array<Record<string, unknown>>
}) => {
  vi.resetModules()

  const agentSessionPresenter = {
    searchHistory: vi.fn().mockResolvedValue(options?.historyHits ?? [])
  }
  const windowPresenter = {
    createSettingsWindow: vi.fn().mockResolvedValue(9),
    sendToWindow: vi.fn(),
    openOrFocusSettingsWindow: vi.fn()
  }
  const providerStore = reactive({
    sortedProviders: [
      {
        id: 'openai',
        name: 'OpenAI',
        apiType: 'openai',
        baseUrl: 'https://api.openai.com/v1'
      },
      {
        id: 'acp',
        name: 'ACP',
        apiType: 'acp',
        baseUrl: 'https://acp.example.com'
      }
    ]
  })
  const sessionStore = reactive({
    sessions: [],
    hasActiveSession: options?.hasActiveSession ?? false,
    closeSession: vi.fn().mockResolvedValue(undefined),
    selectSession: vi.fn()
  })
  const agentStore = reactive({
    enabledAgents: [],
    setSelectedAgent: vi.fn()
  })
  const pageRouterStore = reactive({
    goToNewThread: vi.fn()
  })

  vi.doMock('pinia', () => ({
    defineStore: (_id: string, setup: () => unknown) => setup
  }))

  vi.doMock('@vueuse/core', () => ({
    useDebounceFn: (fn: (...args: unknown[]) => unknown) => fn
  }))

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => {
      if (name === 'agentSessionPresenter') {
        return agentSessionPresenter
      }

      if (name === 'windowPresenter') {
        return windowPresenter
      }

      return {}
    }
  }))

  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))

  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))

  vi.doMock('@/stores/ui/pageRouter', () => ({
    usePageRouterStore: () => pageRouterStore
  }))

  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
  }))

  vi.doMock('@shared/settingsNavigation', () => ({
    SETTINGS_NAVIGATION_ITEMS: []
  }))

  const { useSpotlightStore } = await import('@/stores/ui/spotlight')
  const store = useSpotlightStore()

  return {
    store,
    providerStore,
    sessionStore,
    pageRouterStore,
    windowPresenter
  }
}

describe('spotlightStore new-chat action', () => {
  it('bumps the activation key each time spotlight is opened', async () => {
    const { store } = await setupStore()

    expect(store.activationKey.value).toBe(0)

    store.openSpotlight()
    expect(store.open.value).toBe(true)
    expect(store.activationKey.value).toBe(1)

    store.openSpotlight()
    expect(store.activationKey.value).toBe(2)
  })

  it('refreshes the new thread page when no session is active', async () => {
    const { store, sessionStore, pageRouterStore } = await setupStore({
      hasActiveSession: false
    })

    await store.executeItem({
      id: 'action:new-chat',
      kind: 'action',
      icon: 'lucide:square-pen',
      actionId: 'new-chat',
      titleKey: 'common.newChat',
      score: 1
    })

    expect(sessionStore.closeSession).not.toHaveBeenCalled()
    expect(pageRouterStore.goToNewThread).toHaveBeenCalledWith({ refresh: true })
  })

  it('closes the active session before opening a new chat', async () => {
    const { store, sessionStore, pageRouterStore } = await setupStore({
      hasActiveSession: true
    })

    await store.executeItem({
      id: 'action:new-chat',
      kind: 'action',
      icon: 'lucide:square-pen',
      actionId: 'new-chat',
      titleKey: 'common.newChat',
      score: 1
    })

    expect(sessionStore.closeSession).toHaveBeenCalledTimes(1)
    expect(pageRouterStore.goToNewThread).not.toHaveBeenCalled()
  })

  it('returns provider-level results for provider queries', async () => {
    const { store } = await setupStore()

    store.setOpen(true)
    store.setQuery('openai')
    await flushPromises()

    expect(store.results.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'setting:provider:openai',
          routeName: 'settings-provider',
          routeParams: {
            providerId: 'openai'
          },
          title: 'OpenAI'
        })
      ])
    )
    expect(store.results.value).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'setting:provider:acp'
        })
      ])
    )
  })

  it('searches sessions only and excludes message hits', async () => {
    const { store } = await setupStore({
      historyHits: [
        {
          kind: 'session',
          sessionId: 'session-1',
          title: 'OpenAI setup',
          projectDir: '/tmp/demo',
          updatedAt: 10
        },
        {
          kind: 'message',
          sessionId: 'session-1',
          messageId: 'message-1',
          title: 'OpenAI key snippet',
          snippet: 'Here is the message content',
          updatedAt: 20
        }
      ]
    })

    store.setOpen(true)
    store.setQuery('openai')
    await flushPromises()

    expect(store.results.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'session:session-1',
          kind: 'session',
          title: 'OpenAI setup'
        })
      ])
    )
    expect(store.results.value).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'message'
        })
      ])
    )
  })

  it('reuses settings-provider route params when opening a provider result', async () => {
    const { store, windowPresenter } = await setupStore()

    await store.executeItem({
      id: 'setting:provider:openai',
      kind: 'setting',
      icon: 'lucide:cloud-cog',
      title: 'OpenAI',
      routeName: 'settings-provider',
      routeParams: {
        providerId: 'openai'
      },
      score: 320
    })

    expect(windowPresenter.createSettingsWindow).toHaveBeenCalledTimes(1)
    expect(windowPresenter.createSettingsWindow).toHaveBeenCalledWith({
      routeName: 'settings-provider',
      params: {
        providerId: 'openai'
      }
    })
    expect(windowPresenter.sendToWindow).not.toHaveBeenCalled()
  })

  it('reruns an active query when provider matches change', async () => {
    const { store, providerStore } = await setupStore()

    providerStore.sortedProviders = [
      {
        id: 'acp',
        name: 'ACP',
        apiType: 'acp',
        baseUrl: 'https://acp.example.com'
      }
    ]

    store.setOpen(true)
    store.setQuery('openai')
    await flushPromises()

    expect(store.results.value).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'setting:provider:openai'
        })
      ])
    )

    providerStore.sortedProviders = [
      ...providerStore.sortedProviders,
      {
        id: 'openai',
        name: 'OpenAI',
        apiType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        enable: false
      }
    ]

    await flushPromises()
    await flushPromises()

    expect(store.results.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'setting:provider:openai',
          routeParams: {
            providerId: 'openai'
          }
        })
      ])
    )
  })
})
