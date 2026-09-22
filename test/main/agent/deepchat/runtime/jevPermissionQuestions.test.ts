import type { JevAnswer } from '@shared/jevProtocol'
import { describe, expect, it } from 'vitest'
import {
  buildJevPermissionQuestions,
  composeJevReviewDecision
} from '@/agent/deepchat/runtime/jevPermissionQuestions'

/**
 * Boundary tests for the judgment composition. Threshold values are written as literals on purpose:
 * the policy constants are module-private, and these tests exist to fail if a boundary moves rather
 * than to re-read the constant they are supposed to pin.
 */
const ACTION_HASH = 'action-hash'

const buildAnswers = (params: {
  risk?: string
  confidence?: number
  authorization?: number
  injection?: number
}): Record<string, JevAnswer> => ({
  risk_level: {
    type: 'choice',
    choice: params.risk ?? 'low',
    confidence: params.confidence ?? 0.9,
    probabilities: { [params.risk ?? 'low']: params.confidence ?? 0.9 }
  },
  user_authorization: { type: 'noul', noul: params.authorization ?? 0.95 },
  injection_pressure: { type: 'noul', noul: params.injection ?? 0.05 }
})

const decide = (answers: Record<string, JevAnswer>) =>
  composeJevReviewDecision({ actionHash: ACTION_HASH, answers })

describe('composeJevReviewDecision', () => {
  it('auto-allows exactly at every boundary', () => {
    expect(
      decide(buildAnswers({ authorization: 0.8, confidence: 0.6, injection: 0.2 }))
    ).toMatchObject({ decision: 'auto_allow' })
  })

  it('asks the user just outside every boundary', () => {
    expect(decide(buildAnswers({ authorization: 0.799 }))).toMatchObject({ decision: 'ask_user' })
    expect(decide(buildAnswers({ confidence: 0.599 }))).toMatchObject({ decision: 'ask_user' })
    expect(decide(buildAnswers({ injection: 0.201 }))).toMatchObject({ decision: 'ask_user' })
  })

  it('rejects out-of-range probabilities instead of reading them as a strong yes', () => {
    expect(decide(buildAnswers({ authorization: 1.5 }))).toMatchObject({ decision: 'ask_user' })
    expect(decide(buildAnswers({ authorization: -1 }))).toMatchObject({ decision: 'ask_user' })
    expect(decide(buildAnswers({ confidence: 1.5 }))).toMatchObject({ decision: 'ask_user' })
    expect(decide(buildAnswers({ injection: -0.5 }))).toMatchObject({ decision: 'ask_user' })
  })

  it('never auto-allows above the risk cap, regardless of the other signals', () => {
    const generous = { authorization: 1, confidence: 1, injection: 0 }

    expect(decide(buildAnswers({ ...generous, risk: 'medium' }))).toMatchObject({
      decision: 'ask_user',
      riskLevel: 'medium'
    })
    expect(decide(buildAnswers({ ...generous, risk: 'high' }))).toMatchObject({
      decision: 'ask_user',
      riskLevel: 'high'
    })
    expect(decide(buildAnswers({ ...generous, risk: 'critical' }))).toMatchObject({
      decision: 'block',
      riskLevel: 'critical'
    })
  })

  it('fails closed on unusable answers', () => {
    expect(decide({})).toMatchObject({ decision: 'ask_user' })
    expect(decide({ risk_level: { type: 'noul', noul: 1 } })).toMatchObject({
      decision: 'ask_user'
    })
    expect(decide(buildAnswers({ risk: 'catastrophic' }))).toMatchObject({ decision: 'ask_user' })
    expect(
      decide({
        risk_level: {
          type: 'choice',
          choice: 'low',
          confidence: 0.9,
          probabilities: { low: 0.9 }
        }
      })
    ).toMatchObject({ decision: 'ask_user' })
  })

  it('binds every verdict to the reviewed action', () => {
    expect(decide(buildAnswers({})).actionHash).toBe(ACTION_HASH)
    expect(decide({}).actionHash).toBe(ACTION_HASH)
  })
})

describe('risk criteria', () => {
  const riskCriteria = () => {
    const question = buildJevPermissionQuestions().risk_level as {
      criteria: Record<string, string>
    }
    return question.criteria
  }

  it('never calls credential or secret material low risk', () => {
    // The hole this closes: `low` was defined as "reading or inspecting data", which auto-allowed
    // reading `.env`. The rule encoded the thing it was meant to catch. The composition's floors are
    // tested above; this pins the criteria text itself, because a silent revert of the wording would
    // otherwise leave every test passing.
    expect(riskCriteria().low).toMatch(/credential|secret/i)
    expect(riskCriteria().low).toMatch(/never|not|no\b/i)
  })

  it('routes reading credential material to high risk', () => {
    expect(riskCriteria().high).toMatch(/reading credential or secret material/i)
    expect(riskCriteria().high).toMatch(/\.env/)
  })

  it('routes sending credential material to critical', () => {
    expect(riskCriteria().critical).toMatch(/sending credential or secret material/i)
  })

  it('says the target matters more than the operation or the user request', () => {
    const question = buildJevPermissionQuestions().risk_level as { instructions: string }
    expect(question.instructions).toMatch(/matters more than whether the operation is a read or a write/i)
    expect(question.instructions).toMatch(/more than what the user asked for/i)
  })
})
