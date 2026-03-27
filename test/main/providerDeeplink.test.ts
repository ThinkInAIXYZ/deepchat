import { describe, expect, it } from 'vitest'
import { maskApiKey } from '@shared/providerDeeplink'

describe('maskApiKey', () => {
  it('fully masks keys with length up to 4', () => {
    expect(maskApiKey('a')).toBe('****')
    expect(maskApiKey('abcd')).toBe('****')
  })

  it('partially masks keys with length from 5 to 8', () => {
    expect(maskApiKey('abcde')).toBe('ab***de')
    expect(maskApiKey('abcdefgh')).toBe('ab***gh')
  })

  it('keeps the existing mask format for keys longer than 8', () => {
    expect(maskApiKey('abcdefghij')).toBe('abcd...ghij')
  })
})
