import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventBus } from '../../../../src/main/eventbus'
import { WINDOW_EVENTS } from '../../../../src/main/events'

const createdWindows = vi.hoisted(() => [] as MockBrowserWindow[])

class MockBrowserWindow {
  public visible = false
  public destroyed = false
  public readonly show = vi.fn(() => {
    this.visible = true
  })
  public readonly close = vi.fn(() => {
    this.destroyed = true
    this.emit('closed')
  })
  public readonly loadURL = vi.fn().mockResolvedValue(undefined)
  public readonly loadFile = vi.fn().mockResolvedValue(undefined)
  public readonly webContents = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = this.webContentsHandlers.get(event) ?? []
      handlers.push(handler)
      this.webContentsHandlers.set(event, handlers)
    }),
    send: vi.fn()
  }

  private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  private readonly webContentsHandlers = new Map<string, Array<(...args: unknown[]) => void>>()

  constructor() {
    createdWindows.push(this)
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    const handlers = this.handlers.get(event) ?? []
    handlers.push(handler)
    this.handlers.set(event, handlers)
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args)
    }
  }

  isDestroyed() {
    return this.destroyed
  }

  isVisible() {
    return this.visible
  }
}

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  nativeImage: {
    createFromPath: vi.fn(() => ({}))
  }
}))

describe('SplashWindowManager display gating', () => {
  let manager: InstanceType<
    typeof import('../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager').SplashWindowManager
  > | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    createdWindows.length = 0
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
    eventBus.sendToMain(WINDOW_EVENTS.WINDOW_CREATED, 1)
    await vi.advanceTimersByTimeAsync(200)

    expect(splashWindow.show).not.toHaveBeenCalled()
    expect(manager.isVisible()).toBe(false)
  })
})
