import { describe, expect, it, vi } from 'vitest'
import {
  WORKFLOW_RUNTIME_API_VERSION,
  WORKFLOW_RUNTIME_DEFAULT_LIMITS,
  WORKFLOW_RUNTIME_PROTOCOL_VERSION,
  type WorkflowRuntimeEvent
} from '@shared/workflow/runtimeProtocol'
import { WorkflowUtilityHost } from '@/workflow/runtime/workflowUtilityHost'

async function waitForEvent(
  events: WorkflowRuntimeEvent[],
  type: WorkflowRuntimeEvent['type']
): Promise<WorkflowRuntimeEvent> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const event = events.find((candidate) => candidate.type === type)
    if (event) {
      return event
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error(`Timed out waiting for workflow event ${type}.`)
}

describe('WorkflowUtilityHost', () => {
  it('executes one run through wrapped parent-port messages', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const terminate = vi.fn()
    const host = new WorkflowUtilityHost({
      postMessage: (event) => events.push(event),
      terminate
    })

    host.handleMessage({
      data: {
        type: 'START',
        protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
        runtimeApiVersion: WORKFLOW_RUNTIME_API_VERSION,
        runId: 'run-host',
        source: "return await agent('inspect', { key: 'inspect' })",
        input: null,
        limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS
      }
    })

    await waitForEvent(events, 'READY')
    const invocation = (await waitForEvent(events, 'INVOKE_AGENT')) as Extract<
      WorkflowRuntimeEvent,
      { type: 'INVOKE_AGENT' }
    >
    host.handleMessage({
      type: 'SETTLE_INVOCATION',
      protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
      runId: 'run-host',
      requestId: invocation.requestId,
      outcome: {
        status: 'success',
        value: { verdict: 'ok' }
      }
    })

    await expect(waitForEvent(events, 'COMPLETE')).resolves.toMatchObject({
      value: { verdict: 'ok' }
    })
    expect(terminate).not.toHaveBeenCalled()

    host.handleMessage({
      type: 'SHUTDOWN',
      protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
      runId: 'run-host'
    })
    await vi.waitFor(() => expect(terminate).toHaveBeenCalledWith(0))
  })

  it('fails closed on malformed commands', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const terminate = vi.fn()
    const host = new WorkflowUtilityHost({
      postMessage: (event) => events.push(event),
      terminate
    })

    host.handleMessage({
      type: 'START',
      protocolVersion: 999,
      runId: 'run-invalid'
    })

    expect(events).toEqual([
      expect.objectContaining({
        type: 'FAILED',
        runId: 'run-invalid',
        error: expect.objectContaining({ code: 'WORKFLOW_PROTOCOL_ERROR' })
      })
    ])
    expect(terminate).toHaveBeenCalledWith(1)
  })
})
