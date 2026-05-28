import { describe, expect, it } from 'vitest'
import { normalizeLifecycleHookDelayMs } from '@/presenter/lifecyclePresenter/lifecycleDelay'

describe('normalizeLifecycleHookDelayMs', () => {
  it('defaults missing and empty values to zero', () => {
    expect(normalizeLifecycleHookDelayMs(undefined)).toBe(0)
    expect(normalizeLifecycleHookDelayMs(null)).toBe(0)
    expect(normalizeLifecycleHookDelayMs('')).toBe(0)
  })

  it('defaults invalid, non-finite, and negative values to zero', () => {
    expect(normalizeLifecycleHookDelayMs('invalid')).toBe(0)
    expect(normalizeLifecycleHookDelayMs(Number.NaN)).toBe(0)
    expect(normalizeLifecycleHookDelayMs(Number.POSITIVE_INFINITY)).toBe(0)
    expect(normalizeLifecycleHookDelayMs('-1')).toBe(0)
  })

  it('preserves fractional and valid delay values', () => {
    expect(normalizeLifecycleHookDelayMs('1.5')).toBe(1.5)
    expect(normalizeLifecycleHookDelayMs(25)).toBe(25)
  })
})
