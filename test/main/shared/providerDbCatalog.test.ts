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
})
