import { usePresenter } from '@/composables/usePresenter'
import { UPDATE_EVENTS } from '@/events'
import { defineStore } from 'pinia'
import { onMounted, ref } from 'vue'

export const useUpgradeStore = defineStore('upgrade', () => {
  const upgradeP = usePresenter('upgradePresenter')
  const hasUpdate = ref(false)
  const updateInfo = ref<{
    version: string
    releaseDate: string
    releaseNotes: string
    githubUrl?: string
    downloadUrl?: string
  } | null>(null)
  const showUpdateDialog = ref(false)
  const isUpdating = ref(false)
  const isChecking = ref(false)
  // 添加在 const updateInfo = ref<any>(null) 附近
  const updateProgress = ref<{
    percent: number
    bytesPerSecond: number
    transferred: number
    total: number
  } | null>(null)
  const isDownloading = ref(false)
  const isReadyToInstall = ref(false)
  const isRestarting = ref(false)
  const updateError = ref<string | null>(null)
  const isSilent = ref(true) // 默认不弹出检查没有最新更新
  // 检查更新
  const checkUpdate = async (silent = true) => {
    isSilent.value = silent
    if (isChecking.value) return
    isChecking.value = true
    try {
      await upgradeP.checkUpdate()
      const status = upgradeP.getUpdateStatus()
      hasUpdate.value = status.status === 'available' || status.status === 'downloaded'
      if (hasUpdate.value && status.updateInfo) {
        updateInfo.value = {
          version: status.updateInfo.version,
          releaseDate: status.updateInfo.releaseDate,
          releaseNotes: status.updateInfo.releaseNotes,
          githubUrl: status.updateInfo.githubUrl,
          downloadUrl: status.updateInfo.downloadUrl
        }

        // 检查是否已经下载完成，只有在下载完成的情况下才打开对话框
        if (status.status === 'downloaded') {
          openUpdateDialog()
        }
        // 否则不打开对话框，让更新在后台静默下载
      }
    } catch (error) {
      console.error('Failed to check update:', error)
    } finally {
      isChecking.value = false
    }
  }

  // 开始下载更新
  const startUpdate = async (type: 'github' | 'netdisk') => {
    try {
      return await upgradeP.goDownloadUpgrade(type)
    } catch (error) {
      console.error('Failed to start update:', error)
      return false
    }
  }

  // 监听更新状态
  const setupUpdateListener = () => {
    console.log('setupUpdateListener')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.electron.ipcRenderer.on(UPDATE_EVENTS.STATUS_CHANGED, (_, event: any) => {
      const { status, type, info, error } = event
      console.log(UPDATE_EVENTS.STATUS_CHANGED, status, info, error)
      // 根据不同状态更新UI
      switch (status) {
        case 'available':
          hasUpdate.value = true
          updateInfo.value = info
            ? {
                version: info.version,
                releaseDate: info.releaseDate,
                releaseNotes: info.releaseNotes,
                githubUrl: info.githubUrl,
                downloadUrl: info.downloadUrl
              }
            : null
          // 不自动弹出对话框，由主进程自动开始下载
          break
        case 'not-available':
          hasUpdate.value = false
          updateInfo.value = null
          isDownloading.value = false
          isUpdating.value = false
          // 当检查到没有更新时，如果是自动检测模式，则不弹出对话框
          if (type !== 'autoCheck') {
            openUpdateDialog()
          }
          break
        case 'downloading':
          hasUpdate.value = true
          isDownloading.value = true
          isUpdating.value = true
          break
        case 'downloaded':
          hasUpdate.value = true
          isDownloading.value = false
          isReadyToInstall.value = true
          isUpdating.value = false
          if (info) {
            updateInfo.value = {
              version: info.version,
              releaseDate: info.releaseDate,
              releaseNotes: info.releaseNotes,
              githubUrl: info.githubUrl,
              downloadUrl: info.downloadUrl
            }
            // 下载完成后自动打开安装确认对话框
            openUpdateDialog()
          }
          break
        case 'error':
          isDownloading.value = false
          isUpdating.value = false

          // 如果有错误，但仍然有更新信息，说明自动更新失败，需要手动下载
          if (info) {
            hasUpdate.value = true
            updateInfo.value = {
              version: info.version,
              releaseDate: info.releaseDate,
              releaseNotes: info.releaseNotes,
              githubUrl: info.githubUrl,
              downloadUrl: info.downloadUrl
            }
            // 自动更新失败，打开手动下载对话框
            openUpdateDialog()
          } else {
            hasUpdate.value = false
            updateInfo.value = null
          }

          updateError.value = error || '更新出错'
          console.error('Update error:', error)
          break
      }
    })

    // 监听更新进度
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.electron.ipcRenderer.on(UPDATE_EVENTS.PROGRESS, (_, progressData: any) => {
      console.log(UPDATE_EVENTS.PROGRESS, progressData)
      if (progressData) {
        updateProgress.value = {
          percent: progressData.percent || 0,
          bytesPerSecond: progressData.bytesPerSecond || 0,
          transferred: progressData.transferred || 0,
          total: progressData.total || 0
        }
      }
    })

    // 监听即将重启事件
    window.electron.ipcRenderer.on(UPDATE_EVENTS.WILL_RESTART, () => {
      console.log(UPDATE_EVENTS.WILL_RESTART)
      isRestarting.value = true
    })

    // 监听更新错误
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.electron.ipcRenderer.on(UPDATE_EVENTS.ERROR, (_, errorData: any) => {
      console.error(UPDATE_EVENTS.ERROR, errorData.error)
      hasUpdate.value = false
      updateInfo.value = null
      isDownloading.value = false
      isUpdating.value = false
      updateError.value = errorData.error || '更新出错'
    })
  }

  // 打开更新弹窗
  const openUpdateDialog = () => {
    // 静默状态下没有更新就别弹了
    if (isSilent.value && !hasUpdate.value) {
      return
    }
    showUpdateDialog.value = true
  }

  // 关闭更新弹窗
  const closeUpdateDialog = () => {
    showUpdateDialog.value = false
  }

  // 处理更新操作 - 修改此方法
  const handleUpdate = async (type: 'github' | 'netdisk' | 'auto') => {
    isUpdating.value = true
    try {
      // 如果更新已下载，执行安装
      if (isReadyToInstall.value) {
        await upgradeP.restartToUpdate()
        return
      }

      // 如果下载中，不做任何操作
      if (isDownloading.value) {
        return
      }

      // 如果是自动更新模式，启动下载
      if (type === 'auto') {
        const success = await upgradeP.startDownloadUpdate()
        if (!success) {
          // 如果自动更新失败，则使用手动链接
          openUpdateDialog()
        }
        return
      }

      // 否则进行手动更新
      const success = await startUpdate(type)
      if (success) {
        closeUpdateDialog()
      }
    } catch (error) {
      console.error('Update failed:', error)
    } finally {
      isUpdating.value = false
    }
  }
  onMounted(() => {
    setupUpdateListener()
  })
  return {
    isChecking,
    checkUpdate,
    startUpdate,
    openUpdateDialog,
    closeUpdateDialog,
    handleUpdate,
    hasUpdate,
    updateInfo,
    showUpdateDialog,
    isUpdating,
    updateProgress,
    isDownloading,
    isReadyToInstall,
    isRestarting,
    updateError,
    isSilent
  }
})
