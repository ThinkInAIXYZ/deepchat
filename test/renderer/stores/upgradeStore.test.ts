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

    upgradePresenterMock.getUpdateStatus.mockReturnValue({
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

    upgradePresenterMock.getUpdateStatus.mockReturnValue({
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

  it('shows the topbar entry after the update is downloaded', () => {
    const store = useUpgradeStore()
    const handler = statusChangedHandlers.get('update:status-changed')

    handler?.({}, { status: 'downloaded', info: createUpdateInfo() })

    expect(store.updateState).toBe('ready_to_install')
    expect(store.shouldShowTopbarInstallButton).toBe(true)
    expect(store.hasUpdate).toBe(true)
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
