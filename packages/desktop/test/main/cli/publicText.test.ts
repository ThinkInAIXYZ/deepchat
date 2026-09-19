import { describe, expect, it } from 'vitest'
import { stripC0AndC1Controls } from '@/cli/publicText'

describe('CLI public text', () => {
  it('filters controls within an explicit scan bound', () => {
    expect(stripC0AndC1Controls('safe\0text\u0085', 10)).toBe('safetext')
  })

  it('rejects text beyond its scan bound before filtering', () => {
    expect(() => stripC0AndC1Controls('over-limit', 9)).toThrow(
      'Public text exceeds its scan limit'
    )
  })
})
