import { describe, expect, it } from 'vitest'
import { shouldConsumeClaimedInput } from '@/agent/deepchat/runtime/claimedInputSettlement'

describe('shouldConsumeClaimedInput', () => {
  it('consumes a claimed queue input when the run hits the tool-call limit', () => {
    expect(shouldConsumeClaimedInput('completed', false)).toBe(true)
  })

  it('rolls back a claimed queue input on error stops', () => {
    expect(shouldConsumeClaimedInput('error', false)).toBe(false)
  })

  it('consumes paused, aborted, and steer claims', () => {
    expect(shouldConsumeClaimedInput('paused', false)).toBe(true)
    expect(shouldConsumeClaimedInput('aborted', false)).toBe(true)
    expect(shouldConsumeClaimedInput('error', true)).toBe(true)
  })
})
