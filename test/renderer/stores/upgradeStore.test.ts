import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const statusChangedHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>())

const upgradePresenterMock = vi.hoisted(() => ({
  checkUpdate: vi.fn().mockResolvedValue(undefined),
  getUpdateStatus: vi.fn(),
  goDownloadUpgrade: vi.fn().mockResolvedValue(undefined),
  startDownloadUpdate: vi.fn().mockResolvedValue(true),
  restartToUpdate: vi.fn().mockResolvedValue(true)
}))

const devicePresenterMock = vi.hoisted(() => ({
  getDeviceInfo: vi.fn().mockResolvedValue({ platform: 'darwin' })
}))

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia')
  return actual
})

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return {
    ...actual,
    onMounted: (callback: () => void) => callback()
  }
})

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: (name: string) =>
    name === 'upgradePresenter' ? upgradePresenterMock : devicePresenterMock
}))

vi.mock('@/events', () => ({
  UPDATE_EVENTS: {
    STATUS_CHANGED: 'update:status-changed',
    PROGRESS: 'update:progress',
    WILL_RESTART: 'update:will-restart',
    ERROR: 'update:error'
  }
}))

import { useUpgradeStore } from '@/stores/upgrade'

const createUpdateInfo = () => ({
  version: '1.0.0-beta.4',
  releaseDate: '2026-03-19',
  releaseNotes: '- Added floating window',
  githubUrl: 'https://github.com/example',
  downloadUrl: 'https://download.example.com'
})

describe('useUpgradeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    statusChangedHandlers.clear()

    upgradePresenterMock.getUpdateStatus.mockResolvedValue({
      status: 'not-available',
      progress: null,
      error: null,
      updateInfo: null
    })

    Object.assign(window, {
      electron: {
        ipcRenderer: {
          on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
            statusChangedHandlers.set(channel, handler)
          })
        }
      }
    })
  })

  it('keeps manual checks in available state until install is clicked', async () => {
    const store = useUpgradeStore()

    upgradePresenterMock.getUpdateStatus.mockResolvedValue({
      status: 'available',
      progress: null,
      error: null,
      updateInfo: createUpdateInfo()
    })

    const result = await store.checkUpdate(false)

    expect(result).toBe('available')
    expect(store.updateState).toBe('available')
    expect(store.hasUpdate).toBe(true)
    expect(store.shouldShowTopbarInstallButton).toBe(false)
    expect(upgradePresenterMock.startDownloadUpdate).not.toHaveBeenCalled()
  })

  it('hydrates downloaded state from async presenter status', async () => {
    const store = useUpgradeStore()

    upgradePresenterMock.getUpdateStatus.mockResolvedValue({
      status: 'downloaded',
      progress: null,
      error: null,
      updateInfo: createUpdateInfo()
    })

    const result = await store.refreshStatus()

    expect(result).toBe('downloaded')
    expect(store.updateState).toBe('ready_to_install')
    expect(store.shouldShowTopbarInstallButton).toBe(true)
    expect(store.hasUpdate).toBe(true)
  })

  it('marks checking immediately and coalesces repeated manual checks before presenter reply', async () => {
    const store = useUpgradeStore()
    let resolveCheck: (() => void) | null = null

    upgradePresenterMock.checkUpdate.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveCheck = resolve
      })
    )

    const firstCheck = store.checkUpdate(false)

    expect(store.updateState).toBe('checking')
    expect(store.isChecking).toBe(true)

    const secondCheck = await store.checkUpdate(false)

    expect(secondCheck).toBe('checking')
    expect(upgradePresenterMock.checkUpdate).toHaveBeenCalledTimes(1)

    resolveCheck?.()

    const firstResult = await firstCheck
    expect(firstResult).toBe('not-available')
    expect(store.updateState).toBe('idle')
  })

  it('hydrates downloading progress from async presenter status', async () => {
    const store = useUpgradeStore()

    upgradePresenterMock.getUpdateStatus.mockResolvedValue({
      status: 'downloading',
      progress: {
        percent: 42,
        bytesPerSecond: 1024,
        transferred: 420,
        total: 1000
      },
      error: null,
      updateInfo: createUpdateInfo()
    })

    const result = await store.refreshStatus()

    expect(result).toBe('downloading')
    expect(store.updateState).toBe('downloading')
    expect(store.isDownloading).toBe(true)
    expect(store.updateProgress).toEqual({
      percent: 42,
      bytesPerSecond: 1024,
      transferred: 420,
      total: 1000
    })
  })

  it('does not let stale sync snapshots overwrite newer progress events', async () => {
    const store = useUpgradeStore()
    const statusHandler = statusChangedHandlers.get('update:status-changed')
    const progressHandler = statusChangedHandlers.get('update:progress')
    let resolveSnapshot:
      | ((value: {
          status: 'downloading'
          progress: {
            percent: number
            bytesPerSecond: number
            transferred: number
            total: number
          }
          error: null
          updateInfo: ReturnType<typeof createUpdateInfo>
        }) => void)
      | null = null

    statusHandler?.({}, { status: 'downloading', info: createUpdateInfo() })
    upgradePresenterMock.getUpdateStatus.mockReturnValueOnce(
      new Promise<{
        status: 'downloading'
        progress: {
          percent: number
          bytesPerSecond: number
          transferred: number
          total: number
        }
        error: null
        updateInfo: ReturnType<typeof createUpdateInfo>
      }>((resolve) => {
        resolveSnapshot = resolve
      })
    )

    const refreshPromise = store.refreshStatus()

    progressHandler?.({}, { percent: 75, bytesPerSecond: 2048, transferred: 750, total: 1000 })

    resolveSnapshot?.({
      status: 'downloading',
      progress: {
        percent: 42,
        bytesPerSecond: 1024,
        transferred: 420,
        total: 1000
      },
      error: null,
      updateInfo: createUpdateInfo()
    })

    const result = await refreshPromise

    expect(result).toBe('downloading')
    expect(store.updateState).toBe('downloading')
    expect(store.updateProgress).toEqual({
      percent: 75,
      bytesPerSecond: 2048,
      transferred: 750,
      total: 1000
    })
  })

  it('returns the current state when syncing presenter status fails', async () => {
    const store = useUpgradeStore()
    const statusHandler = statusChangedHandlers.get('update:status-changed')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    statusHandler?.({}, { status: 'downloaded', info: createUpdateInfo() })
    upgradePresenterMock.getUpdateStatus.mockRejectedValueOnce(new Error('sync failed'))

    const result = await store.refreshStatus()

    expect(result).toBe('downloaded')
    expect(store.updateState).toBe('ready_to_install')
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to sync update status:', expect.any(Error))

    consoleErrorSpy.mockRestore()
  })

  it('keeps the current state when presenter status snapshot is empty', async () => {
    const store = useUpgradeStore()
    const handler = statusChangedHandlers.get('update:status-changed')

    handler?.({}, { status: 'downloaded', info: createUpdateInfo() })
    upgradePresenterMock.getUpdateStatus.mockResolvedValue(null)

    const result = await store.refreshStatus()

    expect(result).toBe('downloaded')
    expect(store.updateState).toBe('ready_to_install')
    expect(store.shouldShowTopbarInstallButton).toBe(true)
  })

  it('exposes manual download fallback when update download fails', () => {
    const store = useUpgradeStore()
    const handler = statusChangedHandlers.get('update:status-changed')

    handler?.({}, { status: 'error', info: createUpdateInfo(), error: 'network failed' })

    expect(store.updateState).toBe('error')
    expect(store.showManualDownloadOptions).toBe(true)
    expect(store.updateError).toBe('network failed')
  })
})
