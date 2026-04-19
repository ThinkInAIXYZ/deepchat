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
  const openExternal = vi.fn()
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
    sqlitePresenter: {
      repairSchema: vi.fn().mockResolvedValue({
        startedAt: Date.now(),
        finishedAt: Date.now(),
        status: 'healthy',
        backupPath: null,
        diagnosisBeforeRepair: {
          checkedAt: Date.now(),
          isHealthy: true,
          issues: [],
          repairableIssues: [],
          manualIssues: []
        },
        diagnosisAfterRepair: {
          checkedAt: Date.now(),
          isHealthy: true,
          issues: [],
          repairableIssues: [],
          manualIssues: []
        },
        repairedIssues: [],
        remainingIssues: []
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
  ;(window as typeof window & { api: { openExternal: typeof openExternal } }).api = {
    openExternal
  }
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) =>
        (
          ({
            'settings.data.modelConfigUpdate.linkLabel': 'ThinkInAIXYZ/PublicProviderConf'
          }) as Record<string, string>
        )[key] ?? key
    })
  }))
  vi.doMock('pinia', async () => {
    const vue = await vi.importActual<typeof import('vue')>('vue')
    return {
      storeToRefs: () => ({
        backups: vue.toRef(syncStore, 'backups'),
        isBackingUp: vue.toRef(syncStore, 'isBackingUp'),
        isImporting: vue.toRef(syncStore, 'isImporting')
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
        AlertDialogAction: buttonStub,
        AlertDialogCancel: buttonStub,
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
    openExternal,
    wrapper,
    toast,
    syncStore,
    presenterMocks
  }
}

const findButtonByText = (wrapper: ReturnType<typeof mount>, text: string, label: string) => {
  const button = wrapper.findAllComponents(buttonStub).find((item) => item.text().includes(text))

  if (!button) {
    throw new Error(`${label} button not found`)
  }

  return button
}

const findRefreshButton = (wrapper: ReturnType<typeof mount>) =>
  findButtonByText(wrapper, 'settings.data.modelConfigUpdate', 'Refresh provider DB')

const findRepairButton = (wrapper: ReturnType<typeof mount>) =>
  findButtonByText(wrapper, 'settings.data.databaseRepair', 'Repair database')

const findResetButton = (wrapper: ReturnType<typeof mount>) =>
  findButtonByText(wrapper, 'settings.data.resetData', 'Reset data')

const findResetConfirmButton = (wrapper: ReturnType<typeof mount>) =>
  findButtonByText(wrapper, 'settings.data.confirmReset', 'Reset confirm')

describe('DataSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the consolidated sync and operations sections', async () => {
    const { wrapper } = await setup()

    const headings = wrapper.findAll('h2').map((item) => item.text())

    expect(headings).toEqual([
      'settings.data.syncSectionTitle',
      'settings.data.operationsSectionTitle'
    ])
    expect(wrapper.text()).toContain('settings.data.databaseRepair.title')
    expect(wrapper.text()).toContain('settings.data.modelConfigUpdate.title')
    expect(wrapper.text()).toContain('settings.data.resetData')
    expect(wrapper.text()).toContain('settings.data.yoBrowser.title')
  })

  it('does not render a repair result summary before any repair run', async () => {
    const { wrapper } = await setup()

    expect(wrapper.text()).not.toContain('settings.data.databaseRepair.lastResultLabel')
    expect(wrapper.text()).not.toContain('settings.data.databaseRepair.notCheckedYet')
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

  it('runs schema repair and shows a healthy toast summary', async () => {
    const { wrapper, toast, presenterMocks } = await setup()

    await findRepairButton(wrapper).trigger('click')
    await flushPromises()

    expect(presenterMocks.sqlitePresenter.repairSchema).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith({
      title: 'settings.data.databaseRepair.toastHealthyTitle',
      description: 'settings.data.databaseRepair.toastHealthyDescription',
      variant: 'default'
    })
  })

  it('disables schema repair during backup and blocks both click and auto-run paths', async () => {
    const { wrapper, syncStore, presenterMocks } = await setup()

    syncStore.isBackingUp = true
    await nextTick()

    expect(findRepairButton(wrapper).attributes('disabled')).toBeDefined()

    findRepairButton(wrapper).vm.$emit('click')
    window.dispatchEvent(
      new CustomEvent('deepchat:settings-section', {
        detail: { section: 'database-repair' }
      })
    )
    await flushPromises()

    expect(presenterMocks.sqlitePresenter.repairSchema).not.toHaveBeenCalled()
  })

  it('renders repair summary and manual hint after a repair run with remaining issues', async () => {
    const { wrapper, presenterMocks } = await setup()

    presenterMocks.sqlitePresenter.repairSchema.mockResolvedValueOnce({
      startedAt: Date.now(),
      finishedAt: Date.now(),
      status: 'repaired',
      backupPath: null,
      diagnosisBeforeRepair: {
        checkedAt: Date.now(),
        isHealthy: false,
        issues: [],
        repairableIssues: [],
        manualIssues: []
      },
      diagnosisAfterRepair: {
        checkedAt: Date.now(),
        isHealthy: false,
        issues: [],
        repairableIssues: [],
        manualIssues: []
      },
      repairedIssues: [
        {
          kind: 'missing_column',
          table: 'deepchat_sessions',
          name: 'reasoning_effort',
          repairable: true,
          message: 'Missing column reasoning_effort'
        }
      ],
      remainingIssues: [
        {
          kind: 'column_type_mismatch',
          table: 'messages',
          name: 'metadata',
          repairable: false,
          message: 'Column metadata type mismatch',
          expectedType: 'TEXT',
          actualType: 'BLOB'
        }
      ]
    })

    await findRepairButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('settings.data.databaseRepair.lastResultLabel')
    expect(wrapper.text()).toContain('settings.data.databaseRepair.manualHint')
  })

  it('renders the PublicProviderConf link and opens it externally when clicked', async () => {
    const { wrapper, openExternal } = await setup()

    const projectLink = wrapper.find('a[href="https://github.com/ThinkInAIXYZ/PublicProviderConf"]')

    expect(projectLink.exists()).toBe(true)
    expect(projectLink.text()).toContain('ThinkInAIXYZ/PublicProviderConf')

    await projectLink.trigger('click')

    expect(openExternal).toHaveBeenCalledWith('https://github.com/ThinkInAIXYZ/PublicProviderConf')
  })

  it('keeps reset data enabled when sync is disabled', async () => {
    const { wrapper, syncStore } = await setup()

    syncStore.syncEnabled = false
    await nextTick()

    expect(findResetButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('disables reset actions during import and blocks the reset handler', async () => {
    const { wrapper, syncStore, presenterMocks } = await setup()

    syncStore.isImporting = true
    await nextTick()

    expect(findResetButton(wrapper).attributes('disabled')).toBeDefined()
    expect(findResetConfirmButton(wrapper).attributes('disabled')).toBeDefined()

    findResetConfirmButton(wrapper).vm.$emit('click')
    await flushPromises()

    expect(presenterMocks.devicePresenter.resetDataByType).not.toHaveBeenCalled()
  })
})
