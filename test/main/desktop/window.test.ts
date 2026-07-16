import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import { SETTINGS_EVENTS } from '@/events'

const activateAppOnMacMock = vi.hoisted(() => vi.fn())
const originalBrowserWindowFromId = (BrowserWindow as any).fromId

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
    vi.mocked(BrowserWindow).mockImplementationOnce(() => appWindow as any)
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
})
