import { describe, expect, it } from 'vitest'
import { isJevJudgmentModelId } from '../../../src/shared/jevProtocol'

describe('isJevJudgmentModelId', () => {
  it('recognizes the Jev namespace and family, whatever the casing and padding', () => {
    expect(isJevJudgmentModelId('typesafe/jev')).toBe(true)
    expect(isJevJudgmentModelId(' JEV ')).toBe(true)
    expect(isJevJudgmentModelId('jev-latest')).toBe(true)
    expect(isJevJudgmentModelId('jev-1.13.0')).toBe(true)
    // A versioned third-party id stays in the family.
    expect(isJevJudgmentModelId('typesafe/jev-1.14.0')).toBe(true)
  })

  it('does not claim a model that merely has those letters in its name', () => {
    // The previous substring rule claimed every one of these.
    expect(isJevJudgmentModelId('@cf/meta/llama-3.1-8b-instruct')).toBe(false)
    expect(isJevJudgmentModelId('not-a-jev-model')).toBe(false)
    expect(isJevJudgmentModelId('@cf/zai-org/glm-5.2')).toBe(false)
    expect(isJevJudgmentModelId('')).toBe(false)
  })
})
