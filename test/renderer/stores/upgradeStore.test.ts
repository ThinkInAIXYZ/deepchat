import { describe, it, expect, vi } from 'vitest'
import { UPDATE_EVENTS } from '@/events'
import { createUpgradeStore } from '@/stores/upgrade'

describe('createUpgradeStore', () => {
  it('initializes platform state and gates update dialog', async () => {
    const devicePresenter = {
      getDeviceInfo: vi.fn().mockResolvedValue({
        platform: 'win32'
      })
    }
    const ipcRenderer = {
      on: vi.fn(),
      removeListener: vi.fn()
    }

    const store = createUpgradeStore({ devicePresenter, ipcRenderer })
    await store.initialize()

    expect(store.isWindows.value).toBe(true)
    store.openUpdateDialog()
    expect(store.showUpdateDialog.value).toBe(false)

    store.hasUpdate.value = true
    store.openUpdateDialog()
    expect(store.showUpdateDialog.value).toBe(true)
  })

  it('binds update listeners and cleans up', () => {
    const ipcRenderer = {
      on: vi.fn(),
      removeListener: vi.fn()
    }
    const store = createUpgradeStore({ ipcRenderer })

    const cleanup = store.bindUpdateListeners()
    expect(ipcRenderer.on).toHaveBeenCalledWith(UPDATE_EVENTS.STATUS_CHANGED, expect.any(Function))

    cleanup()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      UPDATE_EVENTS.STATUS_CHANGED,
      expect.any(Function)
    )
  })
})
