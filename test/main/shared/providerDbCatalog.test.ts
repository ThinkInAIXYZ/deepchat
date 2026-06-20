import { describe, expect, it } from 'vitest'
import { isProviderDbBackedProvider } from '../../../src/shared/providerDbCatalog'

describe('provider DB catalog', () => {
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
      'upstage'
    ]) {
      expect(isProviderDbBackedProvider(providerId)).toBe(true)
    }
  })
})
