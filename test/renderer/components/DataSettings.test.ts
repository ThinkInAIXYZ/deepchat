import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const buttonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})

const passthroughStub = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const setup = async () => {
  vi.resetModules()

  const toast = vi.fn()
  const syncStore = reactive({
    syncEnabled: true,
    syncFolderPath: '/tmp/deepchat-sync',
    lastSyncTime: 0,
    isBackingUp: false,
    isImporting: false,
    importResult: null,
    backups: [] as Array<{ fileName: string; createdAt: number; size: number }>,
    initialize: vi.fn().mockResolvedValue(undefined),
    selectSyncFolder: vi.fn(),
    openSyncFolder: vi.fn(),
    refreshBackups: vi.fn().mockResolvedValue(undefined),
    startBackup: vi.fn().mockResolvedValue(null),
    importData: vi.fn().mockResolvedValue(null),
    clearImportResult: vi.fn(),
    setSyncEnabled: vi.fn(),
    setSyncFolderPath: vi.fn()
  })

  const presenterMocks = {
    configPresenter: {
      refreshProviderDb: vi.fn().mockResolvedValue({
        status: 'updated',
        lastUpdated: Date.now(),
        providersCount: 1
      })
    },
    devicePresenter: {
      resetDataByType: vi.fn().mockResolvedValue(undefined)
    },
    yoBrowserPresenter: {
      clearSandboxData: vi.fn().mockResolvedValue(undefined)
    }
  }

  vi.doMock('@/stores/sync', () => ({
    useSyncStore: () => syncStore
  }))
  vi.doMock('@/stores/language', () => ({
    useLanguageStore: () => ({
      dir: 'ltr'
    })
  }))
  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: keyof typeof presenterMocks) => presenterMocks[name]
  }))
  vi.doMock('@/components/use-toast', () => ({
    useToast: () => ({
      toast
    })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('pinia', async () => {
    const vue = await vi.importActual<typeof import('vue')>('vue')
    return {
      storeToRefs: () => ({
        backups: vue.toRef(syncStore, 'backups')
      })
    }
  })

  const DataSettings = (await import('../../../src/renderer/settings/components/DataSettings.vue'))
    .default

  const wrapper = mount(DataSettings, {
    global: {
      stubs: {
        ScrollArea: passthroughStub('ScrollArea'),
        Icon: true,
        Dialog: passthroughStub('Dialog'),
        DialogContent: passthroughStub('DialogContent'),
        DialogDescription: passthroughStub('DialogDescription'),
        DialogFooter: passthroughStub('DialogFooter'),
        DialogHeader: passthroughStub('DialogHeader'),
        DialogTitle: passthroughStub('DialogTitle'),
        DialogTrigger: passthroughStub('DialogTrigger'),
        AlertDialog: passthroughStub('AlertDialog'),
        AlertDialogAction: passthroughStub('AlertDialogAction'),
        AlertDialogCancel: passthroughStub('AlertDialogCancel'),
        AlertDialogContent: passthroughStub('AlertDialogContent'),
        AlertDialogDescription: passthroughStub('AlertDialogDescription'),
        AlertDialogFooter: passthroughStub('AlertDialogFooter'),
        AlertDialogHeader: passthroughStub('AlertDialogHeader'),
        AlertDialogTitle: passthroughStub('AlertDialogTitle'),
        AlertDialogTrigger: passthroughStub('AlertDialogTrigger'),
        Button: buttonStub,
        Input: defineComponent({ name: 'Input', template: '<input />' }),
        Switch: defineComponent({ name: 'Switch', template: '<input type="checkbox" />' }),
        RadioGroup: passthroughStub('RadioGroup'),
        RadioGroupItem: passthroughStub('RadioGroupItem'),
        Label: passthroughStub('Label'),
        Separator: passthroughStub('Separator'),
        Select: passthroughStub('Select'),
        SelectContent: passthroughStub('SelectContent'),
        SelectItem: passthroughStub('SelectItem'),
        SelectTrigger: passthroughStub('SelectTrigger'),
        SelectValue: passthroughStub('SelectValue')
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    toast,
    syncStore,
    presenterMocks
  }
}

const findRefreshButton = (wrapper: ReturnType<typeof mount>) => {
  const button = wrapper
    .findAll('button')
    .find((item) => item.text().includes('settings.data.modelConfigUpdate'))

  if (!button) {
    throw new Error('Refresh provider DB button not found')
  }

  return button
}

describe('DataSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls refreshProviderDb, shows loading state, then shows an updated toast', async () => {
    const { wrapper, toast, presenterMocks } = await setup()

    let resolveRefresh:
      | ((value: { status: string; lastUpdated: number; providersCount: number }) => void)
      | null = null
    presenterMocks.configPresenter.refreshProviderDb.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve
      })
    )

    await findRefreshButton(wrapper).trigger('click')
    await nextTick()

    const loadingButton = findRefreshButton(wrapper)
    expect(loadingButton.attributes('disabled')).toBeDefined()
    expect(loadingButton.text()).toContain('settings.data.modelConfigUpdate.updating')

    resolveRefresh?.({
      status: 'updated',
      lastUpdated: Date.now(),
      providersCount: 3
    })
    await flushPromises()

    expect(presenterMocks.configPresenter.refreshProviderDb).toHaveBeenCalledWith(true)
    expect(toast).toHaveBeenCalledWith({
      title: 'settings.data.modelConfigUpdate.updatedTitle',
      description: 'settings.data.modelConfigUpdate.updatedDescription',
      duration: 4000
    })
  })

  it('shows an up-to-date toast when upstream metadata has not changed', async () => {
    const { wrapper, toast, presenterMocks } = await setup()

    presenterMocks.configPresenter.refreshProviderDb.mockResolvedValueOnce({
      status: 'not-modified',
      lastUpdated: Date.now(),
      providersCount: 2
    })

    await findRefreshButton(wrapper).trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalledWith({
      title: 'settings.data.modelConfigUpdate.upToDateTitle',
      description: 'settings.data.modelConfigUpdate.upToDateDescription',
      duration: 4000
    })
  })

  it('shows a destructive toast when refreshing provider metadata fails', async () => {
    const { wrapper, toast, presenterMocks } = await setup()

    presenterMocks.configPresenter.refreshProviderDb.mockResolvedValueOnce({
      status: 'error',
      lastUpdated: null,
      providersCount: 1,
      message: 'network down'
    })

    await findRefreshButton(wrapper).trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalledWith({
      title: 'settings.data.modelConfigUpdate.failedTitle',
      description: 'settings.data.modelConfigUpdate.failedDescription',
      variant: 'destructive',
      duration: 4000
    })
  })
})
