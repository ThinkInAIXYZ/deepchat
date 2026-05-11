import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_CONTEXT_PRESSURE_MIN_OUTPUT_TOKENS,
  buildRequestContextBudgetDiagnostics,
  buildRequestContextOverflowErrorMessage,
  getUsableContextLength,
  preflightRequestContext
} from '@/presenter/agentRuntimePresenter/contextBudget'

vi.mock('tokenx', () => ({
  approximateTokenSize: vi.fn((text: string) => text.length)
}))

describe('agent request context budget', () => {
  it('reserves a 256 token safety margin for normal model windows', () => {
    expect(getUsableContextLength(8192)).toBe(7936)
  })

  it('temporarily shrinks maxTokens to fit the safety-adjusted context window', () => {
    const result = preflightRequestContext({
      messages: [{ role: 'user', content: 'x'.repeat(3900) }],
      tools: [],
      contextLength: 8192,
      requestedMaxTokens: 4096
    })

    expect(result.usableContextLength).toBe(7936)
    expect(result.effectiveMaxTokens).toBe(4036)
    expect(result.totalRequestTokens).toBeLessThanOrEqual(7936)
    expect(result.shrunkByContextPressure).toBe(true)
    expect(result.requiresContextPressureRecovery).toBe(false)
  })

  it('requests recovery when pressure would shrink a normal request below 4000 output tokens', () => {
    const result = preflightRequestContext({
      messages: [{ role: 'user', content: 'x'.repeat(4100) }],
      tools: [],
      contextLength: 8192,
      requestedMaxTokens: 4096
    })

    expect(result.effectiveMaxTokens).toBeLessThan(AGENT_CONTEXT_PRESSURE_MIN_OUTPUT_TOKENS)
    expect(result.requiresContextPressureRecovery).toBe(true)
  })

  it('reports zero effective output tokens when the fitted request cannot fit', () => {
    const result = preflightRequestContext({
      messages: [{ role: 'user', content: 'x'.repeat(9000) }],
      tools: [],
      contextLength: 8192,
      requestedMaxTokens: 4096
    })

    expect(result.fitsWithinContext).toBe(false)
    expect(result.effectiveMaxTokens).toBe(0)
    expect(result.totalRequestTokens).toBe(result.inputTokens + result.toolReserveTokens)
  })

  it('respects user configured maxTokens below 4000 without forcing recovery', () => {
    const result = preflightRequestContext({
      messages: [{ role: 'user', content: 'x'.repeat(7200) }],
      tools: [],
      contextLength: 8192,
      requestedMaxTokens: 1024
    })

    expect(result.effectiveMaxTokens).toBe(736)
    expect(result.shrunkByContextPressure).toBe(true)
    expect(result.requiresContextPressureRecovery).toBe(false)
  })

  it('treats non-positive context windows as unknown during preflight', () => {
    const messages = [{ role: 'user' as const, content: 'x'.repeat(2000) }]
    const result = preflightRequestContext({
      messages,
      tools: [],
      contextLength: 0,
      requestedMaxTokens: 4096
    })

    expect(result.messages).toEqual(messages)
    expect(result.effectiveMaxTokens).toBe(4096)
    expect(result.fitsWithinContext).toBe(true)
  })

  it('drops orphaned tool result messages after request fitting', () => {
    const result = preflightRequestContext({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'tool', tool_call_id: 'missing-call', content: 'orphan result' },
        { role: 'user', content: 'continue' }
      ],
      tools: [],
      contextLength: 8192,
      requestedMaxTokens: 4096
    })

    expect(result.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'continue' }
    ])
  })

  it('formats diagnostics for unfittable preflight results', () => {
    const result = preflightRequestContext({
      messages: [{ role: 'user', content: 'x'.repeat(9000) }],
      tools: [],
      contextLength: 8192,
      requestedMaxTokens: 4096
    })

    expect(buildRequestContextBudgetDiagnostics(result)).toMatchObject({
      usableContextLength: 7936,
      inputTokens: result.inputTokens,
      toolReserveTokens: 0,
      requestedMaxTokens: 4096,
      effectiveMaxTokens: 0,
      remainingOutputTokens: expect.any(Number),
      totalRequestTokens: result.inputTokens
    })
    expect(buildRequestContextOverflowErrorMessage(result)).toContain('Request was not sent')
    expect(buildRequestContextOverflowErrorMessage(result)).toContain('remaining output room')
    expect(buildRequestContextOverflowErrorMessage(result)).toContain('lowering max output tokens')
  })
})
