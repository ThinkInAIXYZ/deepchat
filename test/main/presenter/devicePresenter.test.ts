import { describe, it, expect, vi } from 'vitest'
import { DevicePresenter } from '../../../src/main/presenter/devicePresenter/index'

// Mock eventBus (imported by DevicePresenter via @/eventbus)
vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    sendToRenderer: vi.fn(),
    emit: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

// Mock svgSanitizer (imported by DevicePresenter via @/lib/svgSanitizer)
vi.mock('@/lib/svgSanitizer', () => ({
  svgSanitizer: {
    sanitize: vi.fn()
  }
}))

describe('DevicePresenter', () => {
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
})
