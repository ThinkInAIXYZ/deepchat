import { describe, it, expect, vi } from 'vitest'
import type { UpgradeAdapter } from '@/composables/upgrade/useUpgradeAdapter'
import { createUpgradeStore } from '@/stores/upgrade'

describe('createUpgradeStore', () => {
  it('initializes platform state and gates update dialog', async () => {
    const upgradeAdapter: UpgradeAdapter = {
      getDeviceInfo: vi.fn().mockResolvedValue({
        platform: 'win32'
      }),
      checkUpdate: vi.fn().mockResolvedValue(undefined),
      getUpdateStatus: vi.fn().mockResolvedValue({
        status: 'not-available',
        progress: null,
        error: null,
        updateInfo: null
      }),
      goDownloadUpgrade: vi.fn().mockResolvedValue(false),
      startDownloadUpdate: vi.fn().mockResolvedValue(false),
      restartToUpdate: vi.fn().mockResolvedValue(false),
      onStatusChanged: vi.fn().mockReturnValue(() => undefined),
      onProgress: vi.fn().mockReturnValue(() => undefined),
      onWillRestart: vi.fn().mockReturnValue(() => undefined),
      onError: vi.fn().mockReturnValue(() => undefined)
    }

    const store = createUpgradeStore({ upgradeAdapter })
    await store.initialize()

    expect(store.isWindows.value).toBe(true)
    store.openUpdateDialog()
    expect(store.showUpdateDialog.value).toBe(false)

    store.hasUpdate.value = true
    store.openUpdateDialog()
    expect(store.showUpdateDialog.value).toBe(true)
  })

  it('binds update listeners and cleans up', () => {
    const onStatusChangedCleanup = vi.fn()
    const onProgressCleanup = vi.fn()
    const onWillRestartCleanup = vi.fn()
    const onErrorCleanup = vi.fn()

    const upgradeAdapter: UpgradeAdapter = {
      getDeviceInfo: vi.fn().mockResolvedValue(null),
      checkUpdate: vi.fn().mockResolvedValue(undefined),
      getUpdateStatus: vi.fn().mockResolvedValue({
        status: 'not-available',
        progress: null,
        error: null,
        updateInfo: null
      }),
      goDownloadUpgrade: vi.fn().mockResolvedValue(false),
      startDownloadUpdate: vi.fn().mockResolvedValue(false),
      restartToUpdate: vi.fn().mockResolvedValue(false),
      onStatusChanged: vi.fn().mockReturnValue(onStatusChangedCleanup),
      onProgress: vi.fn().mockReturnValue(onProgressCleanup),
      onWillRestart: vi.fn().mockReturnValue(onWillRestartCleanup),
      onError: vi.fn().mockReturnValue(onErrorCleanup)
    }

    const store = createUpgradeStore({ upgradeAdapter })

    const cleanup = store.bindUpdateListeners()
    expect(upgradeAdapter.onStatusChanged).toHaveBeenCalledWith(expect.any(Function))
    expect(upgradeAdapter.onProgress).toHaveBeenCalledWith(expect.any(Function))
    expect(upgradeAdapter.onWillRestart).toHaveBeenCalledWith(expect.any(Function))
    expect(upgradeAdapter.onError).toHaveBeenCalledWith(expect.any(Function))

    cleanup()
    expect(onStatusChangedCleanup).toHaveBeenCalled()
    expect(onProgressCleanup).toHaveBeenCalled()
    expect(onWillRestartCleanup).toHaveBeenCalled()
    expect(onErrorCleanup).toHaveBeenCalled()
  })
})
