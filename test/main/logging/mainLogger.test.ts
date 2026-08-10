import { describe, expect, it, vi } from 'vitest'
import {
  MainLogger,
  type MainLogInternalWarning,
  type MainLogPersistence
} from '@/logging/mainLogger'

function createPersistence(overrides: Partial<MainLogPersistence> = {}) {
  return {
    enable: vi.fn(() => true),
    disable: vi.fn(),
    write: vi.fn(() => true),
    ...overrides
  }
}

function createLogger(
  overrides: {
    persistence?: ReturnType<typeof createPersistence>
    appVersion?: string
    writeConsole?: ReturnType<typeof vi.fn>
    warn?: ReturnType<typeof vi.fn>
  } = {}
) {
  const persistence = overrides.persistence ?? createPersistence()
  const writeConsole = overrides.writeConsole ?? vi.fn()
  const warn = overrides.warn ?? vi.fn()
  const logger = new MainLogger({
    persistence,
    appVersion: overrides.appVersion ?? '1.2.3',
    processInstanceId: '3f70b2a5-b28b-4786-8e45-e50ec018a02f',
    now: () => new Date('2026-08-10T12:34:56.789Z'),
    writeConsole,
    warn
  })
  return { logger, persistence, writeConsole, warn }
}

function emitShutdown(logger: MainLogger, durationMs: number): void {
  logger.emit('app.shutdown.terminal', { outcome: 'completed', durationMs })
}

function parseWrittenLines(persistence: ReturnType<typeof createPersistence>) {
  return persistence.write.mock.calls.map(([, line]) => JSON.parse(line))
}

describe('MainLogger', () => {
  it('writes one versioned JSON record with stable envelope fields', () => {
    const { logger, persistence, writeConsole } = createLogger()
    logger.setPersistenceEnabled(true)

    logger.emit('app.startup.started', {
      startupRunId: 'startup_1',
      argumentCount: 2,
      deepLinkPresent: false
    })

    expect(parseWrittenLines(persistence)).toEqual([
      {
        v: 1,
        ts: '2026-08-10T12:34:56.789Z',
        seq: 1,
        level: 'info',
        event: 'app.startup.started',
        process: 'main',
        processInstanceId: '3f70b2a5-b28b-4786-8e45-e50ec018a02f',
        appVersion: '1.2.3',
        context: {
          startupRunId: 'startup_1',
          argumentCount: 2,
          deepLinkPresent: false
        }
      }
    ])
    expect(writeConsole).toHaveBeenCalledWith(
      'info',
      '[main] app.startup.started {"startupRunId":"startup_1","argumentCount":2,"deepLinkPresent":false}'
    )
  })

  it('buffers startup records and flushes them in sequence order after enablement', () => {
    const { logger, persistence } = createLogger()
    emitShutdown(logger, 1)
    emitShutdown(logger, 2)
    expect(persistence.write).not.toHaveBeenCalled()

    logger.setPersistenceEnabled(true)

    expect(
      parseWrittenLines(persistence).map(({ seq, context }) => [seq, context.durationMs])
    ).toEqual([
      [1, 1],
      [2, 2]
    ])
  })

  it('bounds the startup buffer and reports dropped records after the surviving flush', () => {
    const { logger, persistence } = createLogger()
    for (let durationMs = 1; durationMs <= 65; durationMs += 1) {
      emitShutdown(logger, durationMs)
    }

    logger.setPersistenceEnabled(true)

    const records = parseWrittenLines(persistence)
    expect(records).toHaveLength(65)
    expect(records[0]).toMatchObject({ seq: 2, context: { durationMs: 2 } })
    expect(records.at(-1)).toMatchObject({
      seq: 66,
      event: 'logging.startup_buffer.dropped',
      context: { droppedCount: 1 }
    })
  })

  it('discards unknown-state records when persistence is disabled', () => {
    const { logger, persistence } = createLogger()
    emitShutdown(logger, 1)
    logger.setPersistenceEnabled(false)
    emitShutdown(logger, 2)
    logger.setPersistenceEnabled(true)
    emitShutdown(logger, 3)

    expect(parseWrittenLines(persistence).map(({ seq }) => seq)).toEqual([3])
    expect(persistence.disable).toHaveBeenCalledTimes(1)
  })

  it('enforces the startup buffer byte limit independently of its record limit', () => {
    const { logger, persistence } = createLogger({ appVersion: `1.${'v'.repeat(3000)}` })
    for (let durationMs = 1; durationMs <= 30; durationMs += 1) {
      emitShutdown(logger, durationMs)
    }

    logger.setPersistenceEnabled(true)

    const records = parseWrittenLines(persistence)
    const lifecycleRecords = records.filter(({ event }) => event === 'app.shutdown.terminal')
    const lifecycleBytes = persistence.write.mock.calls
      .filter(([, line]) => JSON.parse(line).event === 'app.shutdown.terminal')
      .reduce((total, [, line]) => total + Buffer.byteLength(line, 'utf8') + 1, 0)
    expect(lifecycleRecords.length).toBeLessThan(30)
    expect(lifecycleBytes).toBeLessThanOrEqual(64 * 1024)
    expect(records.at(-1)).toMatchObject({
      event: 'logging.startup_buffer.dropped',
      context: { droppedCount: 30 - lifecycleRecords.length }
    })
  })

  it('drops oversized records without writing partial JSON', () => {
    const warn = vi.fn<(warning: MainLogInternalWarning) => void>()
    const { logger, persistence } = createLogger({ appVersion: 'v'.repeat(20 * 1024), warn })
    logger.setPersistenceEnabled(true)

    emitShutdown(logger, 1)
    emitShutdown(logger, 2)

    expect(persistence.write).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('record_oversized')
  })

  it('contains projection and persistence failures', () => {
    const persistence = createPersistence({ write: vi.fn(() => false) })
    const { logger, warn } = createLogger({ persistence })
    logger.setPersistenceEnabled(true)

    expect(() =>
      logger.emit('app.shutdown.terminal', {
        outcome: 'completed',
        durationMs: Number.NaN
      })
    ).not.toThrow()
    emitShutdown(logger, 1)
    emitShutdown(logger, 2)

    expect(persistence.write).toHaveBeenCalledTimes(1)
    expect(persistence.disable).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls.map(([warning]) => warning)).toEqual([
      'event_rejected',
      'persistence_failed'
    ])
  })

  it('fails closed when persistence cannot be enabled', () => {
    const persistence = createPersistence({ enable: vi.fn(() => false) })
    const { logger, warn } = createLogger({ persistence })
    emitShutdown(logger, 1)

    expect(() => logger.setPersistenceEnabled(true)).not.toThrow()
    emitShutdown(logger, 2)

    expect(persistence.write).not.toHaveBeenCalled()
    expect(persistence.disable).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('persistence_failed')
  })
})
