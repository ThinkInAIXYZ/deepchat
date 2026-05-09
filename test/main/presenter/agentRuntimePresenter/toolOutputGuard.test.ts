import { describe, expect, it, vi } from 'vitest'
import { ToolOutputGuard } from '@/presenter/agentRuntimePresenter/toolOutputGuard'

vi.mock('tokenx', () => ({
  approximateTokenSize: vi.fn((text: string) => text.length)
}))

describe('ToolOutputGuard', () => {
  it('checks tool continuation budget against the safety-adjusted context window', () => {
    const guard = new ToolOutputGuard()

    expect(
      guard.hasContextBudget({
        conversationMessages: [{ role: 'user', content: 'x'.repeat(3744) }],
        toolDefinitions: [],
        contextLength: 5000,
        maxTokens: 1000
      })
    ).toBe(true)
    expect(
      guard.hasContextBudget({
        conversationMessages: [{ role: 'user', content: 'x'.repeat(3745) }],
        toolDefinitions: [],
        contextLength: 5000,
        maxTokens: 1000
      })
    ).toBe(false)
  })
})
