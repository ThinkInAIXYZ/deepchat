import { describe, expect, it, vi } from 'vitest'
import {
  WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME,
  WorkflowStructuredOutputRegistry
} from '@/workflow/structuredOutput/registry'

const schema = {
  type: 'object',
  properties: {
    answer: {
      type: 'string',
      minLength: 1
    }
  },
  required: ['answer'],
  additionalProperties: false
} as const

function openLease(
  registry: WorkflowStructuredOutputRegistry,
  providerId = 'openai',
  childSessionId = 'child-1'
) {
  return registry.prepare({ schema, maxResultBytes: 4_096 }).open({
    runId: 'run-1',
    invocationId: 'invocation-1',
    childSessionId,
    providerId
  })
}

function toolCall(argumentsJson: string, id = 'call-1') {
  return {
    id,
    type: 'function',
    function: {
      name: WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME,
      arguments: argumentsJson
    },
    conversationId: 'child-1'
  }
}

describe('WorkflowStructuredOutputRegistry', () => {
  it('returns an empty catalog for invalid conversation identifiers', () => {
    const registry = new WorkflowStructuredOutputRegistry({ onCatalogChanged: vi.fn() })

    expect(registry.getToolDefinitions('   ')).toEqual([])
    expect(registry.getToolDefinitions('x'.repeat(257))).toEqual([])
  })

  it('publishes one invocation-scoped tool and accepts a validated result', async () => {
    const onCatalogChanged = vi.fn()
    const registry = new WorkflowStructuredOutputRegistry({ onCatalogChanged })
    const lease = openLease(registry)

    expect(onCatalogChanged).toHaveBeenCalledOnce()
    expect(onCatalogChanged).toHaveBeenLastCalledWith('child-1')
    expect(registry.getToolDefinitions('child-1')).toEqual([
      expect.objectContaining({
        function: expect.objectContaining({
          name: WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME,
          parameters: expect.objectContaining({
            type: 'object',
            additionalProperties: false
          })
        })
      })
    ])
    await expect(registry.callTool(toolCall('{"answer":"Done"}'))).resolves.toMatchObject({
      rawData: {
        isError: false,
        content: 'Workflow result accepted.'
      }
    })
    await expect(lease.result).resolves.toEqual({ answer: 'Done' })
    expect(lease.completeTurn('ignored prose')).toBeNull()

    lease.close()
    expect(registry.getToolDefinitions('child-1')).toEqual([])
    expect(onCatalogChanged).toHaveBeenCalledTimes(2)
    expect(onCatalogChanged).toHaveBeenLastCalledWith('child-1')
  })

  it('returns bounded correction feedback and rejects after the third invalid tool call', async () => {
    const registry = new WorkflowStructuredOutputRegistry({
      onCatalogChanged: vi.fn()
    })
    const lease = openLease(registry)
    void lease.result.catch(() => undefined)

    await expect(registry.callTool(toolCall('{"answer":42}', 'call-1'))).resolves.toMatchObject({
      rawData: {
        isError: true,
        content: expect.stringContaining('rejected (1/3)')
      }
    })
    await expect(registry.callTool(toolCall('not-json', 'call-2'))).resolves.toMatchObject({
      rawData: {
        isError: true,
        content: expect.stringContaining('rejected (2/3)')
      }
    })
    const exhausted = await registry.callTool(toolCall('{}', 'call-3'))
    expect(exhausted).toMatchObject({
      rawData: {
        isError: true,
        content: expect.stringContaining('attempt limit was exhausted'),
        toolResult: {
          ok: false,
          error: {
            recoverable: false
          }
        }
      }
    })
    await expect(lease.result).rejects.toMatchObject({
      code: 'STRUCTURED_OUTPUT_EXHAUSTED',
      retriable: false
    })
  })

  it('uses bounded exact-JSON correction turns for ACP-backed DeepChat children', async () => {
    const onCatalogChanged = vi.fn()
    const registry = new WorkflowStructuredOutputRegistry({ onCatalogChanged })
    const lease = openLease(registry, 'acp')

    expect(registry.getToolDefinitions('child-1')).toEqual([])
    expect(onCatalogChanged).not.toHaveBeenCalled()
    expect(lease.completeTurn('```json\n{"answer":"Done"}\n```')).toContain('rejected (1/3)')
    expect(lease.completeTurn('{"answer":42}')).toContain('rejected (2/3)')
    expect(lease.completeTurn('{"answer":"Done"}')).toBeNull()
    await expect(lease.result).resolves.toEqual({ answer: 'Done' })
    lease.close()
    expect(onCatalogChanged).not.toHaveBeenCalled()
  })

  it('removes a pending tool and rejects its result when the lease closes', async () => {
    const onCatalogChanged = vi.fn()
    const registry = new WorkflowStructuredOutputRegistry({ onCatalogChanged })
    const lease = openLease(registry)

    lease.close()

    await expect(lease.result).rejects.toMatchObject({
      code: 'STRUCTURED_OUTPUT_CLOSED'
    })
    expect(registry.getToolDefinitions('child-1')).toEqual([])
    expect(onCatalogChanged).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid schemas before registering any child tool', () => {
    const onCatalogChanged = vi.fn()
    const registry = new WorkflowStructuredOutputRegistry({ onCatalogChanged })

    expect(() =>
      registry.prepare({
        schema: {
          type: 'object',
          properties: {},
          additionalProperties: true
        },
        maxResultBytes: 4_096
      })
    ).toThrow('"additionalProperties" at $ must be false')
    expect(onCatalogChanged).not.toHaveBeenCalled()
  })

  it('rolls back tool registration when catalog invalidation fails during open', () => {
    const registry = new WorkflowStructuredOutputRegistry({
      onCatalogChanged: vi.fn(() => {
        throw new Error('catalog unavailable')
      })
    })
    const prepared = registry.prepare({ schema, maxResultBytes: 4_096 })

    expect(() =>
      prepared.open({
        runId: 'run-1',
        invocationId: 'invocation-1',
        childSessionId: 'child-1',
        providerId: 'openai'
      })
    ).toThrow('catalog unavailable')
    expect(registry.getToolDefinitions('child-1')).toEqual([])
  })
})
