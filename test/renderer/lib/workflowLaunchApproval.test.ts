import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import { parseWorkflowLaunchApprovalBlock } from '@/lib/workflowLaunchApproval'
import { LEGACY_DEEPCHAT_WORKFLOW_TOOL_NAME, WORKFLOW_AGENT_TOOL_NAME } from '@shared/agentTools'

const source = "return await agent('review', { key: 'review' })"
const sourceHash = createHash('sha256').update(source, 'utf8').digest('hex')

const approval = {
  approvalId: '50d6dbb8-45cb-4a76-af9c-9137cb4695ac',
  sourceHash,
  scopeHash: 'b'.repeat(64),
  expiresAt: Date.now() + 60_000,
  summary: {
    workspacePath: '/repo',
    capabilityScopeHash: 'c'.repeat(64),
    executionSnapshotHash: 'd'.repeat(64),
    allowedAgentIds: ['deepchat'],
    maxInvocations: 8,
    maxPendingInvocations: 4,
    budget: null,
    capabilities: ['deepchat-child-sessions'],
    outline: {
      schemaVersion: 1,
      confidence: 'exact',
      truncated: false,
      nodes: []
    }
  }
} as const

function createBlock(
  overrides: Partial<DisplayAssistantMessageBlock['tool_call']> = {}
): DisplayAssistantMessageBlock {
  return {
    type: 'tool_call',
    status: 'success',
    timestamp: Date.now(),
    extra: {
      toolSource: 'agent'
    },
    tool_call: {
      id: 'tool-1',
      name: WORKFLOW_AGENT_TOOL_NAME,
      server_name: 'agent-workflows',
      params: JSON.stringify({ operation: 'prepare_launch', scriptSource: source }),
      response: JSON.stringify({
        approval,
        nextAction: 'Await native approval.'
      }),
      ...overrides
    }
  }
}

describe('workflowLaunchApproval', () => {
  it('parses only the exact built-in prepare result contract', () => {
    expect(parseWorkflowLaunchApprovalBlock(createBlock())).toEqual({
      approval,
      scriptSource: source
    })
    expect(
      parseWorkflowLaunchApprovalBlock(createBlock({ name: LEGACY_DEEPCHAT_WORKFLOW_TOOL_NAME }))
    ).toEqual({ approval, scriptSource: source })

    expect(
      parseWorkflowLaunchApprovalBlock(createBlock({ server_name: 'untrusted-mcp' }))
    ).toBeNull()
    const mcpBlock = createBlock()
    mcpBlock.extra = { toolSource: 'mcp' }
    expect(parseWorkflowLaunchApprovalBlock(mcpBlock)).toBeNull()
    expect(
      parseWorkflowLaunchApprovalBlock(
        createBlock({ params: JSON.stringify({ operation: 'list', scriptSource: source }) })
      )
    ).toBeNull()
    expect(parseWorkflowLaunchApprovalBlock(createBlock({ response: '{broken' }))).toBeNull()
  })

  it('invalidates its parse cache when a completed block response changes', () => {
    const block = createBlock({ response: '{broken' })
    expect(parseWorkflowLaunchApprovalBlock(block)).toBeNull()

    block.tool_call!.response = createBlock().tool_call!.response
    expect(parseWorkflowLaunchApprovalBlock(block)).toEqual({ approval, scriptSource: source })

    block.extra = { toolSource: 'mcp' }
    expect(parseWorkflowLaunchApprovalBlock(block)).toBeNull()
    block.extra = { toolSource: 'agent' }
    block.type = 'content'
    expect(parseWorkflowLaunchApprovalBlock(block)).toBeNull()
  })
})
