import { mount, flushPromises } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEEPLINK_EVENTS, SHORTCUT_EVENTS } from '@/events'

const DEV_WELCOME_OVERRIDE_KEY = '__deepchat_dev_force_welcome'

const mountApp = async (options?: {
  initComplete?: boolean
  routeName?: 'chat' | 'welcome'
  hasActiveSession?: boolean
  pageRouteName?: 'newThread' | 'chat'
  chatSessionId?: string | null
}) => {
  vi.resetModules()

  const initComplete = options?.initComplete ?? false
  const routeName = options?.routeName ?? 'chat'
  const hasActiveSession = options?.hasActiveSession ?? false
  const pageRouteName = options?.pageRouteName ?? 'chat'
  const chatSessionId = options?.chatSessionId ?? (pageRouteName === 'chat' ? 'session-1' : null)
  const route = reactive({
    name: routeName,
    path: routeName === 'welcome' ? '/welcome' : '/chat',
    fullPath: routeName === 'welcome' ? '/welcome' : '/chat'
  })
  const currentRoute = ref(route)

  const setRoute = (name: 'chat' | 'welcome') => {
    route.name = name
    route.path = name === 'welcome' ? '/welcome' : '/chat'
    route.fullPath = route.path
    currentRoute.value = route
  }

  const router = {
    isReady: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockImplementation(async ({ name }: { name: 'chat' | 'welcome' }) => {
      setRoute(name)
    }),
    push: vi.fn().mockImplementation(async ({ name }: { name: string }) => {
      if (name === 'chat' || name === 'welcome') {
        setRoute(name)
      }
    }),
    currentRoute
  }

  const configPresenter = {
    getSetting: vi.fn().mockResolvedValue(initComplete)
  }
  const pageRouterStore = {
    currentRoute: pageRouteName,
    chatSessionId,
    goToNewThread: vi.fn()
  }
  const sidepanelStore = {
    toggleWorkspace: vi.fn()
  }
  const sidebarStore = {
    toggleSidebar: vi.fn()
  }
  const spotlightStore = {
    open: false,
    query: '',
    results: [] as unknown[],
    activeIndex: -1,
    loading: false,
    openSpotlight: vi.fn(),
    closeSpotlight: vi.fn(),
    setQuery: vi.fn(),
    setActiveItem: vi.fn(),
    moveActiveItem: vi.fn(),
    executeItem: vi.fn(),
    executeActiveItem: vi.fn(),
    toggleSpotlight: vi.fn()
  }
  const agentStore = {
    setSelectedAgent: vi.fn()
  }
  const draftStore = reactive({
    pendingStartDeeplink: null as null | Record<string, unknown>,
    setPendingStartDeeplink: vi.fn((payload: Record<string, unknown>) => {
      draftStore.pendingStartDeeplink = {
        ...payload,
        token: 1
      }
    })
  })
  const sessionStore = {
    hasActiveSession,
    activeSessionId: hasActiveSession ? 'session-1' : null,
    startNewConversation: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    selectSession: vi.fn()
  }
  const toast = vi.fn(() => ({ dismiss: vi.fn() }))
  const ipcOn = vi.fn()
  const ipcRemoveAllListeners = vi.fn()

  ;(window as any).electron = {
    ipcRenderer: {
      on: ipcOn,
      removeAllListeners: ipcRemoveAllListeners,
      send: vi.fn()
    }
  }

  vi.doMock('vue-router', async () => {
    const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
    return {
      ...actual,
      useRoute: () => route,
      useRouter: () => router
    }
  })

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => {
      if (name === 'configPresenter') return configPresenter
      return {}
    }
  }))
  vi.doMock('@/stores/artifact', () => ({
    useArtifactStore: () => ({
      hideArtifact: vi.fn()
    })
  }))
  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))
  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))
  vi.doMock('@/stores/ui/draft', () => ({
    useDraftStore: () => draftStore
  }))
  vi.doMock('@/stores/ui/pageRouter', () => ({
    usePageRouterStore: () => pageRouterStore
  }))
  vi.doMock('@/stores/ui/sidepanel', () => ({
    useSidepanelStore: () => sidepanelStore
  }))
  vi.doMock('@/stores/ui/sidebar', () => ({
    useSidebarStore: () => sidebarStore
  }))
  vi.doMock('@/stores/ui/spotlight', () => ({
    useSpotlightStore: () => spotlightStore
  }))
  vi.doMock('@/components/use-toast', () => ({
    useToast: () => ({
      toast
    })
  }))
  vi.doMock('@/stores/uiSettingsStore', () => ({
    useUiSettingsStore: () => ({
      fontSizeClass: 'text-base',
      fontSizeLevel: 1,
      updateFontSizeLevel: vi.fn()
    })
  }))
  vi.doMock('@/stores/theme', () => ({
    useThemeStore: () => ({
      themeMode: 'light',
      isDark: false
    })
  }))
  vi.doMock('@/stores/language', () => ({
    useLanguageStore: () => ({
      dir: 'ltr'
    })
  }))
  vi.doMock('@/stores/modelCheck', () => ({
    useModelCheckStore: () => ({
      isDialogOpen: false,
      currentProviderId: null,
      closeDialog: vi.fn()
    })
  }))
  vi.doMock('@/lib/storeInitializer', () => ({
    initAppStores: vi.fn(),
    useMcpInstallDeeplinkHandler: () => ({
      setup: vi.fn(),
      cleanup: vi.fn()
    })
  }))
  vi.doMock('@/composables/useFontManager', () => ({
    useFontManager: () => ({
      setupFontListener: vi.fn()
    })
  }))
  vi.doMock('@/composables/useDeviceVersion', () => ({
    useDeviceVersion: () => ({
      isWinMacOS: false
    })
  }))

  const App = (await import('@/App.vue')).default

  mount(App, {
    global: {
      stubs: {
        RouterView: true,
        AppBar: true,
        WindowSideBar: true,
        UpdateDialog: true,
        MessageDialog: true,
        McpSamplingDialog: true,
        SelectedTextContextMenu: true,
        TranslatePopup: true,
        ModelCheckDialog: {
          template: '<div />',
          props: ['open', 'providerId']
        },
        Toaster: true
      }
    }
  })

  await flushPromises()

  return {
    route,
    router,
    configPresenter,
    pageRouterStore,
    sidepanelStore,
    sidebarStore,
    agentStore,
    draftStore,
    sessionStore,
    ipcOn,
    spotlightStore
  }
}

afterEach(() => {
  window.sessionStorage.removeItem(DEV_WELCOME_OVERRIDE_KEY)
})

describe('App startup welcome flow', () => {
  it('routes to welcome when init is incomplete', async () => {
    const { router, configPresenter } = await mountApp({
      initComplete: false,
      routeName: 'chat'
    })

    expect(configPresenter.getSetting).toHaveBeenCalledWith('init_complete')
    expect(router.replace).toHaveBeenCalledWith({ name: 'welcome' })
  }, 10000)

  it('redirects welcome back to chat when init is complete', async () => {
    const { router, configPresenter, route } = await mountApp({
      initComplete: true,
      routeName: 'welcome'
    })

    expect(configPresenter.getSetting).toHaveBeenCalledWith('init_complete')
    expect(router.replace).toHaveBeenCalledWith({ name: 'chat' })
    expect(route.name).toBe('chat')
  })

  it('keeps welcome when dev override is enabled', async () => {
    window.sessionStorage.setItem(DEV_WELCOME_OVERRIDE_KEY, '1')

    const { router, route } = await mountApp({
      initComplete: true,
      routeName: 'chat'
    })

    expect(router.replace).toHaveBeenCalledWith({ name: 'welcome' })
    expect(route.name).toBe('welcome')
  })

  it('stores start deeplink payload and routes to a new deepchat thread', async () => {
    const { draftStore, pageRouterStore, agentStore, sessionStore, ipcOn } = await mountApp({
      initComplete: true,
      routeName: 'chat',
      hasActiveSession: true
    })

    const startHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === DEEPLINK_EVENTS.START
    )?.[1]

    expect(startHandler).toBeTypeOf('function')

    await startHandler?.(
      {},
      {
        msg: '你好，DeepChat',
        modelId: 'deepseek-chat',
        systemPrompt: 'Be concise',
        mentions: ['README.md'],
        autoSend: false
      }
    )
    await flushPromises()

    expect(draftStore.setPendingStartDeeplink).toHaveBeenCalledWith({
      msg: '你好，DeepChat',
      modelId: 'deepseek-chat',
      systemPrompt: 'Be concise',
      mentions: ['README.md'],
      autoSend: false
    })
    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('deepchat')
    expect(sessionStore.closeSession).toHaveBeenCalledTimes(1)
    expect(pageRouterStore.goToNewThread).not.toHaveBeenCalled()
  })

  it('opens spotlight from the global shortcut event', async () => {
    const { ipcOn, spotlightStore } = await mountApp({
      initComplete: true,
      routeName: 'chat'
    })

    const shortcutHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === SHORTCUT_EVENTS.TOGGLE_SPOTLIGHT
    )?.[1]

    expect(shortcutHandler).toBeTypeOf('function')

    shortcutHandler?.()

    expect(spotlightStore.openSpotlight).toHaveBeenCalledTimes(1)
    expect(spotlightStore.toggleSpotlight).not.toHaveBeenCalled()
  })

  it('toggles the sidebar from the global shortcut event', async () => {
    const { ipcOn, sidebarStore } = await mountApp({
      initComplete: true,
      routeName: 'chat'
    })

    const shortcutHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === SHORTCUT_EVENTS.TOGGLE_SIDEBAR
    )?.[1]

    expect(shortcutHandler).toBeTypeOf('function')

    shortcutHandler?.()

    expect(sidebarStore.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('delegates the create-new-conversation shortcut to the unified session action', async () => {
    const { ipcOn, sessionStore } = await mountApp({
      initComplete: true,
      routeName: 'chat'
    })

    const shortcutHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === SHORTCUT_EVENTS.CREATE_NEW_CONVERSATION
    )?.[1]

    expect(shortcutHandler).toBeTypeOf('function')

    await shortcutHandler?.()

    expect(sessionStore.startNewConversation).toHaveBeenCalledWith({ refresh: true })
  })

  it('toggles the workspace panel from the global shortcut event when a chat session is active', async () => {
    const { ipcOn, sidepanelStore } = await mountApp({
      initComplete: true,
      routeName: 'chat',
      pageRouteName: 'chat',
      chatSessionId: 'session-42'
    })

    const shortcutHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === SHORTCUT_EVENTS.TOGGLE_WORKSPACE
    )?.[1]

    expect(shortcutHandler).toBeTypeOf('function')

    shortcutHandler?.()

    expect(sidepanelStore.toggleWorkspace).toHaveBeenCalledWith('session-42')
  })

  it('ignores the workspace shortcut when no chat session is active', async () => {
    const { ipcOn, sidepanelStore } = await mountApp({
      initComplete: true,
      routeName: 'chat',
      pageRouteName: 'newThread',
      chatSessionId: null
    })

    const shortcutHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === SHORTCUT_EVENTS.TOGGLE_WORKSPACE
    )?.[1]

    expect(shortcutHandler).toBeTypeOf('function')

    shortcutHandler?.()

    expect(sidepanelStore.toggleWorkspace).not.toHaveBeenCalled()
  })
})
