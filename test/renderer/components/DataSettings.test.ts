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

const setup = async (
  options: {
    databaseSecurityGetStatus?: ReturnType<typeof vi.fn>
  } = {}
) => {
  vi.resetModules()

  const toast = vi.fn()
  const openExternal = vi.fn().mockResolvedValue(undefined)
  const browserClient = {
    openExternal,
    clearSandboxData: vi.fn().mockResolvedValue(true)
  }
  const syncStore = reactive({
    syncEnabled: true,
    syncFolderPath: '/tmp/deepchat-sync',
    lastSyncTime: 0,
    isBackingUp: false,
    isImporting: false,
    importResult: null,
    backups: [] as Array<{ fileName: string; createdAt: number; size: number }>,
    cloudConfig: {
      enabled: false,
      endpoint: '',
      bucket: '',
      region: 'auto',
      prefix: 'deepchat-backups',
      accessKeyId: '',
      hasSecret: false,
      safeStorageAvailable: true
    },
    isCloudBusy: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    selectSyncFolder: vi.fn(),
    openSyncFolder: vi.fn(),
    refreshBackups: vi.fn().mockResolvedValue(undefined),
    startBackup: vi.fn().mockResolvedValue(null),
    importData: vi.fn().mockResolvedValue(null),
    clearImportResult: vi.fn(),
    setSyncEnabled: vi.fn(),
    setSyncFolderPath: vi.fn(),
    saveCloudConfig: vi.fn().mockImplementation((config) => {
      syncStore.cloudConfig = {
        ...syncStore.cloudConfig,
        ...config,
        enabled: config.enabled ?? syncStore.cloudConfig.enabled,
        hasSecret: Boolean(config.secretAccessKey) || syncStore.cloudConfig.hasSecret
      }
      return Promise.resolve(syncStore.cloudConfig)
    }),
    testCloud: vi.fn().mockResolvedValue({
      success: true,
      message: 'sync.success.cloudConnected'
    }),
    uploadToCloud: vi.fn().mockResolvedValue({
      success: true,
      message: 'sync.success.cloudUploaded'
    }),
    pullFromCloud: vi.fn().mockResolvedValue({
      success: true,
      message: 'sync.success.cloudPulled',
      count: 1
    })
  })
  const uiSettingsStore = reactive({
    privacyModeEnabled: false,
    setPrivacyModeEnabled: vi.fn((value: boolean) => {
      uiSettingsStore.privacyModeEnabled = value
      return Promise.resolve()
    })
  })
  const databaseSecurityClient = {
    getStatus:
      options.databaseSecurityGetStatus ??
      vi.fn().mockResolvedValue({
        enabled: false,
        cipher: 'sqlcipher',
        safeStorageAvailable: true,
        safeStorageBackend: undefined,
        passwordStorage: 'none',
        manualUnlockRequired: false,
        migrationInProgress: false,
        lastMigrationAt: undefined
      }),
    enable: vi.fn().mockResolvedValue({
      enabled: true,
      cipher: 'sqlcipher',
      safeStorageAvailable: true,
      safeStorageBackend: undefined,
      passwordStorage: 'safeStorage',
      manualUnlockRequired: false,
      migrationInProgress: false,
      lastMigrationAt: Date.now()
    }),
    changePassword: vi.fn(),
    disable: vi.fn(),
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
  }
  const deviceClient = {
    resetDataByType: vi.fn().mockResolvedValue({ reset: true })
  }

  const configClient = {
    refreshProviderDb: vi.fn().mockResolvedValue({
      status: 'updated',
      lastUpdated: Date.now(),
      providersCount: 1
    })
  }

  vi.doMock('@/stores/sync', () => ({
    useSyncStore: () => syncStore
  }))
  vi.doMock('@/stores/uiSettingsStore', () => ({
    useUiSettingsStore: () => uiSettingsStore
  }))
  vi.doMock('@/stores/language', () => ({
    useLanguageStore: () => ({
      dir: 'ltr'
    })
  }))
  vi.doMock('@api/DatabaseSecurityClient', () => ({
    createDatabaseSecurityClient: () => databaseSecurityClient
  }))
  vi.doMock('@api/BrowserClient', () => ({
    createBrowserClient: () => browserClient
  }))
  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: () => configClient
  }))
  vi.doMock('@api/DeviceClient', () => ({
    createDeviceClient: () => deviceClient
  }))
  vi.doMock('@/components/use-toast', () => ({
    useToast: () => ({
      toast
    })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) =>
        (
          ({
            'common.error.operationFailed': 'Operation failed',
            'common.unknownError': 'Unknown error',
            'settings.common.privacyMode': 'Privacy Mode',
            'settings.common.privacyModeDescription':
              'Stop automatic outbound requests owned by DeepChat:',
            'settings.common.privacyModeAutoUpdate': 'App update checks',
            'settings.common.privacyModeProviderDb': 'Provider and model metadata refresh',
            'settings.common.privacyModeAcpRegistry': 'ACP Registry refresh and icon sync',
            'settings.common.privacyModeNpmRegistry': 'MCP npm registry auto-detect',
            'settings.common.privacyModeManualActions':
              'Manual checks and manual refresh actions stay available.',
            'settings.common.privacyModeIntegrations':
              'Configured third-party integrations stay available.',
            'settings.data.cloudSync.providerR2': 'Cloudflare R2',
            'settings.data.cloudSync.providerCustom': 'Custom S3-compatible',
            'settings.data.cloudSync.r2SecretApiTokenError':
              'Use the S3 Secret Access Key, not the Cloudflare API token value.',
            'settings.data.cloudSync.saveAndTest': 'Save and Test',
            'settings.data.cloudSync.saveOnly': 'Save Only',
            'settings.data.cloudSync.testSuccessTitle': 'Connection succeeded',
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
        isImporting: vue.toRef(syncStore, 'isImporting'),
        cloudConfig: vue.toRef(syncStore, 'cloudConfig'),
        isCloudBusy: vue.toRef(syncStore, 'isCloudBusy')
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
        Input: defineComponent({
          name: 'Input',
          props: {
            modelValue: {
              type: String,
              default: ''
            }
          },
          emits: ['update:modelValue'],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
        }),
        Switch: defineComponent({
          name: 'Switch',
          inheritAttrs: false,
          props: {
            modelValue: {
              type: Boolean,
              default: false
            }
          },
          emits: ['update:modelValue'],
          template:
            '<button v-bind="$attrs" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>'
        }),
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
    browserClient,
    wrapper,
    toast,
    syncStore,
    uiSettingsStore,
    databaseSecurityClient,
    deviceClient,
    configClient
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

const findResetEntryButton = (wrapper: ReturnType<typeof mount>) =>
  findButtonByText(wrapper, 'settings.data.resetData', 'Reset data')

const findResetConfirmButton = (wrapper: ReturnType<typeof mount>) =>
  findButtonByText(wrapper, 'settings.data.confirmReset', 'Reset confirm')

const findDatabaseEncryptionButton = (wrapper: ReturnType<typeof mount>, text: string) =>
  findButtonByText(wrapper, text, 'Database encryption')

const findClearSandboxConfirmButton = (wrapper: ReturnType<typeof mount>) =>
  findButtonByText(wrapper, 'settings.data.yoBrowser.confirmAction', 'Clear YoBrowser sandbox')

describe('DataSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the consolidated sync and operations sections', async () => {
    const { wrapper } = await setup()

    const headings = wrapper.findAll('h2').map((item) => item.text())

    expect(headings).not.toContain('settings.data.syncSectionTitle')
    expect(headings).not.toContain('settings.data.operationsSectionTitle')
    expect(wrapper.text()).toContain('Privacy Mode')
    expect(wrapper.text()).toContain('App update checks')
    expect(wrapper.text()).toContain('settings.data.databaseRepair.title')
    expect(wrapper.text()).toContain('settings.data.databaseEncryption.title')
    expect(wrapper.text()).toContain('settings.data.modelConfigUpdate.title')
    expect(wrapper.text()).toContain('settings.data.dangerZone.title')
    expect(wrapper.text()).toContain('settings.data.resetChatData')
    expect(wrapper.text()).toContain('settings.data.resetKnowledgeData')
    expect(wrapper.text()).toContain('settings.data.resetConfig')
    expect(wrapper.text()).toContain('settings.data.resetAll')
    expect(wrapper.text()).toContain('settings.data.yoBrowser.title')
    expect(wrapper.text()).toContain('settings.data.databaseEncryption.systemCredentialStore')
  })

  it('defaults cloud sync setup to the R2 guide with R2 defaults', async () => {
    const { wrapper } = await setup()

    expect(wrapper.get('[data-testid="cloud-provider-r2"]').text()).toContain('Cloudflare R2')
    expect(wrapper.text()).toContain('settings.data.cloudSync.r2GuideTitle')
    expect(wrapper.get('[data-testid="cloud-r2-guide-endpoint"]').text()).toContain(
      'settings.data.cloudSync.endpoint'
    )
    expect(wrapper.get('[data-testid="cloud-r2-guide-access-key"]').text()).toContain(
      'settings.data.cloudSync.accessKeyId'
    )
    expect(wrapper.get('[data-testid="cloud-r2-guide-secret"]').text()).toContain(
      'settings.data.cloudSync.secretAccessKey'
    )
    expect((wrapper.get('#cloud-r2-region').element as HTMLInputElement).value).toBe('auto')
    expect((wrapper.get('#cloud-r2-prefix').element as HTMLInputElement).value).toBe(
      'deepchat-backups'
    )
  })

  it('keeps long sync failure text wrapped inside the error dialog', async () => {
    const { wrapper, syncStore } = await setup()
    syncStore.importResult = {
      success: false,
      message:
        'Unexpected (permanent) at list, context: { uri: https://account.r2.cloudflarestorage.com/deepchat?list-type=2&prefix=deepchat-backups%2F, response: Parts { status: 401, headers: {"content-type":"application/xml"} } } => S3Error { code: "Unauthorized", message: "Unauthorized" }'
    }
    await nextTick()

    const description = wrapper.get('[data-testid="sync-error-dialog-description"]')
    expect(description.classes()).toEqual(
      expect.arrayContaining([
        'max-h-[40vh]',
        'overflow-y-auto',
        'whitespace-pre-wrap',
        'break-words'
      ])
    )
    expect(wrapper.get('[data-testid="sync-error-dialog-footer"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="sync-error-dialog-confirm"]').exists()).toBe(true)
  })

  it('saves the cloud config before testing the cloud connection', async () => {
    const { wrapper, syncStore, toast } = await setup()

    await wrapper.get('#cloud-endpoint').setValue('https://account.r2.cloudflarestorage.com/')
    await wrapper.get('#cloud-bucket').setValue('deepchat')
    await wrapper.get('#cloud-access-key-id').setValue('access-key')
    await wrapper.get('[data-testid="cloud-secret-input"]').setValue('secret-key')
    await wrapper.get('[data-testid="cloud-save-test"]').trigger('click')
    await flushPromises()

    expect(syncStore.saveCloudConfig).toHaveBeenCalledWith({
      endpoint: 'https://account.r2.cloudflarestorage.com',
      bucket: 'deepchat',
      region: 'auto',
      prefix: 'deepchat-backups',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key'
    })
    expect(syncStore.testCloud).toHaveBeenCalledTimes(1)
    expect(syncStore.saveCloudConfig.mock.invocationCallOrder[0]).toBeLessThan(
      syncStore.testCloud.mock.invocationCallOrder[0]
    )
    expect(toast).toHaveBeenCalledWith({
      title: 'Connection succeeded',
      description: undefined,
      variant: 'default',
      duration: 4000
    })
  })

  it('blocks Cloudflare API token values in the R2 secret field', async () => {
    const { wrapper, syncStore } = await setup()

    await wrapper.get('#cloud-endpoint').setValue('https://account.r2.cloudflarestorage.com')
    await wrapper.get('#cloud-bucket').setValue('deepchat')
    await wrapper.get('#cloud-access-key-id').setValue('access-key')
    await wrapper.get('[data-testid="cloud-secret-input"]').setValue('cfat_example')

    expect(wrapper.get('[data-testid="cloud-secret-token-error"]').text()).toContain(
      'Use the S3 Secret Access Key'
    )
    expect(wrapper.get('[data-testid="cloud-save-test"]').attributes('disabled')).toBeDefined()
    expect(syncStore.saveCloudConfig).not.toHaveBeenCalled()
  })

  it('switches cloud sync setup to custom S3-compatible fields', async () => {
    const { wrapper } = await setup()

    await wrapper.get('[data-testid="cloud-provider-custom"]').trigger('click')
    await nextTick()

    expect(wrapper.get('[data-testid="cloud-provider-custom"]').text()).toContain(
      'Custom S3-compatible'
    )
    expect(wrapper.find('#cloud-region').exists()).toBe(true)
    expect(wrapper.find('#cloud-prefix').exists()).toBe(true)
    expect(wrapper.find('#cloud-r2-region').exists()).toBe(false)
  })

  it('falls back a blank custom S3 region to auto when saving cloud config', async () => {
    const { wrapper, syncStore } = await setup()

    await wrapper.get('[data-testid="cloud-provider-custom"]').trigger('click')
    await nextTick()
    await wrapper.get('#cloud-endpoint').setValue('https://minio.example.com/')
    await wrapper.get('#cloud-bucket').setValue('deepchat')
    await wrapper.get('#cloud-region').setValue('')
    await wrapper.get('#cloud-access-key-id').setValue('access-key')
    await wrapper.get('[data-testid="cloud-secret-input"]').setValue('secret-key')

    expect(wrapper.get('[data-testid="cloud-save-only"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-testid="cloud-save-only"]').trigger('click')
    await flushPromises()

    expect(syncStore.saveCloudConfig).toHaveBeenCalledWith({
      endpoint: 'https://minio.example.com',
      bucket: 'deepchat',
      region: 'auto',
      prefix: 'deepchat-backups',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key'
    })
  })

  it('renders a quiet danger zone entry and keeps reset choices in the dialog', async () => {
    const { wrapper } = await setup()

    const resetEntry = findResetEntryButton(wrapper)

    expect(resetEntry.attributes('variant')).toBe('outline')
    expect(resetEntry.classes()).toContain('text-destructive')
    expect(resetEntry.classes()).toContain('border-destructive/30')
    expect(wrapper.find('[data-testid="danger-zone-reset-option-chat"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="danger-zone-reset-option-knowledge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="danger-zone-reset-option-config"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="danger-zone-reset-option-all"]').exists()).toBe(true)
  })

  it('updates privacy mode from the data settings page', async () => {
    const { wrapper, uiSettingsStore } = await setup()

    await wrapper.get('[data-testid="privacy-mode-switch"]').trigger('click')

    expect(uiSettingsStore.setPrivacyModeEnabled).toHaveBeenCalledWith(true)
  })

  it('wires the privacy switch to its visible label and description', async () => {
    const { wrapper } = await setup()

    const privacySwitch = wrapper.get('[data-testid="privacy-mode-switch"]')

    expect(privacySwitch.attributes('aria-labelledby')).toBe('privacy-mode-label')
    expect(privacySwitch.attributes('aria-describedby')).toBe('privacy-mode-desc')
    expect(wrapper.get('#privacy-mode-label').text()).toContain('Privacy Mode')
    expect(wrapper.get('#privacy-mode-desc').text()).toContain(
      'Stop automatic outbound requests owned by DeepChat:'
    )
  })

  it('enables database encryption after matching password input', async () => {
    const { wrapper, databaseSecurityClient, toast } = await setup()
    await findDatabaseEncryptionButton(
      wrapper,
      'settings.data.databaseEncryption.setPasswordButton'
    ).trigger('click')
    await nextTick()

    await wrapper.get('#database-new-password').setValue('sqlite-pass')
    await wrapper.get('#database-confirm-password').setValue('sqlite-pass')
    await findDatabaseEncryptionButton(
      wrapper,
      'settings.data.databaseEncryption.enableButton'
    ).trigger('click')
    await flushPromises()

    expect(databaseSecurityClient.enable).toHaveBeenCalledWith('sqlite-pass')
    expect(toast).toHaveBeenCalledWith({
      title: 'settings.data.databaseEncryption.enabledTitle',
      duration: 4000
    })
  })

  it('shows database encryption status as unknown when status loading fails', async () => {
    const { wrapper } = await setup({
      databaseSecurityGetStatus: vi.fn().mockRejectedValue(new Error('status unavailable'))
    })

    expect(wrapper.text()).toContain('settings.data.databaseEncryption.unknown')
    expect(wrapper.text()).not.toContain('settings.data.databaseEncryption.disabled')
    expect(wrapper.text()).not.toContain('settings.data.databaseEncryption.notRequired')
    expect(
      wrapper
        .findAllComponents(buttonStub)
        .some((button) =>
          button.text().includes('settings.data.databaseEncryption.setPasswordButton')
        )
    ).toBe(false)
  })

  it('shows an error toast when updating privacy mode fails', async () => {
    const { wrapper, toast, uiSettingsStore } = await setup()

    uiSettingsStore.setPrivacyModeEnabled = vi.fn().mockRejectedValue(new Error('IPC failed'))

    await wrapper.get('[data-testid="privacy-mode-switch"]').trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalledWith({
      title: 'Operation failed',
      description: 'IPC failed',
      variant: 'destructive'
    })
  })

  it('does not render a repair result summary before any repair run', async () => {
    const { wrapper } = await setup()

    expect(wrapper.text()).not.toContain('settings.data.databaseRepair.lastResultLabel')
    expect(wrapper.text()).not.toContain('settings.data.databaseRepair.notCheckedYet')
  })

  it('calls refreshProviderDb, shows loading state, then shows an updated toast', async () => {
    const { wrapper, toast, configClient } = await setup()

    let resolveRefresh:
      | ((value: { status: string; lastUpdated: number; providersCount: number }) => void)
      | null = null
    configClient.refreshProviderDb.mockReturnValueOnce(
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

    expect(configClient.refreshProviderDb).toHaveBeenCalledWith(true)
    expect(toast).toHaveBeenCalledWith({
      title: 'settings.data.modelConfigUpdate.updatedTitle',
      description: 'settings.data.modelConfigUpdate.updatedDescription',
      duration: 4000
    })
  })

  it('shows an up-to-date toast when upstream metadata has not changed', async () => {
    const { wrapper, toast, configClient } = await setup()

    configClient.refreshProviderDb.mockResolvedValueOnce({
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
    const { wrapper, toast, configClient } = await setup()

    configClient.refreshProviderDb.mockResolvedValueOnce({
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
    const { wrapper, toast, databaseSecurityClient } = await setup()

    await findRepairButton(wrapper).trigger('click')
    await flushPromises()

    expect(databaseSecurityClient.repairSchema).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith({
      title: 'settings.data.databaseRepair.toastHealthyTitle',
      description: 'settings.data.databaseRepair.toastHealthyDescription',
      variant: 'default'
    })
  })

  it('disables schema repair during backup and blocks both click and auto-run paths', async () => {
    const { wrapper, syncStore, databaseSecurityClient } = await setup()

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

    expect(databaseSecurityClient.repairSchema).not.toHaveBeenCalled()
  })

  it('renders repair summary and manual hint after a repair run with remaining issues', async () => {
    const { wrapper, databaseSecurityClient } = await setup()

    databaseSecurityClient.repairSchema.mockResolvedValueOnce({
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

  it('clears YoBrowser sandbox data through BrowserClient', async () => {
    const { wrapper, browserClient, toast } = await setup()

    await findClearSandboxConfirmButton(wrapper).trigger('click')
    await flushPromises()

    expect(browserClient.clearSandboxData).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith({
      title: 'settings.data.yoBrowser.clearedTitle',
      description: 'settings.data.yoBrowser.clearedDescription',
      duration: 4000
    })
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

    expect(findResetEntryButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(findResetConfirmButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('disables reset actions during import and blocks the reset handler', async () => {
    const { wrapper, syncStore, deviceClient } = await setup()

    syncStore.isImporting = true
    await nextTick()

    expect(findResetEntryButton(wrapper).attributes('disabled')).toBeDefined()
    expect(findResetConfirmButton(wrapper).attributes('disabled')).toBeDefined()

    findResetConfirmButton(wrapper).vm.$emit('click')
    await flushPromises()

    expect(deviceClient.resetDataByType).not.toHaveBeenCalled()
  })

  it('defaults reset type to chat when opening the reset dialog', async () => {
    const { wrapper, deviceClient } = await setup()

    await wrapper.find('[data-testid="danger-zone-reset-option-all"]').trigger('click')
    await findResetEntryButton(wrapper).trigger('click')
    await findResetConfirmButton(wrapper).trigger('click')
    await flushPromises()

    expect(deviceClient.resetDataByType).toHaveBeenCalledWith('chat')
  })

  it('calls resetDataByType with the selected dialog reset type', async () => {
    const { wrapper, deviceClient } = await setup()

    await findResetEntryButton(wrapper).trigger('click')
    await wrapper.find('[data-testid="danger-zone-reset-option-knowledge"]').trigger('click')
    await findResetConfirmButton(wrapper).trigger('click')
    await flushPromises()

    expect(deviceClient.resetDataByType).toHaveBeenCalledWith('knowledge')
  })
})
