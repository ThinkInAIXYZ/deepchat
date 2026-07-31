import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_RUNTIME_API_VERSION,
  WORKFLOW_RUNTIME_DEFAULT_LIMITS,
  WORKFLOW_RUNTIME_PROTOCOL_VERSION,
  WorkflowRuntimeCommandSchema,
  WorkflowRuntimeEventSchema
} from '@shared/workflow/runtimeProtocol'

describe('workflow runtime protocol', () => {
  it('accepts a bounded start command', () => {
    expect(
      WorkflowRuntimeCommandSchema.parse({
        type: 'START',
        protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
        runtimeApiVersion: WORKFLOW_RUNTIME_API_VERSION,
        runId: 'run-1',
        source: 'return input',
        input: { value: 1 },
        limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS
      })
    ).toMatchObject({
      type: 'START',
      runId: 'run-1'
    })
  })

  it('rejects unknown wire fields and incompatible versions', () => {
    const base = {
      type: 'SHUTDOWN',
      protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
      runId: 'run-1'
    }

    expect(WorkflowRuntimeCommandSchema.safeParse({ ...base, extra: true }).success).toBe(false)
    expect(
      WorkflowRuntimeCommandSchema.safeParse({
        ...base,
        protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION + 1
      }).success
    ).toBe(false)
  })

  it('rejects a pending invocation limit above the total limit', () => {
    expect(
      WorkflowRuntimeCommandSchema.safeParse({
        type: 'START',
        protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
        runtimeApiVersion: WORKFLOW_RUNTIME_API_VERSION,
        runId: 'run-1',
        source: 'return null',
        input: null,
        limits: {
          ...WORKFLOW_RUNTIME_DEFAULT_LIMITS,
          maxInvocations: 2,
          maxPendingInvocations: 3
        }
      }).success
    ).toBe(false)
  })

  it('requires plain JSON-shaped event payloads', () => {
    expect(
      WorkflowRuntimeEventSchema.safeParse({
        type: 'COMPLETE',
        protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
        runId: 'run-1',
        value: {
          invalid: () => undefined
        }
      }).success
    ).toBe(false)
  })

  it('allows request IDs derived from the longest valid run ID', () => {
    const runId = `r${'a'.repeat(159)}`
    expect(
      WorkflowRuntimeEventSchema.safeParse({
        type: 'INVOKE_AGENT',
        protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
        runId,
        requestId: `${runId}:256`,
        request: {
          callPath: 'root/agent/task',
          prompt: 'task',
          options: { key: 'task' }
        }
      }).success
    ).toBe(true)
  })
})
