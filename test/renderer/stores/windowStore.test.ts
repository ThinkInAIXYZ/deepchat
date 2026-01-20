import { describe, it, expect, vi } from 'vitest'
import { WINDOW_EVENTS } from '@/events'
import { createWindowStore } from '@/stores/windowStore'

describe('createWindowStore', () => {
  it('initializes platform state and binds window events', async () => {
    const devicePresenter = {
      getDeviceInfo: vi.fn().mockResolvedValue({
        platform: 'darwin',
        osVersion: '14.0.0',
        osVersionMetadata: []
      })
    }
    const ipcRenderer = {
      on: vi.fn(),
      removeListener: vi.fn()
    }

    const store = createWindowStore({ devicePresenter, ipcRenderer })
    await store.initialize()

    expect(store.isMacOS.value).toBe(true)
    expect(store.isWindows.value).toBe(false)
    expect(store.isWinMacOS.value).toBe(true)

    const cleanup = store.bindEventListeners()
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      WINDOW_EVENTS.WINDOW_MAXIMIZED,
      expect.any(Function)
    )
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      WINDOW_EVENTS.WINDOW_UNMAXIMIZED,
      expect.any(Function)
    )
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN,
      expect.any(Function)
    )
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN,
      expect.any(Function)
    )
    expect(ipcRenderer.on).toHaveBeenCalledWith(WINDOW_EVENTS.APP_FOCUS, expect.any(Function))
    expect(ipcRenderer.on).toHaveBeenCalledWith(WINDOW_EVENTS.APP_BLUR, expect.any(Function))

    cleanup()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      WINDOW_EVENTS.WINDOW_MAXIMIZED,
      expect.any(Function)
    )
  })
})
