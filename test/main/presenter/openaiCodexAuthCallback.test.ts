import { describe, expect, it, vi } from 'vitest'
import { resolveOpenAICodexCallbackUrl } from '../../../src/main/presenter/openaiCodexAuth'

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

describe('OpenAI Codex auth browser callback', () => {
  it('accepts browser login codes from the local OAuth callback', () => {
    const result = resolveOpenAICodexCallbackUrl(
      '/auth/callback?code=browser-code&state=browser-state',
      'browser-state'
    )

    expect(result).toMatchObject({
      kind: 'success',
      code: 'browser-code'
    })
  })

  it('rejects callbacks with invalid state', () => {
    const result = resolveOpenAICodexCallbackUrl(
      '/auth/callback?code=browser-code&state=wrong-state',
      'browser-state'
    )

    expect(result.kind).toBe('failure')
    expect(result.kind === 'failure' ? result.error.message : '').toBe(
      'Invalid OpenAI Codex OAuth callback'
    )
  })

  it('ignores non-callback paths', () => {
    expect(resolveOpenAICodexCallbackUrl('/favicon.ico', 'browser-state')).toEqual({
      kind: 'not-found'
    })
  })
})
