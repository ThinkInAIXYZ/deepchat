import { usePresenter } from '@/composables/usePresenter'
import { UPDATE_EVENTS } from '@/events'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

type PresenterUpdateStatus =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | null

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready_to_install' | 'error'

type UpdateInfo = {
  version: string
  releaseDate: string
  releaseNotes: string
  githubUrl?: string
  downloadUrl?: string
  isMock?: boolean
}

type ProgressInfo = {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

type PresenterStatusSnapshot = {
  status: PresenterUpdateStatus
  progress: ProgressInfo | null
  error: string | null
  updateInfo: UpdateInfo | null
}

const DEFAULT_UPDATE_ERROR = 'Update error'

const toUpdateInfo = (info: UpdateInfo | null | undefined): UpdateInfo | null => {
  if (!info) return null

  return {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes,
    githubUrl: info.githubUrl,
    downloadUrl: info.downloadUrl,
    isMock: info.isMock
  }
}

const toProgressInfo = (progress: ProgressInfo | null | undefined): ProgressInfo | null => {
  if (!progress) return null

  return {
    percent: progress.percent,
    bytesPerSecond: progress.bytesPerSecond,
    transferred: progress.transferred,
    total: progress.total
  }
}

export const useUpgradeStore = defineStore('upgrade', () => {
  const upgradeP = usePresenter('upgradePresenter')
  const devicePresenter = usePresenter('devicePresenter')

  const rawStatus = ref<PresenterUpdateStatus>(null)
  const updateInfo = ref<UpdateInfo | null>(null)
  const isUpdating = ref(false)
  const updateProgress = ref<ProgressInfo | null>(null)
  const isRestarting = ref(false)
  const updateError = ref<string | null>(null)
  const isSilent = ref(true)
  const platform = ref<string | null>(null)
  const listenersReady = ref(false)
  let externalMutationToken = 0
  let latestSyncRequestId = 0

  const isWindows = computed(() => platform.value === 'win32')

  const hasUpdate = computed(() => Boolean(updateInfo.value))
  const isMockUpdate = computed(() => Boolean(updateInfo.value?.isMock))

  const updateState = computed<UpdateState>(() => {
    switch (rawStatus.value) {
      case 'checking':
        return 'checking'
      case 'available':
        return 'available'
      case 'downloading':
        return 'downloading'
      case 'downloaded':
        return 'ready_to_install'
      case 'error':
        return updateInfo.value ? 'error' : 'idle'
      default:
        return 'idle'
    }
  })

  const isChecking = computed(() => updateState.value === 'checking')
  const isDownloading = computed(() => updateState.value === 'downloading')
  const isReadyToInstall = computed(() => updateState.value === 'ready_to_install')
  const shouldShowUpdateNotes = computed(() => hasUpdate.value)
  const shouldShowTopbarInstallButton = computed(() => isReadyToInstall.value)
  const showManualDownloadOptions = computed(
    () => rawStatus.value === 'error' && Boolean(updateInfo.value)
  )

  const applyProgress = (
    progress?: ProgressInfo | null,
    source: 'external' | 'sync' = 'external',
    mutationToken = externalMutationToken
  ) => {
    if (source === 'external') {
      externalMutationToken += 1
    } else if (mutationToken !== externalMutationToken) {
      return
    }

    updateProgress.value = toProgressInfo(progress)
  }

  const syncFromPresenterStatus = async (): Promise<PresenterUpdateStatus> => {
    const requestId = ++latestSyncRequestId
    const mutationTokenBeforeRequest = externalMutationToken
    try {
      const snapshot = (await upgradeP.getUpdateStatus()) as PresenterStatusSnapshot | null

      if (!snapshot || snapshot.status == null) {
        return rawStatus.value
      }

      if (
        requestId !== latestSyncRequestId ||
        externalMutationToken !== mutationTokenBeforeRequest
      ) {
        return rawStatus.value
      }

      applyStatus(snapshot.status, snapshot.updateInfo, snapshot.error, 'sync')
      applyProgress(snapshot.progress, 'sync', mutationTokenBeforeRequest)
      return snapshot.status
    } catch (error) {
      console.error('Failed to sync update status:', error)
      return rawStatus.value
    }
  }

  const applyStatus = (
    status: PresenterUpdateStatus,
    info?: UpdateInfo | null,
    error?: string | null,
    source: 'external' | 'sync' = 'external'
  ) => {
    if (source === 'external') {
      externalMutationToken += 1
    }

    rawStatus.value = status

    if (info !== undefined) {
      updateInfo.value = toUpdateInfo(info)
    }

    if (status === 'checking') {
      updateError.value = null
      updateProgress.value = null
      isRestarting.value = false
      return
    }

    if (status === 'not-available') {
      updateInfo.value = null
      updateError.value = null
      updateProgress.value = null
      isRestarting.value = false
      return
    }

    if (status === 'available') {
      updateError.value = null
      updateProgress.value = null
      isRestarting.value = false
      return
    }

    if (status === 'downloading') {
      updateError.value = null
      isRestarting.value = false
      return
    }

    if (status === 'downloaded') {
      updateError.value = null
      isRestarting.value = false
      return
    }

    if (status === 'error') {
      updateError.value = error || DEFAULT_UPDATE_ERROR
      isRestarting.value = false
      return
    }
  }

  const loadDeviceInfo = async () => {
    try {
      const deviceInfo = await devicePresenter.getDeviceInfo()
      platform.value = deviceInfo?.platform ?? null
    } catch (error) {
      console.error('Failed to load device info:', error)
    }
  }

  void loadDeviceInfo()

  const checkUpdate = async (silent = true) => {
    isSilent.value = silent
    if (isChecking.value) return rawStatus.value

    try {
      applyStatus('checking', updateInfo.value, null)
      await upgradeP.checkUpdate()
      return await syncFromPresenterStatus()
    } catch (error) {
      console.error('Failed to check update:', error)
      applyStatus('error', updateInfo.value, error instanceof Error ? error.message : String(error))
      return 'error'
    }
  }

  const startUpdate = async (type: 'github' | 'official') => {
    try {
      return await upgradeP.goDownloadUpgrade(type)
    } catch (error) {
      console.error('Failed to start update:', error)
      return false
    }
  }

  const mockDownloadedUpdate = async () => {
    try {
      const success = await upgradeP.mockDownloadedUpdate()
      if (!success) {
        return rawStatus.value
      }

      return await syncFromPresenterStatus()
    } catch (error) {
      console.error('Failed to mock downloaded update:', error)
      applyStatus('error', updateInfo.value, error instanceof Error ? error.message : String(error))
      return 'error'
    }
  }

  const clearMockUpdate = async () => {
    try {
      const success = await upgradeP.clearMockUpdate()
      if (!success) {
        return rawStatus.value
      }

      return await syncFromPresenterStatus()
    } catch (error) {
      console.error('Failed to clear mock update:', error)
      applyStatus('error', updateInfo.value, error instanceof Error ? error.message : String(error))
      return 'error'
    }
  }

  const handleUpdate = async (type: 'github' | 'official' | 'auto') => {
    isUpdating.value = true
    try {
      if (isReadyToInstall.value) {
        await upgradeP.restartToUpdate()
        return
      }

      if (isDownloading.value) {
        return
      }

      if (type === 'auto') {
        const success = await upgradeP.startDownloadUpdate()
        if (!success) {
          applyStatus('error', updateInfo.value, updateError.value)
        }
        return
      }

      await startUpdate(type)
    } catch (error) {
      console.error('Update failed:', error)
      applyStatus('error', updateInfo.value, error instanceof Error ? error.message : String(error))
    } finally {
      isUpdating.value = false
    }
  }

  const handleStatusChanged = (_: unknown, event: Record<string, any>) => {
    const { status, info, error } = event
    applyStatus(status as PresenterUpdateStatus, info, error)
  }

  const handleProgress = (_: unknown, progressData: Record<string, any>) => {
    applyProgress(
      progressData
        ? {
            percent: progressData.percent || 0,
            bytesPerSecond: progressData.bytesPerSecond || 0,
            transferred: progressData.transferred || 0,
            total: progressData.total || 0
          }
        : null
    )
  }

  const handleWillRestart = () => {
    isRestarting.value = true
  }

  const handleError = (_: unknown, errorData: Record<string, any>) => {
    applyStatus(
      updateInfo.value ? 'error' : null,
      updateInfo.value,
      errorData?.error || DEFAULT_UPDATE_ERROR
    )
  }

  const setupUpdateListener = () => {
    if (listenersReady.value || !window?.electron?.ipcRenderer) {
      return
    }

    listenersReady.value = true
    window.electron.ipcRenderer.on(UPDATE_EVENTS.STATUS_CHANGED, handleStatusChanged)
    window.electron.ipcRenderer.on(UPDATE_EVENTS.PROGRESS, handleProgress)
    window.electron.ipcRenderer.on(UPDATE_EVENTS.WILL_RESTART, handleWillRestart)
    window.electron.ipcRenderer.on(UPDATE_EVENTS.ERROR, handleError)
  }

  setupUpdateListener()
  void syncFromPresenterStatus().catch((error) => {
    console.error('Failed to sync update status:', error)
  })

  return {
    hasUpdate,
    updateInfo,
    isUpdating,
    updateProgress,
    isRestarting,
    updateError,
    isSilent,
    isWindows,
    updateState,
    isChecking,
    isDownloading,
    isReadyToInstall,
    isMockUpdate,
    shouldShowUpdateNotes,
    shouldShowTopbarInstallButton,
    showManualDownloadOptions,
    refreshStatus: syncFromPresenterStatus,
    checkUpdate,
    startUpdate,
    mockDownloadedUpdate,
    clearMockUpdate,
    handleUpdate
  }
})
