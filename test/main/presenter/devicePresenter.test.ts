import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import { DevicePresenter } from '../../../src/main/presenter/devicePresenter/index'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

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
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    publishDeepchatEventMock.mockClear()
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
