import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { originalConsole } from '@shared/logger'
import { LoggingService } from '@/app/logging'
import {
  mainLogger,
  reportMainProcessFatal,
  reportMainStartupComponentFailure,
  reportNativeMainError
} from '@/logging'
import {
  scheduleObservedStartupTask,
  StartupWorkloadCoordinator
} from '@/app/startupWorkloadCoordinator'

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

describe('Main startup diagnostics', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports a rescheduled background failure against the active maintenance run', async () => {
    const coordinator = new StartupWorkloadCoordinator()
    const originalRunId = coordinator.createRun('main')
    const maintenanceRunId = coordinator.createRun('main')
    const failure = new Error('background failed')
    const emitted = new Promise<void>((resolve) => {
      vi.spyOn(mainLogger, 'emit').mockImplementation((event) => {
        if (event === 'app.startup.component.failed') resolve()
      })
    })

    scheduleObservedStartupTask({
      coordinator,
      startupRunId: maintenanceRunId,
      task: {
        id: 'main:maintenance-background',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.maintenanceBackground',
        run: async () => {
          throw failure
        }
      },
      onFailure: (startupRunId) =>
        reportMainStartupComponentFailure(startupRunId, 'legacy_import', 'persistence')
    })

    await emitted

    expect(maintenanceRunId).not.toBe(originalRunId)
    expect(mainLogger.emit).toHaveBeenCalledWith('app.startup.component.failed', {
      startupRunId: maintenanceRunId,
      component: 'legacy_import',
      error: { category: 'persistence' }
    })
  })
})

describe('Main process fatal diagnostics', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['process.uncaught_exception', 'process.unhandled_rejection'] as const)(
    'keeps a native console fallback for %s',
    (event) => {
      const error = new Error('fatal detail')
      const emit = vi.spyOn(mainLogger, 'emit').mockImplementation(() => undefined)

      reportMainProcessFatal(event, error)

      expect(originalConsole.error).toHaveBeenCalledWith(`[main] ${event}`, error)
      expect(emit).toHaveBeenCalledWith(event, { error })
    }
  )

  it('still emits the structured diagnostic when the native console throws', () => {
    const error = new Error('fatal detail')
    vi.mocked(originalConsole.error).mockImplementationOnce(() => {
      throw new Error('console unavailable')
    })
    const emit = vi.spyOn(mainLogger, 'emit').mockImplementation(() => undefined)

    expect(() => reportMainProcessFatal('process.uncaught_exception', error)).not.toThrow()
    expect(emit).toHaveBeenCalledWith('process.uncaught_exception', { error })
  })

  it('contains native lifecycle console failures', () => {
    const error = {
      [Symbol.for('nodejs.util.inspect.custom')]() {
        throw new Error('formatting failed')
      }
    }
    vi.mocked(originalConsole.error).mockImplementationOnce((_message, value) => {
      inspect(value)
    })

    expect(() => reportNativeMainError('main: lifecycle failed:', error)).not.toThrow()
  })
})
