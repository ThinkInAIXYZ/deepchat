import { describe, expect, it } from 'vitest'

import { truncateUnicodeCodePoints, unicodeCodePointLength } from '@shared/lib/unicodeText'

describe('Unicode text limits', () => {
  it('counts Unicode scalar values instead of UTF-16 code units', () => {
    expect(unicodeCodePointLength('a😀记')).toBe(3)
  })

  it('truncates without leaving an isolated surrogate', () => {
    const truncated = truncateUnicodeCodePoints(`${'😀'.repeat(400)}tail`, 400)
    expect(truncated).toBe('😀'.repeat(400))
    expect(unicodeCodePointLength(truncated)).toBe(400)
    expect(truncated.at(-1)?.charCodeAt(0)).toBeGreaterThanOrEqual(0xdc00)
  })
})
