import { describe, expect, it } from 'vitest'
import type { WorkflowInvocation, WorkflowRun } from '@shared/workflow/domain'
import { WORKFLOW_RUNTIME_DEFAULT_LIMITS } from '@shared/workflow/runtimeProtocol'
import {
  WORKFLOW_PROMPT_PREVIEW_MAX_BYTES,
  WORKFLOW_VALUE_PREVIEW_MAX_BYTES
} from '@shared/workflow/projection'
import {
  projectWorkflowInvocation,
  projectWorkflowRunDetail,
  projectWorkflowRunSummary
} from '@/workflow/projection'

function createRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    parentSessionId: 'parent-1',
    parentMessageId: null,
    namedWorkflowPath: null,
    workspacePath: '/repo',
    capabilityScopeHash: 'c'.repeat(64),
    scriptSource: `return "${'secret'.repeat(10_000)}"`,
    scriptHash: 'a'.repeat(64),
    input: { privateInput: 'not projected' },
    runtimeApiVersion: 1,
    limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
    allowedAgentIds: ['deepchat'],
    policyHash: 'b'.repeat(64),
    budget: null,
    status: 'running',
    executionEpoch: 1,
    nextInvocationSeq: 2,
    phase: { key: 'review' },
    result: null,
    error: null,
    usage: null,
    cancellationReason: null,
    interruptionReason: null,
    invalidatedFromSeq: null,
    resultDeliveryState: 'not_ready',
    resultDeliveryId: null,
    createdAt: 1,
    startedAt: 2,
    updatedAt: 3,
    completedAt: null,
    revision: 2,
    ...overrides
  }
}

function createInvocation(overrides: Partial<WorkflowInvocation> = {}): WorkflowInvocation {
  return {
    id: 'invocation-1',
    runId: 'run-1',
    seq: 1,
    callPath: 'root/review',
    attempt: 1,
    executionEpoch: 1,
    request: {
      callPath: 'root/review',
      prompt: '请'.repeat(10_000),
      options: {
        key: 'review',
        label: 'Review',
        phase: 'review'
      }
    },
    inputHash: 'c'.repeat(64),
    policyHash: 'b'.repeat(64),
    childCorrelationSlot: 'workflow-run-1-invocation-1',
    childSessionId: null,
    status: 'running',
    timeoutDeadlineAt: null,
    result: null,
    error: null,
    effectState: 'none',
    effectEvidence: null,
    usage: null,
    tapeLinkReceipt: null,
    invalidatedAt: null,
    invalidationReason: null,
    createdAt: 2,
    startedAt: 3,
    updatedAt: 3,
    completedAt: null,
    ...overrides
  }
}

describe('workflow renderer projections', () => {
  it('never projects immutable source or launch input', () => {
    const run = createRun()
    const summary = projectWorkflowRunSummary(run, [])
    const detail = projectWorkflowRunDetail(run, [])
    const serialized = JSON.stringify({ summary, detail })

    expect(serialized).not.toContain('privateInput')
    expect(serialized).not.toContain('secretsecret')
    expect(summary.invocationCounts.running).toBe(0)
  })

  it('bounds prompt and result previews by UTF-8 bytes', () => {
    const childSessionId = 'child-1'
    const invocation = createInvocation({
      childSessionId,
      status: 'succeeded',
      result: { text: '结'.repeat(20_000) },
      tapeLinkReceipt: {
        linkEntry: { sessionId: 'parent-1', entryId: 1 },
        childSessionId,
        childHeadEntryId: 1,
        childEntryCount: 1,
        outcome: 'completed'
      },
      completedAt: 4
    })

    const projection = projectWorkflowInvocation(invocation)

    expect(Buffer.byteLength(projection.promptPreview.text, 'utf8')).toBeLessThanOrEqual(
      WORKFLOW_PROMPT_PREVIEW_MAX_BYTES
    )
    expect(Buffer.byteLength(projection.resultPreview!.text, 'utf8')).toBeLessThanOrEqual(
      WORKFLOW_VALUE_PREVIEW_MAX_BYTES
    )
    expect(projection.promptPreview.truncated).toBe(true)
    expect(projection.resultPreview?.truncated).toBe(true)
    expect(projection.resultPreview?.byteLength).toBeGreaterThan(WORKFLOW_VALUE_PREVIEW_MAX_BYTES)
    expect(projection.waitingInteractions).toEqual([])
  })

  it('projects interaction summaries only as bounded metadata', () => {
    const projection = projectWorkflowInvocation(
      createInvocation({
        childSessionId: 'child-1',
        status: 'waiting_interaction'
      }),
      [
        {
          kind: 'question',
          messageId: 'message-1',
          toolCallId: 'question-1',
          toolName: 'ask_user',
          label: 'Choose an implementation.'
        }
      ]
    )

    expect(projection.waitingInteractions).toEqual([
      expect.objectContaining({
        kind: 'question',
        toolCallId: 'question-1'
      })
    ])
  })

  it('counts every durable invocation status explicitly', () => {
    const summary = projectWorkflowRunSummary(createRun(), [
      createInvocation(),
      createInvocation({
        id: 'invocation-2',
        seq: 2,
        callPath: 'root/done',
        request: {
          callPath: 'root/done',
          prompt: 'done',
          options: { key: 'done' }
        },
        status: 'cancelled',
        error: {
          code: 'CANCELLED',
          message: 'cancelled',
          retriable: true
        },
        completedAt: 5
      })
    ])

    expect(summary.invocationCounts.running).toBe(1)
    expect(summary.invocationCounts.cancelled).toBe(1)
    expect(summary.invocationCounts.succeeded).toBe(0)
  })
})
