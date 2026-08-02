import { describe, expect, it } from 'vitest'
import {
  normalizeOrchestrationPolicy,
  normalizePersistedOrchestrationPolicy
} from '@shared/workflow/orchestrationPolicy'

describe('orchestration policy normalization', () => {
  it('accepts only canonical policy values in current contracts', () => {
    expect(normalizeOrchestrationPolicy('explicit')).toBe('explicit')
    expect(normalizeOrchestrationPolicy('proactive')).toBe('proactive')
    expect(normalizeOrchestrationPolicy('workflow')).toBe('explicit')
    expect(normalizeOrchestrationPolicy(undefined)).toBe('explicit')
  })

  it('maps unreleased legacy values only at persistence boundaries', () => {
    expect(normalizePersistedOrchestrationPolicy('adaptive')).toBe('explicit')
    expect(normalizePersistedOrchestrationPolicy('workflow')).toBe('proactive')
    expect(normalizePersistedOrchestrationPolicy('proactive')).toBe('proactive')
  })
})
