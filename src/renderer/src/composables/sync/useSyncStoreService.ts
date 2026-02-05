import { computed, ref } from 'vue'
import { useIpcMutation } from '@/composables/useIpcMutation'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { useSyncAdapter } from '@/composables/sync/useSyncAdapter'
import type { EntryKey, UseQueryReturn } from '@pinia/colada'
import type { SyncBackupInfo } from '@shared/presenter'

type ImportResult = {
  success: boolean
  message: string
  count?: number
}

export const useSyncStoreService = () => {
  const syncEnabled = ref(false)
  const syncFolderPath = ref('')
  const lastSyncTime = ref(0)
  const isBackingUp = ref(false)
  const isImporting = ref(false)
  const importResult = ref<ImportResult | null>(null)
  const isInitialized = ref(false)
  let listenersBound = false

  const syncAdapter = useSyncAdapter()

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
      console.error('Failed to refresh backups:', error)
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
      console.error('Backup failed:', error)
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
  ): Promise<ImportResult | null> => {
    if (!syncEnabled.value || isImporting.value || !backupFile) return null

    isImporting.value = true
    try {
      const result = (await importBackupMutation.mutateAsync([backupFile, mode])) as ImportResult
      importResult.value = result.success ? null : result
      return result
    } catch (error) {
      console.error('Import failed:', error)
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

    syncEnabled.value = await syncAdapter.getSyncEnabled()
    syncFolderPath.value = await syncAdapter.getSyncFolderPath()

    const status = await syncAdapter.getBackupStatus()
    lastSyncTime.value = status.lastBackupTime
    isBackingUp.value = status.isBackingUp

    await refreshBackups()
    isInitialized.value = true
  }

  const setSyncEnabled = async (enabled: boolean) => {
    syncEnabled.value = enabled
    await syncAdapter.setSyncEnabled(enabled)
  }

  const setSyncFolderPath = async (path: string) => {
    syncFolderPath.value = path
    await syncAdapter.setSyncFolderPath(path)
    await refreshBackups()
  }

  const selectSyncFolder = async () => {
    const result = await syncAdapter.selectDirectory()
    if (result && !result.canceled && result.filePaths.length > 0) {
      await setSyncFolderPath(result.filePaths[0])
    }
  }

  const openSyncFolder = async () => {
    if (!syncEnabled.value) return
    await syncAdapter.openSyncFolder()
  }

  const restartApp = async () => {
    await syncAdapter.restartApp()
  }

  const clearImportResult = () => {
    importResult.value = null
  }

  const bindEventListeners = () => {
    if (listenersBound) return () => undefined

    listenersBound = true
    const unsubscribers: Array<() => void> = []

    const handleBackupCompleted = (time?: number) => {
      if (typeof time === 'number') {
        lastSyncTime.value = time
      }
      isBackingUp.value = false
    }

    const handleSyncSettingsChanged = (payload?: { enabled?: boolean; folderPath?: string }) => {
      if (!payload) return

      if (typeof payload.enabled === 'boolean') {
        syncEnabled.value = payload.enabled
      }

      if (typeof payload.folderPath === 'string') {
        const folderChanged = payload.folderPath !== syncFolderPath.value
        syncFolderPath.value = payload.folderPath
        if (folderChanged) {
          void refreshBackups()
        }
      }
    }

    unsubscribers.push(syncAdapter.onBackupStarted(() => (isBackingUp.value = true)))
    unsubscribers.push(syncAdapter.onBackupCompleted(handleBackupCompleted))
    unsubscribers.push(syncAdapter.onBackupError(() => (isBackingUp.value = false)))
    unsubscribers.push(syncAdapter.onImportStarted(() => (isImporting.value = true)))
    unsubscribers.push(syncAdapter.onImportCompleted(() => (isImporting.value = false)))
    unsubscribers.push(syncAdapter.onImportError(() => (isImporting.value = false)))
    unsubscribers.push(syncAdapter.onSyncSettingsChanged(handleSyncSettingsChanged))

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
}
