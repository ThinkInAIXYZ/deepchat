import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  autoUpdaterState,
  publishEventMock,
  requestUpdateInstallMock,
  appQuitMock,
  appRelaunchMock,
  appExitMock,
  appGetPathMock,
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
    appGetPathMock: vi.fn(() => ''),
    appGetVersionMock: vi.fn(() => '1.0.0')
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: appGetPathMock,
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

vi.unmock('fs')

import electronUpdater from 'electron-updater'
import { UpgradeService } from '../../../src/main/upgrade'

describe('UpgradeService', () => {
  let userDataDirectory: string

  beforeEach(async () => {
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
    appGetPathMock.mockReset()
    userDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-upgrade-service-'))
    appGetPathMock.mockReturnValue(userDataDirectory)
    appGetVersionMock.mockReset()
    appGetVersionMock.mockReturnValue('1.0.0')
    vi.mocked(electronUpdater.autoUpdater.checkForUpdates).mockReset()
    vi.mocked(electronUpdater.autoUpdater.downloadUpdate).mockReset()
  })

  afterEach(async () => {
    vi.clearAllTimers()
    vi.useRealTimers()
    await rm(userDataDirectory, { recursive: true, force: true })
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

  it('reports update-check failures without exposing the source error', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn(() => {
      throw new Error('diagnostic sink failed')
    })
    vi.mocked(electronUpdater.autoUpdater.checkForUpdates).mockRejectedValue(
      new Error('SECRET_UPDATE_RESPONSE')
    )
    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )

    await expect(service.checkUpdate()).resolves.toBeUndefined()

    expect(service.getUpdateStatus()).toMatchObject({
      status: 'error',
      error: 'SECRET_UPDATE_RESPONSE'
    })
    expect(publishEventMock).toHaveBeenCalledWith(
      'upgrade.status.changed',
      expect.objectContaining({ status: 'error', error: 'SECRET_UPDATE_RESPONSE' })
    )
    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'check',
      errorCategory: 'unknown'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('SECRET_UPDATE_RESPONSE')
  })

  it('reports one diagnostic episode for concurrent and repeated automatic check failures', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn()
    vi.mocked(electronUpdater.autoUpdater.checkForUpdates).mockRejectedValue(
      new Error('automatic check failed')
    )
    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )

    await Promise.all([service.checkUpdate('autoCheck'), service.checkUpdate('autoCheck')])
    await service.checkUpdate('autoCheck')

    expect(electronUpdater.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(3)
    expect(observeFailure).toHaveBeenCalledOnce()
    expect(service.getUpdateStatus().status).toBe('error')
  })

  it('deduplicates one check failure reported by updater event and promise rejection', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn()
    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )
    const errorHandler = autoUpdaterState.listeners.get('error')
    vi.mocked(electronUpdater.autoUpdater.checkForUpdates).mockImplementation(async () => {
      errorHandler!(new Error('SECRET_EVENT_UPDATE_ERROR'))
      throw new Error('SECRET_REJECTED_UPDATE_ERROR')
    })

    await service.checkUpdate('autoCheck')

    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'check',
      errorCategory: 'provider'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('SECRET_')
  })

  it('reports a native updater error outside an active operation as a runtime failure', () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn()
    new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )

    autoUpdaterState.listeners.get('error')!(new Error('SECRET_NATIVE_RUNTIME_ERROR'))

    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'runtime',
      errorCategory: 'unknown'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('SECRET_NATIVE_RUNTIME_ERROR')
  })

  it('does not guess one operation for a native error during overlapping phases', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn()
    let resolveCheck!: () => void
    let resolveDownload!: () => void
    vi.mocked(electronUpdater.autoUpdater.checkForUpdates).mockImplementation(
      () => new Promise((resolve) => (resolveCheck = () => resolve(undefined as never)))
    )
    vi.mocked(electronUpdater.autoUpdater.downloadUpdate).mockImplementation(
      () => new Promise((resolve) => (resolveDownload = () => resolve([])))
    )
    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )

    const checking = service.checkUpdate()
    autoUpdaterState.listeners.get('update-available')!({
      version: '1.1.0',
      releaseDate: '2026-08-01',
      releaseNotes: ''
    })
    expect(service.startDownloadUpdate()).toBe(true)
    autoUpdaterState.listeners.get('error')!(new Error('SECRET_AMBIGUOUS_UPDATE_ERROR'))

    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'runtime',
      errorCategory: 'unknown'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('SECRET_AMBIGUOUS_UPDATE_ERROR')

    resolveCheck()
    resolveDownload()
    await checking
    await Promise.resolve()
  })

  it('starts a new automatic check failure episode after a successful check', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn()
    vi.mocked(electronUpdater.autoUpdater.checkForUpdates)
      .mockRejectedValueOnce(new Error('first outage'))
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('second outage'))
    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )

    await service.checkUpdate('autoCheck')
    await service.checkUpdate('autoCheck')
    await service.checkUpdate('autoCheck')

    expect(observeFailure).toHaveBeenCalledTimes(2)
  })

  it('reports asynchronous update-download failures without exposing the source error', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn()
    vi.mocked(electronUpdater.autoUpdater.downloadUpdate).mockRejectedValue(
      new Error('SECRET_DOWNLOAD_RESPONSE')
    )
    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )
    const available = autoUpdaterState.listeners.get('update-available')
    available!({ version: '1.1.0', releaseDate: '2026-08-01', releaseNotes: '' })

    expect(service.startDownloadUpdate()).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'download',
      errorCategory: 'provider'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('SECRET_DOWNLOAD_RESPONSE')
  })

  it('deduplicates one download failure reported by updater event and promise rejection', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn()
    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )
    const errorHandler = autoUpdaterState.listeners.get('error')
    vi.mocked(electronUpdater.autoUpdater.downloadUpdate).mockImplementation(async () => {
      autoUpdaterState.listeners.get('update-downloaded')!({
        version: '1.1.0',
        releaseDate: '2026-08-01',
        releaseNotes: ''
      })
      errorHandler!(new Error('SECRET_EVENT_DOWNLOAD_ERROR'))
      throw new Error('SECRET_REJECTED_DOWNLOAD_ERROR')
    })
    autoUpdaterState.listeners.get('update-available')!({
      version: '1.1.0',
      releaseDate: '2026-08-01',
      releaseNotes: ''
    })

    expect(service.startDownloadUpdate()).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'download',
      errorCategory: 'provider'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('SECRET_')
  })

  it('reports install handoff failures and restores the updating flag', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn()
    requestUpdateInstallMock.mockRejectedValue(new Error('SECRET_INSTALL_ERROR'))
    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )
    ;(service as any)._status = 'downloaded'

    expect(service.restartToUpdate()).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(service.isUpdatingInProgress()).toBe(false)
    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'install',
      errorCategory: 'unknown'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('SECRET_INSTALL_ERROR')
  })

  it('reports an event-only native updater failure during install', async () => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn()
    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )
    ;(service as any)._status = 'downloaded'

    expect(service.restartToUpdate()).toBe(true)
    await Promise.resolve()
    autoUpdaterState.listeners.get('error')!(new Error('SECRET_NATIVE_INSTALL_ERROR'))

    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'install',
      errorCategory: 'unknown'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('SECRET_NATIVE_INSTALL_ERROR')
  })

  it.each([
    ['relaunch', appRelaunchMock],
    ['exit', appExitMock]
  ])('contains delayed app %s failures during a normal restart', async (_phase, fail) => {
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn()
    fail.mockImplementationOnce(() => {
      throw new Error('SECRET_DELAYED_RESTART_ERROR')
    })
    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )

    service.restartApp()
    await vi.advanceTimersByTimeAsync(1000)

    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'runtime',
      errorCategory: 'unknown'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('SECRET_DELAYED_RESTART_ERROR')
    expect(publishEventMock).toHaveBeenCalledWith(
      'upgrade.error',
      expect.objectContaining({ error: 'SECRET_DELAYED_RESTART_ERROR' })
    )
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

  it('reports malformed update-marker reconciliation and still removes the marker', async () => {
    const markerPath = path.join(userDataDirectory, 'auto_update_marker.json')
    await writeFile(markerPath, '{SECRET_MALFORMED_MARKER')
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn(() => {
      throw new Error('diagnostic sink failed')
    })

    new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )

    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'marker_reconcile',
      errorCategory: 'unknown'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('SECRET_MALFORMED_MARKER')
    expect(existsSync(markerPath)).toBe(false)
  })

  it('reports marker-write failure but still publishes downloaded status', async () => {
    const markerPath = path.join(userDataDirectory, 'auto_update_marker.json')
    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn()
    new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )
    await mkdir(markerPath)
    const downloaded = autoUpdaterState.listeners.get('update-downloaded')

    downloaded!({ version: '1.1.0', releaseDate: '2026-08-01', releaseNotes: 'SECRET_NOTES' })

    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'marker_write',
      errorCategory: 'persistence'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('SECRET_NOTES')
    expect(publishEventMock).toHaveBeenCalledWith(
      'upgrade.status.changed',
      expect.objectContaining({ status: 'downloaded' })
    )
  })

  it('coerces a Date releaseDate from electron-updater into an ISO string for the IPC contract', () => {
    // electron-updater parses latest*.yml via js-yaml, which turns an unquoted
    // ISO releaseDate into a Date object. The service must normalize it before
    // emitting so the typed-IPC zod contract never receives a Date.
    appGetVersionMock.mockReturnValue('1.0.0')
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

    const date = new Date('2026-07-25T11:28:19.451Z')
    handler!({ version: '1.1.0-beta.6', releaseDate: date, releaseNotes: '' })

    expect((service as any)._status).toBe('available')
    const availableCall = publishEventMock.mock.calls.find(
      (call) => call[0] === 'upgrade.status.changed' && call[1]?.status === 'available'
    )
    expect(availableCall).toBeDefined()
    const info = availableCall![1].info
    expect(typeof info.releaseDate).toBe('string')
    expect(info.releaseDate).toBe('2026-07-25T11:28:19.451Z')
  })

  it('restores a valid persisted update marker with a string releaseDate', async () => {
    const markerPath = path.join(userDataDirectory, 'auto_update_marker.json')
    await writeFile(
      markerPath,
      JSON.stringify({
        version: '1.1.0',
        releaseDate: '2026-07-25T11:28:19.451Z',
        releaseNotes: 'Release notes',
        githubUrl: 'https://github.com/ThinkInAIXYZ/deepchat/releases/tag/v1.1.0',
        downloadUrl: 'https://deepchatai.cn/#/download',
        timestamp: Date.now()
      })
    )

    const settings = {
      getChannel: vi.fn(() => 'stable')
    } as any
    const observeFailure = vi.fn(() => {
      throw new Error('diagnostic sink failed')
    })

    const service = new UpgradeService(
      settings,
      () => false,
      requestUpdateInstallMock,
      publishEventMock,
      observeFailure
    )

    expect((service as any)._status).toBe('error')
    expect((service as any)._previousUpdateFailed).toBe(true)
    expect(observeFailure).toHaveBeenCalledOnce()
    expect(observeFailure).toHaveBeenCalledWith({
      operation: 'install_verification',
      errorCategory: 'unknown'
    })
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('Release notes')
    expect(JSON.stringify(observeFailure.mock.calls)).not.toContain('deepchatai.cn')
    expect(publishEventMock).toHaveBeenCalledWith(
      'upgrade.status.changed',
      expect.objectContaining({
        status: 'error',
        info: expect.objectContaining({
          version: '1.1.0',
          releaseDate: '2026-07-25T11:28:19.451Z'
        })
      })
    )
    expect(existsSync(markerPath)).toBe(false)
  })
})
