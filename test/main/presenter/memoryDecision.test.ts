import { describe, expect, it } from 'vitest'

import { buildDecisionPrompt, parseDecision } from '@/presenter/memoryPresenter/decision'

describe('buildDecisionPrompt', () => {
  it('embeds the candidate, indexes neighbors, and declares the data untrusted', () => {
    const prompt = buildDecisionPrompt(
      { kind: 'semantic', category: null, content: 'user prefers redis', importance: 0.5 },
      [{ content: 'user likes databases' }, { content: 'user lives in berlin' }]
    )
    expect(prompt).toContain('user prefers redis')
    expect(prompt).toContain('[0] user likes databases')
    expect(prompt).toContain('[1] user lives in berlin')
    expect(prompt).toContain('untrusted')
    expect(prompt).toContain('Choose exactly ONE decision')
  })

  it('renders (none) when there are no neighbors', () => {
    const prompt = buildDecisionPrompt(
      { kind: 'semantic', category: null, content: 'x', importance: 0.5 },
      []
    )
    expect(prompt).toContain('(none)')
  })
})

describe('parseDecision', () => {
  it('parses each decision kind with a valid target', () => {
    expect(parseDecision('{"decision":"ADD","targetIndex":null}', 3)).toMatchObject({
      decision: 'ADD',
      targetIndex: null
    })
    expect(
      parseDecision('{"decision":"UPDATE","targetIndex":1,"mergedContent":"merged"}', 3)
    ).toMatchObject({ decision: 'UPDATE', targetIndex: 1, mergedContent: 'merged' })
    expect(parseDecision('{"decision":"SUPERSEDE","targetIndex":0}', 3).decision).toBe('SUPERSEDE')
    expect(parseDecision('{"decision":"NOOP","targetIndex":2}', 3).decision).toBe('NOOP')
    expect(parseDecision('{"decision":"CHALLENGE","targetIndex":0}', 3).decision).toBe('CHALLENGE')
  })

  it('tolerates code fences and surrounding prose', () => {
    const raw = 'Sure:\n```json\n{"decision":"NOOP","targetIndex":0}\n```\ndone'
    expect(parseDecision(raw, 1).decision).toBe('NOOP')
  })

  it('degrades to ADD on garbage, empty, or non-enum decisions', () => {
    expect(parseDecision('', 3)).toMatchObject({ decision: 'ADD', targetIndex: null })
    expect(parseDecision('not json', 3).decision).toBe('ADD')
    expect(parseDecision('{"decision":"DROP","targetIndex":0}', 3).decision).toBe('ADD')
  })

  it('degrades to ADD when a targeted decision has a missing or out-of-range index', () => {
    expect(parseDecision('{"decision":"UPDATE","targetIndex":null}', 3).decision).toBe('ADD')
    expect(parseDecision('{"decision":"SUPERSEDE","targetIndex":5}', 3).decision).toBe('ADD')
    expect(parseDecision('{"decision":"NOOP","targetIndex":-1}', 3).decision).toBe('ADD')
    expect(parseDecision('{"decision":"UPDATE","targetIndex":1.5}', 3).decision).toBe('ADD')
  })

  it('drops empty mergedContent to null', () => {
    expect(
      parseDecision('{"decision":"UPDATE","targetIndex":0,"mergedContent":"  "}', 2)
    ).toMatchObject({ decision: 'UPDATE', targetIndex: 0, mergedContent: null })
  })
})
