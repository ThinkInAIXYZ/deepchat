import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import { DeviceService } from '@/device'

const { appRelaunchMock, appExitMock } = vi.hoisted(() => ({
  appRelaunchMock: vi.fn(),
  appExitMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.2.3'),
    getPath: vi.fn(() => '/mock/path'),
    relaunch: appRelaunchMock,
    exit: appExitMock
  },
  dialog: {
    showMessageBoxSync: vi.fn(),
    showOpenDialog: vi.fn()
  }
}))

// Mock svgSanitizer (imported by DeviceService via @/lib/svgSanitizer)
vi.mock('@/lib/svgSanitizer', () => ({
  svgSanitizer: {
    sanitize: vi.fn()
  }
}))

describe('DeviceService', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    appRelaunchMock.mockClear()
    appExitMock.mockClear()
  })

  describe('getDefaultHeaders', () => {
    it('should include User-Agent header with DeepChat/ prefix', () => {
      const headers = DeviceService.getDefaultHeaders()

      expect(headers).toHaveProperty('User-Agent')
      expect(headers['User-Agent']).toMatch(/^DeepChat\//)
    })

    it('should include HTTP-Referer and X-Title headers', () => {
      const headers = DeviceService.getDefaultHeaders()

      expect(headers['HTTP-Referer']).toBe('https://deepchatai.cn')
      expect(headers['X-Title']).toBe('DeepChat')
    })
  })

  describe('restartAppWithDelay', () => {
    it('relaunches the process after data reset', async () => {
      vi.useFakeTimers()
      const presenter = new DeviceService()

      ;(presenter as unknown as { restartAppWithDelay: () => void }).restartAppWithDelay()
      await vi.advanceTimersByTimeAsync(1000)

      expect(appRelaunchMock).toHaveBeenCalledTimes(1)
      expect(appExitMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('resetDataByType', () => {
    it('only removes data after the App owner has stopped runtime resources', async () => {
      vi.useFakeTimers()
      vi.spyOn(fs, 'existsSync').mockReturnValue(false)
      const presenter = new DeviceService()

      const resetPromise = presenter.resetDataByType('all')
      await vi.advanceTimersByTimeAsync(1000)
      await resetPromise

      expect(appRelaunchMock).toHaveBeenCalledTimes(1)
      expect(appExitMock).toHaveBeenCalledTimes(1)
    })
  })
})
