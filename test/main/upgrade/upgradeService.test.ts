import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  autoUpdaterState,
  publishEventMock,
  requestUpdateInstallMock,
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
    publishEventMock: vi.fn(),
    requestUpdateInstallMock: vi.fn(async (installAction: () => void) => installAction()),
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

import electronUpdater from 'electron-updater'
import { UpgradeService } from '../../../src/main/upgrade'

describe('UpgradeService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    autoUpdaterState.reset()
    publishEventMock.mockReset()
    requestUpdateInstallMock.mockReset()
    requestUpdateInstallMock.mockImplementation(async (installAction: () => void) =>
      installAction()
    )
    appQuitMock.mockReset()
    appRelaunchMock.mockReset()
    appExitMock.mockReset()
    appGetVersionMock.mockReset()
    appGetVersionMock.mockReturnValue('1.0.0')
    vi.mocked(electronUpdater.autoUpdater.checkForUpdates).mockReset()
  })

  afterEach(async () => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('asks App to stop before quitAndInstall during update restart', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any

    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock
    )
    ;(service as any)._status = 'downloaded'

    expect(service.restartToUpdate()).toBe(true)
    expect(requestUpdateInstallMock).toHaveBeenCalledTimes(1)
    expect(publishEventMock).toHaveBeenCalledWith(
      'upgrade.willRestart',
      expect.objectContaining({ version: expect.any(Number) })
    )

    await Promise.resolve()

    expect(electronUpdater.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(appQuitMock).not.toHaveBeenCalled()
  })

  it('relaunches the app for mock downloaded updates without calling quitAndInstall', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any

    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock
    )

    expect(service.mockDownloadedUpdate()).toBe(true)
    expect(service.restartToUpdate()).toBe(true)

    expect(requestUpdateInstallMock).toHaveBeenCalledTimes(1)
    await Promise.resolve()

    expect(appRelaunchMock).toHaveBeenCalledTimes(1)
    expect(appExitMock).toHaveBeenCalledTimes(1)
    expect(electronUpdater.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('skips app-focus auto check when privacy mode is enabled', () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any

    const service = new UpgradeService(
      settings,
      () => true,
      requestUpdateInstallMock,
      publishEventMock
    )
    const checkSpy = vi.spyOn(service, 'checkUpdate').mockResolvedValue(undefined)

    service.handleAppFocus()

    expect(checkSpy).not.toHaveBeenCalled()
    expect(electronUpdater.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('keeps manual update checks available while privacy mode is enabled', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any

    vi.mocked(electronUpdater.autoUpdater.checkForUpdates).mockResolvedValue(undefined as never)

    const service = new UpgradeService(
      settings,
      () => true,
      requestUpdateInstallMock,
      publishEventMock
    )

    await service.checkUpdate()

    expect(electronUpdater.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('ignores cross-channel downgrades when current install is a prerelease', () => {
    appGetVersionMock.mockReturnValue('1.0.5-beta.5')
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any

    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock
    )
    const handler = autoUpdaterState.listeners.get('update-available')
    expect(handler).toBeDefined()

    // 模拟 electron-updater 在 channel 错配下推送的旧正式版
    handler!({ version: '1.0.4', releaseDate: '2026-05-01', releaseNotes: '' })

    expect((service as any)._status).toBe('not-available')
    expect((service as any)._versionInfo).toBeNull()
    // 不应触发自动下载
    expect(electronUpdater.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('accepts in-channel upgrades from one beta to a newer beta', () => {
    appGetVersionMock.mockReturnValue('1.0.5-beta.2')
    const settings = {
      getChannel: vi.fn(() => 'beta')
    } as any

    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock
    )
    const handler = autoUpdaterState.listeners.get('update-available')
    expect(handler).toBeDefined()

    handler!({ version: '1.0.5-beta.5', releaseDate: '2026-05-15', releaseNotes: '' })

    expect((service as any)._status).toBe('available')
    expect((service as any)._versionInfo?.version).toBe('1.0.5-beta.5')
  })

  it('accepts beta to same-version stable release as a legitimate channel convergence', () => {
    // beta 测试完成，1.0.5 正式版发布；用户从 1.0.5-beta.5 升级到 1.0.5 应被允许
    appGetVersionMock.mockReturnValue('1.0.5-beta.5')
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any

    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock
    )
    const handler = autoUpdaterState.listeners.get('update-available')
    expect(handler).toBeDefined()

    handler!({ version: '1.0.5', releaseDate: '2026-06-01', releaseNotes: '' })

    expect((service as any)._status).toBe('available')
    expect((service as any)._versionInfo?.version).toBe('1.0.5')
  })
})
