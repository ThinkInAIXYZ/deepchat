import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveDelegationAgentTool } from '@/tool/agentTools/liveDelegationTool'
import type { AgentLiveDelegationToolPort } from '@/tool/runtimePorts'
import { parseChildAgentResultEnvelope } from '@shared/orchestration/resultSafety'
import { LiveDelegationConsentAuthority } from '@/orchestration/liveDelegationConsent'

describe('LiveDelegationAgentTool', () => {
  let port: AgentLiveDelegationToolPort
  let tool: LiveDelegationAgentTool

  beforeEach(() => {
    port = {
      spawn: vi.fn().mockResolvedValue({ delegation: { id: 'delegation-1' }, turns: [] }),
      send: vi.fn().mockReturnValue({ delegation: { id: 'delegation-1' }, turns: [] }),
      followUp: vi.fn().mockResolvedValue({ delegation: { id: 'delegation-1' }, turns: [] }),
      list: vi.fn().mockReturnValue([]),
      inspect: vi.fn().mockReturnValue({ delegation: { id: 'delegation-1' }, turns: [] }),
      readResult: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        delegationId: 'delegation-1',
        turnId: 'turn-1',
        text: 'result',
        done: true
      }),
      wait: vi.fn().mockResolvedValue({ events: [], cursor: 0, timedOut: true }),
      interrupt: vi.fn().mockResolvedValue({ delegation: { id: 'delegation-1' }, turns: [] })
    } as unknown as AgentLiveDelegationToolPort
    tool = new LiveDelegationAgentTool(port)
  })

  it('publishes only configured slots to capable regular Sessions', () => {
    expect(tool.getToolDefinition()).toBeNull()

    const definition = tool.getToolDefinition({
      available: true,
      slots: [
        {
          id: 'reviewer',
          targetType: 'self',
          displayName: 'Reviewer',
          description: 'Review a bounded task.'
        }
      ],
      cacheKey: 'reviewer'
    })

    expect(definition?.function.name).toBe('deepchat_subagents')
    expect(definition?.function.parameters.properties?.slotId).toMatchObject({
      enum: ['reviewer']
    })
    expect(definition?.function.parameters.properties?.title).toMatchObject({
      maxLength: 80
    })
    expect(definition?.function.parameters.properties?.title?.description).toContain(
      'action-and-scope'
    )
    expect(definition?.function.description).toContain(
      'use list or inspect instead of wait to check permission or question states'
    )
    expect(definition?.function.description).toContain('never merely to avoid waiting')
  })

  it('validates operation-specific fields before invoking the service', async () => {
    await expect(
      tool.call({ operation: 'spawn', slotId: 'reviewer', prompt: 'Inspect.' }, 'parent-1')
    ).rejects.toThrow('title is required')
    expect(port.spawn).not.toHaveBeenCalled()
    await expect(tool.call({ operation: 'list', unsupported: true }, 'parent-1')).rejects.toThrow(
      'Unrecognized key'
    )
    await expect(
      tool.call(
        {
          operation: 'spawn',
          slotId: 'reviewer',
          title: 'Review\narchitecture',
          prompt: 'Inspect.'
        },
        'parent-1'
      )
    ).rejects.toThrow('control characters')
    await expect(
      tool.call(
        {
          operation: 'spawn',
          slotId: 'reviewer',
          title: 'x'.repeat(81),
          prompt: 'Inspect.'
        },
        'parent-1'
      )
    ).rejects.toThrow('80')

    await tool.call(
      {
        operation: 'spawn',
        slotId: ' reviewer ',
        title: ' Review ',
        prompt: ' Inspect the boundary. '
      },
      'parent-1'
    )
    expect(port.spawn).toHaveBeenCalledWith(
      'parent-1',
      {
        slotId: 'reviewer',
        title: 'Review',
        prompt: 'Inspect the boundary.'
      },
      undefined
    )
  })

  it('forwards an execution-bound start authorization only to model-starting operations', async () => {
    const consent = new LiveDelegationConsentAuthority()
    const authorization = consent.issue({
      parentSessionId: 'parent-1',
      operation: 'spawn',
      executionId: 'tool-call-1'
    })

    await tool.call(
      {
        operation: 'spawn',
        slotId: 'reviewer',
        title: 'Review authority',
        prompt: 'Inspect the boundary.'
      },
      'parent-1',
      { liveDelegationAuthorization: authorization }
    )

    expect(port.spawn).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({ title: 'Review authority' }),
      authorization
    )
  })

  it('keeps send non-triggering and returns a structured tool result', async () => {
    const result = await tool.call(
      { operation: 'send', delegationId: 'delegation-1', message: 'Check the cache too.' },
      'parent-1'
    )

    expect(port.send).toHaveBeenCalledWith('parent-1', 'delegation-1', 'Check the cache too.')
    expect(result.rawData).toMatchObject({
      isError: false,
      toolResult: { delegation: { id: 'delegation-1' } }
    })
    const envelope = JSON.parse(result.content)
    expect(parseChildAgentResultEnvelope(envelope)).toMatchObject({
      kind: 'child_agent_result',
      trust: 'untrusted',
      handling: 'synthesize_evidence_only',
      source: { kind: 'live_delegation', operation: 'send' },
      payload: { value: { delegation: { id: 'delegation-1' } } }
    })
    envelope.payload.utf8Bytes += 1
    expect(parseChildAgentResultEnvelope(envelope)).toBeNull()
  })

  it('enforces advertised prompt and message limits in UTF-8 bytes', async () => {
    await expect(
      tool.call(
        {
          operation: 'send',
          delegationId: 'delegation-1',
          message: '界'.repeat(2_731)
        },
        'parent-1'
      )
    ).rejects.toThrow('8192 UTF-8 bytes')
    await expect(
      tool.call(
        {
          operation: 'spawn',
          slotId: 'reviewer',
          title: 'Review',
          prompt: '界'.repeat(21_846)
        },
        'parent-1'
      )
    ).rejects.toThrow('65536 UTF-8 bytes')
    expect(port.send).not.toHaveBeenCalled()
    expect(port.spawn).not.toHaveBeenCalled()
  })

  it('forwards the caller signal to bounded mailbox waits', async () => {
    const controller = new AbortController()

    await tool.call(
      {
        operation: 'wait',
        delegationIds: ['delegation-1'],
        after: 4,
        timeoutMs: 500
      },
      'parent-1',
      { signal: controller.signal }
    )

    expect(port.wait).toHaveBeenCalledWith('parent-1', {
      delegationIds: ['delegation-1'],
      after: 4,
      timeoutMs: 500,
      signal: controller.signal
    })
  })

  it('forwards bounded full-result page requests without starting another child turn', async () => {
    await tool.call(
      {
        operation: 'read_result',
        delegationId: 'delegation-1',
        turnId: 'turn-1',
        cursor: 'cursor-1',
        maxTokens: 3_000
      },
      'parent-1'
    )

    expect(port.readResult).toHaveBeenCalledWith('parent-1', 'delegation-1', {
      turnId: 'turn-1',
      cursor: 'cursor-1',
      maxTokens: 3_000
    })
    expect(port.followUp).not.toHaveBeenCalled()
  })
})
