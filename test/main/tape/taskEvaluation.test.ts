import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEEPCHAT_TASK_EVALUATION_REASON_CODES,
  DeepChatTaskEvaluationProjectionSchema,
  DeepChatTaskEvaluationSummarySchema,
  MAX_TASK_EVALUATION_CANDIDATE_BYTES,
  type DeepChatLegacyTaskEvaluation,
  type DeepChatHandoffFormatRequirement,
  type DeepChatTaskEvaluationExecutionStatus
} from '@shared/types/task-contract'
import { hashJsonData } from '@/tape/domain/canonicalJson'
import { buildTaskContract } from '@/tape/domain/taskContract'
import {
  buildTaskEvaluation,
  projectTaskEvaluationSummary,
  restoreStoredTaskEvaluation,
  restoreTaskEvaluation,
  serializeTaskEvaluation
} from '@/tape/domain/taskEvaluation'

const PREVIOUS_HEAD_EVALUATION_JSON =
  '{"candidate":{"kind":"answer","sha256":"ddc3016ae0a6c8cee3ad58eb31c7b2dd5ce301adebb35d7118083625458d513e","utf8Bytes":39},"disposition":"accepted","evaluationHash":"9733f212f7a14b8330797eac534eed15fd5b329ad1e313fc55813aa5d64190ad","evaluatorVersion":"task-contract-v1","executionStatus":"completed","hashVersion":1,"omittedRecordCount":0,"reasonCodes":[],"records":[{"additionalEvidenceCount":0,"code":"required_sections_present","instancePath":null,"keyword":null,"outcome":"passed","requirementId":"sections","requirementKind":"required_sections","section":null}],"schemaVersion":1,"taskContractHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","turnId":"turn-1","verdict":"passed"}'

const DEFAULT_HANDOFF_FORMAT: readonly DeepChatHandoffFormatRequirement[] = [
  {
    id: 'sections',
    kind: 'required_sections',
    level: 2,
    sections: ['Handoff', 'Validation']
  }
]

function createContract(
  handoffFormat: readonly DeepChatHandoffFormatRequirement[] = DEFAULT_HANDOFF_FORMAT
) {
  return buildTaskContract({
    delegationId: 'delegation-1',
    turnId: 'turn-1',
    turnSeq: 1,
    turnKind: 'initial',
    parentSessionId: 'parent-1',
    slotId: 'reviewer',
    targetAgentId: 'agent-1',
    title: 'Review boundaries',
    prompt: 'Inspect the contract boundary.',
    workspace: { kind: 'path', path: path.resolve('project') },
    handoffFormat,
    predecessorEvaluationRef: null,
    maxToolEffect: 'write',
    maxSubagentDepth: 0
  })
}

function evaluate(
  candidateResult: string | null,
  executionStatus: DeepChatTaskEvaluationExecutionStatus = 'completed',
  handoffFormat: readonly DeepChatHandoffFormatRequirement[] = DEFAULT_HANDOFF_FORMAT
) {
  return buildTaskEvaluation({
    contract: createContract(handoffFormat),
    executionStatus,
    candidateResult
  })
}

function finalizeLegacyEvaluation(
  draft: Omit<DeepChatLegacyTaskEvaluation, 'evaluationHash'>
): DeepChatLegacyTaskEvaluation {
  return { ...draft, evaluationHash: hashJsonData(draft) }
}

describe('Task evaluation domain', () => {
  it('validates required Handoff sections without treating their contents as task success', () => {
    const candidate = [
      '```markdown',
      '## Handoff',
      'This heading is fenced and must not count.',
      '```',
      '## Handoff',
      'This claim is untrusted task evidence.',
      '## Validation',
      'The required section has a body.'
    ].join('\n')

    const first = evaluate(candidate)
    const second = evaluate(candidate)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      schemaVersion: 2,
      hashVersion: 1,
      evaluatorVersion: 'handoff-format-v1',
      evaluationKind: 'handoff_format',
      formatStatus: 'valid',
      reasonCodes: [],
      records: [{ requirementId: 'sections', code: 'required_sections_present', outcome: 'valid' }]
    })
    expect(first).not.toHaveProperty('verdict')
    expect(first).not.toHaveProperty('disposition')
    expect(first.evaluationHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(Object.isFrozen(first)).toBe(true)
    expect(restoreTaskEvaluation(JSON.parse(serializeTaskEvaluation(first)))).toEqual(first)

    const mutableRef = {
      schemaVersion: 1,
      sessionId: 'parent-1',
      tapeIdentity: 'a'.repeat(64),
      entryId: 3,
      evaluationHash: first.evaluationHash
    } as const
    const summary = projectTaskEvaluationSummary(first, mutableRef)
    expect(summary).toMatchObject({
      evaluationKind: 'handoff_format',
      formatStatus: 'valid',
      evidence: [],
      omittedEvidenceCount: 0
    })
    expect(summary.evaluationRef).not.toBe(mutableRef)
    expect(Object.isFrozen(mutableRef)).toBe(false)
  })

  it('reads previous-head evaluations without admitting them to the current writer', () => {
    const legacy = JSON.parse(PREVIOUS_HEAD_EVALUATION_JSON) as DeepChatLegacyTaskEvaluation
    const restored = restoreStoredTaskEvaluation(legacy)

    expect(restoreTaskEvaluation(legacy)).toBeNull()
    expect(restored).toEqual(legacy)
    expect(Object.isFrozen(restored)).toBe(true)
    expect(Object.isFrozen(restored?.records)).toBe(true)

    const summary = projectTaskEvaluationSummary(legacy, {
      schemaVersion: 1,
      sessionId: 'parent-1',
      tapeIdentity: 'b'.repeat(64),
      entryId: 5,
      evaluationHash: legacy.evaluationHash
    })
    expect(summary).toEqual({
      evaluationKind: 'handoff_format',
      formatStatus: 'valid',
      reasonCodes: [],
      candidate: legacy.candidate,
      evidence: [],
      evaluationRef: {
        schemaVersion: 1,
        sessionId: 'parent-1',
        tapeIdentity: 'b'.repeat(64),
        entryId: 5,
        evaluationHash: legacy.evaluationHash
      },
      omittedEvidenceCount: 0
    })
    expect(summary).not.toHaveProperty('verdict')
    expect(summary).not.toHaveProperty('disposition')
  })

  it('projects failed and indeterminate previous-head evidence into current summaries', () => {
    const legacy = JSON.parse(PREVIOUS_HEAD_EVALUATION_JSON) as DeepChatLegacyTaskEvaluation
    const { evaluationHash: _evaluationHash, ...legacyDraft } = legacy
    const failed = finalizeLegacyEvaluation({
      ...legacyDraft,
      verdict: 'failed',
      disposition: 'parked',
      reasonCodes: ['required_sections_missing'],
      records: [
        {
          ...legacy.records[0],
          outcome: 'failed',
          code: 'required_sections_missing',
          section: 'Validation'
        }
      ]
    })
    const indeterminate = finalizeLegacyEvaluation({
      ...legacyDraft,
      executionStatus: 'cancelled',
      verdict: 'indeterminate',
      disposition: 'parked',
      reasonCodes: ['execution_cancelled'],
      records: [
        {
          requirementId: null,
          requirementKind: null,
          outcome: 'indeterminate',
          code: 'execution_cancelled',
          section: null,
          instancePath: null,
          keyword: null,
          additionalEvidenceCount: 0
        }
      ]
    })

    expect(
      projectTaskEvaluationSummary(failed, {
        schemaVersion: 1,
        sessionId: 'parent-1',
        tapeIdentity: 'b'.repeat(64),
        entryId: 6,
        evaluationHash: failed.evaluationHash
      })
    ).toMatchObject({
      formatStatus: 'invalid',
      reasonCodes: ['required_sections_missing'],
      evidence: [{ outcome: 'invalid', code: 'required_sections_missing' }]
    })
    expect(
      projectTaskEvaluationSummary(indeterminate, {
        schemaVersion: 1,
        sessionId: 'parent-1',
        tapeIdentity: 'b'.repeat(64),
        entryId: 7,
        evaluationHash: indeterminate.evaluationHash
      })
    ).toMatchObject({
      formatStatus: 'indeterminate',
      reasonCodes: ['execution_cancelled'],
      evidence: [{ outcome: 'indeterminate', code: 'execution_cancelled' }]
    })
  })

  it('enforces previous writer state and rejects dormant result-schema evaluations', () => {
    const legacy = JSON.parse(PREVIOUS_HEAD_EVALUATION_JSON) as DeepChatLegacyTaskEvaluation
    expect(restoreStoredTaskEvaluation({ ...legacy, verdict: 'failed' })).toBeNull()

    const { evaluationHash: _impossibleHash, ...impossibleDraft } = legacy
    const impossibleEvaluation = finalizeLegacyEvaluation({
      ...impossibleDraft,
      candidate: { kind: 'absent' }
    })
    expect(restoreStoredTaskEvaluation(impossibleEvaluation)).toBeNull()
    const candidateMissingEvaluation = finalizeLegacyEvaluation({
      ...impossibleDraft,
      candidate: { kind: 'absent' },
      verdict: 'indeterminate',
      disposition: 'parked',
      reasonCodes: ['candidate_missing'],
      records: [
        {
          requirementId: null,
          requirementKind: null,
          outcome: 'indeterminate',
          code: 'candidate_missing',
          section: null,
          instancePath: null,
          keyword: null,
          additionalEvidenceCount: 0
        }
      ]
    })
    expect(restoreStoredTaskEvaluation(candidateMissingEvaluation)).toEqual(
      candidateMissingEvaluation
    )

    const { evaluationHash: _evaluationHash, ...legacyDraft } = legacy
    const resultSchemaDraft = {
      ...legacyDraft,
      records: [
        {
          ...legacy.records[0],
          requirementKind: 'result_schema' as const,
          code: 'result_schema_valid' as const
        }
      ]
    }
    const resultSchemaEvaluation = {
      ...resultSchemaDraft,
      evaluationHash: hashJsonData(resultSchemaDraft)
    }

    expect(restoreStoredTaskEvaluation(resultSchemaEvaluation)).toBeNull()
  })

  it('reports every missing section as bounded format evidence', () => {
    const result = evaluate(['## Handoff', 'Review complete.'].join('\n'), 'completed')

    expect(result).toMatchObject({
      formatStatus: 'invalid',
      reasonCodes: ['required_sections_missing']
    })
    expect(result.records).toEqual([
      expect.objectContaining({
        requirementId: 'sections',
        code: 'required_sections_missing',
        section: 'Validation'
      })
    ])
    expect(
      projectTaskEvaluationSummary(
        result,
        {
          schemaVersion: 1,
          sessionId: 'parent-1',
          tapeIdentity: 'b'.repeat(64),
          entryId: 4,
          evaluationHash: result.evaluationHash
        },
        1
      )
    ).toMatchObject({
      evidence: [expect.objectContaining({ requirementId: 'sections' })],
      omittedEvidenceCount: 0
    })
  })

  it('keeps format validity independent from execution failure', () => {
    const result = evaluate('## Handoff\nDone.\n## Validation\nChecked.', 'failed')

    expect(result).toMatchObject({
      executionStatus: 'failed',
      formatStatus: 'valid',
      reasonCodes: []
    })
  })

  it.each([
    {
      name: 'a missing section',
      candidate: '## Handoff\nDone.',
      section: 'Validation'
    },
    {
      name: 'an empty section',
      candidate: '## Handoff\nDone.\n## Validation\n\n',
      section: 'Validation'
    }
  ])('marks a completed candidate invalid with $name', ({ candidate, section }) => {
    const result = evaluate(candidate)

    expect(result).toMatchObject({ formatStatus: 'invalid' })
    expect(result.records[0]).toMatchObject({ code: 'required_sections_missing', section })
  })

  it.each([
    { status: 'cancelled' as const, candidate: 'answer', code: 'execution_cancelled' },
    { status: 'interrupted' as const, candidate: 'answer', code: 'execution_interrupted' },
    { status: 'completed' as const, candidate: null, code: 'candidate_missing' },
    {
      status: 'completed' as const,
      candidate: 'x'.repeat(MAX_TASK_EVALUATION_CANDIDATE_BYTES + 1),
      code: 'candidate_too_large'
    }
  ])('records $code as indeterminate', ({ status, candidate, code }) => {
    expect(evaluate(candidate, status)).toMatchObject({
      formatStatus: 'indeterminate',
      reasonCodes: [code],
      records: [{ code, outcome: 'indeterminate' }]
    })
  })

  it('rejects hash-valid projections that violate canonical reason evidence', () => {
    const evaluation = evaluate('## Handoff\nDone.\n## Validation\nChecked.')
    const { evaluationHash: _evaluationHash, ...draft } = evaluation
    const forgedDraft = {
      ...draft,
      formatStatus: 'invalid' as const,
      reasonCodes: ['candidate_missing' as const]
    }
    const forged = { ...forgedDraft, evaluationHash: hashJsonData(forgedDraft) }

    expect(restoreTaskEvaluation(forged)).toBeNull()
  })

  it('bounds reason-code arrays in full and parent-facing projections', () => {
    const evaluation = evaluate(null)
    const evaluationRef = {
      schemaVersion: 1 as const,
      sessionId: 'parent-1',
      tapeIdentity: 'a'.repeat(64),
      entryId: 1,
      evaluationHash: evaluation.evaluationHash
    }
    const summary = projectTaskEvaluationSummary(evaluation, evaluationRef)
    const reasonCodes = Array.from(
      { length: DEEPCHAT_TASK_EVALUATION_REASON_CODES.length + 1 },
      () => 'candidate_missing' as const
    )

    expect(
      DeepChatTaskEvaluationProjectionSchema.safeParse({ ...evaluation, reasonCodes }).success
    ).toBe(false)
    expect(DeepChatTaskEvaluationSummarySchema.safeParse({ ...summary, reasonCodes }).success).toBe(
      false
    )
  })
})
