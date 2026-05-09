import { describe, expect, it } from 'vitest'
import { isProviderDbBackedProvider } from '../../../src/shared/providerDbCatalog'

describe('provider DB catalog', () => {
  it('treats Mistral as provider DB-backed', () => {
    expect(isProviderDbBackedProvider('mistral')).toBe(true)
    expect(isProviderDbBackedProvider(' MISTRAL ')).toBe(true)
  })
})
