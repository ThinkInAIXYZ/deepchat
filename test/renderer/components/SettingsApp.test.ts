import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { DEEPLINK_EVENTS, SETTINGS_EVENTS } from '@/events'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Settings App', () => {
  it('notifies main when the settings router is ready', async () => {
    vi.resetModules()

    const push = vi.fn().mockResolvedValue(undefined)
    const isReady = vi.fn().mockResolvedValue(undefined)
    const ipcOn = vi.fn()
    const ipcRemoveListener = vi.fn()
    const ipcRemoveAllListeners = vi.fn()
    const ipcSend = vi.fn()

    ;(window as any).electron = {
      ipcRenderer: {
        on: ipcOn,
        removeListener: ipcRemoveListener,
        removeAllListeners: ipcRemoveAllListeners,
        send: ipcSend
      }
    }

    vi.doMock('vue-router', () => {
      const currentRoute = ref({ name: 'settings-common', query: {}, params: {}, path: '/common' })
      const router = {
        hasRoute: vi.fn(() => true),
        isReady,
        push,
        replace: vi.fn().mockResolvedValue(undefined),
        getRoutes: vi.fn(() => [
          {
            path: '/common',
            name: 'settings-common',
            meta: { titleKey: 'routes.settings-common', icon: 'lucide:bolt', position: 1 }
          }
        ]),
        currentRoute
      }

      return {
        useRouter: () => router,
        useRoute: () => currentRoute.value,
        RouterView: {
          name: 'RouterView',
          template: '<div />'
        }
      }
    })

    vi.doMock('../../../src/renderer/src/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'devicePresenter') {
          return {
            getDeviceInfo: vi.fn().mockResolvedValue({ platform: 'darwin' })
          }
        }
        if (name === 'windowPresenter') {
          return {
            closeSettingsWindow: vi.fn(),
            consumePendingSettingsProviderInstall: vi.fn().mockResolvedValue(null)
          }
        }
        if (name === 'configPresenter') {
          return {
            getLanguage: vi.fn().mockResolvedValue('zh-CN')
          }
        }
        return {}
      }
    }))
    vi.doMock('../../../src/renderer/src/stores/uiSettingsStore', () => ({
      useUiSettingsStore: () => ({
        fontSizeClass: 'text-base',
        loadSettings: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/language', () => ({
      useLanguageStore: () => ({
        language: 'zh-CN',
        dir: 'ltr'
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/modelCheck', () => ({
      useModelCheckStore: () => ({
        isDialogOpen: false,
        currentProviderId: null,
        closeDialog: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/theme', () => ({
      useThemeStore: () => ({
        themeMode: 'light',
        isDark: false
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/providerStore', () => ({
      useProviderStore: () => ({
        providers: [],
        initialize: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/providerDeeplinkImport', () => ({
      useProviderDeeplinkImportStore: () => ({
        preview: null,
        previewToken: 0,
        openPreview: vi.fn(),
        clearPreview: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/modelStore', () => ({
      useModelStore: () => ({
        initialize: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/ollamaStore', () => ({
      useOllamaStore: () => ({
        initialize: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/mcp', () => ({
      useMcpStore: () => ({
        mcpEnabled: false,
        setMcpEnabled: vi.fn().mockResolvedValue(undefined),
        setMcpInstallCache: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/lib/storeInitializer', () => ({
      useMcpInstallDeeplinkHandler: () => ({
        setup: vi.fn(),
        cleanup: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/composables/useFontManager', () => ({
      useFontManager: () => ({
        setupFontListener: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/composables/useDeviceVersion', () => ({
      useDeviceVersion: () => ({
        isMacOS: ref(false),
        isWinMacOS: true
      })
    }))
    vi.doMock('@vueuse/core', () => ({
      useTitle: () => ref('')
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key,
        locale: ref('zh-CN')
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({
        toast: vi.fn(() => ({ dismiss: vi.fn() }))
      })
    }))

    const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
    mount(SettingsApp, {
      global: {
        stubs: {
          Button: true,
          RouterView: true,
          CloseIcon: true,
          ModelCheckDialog: defineComponent({
            name: 'ModelCheckDialog',
            props: {
              open: { type: Boolean, default: false },
              providerId: { type: null, default: null }
            },
            template: '<div />'
          }),
          ProviderDeeplinkImportDialog: defineComponent({
            name: 'ProviderDeeplinkImportDialog',
            props: {
              open: { type: Boolean, default: false },
              preview: { type: null, default: null }
            },
            template: '<div />'
          }),
          Toaster: true,
          Icon: true
        }
      }
    })

    await flushPromises()

    expect(isReady).toHaveBeenCalledTimes(1)
    expect(ipcSend).toHaveBeenCalledWith(SETTINGS_EVENTS.READY)
  })

  it('navigates to the requested settings route when a navigate event arrives', async () => {
    vi.resetModules()

    const push = vi.fn().mockResolvedValue(undefined)
    const isReady = vi.fn().mockResolvedValue(undefined)
    const ipcOn = vi.fn()
    const ipcRemoveListener = vi.fn()
    const ipcRemoveAllListeners = vi.fn()
    const ipcSend = vi.fn()

    ;(window as any).electron = {
      ipcRenderer: {
        on: ipcOn,
        removeListener: ipcRemoveListener,
        removeAllListeners: ipcRemoveAllListeners,
        send: ipcSend
      }
    }

    vi.doMock('vue-router', () => {
      const currentRoute = ref({ name: 'settings-common', query: {}, params: {}, path: '/common' })
      const router = {
        hasRoute: vi.fn((routeName: string) => routeName === 'settings-deepchat-agents'),
        isReady,
        push,
        replace: vi.fn().mockResolvedValue(undefined),
        getRoutes: vi.fn(() => [
          {
            path: '/common',
            name: 'settings-common',
            meta: { titleKey: 'routes.settings-common', icon: 'lucide:bolt', position: 1 }
          },
          {
            path: '/deepchat-agents',
            name: 'settings-deepchat-agents',
            meta: {
              titleKey: 'routes.settings-deepchat-agents',
              icon: 'lucide:bot',
              position: 3.5
            }
          }
        ]),
        currentRoute
      }

      return {
        useRouter: () => router,
        useRoute: () => currentRoute.value,
        RouterView: {
          name: 'RouterView',
          template: '<div />'
        }
      }
    })

    vi.doMock('../../../src/renderer/src/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'devicePresenter') {
          return {
            getDeviceInfo: vi.fn().mockResolvedValue({ platform: 'darwin' })
          }
        }
        if (name === 'windowPresenter') {
          return {
            closeSettingsWindow: vi.fn(),
            consumePendingSettingsProviderInstall: vi.fn().mockResolvedValue(null)
          }
        }
        if (name === 'configPresenter') {
          return {
            getLanguage: vi.fn().mockResolvedValue('zh-CN')
          }
        }
        return {}
      }
    }))
    vi.doMock('../../../src/renderer/src/stores/uiSettingsStore', () => ({
      useUiSettingsStore: () => ({
        fontSizeClass: 'text-base',
        loadSettings: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/language', () => ({
      useLanguageStore: () => ({
        language: 'zh-CN',
        dir: 'ltr'
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/modelCheck', () => ({
      useModelCheckStore: () => ({
        isDialogOpen: false,
        currentProviderId: null,
        closeDialog: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/theme', () => ({
      useThemeStore: () => ({
        themeMode: 'light',
        isDark: false
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/providerStore', () => ({
      useProviderStore: () => ({
        providers: [],
        initialize: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/providerDeeplinkImport', () => ({
      useProviderDeeplinkImportStore: () => ({
        preview: null,
        previewToken: 0,
        openPreview: vi.fn(),
        clearPreview: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/modelStore', () => ({
      useModelStore: () => ({
        initialize: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/ollamaStore', () => ({
      useOllamaStore: () => ({
        initialize: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/mcp', () => ({
      useMcpStore: () => ({
        mcpEnabled: false,
        setMcpEnabled: vi.fn().mockResolvedValue(undefined),
        setMcpInstallCache: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/lib/storeInitializer', () => ({
      useMcpInstallDeeplinkHandler: () => ({
        setup: vi.fn(),
        cleanup: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/composables/useFontManager', () => ({
      useFontManager: () => ({
        setupFontListener: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/composables/useDeviceVersion', () => ({
      useDeviceVersion: () => ({
        isMacOS: ref(false),
        isWinMacOS: true
      })
    }))
    vi.doMock('@vueuse/core', () => ({
      useTitle: () => ref('')
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key,
        locale: ref('zh-CN')
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({
        toast: vi.fn(() => ({ dismiss: vi.fn() }))
      })
    }))

    const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
    mount(SettingsApp, {
      global: {
        stubs: {
          Button: true,
          RouterView: true,
          CloseIcon: true,
          ModelCheckDialog: defineComponent({
            name: 'ModelCheckDialog',
            props: {
              open: { type: Boolean, default: false },
              providerId: { type: null, default: null }
            },
            template: '<div />'
          }),
          ProviderDeeplinkImportDialog: defineComponent({
            name: 'ProviderDeeplinkImportDialog',
            props: {
              open: { type: Boolean, default: false },
              preview: { type: null, default: null }
            },
            template: '<div />'
          }),
          Toaster: true,
          Icon: true
        }
      }
    })

    await Promise.resolve()
    await Promise.resolve()

    const navigateHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === SETTINGS_EVENTS.NAVIGATE
    )?.[1]

    expect(navigateHandler).toBeTypeOf('function')

    await navigateHandler?.({}, { routeName: 'settings-deepchat-agents' })

    expect(push).toHaveBeenCalledWith({ name: 'settings-deepchat-agents' })
  })

  it('navigates to provider settings and stores provider deeplink previews', async () => {
    vi.resetModules()

    const push = vi.fn().mockResolvedValue(undefined)
    const isReady = vi.fn().mockResolvedValue(undefined)
    const ipcOn = vi.fn()
    const ipcRemoveListener = vi.fn()
    const ipcRemoveAllListeners = vi.fn()
    const ipcSend = vi.fn()
    let resolveProviderInitialize: (() => void) | null = null
    const providerInitializePromise = new Promise<void>((resolve) => {
      resolveProviderInitialize = resolve
    })
    const providerStore = {
      providers: [],
      initialize: vi.fn().mockReturnValue(providerInitializePromise)
    }
    const providerDeeplinkImportStore = {
      preview: null,
      previewToken: 0,
      openPreview: vi.fn(),
      clearPreview: vi.fn()
    }
    const consumePendingSettingsProviderInstall = vi.fn().mockResolvedValue(null)

    ;(window as any).electron = {
      ipcRenderer: {
        on: ipcOn,
        removeListener: ipcRemoveListener,
        removeAllListeners: ipcRemoveAllListeners,
        send: ipcSend
      }
    }

    vi.doMock('vue-router', () => {
      const currentRoute = ref({ name: 'settings-common', query: {}, params: {}, path: '/common' })
      const router = {
        hasRoute: vi.fn((routeName: string) => routeName === 'settings-provider'),
        isReady,
        push,
        replace: vi.fn().mockResolvedValue(undefined),
        getRoutes: vi.fn(() => [
          {
            path: '/common',
            name: 'settings-common',
            meta: { titleKey: 'routes.settings-common', icon: 'lucide:bolt', position: 1 }
          },
          {
            path: '/provider/:providerId?',
            name: 'settings-provider',
            meta: {
              titleKey: 'routes.settings-provider',
              icon: 'lucide:cloud-cog',
              position: 3
            }
          }
        ]),
        currentRoute
      }

      return {
        useRouter: () => router,
        useRoute: () => currentRoute.value,
        RouterView: {
          name: 'RouterView',
          template: '<div />'
        }
      }
    })

    vi.doMock('../../../src/renderer/src/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'devicePresenter') {
          return {
            getDeviceInfo: vi.fn().mockResolvedValue({ platform: 'darwin' })
          }
        }
        if (name === 'windowPresenter') {
          return {
            closeSettingsWindow: vi.fn(),
            consumePendingSettingsProviderInstall
          }
        }
        if (name === 'configPresenter') {
          return {
            getLanguage: vi.fn().mockResolvedValue('zh-CN')
          }
        }
        return {}
      }
    }))
    vi.doMock('../../../src/renderer/src/stores/uiSettingsStore', () => ({
      useUiSettingsStore: () => ({
        fontSizeClass: 'text-base',
        loadSettings: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/language', () => ({
      useLanguageStore: () => ({
        language: 'zh-CN',
        dir: 'ltr'
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/modelCheck', () => ({
      useModelCheckStore: () => ({
        isDialogOpen: false,
        currentProviderId: null,
        closeDialog: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/theme', () => ({
      useThemeStore: () => ({
        themeMode: 'light',
        isDark: false
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/providerStore', () => ({
      useProviderStore: () => providerStore
    }))
    vi.doMock('../../../src/renderer/src/stores/providerDeeplinkImport', () => ({
      useProviderDeeplinkImportStore: () => providerDeeplinkImportStore
    }))
    vi.doMock('../../../src/renderer/src/stores/modelStore', () => ({
      useModelStore: () => ({
        initialize: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/ollamaStore', () => ({
      useOllamaStore: () => ({
        initialize: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/mcp', () => ({
      useMcpStore: () => ({
        mcpEnabled: false,
        setMcpEnabled: vi.fn().mockResolvedValue(undefined),
        setMcpInstallCache: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/lib/storeInitializer', () => ({
      useMcpInstallDeeplinkHandler: () => ({
        setup: vi.fn(),
        cleanup: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/composables/useFontManager', () => ({
      useFontManager: () => ({
        setupFontListener: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/composables/useDeviceVersion', () => ({
      useDeviceVersion: () => ({
        isMacOS: ref(false),
        isWinMacOS: true
      })
    }))
    vi.doMock('@vueuse/core', () => ({
      useTitle: () => ref('')
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key,
        locale: ref('zh-CN')
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({
        toast: vi.fn(() => ({ dismiss: vi.fn() }))
      })
    }))

    const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
    mount(SettingsApp, {
      global: {
        stubs: {
          Button: true,
          RouterView: true,
          CloseIcon: true,
          ModelCheckDialog: defineComponent({
            name: 'ModelCheckDialog',
            props: {
              open: { type: Boolean, default: false },
              providerId: { type: null, default: null }
            },
            template: '<div />'
          }),
          ProviderDeeplinkImportDialog: defineComponent({
            name: 'ProviderDeeplinkImportDialog',
            props: {
              open: { type: Boolean, default: false },
              preview: { type: null, default: null }
            },
            template: '<div />'
          }),
          Toaster: true,
          Icon: true
        }
      }
    })

    await flushPromises()

    expect(providerStore.initialize).toHaveBeenCalledTimes(1)

    const installHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === SETTINGS_EVENTS.PROVIDER_INSTALL
    )?.[1]
    const payload = {
      kind: 'builtin',
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-import-1234',
      maskedApiKey: 'sk-i...1234',
      iconModelId: 'openai',
      willOverwrite: true
    }

    expect(installHandler).toBeTypeOf('function')

    consumePendingSettingsProviderInstall.mockResolvedValueOnce(payload)
    const installPromise = installHandler?.({})

    expect(providerStore.initialize).toHaveBeenCalledTimes(1)

    resolveProviderInitialize?.()
    await installPromise
    await flushPromises()

    expect(push).toHaveBeenCalledWith({
      name: 'settings-provider',
      params: {
        providerId: 'openai'
      }
    })
    expect(providerDeeplinkImportStore.openPreview).toHaveBeenCalledWith(payload)
  })

  it('processes MCP deeplinks while the settings window is already open', async () => {
    vi.resetModules()
    vi.doUnmock('../../../src/renderer/src/lib/storeInitializer')

    const push = vi.fn().mockResolvedValue(undefined)
    const isReady = vi.fn().mockResolvedValue(undefined)
    const ipcOn = vi.fn()
    const ipcRemoveListener = vi.fn()
    const ipcRemoveAllListeners = vi.fn()
    const ipcSend = vi.fn()
    const mcpStore = {
      mcpEnabled: false,
      setMcpEnabled: vi.fn().mockResolvedValue(undefined),
      setMcpInstallCache: vi.fn()
    }

    ;(window as any).electron = {
      ipcRenderer: {
        on: ipcOn,
        removeListener: ipcRemoveListener,
        removeAllListeners: ipcRemoveAllListeners,
        send: ipcSend
      }
    }

    vi.doMock('vue-router', () => {
      const currentRoute = ref({ name: 'settings-common', query: {}, params: {}, path: '/common' })
      const router = {
        hasRoute: vi.fn((routeName: string) => routeName === 'settings-mcp'),
        isReady,
        push,
        replace: vi.fn().mockResolvedValue(undefined),
        getRoutes: vi.fn(() => [
          {
            path: '/common',
            name: 'settings-common',
            meta: { titleKey: 'routes.settings-common', icon: 'lucide:bolt', position: 1 }
          },
          {
            path: '/mcp',
            name: 'settings-mcp',
            meta: {
              titleKey: 'routes.settings-mcp',
              icon: 'lucide:server',
              position: 5
            }
          }
        ]),
        currentRoute
      }

      return {
        useRouter: () => router,
        useRoute: () => currentRoute.value,
        RouterView: {
          name: 'RouterView',
          template: '<div />'
        }
      }
    })

    vi.doMock('../../../src/renderer/src/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'devicePresenter') {
          return {
            getDeviceInfo: vi.fn().mockResolvedValue({ platform: 'darwin' })
          }
        }
        if (name === 'windowPresenter') {
          return {
            closeSettingsWindow: vi.fn(),
            consumePendingSettingsProviderInstall: vi.fn().mockResolvedValue(null)
          }
        }
        if (name === 'configPresenter') {
          return {
            getLanguage: vi.fn().mockResolvedValue('zh-CN')
          }
        }
        return {}
      }
    }))
    vi.doMock('../../../src/renderer/src/stores/uiSettingsStore', () => ({
      useUiSettingsStore: () => ({
        fontSizeClass: 'text-base',
        loadSettings: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/language', () => ({
      useLanguageStore: () => ({
        language: 'zh-CN',
        dir: 'ltr'
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/modelCheck', () => ({
      useModelCheckStore: () => ({
        isDialogOpen: false,
        currentProviderId: null,
        closeDialog: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/theme', () => ({
      useThemeStore: () => ({
        themeMode: 'light',
        isDark: false
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/providerStore', () => ({
      useProviderStore: () => ({
        providers: [],
        initialize: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/providerDeeplinkImport', () => ({
      useProviderDeeplinkImportStore: () => ({
        preview: null,
        previewToken: 0,
        openPreview: vi.fn(),
        clearPreview: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/modelStore', () => ({
      useModelStore: () => ({
        initialize: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/ollamaStore', () => ({
      useOllamaStore: () => ({
        initialize: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/mcp', () => ({
      useMcpStore: () => mcpStore
    }))
    vi.doMock('../../../src/renderer/src/composables/useFontManager', () => ({
      useFontManager: () => ({
        setupFontListener: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/composables/useDeviceVersion', () => ({
      useDeviceVersion: () => ({
        isMacOS: ref(false),
        isWinMacOS: true
      })
    }))
    vi.doMock('@vueuse/core', () => ({
      useTitle: () => ref('')
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key,
        locale: ref('zh-CN')
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({
        toast: vi.fn(() => ({ dismiss: vi.fn() }))
      })
    }))

    const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
    mount(SettingsApp, {
      global: {
        stubs: {
          Button: true,
          RouterView: true,
          CloseIcon: true,
          ModelCheckDialog: defineComponent({
            name: 'ModelCheckDialog',
            props: {
              open: { type: Boolean, default: false },
              providerId: { type: null, default: null }
            },
            template: '<div />'
          }),
          ProviderDeeplinkImportDialog: defineComponent({
            name: 'ProviderDeeplinkImportDialog',
            props: {
              open: { type: Boolean, default: false },
              preview: { type: null, default: null }
            },
            template: '<div />'
          }),
          Toaster: true,
          Icon: true
        }
      }
    })

    await Promise.resolve()
    await Promise.resolve()

    const installHandler = ipcOn.mock.calls.find(
      ([eventName]: [string]) => eventName === DEEPLINK_EVENTS.MCP_INSTALL
    )?.[1]

    expect(installHandler).toBeTypeOf('function')

    const serializedConfig = JSON.stringify({
      mcpServers: {
        demo: {
          command: 'npx'
        }
      }
    })

    await installHandler?.({}, { mcpConfig: serializedConfig })

    expect(mcpStore.setMcpEnabled).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({ name: 'settings-mcp' })
    expect(mcpStore.setMcpInstallCache).toHaveBeenCalledWith(serializedConfig)
  })
})
