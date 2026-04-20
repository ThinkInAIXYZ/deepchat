import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { DeviceClient } from '@api/DeviceClient'
import { useLegacySyncPresenter } from '@api/legacy/presenters'
import { onLegacyIpcChannel } from '@api/legacy/runtime'
import { ConfigClient } from '../../api/ConfigClient'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { useIpcMutation } from '@/composables/useIpcMutation'
import { SYNC_EVENTS } from '@/events'
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

  const configClient = new ConfigClient()
  const syncPresenter = useLegacySyncPresenter()
  const deviceClient = new DeviceClient()
  let syncEventsRegistered = false
  let syncSettingsListenerRegistered = false

  const backupQueryKey = (): EntryKey => ['sync', 'backups'] as const

  const backupsQuery = useIpcQuery({
    key: backupQueryKey,
    query: () => syncPresenter.listBackups(),
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
    mutation: () => syncPresenter.startBackup(),
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
      syncPresenter.importFromSync(backupFile, mode),
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

    const status = await syncPresenter.getBackupStatus()
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

    onLegacyIpcChannel(SYNC_EVENTS.BACKUP_STARTED, () => {
      isBackingUp.value = true
    })

    onLegacyIpcChannel(SYNC_EVENTS.BACKUP_COMPLETED, (_event, time) => {
      isBackingUp.value = false
      lastSyncTime.value = time
    })

    onLegacyIpcChannel(SYNC_EVENTS.BACKUP_ERROR, () => {
      isBackingUp.value = false
    })

    onLegacyIpcChannel(SYNC_EVENTS.IMPORT_STARTED, () => {
      isImporting.value = true
    })

    onLegacyIpcChannel(SYNC_EVENTS.IMPORT_COMPLETED, () => {
      isImporting.value = false
    })

    onLegacyIpcChannel(SYNC_EVENTS.IMPORT_ERROR, () => {
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
    await syncPresenter.openSyncFolder()
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
