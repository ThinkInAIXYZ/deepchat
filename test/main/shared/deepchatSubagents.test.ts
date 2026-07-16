import { describe, expect, it } from 'vitest'
import {
  resolveDeepChatSubagentCapability,
  type ResolveDeepChatSubagentCapabilityInput
} from '@shared/lib/deepchatSubagents'
import type { DeepChatSubagentSlot } from '@shared/types/agent-interface'

const reviewerSlot: DeepChatSubagentSlot = {
  id: 'reviewer',
  targetType: 'agent',
  targetAgentId: 'review-agent',
  displayName: 'Reviewer',
  description: 'Review the result.'
}

const explorerSlot: DeepChatSubagentSlot = {
  id: 'explorer',
  targetType: 'self',
  displayName: 'Explorer',
  description: 'Collect evidence.'
}

const availableInput = (
  overrides: Partial<ResolveDeepChatSubagentCapabilityInput> = {}
): ResolveDeepChatSubagentCapabilityInput => ({
  agentType: 'deepchat',
  sessionKind: 'regular',
  agentPolicyEnabled: true,
  slots: [reviewerSlot, explorerSlot],
  ...overrides
})

describe('DeepChat Subagent capability', () => {
  it('normalizes and canonicalizes every model-visible slot field in the cache key', () => {
    const first = resolveDeepChatSubagentCapability(availableInput())
    const reordered = resolveDeepChatSubagentCapability(
      availableInput({ slots: [explorerSlot, reviewerSlot] })
    )

    expect(first).toMatchObject({
      available: true,
      slots: [{ id: 'explorer' }, { id: 'reviewer' }]
    })
    expect(reordered.cacheKey).toBe(first.cacheKey)

    const variants: DeepChatSubagentSlot[] = [
      { ...reviewerSlot, id: 'reviewer-2' },
      { ...reviewerSlot, targetAgentId: 'other-agent' },
      { ...reviewerSlot, displayName: 'Security Reviewer' },
      { ...reviewerSlot, description: 'Review security boundaries.' },
      { ...reviewerSlot, targetType: 'self', targetAgentId: undefined }
    ]
    for (const variant of variants) {
      const changed = resolveDeepChatSubagentCapability(
        availableInput({ slots: [variant, explorerSlot] })
      )
      expect(changed.cacheKey).not.toBe(first.cacheKey)
    }
  })

  it.each([
    ['policy_disabled', { agentPolicyEnabled: false }, 'policy_disabled'],
    ['child session', { sessionKind: 'subagent' as const }, 'unsupported_session'],
    ['ACP session', { agentType: 'acp' as const }, 'unsupported_session'],
    ['invalid slots', { slots: [] }, 'no_valid_slots']
  ])('fails closed for %s', (_case, overrides, expectedReason) => {
    const capability = resolveDeepChatSubagentCapability(availableInput(overrides))

    expect(capability).toMatchObject({ available: false, reason: expectedReason })
  })
})
