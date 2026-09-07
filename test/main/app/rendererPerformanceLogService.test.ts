import { describe, expect, it, vi } from 'vitest'
import { RendererPerformanceLogService } from '@/app/rendererPerformanceLogService'

const createFs = (overrides: Record<string, unknown> = {}) => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
  unlink: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
  ...overrides
})

const validRecord = {
  schemaVersion: 1 as const,
  source: 'chat-main' as const,
  scope: 'startup' as const,
  phase: 'interactive' as const,
  outcome: 'completed' as const,
  elapsedMs: 42,
  startupRunId: 'main:run-1'
}

describe('RendererPerformanceLogService', () => {
  it('does not create a diagnostics file when local logging is disabled', async () => {
    const fs = createFs()
    const service = new RendererPerformanceLogService(
      { get: vi.fn(() => false) } as never,
      () => '/user-data',
      fs
    )

    await expect(service.record(validRecord)).resolves.toBe(false)
    expect(fs.appendFile).not.toHaveBeenCalled()
  })

  it('persists a sanitized, timestamped NDJSON record', async () => {
    const fs = createFs()
    const service = new RendererPerformanceLogService(
      { get: vi.fn(() => true) } as never,
      () => '/user-data',
      fs,
      () => 1234
    )

    await expect(service.record(validRecord)).resolves.toBe(true)

    expect(fs.mkdir).toHaveBeenCalledWith('/user-data/logs', { recursive: true })
    expect(fs.appendFile).toHaveBeenCalledWith(
      '/user-data/logs/renderer-performance.ndjson',
      `${JSON.stringify({ ...validRecord, recordedAt: 1234 })}\n`,
      'utf-8'
    )
  })

  it('rejects unknown fields before they reach the local log', async () => {
    const fs = createFs()
    const service = new RendererPerformanceLogService(
      { get: vi.fn(() => true) } as never,
      () => '/user-data',
      fs
    )

    await expect(
      service.record({ ...validRecord, sessionId: 'sensitive-session-id' })
    ).resolves.toBe(false)
    expect(fs.appendFile).not.toHaveBeenCalled()
  })

  it('serializes concurrent writes to preserve NDJSON line ordering', async () => {
    const writeOrder: string[] = []
    let releaseFirstWrite!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    const appendFile = vi
      .fn()
      .mockImplementationOnce(async () => {
        writeOrder.push('first-start')
        await firstWrite
        writeOrder.push('first-end')
      })
      .mockImplementationOnce(async () => {
        writeOrder.push('second')
      })
    const service = new RendererPerformanceLogService(
      { get: vi.fn(() => true) } as never,
      () => '/user-data',
      createFs({ appendFile })
    )

    const first = service.record(validRecord)
    const second = service.record({ ...validRecord, phase: 'route-ready' as const })
    await vi.waitFor(() => expect(writeOrder).toEqual(['first-start']))
    releaseFirstWrite()

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(writeOrder).toEqual(['first-start', 'first-end', 'second'])
  })

  it('rotates the bounded record file and retains only one previous generation', async () => {
    const fs = createFs({ stat: vi.fn().mockResolvedValue({ size: 10 * 1024 * 1024 }) })
    const service = new RendererPerformanceLogService(
      { get: vi.fn(() => true) } as never,
      () => '/user-data',
      fs
    )

    await expect(service.record(validRecord)).resolves.toBe(true)

    expect(fs.unlink).toHaveBeenCalledWith('/user-data/logs/renderer-performance.ndjson.old')
    expect(fs.rename).toHaveBeenCalledWith(
      '/user-data/logs/renderer-performance.ndjson',
      '/user-data/logs/renderer-performance.ndjson.old'
    )
  })

  it('contains write failures without rejecting the renderer route', async () => {
    const onWriteError = vi.fn()
    const service = new RendererPerformanceLogService(
      { get: vi.fn(() => true) } as never,
      () => '/user-data',
      createFs({ appendFile: vi.fn().mockRejectedValue(new Error('disk unavailable')) }),
      Date.now,
      onWriteError
    )

    await expect(service.record(validRecord)).resolves.toBe(false)
    expect(onWriteError).toHaveBeenCalledTimes(1)
  })
})
