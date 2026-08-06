import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick, reactive, ref } from 'vue'
import { SETTINGS_EVENTS } from '@/events'

vi.mock('../../../src/renderer/settings/components/SettingsLeaveGuardDialog.vue', () => ({
  default: defineComponent({
    name: 'SettingsLeaveGuardDialog',
    template: '<div />'
  })
}))

const windowClientListenerImpls = vi.hoisted(() => ({
  onSettingsNavigate: (listener: (payload: unknown) => void) => {
    const wrapped = (_event: unknown, payload?: unknown) => listener(payload)
    window.electron?.ipcRenderer?.on('settings:navigate', wrapped)
    return () => window.electron?.ipcRenderer?.removeListener('settings:navigate', wrapped)
  },
  onSettingsProviderInstall: (listener: () => void) => {
    const wrapped = () => listener()
    window.electron?.ipcRenderer?.on('settings:provider-install', wrapped)
    return () => window.electron?.ipcRenderer?.removeListener('settings:provider-install', wrapped)
  }
}))

const windowClientMock = vi.hoisted(() => ({
  closeSettings: vi.fn().mockResolvedValue(true),
  focusMainWindow: vi.fn().mockResolvedValue(true),
  notifySettingsReady: vi.fn().mockImplementation(async () => {
    window.electron?.ipcRenderer?.send('settings:ready')
    return true
  }),
  consumePendingSettingsProviderInstall: vi.fn().mockResolvedValue(null),
  requeuePendingSettingsProviderInstall: vi.fn().mockResolvedValue(true),
  startGuidedOnboarding: vi.fn().mockResolvedValue({ started: true, focused: true }),
  onSettingsNavigate: vi.fn().mockImplementation(windowClientListenerImpls.onSettingsNavigate),
  onSettingsProviderInstall: vi
    .fn()
    .mockImplementation(windowClientListenerImpls.onSettingsProviderInstall)
}))

const appRuntimeClientMock = vi.hoisted(() => ({
  mcpInstallListener: undefined as ((payload: { mcpConfig: string }) => void) | undefined,
  cleanupMcpInstall: vi.fn(),
  onMcpInstallRequested: vi.fn((listener: (payload: { mcpConfig: string }) => void) => {
    appRuntimeClientMock.mcpInstallListener = listener
    return appRuntimeClientMock.cleanupMcpInstall
  })
}))

const configClientMock = vi.hoisted(() => ({
  getLanguage: vi.fn().mockResolvedValue('zh-CN')
}))

const deviceClientMock = vi.hoisted(() => ({
  getDeviceInfo: vi.fn().mockResolvedValue({ platform: 'darwin' })
}))

vi.mock('@api/DeviceClient', () => ({
  createDeviceClient: () => deviceClientMock
}))

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: () => configClientMock
}))

vi.mock('@api/WindowClient', () => ({
  createWindowClient: () => windowClientMock
}))

vi.mock('@api/AppRuntimeClient', () => ({
  createAppRuntimeClient: () => appRuntimeClientMock
}))

// The global setup's afterEach runs vi.restoreAllMocks() after this file's
// hooks, stripping vi.fn() implementations. Rebuild the listener mocks before
// each test or unmount-time cleanups come back as undefined.
beforeEach(() => {
  deviceClientMock.getDeviceInfo.mockReset().mockResolvedValue({ platform: 'darwin' })
  windowClientMock.onSettingsNavigate
    .mockReset()
    .mockImplementation(windowClientListenerImpls.onSettingsNavigate)
  windowClientMock.onSettingsProviderInstall
    .mockReset()
    .mockImplementation(windowClientListenerImpls.onSettingsProviderInstall)
})

afterEach(() => {
  vi.restoreAllMocks()
  windowClientMock.closeSettings.mockReset().mockResolvedValue(true)
  windowClientMock.focusMainWindow.mockReset().mockResolvedValue(true)
  windowClientMock.notifySettingsReady.mockClear()
  windowClientMock.consumePendingSettingsProviderInstall.mockReset().mockResolvedValue(null)
  windowClientMock.requeuePendingSettingsProviderInstall.mockReset().mockResolvedValue(true)
  windowClientMock.startGuidedOnboarding.mockReset().mockResolvedValue({
    started: true,
    focused: true
  })
  appRuntimeClientMock.mcpInstallListener = undefined
  appRuntimeClientMock.cleanupMcpInstall.mockClear()
  appRuntimeClientMock.onMcpInstallRequested.mockClear()
  configClientMock.getLanguage.mockReset().mockResolvedValue('zh-CN')
  document.documentElement.lang = ''
  document.documentElement.dir = ''
})

describe('Settings App', () => {
  it('initializes the settings window and guards dirty close attempts', async () => {
    vi.resetModules()
    deviceClientMock.getDeviceInfo.mockResolvedValue({ platform: 'win32' })

    const push = vi.fn().mockResolvedValue(undefined)
    const isReady = vi.fn().mockResolvedValue(undefined)
    const ipcOn = vi.fn()
    const ipcRemoveListener = vi.fn()
    const ipcRemoveAllListeners = vi.fn()
    const ipcSend = vi.fn()
    const initializeModelStore = vi.fn().mockResolvedValue(undefined)

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
        beforeEach: vi.fn(() => vi.fn()),
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
        initialized: ref(false),
        initialize: vi.fn().mockResolvedValue(undefined),
        ensureInitialized: vi.fn().mockResolvedValue(undefined),
        primeProviders: vi.fn().mockResolvedValue(undefined)
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
        initialize: initializeModelStore,
        ensureProviderModelsReady: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/ollamaStore', () => ({
      useOllamaStore: () => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        ensureProviderReady: vi.fn().mockResolvedValue(undefined)
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
      useTitle: () => ref(''),
      useEventListener: (target: EventTarget, event: string, listener: EventListener) => {
        target.addEventListener(event, listener)
        return () => target.removeEventListener(event, listener)
      }
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
    const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
    const wrapper = mount(SettingsApp, {
      global: {
        stubs: {
          DcButton: true,
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
    await flushPromises()

    expect(isReady).toHaveBeenCalledTimes(1)
    expect(initializeModelStore).toHaveBeenCalledTimes(1)
    expect(ipcSend).toHaveBeenCalledWith(SETTINGS_EVENTS.READY)

    const { settingsLeaveGuard } =
      await import('../../../src/renderer/settings/services/settingsLeaveGuard')
    let leaveLease: ReturnType<typeof settingsLeaveGuard.register>
    leaveLease = settingsLeaveGuard.register({
      id: 'test-editor',
      onDiscard: () => leaveLease.setRisk('clean')
    })
    leaveLease.setRisk('dirty')

    await wrapper.get('[aria-label="common.close"]').trigger('click')
    await flushPromises()
    expect(windowClientMock.closeSettings).not.toHaveBeenCalled()
    expect(settingsLeaveGuard.getSnapshot()).toMatchObject({ promptOpen: true, risk: 'dirty' })

    expect(settingsLeaveGuard.discardAndLeave()).toBe(true)
    await flushPromises()
    expect(windowClientMock.closeSettings).toHaveBeenCalledOnce()

    leaveLease.release()
    windowClientMock.closeSettings.mockClear()
    let nativeLeaveLease: ReturnType<typeof settingsLeaveGuard.register>
    nativeLeaveLease = settingsLeaveGuard.register({
      id: 'native-close-test-editor',
      onDiscard: () => nativeLeaveLease.setRisk('clean')
    })
    nativeLeaveLease.setRisk('dirty')

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
    expect(beforeUnload.returnValue).toBe(false)
    expect(windowClientMock.closeSettings).not.toHaveBeenCalled()

    expect(settingsLeaveGuard.discardAndLeave()).toBe(true)
    await flushPromises()
    expect(windowClientMock.closeSettings).toHaveBeenCalledOnce()

    nativeLeaveLease.release()
    wrapper.unmount()
  }, 15000)

  it('uses a resolved provider settings path in the sidebar', async () => {
    vi.resetModules()

    let resolvePush: (() => void) | undefined
    const push = vi.fn(() => new Promise<void>((resolve) => (resolvePush = resolve)))
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
        beforeEach: vi.fn(() => vi.fn()),
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
        initialized: ref(false),
        initialize: vi.fn().mockResolvedValue(undefined),
        ensureInitialized: vi.fn().mockResolvedValue(undefined),
        primeProviders: vi.fn().mockResolvedValue(undefined)
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
        initialize: vi.fn().mockResolvedValue(undefined),
        ensureProviderModelsReady: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/ollamaStore', () => ({
      useOllamaStore: () => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        ensureProviderReady: vi.fn().mockResolvedValue(undefined)
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
      useTitle: () => ref(''),
      useEventListener: (target: EventTarget, event: string, listener: EventListener) => {
        target.addEventListener(event, listener)
        return () => target.removeEventListener(event, listener)
      }
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
    const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
    const wrapper = mount(SettingsApp, {
      global: {
        stubs: {
          DcButton: true,
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

    const providerSidebarItem = wrapper.find('[data-testid="settings-tab-model-providers"]')

    expect(providerSidebarItem.exists()).toBe(true)

    await providerSidebarItem.trigger('click')

    expect(push).toHaveBeenCalledWith('/provider')
    expect(push).not.toHaveBeenCalledWith('/provider/:providerId?')
    expect(providerSidebarItem.attributes('aria-busy')).toBe('true')

    resolvePush?.()
    await flushPromises()
    expect(providerSidebarItem.attributes('aria-busy')).toBe('false')
  })

  it('navigates to the requested settings route when a navigate event arrives', async () => {
    vi.resetModules()

    const route = reactive({
      name: 'settings-common',
      query: {},
      params: {},
      path: '/common'
    })
    const currentRoute = ref(route)
    const push = vi.fn().mockImplementation(async (target: { name?: string; params?: any }) => {
      if (!target?.name) {
        return
      }

      route.name = target.name
      route.params = target.params ?? {}
      route.path = target.name === 'settings-deepchat-agents' ? '/deepchat-agents' : '/common'
      currentRoute.value = route
    })
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
      const router = {
        hasRoute: vi.fn((routeName: string) => routeName === 'settings-deepchat-agents'),
        isReady,
        push,
        replace: vi.fn().mockResolvedValue(undefined),
        beforeEach: vi.fn(() => vi.fn()),
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
        useRoute: () => route,
        RouterView: {
          name: 'RouterView',
          template: '<div />'
        }
      }
    })

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
      useTitle: () => ref(''),
      useEventListener: (target: EventTarget, event: string, listener: EventListener) => {
        target.addEventListener(event, listener)
        return () => target.removeEventListener(event, listener)
      }
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
    const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
    mount(SettingsApp, {
      global: {
        stubs: {
          DcButton: true,
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

    const navigateHandler = windowClientMock.onSettingsNavigate.mock.calls.at(-1)?.[0] as
      | ((payload: { routeName: string }) => Promise<void>)
      | undefined

    expect(navigateHandler).toBeTypeOf('function')

    await navigateHandler?.({ routeName: 'settings-deepchat-agents' })

    expect(push).toHaveBeenCalledWith({
      name: 'settings-deepchat-agents',
      params: undefined
    })
  }, 15000)

  it('reuses settings-provider route params when a provider navigate event arrives', async () => {
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
      const currentRoute = ref({
        name: 'settings-provider',
        query: {},
        params: { providerId: 'deepseek' },
        path: '/provider/deepseek'
      })
      const router = {
        hasRoute: vi.fn((routeName: string) => routeName === 'settings-provider'),
        isReady,
        push,
        replace: vi.fn().mockResolvedValue(undefined),
        beforeEach: vi.fn(() => vi.fn()),
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
      useTitle: () => ref(''),
      useEventListener: (target: EventTarget, event: string, listener: EventListener) => {
        target.addEventListener(event, listener)
        return () => target.removeEventListener(event, listener)
      }
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
    const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
    mount(SettingsApp, {
      global: {
        stubs: {
          DcButton: true,
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

    const navigateHandler = windowClientMock.onSettingsNavigate.mock.calls.at(-1)?.[0] as
      | ((payload: { routeName: string; params?: { providerId: string } }) => Promise<void>)
      | undefined

    expect(navigateHandler).toBeTypeOf('function')

    await navigateHandler?.({
      routeName: 'settings-provider',
      params: {
        providerId: 'openai'
      }
    })

    expect(push).toHaveBeenCalledWith({
      name: 'settings-provider',
      params: {
        providerId: 'openai'
      }
    })
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
      initialized: false,
      providers: [],
      initialize: vi.fn().mockReturnValue(providerInitializePromise),
      ensureInitialized: vi.fn().mockImplementation(async () => {
        await providerInitializePromise
        providerStore.initialized = true
      }),
      primeProviders: vi.fn().mockResolvedValue(undefined)
    }
    const providerDeeplinkImportStore = {
      preview: null,
      previewToken: 0,
      openPreview: vi.fn(),
      clearPreview: vi.fn()
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
        hasRoute: vi.fn((routeName: string) => routeName === 'settings-provider'),
        isReady,
        push,
        replace: vi.fn().mockResolvedValue(undefined),
        beforeEach: vi.fn(() => vi.fn()),
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
        initialize: vi.fn().mockResolvedValue(undefined),
        ensureProviderModelsReady: vi.fn().mockResolvedValue(undefined)
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/ollamaStore', () => ({
      useOllamaStore: () => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        ensureProviderReady: vi.fn().mockResolvedValue(undefined)
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
      useTitle: () => ref(''),
      useEventListener: (target: EventTarget, event: string, listener: EventListener) => {
        target.addEventListener(event, listener)
        return () => target.removeEventListener(event, listener)
      }
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
    const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
    mount(SettingsApp, {
      global: {
        stubs: {
          DcButton: true,
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

    expect(providerStore.ensureInitialized).not.toHaveBeenCalled()

    const installHandler = windowClientMock.onSettingsProviderInstall.mock.calls.at(-1)?.[0] as
      | (() => Promise<void>)
      | undefined
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

    windowClientMock.consumePendingSettingsProviderInstall.mockResolvedValueOnce(payload)
    const installPromise = installHandler?.()

    resolveProviderInitialize?.()
    await installPromise
    await flushPromises()

    expect(providerStore.ensureInitialized).toHaveBeenCalledTimes(1)

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
        beforeEach: vi.fn(() => vi.fn()),
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
      useTitle: () => ref(''),
      useEventListener: (target: EventTarget, event: string, listener: EventListener) => {
        target.addEventListener(event, listener)
        return () => target.removeEventListener(event, listener)
      }
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
    const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
    mount(SettingsApp, {
      global: {
        stubs: {
          DcButton: true,
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

    const installHandler = appRuntimeClientMock.mcpInstallListener

    expect(installHandler).toBeTypeOf('function')

    const serializedConfig = JSON.stringify({
      mcpServers: {
        demo: {
          command: 'npx'
        }
      }
    })

    await installHandler?.({ mcpConfig: serializedConfig })
    await flushPromises()

    expect(mcpStore.setMcpEnabled).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({ name: 'settings-mcp' })
    expect(mcpStore.setMcpInstallCache).toHaveBeenCalledWith(serializedConfig)
  })

  it('projects locale and direction updates when the requested language is unchanged', async () => {
    vi.resetModules()

    const languageStore = reactive({
      language: 'system',
      dir: 'auto' as 'auto' | 'rtl',
      initLanguage: vi.fn().mockResolvedValue(undefined)
    })
    const locale = ref('zh-CN')

    vi.doMock('vue-router', () => {
      const currentRoute = ref({ name: 'settings-common', query: {}, params: {}, path: '/common' })
      const router = {
        hasRoute: vi.fn(() => true),
        isReady: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
        replace: vi.fn().mockResolvedValue(undefined),
        beforeEach: vi.fn(() => vi.fn()),
        getRoutes: vi.fn(() => []),
        currentRoute
      }

      return {
        useRouter: () => router,
        useRoute: () => currentRoute.value,
        RouterView: { name: 'RouterView', template: '<div />' }
      }
    })
    vi.doMock('../../../src/renderer/src/stores/uiSettingsStore', () => ({
      useUiSettingsStore: () => ({ fontSizeClass: 'text-base', loadSettings: vi.fn() })
    }))
    vi.doMock('../../../src/renderer/src/stores/language', () => ({
      useLanguageStore: () => languageStore
    }))
    vi.doMock('../../../src/renderer/src/stores/modelCheck', () => ({
      useModelCheckStore: () => ({
        isDialogOpen: false,
        currentProviderId: null,
        closeDialog: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/stores/theme', () => ({
      useThemeStore: () => ({ themeMode: 'light', isDark: false })
    }))
    vi.doMock('../../../src/renderer/src/stores/providerStore', () => ({
      useProviderStore: () => ({ providers: [], initialized: ref(false), initialize: vi.fn() })
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
      useModelStore: () => ({ initialize: vi.fn() })
    }))
    vi.doMock('../../../src/renderer/src/stores/ollamaStore', () => ({
      useOllamaStore: () => ({ initialize: vi.fn() })
    }))
    vi.doMock('../../../src/renderer/src/stores/mcp', () => ({
      useMcpStore: () => ({
        mcpEnabled: false,
        setMcpEnabled: vi.fn(),
        setMcpInstallCache: vi.fn()
      })
    }))
    vi.doMock('../../../src/renderer/src/lib/storeInitializer', () => ({
      useMcpInstallDeeplinkHandler: () => ({ setup: vi.fn(), cleanup: vi.fn() })
    }))
    vi.doMock('../../../src/renderer/src/composables/useFontManager', () => ({
      useFontManager: () => ({ setupFontListener: vi.fn() })
    }))
    vi.doMock('../../../src/renderer/src/composables/useDeviceVersion', () => ({
      useDeviceVersion: () => ({ isMacOS: ref(false), isWinMacOS: true })
    }))
    vi.doMock('@vueuse/core', () => ({
      useTitle: () => ref(''),
      useEventListener: vi.fn()
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({ t: (key: string) => key, locale })
    }))
    vi.doMock('@iconify/vue', () => ({ Icon: { name: 'Icon', template: '<span />' } }))
    const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
    const wrapper = mount(SettingsApp, {
      global: {
        stubs: {
          DcButton: true,
          RouterView: true,
          CloseIcon: true,
          ModelCheckDialog: true,
          ProviderDeeplinkImportDialog: true,
          Toaster: true,
          Icon: true
        }
      }
    })

    expect(configClientMock.getLanguage).not.toHaveBeenCalled()
    expect(languageStore.initLanguage).toHaveBeenCalledTimes(1)

    // The requested preference remains "system", but its resolved locale and
    // direction can change when the system locale changes.
    locale.value = 'fa-IR'
    languageStore.dir = 'rtl'
    await nextTick()
    await flushPromises()

    expect(document.documentElement).toHaveProperty('lang', 'fa-IR')
    expect(document.documentElement).toHaveProperty('dir', 'rtl')
    expect(locale.value).toBe('fa-IR')
    expect(configClientMock.getLanguage).not.toHaveBeenCalled()

    wrapper.unmount()
    document.documentElement.lang = ''
    document.documentElement.dir = ''
  })
})
