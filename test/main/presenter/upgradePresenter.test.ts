import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_EVENTS, WINDOW_EVENTS } from '../../../src/main/events'

const {
  autoUpdaterState,
  sendToMainMock,
  sendToRendererMock,
  floatingButtonDestroyMock,
  destroyFloatingChatWindowMock,
  setApplicationQuittingMock,
  appQuitMock,
  appRelaunchMock,
  appExitMock
} = vi.hoisted(() => {
  const autoUpdaterState = {
    listeners: new Map<string, (...args: unknown[]) => void>(),
    reset() {
      this.listeners.clear()
    }
  }

  return {
    autoUpdaterState,
    sendToMainMock: vi.fn(),
    sendToRendererMock: vi.fn(),
    floatingButtonDestroyMock: vi.fn(),
    destroyFloatingChatWindowMock: vi.fn(),
    setApplicationQuittingMock: vi.fn(),
    appQuitMock: vi.fn(),
    appRelaunchMock: vi.fn(),
    appExitMock: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/deepchat-test'),
    quit: appQuitMock,
    relaunch: appRelaunchMock,
    exit: appExitMock
  },
  shell: {
    openExternal: vi.fn()
  }
}))

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      autoDownload: false,
      allowDowngrade: false,
      autoInstallOnAppQuit: true,
      allowPrerelease: false,
      channel: 'latest',
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        autoUpdaterState.listeners.set(event, handler)
      }),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn()
    }
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    sendToMain: sendToMainMock,
    sendToRenderer: sendToRendererMock
  },
  SendTarget: {
    ALL_WINDOWS: 'all_windows'
  }
}))

vi.mock('@/presenter', () => ({
  presenter: {
    windowPresenter: {
      setApplicationQuitting: setApplicationQuittingMock,
      destroyFloatingChatWindow: destroyFloatingChatWindowMock
    },
    floatingButtonPresenter: {
      destroy: floatingButtonDestroyMock
    }
  }
}))

import electronUpdater from 'electron-updater'
import { UpgradePresenter } from '../../../src/main/presenter/upgradePresenter'

describe('UpgradePresenter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    autoUpdaterState.reset()
    sendToMainMock.mockReset()
    sendToRendererMock.mockReset()
    floatingButtonDestroyMock.mockReset()
    destroyFloatingChatWindowMock.mockReset()
    setApplicationQuittingMock.mockReset()
    appQuitMock.mockReset()
    appRelaunchMock.mockReset()
    appExitMock.mockReset()
    vi.mocked(electronUpdater.autoUpdater.checkForUpdates).mockReset()
  })

  afterEach(async () => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('destroys floating UI before quitAndInstall during update restart', async () => {
    const configPresenter = {
      getUpdateChannel: vi.fn(() => 'stable')
    } as any

    const presenter = new UpgradePresenter(configPresenter)
    ;(presenter as any)._status = 'downloaded'

    expect(presenter.restartToUpdate()).toBe(true)
    expect(setApplicationQuittingMock).toHaveBeenCalledWith(true)
    expect(destroyFloatingChatWindowMock).toHaveBeenCalledTimes(1)
    expect(floatingButtonDestroyMock).toHaveBeenCalledTimes(1)
    expect(sendToMainMock).toHaveBeenCalledWith(WINDOW_EVENTS.SET_APPLICATION_QUITTING, {
      isQuitting: true
    })
    expect(sendToRendererMock).toHaveBeenCalledWith(UPDATE_EVENTS.WILL_RESTART, 'all_windows')

    await vi.advanceTimersByTimeAsync(500)

    expect(electronUpdater.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(appQuitMock).not.toHaveBeenCalled()
  })

  it('relaunches the app for mock downloaded updates without calling quitAndInstall', async () => {
    const configPresenter = {
      getUpdateChannel: vi.fn(() => 'stable')
    } as any

    const presenter = new UpgradePresenter(configPresenter)

    expect(presenter.mockDownloadedUpdate()).toBe(true)
    expect(presenter.restartToUpdate()).toBe(true)

    expect(setApplicationQuittingMock).toHaveBeenCalledWith(true)
    expect(destroyFloatingChatWindowMock).toHaveBeenCalledTimes(1)
    expect(floatingButtonDestroyMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(500)

    expect(appRelaunchMock).toHaveBeenCalledTimes(1)
    expect(appExitMock).toHaveBeenCalledTimes(1)
    expect(electronUpdater.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('skips app-focus auto check when privacy mode is enabled', () => {
    const configPresenter = {
      getUpdateChannel: vi.fn(() => 'stable'),
      getPrivacyModeEnabled: vi.fn(() => true)
    } as any

    const presenter = new UpgradePresenter(configPresenter)
    const checkSpy = vi.spyOn(presenter, 'checkUpdate').mockResolvedValue(undefined)

    ;(presenter as any).handleAppFocus()

    expect(checkSpy).not.toHaveBeenCalled()
    expect(electronUpdater.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('keeps manual update checks available while privacy mode is enabled', async () => {
    const configPresenter = {
      getUpdateChannel: vi.fn(() => 'stable'),
      getPrivacyModeEnabled: vi.fn(() => true)
    } as any

    vi.mocked(electronUpdater.autoUpdater.checkForUpdates).mockResolvedValue(undefined as never)

    const presenter = new UpgradePresenter(configPresenter)

    await presenter.checkUpdate()

    expect(electronUpdater.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})
