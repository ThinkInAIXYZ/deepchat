import { inspect } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  it.each([false, true])(
    'awaits the native persistence gate before publishing %s',
    async (enabled) => {
      const operations: string[] = []
      const settings = {
        get: vi.fn(() => false),
        set: vi.fn(() => operations.push('settings'))
      }
      const publish = vi.fn(() => operations.push('publish'))
      let finish!: () => void
      const pending = new Promise<void>((resolve) => {
        finish = resolve
      })
      const host = { applyLogging: vi.fn(() => pending), openLoggingFolder: vi.fn(async () => {}) }
      const service = new LoggingService(settings as never, host, publish, vi.fn())
      const changed = service.setEnabled(enabled)
      expect(host.applyLogging).toHaveBeenCalledWith(enabled)
      expect(operations).toEqual(['settings'])
      finish()
      await changed
      expect(operations).toEqual(['settings', 'publish'])
    }
  )

  it('does not acknowledge a failed native logging change or hide a folder error', async () => {
    const publish = vi.fn()
    const host = {
      applyLogging: vi.fn(async () => {
        throw new Error('native gate unavailable')
      }),
      openLoggingFolder: vi.fn(async () => {
        throw new Error('folder unavailable')
      })
    }
    const service = new LoggingService({ set: vi.fn() } as never, host, publish, vi.fn())
    await expect(service.setEnabled(true)).rejects.toThrow('native gate unavailable')
    expect(publish).not.toHaveBeenCalled()
    await expect(service.openFolder()).rejects.toThrow('folder unavailable')
  })
})

it('controls legacy console debug output through an explicit host flag', async () => {
  const legacy = await vi.importActual<typeof import('@shared/logger')>('@shared/logger')
  const debug = vi.spyOn(legacy.originalConsole, 'debug').mockImplementation(() => undefined)
  try {
    legacy.setLegacyConsoleDebugEnabled(false)
    legacy.default.debug('quiet')
    expect(debug).not.toHaveBeenCalled()
    legacy.setLegacyConsoleDebugEnabled(true)
    legacy.default.debug('debug')
    legacy.default.verbose('verbose')
    legacy.default.silly('silly')
    expect(debug.mock.calls).toEqual([['debug'], ['verbose'], ['silly']])
    expect(legacy.default.info).toBe(legacy.originalConsole.info)
    expect(legacy.default.warn).toBe(legacy.originalConsole.warn)
    expect(legacy.default.error).toBe(legacy.originalConsole.error)
  } finally {
    legacy.setLegacyConsoleDebugEnabled(false)
    debug.mockRestore()
  }
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
