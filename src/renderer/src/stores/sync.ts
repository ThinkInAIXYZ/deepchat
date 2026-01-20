import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { useIpcMutation } from '@/composables/useIpcMutation'
import { CONFIG_EVENTS, SYNC_EVENTS } from '@/events'
import type { EntryKey, UseQueryReturn } from '@pinia/colada'
import type { SyncBackupInfo } from '@shared/presenter'

export const useSyncStore = defineStore('sync', () => {
  const syncEnabled = ref(false)
  const syncFolderPath = ref('')
  const lastSyncTime = ref(0)
  const isBackingUp = ref(false)
  const isImporting = ref(false)
  const importResult = ref<{ success: boolean; message: string; count?: number } | null>(null)
  const isInitialized = ref(false)
  let listenersBound = false

  const configPresenter = usePresenter('configPresenter')
  const syncPresenter = usePresenter('syncPresenter')
  const devicePresenter = usePresenter('devicePresenter')
  const ipcRenderer = window?.electron?.ipcRenderer ?? null

  const backupQueryKey = (): EntryKey => ['sync', 'backups'] as const

  const backupsQuery = useIpcQuery({
    presenter: 'syncPresenter',
    method: 'listBackups',
    key: backupQueryKey,
    staleTime: 60_000,
    gcTime: 300_000
  }) as UseQueryReturn<SyncBackupInfo[]>

  const backups = computed(() => {
    const list = backupsQuery.data.value ?? []
    return [...list].sort((a, b) => b.createdAt - a.createdAt)
  })

  const refreshBackups = async () => {
    try {
      await backupsQuery.refetch()
    } catch (error) {
      console.error('刷新备份列表失败:', error)
    }
  }

  const startBackupMutation = useIpcMutation({
    presenter: 'syncPresenter',
    method: 'startBackup',
    invalidateQueries: () => [backupQueryKey()]
  })

  const startBackup = async (): Promise<SyncBackupInfo | null> => {
    if (!syncEnabled.value || isBackingUp.value) return null

    isBackingUp.value = true
    try {
      const backupInfo = (await startBackupMutation.mutateAsync([])) as SyncBackupInfo | null
      if (backupInfo) {
        await refreshBackups()
      }
      return backupInfo
    } catch (error) {
      console.error('backup failed:', error)
      return null
    } finally {
      isBackingUp.value = false
    }
  }

  const importBackupMutation = useIpcMutation({
    presenter: 'syncPresenter',
    method: 'importFromSync',
    invalidateQueries: () => [backupQueryKey()]
  })

  const importData = async (
    backupFile: string,
    mode: 'increment' | 'overwrite' = 'increment'
  ): Promise<{ success: boolean; message: string; count?: number } | null> => {
    if (!syncEnabled.value || isImporting.value || !backupFile) return null

    isImporting.value = true
    try {
      const result = (await importBackupMutation.mutateAsync([backupFile, mode])) as {
        success: boolean
        message: string
        count?: number
      }
      importResult.value = result.success ? null : result
      return result
    } catch (error) {
      console.error('import failed:', error)
      importResult.value = {
        success: false,
        message: 'sync.error.importFailed'
      }
      return importResult.value
    } finally {
      isImporting.value = false
      await refreshBackups()
    }
  }

  const initialize = async () => {
    if (isInitialized.value) return

    syncEnabled.value = await configPresenter.getSyncEnabled()
    syncFolderPath.value = await configPresenter.getSyncFolderPath()

    const status = await syncPresenter.getBackupStatus()
    lastSyncTime.value = status.lastBackupTime
    isBackingUp.value = status.isBackingUp

    await refreshBackups()
    isInitialized.value = true
  }

  const setSyncEnabled = async (enabled: boolean) => {
    syncEnabled.value = enabled
    await configPresenter.setSyncEnabled(enabled)
  }

  const setSyncFolderPath = async (path: string) => {
    syncFolderPath.value = path
    await configPresenter.setSyncFolderPath(path)
    await refreshBackups()
  }

  const selectSyncFolder = async () => {
    const result = await devicePresenter.selectDirectory()
    if (result && !result.canceled && result.filePaths.length > 0) {
      await setSyncFolderPath(result.filePaths[0])
    }
  }

  const openSyncFolder = async () => {
    if (!syncEnabled.value) return
    await syncPresenter.openSyncFolder()
  }

  const restartApp = async () => {
    await devicePresenter.restartApp()
  }

  const clearImportResult = () => {
    importResult.value = null
  }

  const bindEventListeners = () => {
    if (!ipcRenderer || listenersBound) return () => undefined

    listenersBound = true
    const unsubscribers: Array<() => void> = []

    const register = (event: string, handler: (...args: unknown[]) => void) => {
      ipcRenderer.on(event, handler)
      unsubscribers.push(() => ipcRenderer.removeListener(event, handler))
    }

    const handleBackupCompleted = (...args: unknown[]) => {
      const time = args[1]
      if (typeof time === 'number') {
        lastSyncTime.value = time
      }
      isBackingUp.value = false
    }

    const handleSyncSettingsChanged = async (...args: unknown[]) => {
      const payload = args[1] as { enabled?: boolean; folderPath?: string } | undefined
      if (!payload) return

      if (typeof payload.enabled === 'boolean') {
        syncEnabled.value = payload.enabled
      }
      if (typeof payload.folderPath === 'string' && payload.folderPath !== syncFolderPath.value) {
        syncFolderPath.value = payload.folderPath
        await refreshBackups()
      } else if (typeof payload.folderPath === 'string') {
        syncFolderPath.value = payload.folderPath
      }
    }

    register(SYNC_EVENTS.BACKUP_STARTED, () => {
      isBackingUp.value = true
    })
    register(SYNC_EVENTS.BACKUP_COMPLETED, handleBackupCompleted)
    register(SYNC_EVENTS.BACKUP_ERROR, () => {
      isBackingUp.value = false
    })
    register(SYNC_EVENTS.IMPORT_STARTED, () => {
      isImporting.value = true
    })
    register(SYNC_EVENTS.IMPORT_COMPLETED, () => {
      isImporting.value = false
    })
    register(SYNC_EVENTS.IMPORT_ERROR, () => {
      isImporting.value = false
    })
    register(CONFIG_EVENTS.SYNC_SETTINGS_CHANGED, handleSyncSettingsChanged)

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      listenersBound = false
    }
  }

  return {
    syncEnabled,
    syncFolderPath,
    lastSyncTime,
    isBackingUp,
    isImporting,
    importResult,
    backups,

    initialize,
    setSyncEnabled,
    setSyncFolderPath,
    selectSyncFolder,
    openSyncFolder,
    startBackup,
    importData,
    restartApp,
    clearImportResult,
    refreshBackups,
    bindEventListeners
  }
})
