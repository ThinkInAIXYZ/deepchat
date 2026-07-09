import { beforeEach, describe, expect, it, vi } from 'vitest'

const appOnMock = vi.hoisted(() => vi.fn())
const optimizerWatchMock = vi.hoisted(() => vi.fn())
const loggerInfoMock = vi.hoisted(() => vi.fn())
const windowPresenterMock = vi.hoisted(() => ({
  getAllWindows: vi.fn(),
  getFocusedWindow: vi.fn(),
  createAppWindow: vi.fn(),
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
    on: appOnMock
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

  it('does not reveal existing hidden windows on generic macOS activation', async () => {
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

    expect(windowPresenterMock.createAppWindow).not.toHaveBeenCalled()
    expect(hiddenWindow.show).not.toHaveBeenCalled()
    expect(hiddenWindow.focus).not.toHaveBeenCalled()
  })
})
