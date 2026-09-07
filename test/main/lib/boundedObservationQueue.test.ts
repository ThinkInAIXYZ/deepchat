import { describe, expect, it, vi } from 'vitest'
import { BoundedObservationQueue } from '@/lib/boundedObservationQueue'

type Observation = { type: 'event'; id: number } | { type: 'dropped'; droppedCount: number }

function createManualScheduler() {
  const pending: Array<() => void> = []
  const schedule = vi.fn((drain: () => void) => pending.push(drain))
  const drainAll = () => {
    while (pending.length > 0) pending.shift()?.()
  }
  return { drainAll, pending, schedule }
}

describe('BoundedObservationQueue', () => {
  it('does not enqueue or schedule disabled observations and resumes with future events only', async () => {
    let enabled = false
    const observations: Observation[] = []
    const scheduler = createManualScheduler()
    const queue = new BoundedObservationQueue<Observation>({
      enabled: () => enabled,
      observe: (observation) => observations.push(observation),
      schedule: scheduler.schedule
    })

    expect(queue.enqueue({ type: 'event', id: 1 })).toBe(false)
    expect(scheduler.schedule).not.toHaveBeenCalled()
    await queue.flush()

    enabled = true
    expect(queue.enqueue({ type: 'event', id: 2 })).toBe(true)
    const flushed = queue.flush()
    expect(scheduler.schedule).toHaveBeenCalledOnce()
    expect(observations).toEqual([])
    scheduler.drainAll()
    await flushed

    expect(observations).toEqual([{ type: 'event', id: 2 }])
    expect(queue.droppedCount).toBe(0)
  })

  it('preserves retained order and flushes drop reporting plus reentrant observations', async () => {
    const observations: Observation[] = []
    const scheduler = createManualScheduler()
    let queue!: BoundedObservationQueue<Observation>
    queue = new BoundedObservationQueue<Observation>({
      capacity: 3,
      drainBatchSize: 2,
      createDroppedObservation: (droppedCount) => ({ type: 'dropped', droppedCount }),
      observe: (observation) => {
        observations.push(observation)
        if (observation.type === 'dropped') queue.enqueue({ type: 'event', id: 5 })
      },
      schedule: scheduler.schedule
    })
    for (let id = 0; id < 5; id += 1) queue.enqueue({ type: 'event', id })

    const flushed = queue.flush()
    scheduler.drainAll()
    await flushed

    expect(observations).toEqual([
      { type: 'event', id: 2 },
      { type: 'event', id: 3 },
      { type: 'event', id: 4 },
      { type: 'dropped', droppedCount: 2 },
      { type: 'event', id: 5 }
    ])
    expect(queue.droppedCount).toBe(2)
    expect(scheduler.schedule).toHaveBeenCalledTimes(3)
  })

  it('constructs an observation with the drop caused by its own enqueue', async () => {
    const observations: Array<Readonly<{ droppedCount: number }>> = []
    const scheduler = createManualScheduler()
    const queue = new BoundedObservationQueue<Readonly<{ droppedCount: number }>>({
      capacity: 1,
      observe: (observation) => observations.push(observation),
      schedule: scheduler.schedule
    })
    queue.enqueue({ droppedCount: 0 })
    queue.enqueueWithDroppedCount((droppedCount) => Object.freeze({ droppedCount }))

    const flushed = queue.flush()
    scheduler.drainAll()
    await flushed

    expect(queue.droppedCount).toBe(1)
    expect(observations).toEqual([{ droppedCount: 1 }])
  })

  it('flushes without awaiting asynchronous observers', async () => {
    const scheduler = createManualScheduler()
    const observe = vi.fn(() => new Promise<void>(() => undefined))
    const queue = new BoundedObservationQueue<number>({
      observe,
      schedule: scheduler.schedule
    })
    queue.enqueue(1)
    let flushed = false
    void queue.flush().then(() => {
      flushed = true
    })

    scheduler.drainAll()
    await Promise.resolve()

    expect(observe).toHaveBeenCalledWith(1)
    expect(flushed).toBe(true)
  })

  it('consumes asynchronous observer rejections', async () => {
    const scheduler = createManualScheduler()
    const observerError = new Error('observer failed')
    const observe = vi.fn(() => Promise.reject(observerError))
    const unhandledRejection = vi.fn()
    const queue = new BoundedObservationQueue<number>({
      observe,
      schedule: scheduler.schedule
    })
    process.on('unhandledRejection', unhandledRejection)
    try {
      queue.enqueue(1)
      const flushed = queue.flush()
      scheduler.drainAll()
      await flushed
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(observe).toHaveBeenCalledWith(1)
      expect(unhandledRejection.mock.calls.some(([reason]) => reason === observerError)).toBe(false)
    } finally {
      process.off('unhandledRejection', unhandledRejection)
    }
  })

  it('contains enablement and scheduler failures', async () => {
    const rejectedObserver = vi.fn(() => Promise.reject(new Error('observer failed')))
    const disabled = new BoundedObservationQueue<number>({
      enabled: () => {
        throw new Error('enablement failed')
      },
      observe: rejectedObserver
    })
    expect(disabled.enqueue(1)).toBe(false)
    await disabled.flush()
    expect(rejectedObserver).not.toHaveBeenCalled()

    const unscheduled = new BoundedObservationQueue<number>({
      capacity: 2,
      observe: rejectedObserver,
      schedule: () => {
        throw new Error('scheduler failed')
      }
    })
    expect(() => unscheduled.enqueue(1)).not.toThrow()
    await unscheduled.flush()
    expect(unscheduled.droppedCount).toBe(1)
    expect(rejectedObserver).not.toHaveBeenCalled()
  })
})
