import { describe, expect, it } from 'vitest'
import { normalizeOrchestrationPolicy } from '@shared/orchestration/policy'
import { DeepChatAgentConfigSchema } from '@shared/contracts/domainSchemas'

describe('orchestration policy normalization', () => {
  it('accepts only canonical policy values in current contracts', () => {
    expect(normalizeOrchestrationPolicy('explicit')).toBe('explicit')
    expect(normalizeOrchestrationPolicy('proactive')).toBe('proactive')
    expect(normalizeOrchestrationPolicy('workflow')).toBe('explicit')
    expect(normalizeOrchestrationPolicy(undefined)).toBe('explicit')
  })

  it('validates the optional Agent default at the config boundary', () => {
    expect(DeepChatAgentConfigSchema.parse({}).defaultOrchestrationPolicy).toBeUndefined()
    for (const defaultOrchestrationPolicy of ['explicit', 'proactive']) {
      expect(
        DeepChatAgentConfigSchema.parse({ defaultOrchestrationPolicy }).defaultOrchestrationPolicy
      ).toBe(defaultOrchestrationPolicy)
    }
    expect(
      DeepChatAgentConfigSchema.safeParse({ defaultOrchestrationPolicy: 'workflow' }).success
    ).toBe(false)
  })
})
