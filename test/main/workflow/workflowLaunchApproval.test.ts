import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@shared/contracts/common'
import { WORKFLOW_DEFAULT_EXECUTION_TIMEOUT_MS } from '@shared/workflow/serviceContracts'
import {
  WorkflowLaunchApprovalExpiredError,
  WorkflowLaunchApprovalScopeError,
  WorkflowLaunchApprovalRegistry
} from '@/workflow/launchApproval'

function draft(input: JsonValue = null) {
  return {
    parentSessionId: 'parent',
    parentMessageId: null,
    namedWorkflowPath: null,
    workspacePath: '/repo',
    capabilityScopeHash: 'a'.repeat(64),
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

    expect(first.sourceHash).toBe(same.sourceHash)
    expect(first.scopeHash).toBe(same.scopeHash)
    expect(differentInput.sourceHash).toBe(first.sourceHash)
    expect(differentInput.scopeHash).not.toBe(first.scopeHash)
    expect(differentParentMessage.scopeHash).not.toBe(first.scopeHash)
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

  it('releases bounded approval bytes when a token is consumed', () => {
    const registry = new WorkflowLaunchApprovalRegistry(Date.now, 60_000, 4, 1_024)
    const first = registry.prepare(draft({ payload: 'x'.repeat(700) }))

    expect(() => registry.prepare(draft({ payload: 'y'.repeat(700) }))).toThrow('pending limit')
    registry.consume(first.approvalId)
    expect(registry.prepare(draft({ payload: 'y'.repeat(700) })).approvalId).toBeTruthy()
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
    expect(registry.consume(approval.approvalId, 'parent').parentSessionId).toBe('parent')
  })
})
