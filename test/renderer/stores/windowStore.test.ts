import { describe, it, expect, vi } from 'vitest'
import type { WindowAdapter } from '@/composables/window/useWindowAdapter'
import { createWindowStore } from '@/stores/windowStore'

describe('createWindowStore', () => {
  it('initializes platform state and binds window events', async () => {
    const onMaximizedCleanup = vi.fn()
    const onUnmaximizedCleanup = vi.fn()
    const onEnterFullscreenCleanup = vi.fn()
    const onLeaveFullscreenCleanup = vi.fn()
    const onFocusCleanup = vi.fn()
    const onBlurCleanup = vi.fn()

    const windowAdapter: WindowAdapter = {
      previewFile: vi.fn(),
      openSettingsTab: vi.fn(),
      getDeviceInfo: vi.fn().mockResolvedValue({
        platform: 'darwin',
        osVersion: '14.0.0',
        osVersionMetadata: []
      }),
      onWindowMaximized: vi.fn().mockReturnValue(onMaximizedCleanup),
      onWindowUnmaximized: vi.fn().mockReturnValue(onUnmaximizedCleanup),
      onWindowEnterFullScreen: vi.fn().mockReturnValue(onEnterFullscreenCleanup),
      onWindowLeaveFullScreen: vi.fn().mockReturnValue(onLeaveFullscreenCleanup),
      onAppFocus: vi.fn().mockReturnValue(onFocusCleanup),
      onAppBlur: vi.fn().mockReturnValue(onBlurCleanup)
    }

    const store = createWindowStore({ windowAdapter })
    await store.initialize()

    expect(store.isMacOS.value).toBe(true)
    expect(store.isWindows.value).toBe(false)
    expect(store.isWinMacOS.value).toBe(true)

    const cleanup = store.bindEventListeners()
    expect(windowAdapter.onWindowMaximized).toHaveBeenCalledWith(expect.any(Function))
    expect(windowAdapter.onWindowUnmaximized).toHaveBeenCalledWith(expect.any(Function))
    expect(windowAdapter.onWindowEnterFullScreen).toHaveBeenCalledWith(expect.any(Function))
    expect(windowAdapter.onWindowLeaveFullScreen).toHaveBeenCalledWith(expect.any(Function))
    expect(windowAdapter.onAppFocus).toHaveBeenCalledWith(expect.any(Function))
    expect(windowAdapter.onAppBlur).toHaveBeenCalledWith(expect.any(Function))

    cleanup()
    expect(onMaximizedCleanup).toHaveBeenCalled()
    expect(onUnmaximizedCleanup).toHaveBeenCalled()
    expect(onEnterFullscreenCleanup).toHaveBeenCalled()
    expect(onLeaveFullscreenCleanup).toHaveBeenCalled()
    expect(onFocusCleanup).toHaveBeenCalled()
    expect(onBlurCleanup).toHaveBeenCalled()
  })
})
