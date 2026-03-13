import { mount, flushPromises } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const DEV_WELCOME_OVERRIDE_KEY = '__deepchat_dev_force_welcome'

const mountApp = async (options?: { initComplete?: boolean; routeName?: 'chat' | 'welcome' }) => {
  vi.resetModules()

  const initComplete = options?.initComplete ?? false
  const routeName = options?.routeName ?? 'chat'
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
    goToNewThread: vi.fn()
  }
  const toast = vi.fn(() => ({ dismiss: vi.fn() }))

  ;(window as any).electron = {
    ipcRenderer: {
      on: vi.fn(),
      removeAllListeners: vi.fn(),
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
    useSessionStore: () => ({
      hasActiveSession: false,
      activeSessionId: null,
      closeSession: vi.fn(),
      selectSession: vi.fn()
    })
  }))
  vi.doMock('@/stores/ui/pageRouter', () => ({
    usePageRouterStore: () => pageRouterStore
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
    configPresenter
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
  })

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
})
