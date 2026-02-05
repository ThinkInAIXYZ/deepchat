import { computed, ref } from 'vue'
import { UPDATE_EVENTS } from '@/events'
import {
  useUpgradeAdapter,
  type StatusChangedPayload,
  type UpdateErrorPayload,
  type UpgradeAdapter
} from '@/composables/upgrade/useUpgradeAdapter'

type UpdateInfo = {
  version: string
  releaseDate: string
  releaseNotes: string
  githubUrl?: string
  downloadUrl?: string
}

export type UpgradeStoreDeps = {
  upgradeAdapter?: UpgradeAdapter
}

export const createUpgradeStore = (deps: UpgradeStoreDeps = {}) => {
  const upgradeAdapter = deps.upgradeAdapter ?? useUpgradeAdapter()
  const hasUpdate = ref(false)
  const updateInfo = ref<UpdateInfo | null>(null)
  const showUpdateDialog = ref(false)
  const isUpdating = ref(false)
  const isChecking = ref(false)
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
  const isSilent = ref(true)
  const platform = ref<string | null>(null)
  const isWindows = computed(() => platform.value === 'win32')
  const isInitialized = ref(false)
  let listenersBound = false

  const mapUpdateInfo = (info?: StatusChangedPayload['info'] | null): UpdateInfo | null => {
    if (!info) return null
    return {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
      githubUrl: info.githubUrl,
      downloadUrl: info.downloadUrl
    }
  }

  const loadDeviceInfo = async () => {
    try {
      const deviceInfo = await upgradeAdapter.getDeviceInfo()
      platform.value = deviceInfo?.platform ?? null
    } catch (error) {
      console.error('Failed to load device info:', error)
    }
  }

  const initialize = async () => {
    if (isInitialized.value) return
    await loadDeviceInfo()
    isInitialized.value = true
  }

  const checkUpdate = async (silent = true) => {
    isSilent.value = silent
    if (isChecking.value) return
    isChecking.value = true
    try {
      await upgradeAdapter.checkUpdate()
      const status = await upgradeAdapter.getUpdateStatus()
      if (!status) return
      hasUpdate.value = status.status === 'available' || status.status === 'downloaded'
      if (hasUpdate.value && status.updateInfo) {
        updateInfo.value = mapUpdateInfo(status.updateInfo)

        if (status.status === 'downloaded') {
          openUpdateDialog()
        }
      }
    } catch (error) {
      console.error('Failed to check update:', error)
    } finally {
      isChecking.value = false
    }
  }

  const startUpdate = async (type: 'github' | 'netdisk') => {
    try {
      return await upgradeAdapter.goDownloadUpgrade(type)
    } catch (error) {
      console.error('Failed to start update:', error)
      return false
    }
  }

  const bindUpdateListeners = () => {
    if (listenersBound) return () => undefined
    listenersBound = true
    const unsubscribers: Array<() => void> = []

    const handleStatusChanged = (event: StatusChangedPayload) => {
      const { status, type, info, error } = event ?? {}
      console.log(UPDATE_EVENTS.STATUS_CHANGED, status, info, error)

      switch (status) {
        case 'available':
          hasUpdate.value = true
          updateInfo.value = mapUpdateInfo(info)
          break
        case 'not-available':
          hasUpdate.value = false
          updateInfo.value = null
          isDownloading.value = false
          isUpdating.value = false
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
            updateInfo.value = mapUpdateInfo(info)
            openUpdateDialog()
          }
          break
        case 'error':
          isDownloading.value = false
          isUpdating.value = false

          if (info) {
            hasUpdate.value = true
            updateInfo.value = mapUpdateInfo(info)
            openUpdateDialog()
          } else {
            hasUpdate.value = false
            updateInfo.value = null
          }

          updateError.value = error || 'Update failed'
          console.error('Update error:', error)
          break
      }
    }

    const handleProgress = (progressData: {
      percent?: number
      bytesPerSecond?: number
      transferred?: number
      total?: number
    }) => {
      console.log(UPDATE_EVENTS.PROGRESS, progressData)
      if (progressData) {
        updateProgress.value = {
          percent: progressData.percent || 0,
          bytesPerSecond: progressData.bytesPerSecond || 0,
          transferred: progressData.transferred || 0,
          total: progressData.total || 0
        }
      }
    }

    const handleWillRestart = () => {
      console.log(UPDATE_EVENTS.WILL_RESTART)
      isRestarting.value = true
    }

    const handleUpdateError = (errorData: UpdateErrorPayload) => {
      console.error(UPDATE_EVENTS.ERROR, errorData?.error)
      hasUpdate.value = false
      updateInfo.value = null
      isDownloading.value = false
      isUpdating.value = false
      updateError.value = errorData?.error || 'Update failed'
    }

    unsubscribers.push(upgradeAdapter.onStatusChanged(handleStatusChanged))
    unsubscribers.push(upgradeAdapter.onProgress(handleProgress))
    unsubscribers.push(upgradeAdapter.onWillRestart(handleWillRestart))
    unsubscribers.push(upgradeAdapter.onError(handleUpdateError))

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      listenersBound = false
    }
  }

  const openUpdateDialog = () => {
    if (isSilent.value && !hasUpdate.value) {
      return
    }
    showUpdateDialog.value = true
  }

  const closeUpdateDialog = () => {
    showUpdateDialog.value = false
  }

  const handleUpdate = async (type: 'github' | 'netdisk' | 'auto') => {
    isUpdating.value = true
    try {
      if (isReadyToInstall.value) {
        await upgradeAdapter.restartToUpdate()
        return
      }

      if (isDownloading.value) {
        return
      }

      if (type === 'auto') {
        const success = await upgradeAdapter.startDownloadUpdate()
        if (!success) {
          openUpdateDialog()
        }
        return
      }

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

  return {
    initialize,
    isChecking,
    checkUpdate,
    startUpdate,
    bindUpdateListeners,
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
    isSilent,
    isWindows
  }
}
