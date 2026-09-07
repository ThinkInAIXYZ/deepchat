import { describe, expect, it } from 'vitest'

import {
  allocateMemoryContributionBudget,
  DIRECTIVE_TOKEN_CEILING,
  PERSONA_TOKEN_CEILING,
  PERSONA_TOKEN_FLOOR,
  QUERY_RECALL_TOKEN_RESERVATION,
  WORKING_TOKEN_CEILING,
  WORKING_TOKEN_FLOOR
} from '@/memory/core/contributionBudget'

const FULL_DEMAND = {
  directive: 1_000,
  persona: 1_000,
  working: 1_000,
  queryRecall: 1_000
}

describe('memory contribution budget allocator', () => {
  it('applies the directive ceiling, memory guarantees, and lane ceilings', () => {
    const decision = allocateMemoryContributionBudget({
      totalTokenBudget: 2_000,
      overheadTokens: 50,
      demand: FULL_DEMAND
    })

    expect(decision.allocated).toEqual({
      directive: DIRECTIVE_TOKEN_CEILING,
      persona: PERSONA_TOKEN_CEILING,
      working: WORKING_TOKEN_CEILING,
      queryRecall: 638
    })
    expect(decision.allocated.persona).toBeGreaterThanOrEqual(PERSONA_TOKEN_FLOOR)
    expect(decision.allocated.working).toBeGreaterThanOrEqual(WORKING_TOKEN_FLOOR)
    expect(decision.allocated.queryRecall).toBeGreaterThanOrEqual(QUERY_RECALL_TOKEN_RESERVATION)
    expect(decision.unallocatedTokens).toBe(0)
  })

  it('borrows unused lane capacity without exceeding bounded ceilings', () => {
    const decision = allocateMemoryContributionBudget({
      totalTokenBudget: 1_200,
      overheadTokens: 50,
      demand: {
        directive: 50,
        persona: 20,
        working: 40,
        queryRecall: 2_000
      }
    })

    expect(decision.allocated).toEqual({
      directive: 50,
      persona: 20,
      working: 40,
      queryRecall: 1_040
    })
    expect(decision.borrowed.queryRecall).toBe(784)
    expect(decision.unallocatedTokens).toBe(0)
  })

  it('shrinks memory guarantees fairly when the total cannot satisfy them', () => {
    const decision = allocateMemoryContributionBudget({
      totalTokenBudget: 200,
      overheadTokens: 50,
      demand: {
        directive: 20,
        persona: 1_000,
        working: 1_000,
        queryRecall: 1_000
      }
    })

    expect(decision.allocated).toEqual({
      directive: 20,
      persona: 44,
      working: 43,
      queryRecall: 43
    })
    expect(Math.max(...Object.values(decision.allocated).slice(1))).toBeLessThanOrEqual(44)
    expect(decision.constrained).toBe(true)
  })

  it('does not reserve memory overhead when no memory lane is requested', () => {
    const decision = allocateMemoryContributionBudget({
      totalTokenBudget: 100,
      overheadTokens: 80,
      demand: {
        directive: 40,
        persona: 0,
        working: 0,
        queryRecall: 0
      }
    })

    expect(decision.overheadTokens).toBe(0)
    expect(decision.allocated.directive).toBe(40)
    expect(decision.unallocatedTokens).toBe(60)
  })

  it('does not strand constrained budgets in fragments too small to render', () => {
    const decision = allocateMemoryContributionBudget({
      totalTokenBudget: 100,
      overheadTokens: 50,
      demand: {
        directive: 0,
        persona: 1_000,
        working: 1_000,
        queryRecall: 1_000
      },
      minimumViable: {
        persona: 30,
        working: 30,
        queryRecall: 40
      }
    })

    expect(decision.allocated).toEqual({
      directive: 0,
      persona: 0,
      working: 0,
      queryRecall: 50
    })
    expect(decision.overheadTokens).toBe(50)
  })

  it('does not allocate memory lanes when their container overhead cannot fit', () => {
    const decision = allocateMemoryContributionBudget({
      totalTokenBudget: 64,
      overheadTokens: 50,
      demand: {
        directive: 32,
        persona: 1_000,
        working: 1_000,
        queryRecall: 1_000
      },
      minimumViable: {
        persona: 20,
        working: 20,
        queryRecall: 20
      }
    })

    expect(decision.overheadTokens).toBe(0)
    expect(decision.allocated).toEqual({
      directive: 32,
      persona: 0,
      working: 0,
      queryRecall: 0
    })
    expect(decision.unallocatedTokens).toBe(32)
  })

  it('normalizes malformed values and is deterministic', () => {
    const input = {
      totalTokenBudget: 100.9,
      overheadTokens: Number.NaN,
      demand: {
        directive: -1,
        persona: 20.8,
        working: Number.POSITIVE_INFINITY,
        queryRecall: 20.8
      }
    }

    const first = allocateMemoryContributionBudget(input)
    const second = allocateMemoryContributionBudget(input)

    expect(first).toEqual(second)
    expect(first.totalTokenBudget).toBe(100)
    expect(first.demand).toEqual({
      directive: 0,
      persona: 20,
      working: 0,
      queryRecall: 20
    })
  })
})
