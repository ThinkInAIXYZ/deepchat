import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventBus } from '../../../../src/main/eventbus'
import { WINDOW_EVENTS } from '../../../../src/main/events'

const createdWindows = vi.hoisted(() => [] as MockBrowserWindow[])
const mockIpcMain = vi.hoisted(() => ({
  on: vi.fn()
}))
const splashLoadMocks = vi.hoisted(() => ({
  loadURL: undefined as ((url: string) => Promise<void>) | undefined,
  loadFile: undefined as ((filePath: string) => Promise<void>) | undefined
}))

class MockBrowserWindow {
  private static nextWebContentsId = 1
  public visible = false
  public destroyed = false
  public readonly show = vi.fn(() => {
    this.visible = true
  })
  public readonly focus = vi.fn()
  public readonly close = vi.fn(() => {
    this.destroyed = true
    this.emit('closed')
  })
  public readonly loadURL = vi.fn((url: string) => {
    return splashLoadMocks.loadURL?.(url) ?? Promise.resolve()
  })
  public readonly loadFile = vi.fn((filePath: string) => {
    return splashLoadMocks.loadFile?.(filePath) ?? Promise.resolve()
  })
  public readonly webContents = {
    id: MockBrowserWindow.nextWebContentsId++,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      this.addHandler(this.webContentsHandlers, event, handler)
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const wrappedHandler = (...args: unknown[]) => {
        this.removeHandler(this.webContentsHandlers, event, wrappedHandler)
        handler(...args)
      }
      this.addHandler(this.webContentsHandlers, event, wrappedHandler)
    }),
    send: vi.fn()
  }

  private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  private readonly webContentsHandlers = new Map<string, Array<(...args: unknown[]) => void>>()

  constructor() {
    createdWindows.push(this)
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    this.addHandler(this.handlers, event, handler)
  }

  once(event: string, handler: (...args: unknown[]) => void) {
    const wrappedHandler = (...args: unknown[]) => {
      this.removeHandler(this.handlers, event, wrappedHandler)
      handler(...args)
    }
    this.addHandler(this.handlers, event, wrappedHandler)
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      handler(...args)
    }
  }

  emitWebContents(event: string, ...args: unknown[]) {
    for (const handler of [...(this.webContentsHandlers.get(event) ?? [])]) {
      handler(...args)
    }
  }

  isDestroyed() {
    return this.destroyed
  }

  isVisible() {
    return this.visible
  }

  private addHandler(
    map: Map<string, Array<(...args: unknown[]) => void>>,
    event: string,
    handler: (...args: unknown[]) => void
  ) {
    const handlers = map.get(event) ?? []
    handlers.push(handler)
    map.set(event, handlers)
  }

  private removeHandler(
    map: Map<string, Array<(...args: unknown[]) => void>>,
    event: string,
    handler: (...args: unknown[]) => void
  ) {
    const handlers = map.get(event) ?? []
    const index = handlers.indexOf(handler)
    if (index >= 0) {
      handlers.splice(index, 1)
    }
  }
}

vi.mock('electron', () => ({
  app: {
    setActivationPolicy: vi.fn(),
    focus: vi.fn(),
    dock: {
      show: vi.fn()
    }
  },
  BrowserWindow: MockBrowserWindow,
  ipcMain: mockIpcMain,
  nativeImage: {
    createFromPath: vi.fn(() => ({}))
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true
  }
}))

const flushPromises = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
  }
}

describe('SplashWindowManager display gating', () => {
  let manager: InstanceType<
    typeof import('../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager').SplashWindowManager
  > | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    createdWindows.length = 0
    mockIpcMain.on.mockClear()
    splashLoadMocks.loadURL = undefined
    splashLoadMocks.loadFile = undefined
    delete process.env.ELECTRON_RENDERER_URL
  })

  afterEach(async () => {
    if (manager) {
      const closePromise = manager.close()
      await vi.runAllTimersAsync()
      await closePromise
      manager = null
    }
    vi.useRealTimers()
    createdWindows.length = 0
  })

  it('waits 200ms before showing the splash window', async () => {
    const { SplashWindowManager } =
      await import('../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager')

    manager = new SplashWindowManager()
    await manager.create()

    const splashWindow = createdWindows[0]
    expect(splashWindow).toBeTruthy()

    splashWindow.emit('ready-to-show')
    expect(splashWindow.show).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(199)
    expect(splashWindow.show).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(splashWindow.show).toHaveBeenCalledTimes(1)
  })

  it('skips showing the splash window when the main window is created first', async () => {
    const { SplashWindowManager } =
      await import('../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager')

    manager = new SplashWindowManager()
    await manager.create()

    const splashWindow = createdWindows[0]
    expect(splashWindow).toBeTruthy()

    splashWindow.emit('ready-to-show')
    eventBus.sendToMain(WINDOW_EVENTS.WINDOW_CREATED, {
      windowId: 1,
      isMainWindow: true
    })
    await vi.advanceTimersByTimeAsync(200)

    expect(splashWindow.close).toHaveBeenCalledTimes(1)
    expect(splashWindow.show).not.toHaveBeenCalled()
    expect(manager.isVisible()).toBe(false)
  })

  it('does not suppress the splash when a non-main window is created first', async () => {
    const { SplashWindowManager } =
      await import('../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager')

    manager = new SplashWindowManager()
    await manager.create()

    const splashWindow = createdWindows[0]
    expect(splashWindow).toBeTruthy()

    splashWindow.emit('ready-to-show')
    eventBus.sendToMain(WINDOW_EVENTS.WINDOW_CREATED, {
      windowId: 2,
      isMainWindow: false
    })
    await vi.advanceTimersByTimeAsync(200)

    expect(splashWindow.close).not.toHaveBeenCalled()
    expect(splashWindow.show).toHaveBeenCalledTimes(1)
    expect(manager.isVisible()).toBe(true)
  })

  it('closes a hidden splash immediately without waiting for the 500ms transition delay', async () => {
    const { SplashWindowManager } =
      await import('../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager')

    manager = new SplashWindowManager()
    await manager.create()

    const splashWindow = createdWindows[0]
    expect(splashWindow).toBeTruthy()

    const closePromise = manager.close()
    await Promise.resolve()

    expect(splashWindow.close).toHaveBeenCalledTimes(1)
    await closePromise
  })

  it('shows manual database unlock as soon as the renderer has loaded', async () => {
    const { SplashWindowManager } =
      await import('../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager')

    manager = new SplashWindowManager()
    await manager.create()

    const splashWindow = createdWindows[0]
    expect(splashWindow).toBeTruthy()

    const unlockPromise = manager.requestDatabaseUnlock({
      reason: 'system-key-missing',
      safeStorageAvailable: true
    })
    await Promise.resolve()

    expect(splashWindow.show).toHaveBeenCalledTimes(1)
    expect(splashWindow.focus).toHaveBeenCalledTimes(1)

    const closePromise = manager.close()
    await vi.runAllTimersAsync()
    await expect(unlockPromise).resolves.toBeNull()
    await closePromise
    manager = null
  })

  it('shows encrypted database progress before password detection without waiting for the delay', async () => {
    const { SplashWindowManager } =
      await import('../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager')

    manager = new SplashWindowManager()
    await manager.create()

    const splashWindow = createdWindows[0]
    expect(splashWindow).toBeTruthy()

    manager.showDatabaseUnlockProgress(
      {
        active: true,
        safeStorageAvailable: true
      },
      { skipDelay: true }
    )
    await Promise.resolve()

    expect(splashWindow.show).toHaveBeenCalledTimes(1)
    expect(splashWindow.focus).toHaveBeenCalledTimes(1)
  })

  it('does not show the splash for inactive database unlock progress', async () => {
    const { SplashWindowManager } =
      await import('../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager')

    manager = new SplashWindowManager()
    await manager.create()

    const splashWindow = createdWindows[0]
    expect(splashWindow).toBeTruthy()

    manager.showDatabaseUnlockProgress({
      active: false,
      safeStorageAvailable: true
    })
    await vi.advanceTimersByTimeAsync(200)

    expect(splashWindow.show).not.toHaveBeenCalled()
  })

  it('falls back to an inline splash renderer when the dev page is unavailable', async () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    splashLoadMocks.loadURL = vi.fn(async (url: string) => {
      if (url.startsWith('data:text/html')) {
        return
      }
      throw new Error('dev renderer unavailable')
    })
    splashLoadMocks.loadFile = vi.fn(async () => {
      throw new Error('file renderer unavailable')
    })

    const { SplashWindowManager } =
      await import('../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager')

    manager = new SplashWindowManager()
    await manager.create()
    await flushPromises()

    const splashWindow = createdWindows[0]
    expect(splashWindow).toBeTruthy()
    expect(splashWindow.loadURL).toHaveBeenNthCalledWith(
      1,
      'http://localhost:5173/splash/index.html'
    )
    expect(splashWindow.loadURL).toHaveBeenNthCalledWith(2, 'http://localhost:5173/splash/')
    expect(splashWindow.loadFile).toHaveBeenCalledTimes(1)
    expect(splashWindow.loadURL).toHaveBeenLastCalledWith(expect.stringMatching(/^data:text\/html/))
  })

  it('stops splash renderer fallback quietly after the hidden splash is suppressed', async () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    splashLoadMocks.loadURL = vi.fn(async () => {
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_CREATED, {
        windowId: 1,
        isMainWindow: true
      })
      throw new Error('dev renderer unavailable')
    })
    splashLoadMocks.loadFile = vi.fn(async () => {
      throw new Error('file renderer unavailable')
    })

    try {
      const { SplashWindowManager } =
        await import('../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager')

      manager = new SplashWindowManager()
      await manager.create()
      await flushPromises()

      const splashWindow = createdWindows[0]
      expect(splashWindow).toBeTruthy()
      expect(splashWindow.close).toHaveBeenCalledTimes(1)
      expect(splashWindow.loadURL).toHaveBeenCalledTimes(1)
      expect(splashWindow.loadFile).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalledWith('Failed to load splash window:', expect.anything())
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[SplashWindow] Failed to load dev splash URL'),
        expect.anything()
      )
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})
