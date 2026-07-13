import { describe, expect, it } from 'vitest'

import { AsyncSemaphore } from '@/lib/asyncSemaphore'

describe('AsyncSemaphore', () => {
  it('runs at most two tasks and resumes waiters in FIFO order', async () => {
    const semaphore = new AsyncSemaphore(2)
    const starts: number[] = []
    const releases: Array<() => void> = []
    const tasks = Array.from({ length: 3 }, (_, index) =>
      semaphore.run(async () => {
        starts.push(index)
        await new Promise<void>((resolve) => releases.push(resolve))
      })
    )
    await Promise.resolve()
    expect(starts).toEqual([0, 1])
    releases.shift()?.()
    await tasks[0]
    await Promise.resolve()
    expect(starts).toEqual([0, 1, 2])
    releases.splice(0).forEach((release) => release())
    await Promise.all(tasks)
  })
})
