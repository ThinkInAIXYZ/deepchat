import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_TASK_CONTRACT_REQUIREMENTS,
  type DeepChatHandoffFormatRequirement
} from '@shared/types/task-contract'
import {
  TaskContractError,
  buildTaskContract,
  isDeepChatTaskContract,
  restoreTaskContract,
  restoreTaskContractRef,
  serializeTaskContract,
  serializeTaskContractRef,
  type BuildTaskContractInput
} from '@/tape/domain/taskContract'

const TEST_WORKSPACE_PATH = path.resolve('project scope ')

function buildInput(overrides: Partial<BuildTaskContractInput> = {}): BuildTaskContractInput {
  return {
    delegationId: 'delegation-1',
    turnId: 'turn-1',
    turnSeq: 1,
    turnKind: 'initial',
    parentSessionId: 'parent-1',
    slotId: 'reviewer',
    targetAgentId: 'agent-1',
    title: 'Review boundaries',
    prompt: 'Inspect the contract boundary.',
    workspace: { kind: 'path', path: TEST_WORKSPACE_PATH },
    handoffFormat: [
      {
        id: 'sections',
        kind: 'required_sections',
        level: 2,
        sections: ['Validation', 'Handoff']
      },
      {
        id: 'details',
        kind: 'required_sections',
        level: 2,
        sections: ['Evidence', 'Result']
      }
    ],
    predecessorEvaluationRef: null,
    maxToolEffect: 'write',
    maxSubagentDepth: 0,
    ...overrides
  }
}

describe('TaskContract domain', () => {
  it('canonicalizes semantically unordered inputs into one immutable identity', () => {
    const first = buildTaskContract(buildInput())
    const second = buildTaskContract(
      buildInput({
        handoffFormat: [
          {
            id: 'details',
            kind: 'required_sections',
            level: 2,
            sections: ['Result', 'Evidence']
          },
          {
            id: 'sections',
            kind: 'required_sections',
            level: 2,
            sections: ['Handoff', 'Validation']
          }
        ]
      })
    )

    expect(first).toEqual(second)
    expect(first.contractHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(first.taskHarness.acceptance.map((requirement) => requirement.id)).toEqual([
      'details',
      'sections'
    ])
    expect(first.taskHarness.ceilings.workspace).toEqual({
      kind: 'path',
      path: TEST_WORKSPACE_PATH
    })
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.taskHarness.acceptance)).toBe(true)
    expect(isDeepChatTaskContract(JSON.parse(serializeTaskContract(first)))).toBe(true)
  })

  it('preserves the persisted v1 identity for required Handoff sections', () => {
    const contract = buildTaskContract({
      delegationId: 'delegation-golden',
      turnId: 'turn-golden',
      turnSeq: 1,
      turnKind: 'initial',
      parentSessionId: 'parent-golden',
      slotId: 'reviewer',
      targetAgentId: 'deepchat',
      title: 'Review format',
      prompt: 'Return the fixed Handoff.',
      workspace: { kind: 'runtime_default' },
      handoffFormat: [
        {
          id: 'sections',
          kind: 'required_sections',
          level: 2,
          sections: ['Validation', 'Handoff']
        }
      ],
      predecessorEvaluationRef: null,
      maxToolEffect: 'write',
      maxSubagentDepth: 0
    })
    const persisted = JSON.parse(serializeTaskContract(contract))

    expect(persisted).toEqual({
      schemaVersion: 1,
      hashVersion: 1,
      taskSchema: {
        input: { kind: 'text', maxBytes: 64 * 1024 },
        output: { kind: 'markdown' }
      },
      taskConfig: {
        completionMode: 'single_response',
        retryMode: 'parent_follow_up',
        creationReason: 'delegation_created',
        predecessorEvaluationRef: null
      },
      taskDescription: {
        delegationId: 'delegation-golden',
        turnId: 'turn-golden',
        turnSeq: 1,
        turnKind: 'initial',
        parentSessionId: 'parent-golden',
        slotId: 'reviewer',
        targetAgentId: 'deepchat',
        title: 'Review format',
        prompt: 'Return the fixed Handoff.'
      },
      taskHarness: {
        acceptance: [
          {
            id: 'sections',
            kind: 'required_sections',
            level: 2,
            sections: ['Handoff', 'Validation']
          }
        ],
        ceilings: {
          maxToolEffect: 'write',
          workspace: { kind: 'runtime_default' },
          maxSubagentDepth: 0
        }
      },
      contractHash: 'ed681c28bfaf7a4aa788a4ebfe9b75674f35cdd76d0702b2997dcb3820b76d76'
    })
    expect(restoreTaskContract(persisted)).toEqual(contract)
  })

  it('detects content and hash tampering during recovery', () => {
    const contract = buildTaskContract(buildInput())
    const tampered = {
      ...contract,
      taskDescription: { ...contract.taskDescription, title: 'Different task' }
    }

    expect(isDeepChatTaskContract(tampered)).toBe(false)
    expect(restoreTaskContract(tampered)).toBeNull()
    expect(restoreTaskContract(JSON.parse(JSON.stringify(contract)))).toEqual(contract)
    expect(() =>
      buildTaskContract(buildInput({ creationReason: 'unknown' as 'delegation_created' }))
    ).toThrow(/creationReason is invalid/u)
  })

  it('keeps canonical workspace paths portable across host platforms', () => {
    const contract = buildTaskContract(
      buildInput({ workspace: { kind: 'path', path: 'C:/workspace/project/' } })
    )

    expect(contract.taskHarness.ceilings.workspace).toEqual({
      kind: 'path',
      path: 'C:\\workspace\\project\\'
    })
    expect(restoreTaskContract(JSON.parse(serializeTaskContract(contract)))).toEqual(contract)
  })

  it('rejects predecessor evaluations from another parent Session', () => {
    const predecessorEvaluationRef = {
      schemaVersion: 1 as const,
      sessionId: 'parent-1',
      tapeIdentity: 'a'.repeat(64),
      entryId: 3,
      evaluationHash: 'b'.repeat(64)
    }

    expect(
      buildTaskContract(buildInput({ turnKind: 'follow_up', turnSeq: 2, predecessorEvaluationRef }))
        .taskConfig.predecessorEvaluationRef
    ).toEqual(predecessorEvaluationRef)
    expect(() =>
      buildTaskContract(
        buildInput({
          turnKind: 'follow_up',
          turnSeq: 2,
          parentSessionId: 'different-parent',
          predecessorEvaluationRef
        })
      )
    ).toThrow(/must belong to the parent Session/u)
  })

  it('rejects duplicate sections and bounded-input overflow', () => {
    expect(() =>
      buildTaskContract(
        buildInput({
          handoffFormat: [
            {
              id: 'sections',
              kind: 'required_sections',
              level: 2,
              sections: ['Handoff', 'handoff']
            }
          ]
        })
      )
    ).toThrow(TaskContractError)
    expect(() =>
      buildTaskContract(
        buildInput({
          handoffFormat: Array.from(
            { length: MAX_TASK_CONTRACT_REQUIREMENTS + 1 },
            (_, index): DeepChatHandoffFormatRequirement => ({
              id: `section-${index}`,
              kind: 'required_sections',
              level: 2,
              sections: [`Section ${index}`]
            })
          )
        })
      )
    ).toThrow(/exceeds 64 requirements/u)
  })

  it('serializes only complete, normalized physical references', () => {
    expect(
      JSON.parse(
        serializeTaskContractRef({
          schemaVersion: 1,
          sessionId: 'parent-1',
          tapeIdentity: 'a'.repeat(64),
          entryId: 3,
          contractHash: 'b'.repeat(64)
        })
      )
    ).toEqual({
      schemaVersion: 1,
      sessionId: 'parent-1',
      tapeIdentity: 'a'.repeat(64),
      entryId: 3,
      contractHash: 'b'.repeat(64)
    })
    expect(() =>
      serializeTaskContractRef({
        schemaVersion: 1,
        sessionId: ' parent-1',
        tapeIdentity: 'a'.repeat(64),
        entryId: 3,
        contractHash: 'b'.repeat(64)
      })
    ).toThrow(/invalid/u)
    expect(
      restoreTaskContractRef({
        schemaVersion: 1,
        sessionId: ' parent-1',
        tapeIdentity: 'a'.repeat(64),
        entryId: 3,
        contractHash: 'b'.repeat(64)
      })
    ).toBeNull()
    expect(
      restoreTaskContractRef({
        schemaVersion: 1,
        sessionId: 'parent-1',
        tapeIdentity: 'a'.repeat(64),
        entryId: 3,
        contractHash: 'b'.repeat(64),
        unexpected: true
      })
    ).toBeNull()
  })

  it('keeps canonical identity fields within their persisted character bounds', () => {
    expect(() => buildTaskContract(buildInput({ delegationId: 'd'.repeat(257) }))).toThrow(
      TaskContractError
    )
    expect(() => buildTaskContract(buildInput({ title: 't'.repeat(161) }))).toThrow(
      TaskContractError
    )
  })
})
