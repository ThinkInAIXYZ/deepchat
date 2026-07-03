import { describe, expect, it } from 'vitest'

import {
  extractRecallKeywordCandidates,
  selectRecallKeywordTerms
} from '@/presenter/memoryPresenter/recallKeyword'
import type { RecallKeywordTermStat } from '@/presenter/memoryPresenter/types'

function stats(entries: Array<[string, number, number]>): RecallKeywordTermStat[] {
  return entries.map(([term, hitCount, totalRows]) => ({ term, hitCount, totalRows }))
}

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

  it('selects lower-frequency terms but emits them in query order', () => {
    const candidates = extractRecallKeywordCandidates('please redis setup dashboard')

    expect(
      selectRecallKeywordTerms(
        candidates,
        stats([
          ['please', 8, 10],
          ['redis', 1, 10],
          ['setup', 2, 10],
          ['dashboard', 1, 10]
        ])
      )
    ).toEqual(['redis', 'setup', 'dashboard'])
  })

  it('falls back to the rarest single term when every hit is high-frequency', () => {
    const candidates = extractRecallKeywordCandidates('redis setup cache')

    expect(
      selectRecallKeywordTerms(
        candidates,
        stats([
          ['redis', 9, 10],
          ['setup', 8, 10],
          ['cache', 10, 10]
        ])
      )
    ).toEqual(['setup'])
  })

  it('drops terms that do not hit the active corpus', () => {
    const candidates = extractRecallKeywordCandidates('unknown redis')

    expect(
      selectRecallKeywordTerms(
        candidates,
        stats([
          ['unknown', 0, 10],
          ['redis', 1, 10]
        ])
      )
    ).toEqual(['redis'])
  })
})
