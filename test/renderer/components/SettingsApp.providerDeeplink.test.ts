import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, reactive, ref } from 'vue'
import { SETTINGS_EVENTS } from '@/events'

const createProviderDeeplinkImportStore = () => {
  const store = reactive({
    preview: null as Record<string, unknown> | null,
    previewToken: 0,
    openPreview: vi.fn((payload: Record<string, unknown>) => {
      store.previewToken += 1
      store.preview = { ...payload }
    }),
    clearPreview: vi.fn(() => {
      store.preview = null
    })
  })

  return store
}

const mountSettingsApp = async (options?: {
  routeName?: 'settings-common' | 'settings-provider'
  providerId?: string
  failImport?: boolean
  failPreviewApply?: boolean
  failConsumeOnce?: boolean
  failRequeue?: boolean
  failProviderNavigationOnce?: boolean
}) => {
  vi.resetModules()

  const route = reactive({
    name: options?.routeName ?? 'settings-common',
    query: {},
    params: options?.providerId ? { providerId: options.providerId } : {},
    path: options?.routeName === 'settings-provider' ? '/provider' : '/common'
  })
  const currentRoute = ref(route)
  let shouldFailProviderNavigationOnce = options?.failProviderNavigationOnce ?? false
  const push = vi.fn().mockImplementation(async (target: { name?: string; params?: any }) => {
    if (!target?.name) {
      return
    }

    if (shouldFailProviderNavigationOnce && target.name === 'settings-provider') {
      shouldFailProviderNavigationOnce = false
      throw new Error('navigate failed')
    }

    route.name = target.name
    route.params = target.params ?? {}
    route.path = target.name === 'settings-provider' ? '/provider' : '/common'
    currentRoute.value = route
  })
  const router = {
    hasRoute: vi.fn((routeName: string) =>
      ['settings-common', 'settings-provider', 'settings-mcp'].includes(routeName)
    ),
    isReady: vi.fn().mockResolvedValue(undefined),
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
        meta: { titleKey: 'routes.settings-provider', icon: 'lucide:cloud-cog', position: 3 }
      }
    ]),
    currentRoute
  }

  let shouldFailConsumeOnce = options?.failConsumeOnce ?? false

  const providerStore = reactive({
    providers: options?.failPreviewApply
      ? []
      : [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            apiType: 'deepseek',
            apiKey: 'old-key',
            baseUrl: 'https://old.example.com/v1',
            enable: false
          }
        ],
    initialize: options?.failPreviewApply
      ? vi.fn().mockRejectedValue(new Error('sync failed'))
      : vi.fn().mockResolvedValue(undefined),
    updateProviderApi: options?.failImport
      ? vi.fn().mockRejectedValue(new Error('apply failed'))
      : vi.fn().mockResolvedValue(undefined),
    updateProviderStatus: vi
      .fn()
      .mockImplementation(async (providerId: string, enable: boolean) => {
        const provider = providerStore.providers.find((item) => item.id === providerId)
        if (provider) {
          provider.enable = enable
        }
      }),
    addCustomProvider: vi.fn().mockImplementation(async (provider: Record<string, unknown>) => {
      providerStore.providers.push(provider as any)
    })
  })

  const modelStore = reactive({
    initialize: vi.fn().mockResolvedValue(undefined),
    refreshProviderModels: vi.fn().mockResolvedValue(undefined)
  })
  const providerDeeplinkImportStore = createProviderDeeplinkImportStore()
  const toast = vi.fn(() => ({ dismiss: vi.fn() }))
  const ipcOn = vi.fn()
  const ipcRemoveListener = vi.fn()
  const ipcRemoveAllListeners = vi.fn()
  const ipcSend = vi.fn()
  const pendingProviderInstallQueue: Array<Record<string, unknown>> = []
  const consumePendingSettingsProviderInstall = vi.fn().mockImplementation(async () => {
    if (shouldFailConsumeOnce) {
      shouldFailConsumeOnce = false
      throw new Error('consume failed')
    }

    return pendingProviderInstallQueue.shift() ?? null
  })
  const setPendingSettingsProviderInstall = vi
    .fn()
    .mockImplementation(async (payload: Record<string, unknown>) => {
      if (options?.failRequeue) {
        throw new Error('requeue failed')
      }

      pendingProviderInstallQueue.push(payload)
    })
  const queuePendingProviderInstall = (payload: Record<string, unknown>) => {
    pendingProviderInstallQueue.push(payload)
  }

  ;(window as any).electron = {
    ipcRenderer: {
      on: ipcOn,
      removeListener: ipcRemoveListener,
      removeAllListeners: ipcRemoveAllListeners,
      send: ipcSend
    }
  }

  vi.doMock('vue-router', () => ({
    useRouter: () => router,
    useRoute: () => route,
    RouterView: {
      name: 'RouterView',
      template: '<div />'
    }
  }))
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
          consumePendingSettingsProviderInstall,
          setPendingSettingsProviderInstall
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
    useModelStore: () => modelStore
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
      toast
    })
  }))
  vi.doMock('nanoid', () => ({
    nanoid: () => 'custom-provider-id'
  }))

  const SettingsApp = (await import('../../../src/renderer/settings/App.vue')).default
  const wrapper = mount(SettingsApp, {
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
          props: ['open', 'preview', 'confirmDisabled', 'submitting'],
          emits: ['confirm', 'update:open'],
          template:
            '<div v-if="open" data-testid="provider-import-dialog"><span data-testid="provider-import-kind">{{ preview?.kind }}</span><button data-testid="confirm-import" :disabled="confirmDisabled || submitting" @click="$emit(\'confirm\')" /><button data-testid="cancel-import" @click="$emit(\'update:open\', false)" /></div>'
        }),
        Toaster: true,
        Icon: true
      }
    }
  })

  await flushPromises()

  const installHandler = ipcOn.mock.calls.find(
    ([eventName]: [string]) => eventName === SETTINGS_EVENTS.PROVIDER_INSTALL
  )?.[1]

  return {
    wrapper,
    route,
    push,
    toast,
    providerStore,
    modelStore,
    providerDeeplinkImportStore,
    installHandler,
    queuePendingProviderInstall,
    consumePendingSettingsProviderInstall,
    setPendingSettingsProviderInstall,
    pendingProviderInstallQueue
  }
}

describe('SettingsApp provider deeplink', () => {
  it('confirms built-in provider imports from the settings root', async () => {
    const {
      wrapper,
      push,
      providerStore,
      modelStore,
      providerDeeplinkImportStore,
      installHandler,
      queuePendingProviderInstall
    } = await mountSettingsApp({
      routeName: 'settings-common'
    })

    const payload = {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://deepseek.example.com/v1',
      apiKey: 'sk-deepseek-demo-key',
      maskedApiKey: 'sk-d...-key',
      iconModelId: 'deepseek',
      willOverwrite: true
    }

    queuePendingProviderInstall(payload)
    await installHandler?.({})
    await flushPromises()

    expect(wrapper.get('[data-testid="provider-import-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="provider-import-kind"]').text()).toBe('builtin')

    await wrapper.get('[data-testid="confirm-import"]').trigger('click')
    await flushPromises()

    expect(providerStore.updateProviderApi).toHaveBeenCalledWith(
      'deepseek',
      'sk-deepseek-demo-key',
      'https://deepseek.example.com/v1'
    )
    expect(providerStore.updateProviderStatus).toHaveBeenCalledWith('deepseek', true)
    expect(modelStore.refreshProviderModels).toHaveBeenCalledWith('deepseek')
    expect(push).toHaveBeenLastCalledWith({
      name: 'settings-provider',
      params: {
        providerId: 'deepseek'
      }
    })
    expect(providerDeeplinkImportStore.clearPreview).toHaveBeenCalledTimes(1)
    expect(providerDeeplinkImportStore.preview).toBeNull()
  })

  it('confirms custom provider imports even when settings is already on provider route', async () => {
    const {
      wrapper,
      push,
      providerStore,
      modelStore,
      providerDeeplinkImportStore,
      installHandler,
      queuePendingProviderInstall
    } = await mountSettingsApp({
      routeName: 'settings-provider',
      providerId: 'deepseek'
    })

    const payload = {
      kind: 'custom' as const,
      name: 'minimax Proxy',
      type: 'minimax',
      baseUrl: 'https://minimax.example.com/v1',
      apiKey: 'sk-minimax-custom',
      maskedApiKey: 'sk-m...stom',
      iconModelId: 'minimax'
    }

    queuePendingProviderInstall(payload)
    await installHandler?.({})
    await flushPromises()

    expect(wrapper.get('[data-testid="provider-import-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="provider-import-kind"]').text()).toBe('custom')

    await wrapper.get('[data-testid="confirm-import"]').trigger('click')
    await flushPromises()

    expect(providerStore.addCustomProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'custom-provider-id',
        name: 'minimax Proxy',
        apiType: 'minimax',
        apiKey: 'sk-minimax-custom',
        baseUrl: 'https://minimax.example.com/v1',
        enable: true,
        custom: true
      })
    )
    expect(modelStore.refreshProviderModels).toHaveBeenCalledWith('custom-provider-id')
    expect(push).toHaveBeenLastCalledWith({
      name: 'settings-provider',
      params: {
        providerId: 'custom-provider-id'
      }
    })
    expect(providerDeeplinkImportStore.clearPreview).toHaveBeenCalledTimes(1)
    expect(providerDeeplinkImportStore.preview).toBeNull()
  })

  it('keeps the provider import preview open when import fails', async () => {
    const {
      wrapper,
      toast,
      providerDeeplinkImportStore,
      installHandler,
      queuePendingProviderInstall
    } = await mountSettingsApp({
      routeName: 'settings-common',
      failImport: true
    })

    const payload = {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://deepseek.example.com/v1',
      apiKey: 'sk-deepseek-demo-key',
      maskedApiKey: 'sk-d...-key',
      iconModelId: 'deepseek',
      willOverwrite: true
    }

    queuePendingProviderInstall(payload)
    await installHandler?.({})
    await flushPromises()
    await wrapper.get('[data-testid="confirm-import"]').trigger('click')
    await flushPromises()

    expect(providerDeeplinkImportStore.preview).toEqual(payload)
    expect(wrapper.get('[data-testid="provider-import-dialog"]').exists()).toBe(true)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'common.error',
        description: 'apply failed',
        variant: 'destructive'
      })
    )
  })

  it('replays pending provider imports when the settings window regains focus', async () => {
    const { wrapper, queuePendingProviderInstall, consumePendingSettingsProviderInstall } =
      await mountSettingsApp({
        routeName: 'settings-provider',
        providerId: 'deepseek'
      })

    const payload = {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://deepseek.example.com/v1',
      apiKey: 'sk-deepseek-demo-key',
      maskedApiKey: 'sk-d...-key',
      iconModelId: 'deepseek',
      willOverwrite: true
    }

    queuePendingProviderInstall(payload)
    window.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(consumePendingSettingsProviderInstall).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="provider-import-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="provider-import-kind"]').text()).toBe('builtin')
  })

  it('drains queued provider imports only after the active dialog is dismissed', async () => {
    const {
      wrapper,
      installHandler,
      queuePendingProviderInstall,
      consumePendingSettingsProviderInstall
    } = await mountSettingsApp({
      routeName: 'settings-provider',
      providerId: 'deepseek'
    })

    const firstPayload = {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://deepseek.example.com/v1',
      apiKey: 'sk-deepseek-demo-key',
      maskedApiKey: 'sk-d...-key',
      iconModelId: 'deepseek',
      willOverwrite: true
    }
    const secondPayload = {
      kind: 'custom' as const,
      name: 'minimax Proxy',
      type: 'minimax',
      baseUrl: 'https://minimax.example.com/v1',
      apiKey: 'sk-minimax-custom',
      maskedApiKey: 'sk-m...stom',
      iconModelId: 'minimax'
    }
    const initialConsumeCount = consumePendingSettingsProviderInstall.mock.calls.length

    queuePendingProviderInstall(firstPayload)
    queuePendingProviderInstall(secondPayload)
    await installHandler?.({})
    await flushPromises()

    expect(consumePendingSettingsProviderInstall).toHaveBeenCalledTimes(initialConsumeCount + 1)
    expect(wrapper.get('[data-testid="provider-import-kind"]').text()).toBe('builtin')

    window.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(consumePendingSettingsProviderInstall).toHaveBeenCalledTimes(initialConsumeCount + 1)

    await wrapper.get('[data-testid="cancel-import"]').trigger('click')
    await flushPromises()

    expect(consumePendingSettingsProviderInstall).toHaveBeenCalledTimes(initialConsumeCount + 2)
    expect(wrapper.get('[data-testid="provider-import-kind"]').text()).toBe('custom')
  })

  it('drains queued provider imports after a successful confirm', async () => {
    const {
      wrapper,
      installHandler,
      queuePendingProviderInstall,
      consumePendingSettingsProviderInstall,
      providerStore,
      modelStore
    } = await mountSettingsApp({
      routeName: 'settings-provider',
      providerId: 'deepseek'
    })

    const firstPayload = {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://deepseek.example.com/v1',
      apiKey: 'sk-deepseek-demo-key',
      maskedApiKey: 'sk-d...-key',
      iconModelId: 'deepseek',
      willOverwrite: true
    }
    const secondPayload = {
      kind: 'custom' as const,
      name: 'minimax Proxy',
      type: 'minimax',
      baseUrl: 'https://minimax.example.com/v1',
      apiKey: 'sk-minimax-custom',
      maskedApiKey: 'sk-m...stom',
      iconModelId: 'minimax'
    }
    const initialConsumeCount = consumePendingSettingsProviderInstall.mock.calls.length

    queuePendingProviderInstall(firstPayload)
    queuePendingProviderInstall(secondPayload)
    await installHandler?.({})
    await flushPromises()

    await wrapper.get('[data-testid="confirm-import"]').trigger('click')
    await flushPromises()

    expect(providerStore.updateProviderApi).toHaveBeenCalledWith(
      'deepseek',
      'sk-deepseek-demo-key',
      'https://deepseek.example.com/v1'
    )
    expect(modelStore.refreshProviderModels).toHaveBeenCalledWith('deepseek')
    expect(consumePendingSettingsProviderInstall).toHaveBeenCalledTimes(initialConsumeCount + 2)
    expect(wrapper.get('[data-testid="provider-import-kind"]').text()).toBe('custom')
  })

  it('requeues pending provider installs when syncing the preview fails', async () => {
    const {
      wrapper,
      installHandler,
      queuePendingProviderInstall,
      setPendingSettingsProviderInstall,
      pendingProviderInstallQueue
    } = await mountSettingsApp({
      routeName: 'settings-common',
      failPreviewApply: true
    })

    const payload = {
      kind: 'custom' as const,
      name: 'DeepSeek Proxy',
      type: 'deepseek',
      baseUrl: 'https://deepseek.example.com/v1',
      apiKey: 'sk-deepseek-custom',
      maskedApiKey: 'sk-d...stom',
      iconModelId: 'deepseek'
    }

    queuePendingProviderInstall(payload)
    await installHandler?.({})
    await flushPromises()

    expect(setPendingSettingsProviderInstall).toHaveBeenCalledWith(payload)
    expect(pendingProviderInstallQueue).toEqual([payload])
    expect(wrapper.find('[data-testid="provider-import-dialog"]').exists()).toBe(false)
  })

  it('resets preview processing when consuming pending installs throws', async () => {
    const {
      wrapper,
      installHandler,
      queuePendingProviderInstall,
      consumePendingSettingsProviderInstall
    } = await mountSettingsApp({
      routeName: 'settings-provider',
      providerId: 'deepseek',
      failConsumeOnce: true
    })

    const payload = {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://deepseek.example.com/v1',
      apiKey: 'sk-deepseek-demo-key',
      maskedApiKey: 'sk-d...-key',
      iconModelId: 'deepseek',
      willOverwrite: true
    }
    const initialConsumeCount = consumePendingSettingsProviderInstall.mock.calls.length

    await installHandler?.({})
    await flushPromises()

    expect(wrapper.find('[data-testid="provider-import-dialog"]').exists()).toBe(false)
    expect(consumePendingSettingsProviderInstall).toHaveBeenCalledTimes(initialConsumeCount + 1)

    queuePendingProviderInstall(payload)
    await installHandler?.({})
    await flushPromises()

    expect(wrapper.get('[data-testid="provider-import-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="provider-import-kind"]').text()).toBe('builtin')
  })

  it('resets preview processing when requeueing a failed preview throws', async () => {
    const {
      wrapper,
      installHandler,
      queuePendingProviderInstall,
      setPendingSettingsProviderInstall
    } = await mountSettingsApp({
      routeName: 'settings-provider',
      providerId: 'deepseek',
      failProviderNavigationOnce: true,
      failRequeue: true
    })

    const firstPayload = {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://deepseek.example.com/v1',
      apiKey: 'sk-deepseek-demo-key',
      maskedApiKey: 'sk-d...-key',
      iconModelId: 'deepseek',
      willOverwrite: true
    }
    const secondPayload = {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://deepseek.example.com/v1',
      apiKey: 'sk-deepseek-demo-key',
      maskedApiKey: 'sk-d...-key',
      iconModelId: 'deepseek',
      willOverwrite: true
    }

    queuePendingProviderInstall(firstPayload)
    await installHandler?.({})
    await flushPromises()

    expect(setPendingSettingsProviderInstall).toHaveBeenCalledWith(firstPayload)
    expect(wrapper.find('[data-testid="provider-import-dialog"]').exists()).toBe(false)

    queuePendingProviderInstall(secondPayload)
    await installHandler?.({})
    await flushPromises()

    expect(wrapper.get('[data-testid="provider-import-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="provider-import-kind"]').text()).toBe('builtin')
  })
})
