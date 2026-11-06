import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import { SETTINGS_EVENTS } from '@/events'

const activateAppOnMacMock = vi.hoisted(() => vi.fn())
const registerNativePrimaryWindowMock = vi.hoisted(() => vi.fn())
const createNativeSettingsWindowMock = vi.hoisted(() => vi.fn())
const registerNativeWindowMock = vi.hoisted(() => vi.fn())
const nativeRendererDirectoryUrlMock = vi.hoisted(() => vi.fn())
const activateNativeSettingsWindowMock = vi.hoisted(() => vi.fn())
const closeNativeSettingsWindowMock = vi.hoisted(() => vi.fn())
const waitForNativeSettingsWindowClosedMock = vi.hoisted(() => vi.fn())
const isNativeWindowClosingMock = vi.hoisted(() => vi.fn())
const originalBrowserWindowFromId = (BrowserWindow as any).fromId

vi.mock('@/platform/appHost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/appHost')>()
  return {
    ...actual,
    appHost: {
      ...actual.appHost,
      registerNativePrimaryWindow: registerNativePrimaryWindowMock,
      createNativeSettingsWindow: createNativeSettingsWindowMock,
      registerNativeWindow: registerNativeWindowMock,
      activateNativeSettingsWindow: activateNativeSettingsWindowMock,
      closeNativeSettingsWindow: closeNativeSettingsWindowMock,
      waitForNativeSettingsWindowClosed: waitForNativeSettingsWindowClosedMock,
      isNativeWindowClosing: isNativeWindowClosingMock,
      getNativeRendererDirectoryUrl: nativeRendererDirectoryUrlMock
    }
  }
})

vi.mock('@/lib/activateApp', () => ({
  activateAppOnMac: activateAppOnMacMock
}))

vi.mock('electron-window-state', () => ({
  default: vi.fn(() => ({
    x: 0,
    y: 0,
    width: 900,
    height: 600,
    manage: vi.fn(),
    unmanage: vi.fn()
  }))
}))

function createSettingsLifecycleWindow(placeholderId: number): {
  window: any
  close: () => void
} {
  const listeners = new Map<string, Array<() => void>>()
  let destroyed = false
  const addListener = (name: string, listener: () => void): void => {
    listeners.set(name, [...(listeners.get(name) ?? []), listener])
  }
  const close = (): void => {
    if (destroyed) return
    destroyed = true
    for (const listener of listeners.get('closed') ?? []) listener()
  }
  const window: any = {
    id: placeholderId,
    loadURL: vi.fn(),
    on: vi.fn((name: string, listener: () => void) => {
      addListener(name, listener)
      return window
    }),
    once: vi.fn((name: string, listener: () => void) => {
      addListener(name, listener)
      return window
    }),
    removeListener: vi.fn((name: string, listener: () => void) => {
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((entry) => entry !== listener)
      )
      return window
    }),
    webContents: {
      id: placeholderId * -10,
      on: vi.fn(),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      setBackgroundThrottling: vi.fn(),
      setFrameRate: vi.fn(),
      openDevTools: vi.fn(),
      isDestroyed: vi.fn(() => destroyed)
    },
    isDestroyed: vi.fn(() => destroyed),
    setContentProtection: vi.fn(),
    setBackgroundColor: vi.fn(),
    setHiddenInMissionControl: vi.fn(),
    setSkipTaskbar: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn(close),
    close: vi.fn(close)
  }
  return { window, close }
}

describe('WindowPresenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    ;(BrowserWindow as any).fromId = originalBrowserWindowFromId
  })

  it('queues settings events until the settings renderer reports ready', async () => {
    const { WindowPresenter } = await import('@/desktop/window')
    const presenter = new WindowPresenter(
      {
        getContentProtectionEnabled: vi.fn(() => false)
      } as any,
      vi.fn(),
      vi.fn()
    )

    const send = vi.fn()
    ;(presenter as any).settingsWindow = {
      id: 9,
      isDestroyed: vi.fn(() => false),
      webContents: {
        id: 99,
        isDestroyed: vi.fn(() => false),
        send
      }
    }

    expect(
      presenter.sendToWindow(9, SETTINGS_EVENTS.NAVIGATE, {
        routeName: 'settings-deepchat-agents'
      })
    ).toBe(true)
    expect(
      presenter.sendToWindow(9, SETTINGS_EVENTS.NAVIGATE, {
        routeName: 'settings-about'
      })
    ).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect((presenter as any).pendingSettingsMessages).toHaveLength(2)

    presenter.notifySettingsReady(99)

    expect(send).toHaveBeenNthCalledWith(1, SETTINGS_EVENTS.NAVIGATE, {
      routeName: 'settings-deepchat-agents'
    })
    expect(send).toHaveBeenNthCalledWith(2, SETTINGS_EVENTS.NAVIGATE, {
      routeName: 'settings-about'
    })
    expect((presenter as any).pendingSettingsMessages).toHaveLength(0)
  })

  it('clears queued settings messages when the settings window state resets', async () => {
    const { WindowPresenter } = await import('@/desktop/window')
    const presenter = new WindowPresenter(
      {
        getContentProtectionEnabled: vi.fn(() => false)
      } as any,
      vi.fn(),
      vi.fn()
    )

    const queuedPreview = {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-secret',
      maskedApiKey: 'sk-s...cret',
      iconModelId: 'deepseek-chat',
      willOverwrite: true
    }

    ;(presenter as any).pendingSettingsMessages = [
      { channel: SETTINGS_EVENTS.NAVIGATE, args: [{ routeName: 'settings-about' }] }
    ]
    ;(presenter as any).pendingSettingsProviderInstalls = [queuedPreview]
    ;(presenter as any).settingsWindowReady = true
    ;(presenter as any).resetSettingsWindowState(true)

    expect((presenter as any).settingsWindowReady).toBe(false)
    expect((presenter as any).pendingSettingsMessages).toHaveLength(0)
    expect(queuedPreview.apiKey).toBe('')
    expect((presenter as any).pendingSettingsProviderInstalls).toHaveLength(0)
  })

  it('consumes pending provider installs in FIFO order', async () => {
    const { WindowPresenter } = await import('@/desktop/window')
    const presenter = new WindowPresenter(
      {
        getContentProtectionEnabled: vi.fn(() => false)
      } as any,
      vi.fn(),
      vi.fn()
    )

    const firstPreview = {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-first',
      maskedApiKey: 'sk-f...irst',
      iconModelId: 'deepseek-chat',
      willOverwrite: true
    }
    const secondPreview = {
      kind: 'custom' as const,
      name: 'DeepSeek Proxy',
      type: 'deepseek',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-second',
      maskedApiKey: 'sk-s...cond',
      iconModelId: 'deepseek-chat'
    }

    presenter.setPendingSettingsProviderInstall(firstPreview)
    presenter.setPendingSettingsProviderInstall(secondPreview)

    expect(presenter.consumePendingSettingsProviderInstall()).toEqual(firstPreview)
    expect(presenter.consumePendingSettingsProviderInstall()).toEqual(secondPreview)
    expect(presenter.consumePendingSettingsProviderInstall()).toBeNull()
  })

  it('keeps the settings window ready during same-document navigation', async () => {
    const { WindowPresenter } = await import('@/desktop/window')
    const presenter = new WindowPresenter(
      {
        getContentProtectionEnabled: vi.fn(() => false)
      } as any,
      vi.fn(),
      vi.fn()
    )

    ;(presenter as any).settingsWindow = {
      id: 9
    }
    ;(presenter as any).settingsWindowReady = true

    ;(presenter as any).handleSettingsWindowNavigationStart(9, true, true)
    expect((presenter as any).settingsWindowReady).toBe(true)

    ;(presenter as any).handleSettingsWindowNavigationStart(9, true, false)
    expect((presenter as any).settingsWindowReady).toBe(false)
  })

  it('binds native primary identity before reading or registering the window ID', async () => {
    const handlers = new Map<string, (...args: any[]) => void>()
    const appWindow = {
      id: -1,
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn((name: string, handler: (...args: any[]) => void) => {
        handlers.set(name, handler)
      }),
      once: vi.fn(),
      removeListener: vi.fn(),
      webContents: {
        id: 1010,
        send: vi.fn(),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        setBackgroundThrottling: vi.fn(),
        setFrameRate: vi.fn(),
        openDevTools: vi.fn(),
        isDestroyed: vi.fn(() => false)
      },
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      setContentProtection: vi.fn(),
      setBackgroundColor: vi.fn(),
      setHiddenInMissionControl: vi.fn(),
      setSkipTaskbar: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      hide: vi.fn(),
      restore: vi.fn()
    }
    vi.mocked(BrowserWindow).mockImplementationOnce(function () {
      return appWindow as any
    })
    const { WindowPresenter } = await import('@/desktop/window')
    const presenter = new WindowPresenter(
      {
        getContentProtectionEnabled: vi.fn(() => false),
        getCloseToQuit: vi.fn(() => false)
      } as any,
      vi.fn(),
      vi.fn()
    )
    presenter.bindTabPresenter({
      handleWindowSizeChanged: vi.fn(),
      handleWindowClosed: vi.fn(),
      getWindowTabsData: vi.fn(() => [])
    } as any)
    registerNativePrimaryWindowMock.mockImplementationOnce((window: { id: number }) => {
      expect(presenter.windows.size).toBe(0)
      expect(window.id).toBe(-1)
      window.id = 101
    })

    await expect(presenter.createAppWindow({ x: 0, y: 0 })).resolves.toBe(101)
    expect(presenter.windows.get(101)).toBe(appWindow)
    expect(appWindow.webContents.id).toBe(1010)
    expect(registerNativePrimaryWindowMock).toHaveBeenCalledTimes(1)
    expect(registerNativePrimaryWindowMock).toHaveBeenCalledWith(appWindow)
  })

  it('restores the main window only after close-to-hide', async () => {
    const windowHandlers = new Map<string, (...args: any[]) => void>()
    const appWindow = {
      id: 7,
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn((eventName: string, handler: (...args: any[]) => void) => {
        windowHandlers.set(eventName, handler)
      }),
      once: vi.fn(),
      removeListener: vi.fn(),
      webContents: {
        id: 70,
        send: vi.fn(),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        setBackgroundThrottling: vi.fn(),
        setFrameRate: vi.fn(),
        openDevTools: vi.fn(),
        isDestroyed: vi.fn(() => false)
      },
      isDestroyed: vi.fn(() => false),
      isFullScreen: vi.fn(() => false),
      isMaximized: vi.fn(() => false),
      isFocused: vi.fn(() => true),
      isMinimized: vi.fn(() => false),
      setFullScreen: vi.fn(),
      setContentProtection: vi.fn(),
      setBackgroundColor: vi.fn(),
      setHiddenInMissionControl: vi.fn(),
      setSkipTaskbar: vi.fn(),
      close: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      hide: vi.fn(),
      restore: vi.fn()
    }
    vi.mocked(BrowserWindow).mockImplementationOnce(function () {
      return appWindow as any
    })
    ;(BrowserWindow as any).fromId = vi.fn(() => appWindow)

    const { WindowPresenter } = await import('@/desktop/window')
    const onWindowCreated = vi.fn()
    const presenter = new WindowPresenter(
      {
        getContentProtectionEnabled: vi.fn(() => false),
        getCloseToQuit: vi.fn(() => false)
      } as any,
      vi.fn(),
      onWindowCreated
    )
    const tabPresenter = {
      handleWindowSizeChanged: vi.fn(),
      handleWindowClosed: vi.fn(),
      getWindowTabsData: vi.fn(() => [])
    }
    presenter.bindTabPresenter(tabPresenter as any)

    await presenter.createAppWindow({ x: 0, y: 0 })

    windowHandlers.get('ready-to-show')?.()
    expect(onWindowCreated).toHaveBeenCalledWith(true)
    appWindow.show.mockClear()
    appWindow.focus.mockClear()
    activateAppOnMacMock.mockClear()

    windowHandlers.get('resize')?.()
    expect(tabPresenter.handleWindowSizeChanged).toHaveBeenCalledWith(7)

    expect(presenter.restoreMainWindowHiddenByClose()).toBe(false)

    const preventDefault = vi.fn()
    windowHandlers.get('close')?.({ preventDefault })
    windowHandlers.get('show')?.()

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(appWindow.hide).toHaveBeenCalledOnce()
    expect(presenter.restoreMainWindowHiddenByClose()).toBe(false)

    windowHandlers.get('close')?.({ preventDefault })

    expect(presenter.restoreMainWindowHiddenByClose()).toBe(true)
    expect(appWindow.show).toHaveBeenCalledOnce()
    expect(appWindow.focus).toHaveBeenCalledOnce()
    expect(activateAppOnMacMock).toHaveBeenCalledOnce()
    expect(presenter.restoreMainWindowHiddenByClose()).toBe(false)

    ;(BrowserWindow as any).fromId = vi.fn(() => null)
    windowHandlers.get('closed')?.()
    expect(tabPresenter.handleWindowClosed).toHaveBeenCalledWith(7)
  })

  it('focuses and resumes through a recreated main window', async () => {
    const createAppWindowMock = (id: number, handlers: Map<string, (...args: any[]) => void>) => ({
      id,
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn((eventName: string, handler: (...args: any[]) => void) => {
        handlers.set(eventName, handler)
      }),
      removeListener: vi.fn(),
      webContents: {
        id: id * 10,
        send: vi.fn(),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        setBackgroundThrottling: vi.fn(),
        setFrameRate: vi.fn(),
        openDevTools: vi.fn(),
        isDestroyed: vi.fn(() => false)
      },
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      setContentProtection: vi.fn(),
      setBackgroundColor: vi.fn(),
      setHiddenInMissionControl: vi.fn(),
      setSkipTaskbar: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn()
    })
    const firstHandlers = new Map<string, (...args: any[]) => void>()
    const firstWindow = createAppWindowMock(7, firstHandlers)
    const secondWindow = createAppWindowMock(8, new Map())
    const windowsById = new Map<number, typeof firstWindow>([
      [firstWindow.id, firstWindow],
      [secondWindow.id, secondWindow]
    ])
    vi.mocked(BrowserWindow)
      .mockImplementationOnce(function () {
        return firstWindow as any
      })
      .mockImplementationOnce(function () {
        return secondWindow as any
      })
    ;(BrowserWindow as any).fromId = vi.fn((id: number) => windowsById.get(id) ?? null)

    const { WindowPresenter } = await import('@/desktop/window')
    const presenter = new WindowPresenter(
      {
        getContentProtectionEnabled: vi.fn(() => false),
        getCloseToQuit: vi.fn(() => true)
      } as any,
      vi.fn(),
      vi.fn()
    )
    presenter.bindTabPresenter({
      handleWindowSizeChanged: vi.fn(),
      handleWindowClosed: vi.fn(),
      getActiveTabId: vi.fn().mockResolvedValue(null)
    } as any)

    await presenter.createAppWindow({ x: 0, y: 0 })
    firstHandlers.get('closed')?.()
    windowsById.delete(firstWindow.id)
    await presenter.createAppWindow({ x: 0, y: 0 })

    expect(presenter.focusMainWindow()).toBe(true)
    expect(secondWindow.show).toHaveBeenCalledOnce()
    expect(secondWindow.focus).toHaveBeenCalledOnce()

    const resumeEvent = {
      name: 'appRuntime.guidedOnboardingResumeRequested',
      payload: {}
    }
    await expect(presenter.sendToMainWindow('deepchat:event', resumeEvent)).resolves.toBe(true)
    expect(secondWindow.webContents.send).toHaveBeenCalledWith('deepchat:event', resumeEvent)
  })

  it('sets a minimum size for the settings window', async () => {
    const { WindowPresenter } = await import('@/desktop/window')
    const presenter = new WindowPresenter(
      {
        getContentProtectionEnabled: vi.fn(() => false)
      } as any,
      vi.fn(),
      vi.fn()
    )

    await presenter.createSettingsWindow()

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        minWidth: 900,
        minHeight: 640
      })
    )
  })

  it('shares a pending native settings creation before constructing a wrapper', async () => {
    const nativeDescriptor = {
      windowId: 81,
      role: 'settings',
      documentUrl: 'about:blank',
      visible: false,
      focused: false
    } as const
    let releaseNativeWindow!: (value: typeof nativeDescriptor) => void
    createNativeSettingsWindowMock.mockReturnValue(
      new Promise((resolve) => {
        releaseNativeWindow = resolve
      })
    )
    registerNativeWindowMock.mockImplementation((window, descriptor) => {
      window.id = descriptor.windowId
    })
    nativeRendererDirectoryUrlMock.mockReturnValue('mygo://localhost/')
    const appWindow = {
      id: -1,
      loadURL: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      webContents: {
        id: 811,
        on: vi.fn(),
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        setBackgroundThrottling: vi.fn(),
        setFrameRate: vi.fn(),
        openDevTools: vi.fn(),
        isDestroyed: vi.fn(() => false)
      },
      isDestroyed: vi.fn(() => false),
      setContentProtection: vi.fn(),
      setBackgroundColor: vi.fn(),
      setHiddenInMissionControl: vi.fn(),
      setSkipTaskbar: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    }
    vi.mocked(BrowserWindow).mockImplementationOnce(function () {
      return appWindow as any
    })
    const { WindowPresenter } = await import('@/desktop/window')
    const presenter = new WindowPresenter(
      { getContentProtectionEnabled: vi.fn(() => false) } as any,
      vi.fn(),
      vi.fn()
    )

    const first = presenter.createSettingsWindow()
    const second = presenter.createSettingsWindow()
    await vi.waitFor(() => expect(createNativeSettingsWindowMock).toHaveBeenCalledTimes(1))
    expect(BrowserWindow).not.toHaveBeenCalled()
    releaseNativeWindow(nativeDescriptor)

    await expect(Promise.all([first, second])).resolves.toEqual([81, 81])
    expect(BrowserWindow).toHaveBeenCalledTimes(1)
    expect(registerNativeWindowMock).toHaveBeenCalledWith(appWindow, nativeDescriptor)
    expect(appWindow.loadURL).toHaveBeenCalledWith('mygo://localhost/settings/index.html')
    expect((presenter as any).settingsWindow).toBe(appWindow)
  })

  it('waits for actual closes during settings loading and immediate reopen', async () => {
    const fixtures = [-101, -102, -103].map(createSettingsLifecycleWindow)
    const closing = new Set<number>()
    let nextId = 80
    createNativeSettingsWindowMock.mockReset().mockImplementation(async () => ({
      windowId: ++nextId,
      role: 'settings',
      documentUrl: 'about:blank',
      visible: false,
      focused: false
    }))
    registerNativeWindowMock.mockImplementation((window, descriptor) => {
      window.id = descriptor.windowId
    })
    isNativeWindowClosingMock.mockImplementation((id) => closing.has(id))
    waitForNativeSettingsWindowClosedMock.mockImplementation((id) => {
      const fixture = fixtures.find((candidate) => candidate.window.id === id)
      if (!fixture || fixture.window.isDestroyed()) return Promise.resolve()
      return new Promise<void>((resolve) => fixture.window.once('closed', resolve))
    })
    nativeRendererDirectoryUrlMock.mockReturnValue('mygo://localhost/')
    vi.mocked(BrowserWindow)
      .mockImplementationOnce(function () {
        return fixtures[0].window
      })
      .mockImplementationOnce(function () {
        return fixtures[1].window
      })
      .mockImplementationOnce(function () {
        return fixtures[2].window
      })
    const { WindowPresenter } = await import('@/desktop/window')
    const presenter = new WindowPresenter(
      { getContentProtectionEnabled: vi.fn(() => false) } as any,
      vi.fn(),
      vi.fn()
    )

    let releaseLoad!: () => void
    let loadCalls = 0
    const loading = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    fixtures[0].window.loadURL = () => {
      loadCalls++
      return loading
    }
    const creation = presenter.createSettingsWindow()
    await vi.waitFor(() => expect(loadCalls).toBe(1))
    expect((presenter as any).settingsWindow).toBe(fixtures[0].window)
    closing.add(fixtures[0].window.id)
    releaseLoad()
    await vi.waitFor(() => expect(waitForNativeSettingsWindowClosedMock).toHaveBeenCalledWith(81))
    expect(createNativeSettingsWindowMock).toHaveBeenCalledTimes(1)

    fixtures[0].close()
    await expect(creation).resolves.toBe(82)

    closing.add(82)
    const reopened = presenter.createSettingsWindow()
    await vi.waitFor(() => expect(waitForNativeSettingsWindowClosedMock).toHaveBeenCalledWith(82))
    expect(createNativeSettingsWindowMock).toHaveBeenCalledTimes(2)
    fixtures[1].close()
    await expect(reopened).resolves.toBe(83)
    expect(createNativeSettingsWindowMock).toHaveBeenCalledTimes(3)
    expect((presenter as any).settingsWindow).toBe(fixtures[2].window)
  })

  it('closes the native settings window when loading fails', async () => {
    const fixture = createSettingsLifecycleWindow(-101)
    createNativeSettingsWindowMock.mockReset().mockResolvedValue({
      windowId: 81,
      role: 'settings',
      documentUrl: 'about:blank',
      visible: false,
      focused: false
    })
    registerNativeWindowMock.mockImplementation((window, descriptor) => {
      window.id = descriptor.windowId
    })
    const closing = new Set<number>()
    isNativeWindowClosingMock.mockImplementation((id) => closing.has(id))
    closeNativeSettingsWindowMock.mockImplementation(async (id: number) => {
      closing.add(id)
      fixture.close()
    })
    waitForNativeSettingsWindowClosedMock.mockResolvedValue(undefined)
    nativeRendererDirectoryUrlMock.mockReturnValue('mygo://localhost/')
    fixture.window.loadURL = async () => {
      throw new Error('settings document failed')
    }
    vi.mocked(BrowserWindow).mockImplementationOnce(function () {
      return fixture.window
    })
    const { WindowPresenter } = await import('@/desktop/window')
    const presenter = new WindowPresenter(
      { getContentProtectionEnabled: vi.fn(() => false) } as any,
      vi.fn(),
      vi.fn()
    )

    await expect(presenter.createSettingsWindow({ routeName: 'settings-about' })).rejects.toThrow(
      'settings document failed'
    )
    expect(closeNativeSettingsWindowMock).toHaveBeenCalledWith(81)
    expect(fixture.window.isDestroyed()).toBe(true)
    expect((presenter as any).settingsWindow).toBeNull()
    expect((presenter as any).pendingSettingsMessages).toHaveLength(0)
  })

  it('preserves per-tab delivery order across consecutive sendToAllWindows broadcasts', async () => {
    const { WindowPresenter } = await import('@/desktop/window')
    const presenter = new WindowPresenter(
      {
        getContentProtectionEnabled: vi.fn(() => false)
      } as any,
      vi.fn(),
      vi.fn()
    )

    const send = vi.fn()
    ;(presenter as any).windows = new Map([
      [
        1,
        {
          id: 1,
          isDestroyed: vi.fn(() => false),
          webContents: { id: 11, isDestroyed: vi.fn(() => false), send }
        }
      ]
    ])

    const tab = {
      id: 'tab-1',
      webContents: { id: 21, isDestroyed: vi.fn(() => false), send }
    }
    let pendingFirstLookup: ((value: unknown) => void) | null = null
    let getTabCalls = 0
    const tabPresenter = {
      getWindowTabsData: vi.fn(async () => [{ id: 'tab-1' }]),
      // The first broadcast's tab lookup stalls; the second's resolves immediately.
      getTab: vi.fn(() => {
        getTabCalls += 1
        if (getTabCalls === 1) {
          return new Promise((resolve) => {
            pendingFirstLookup = resolve
          })
        }
        return Promise.resolve(tab)
      })
    }
    presenter.bindTabPresenter(tabPresenter as any)

    const first = presenter.sendToAllWindows('test-msg', 'first')
    const second = presenter.sendToAllWindows('test-msg', 'second')

    await new Promise((resolve) => setTimeout(resolve, 0))
    pendingFirstLookup?.(tab)
    await Promise.all([first, second])

    // Main webContents of both broadcasts first (synchronous), then tab
    // deliveries must arrive in broadcast order despite the delayed lookup.
    expect(send).toHaveBeenCalledTimes(4)
    expect(send).toHaveBeenNthCalledWith(3, 'test-msg', 'first')
    expect(send).toHaveBeenNthCalledWith(4, 'test-msg', 'second')
  })
})
