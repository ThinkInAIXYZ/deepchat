import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_OUTPUT_LIMITS,
  resolveAgentOutputLimits
} from '@shared/lib/agentOutputLimits'
import { DeepChatAgentConfigSchema } from '@shared/contracts/domainSchemas'

describe('agent output limits', () => {
  it('uses compatibility defaults when Agent fields are absent', () => {
    expect(resolveAgentOutputLimits({})).toEqual(DEFAULT_AGENT_OUTPUT_LIMITS)
  })

  it('normalizes persisted values defensively', () => {
    expect(
      resolveAgentOutputLimits({
        readFileAutoTruncateChars: 400.2,
        toolOutputInlineChars: 8_500.6,
        commandOutputInlineChars: 500_000
      })
    ).toEqual({
      readFileAutoTruncateChars: 1_000,
      toolOutputInlineChars: 8_501,
      commandOutputInlineChars: 200_000
    })
  })

  it('rejects invalid values at the route contract boundary', () => {
    expect(DeepChatAgentConfigSchema.safeParse({ toolOutputInlineChars: 8_000 }).success).toBe(true)
    expect(DeepChatAgentConfigSchema.safeParse({ toolOutputInlineChars: 999 }).success).toBe(false)
    expect(DeepChatAgentConfigSchema.safeParse({ commandOutputInlineChars: 8_000.5 }).success).toBe(
      false
    )
  })
})
