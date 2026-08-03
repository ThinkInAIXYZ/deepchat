import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@shared/contracts/common'
import { WORKFLOW_EXECUTION_SNAPSHOT_MAX_BYTES } from '@shared/workflow/domain'
import { WORKFLOW_DEFAULT_EXECUTION_TIMEOUT_MS } from '@shared/workflow/serviceContracts'
import {
  WorkflowLaunchApprovalExpiredError,
  WorkflowLaunchApprovalScopeError,
  WorkflowLaunchApprovalSourceError,
  WorkflowLaunchApprovalRegistry
} from '@/workflow/launchApproval'
import { TEST_WORKFLOW_EXECUTION_SNAPSHOT } from './workflowTestFixtures'

function draft(input: JsonValue = null) {
  return {
    parentSessionId: 'parent',
    parentMessageId: null,
    namedWorkflowPath: null,
    workspacePath: '/repo',
    capabilityScopeHash: 'a'.repeat(64),
    executionSnapshot: TEST_WORKFLOW_EXECUTION_SNAPSHOT,
    capabilities: ['Delegate with the current parent permission policy'],
    scriptSource: 'return await agent("Inspect the change", { key: "inspect" })',
    input,
    allowedAgentIds: ['reviewer', 'deepchat', 'reviewer'],
    budget: {
      maxTotalTokens: 10_000,
      maxExecutionMs: 60_000
    }
  }
}

describe('WorkflowLaunchApprovalRegistry', () => {
  it('binds approval to the normalized source, input, workspace, agents, limits, and budget', () => {
    let now = 1_000
    const registry = new WorkflowLaunchApprovalRegistry(() => now)

    const first = registry.prepare(draft({ target: 'a' }))
    const same = registry.prepare(draft({ target: 'a' }))
    const differentInput = registry.prepare(draft({ target: 'b' }))
    const differentParentMessage = registry.prepare({
      ...draft({ target: 'a' }),
      parentMessageId: 'message-2'
    })
    const differentExecutionSnapshot = registry.prepare({
      ...draft({ target: 'a' }),
      executionSnapshot: {
        ...TEST_WORKFLOW_EXECUTION_SNAPSHOT,
        generationSettings: {
          ...TEST_WORKFLOW_EXECUTION_SNAPSHOT.generationSettings,
          reasoningEffort: 'high'
        }
      }
    })

    expect(first.sourceHash).toBe(same.sourceHash)
    expect(first.scopeHash).toBe(same.scopeHash)
    expect(differentInput.sourceHash).toBe(first.sourceHash)
    expect(differentInput.scopeHash).not.toBe(first.scopeHash)
    expect(differentParentMessage.scopeHash).not.toBe(first.scopeHash)
    expect(differentExecutionSnapshot.scopeHash).not.toBe(first.scopeHash)
    expect(first.summary.executionSnapshotHash).toMatch(/^[0-9a-f]{64}$/)
    expect(first.summary).toMatchObject({
      workspacePath: '/repo',
      allowedAgentIds: ['deepchat', 'reviewer'],
      maxInvocations: 128,
      maxPendingInvocations: 64,
      budget: {
        maxTotalTokens: 10_000,
        maxExecutionMs: 60_000
      },
      outline: {
        confidence: 'exact',
        nodes: [
          expect.objectContaining({
            kind: 'agent',
            key: 'inspect'
          })
        ]
      }
    })

    const request = registry.consume(first.approvalId)
    expect(request.allowedAgentIds).toEqual(['deepchat', 'reviewer'])
    expect(request.input).toEqual({ target: 'a' })
    expect(() => registry.consume(first.approvalId)).toThrow(WorkflowLaunchApprovalExpiredError)

    now = same.expiresAt
    expect(() => registry.consume(same.approvalId)).toThrow(WorkflowLaunchApprovalExpiredError)
  })

  it('rejects unsafe source before issuing an approval', () => {
    const registry = new WorkflowLaunchApprovalRegistry()

    expect(() =>
      registry.prepare({
        ...draft(),
        scriptSource: 'return await Promise.race([agent("a", { key: "a" })])'
      })
    ).toThrow('Direct .race() promise scheduling is unavailable')
  })

  it('normalizes explicit undefined optional settings before hashing an approval', () => {
    const registry = new WorkflowLaunchApprovalRegistry()
    const approval = registry.prepare({
      ...draft(),
      executionSnapshot: {
        ...TEST_WORKFLOW_EXECUTION_SNAPSHOT,
        generationSettings: {
          ...TEST_WORKFLOW_EXECUTION_SNAPSHOT.generationSettings,
          topP: undefined,
          imageGeneration: { size: undefined }
        }
      }
    })

    expect(approval.summary.executionSnapshotHash).toMatch(/^[0-9a-f]{64}$/)
    const request = registry.consume(approval.approvalId)
    expect(request.executionSnapshot.generationSettings).not.toHaveProperty('topP')
    expect(request.executionSnapshot.generationSettings.imageGeneration).toEqual({})
  })

  it('applies a non-optional execution deadline when the draft omits one', () => {
    const registry = new WorkflowLaunchApprovalRegistry()

    const withoutBudget = registry.prepare({
      ...draft(),
      budget: undefined
    })
    const tokenOnly = registry.prepare({
      ...draft(),
      budget: { maxTotalTokens: 500 }
    })

    expect(withoutBudget.summary.budget).toEqual({
      maxExecutionMs: WORKFLOW_DEFAULT_EXECUTION_TIMEOUT_MS
    })
    expect(tokenOnly.summary.budget).toEqual({
      maxExecutionMs: WORKFLOW_DEFAULT_EXECUTION_TIMEOUT_MS,
      maxTotalTokens: 500
    })
  })

  it('bounds unconsumed approval state', () => {
    const registry = new WorkflowLaunchApprovalRegistry(Date.now, 60_000, 1)
    registry.prepare(draft())

    expect(() => registry.prepare(draft({ second: true }))).toThrow(
      'Workflow launch approval queue is full'
    )
  })

  it('counts all retained approval metadata toward the pending byte limit', () => {
    const registry = new WorkflowLaunchApprovalRegistry(Date.now, 60_000, 4, 8_192)
    const capabilities = Array.from({ length: 16 }, (_, index) =>
      `capability-${index}`.padEnd(256, 'x')
    )
    const allowedAgentIds = Array.from({ length: 32 }, (_, index) =>
      `agent-${index}`.padEnd(256, 'x')
    )

    expect(() =>
      registry.prepare({
        ...draft(),
        capabilities,
        allowedAgentIds
      })
    ).toThrow('pending limit')
  })

  it('does not expose the retained approval object to callers', () => {
    const registry = new WorkflowLaunchApprovalRegistry(() => 1_000)
    const approval = registry.prepare(draft())
    const approvalId = approval.approvalId
    const expiresAt = approval.expiresAt

    approval.expiresAt = 0
    approval.summary.allowedAgentIds[0] = 'mutated-agent'
    approval.summary.capabilities[0] = 'mutated-capability'

    expect(registry.get(approvalId)).toMatchObject({
      expiresAt,
      summary: {
        allowedAgentIds: ['deepchat', 'reviewer'],
        capabilities: ['Delegate with the current parent permission policy']
      }
    })
  })

  it('hashes large bounded input without copying it into the approval scope payload', () => {
    const registry = new WorkflowLaunchApprovalRegistry()

    expect(
      registry.prepare(
        draft({
          payload: 'x'.repeat(256 * 1024)
        })
      ).scopeHash
    ).toMatch(/^[0-9a-f]{64}$/)
    expect(() =>
      registry.prepare({
        ...draft({ payload: 'too large' }),
        limits: {
          maxInputBytes: 4
        }
      })
    ).toThrow('exceeds the 4-byte limit')
  })

  it('rejects an oversized execution snapshot before retaining an approval', () => {
    const registry = new WorkflowLaunchApprovalRegistry()

    expect(() =>
      registry.prepare({
        ...draft(),
        executionSnapshot: {
          ...TEST_WORKFLOW_EXECUTION_SNAPSHOT,
          generationSettings: {
            ...TEST_WORKFLOW_EXECUTION_SNAPSHOT.generationSettings,
            systemPrompt: 'x'.repeat(WORKFLOW_EXECUTION_SNAPSHOT_MAX_BYTES + 1)
          }
        }
      })
    ).toThrow(`exceeds the ${WORKFLOW_EXECUTION_SNAPSHOT_MAX_BYTES}-byte limit`)
  })

  it('releases bounded approval bytes when a token is consumed', () => {
    const registry = new WorkflowLaunchApprovalRegistry(Date.now, 60_000, 4, 8_192)
    const first = registry.prepare(draft({ payload: 'x'.repeat(3_000) }))

    expect(() => registry.prepare(draft({ payload: 'y'.repeat(3_000) }))).toThrow('pending limit')
    registry.consume(first.approvalId)
    expect(registry.prepare(draft({ payload: 'y'.repeat(3_000) })).approvalId).toBeTruthy()
  })

  it('does not reveal or consume an approval through another parent session', () => {
    const registry = new WorkflowLaunchApprovalRegistry()
    const approval = registry.prepare(draft())

    expect(() => registry.get(approval.approvalId, 'other-parent')).toThrow(
      WorkflowLaunchApprovalScopeError
    )
    expect(() => registry.consume(approval.approvalId, 'other-parent')).toThrow(
      WorkflowLaunchApprovalScopeError
    )
    expect(() => registry.revoke(approval.approvalId, 'other-parent')).toThrow(
      WorkflowLaunchApprovalScopeError
    )
    expect(registry.consume(approval.approvalId, 'parent').parentSessionId).toBe('parent')
  })

  it('revokes only the exact parent-scoped pending approval', () => {
    const registry = new WorkflowLaunchApprovalRegistry()
    const approval = registry.prepare(draft())

    expect(registry.revoke(approval.approvalId, 'parent')).toBe(true)
    expect(registry.revoke(approval.approvalId, 'parent')).toBe(false)
    expect(() => registry.get(approval.approvalId, 'parent')).toThrow(
      WorkflowLaunchApprovalExpiredError
    )
  })

  it('treats an expired approval as unavailable when revoking', () => {
    let now = 1_000
    const registry = new WorkflowLaunchApprovalRegistry(() => now, 1_000)
    const approval = registry.prepare(draft())

    now = approval.expiresAt
    expect(registry.revoke(approval.approvalId, 'parent')).toBe(false)
  })

  it('validates the displayed source against the retained launch snapshot', () => {
    const registry = new WorkflowLaunchApprovalRegistry()
    const approval = registry.prepare(draft())

    expect(() => registry.validateSource(approval.approvalId, 'parent', 'return 42')).toThrow(
      WorkflowLaunchApprovalSourceError
    )
    expect(
      registry.validateSource(
        approval.approvalId,
        'parent',
        'return await agent("Inspect the change", { key: "inspect" })'
      ).approvalId
    ).toBe(approval.approvalId)
  })
})
