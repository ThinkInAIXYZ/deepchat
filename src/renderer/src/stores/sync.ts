import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createDeviceClient } from '@api/DeviceClient'
import { createSyncClient } from '@api/SyncClient'
import { createConfigClient } from '../../api/ConfigClient'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { useIpcMutation } from '@/composables/useIpcMutation'
import type { EntryKey, UseQueryReturn } from '@pinia/colada'
import type { SyncBackupInfo } from '@shared/presenter'

export const useSyncStore = defineStore('sync', () => {
  const syncEnabled = ref(false)
  const syncFolderPath = ref('')
  const lastSyncTime = ref(0)
  const isBackingUp = ref(false)
  const isImporting = ref(false)
  const importResult = ref<{
    success: boolean
    message: string
    count?: number
    sourceDbType?: 'agent' | 'chat'
    importedSessions?: number
  } | null>(null)

  const configClient = createConfigClient()
  const syncClient = createSyncClient()
  const deviceClient = createDeviceClient()
  let syncEventsRegistered = false
  let syncSettingsListenerRegistered = false

  const backupQueryKey = (): EntryKey => ['sync', 'backups'] as const

  const backupsQuery = useIpcQuery({
    key: backupQueryKey,
    query: () => syncClient.listBackups(),
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
    mutation: () => syncClient.startBackup(),
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
    mutation: (backupFile: string, mode: 'increment' | 'overwrite') =>
      syncClient.importFromSync(backupFile, mode),
    invalidateQueries: () => [backupQueryKey()]
  })

  const importData = async (
    backupFile: string,
    mode: 'increment' | 'overwrite' = 'increment'
  ): Promise<{
    success: boolean
    message: string
    count?: number
    sourceDbType?: 'agent' | 'chat'
    importedSessions?: number
  } | null> => {
    if (!syncEnabled.value || isImporting.value || !backupFile) return null

    isImporting.value = true
    try {
      const result = (await importBackupMutation.mutateAsync([backupFile, mode])) as {
        success: boolean
        message: string
        count?: number
        sourceDbType?: 'agent' | 'chat'
        importedSessions?: number
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
    syncEnabled.value = await configClient.getSyncEnabled()
    syncFolderPath.value = await configClient.getSyncFolderPath()

    const status = await syncClient.getBackupStatus()
    lastSyncTime.value = status.lastBackupTime
    isBackingUp.value = status.isBackingUp

    await refreshBackups()
    setupSyncEventListeners()
    setupSyncSettingsListener()
  }

  const setupSyncEventListeners = () => {
    if (syncEventsRegistered) {
      return
    }

    syncEventsRegistered = true

    syncClient.onBackupStarted(() => {
      isBackingUp.value = true
    })

    syncClient.onBackupCompleted(({ timestamp }) => {
      isBackingUp.value = false
      lastSyncTime.value = timestamp
    })

    syncClient.onBackupError(() => {
      isBackingUp.value = false
    })

    syncClient.onImportStarted(() => {
      isImporting.value = true
    })

    syncClient.onImportCompleted(() => {
      isImporting.value = false
    })

    syncClient.onImportError(() => {
      isImporting.value = false
    })
  }

  const setSyncEnabled = async (enabled: boolean) => {
    syncEnabled.value = enabled
    await configClient.setSyncEnabled(enabled)
  }

  const setSyncFolderPath = async (path: string) => {
    syncFolderPath.value = path
    await configClient.setSyncFolderPath(path)
    await refreshBackups()
  }

  const selectSyncFolder = async () => {
    const result = await deviceClient.selectDirectory()
    if (result && !result.canceled && result.filePaths.length > 0) {
      await setSyncFolderPath(result.filePaths[0])
    }
  }

  const openSyncFolder = async () => {
    if (!syncEnabled.value) return
    await syncClient.openSyncFolder()
  }

  const restartApp = async () => {
    await deviceClient.restartApp()
  }

  const clearImportResult = () => {
    importResult.value = null
  }

  const setupSyncSettingsListener = () => {
    if (syncSettingsListenerRegistered) {
      return
    }

    syncSettingsListenerRegistered = true
    configClient.onSyncSettingsChanged(async ({ enabled, folderPath }) => {
      syncEnabled.value = enabled
      if (folderPath !== syncFolderPath.value) {
        syncFolderPath.value = folderPath
        await refreshBackups()
        return
      }
      syncFolderPath.value = folderPath
    })
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
    refreshBackups
  }
})
