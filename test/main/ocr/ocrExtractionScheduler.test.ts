import { describe, expect, it, vi } from 'vitest'

import { OcrExtractionScheduler } from '../../../src/main/ocr/ocrExtractionScheduler'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('OcrExtractionScheduler', () => {
  it('runs one task at a time and prioritizes interactive work', async () => {
    const scheduler = new OcrExtractionScheduler()
    const gate = deferred()
    const order: string[] = []
    const active = scheduler.schedule(async () => {
      order.push('active-background')
      await gate.promise
    }, 'background')
    const queuedBackground = scheduler.schedule(async () => {
      order.push('queued-background')
    }, 'background')
    const interactive = scheduler.schedule(async () => {
      order.push('interactive')
    }, 'interactive')

    await vi.waitFor(() => expect(order).toEqual(['active-background']))
    gate.resolve()
    await Promise.all([active, queuedBackground, interactive])

    expect(order).toEqual(['active-background', 'interactive', 'queued-background'])
  })

  it('does not starve queued background work', async () => {
    const scheduler = new OcrExtractionScheduler()
    const gate = deferred()
    const order: string[] = []
    const active = scheduler.schedule(() => gate.promise, 'interactive')
    const background = scheduler.schedule(async () => {
      order.push('background')
    }, 'background')
    const interactive = Array.from({ length: 5 }, (_, index) =>
      scheduler.schedule(async () => {
        order.push(`interactive-${index}`)
      }, 'interactive')
    )

    gate.resolve()
    await Promise.all([active, background, ...interactive])

    expect(order.indexOf('background')).toBeLessThan(order.indexOf('interactive-4'))
  })

  it('removes cancelled work before it starts', async () => {
    const scheduler = new OcrExtractionScheduler()
    const gate = deferred()
    const active = scheduler.schedule(() => gate.promise, 'interactive')
    const controller = new AbortController()
    const task = vi.fn(async () => undefined)
    const cancelled = scheduler.schedule(task, 'interactive', controller.signal)

    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })
    gate.resolve()
    await active
    expect(task).not.toHaveBeenCalled()
  })

  it('continues after a task throws synchronously', async () => {
    const scheduler = new OcrExtractionScheduler()
    const failure = scheduler.schedule(() => {
      throw new Error('synchronous failure')
    }, 'interactive')
    const next = scheduler.schedule(async () => 'recovered', 'interactive')

    await expect(failure).rejects.toThrow('synchronous failure')
    await expect(next).resolves.toBe('recovered')
  })

  it('rejects work beyond its bounded pending capacity', async () => {
    const scheduler = new OcrExtractionScheduler(2)
    const gate = deferred()
    const active = scheduler.schedule(() => gate.promise, 'interactive')
    const queued = scheduler.schedule(async () => undefined, 'interactive')

    await expect(scheduler.schedule(async () => undefined, 'interactive')).rejects.toMatchObject({
      code: 'queue_full'
    })
    gate.resolve()
    await Promise.all([active, queued])
  })
})
