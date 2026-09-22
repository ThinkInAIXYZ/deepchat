import { describe, expect, it } from 'vitest'
import { isProviderDbBackedProvider } from '../../../src/main/provider/providerRegistry'

describe('provider DB catalog', () => {
  it.each(['xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams'])(
    'includes the %s catalog profile',
    (id) => {
      expect(isProviderDbBackedProvider(id)).toBe(true)
    }
  )

  it.each(['anthropic', 'gemini', 'new-api', 'custom-mistral', '', undefined, null])(
    'does not infer catalog ownership from metadata or transport: %s',
    (id) => {
      expect(isProviderDbBackedProvider(id)).toBe(false)
    }
  )

  it('treats Mistral as provider DB-backed', () => {
    expect(isProviderDbBackedProvider('mistral')).toBe(true)
    expect(isProviderDbBackedProvider(' MISTRAL ')).toBe(true)
  })

  it('treats OpenAI Codex as provider DB-backed', () => {
    expect(isProviderDbBackedProvider('openai-codex')).toBe(true)
  })

  it('treats Kimi For Coding as provider DB-backed', () => {
    expect(isProviderDbBackedProvider('kimi-for-coding')).toBe(true)
    expect(isProviderDbBackedProvider(' KIMI-FOR-CODING ')).toBe(true)
  })

  it('treats the basic API-key provider batch as provider DB-backed', () => {
    for (const providerId of [
      'alibaba-token-plan',
      'alibaba-token-plan-cn',
      'huggingface',
      'minimax-global',
      'moonshot-ai',
      'nvidia',
      'stepfun',
      'stepfun-step-plan',
      'upstage'
    ]) {
      expect(isProviderDbBackedProvider(providerId)).toBe(true)
    }

    expect(isProviderDbBackedProvider(' STEPFUN-STEP-PLAN ')).toBe(true)
  })
})
