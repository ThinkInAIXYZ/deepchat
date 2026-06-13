import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WINDOW_EVENTS } from '../../../src/main/events'
import { DEEPCHAT_EVENT_CHANNEL } from '../../../src/shared/contracts/channels'

const {
  autoUpdaterState,
  sendToMainMock,
  sendToAllWindowsMock,
  sendToWebContentsMock,
  floatingButtonDestroyMock,
  destroyFloatingChatWindowMock,
  setApplicationQuittingMock,
  appQuitMock,
  appRelaunchMock,
  appExitMock,
  appGetVersionMock
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
    sendToAllWindowsMock: vi.fn(),
    sendToWebContentsMock: vi.fn(),
    floatingButtonDestroyMock: vi.fn(),
    destroyFloatingChatWindowMock: vi.fn(),
    setApplicationQuittingMock: vi.fn(),
    appQuitMock: vi.fn(),
    appRelaunchMock: vi.fn(),
    appExitMock: vi.fn(),
    appGetVersionMock: vi.fn(() => '1.0.0')
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/deepchat-test'),
    getVersion: appGetVersionMock,
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
    sendToMain: sendToMainMock
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
import { setDeepchatEventWindowPresenter } from '../../../src/main/routes/publishDeepchatEvent'

describe('UpgradePresenter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    autoUpdaterState.reset()
    sendToMainMock.mockReset()
    sendToAllWindowsMock.mockReset()
    sendToWebContentsMock.mockReset()
    setDeepchatEventWindowPresenter({
      sendToAllWindows: sendToAllWindowsMock,
      sendToWebContents: sendToWebContentsMock
    })
    floatingButtonDestroyMock.mockReset()
    destroyFloatingChatWindowMock.mockReset()
    setApplicationQuittingMock.mockReset()
    appQuitMock.mockReset()
    appRelaunchMock.mockReset()
    appExitMock.mockReset()
    appGetVersionMock.mockReset()
    appGetVersionMock.mockReturnValue('1.0.0')
    vi.mocked(electronUpdater.autoUpdater.checkForUpdates).mockReset()
  })

  afterEach(async () => {
    setDeepchatEventWindowPresenter(null)
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
    expect(sendToAllWindowsMock).toHaveBeenCalledWith(
      DEEPCHAT_EVENT_CHANNEL,
      expect.objectContaining({
        name: 'upgrade.willRestart',
        payload: expect.objectContaining({
          version: expect.any(Number)
        })
      })
    )

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

  it('ignores cross-channel downgrades when current install is a prerelease', () => {
    appGetVersionMock.mockReturnValue('1.0.5-beta.5')
    const configPresenter = {
      getUpdateChannel: vi.fn(() => 'stable'),
      getPrivacyModeEnabled: vi.fn(() => false)
    } as any

    const presenter = new UpgradePresenter(configPresenter)
    const handler = autoUpdaterState.listeners.get('update-available')
    expect(handler).toBeDefined()

    // 模拟 electron-updater 在 channel 错配下推送的旧正式版
    handler!({ version: '1.0.4', releaseDate: '2026-05-01', releaseNotes: '' })

    expect((presenter as any)._status).toBe('not-available')
    expect((presenter as any)._versionInfo).toBeNull()
    // 不应触发自动下载
    expect(electronUpdater.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('accepts in-channel upgrades from one beta to a newer beta', () => {
    appGetVersionMock.mockReturnValue('1.0.5-beta.2')
    const configPresenter = {
      getUpdateChannel: vi.fn(() => 'beta'),
      getPrivacyModeEnabled: vi.fn(() => false)
    } as any

    const presenter = new UpgradePresenter(configPresenter)
    const handler = autoUpdaterState.listeners.get('update-available')
    expect(handler).toBeDefined()

    handler!({ version: '1.0.5-beta.5', releaseDate: '2026-05-15', releaseNotes: '' })

    expect((presenter as any)._status).toBe('available')
    expect((presenter as any)._versionInfo?.version).toBe('1.0.5-beta.5')
  })

  it('accepts beta to same-version stable release as a legitimate channel convergence', () => {
    // beta 测试完成，1.0.5 正式版发布；用户从 1.0.5-beta.5 升级到 1.0.5 应被允许
    appGetVersionMock.mockReturnValue('1.0.5-beta.5')
    const configPresenter = {
      getUpdateChannel: vi.fn(() => 'stable'),
      getPrivacyModeEnabled: vi.fn(() => false)
    } as any

    const presenter = new UpgradePresenter(configPresenter)
    const handler = autoUpdaterState.listeners.get('update-available')
    expect(handler).toBeDefined()

    handler!({ version: '1.0.5', releaseDate: '2026-06-01', releaseNotes: '' })

    expect((presenter as any)._status).toBe('available')
    expect((presenter as any)._versionInfo?.version).toBe('1.0.5')
  })
})
