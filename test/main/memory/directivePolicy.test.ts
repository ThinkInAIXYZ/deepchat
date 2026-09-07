import { describe, expect, it } from 'vitest'

import {
  createMemoryTopicSuppressionPolicy,
  directiveSuppressionAppliesToPurpose
} from '@/memory/core/directivePolicy'
import { AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS } from '@shared/types/agent-memory'

describe('memory directive suppression policy', () => {
  it('normalizes case, compatibility characters, and whitespace', () => {
    const policy = createMemoryTopicSuppressionPolicy(['Ｐｒｏｊｅｃｔ   Saffron'])

    expect(policy.topics).toEqual(['project saffron'])
    expect(policy.suppresses('Notes about PROJECT \n Saffron are private.')).toBe(true)
  })

  it('uses Unicode letter and number boundaries for non-CJK topics', () => {
    const go = createMemoryTopicSuppressionPolicy(['go'])
    const cafe = createMemoryTopicSuppressionPolicy(['café'])

    expect(go.suppresses('We should go now.')).toBe(true)
    expect(go.suppresses('The project uses Golang.')).toBe(false)
    expect(go.suppresses('Do not forgo validation.')).toBe(false)
    expect(cafe.suppresses('Meet at Café tomorrow.')).toBe(true)
    expect(cafe.suppresses('The Caféteria is open.')).toBe(false)
  })

  it('allows exact normalized substring matches for CJK topics', () => {
    const policy = createMemoryTopicSuppressionPolicy(['项目朱雀'])

    expect(policy.suppresses('旧项目朱雀档案需要归档。')).toBe(true)
    expect(policy.suppresses('项目玄武与它无关。')).toBe(false)
  })

  it('ignores persisted single-character CJK topics instead of over-suppressing recall', () => {
    const policy = createMemoryTopicSuppressionPolicy(['工', '工作'])

    expect(policy.topics).toEqual(['工作'])
    expect(policy.suppresses('工作安排已经更新。')).toBe(true)
    expect(policy.suppresses('这个工程已经完成。')).toBe(false)
  })

  it('deduplicates bounded topics and ignores malformed persisted values', () => {
    const policy = createMemoryTopicSuppressionPolicy([
      null,
      '',
      ' Alpha ',
      'alpha',
      'x'.repeat(AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS + 1)
    ])

    expect(policy.topics).toEqual(['alpha'])
  })

  it('applies only to model-facing recall and injection', () => {
    expect(directiveSuppressionAppliesToPurpose('recall')).toBe(true)
    expect(directiveSuppressionAppliesToPurpose('search')).toBe(false)
    expect(directiveSuppressionAppliesToPurpose('injection')).toBe(true)
    expect(directiveSuppressionAppliesToPurpose('decision')).toBe(false)
  })
})
