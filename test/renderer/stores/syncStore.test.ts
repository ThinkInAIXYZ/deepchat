import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const setup = async (options: { initialize?: boolean } = {}) => {
  vi.resetModules()
  vi.doUnmock('pinia')

  const configClient = {
    getSyncEnabled: vi.fn().mockResolvedValue(true),
    getSyncFolderPath: vi.fn().mockResolvedValue('/sync/original'),
    setSyncEnabled: vi.fn().mockResolvedValue(undefined),
    setSyncFolderPath: vi.fn().mockResolvedValue(undefined),
    onSyncSettingsChanged: vi.fn(() => () => undefined)
  }
  const syncClient = {
    getBackupStatus: vi.fn().mockResolvedValue({
      lastBackupTime: 0,
      isBackingUp: false
    }),
    listBackups: vi.fn().mockResolvedValue([]),
    startBackup: vi.fn().mockResolvedValue({
      fileName: 'backup.db',
      createdAt: Date.now(),
      size: 128
    }),
    importFromSync: vi.fn().mockResolvedValue({
      success: true,
      message: 'sync.success.importComplete',
      count: 1
    }),
    openSyncFolder: vi.fn().mockResolvedValue(undefined),
    getCloudConfig: vi.fn().mockResolvedValue({
      enabled: false,
      endpoint: '',
      bucket: '',
      region: 'auto',
      prefix: 'deepchat-backups',
      accessKeyId: '',
      hasSecret: false,
      safeStorageAvailable: true
    }),
    setCloudConfig: vi.fn(),
    testCloudConnection: vi.fn(),
    uploadToCloud: vi.fn(),
    pullFromCloud: vi.fn(),
    onBackupStarted: vi.fn(() => () => undefined),
    onBackupCompleted: vi.fn(() => () => undefined),
    onBackupError: vi.fn(() => () => undefined),
    onImportStarted: vi.fn(() => () => undefined),
    onImportCompleted: vi.fn(() => () => undefined),
    onImportError: vi.fn(() => () => undefined)
  }
  const deviceClient = {
    selectDirectory: vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['/sync/selected']
    }),
    restartApp: vi.fn().mockResolvedValue(undefined)
  }
  const queryData = ref<unknown[]>([])
  const refetch = vi.fn(async () => {
    queryData.value = await syncClient.listBackups()
  })

  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: () => configClient
  }))
  vi.doMock('@api/SyncClient', () => ({
    createSyncClient: () => syncClient
  }))
  vi.doMock('@api/DeviceClient', () => ({
    createDeviceClient: () => deviceClient
  }))
  vi.doMock('@/composables/useIpcQuery', () => ({
    useIpcQuery: () => ({
      data: queryData,
      refetch
    })
  }))
  vi.doMock('@/composables/useIpcMutation', () => ({
    useIpcMutation: (options: { mutation: (...args: unknown[]) => Promise<unknown> }) => ({
      mutateAsync: (args: unknown[]) => options.mutation(...args)
    })
  }))

  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  const { useSyncStore } = await import('@/stores/sync')
  const store = useSyncStore()
  if (options.initialize !== false) {
    await store.initialize()
  }

  return {
    configClient,
    deviceClient,
    refetch,
    store,
    syncClient
  }
}

describe('syncStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('commits sync settings only after persistence succeeds', async () => {
    const { configClient, store } = await setup()
    configClient.setSyncEnabled.mockRejectedValueOnce(new Error('IPC failed'))
    configClient.setSyncFolderPath.mockRejectedValueOnce(new Error('IPC failed'))

    await expect(store.setSyncEnabled(false)).rejects.toThrow('IPC failed')
    expect(store.syncEnabled).toBe(true)

    await expect(store.setSyncFolderPath('/sync/rejected')).rejects.toThrow('IPC failed')
    expect(store.syncFolderPath).toBe('/sync/original')
  })

  it('returns the selected folder only after it has been persisted', async () => {
    const { configClient, refetch, store } = await setup()
    refetch.mockClear()

    await expect(store.selectSyncFolder()).resolves.toBe('/sync/selected')

    expect(configClient.setSyncFolderPath).toHaveBeenCalledWith('/sync/selected')
    expect(store.syncFolderPath).toBe('/sync/selected')
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('propagates backup failures and always releases the busy state', async () => {
    const { store, syncClient } = await setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    syncClient.startBackup.mockRejectedValueOnce(new Error('native backup failed'))

    await expect(store.startBackup()).rejects.toThrow('native backup failed')
    expect(store.isBackingUp).toBe(false)
    expect(consoleError).toHaveBeenCalledWith('[SyncStore] Backup failed', expect.any(Error))

    consoleError.mockRestore()
  })

  it('normalizes import exceptions before exposing them to the renderer', async () => {
    const { store, syncClient } = await setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    syncClient.importFromSync.mockRejectedValueOnce(
      new Error('Unauthorized at https://storage.example.test/private')
    )

    await expect(store.importData('backup.db')).resolves.toEqual({
      success: false,
      message: 'sync.error.importFailed'
    })
    expect(store.importResult).toEqual({
      success: false,
      message: 'sync.error.importFailed'
    })
    expect(consoleError).toHaveBeenCalledWith('[SyncStore] Import failed', expect.any(Error))

    consoleError.mockRestore()
  })

  it('propagates cloud configuration load failures without replacing the last known state', async () => {
    const { store, syncClient } = await setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    syncClient.getCloudConfig.mockRejectedValueOnce(new Error('safeStorage unavailable'))

    await expect(store.loadCloudConfig()).rejects.toThrow('safeStorage unavailable')
    expect(store.cloudConfig).toMatchObject({
      region: 'auto',
      prefix: 'deepchat-backups',
      safeStorageAvailable: true
    })
    expect(consoleError).toHaveBeenCalledWith(
      '[SyncStore] Failed to load cloud config',
      expect.any(Error)
    )

    consoleError.mockRestore()
  })

  it('registers sync listeners even when initial loading fails', async () => {
    const { store, syncClient, configClient } = await setup({ initialize: false })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    syncClient.getCloudConfig.mockRejectedValueOnce(new Error('cloud config unavailable'))

    await expect(store.initialize()).rejects.toThrow('cloud config unavailable')
    expect(syncClient.onBackupStarted).toHaveBeenCalledOnce()
    expect(syncClient.onImportError).toHaveBeenCalledOnce()
    expect(configClient.onSyncSettingsChanged).toHaveBeenCalledOnce()

    consoleError.mockRestore()
  })
})
