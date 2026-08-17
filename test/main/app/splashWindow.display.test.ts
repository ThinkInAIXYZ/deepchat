import path from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createdWindows = vi.hoisted(() => [] as MockBrowserWindow[])
const browserWindowOptions = vi.hoisted(() => [] as Record<string, unknown>[])
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

  constructor(options: Record<string, unknown>) {
    browserWindowOptions.push(options)
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

describe('SplashWindow display gating', () => {
  it('keeps the splash document root transparent', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const documentSource = readFileSync(
      path.resolve(process.cwd(), 'src/renderer/splash/index.html'),
      'utf8'
    )

    expect(documentSource).toContain('background: transparent;')
    expect(documentSource).not.toContain('background: #020817;')
  })

  let manager: InstanceType<
    typeof import('../../../src/main/app/splashWindow').SplashWindow
  > | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    createdWindows.length = 0
    browserWindowOptions.length = 0
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

  it('creates a transparent splash window canvas', async () => {
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
    await manager.create()

    expect(browserWindowOptions[0]).toMatchObject({
      transparent: true,
      backgroundColor: '#00000000'
    })
  })

  it('waits 200ms before showing the splash window', async () => {
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
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
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
    await manager.create()

    const splashWindow = createdWindows[0]
    expect(splashWindow).toBeTruthy()

    splashWindow.emit('ready-to-show')
    manager.handleWindowCreated(true)
    await vi.advanceTimersByTimeAsync(200)

    expect(splashWindow.close).toHaveBeenCalledTimes(1)
    expect(splashWindow.show).not.toHaveBeenCalled()
    expect(manager.isVisible()).toBe(false)
  })

  it('does not suppress the splash when a non-main window is created first', async () => {
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
    await manager.create()

    const splashWindow = createdWindows[0]
    expect(splashWindow).toBeTruthy()

    splashWindow.emit('ready-to-show')
    manager.handleWindowCreated(false)
    await vi.advanceTimersByTimeAsync(200)

    expect(splashWindow.close).not.toHaveBeenCalled()
    expect(splashWindow.show).toHaveBeenCalledTimes(1)
    expect(manager.isVisible()).toBe(true)
  })

  it('closes a hidden splash immediately without waiting for the 500ms transition delay', async () => {
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
    await manager.create()

    const splashWindow = createdWindows[0]
    expect(splashWindow).toBeTruthy()

    const closePromise = manager.close()
    await Promise.resolve()

    expect(splashWindow.close).toHaveBeenCalledTimes(1)
    await closePromise
  })

  it('shows manual database unlock as soon as the renderer has loaded', async () => {
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
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
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
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
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
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

  it('delivers debug mode after the splash document has loaded and replays it after reload', async () => {
    const { SPLASH_DEBUG_MODE_CHANNEL } = await import('../../../src/shared/contracts/splash')
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
    await manager.showDebugScenario('system-unlock')

    const splashWindow = createdWindows[0]
    expect(splashWindow.webContents.send).toHaveBeenCalledWith(
      SPLASH_DEBUG_MODE_CHANNEL,
      'system-unlock'
    )

    splashWindow.webContents.send.mockClear()
    splashWindow.emitWebContents('did-finish-load')

    expect(splashWindow.webContents.send).toHaveBeenCalledWith(
      SPLASH_DEBUG_MODE_CHANNEL,
      'system-unlock'
    )
  })

  it('does not resolve an active unlock request when closing a debug preview', async () => {
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
    await manager.create()
    const unlockPromise = manager.requestDatabaseUnlock({
      reason: 'manual-required',
      safeStorageAvailable: true
    })
    let unlockSettled = false
    void unlockPromise.then(() => {
      unlockSettled = true
    })

    await manager.showDebugScenario('unlock')
    await expect(manager.closeDebugScenario()).resolves.toBe(true)
    await Promise.resolve()

    expect(unlockSettled).toBe(false)

    await manager.close()
    await expect(unlockPromise).resolves.toBeNull()
    manager = null
  })

  it('shows database recovery as soon as the renderer has loaded', async () => {
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
    await manager.create()

    const splashWindow = createdWindows[0]
    const recoveryPromise = manager.requestDatabaseRecovery({
      kind: 'true-corruption',
      preservedPath: '/tmp/agent.db.corrupt.*'
    })
    await Promise.resolve()

    expect(splashWindow.show).toHaveBeenCalledTimes(1)
    const closePromise = manager.close()
    await vi.runAllTimersAsync()
    await expect(recoveryPromise).resolves.toBeNull()
    await closePromise
    manager = null
  })

  it('resolves a pending recovery request when the splash window is destroyed', async () => {
    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
    await manager.create()

    const splashWindow = createdWindows[0]
    const recoveryPromise = manager.requestDatabaseRecovery({
      kind: 'true-corruption',
      preservedPath: '/tmp/agent.db.corrupt.1'
    })
    await Promise.resolve()

    splashWindow.emit('closed')
    await expect(recoveryPromise).resolves.toBeNull()
    manager = null
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

    const { SplashWindow } = await import('../../../src/main/app/splashWindow')

    manager = new SplashWindow()
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
    const fallbackUrl = splashWindow.loadURL.mock.calls.at(-1)?.[0]
    expect(fallbackUrl).toMatch(/^data:text\/html/)
    const fallbackHtml = decodeURIComponent(fallbackUrl!.split(',', 2)[1])
    expect(fallbackHtml).toContain(
      'html, body { width: 100%; height: 100%; margin: 0; background: transparent;'
    )
    expect(fallbackHtml).toContain('.shell--manual-unlock { background: #020817; }')
    let debugModeListener: ((mode: 'loading' | 'system-unlock' | 'unlock') => void) | undefined
    let unlockRequestListener:
      | ((payload: {
          requestId: string
          reason: 'invalid' | 'manual-required' | 'system-key-missing'
          safeStorageAvailable: boolean
        }) => void)
      | undefined
    const splash = {
      onDebugMode: vi.fn((listener) => {
        debugModeListener = listener
      }),
      onUnlockRequest: vi.fn((listener) => {
        unlockRequestListener = listener
      }),
      onUnlockProgress: vi.fn(),
      onRecoveryRequest: vi.fn(),
      submitUnlock: vi.fn(),
      cancelUnlock: vi.fn(),
      submitRecovery: vi.fn(),
      cancelRecovery: vi.fn()
    }
    const dom = new JSDOM(fallbackHtml, {
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.defineProperty(window, 'deepchatSplash', { value: splash })
      }
    })

    try {
      const { document } = dom.window
      const subtitle = document.getElementById('subtitle')!
      const password = document.getElementById('password') as HTMLInputElement
      const actions = document.getElementById('actions')!
      const submit = document.getElementById('submit') as HTMLButtonElement
      const quit = document.getElementById('quit') as HTMLButtonElement
      const hint = document.getElementById('hint')!

      expect(debugModeListener).toBeTypeOf('function')
      expect(unlockRequestListener).toBeTypeOf('function')

      debugModeListener?.('loading')
      expect(subtitle.textContent).toBe('Unlocking local database')
      expect(hint.textContent).toBe('DeepChat is starting.')
      expect(password.hidden).toBe(true)
      expect(actions.hidden).toBe(true)

      debugModeListener?.('system-unlock')
      expect(subtitle.textContent).toBe('Unlocking local database')
      expect(hint.textContent).toBe(
        'DeepChat is reading the saved password from the system credential store.'
      )
      expect(password.hidden).toBe(true)
      expect(actions.hidden).toBe(true)

      debugModeListener?.('unlock')
      expect(subtitle.textContent).toBe('Local database is encrypted')
      expect(hint.textContent).toBe('Development preview — password submission is disabled.')
      expect(password.disabled).toBe(true)
      expect(submit.disabled).toBe(true)
      expect(quit.disabled).toBe(true)
      password.value = 'preview-password'
      password.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      document
        .getElementById('panel')!
        .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
      quit.click()
      expect(splash.submitUnlock).not.toHaveBeenCalled()
      expect(splash.cancelUnlock).not.toHaveBeenCalled()

      unlockRequestListener?.({
        requestId: 'request-1',
        reason: 'manual-required',
        safeStorageAvailable: true
      })
      expect(password.disabled).toBe(false)
      expect(quit.disabled).toBe(false)
      expect(submit.disabled).toBe(true)
      password.value = 'real-password'
      password.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      expect(submit.disabled).toBe(false)
      document
        .getElementById('panel')!
        .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
      quit.click()
      expect(splash.submitUnlock).toHaveBeenCalledWith({
        requestId: 'request-1',
        password: 'real-password'
      })
      expect(splash.cancelUnlock).toHaveBeenCalledWith({ requestId: 'request-1' })
    } finally {
      dom.window.close()
    }
  })

  it('stops splash renderer fallback quietly after the hidden splash is suppressed', async () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    splashLoadMocks.loadURL = vi.fn(async () => {
      manager?.handleWindowCreated(true)
      throw new Error('dev renderer unavailable')
    })
    splashLoadMocks.loadFile = vi.fn(async () => {
      throw new Error('file renderer unavailable')
    })

    try {
      const { SplashWindow } = await import('../../../src/main/app/splashWindow')

      manager = new SplashWindow()
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
