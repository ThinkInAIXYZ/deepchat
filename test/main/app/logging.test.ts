import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoggingService } from '@/app/logging'

describe('LoggingService', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each([false, true])(
    'applies the %s persistence gate before publishing and scheduling restart',
    (enabled) => {
      const operations: string[] = []
      const settings = {
        get: vi.fn(() => false),
        set: vi.fn(() => operations.push('settings'))
      }
      const restart = vi.fn(() => operations.push('restart'))
      const publish = vi.fn(() => operations.push('publish'))
      const setPersistence = vi.fn(() => operations.push('persistence'))
      const service = new LoggingService(settings as never, restart, publish, setPersistence)

      service.setEnabled(enabled)

      expect(setPersistence).toHaveBeenCalledWith(enabled)
      expect(operations).toEqual(['settings', 'persistence', 'publish'])
      vi.advanceTimersByTime(999)
      expect(restart).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(restart).toHaveBeenCalledOnce()
    }
  )
})
