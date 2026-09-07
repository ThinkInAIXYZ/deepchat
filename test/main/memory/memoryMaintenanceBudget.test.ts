import { describe, expect, it } from 'vitest'

import {
  MaintenanceBudget,
  selectMaintenanceRowsWithinTokenBudget
} from '@/memory/core/maintenanceBudget'

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
    expect(budget.snapshot()).toMatchObject({
      calls: 6,
      inputTokens: 22_000,
      deniedByStep: { challenge: 1, merge: 0, reflection: 1, persona: 0 }
    })
  })

  it('does not let unused quota move between steps', () => {
    const budget = new MaintenanceBudget()
    expect(budget.reserve('persona', 1)).toBe(true)
    expect(budget.reserve('persona', 1)).toBe(false)
    expect(budget.reserve('reflection', 1)).toBe(true)
    expect(budget.reserve('reflection', 1)).toBe(false)
  })
})
