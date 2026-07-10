import { beforeEach, describe, expect, it, vi } from 'vitest'

const appOnMock = vi.hoisted(() => vi.fn())
const appIsHiddenMock = vi.hoisted(() => vi.fn())
const optimizerWatchMock = vi.hoisted(() => vi.fn())
const loggerInfoMock = vi.hoisted(() => vi.fn())
const windowPresenterMock = vi.hoisted(() => ({
  getAllWindows: vi.fn(),
  getFocusedWindow: vi.fn(),
  createAppWindow: vi.fn(),
  restoreMainWindowHiddenByClose: vi.fn(),
  clearMainWindowHiddenByClose: vi.fn(),
  createSettingsWindow: vi.fn(),
  sendSettingsNavigation: vi.fn(),
  sendSettingsCheckForUpdates: vi.fn()
}))
const floatingButtonPresenterMock = vi.hoisted(() => ({
  setEnabled: vi.fn()
}))
const shortcutPresenterMock = vi.hoisted(() => ({
  registerShortcuts: vi.fn(),
  unregisterShortcuts: vi.fn()
}))
const eventBusMock = vi.hoisted(() => ({
  on: vi.fn(),
  sendToMain: vi.fn()
}))

vi.mock('@shared/logger', () => ({
  default: {
    info: loggerInfoMock
  }
}))

vi.mock('electron', () => ({
  app: {
    on: appOnMock,
    isHidden: appIsHiddenMock
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  optimizer: {
    watchWindowShortcuts: optimizerWatchMock
  }
}))

vi.mock('@/presenter', () => ({
  presenter: {
    windowPresenter: windowPresenterMock,
    floatingButtonPresenter: floatingButtonPresenterMock,
    shortcutPresenter: shortcutPresenterMock
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: eventBusMock
}))

const { eventListenerSetupHook } =
  await import('@/presenter/lifecyclePresenter/hooks/ready/eventListenerSetupHook')

describe('eventListenerSetupHook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    windowPresenterMock.getAllWindows.mockReturnValue([])
    windowPresenterMock.getFocusedWindow.mockReturnValue(undefined)
    windowPresenterMock.restoreMainWindowHiddenByClose.mockReturnValue(false)
    appIsHiddenMock.mockReturnValue(false)
  })

  it('creates a chat window when macOS activates the app with no existing windows', async () => {
    await eventListenerSetupHook.execute({} as never)

    const activateHandler = appOnMock.mock.calls.find(
      ([eventName]) => eventName === 'activate'
    )?.[1]
    expect(activateHandler).toBeTypeOf('function')

    activateHandler()

    expect(windowPresenterMock.createAppWindow).toHaveBeenCalledWith({ initialRoute: 'chat' })
  })

  it('restores a main window hidden by close when macOS activates the app', async () => {
    windowPresenterMock.restoreMainWindowHiddenByClose.mockReturnValue(true)

    await eventListenerSetupHook.execute({} as never)

    const activateHandler = appOnMock.mock.calls.find(
      ([eventName]) => eventName === 'activate'
    )?.[1]
    expect(activateHandler).toBeTypeOf('function')

    activateHandler()

    expect(windowPresenterMock.restoreMainWindowHiddenByClose).toHaveBeenCalledOnce()
    expect(windowPresenterMock.getAllWindows).not.toHaveBeenCalled()
    expect(windowPresenterMock.createAppWindow).not.toHaveBeenCalled()
  })

  it('does not reveal windows hidden by the native macOS Hide command', async () => {
    const hiddenWindow = {
      id: 7,
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn()
    }
    windowPresenterMock.getAllWindows.mockReturnValue([hiddenWindow])
    windowPresenterMock.getFocusedWindow.mockReturnValue(hiddenWindow)

    await eventListenerSetupHook.execute({} as never)

    const activateHandler = appOnMock.mock.calls.find(
      ([eventName]) => eventName === 'activate'
    )?.[1]
    expect(activateHandler).toBeTypeOf('function')

    activateHandler()

    expect(windowPresenterMock.restoreMainWindowHiddenByClose).toHaveBeenCalledOnce()
    expect(windowPresenterMock.createAppWindow).not.toHaveBeenCalled()
    expect(hiddenWindow.show).not.toHaveBeenCalled()
    expect(hiddenWindow.focus).not.toHaveBeenCalled()
  })

  it('clears close-to-hide restoration when macOS hides the application', async () => {
    vi.useFakeTimers()
    appIsHiddenMock.mockReturnValue(true)

    try {
      await eventListenerSetupHook.execute({} as never)

      const didResignActiveHandler = appOnMock.mock.calls.find(
        ([eventName]) => eventName === 'did-resign-active'
      )?.[1]
      expect(didResignActiveHandler).toBeTypeOf('function')

      didResignActiveHandler()
      await vi.runAllTimersAsync()

      expect(windowPresenterMock.clearMainWindowHiddenByClose).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps close-to-hide restoration when macOS only deactivates the application', async () => {
    vi.useFakeTimers()

    try {
      await eventListenerSetupHook.execute({} as never)

      const didResignActiveHandler = appOnMock.mock.calls.find(
        ([eventName]) => eventName === 'did-resign-active'
      )?.[1]
      expect(didResignActiveHandler).toBeTypeOf('function')

      didResignActiveHandler()
      await vi.runAllTimersAsync()

      expect(windowPresenterMock.clearMainWindowHiddenByClose).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
