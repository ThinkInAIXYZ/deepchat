import { describe, expect, it } from 'vitest'

import { AsyncSemaphore } from '@/lib/asyncSemaphore'
import {
  MaintenanceBudget,
  selectMaintenanceRowsWithinTokenBudget
} from '@/presenter/memoryPresenter/core/maintenanceBudget'

describe('MaintenanceBudget', () => {
  it('selects priority-ordered rows without letting an oversized row block later rows', () => {
    expect(
      selectMaintenanceRowsWithinTokenBudget(
        [
          { id: 'high', tokens: 4 },
          { id: 'oversized', tokens: 10 },
          { id: 'lower', tokens: 2 }
        ],
        6,
        (row) => row.tokens
      ).map((row) => row.id)
    ).toEqual(['high', 'lower'])
  })

  it('enforces non-borrowable step quotas and the global token ceiling', () => {
    const budget = new MaintenanceBudget()
    expect(Array.from({ length: 4 }, () => budget.reserve('challenge', 1_000))).toEqual([
      true,
      true,
      true,
      true
    ])
    expect(budget.reserve('challenge', 1)).toBe(false)
    expect(budget.reserve('merge', 9_000)).toBe(true)
    expect(budget.reserve('merge', 9_000)).toBe(true)
    expect(budget.reserve('reflection', 5_001)).toBe(false)
    expect(budget.snapshot()).toMatchObject({ calls: 6, inputTokens: 22_000 })
  })

  it('does not let unused quota move between steps', () => {
    const budget = new MaintenanceBudget()
    expect(budget.reserve('persona', 1)).toBe(true)
    expect(budget.reserve('persona', 1)).toBe(false)
    expect(budget.reserve('reflection', 1)).toBe(true)
    expect(budget.reserve('reflection', 1)).toBe(false)
  })
})

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
