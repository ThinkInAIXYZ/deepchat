import { mount, flushPromises } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GUIDED_ONBOARDING_RESUME_REQUESTED_EVENT,
  GUIDED_ONBOARDING_RESUME_STORAGE_KEY
} from '@/lib/onboardingResume'

const DEV_WELCOME_OVERRIDE_KEY = '__deepchat_dev_force_welcome'

const mountApp = async (options?: {
  initComplete?: boolean
  routeName?: 'chat' | 'welcome'
  hasActiveSession?: boolean
  pageRouteName?: 'newThread' | 'chat'
  chatSessionId?: string | null
  onboardingStatus?: 'idle' | 'active' | 'completed'
  onboardingCurrentStepId?:
    | 'provider'
    | 'first-chat'
    | 'switch-model'
    | 'mcp'
    | 'skills'
    | 'plugins'
    | null
}) => {
  vi.resetModules()

  const initComplete = options?.initComplete ?? false
  const routeName = options?.routeName ?? 'chat'
  const hasActiveSession = options?.hasActiveSession ?? false
  const pageRouteName = options?.pageRouteName ?? 'chat'
  const chatSessionId = options?.chatSessionId ?? (pageRouteName === 'chat' ? 'session-1' : null)
  const onboardingStatus = options?.onboardingStatus ?? 'idle'
  const onboardingCurrentStepId = options?.onboardingCurrentStepId ?? null
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
  const onboardingClient = {
    getState: vi.fn().mockResolvedValue({
      version: 1,
      status: onboardingStatus,
      startedAt: onboardingStatus === 'idle' ? null : 1,
      completedAt: onboardingStatus === 'completed' ? 5 : null,
      lastActiveAt: 1,
      currentStepId: onboardingCurrentStepId,
      steps: [
        {
          id: 'provider',
          required: true,
          status:
            onboardingStatus === 'completed'
              ? 'completed'
              : onboardingCurrentStepId === 'provider'
                ? 'in_progress'
                : 'pending',
          startedAt: onboardingCurrentStepId === 'provider' ? 1 : null,
          completedAt: onboardingStatus === 'completed' ? 2 : null,
          skippedAt: null
        },
        {
          id: 'first-chat',
          required: true,
          status:
            onboardingStatus === 'completed'
              ? 'completed'
              : onboardingCurrentStepId === 'first-chat'
                ? 'in_progress'
                : 'pending',
          startedAt: onboardingCurrentStepId === 'first-chat' ? 1 : null,
          completedAt: onboardingStatus === 'completed' ? 3 : null,
          skippedAt: null
        },
        {
          id: 'switch-model',
          required: true,
          status:
            onboardingStatus === 'completed'
              ? 'completed'
              : onboardingCurrentStepId === 'switch-model'
                ? 'in_progress'
                : 'pending',
          startedAt: onboardingCurrentStepId === 'switch-model' ? 1 : null,
          completedAt: onboardingStatus === 'completed' ? 4 : null,
          skippedAt: null
        },
        {
          id: 'mcp',
          required: false,
          status:
            onboardingStatus === 'completed'
              ? 'skipped'
              : onboardingCurrentStepId === 'mcp'
                ? 'in_progress'
                : 'pending',
          startedAt: onboardingCurrentStepId === 'mcp' ? 1 : null,
          completedAt: null,
          skippedAt: onboardingStatus === 'completed' ? 5 : null
        },
        {
          id: 'skills',
          required: false,
          status:
            onboardingStatus === 'completed'
              ? 'skipped'
              : onboardingCurrentStepId === 'skills'
                ? 'in_progress'
                : 'pending',
          startedAt: onboardingCurrentStepId === 'skills' ? 1 : null,
          completedAt: null,
          skippedAt: onboardingStatus === 'completed' ? 5 : null
        },
        {
          id: 'plugins',
          required: false,
          status:
            onboardingStatus === 'completed'
              ? 'skipped'
              : onboardingCurrentStepId === 'plugins'
                ? 'in_progress'
                : 'pending',
          startedAt: onboardingCurrentStepId === 'plugins' ? 1 : null,
          completedAt: null,
          skippedAt: onboardingStatus === 'completed' ? 5 : null
        }
      ]
    }),
    start: vi.fn().mockResolvedValue({
      version: 1,
      status: 'active',
      startedAt: 1,
      completedAt: null,
      lastActiveAt: 1,
      currentStepId: 'provider',
      steps: [
        {
          id: 'provider',
          required: true,
          status: 'in_progress',
          startedAt: 1,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'first-chat',
          required: true,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'switch-model',
          required: true,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'mcp',
          required: false,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'skills',
          required: false,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'plugins',
          required: false,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        }
      ]
    })
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
    selectSession: vi.fn(),
    fetchSessions: vi.fn().mockResolvedValue(undefined)
  }
  const providerStore = {
    ensureInitialized: vi.fn().mockResolvedValue(undefined)
  }
  const modelStore = {
    initialize: vi.fn().mockResolvedValue(undefined)
  }
  const toast = vi.fn(() => ({ dismiss: vi.fn() }))
  const ipcOn = vi.fn(() => vi.fn())
  const ipcRemoveAllListeners = vi.fn()

  ;(window as any).electron = {
    ipcRenderer: {
      on: ipcOn,
      removeAllListeners: ipcRemoveAllListeners,
      send: vi.fn()
    }
  }
  ;(window as any).deepchat = {
    invoke: vi.fn((routeName: string) => {
      switch (routeName) {
        case 'config.getEntries':
          return Promise.resolve({ version: 0, values: {} })
        case 'models.getProviderCatalog':
          return Promise.resolve({
            catalog: {
              providerModels: [],
              customModels: [],
              dbProviderModels: [],
              modelStatusMap: {}
            }
          })
        case 'models.getCapabilities':
          return Promise.resolve({
            capabilities: {
              supportsReasoning: null,
              reasoningPortrait: null,
              thinkingBudgetRange: null,
              supportsSearch: null,
              searchDefaults: null,
              supportsTemperatureControl: true,
              temperatureCapability: true
            }
          })
        case 'models.getConfig':
          return Promise.resolve({
            config: {
              maxTokens: 4096,
              contextLength: 16000,
              temperature: 0.7,
              vision: false,
              functionCall: true,
              reasoning: false,
              type: 'chat'
            }
          })
        default:
          return Promise.resolve({})
      }
    }),
    on: ipcOn
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

  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: vi.fn(() => configPresenter)
  }))
  vi.doMock('@api/OnboardingClient', () => ({
    createOnboardingClient: vi.fn(() => onboardingClient)
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
  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
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
        SpotlightOverlay: true,
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
    onboardingClient,
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
  window.sessionStorage.removeItem(GUIDED_ONBOARDING_RESUME_STORAGE_KEY)
})

describe('App startup welcome flow', () => {
  it('routes to welcome when init is incomplete', async () => {
    const { router, configPresenter, onboardingClient } = await mountApp({
      initComplete: false,
      routeName: 'chat'
    })

    expect(configPresenter.getSetting).toHaveBeenCalledWith('init_complete')
    expect(onboardingClient.getState).toHaveBeenCalledTimes(1)
    expect(onboardingClient.start).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith({ name: 'welcome' })
  }, 10000)

  it('redirects welcome back to chat when init is complete', async () => {
    const { router, configPresenter, onboardingClient, route } = await mountApp({
      initComplete: true,
      routeName: 'welcome',
      onboardingStatus: 'idle'
    })

    expect(configPresenter.getSetting).toHaveBeenCalledWith('init_complete')
    expect(onboardingClient.start).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith({ name: 'chat' })
    expect(route.name).toBe('chat')
  })

  it('routes to welcome when onboarding is already active', async () => {
    const { router, onboardingClient, route } = await mountApp({
      initComplete: true,
      routeName: 'chat',
      onboardingStatus: 'active',
      onboardingCurrentStepId: 'first-chat'
    })

    expect(onboardingClient.getState).toHaveBeenCalledTimes(1)
    expect(onboardingClient.start).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith({ name: 'welcome' })
    expect(route.name).toBe('welcome')
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

  it('starts guided onboarding and routes to welcome from the dev event', async () => {
    const { ipcOn, onboardingClient, route } = await mountApp({
      initComplete: true,
      routeName: 'chat',
      onboardingStatus: 'completed'
    })

    const devGuideHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === 'appRuntime.guidedOnboardingStartRequested'
    )?.[1]

    expect(devGuideHandler).toBeTypeOf('function')

    await devGuideHandler?.({})
    await flushPromises()

    expect(onboardingClient.start).toHaveBeenCalledWith({
      force: true,
      stepId: 'select-provider'
    })
    expect(route.name).toBe('welcome')
  })

  it('returns to welcome when the main window refocuses with a pending onboarding resume', async () => {
    window.sessionStorage.setItem(
      GUIDED_ONBOARDING_RESUME_STORAGE_KEY,
      JSON.stringify({
        stepId: 'select-provider',
        trigger: 'window-focus',
        createdAt: Date.now()
      })
    )

    const { ipcOn, onboardingClient, route } = await mountApp({
      initComplete: true,
      routeName: 'chat',
      onboardingStatus: 'idle'
    })

    onboardingClient.getState.mockResolvedValue({
      version: 4,
      status: 'active',
      startedAt: 1,
      completedAt: null,
      lastActiveAt: 1,
      currentStepId: 'select-provider',
      steps: [
        {
          id: 'select-provider',
          required: true,
          status: 'in_progress',
          startedAt: 1,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'provider-api-key',
          required: false,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'provider-model',
          required: false,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'mcp',
          required: false,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'skills',
          required: false,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'switch-agent',
          required: true,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'switch-model',
          required: true,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'first-chat',
          required: true,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        }
      ]
    })

    const focusHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === 'appRuntime.windowFocused'
    )?.[1]

    expect(focusHandler).toBeTypeOf('function')

    await focusHandler?.({})
    await flushPromises()

    expect(route.name).toBe('welcome')
    expect(window.sessionStorage.getItem(GUIDED_ONBOARDING_RESUME_STORAGE_KEY)).toBeNull()
  })

  it('returns to chat when a completed onboarding step resumes the chat phase', async () => {
    window.sessionStorage.setItem(
      GUIDED_ONBOARDING_RESUME_STORAGE_KEY,
      JSON.stringify({
        stepId: 'first-chat',
        trigger: 'step-completed',
        createdAt: Date.now()
      })
    )

    const { onboardingClient, route } = await mountApp({
      initComplete: true,
      routeName: 'chat',
      onboardingStatus: 'idle'
    })

    onboardingClient.getState.mockResolvedValue({
      version: 1,
      status: 'active',
      startedAt: 1,
      completedAt: null,
      lastActiveAt: 2,
      currentStepId: 'switch-model',
      steps: [
        {
          id: 'provider',
          required: true,
          status: 'completed',
          startedAt: 1,
          completedAt: 2,
          skippedAt: null
        },
        {
          id: 'first-chat',
          required: true,
          status: 'completed',
          startedAt: 2,
          completedAt: 3,
          skippedAt: null
        },
        {
          id: 'switch-model',
          required: true,
          status: 'in_progress',
          startedAt: 3,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'mcp',
          required: false,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'skills',
          required: false,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'plugins',
          required: false,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        }
      ]
    })

    window.dispatchEvent(
      new CustomEvent(GUIDED_ONBOARDING_RESUME_REQUESTED_EVENT, {
        detail: { trigger: 'step-completed' }
      })
    )
    await flushPromises()

    expect(route.name).toBe('chat')
    expect(window.sessionStorage.getItem(GUIDED_ONBOARDING_RESUME_STORAGE_KEY)).toBeNull()
  })

  it('stores start deeplink payload and routes to a new deepchat thread', async () => {
    const { draftStore, pageRouterStore, agentStore, sessionStore, ipcOn } = await mountApp({
      initComplete: true,
      routeName: 'chat',
      hasActiveSession: true
    })

    const startHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === 'appRuntime.startDeeplinkRequested'
    )?.[1]

    expect(startHandler).toBeTypeOf('function')

    await startHandler?.({
      msg: '你好，DeepChat',
      modelId: 'deepseek-chat',
      systemPrompt: 'Be concise',
      mentions: ['README.md'],
      autoSend: false
    })
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
      ([eventName]: [string]) => eventName === 'appRuntime.shortcutRequested'
    )?.[1]

    expect(shortcutHandler).toBeTypeOf('function')

    shortcutHandler?.({ action: 'toggleSpotlight' })

    expect(spotlightStore.openSpotlight).toHaveBeenCalledTimes(1)
    expect(spotlightStore.toggleSpotlight).not.toHaveBeenCalled()
  })

  it('toggles the sidebar from the global shortcut event', async () => {
    const { ipcOn, sidebarStore } = await mountApp({
      initComplete: true,
      routeName: 'chat'
    })

    const shortcutHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === 'appRuntime.shortcutRequested'
    )?.[1]

    expect(shortcutHandler).toBeTypeOf('function')

    shortcutHandler?.({ action: 'toggleSidebar' })

    expect(sidebarStore.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('delegates the create-new-conversation shortcut to the unified session action', async () => {
    const { ipcOn, sessionStore } = await mountApp({
      initComplete: true,
      routeName: 'chat'
    })

    const shortcutHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === 'appRuntime.shortcutRequested'
    )?.[1]

    expect(shortcutHandler).toBeTypeOf('function')

    await shortcutHandler?.({ action: 'createNewConversation' })

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
      ([eventName]: [string]) => eventName === 'appRuntime.shortcutRequested'
    )?.[1]

    expect(shortcutHandler).toBeTypeOf('function')

    shortcutHandler?.({ action: 'toggleWorkspace' })

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
      ([eventName]: [string]) => eventName === 'appRuntime.shortcutRequested'
    )?.[1]

    expect(shortcutHandler).toBeTypeOf('function')

    shortcutHandler?.({ action: 'toggleWorkspace' })

    expect(sidepanelStore.toggleWorkspace).not.toHaveBeenCalled()
  })
})
