import { describe, expect, it } from 'vitest'
import {
  LIVE_DELEGATION_AGENT_TOOL_NAME,
  LIVE_DELEGATION_AGENT_TOOL_SERVER_NAME
} from '@shared/agentTools'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import { parseLiveDelegationSpawnBlock } from '@/lib/liveDelegationToolCall'
import { createChildAgentResultEnvelope } from '@shared/orchestration/resultSafety'

const createDetail = () => ({
  delegation: {
    schemaVersion: 1 as const,
    id: 'delegation-1',
    parentSessionId: 'parent-1',
    childSessionId: 'child-1',
    slotId: 'reviewer',
    targetAgentId: 'deepchat',
    title: 'Review architecture',
    status: 'running' as const,
    lastTurnSeq: 1,
    createdAt: 10,
    updatedAt: 20,
    revision: 2,
    summaryPreview: null,
    errorPreview: null
  },
  turns: []
})

const createBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'tool_call',
  status: 'success',
  timestamp: 1,
  extra: { toolSource: 'agent' },
  ...overrides,
  tool_call: {
    id: 'spawn-1',
    name: LIVE_DELEGATION_AGENT_TOOL_NAME,
    server_name: LIVE_DELEGATION_AGENT_TOOL_SERVER_NAME,
    params: JSON.stringify({
      operation: 'spawn',
      slotId: 'reviewer',
      title: 'Review architecture',
      prompt: 'Inspect module boundaries.'
    }),
    response: JSON.stringify(createChildAgentResultEnvelope('spawn', createDetail())),
    ...(overrides.tool_call ?? {})
  }
})

describe('parseLiveDelegationSpawnBlock', () => {
  it('parses trusted pending and successful spawn projections', () => {
    const pending = createBlock({
      status: 'loading',
      tool_call: { response: '' }
    })
    expect(parseLiveDelegationSpawnBlock(pending)).toEqual({
      slotId: 'reviewer',
      title: 'Review architecture',
      delegation: null
    })

    expect(parseLiveDelegationSpawnBlock(createBlock())).toMatchObject({
      slotId: 'reviewer',
      title: 'Review architecture',
      delegation: {
        id: 'delegation-1',
        childSessionId: 'child-1',
        status: 'running'
      }
    })
  })

  it('rejects spoofed tools and inconsistent response correlation', () => {
    expect(parseLiveDelegationSpawnBlock(createBlock({ extra: { toolSource: 'mcp' } }))).toBeNull()
    expect(
      parseLiveDelegationSpawnBlock(createBlock({ tool_call: { server_name: 'untrusted-mcp' } }))
    ).toBeNull()

    const response = JSON.parse(createBlock().tool_call!.response!)
    response.payload.value.delegation.title = 'Different task'
    response.payload.utf8Bytes = new TextEncoder().encode(
      JSON.stringify(response.payload.value)
    ).byteLength
    expect(
      parseLiveDelegationSpawnBlock(
        createBlock({ tool_call: { response: JSON.stringify(response) } })
      )
    ).toBeNull()
  })

  it('rejects malformed successful responses instead of presenting stale controls', () => {
    expect(
      parseLiveDelegationSpawnBlock(createBlock({ tool_call: { response: '{invalid' } }))
    ).toBeNull()
  })

  it('keeps unreleased legacy titles readable while new spawns use the tighter limit', () => {
    const legacyTitle = 'x'.repeat(100)
    const block = createBlock()
    const params = JSON.parse(block.tool_call!.params!)
    params.title = legacyTitle
    const response = createDetail()
    response.delegation.title = legacyTitle
    block.tool_call!.params = JSON.stringify(params)
    block.tool_call!.response = JSON.stringify(response)

    expect(parseLiveDelegationSpawnBlock(block)?.title).toBe(legacyTitle)
  })
})
