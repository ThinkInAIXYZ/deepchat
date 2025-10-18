import { defineStore } from 'pinia'
import { ref } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { SYNC_EVENTS } from '@/events'

export const useSyncStore = defineStore('sync', () => {
  // 状态
  const syncEnabled = ref(false)
  const syncFolderPath = ref('')
  const lastSyncTime = ref(0)
  const isBackingUp = ref(false)
  const isImporting = ref(false)
  const importResult = ref<{ success: boolean; message: string; count?: number } | null>(null)

  // 获取 presenter 实例
  const configPresenter = usePresenter('configPresenter')
  const syncPresenter = usePresenter('syncPresenter')
  const devicePresenter = usePresenter('devicePresenter')

  // 初始化函数
  const initialize = async () => {
    // 加载同步设置
    syncEnabled.value = await configPresenter.getSyncEnabled()
    syncFolderPath.value = await configPresenter.getSyncFolderPath()

    // 加载备份状态
    const status = await syncPresenter.getBackupStatus()
    lastSyncTime.value = status.lastBackupTime
    isBackingUp.value = status.isBackingUp

    // 监听备份状态变化事件
    window.electron.ipcRenderer.on(SYNC_EVENTS.BACKUP_STARTED, () => {
      isBackingUp.value = true
    })

    window.electron.ipcRenderer.on(SYNC_EVENTS.BACKUP_COMPLETED, (_event, time) => {
      isBackingUp.value = false
      lastSyncTime.value = time
    })

    window.electron.ipcRenderer.on(SYNC_EVENTS.BACKUP_ERROR, () => {
      isBackingUp.value = false
    })

    // 导入事件
    window.electron.ipcRenderer.on(SYNC_EVENTS.IMPORT_STARTED, () => {
      isImporting.value = true
    })

    window.electron.ipcRenderer.on(SYNC_EVENTS.IMPORT_COMPLETED, () => {
      isImporting.value = false
    })

    window.electron.ipcRenderer.on(SYNC_EVENTS.IMPORT_ERROR, () => {
      isImporting.value = false
    })
  }

  // 更新同步启用状态
  const setSyncEnabled = async (enabled: boolean) => {
    syncEnabled.value = enabled
    await configPresenter.setSyncEnabled(enabled)
  }

  // 更新同步文件夹路径
  const setSyncFolderPath = async (path: string) => {
    syncFolderPath.value = path
    await configPresenter.setSyncFolderPath(path)
  }

  // 选择同步文件夹
  const selectSyncFolder = async () => {
    const result = await devicePresenter.selectDirectory()
    if (result && !result.canceled && result.filePaths.length > 0) {
      await setSyncFolderPath(result.filePaths[0])
    }
  }

  // 打开同步文件夹
  const openSyncFolder = async () => {
    if (!syncEnabled.value) return
    await syncPresenter.openSyncFolder()
  }

  // 开始备份
  const startBackup = async () => {
    if (!syncEnabled.value || isBackingUp.value) return

    try {
      await syncPresenter.startBackup()
    } catch (error) {
      console.error('备份失败:', error)
    }
  }

  // 导入数据
  const importData = async (mode: 'increment' | 'overwrite' = 'increment') => {
    if (!syncEnabled.value || isImporting.value) return

    isImporting.value = true
    const result = await syncPresenter.importFromSync(mode)
    importResult.value = result
    isImporting.value = false
  }

  // 重启应用
  const restartApp = async () => {
    await devicePresenter.restartApp()
  }

  // 清除导入结果
  const clearImportResult = () => {
    importResult.value = null
  }

  return {
    // 状态
    syncEnabled,
    syncFolderPath,
    lastSyncTime,
    isBackingUp,
    isImporting,
    importResult,

    // 方法
    initialize,
    setSyncEnabled,
    setSyncFolderPath,
    selectSyncFolder,
    openSyncFolder,
    startBackup,
    importData,
    restartApp,
    clearImportResult
  }
})
