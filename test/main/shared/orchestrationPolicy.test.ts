import { describe, expect, it } from 'vitest'
import { normalizeOrchestrationPolicy } from '@shared/orchestration/policy'

describe('orchestration policy normalization', () => {
  it('accepts only canonical policy values in current contracts', () => {
    expect(normalizeOrchestrationPolicy('explicit')).toBe('explicit')
    expect(normalizeOrchestrationPolicy('proactive')).toBe('proactive')
    expect(normalizeOrchestrationPolicy('workflow')).toBe('explicit')
    expect(normalizeOrchestrationPolicy(undefined)).toBe('explicit')
  })
})
