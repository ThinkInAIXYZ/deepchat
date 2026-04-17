import { describe, expect, it } from 'vitest'
import {
  DERIVED_MODEL_MAX_TOKENS_CAP,
  DEFAULT_MODEL_MAX_TOKENS,
  resolveDerivedModelMaxTokens,
  resolveModelMaxTokens
} from '../../../src/shared/modelConfigDefaults'

describe('resolveDerivedModelMaxTokens', () => {
  it('caps large derived values at 32000', () => {
    expect(resolveDerivedModelMaxTokens(64000)).toBe(32000)
  })

  it('keeps exact cap values', () => {
    expect(resolveDerivedModelMaxTokens(32000)).toBe(32000)
  })

  it('keeps values below the cap', () => {
    expect(resolveDerivedModelMaxTokens(8192)).toBe(8192)
  })

  it('falls back to the default when metadata is missing', () => {
    expect(resolveDerivedModelMaxTokens(undefined)).toBe(DEFAULT_MODEL_MAX_TOKENS)
  })
})

describe('resolveModelMaxTokens', () => {
  it('preserves user-sized values above the derived cap', () => {
    expect(resolveModelMaxTokens(64000)).toBe(64000)
  })

  it('exports the shared derived cap constant', () => {
    expect(DERIVED_MODEL_MAX_TOKENS_CAP).toBe(32000)
  })
})
