import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const passthroughStub = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

const setup = async (
  options: {
    databaseSecurityGetStatus?: ReturnType<typeof vi.fn>
    realAlertDialog?: boolean
    syncInitialize?: ReturnType<typeof vi.fn>
  } = {}
) => {
  vi.resetModules()

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
    initialize: options.syncInitialize ?? vi.fn().mockResolvedValue(undefined),
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
  const notifyRenderer = vi.fn(() => true)

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
  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        const translated =
          (
            {
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
            } as Record<string, string>
          )[key] ?? key
        return params?.result ? `${translated}: ${String(params.result)}` : translated
      }
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
    ...(options.realAlertDialog ? { attachTo: document.body } : {}),
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
        AlertDialog: options.realAlertDialog ? false : passthroughStub('AlertDialog'),
        AlertDialogAction: options.realAlertDialog ? false : buttonStub,
        AlertDialogAsyncAction: options.realAlertDialog ? false : buttonStub,
        AlertDialogCancel: options.realAlertDialog ? false : buttonStub,
        AlertDialogContent: options.realAlertDialog ? false : passthroughStub('AlertDialogContent'),
        AlertDialogDescription: options.realAlertDialog
          ? false
          : passthroughStub('AlertDialogDescription'),
        AlertDialogFooter: options.realAlertDialog ? false : passthroughStub('AlertDialogFooter'),
        AlertDialogHeader: options.realAlertDialog ? false : passthroughStub('AlertDialogHeader'),
        AlertDialogTitle: options.realAlertDialog ? false : passthroughStub('AlertDialogTitle'),
        AlertDialogTrigger: options.realAlertDialog ? false : passthroughStub('AlertDialogTrigger'),
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
    syncStore,
    uiSettingsStore,
    databaseSecurityClient,
    deviceClient,
    configClient,
    notifyRenderer
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

const findBackupButton = (wrapper: ReturnType<typeof mount>) =>
  findButtonByText(wrapper, 'settings.data.startBackup', 'Start backup')

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

  afterEach(() => {
    document.body.innerHTML = ''
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
    expect(description.text()).toBe('sync.error.importFailed')
    expect(description.text()).not.toContain('Unauthorized')
    expect(description.text()).not.toContain('cloudflarestorage.com')
    expect(wrapper.get('[data-testid="sync-error-dialog-footer"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="sync-error-dialog-confirm"]').exists()).toBe(true)
  })

  it('saves the cloud config before testing the cloud connection', async () => {
    const { wrapper, syncStore } = await setup()

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
    const feedback = wrapper.get('[data-testid="inline-operation-feedback"]')
    expect(feedback.attributes('data-status')).toBe('success')
    expect(feedback.text()).toContain('Connection succeeded')
  })

  it('keeps cloud connection failures visible after applying the persisted config snapshot', async () => {
    const { wrapper, syncStore } = await setup()
    syncStore.testCloud.mockResolvedValueOnce({
      success: false,
      message: 'sync.error.cloudConnectionFailed'
    })

    await wrapper.get('#cloud-endpoint').setValue('https://account.r2.cloudflarestorage.com/')
    await wrapper.get('#cloud-bucket').setValue('deepchat')
    await wrapper.get('#cloud-access-key-id').setValue('access-key')
    await wrapper.get('[data-testid="cloud-secret-input"]').setValue('secret-key')
    await wrapper.get('[data-testid="cloud-save-test"]').trigger('click')
    await flushPromises()

    const feedback = wrapper.get('[data-testid="inline-operation-feedback"]')
    expect(feedback.attributes('data-status')).toBe('error')
    expect(feedback.text()).toContain('settings.data.cloudSync.testFailedTitle')
  })

  it('keeps a failed cloud save inline and preserves the unsaved draft', async () => {
    const { wrapper, syncStore } = await setup()
    syncStore.saveCloudConfig.mockRejectedValueOnce(
      new Error('Authorization failed for secret-key@example.test')
    )

    await wrapper.get('#cloud-endpoint').setValue('https://account.r2.cloudflarestorage.com/')
    await wrapper.get('#cloud-bucket').setValue('deepchat')
    await wrapper.get('#cloud-access-key-id').setValue('access-key')
    await wrapper.get('[data-testid="cloud-secret-input"]').setValue('secret-key')
    await wrapper.get('[data-testid="cloud-save-only"]').trigger('click')
    await flushPromises()

    const feedback = wrapper.get('[data-testid="inline-operation-feedback"]')
    expect(feedback.attributes('data-status')).toBe('error')
    expect(feedback.text()).toContain('Operation failed')
    expect(wrapper.text()).not.toContain('secret-key@example.test')
    expect((wrapper.get('#cloud-bucket').element as HTMLInputElement).value).toBe('deepchat')

    const { settingsLeaveGuard } =
      await import('../../../src/renderer/settings/services/settingsLeaveGuard')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('dirty')
    wrapper.unmount()
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('clean')
  })

  it('marks cloud persistence busy until the write settles', async () => {
    const { wrapper, syncStore } = await setup()
    let resolveSave: (() => void) | undefined
    syncStore.saveCloudConfig.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSave = resolve
      })
    )

    await wrapper.get('#cloud-endpoint').setValue('https://account.r2.cloudflarestorage.com/')
    await wrapper.get('#cloud-bucket').setValue('deepchat')
    await wrapper.get('#cloud-access-key-id').setValue('access-key')
    await wrapper.get('[data-testid="cloud-secret-input"]').setValue('secret-key')
    await wrapper.get('[data-testid="cloud-save-only"]').trigger('click')
    await nextTick()

    const { settingsLeaveGuard } =
      await import('../../../src/renderer/settings/services/settingsLeaveGuard')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('busy')
    expect(wrapper.get('[data-testid="inline-operation-feedback"]').attributes('data-status')).toBe(
      'pending'
    )

    resolveSave?.()
    await flushPromises()

    expect(settingsLeaveGuard.getSnapshot().risk).toBe('clean')
    wrapper.unmount()
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
    const { wrapper, databaseSecurityClient } = await setup()
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
    const feedback = wrapper.get('[data-testid="inline-operation-feedback"]')
    expect(feedback.attributes('data-status')).toBe('success')
    expect(feedback.text()).toContain('settings.data.databaseEncryption.enabledTitle')
  })

  it('keeps database encryption failures in the dialog without exposing details', async () => {
    const { wrapper, databaseSecurityClient } = await setup()
    databaseSecurityClient.enable.mockRejectedValueOnce(
      new Error('SQLCipher rejected sqlite-pass at /private/database.db')
    )

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

    const feedback = wrapper.get('[data-testid="inline-operation-feedback"]')
    expect(feedback.attributes('data-status')).toBe('error')
    expect(feedback.text()).toContain('settings.data.databaseEncryption.failedTitle')
    expect(wrapper.text()).not.toContain('/private/database.db')
    expect(wrapper.text()).not.toContain('sqlite-pass')
    expect(
      (wrapper.vm as unknown as { isDatabaseEncryptionDialogOpen: boolean })
        .isDatabaseEncryptionDialogOpen
    ).toBe(true)
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

  it('keeps privacy update failures inline without exposing transport details', async () => {
    const { wrapper, uiSettingsStore } = await setup()

    uiSettingsStore.setPrivacyModeEnabled = vi.fn().mockRejectedValue(new Error('IPC failed'))

    await wrapper.get('[data-testid="privacy-mode-switch"]').trigger('click')
    await flushPromises()

    const feedback = wrapper.get('[data-testid="inline-operation-feedback"]')
    expect(feedback.attributes('data-status')).toBe('error')
    expect(feedback.text()).toContain('Operation failed')
    expect(feedback.text()).not.toContain('IPC failed')
  })

  it('does not render a repair result summary before any repair run', async () => {
    const { wrapper } = await setup()

    expect(wrapper.text()).not.toContain('settings.data.databaseRepair.lastResultLabel')
    expect(wrapper.text()).not.toContain('settings.data.databaseRepair.notCheckedYet')
  })

  it('calls refreshProviderDb, shows loading state, then reports a transient result', async () => {
    const { wrapper, configClient, notifyRenderer } = await setup()

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
    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'success',
      code: 'settings.data.modelConfig.updated',
      title: 'settings.data.modelConfigUpdate.updatedTitle',
      description: 'settings.data.modelConfigUpdate.updatedDescription'
    })
  })

  it('reports a transient up-to-date result when upstream metadata has not changed', async () => {
    const { wrapper, configClient, notifyRenderer } = await setup()

    configClient.refreshProviderDb.mockResolvedValueOnce({
      status: 'not-modified',
      lastUpdated: Date.now(),
      providersCount: 2
    })

    await findRefreshButton(wrapper).trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'success',
      code: 'settings.data.modelConfig.upToDate',
      title: 'settings.data.modelConfigUpdate.upToDateTitle',
      description: 'settings.data.modelConfigUpdate.upToDateDescription'
    })
  })

  it('reports provider metadata refresh failures as transient feedback', async () => {
    const { wrapper, configClient, notifyRenderer } = await setup()

    configClient.refreshProviderDb.mockResolvedValueOnce({
      status: 'error',
      lastUpdated: null,
      providersCount: 1,
      message: 'network down'
    })

    await findRefreshButton(wrapper).trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'settings.data.modelConfig.updateFailed',
      title: 'settings.data.modelConfigUpdate.failedTitle',
      description: 'settings.data.modelConfigUpdate.failedDescription'
    })
    expect(wrapper.text()).not.toContain('network down')
  })

  it('runs schema repair and keeps the healthy result in the section', async () => {
    const { wrapper, databaseSecurityClient } = await setup()

    await findRepairButton(wrapper).trigger('click')
    await flushPromises()

    expect(databaseSecurityClient.repairSchema).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('settings.data.databaseRepair.lastResultLabel')
    expect(wrapper.text()).toContain('settings.data.databaseRepair.summaryHealthy')
    expect(wrapper.find('[data-testid="inline-operation-feedback"]').exists()).toBe(false)
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
    const { wrapper, browserClient, notifyRenderer } = await setup()

    await findClearSandboxConfirmButton(wrapper).trigger('click')
    await flushPromises()

    expect(browserClient.clearSandboxData).toHaveBeenCalledTimes(1)
    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'success',
      code: 'settings.data.sandbox.cleared',
      title: 'settings.data.yoBrowser.clearedTitle',
      description: 'settings.data.yoBrowser.clearedDescription'
    })
  })

  it('keeps the sandbox confirmation open when clearing fails', async () => {
    const { wrapper, browserClient, notifyRenderer } = await setup({ realAlertDialog: true })
    browserClient.clearSandboxData.mockRejectedValueOnce(
      new Error('Failed to delete /private/sandbox/session')
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await wrapper.get('[data-testid="yobrowser-clear-sandbox-button"]').trigger('click')
    await flushPromises()
    document
      .querySelector<HTMLButtonElement>('[data-testid="yobrowser-clear-sandbox-confirm"]')!
      .click()
    await flushPromises()

    const sandboxConfirm = document.querySelector('[data-testid="yobrowser-clear-sandbox-confirm"]')
    expect(sandboxConfirm?.closest('[data-slot="alert-dialog-content"]')?.textContent).toContain(
      'settings.data.yoBrowser.clearFailedTitle'
    )
    expect(notifyRenderer).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('/private/sandbox/session')
    expect(document.querySelector('[data-testid="yobrowser-clear-sandbox-confirm"]')).not.toBeNull()

    document
      .querySelector<HTMLButtonElement>('[data-testid="yobrowser-clear-sandbox-confirm"]')!
      .click()
    await flushPromises()

    expect(browserClient.clearSandboxData).toHaveBeenCalledTimes(2)
    expect(
      (wrapper.vm as unknown as { isClearSandboxDialogOpen: boolean }).isClearSandboxDialogOpen
    ).toBe(false)
    expect(notifyRenderer).toHaveBeenCalledOnce()
    consoleError.mockRestore()
    wrapper.unmount()
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

    findResetConfirmButton(wrapper).vm.$emit('click', new MouseEvent('click'))
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

  it('keeps reset failures in the confirmation surface without exposing details', async () => {
    const { wrapper, deviceClient } = await setup({ realAlertDialog: true })
    const pending = deferred<{ reset: boolean }>()
    deviceClient.resetDataByType.mockReturnValueOnce(pending.promise)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await findResetEntryButton(wrapper).trigger('click')
    await flushPromises()
    const resetConfirm = wrapper
      .findAllComponents({ name: 'AlertDialogAsyncAction' })
      .find((candidate) => candidate.attributes('data-testid') === 'danger-zone-reset-confirm')
    if (!resetConfirm) throw new Error('Reset confirmation button not found')
    await resetConfirm.trigger('click')
    const resetContent = resetConfirm.element.closest('[data-slot="alert-dialog-content"]')
    await vi.waitFor(() => {
      expect(deviceClient.resetDataByType).toHaveBeenCalledOnce()
      expect(resetConfirm.attributes('disabled')).toBeDefined()
    })
    resetContent
      ?.querySelector<HTMLElement>('[data-testid="danger-zone-reset-option-knowledge"]')
      ?.click()
    expect((wrapper.vm as unknown as { resetType: string }).resetType).toBe('chat')

    pending.reject(new Error('Unable to reset /private/deepchat.db'))
    await flushPromises()

    await vi.waitFor(() => {
      expect(
        resetContent
          ?.querySelector('[data-testid="inline-operation-feedback"]')
          ?.getAttribute('data-status')
      ).toBe('error')
    })
    const feedback = resetContent?.querySelector('[data-testid="inline-operation-feedback"]')
    expect(feedback?.textContent).toContain('Operation failed')
    expect(document.body.textContent).not.toContain('/private/deepchat.db')
    expect((wrapper.vm as unknown as { isResetDialogOpen: boolean }).isResetDialogOpen).toBe(true)
    expect(resetConfirm.element.isConnected).toBe(true)

    await resetConfirm.trigger('click')
    await vi.waitFor(() => {
      expect(deviceClient.resetDataByType).toHaveBeenCalledTimes(2)
    })

    expect((wrapper.vm as unknown as { isResetDialogOpen: boolean }).isResetDialogOpen).toBe(false)
    consoleError.mockRestore()
    wrapper.unmount()
  })

  it('keeps sync persistence failures inline without changing the visible setting', async () => {
    const { wrapper, syncStore } = await setup()
    syncStore.setSyncEnabled.mockRejectedValueOnce(new Error('IPC token leaked'))

    wrapper.findComponent({ name: 'Switch' }).vm.$emit('update:modelValue', false)
    await flushPromises()

    expect(syncStore.syncEnabled).toBe(true)
    const feedback = wrapper.get('[data-testid="inline-operation-feedback"]')
    expect(feedback.attributes('data-status')).toBe('error')
    expect(feedback.text()).toContain('Operation failed')
    expect(wrapper.text()).not.toContain('IPC token leaked')
  })

  it('reports backup failures as transient feedback', async () => {
    const { wrapper, syncStore, notifyRenderer } = await setup()
    syncStore.startBackup.mockRejectedValueOnce(new Error('Backup path /private/sync failed'))

    await findBackupButton(wrapper).trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'settings.data.sync.backupFailed',
      title: 'Operation failed'
    })
    expect(wrapper.text()).not.toContain('/private/sync')
  })

  it('reports completed backups as transient feedback', async () => {
    const { wrapper, syncStore, notifyRenderer } = await setup()
    syncStore.startBackup.mockResolvedValueOnce({
      fileName: 'deepchat-20260730.db',
      createdAt: 1_785_369_600_000,
      size: 4_096
    })

    await findBackupButton(wrapper).trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'success',
      code: 'settings.data.sync.backupSucceeded',
      title: 'settings.data.toast.backupSuccessTitle'
    })
  })

  it('offers an inline retry when initial sync settings loading fails', async () => {
    const initialize = vi
      .fn()
      .mockRejectedValueOnce(new Error('cloud config at /private/config failed'))
      .mockResolvedValueOnce(undefined)
    const { wrapper } = await setup({ syncInitialize: initialize })

    const feedback = wrapper.get('[data-testid="inline-operation-feedback"]')
    expect(feedback.attributes('data-status')).toBe('error')
    expect(feedback.text()).toContain('Operation failed')
    expect(wrapper.text()).not.toContain('/private/config')
    expect(wrapper.findComponent({ name: 'Switch' }).attributes('disabled')).toBeDefined()

    const retryButton = wrapper.findAll('button').find((button) => button.text() === 'common.retry')
    if (!retryButton) throw new Error('Retry sync initialization button not found')
    await retryButton.trigger('click')
    await flushPromises()

    expect(initialize).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="inline-operation-feedback"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'Switch' }).attributes('disabled')).toBeUndefined()
  })
})
