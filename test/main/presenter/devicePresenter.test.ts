import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import { DevicePresenter } from '../../../src/main/presenter/devicePresenter/index'

const { publishDeepchatEventMock, execFileMock } = vi.hoisted(() => ({
  publishDeepchatEventMock: vi.fn(),
  execFileMock: vi.fn()
}))

vi.mock('child_process', () => ({
  execFile: execFileMock
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true
  }
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

// Mock svgSanitizer (imported by DevicePresenter via @/lib/svgSanitizer)
vi.mock('@/lib/svgSanitizer', () => ({
  svgSanitizer: {
    sanitize: vi.fn()
  }
}))

describe('DevicePresenter', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    publishDeepchatEventMock.mockClear()
    execFileMock.mockReset()
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  })

  describe('getDefaultHeaders', () => {
    it('should include User-Agent header with DeepChat/ prefix', () => {
      const headers = DevicePresenter.getDefaultHeaders()

      expect(headers).toHaveProperty('User-Agent')
      expect(headers['User-Agent']).toMatch(/^DeepChat\//)
    })

    it('should include HTTP-Referer and X-Title headers', () => {
      const headers = DevicePresenter.getDefaultHeaders()

      expect(headers['HTTP-Referer']).toBe('https://deepchatai.cn')
      expect(headers['X-Title']).toBe('DeepChat')
    })
  })

  describe('restartAppWithDelay', () => {
    it('publishes a typed app runtime event in development', () => {
      const presenter = new DevicePresenter()

      ;(presenter as unknown as { restartAppWithDelay: () => void }).restartAppWithDelay()

      expect(publishDeepchatEventMock).toHaveBeenCalledTimes(1)
      expect(publishDeepchatEventMock).toHaveBeenCalledWith('appRuntime.dataResetCompleteDev', {})
    })
  })

  describe('getDiskSpace', () => {
    it('uses a bounded direct df child and preserves parsed output', async () => {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
      execFileMock.mockImplementation(
        (
          _command: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void
        ) =>
          callback(null, {
            stdout:
              'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk 100 25 75 25% /\n',
            stderr: ''
          })
      )

      await expect(new DevicePresenter().getDiskSpace()).resolves.toEqual({
        total: 100 * 1024,
        free: 25 * 1024,
        used: 75 * 1024
      })
      expect(execFileMock).toHaveBeenCalledWith(
        'df',
        ['-k', '/'],
        expect.objectContaining({ timeout: 10_000, killSignal: 'SIGKILL', windowsHide: true }),
        expect.any(Function)
      )
    })

    it('uses a bounded direct wmic child on Windows', async () => {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
      execFileMock.mockImplementation(
        (
          _command: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void
        ) =>
          callback(null, {
            stdout: 'FreeSpace  Size\n100  300\n200  500\n',
            stderr: ''
          })
      )

      await expect(new DevicePresenter().getDiskSpace()).resolves.toEqual({
        total: 800,
        free: 300,
        used: 500
      })
      expect(execFileMock).toHaveBeenCalledWith(
        'wmic',
        ['logicaldisk', 'get', 'size,freespace'],
        expect.objectContaining({ timeout: 10_000, killSignal: 'SIGKILL', windowsHide: true }),
        expect.any(Function)
      )
    })

    it('preserves rejection when the device query times out', async () => {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
      const timeoutError = Object.assign(new Error('Device query timed out'), {
        killed: true,
        signal: 'SIGKILL'
      })
      execFileMock.mockImplementation(
        (
          _command: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null) => void
        ) => callback(timeoutError)
      )

      await expect(new DevicePresenter().getDiskSpace()).rejects.toBe(timeoutError)
    })
  })

  describe('resetDataByType', () => {
    it('uses injected reset runtime before resetting all data', async () => {
      vi.useFakeTimers()
      vi.spyOn(fs, 'existsSync').mockReturnValue(false)
      const closeSqlite = vi.fn()
      const destroyKnowledge = vi.fn()
      const presenter = new DevicePresenter({
        closeSqlite,
        destroyKnowledge
      })

      const resetPromise = presenter.resetDataByType('all')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1000)
      await resetPromise

      expect(closeSqlite).toHaveBeenCalledTimes(1)
      expect(destroyKnowledge).toHaveBeenCalledTimes(1)
      expect(publishDeepchatEventMock).toHaveBeenCalledWith('appRuntime.dataResetCompleteDev', {})
    })
  })
})
