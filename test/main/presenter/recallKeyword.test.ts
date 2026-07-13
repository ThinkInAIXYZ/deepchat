import { describe, expect, it } from 'vitest'

import {
  extractRecallKeywordCandidates,
  selectRecallKeywordTerms
} from '@/presenter/memoryPresenter/core/recallKeyword'

describe('recall keyword selection', () => {
  it('extracts ascii, code-like, and CJK candidates without duplicates', () => {
    const candidates = extractRecallKeywordCandidates(
      'Please retry api/v1.redis_error in 中文回答问题 and retry api/v1.redis_error'
    )

    expect(candidates.map((candidate) => [candidate.term, candidate.kind])).toEqual([
      ['please', 'ascii'],
      ['retry', 'ascii'],
      ['api/v1.redis_error', 'code'],
      ['中文回答', 'cjk'],
      ['文回答问', 'cjk'],
      ['回答问题', 'cjk'],
      ['and', 'ascii']
    ])
  })

  it('caps candidate extraction before unbounded query text can expand work', () => {
    const candidates = extractRecallKeywordCandidates(
      Array.from({ length: 40 }, (_value, index) => `term${index}`).join(' ')
    )

    expect(candidates).toHaveLength(24)
    expect(candidates.at(-1)?.term).toBe('term23')
  })

  it('preserves earlier CJK candidates before more than 24 ASCII tokens under the cap', () => {
    const candidates = extractRecallKeywordCandidates(
      `中文回答问题 ${Array.from({ length: 40 }, (_value, index) => `term${index}`).join(' ')}`
    )

    expect(candidates).toHaveLength(24)
    expect(candidates.slice(0, 3).map((candidate) => candidate.term)).toEqual([
      '中文回答',
      '文回答问',
      '回答问题'
    ])
    expect(candidates.some((candidate) => candidate.term === 'term23')).toBe(false)
  })

  it('prioritizes code, then CJK, then ASCII while emitting selected terms in query order', () => {
    const candidates = extractRecallKeywordCandidates(
      'alpha longestplaintext 中文回答问题 api/v1.redis_error beta gamma delta epsilon zeta'
    )

    expect(selectRecallKeywordTerms(candidates)).toEqual([
      'alpha',
      'longestplaintext',
      '中文回答',
      '文回答问',
      '回答问题',
      'api/v1.redis_error',
      'gamma',
      'epsilon'
    ])
  })

  it('breaks same-kind ties by Unicode code-point length and then first position', () => {
    const candidates = extractRecallKeywordCandidates(
      'aaa bbbb ccccc ddddd eeeeee fffffff gggggggg hhhhhhhhh iiiiiiiiii jjjjjjjjjjj'
    )

    expect(selectRecallKeywordTerms(candidates)).toEqual([
      'ccccc',
      'ddddd',
      'eeeeee',
      'fffffff',
      'gggggggg',
      'hhhhhhhhh',
      'iiiiiiiiii',
      'jjjjjjjjjjj'
    ])
  })
})
