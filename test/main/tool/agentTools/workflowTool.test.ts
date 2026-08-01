import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowAgentTool, workflowAgentToolSchema } from '@/tool/agentTools/workflowTool'
import type { AgentWorkflowToolPort } from '@/tool/runtimePorts'

describe('WorkflowAgentTool', () => {
  let port: AgentWorkflowToolPort
  let tool: WorkflowAgentTool

  beforeEach(() => {
    port = {
      canUse: vi.fn().mockResolvedValue(true),
      prepareLaunch: vi.fn().mockResolvedValue({
        approvalId: '50d6dbb8-45cb-4a76-af9c-9137cb4695ac',
        sourceHash: 'a'.repeat(64),
        scopeHash: 'b'.repeat(64),
        expiresAt: 10_000,
        summary: {
          workspacePath: '/repo',
          capabilityScopeHash: 'c'.repeat(64),
          executionSnapshotHash: 'd'.repeat(64),
          allowedAgentIds: ['deepchat', 'reviewer'],
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
      }),
      list: vi.fn().mockResolvedValue([]),
      inspect: vi.fn().mockResolvedValue({ id: 'run-1' }),
      cancel: vi.fn().mockResolvedValue({ id: 'run-1' }),
      resume: vi.fn().mockResolvedValue({ id: 'run-1' }),
      retry: vi.fn().mockResolvedValue({ id: 'run-1' })
    } as unknown as AgentWorkflowToolPort
    tool = new WorkflowAgentTool(port)
  })

  it('requires the two-step launch contract', async () => {
    expect(
      workflowAgentToolSchema.safeParse({
        operation: 'prepare_launch'
      }).success
    ).toBe(false)
    expect(
      workflowAgentToolSchema.safeParse({
        operation: 'launch',
        approvalId: '50d6dbb8-45cb-4a76-af9c-9137cb4695ac'
      }).success
    ).toBe(false)

    const prepared = await tool.call(
      {
        operation: 'prepare_launch',
        scriptSource: 'return input',
        input: { task: 'review' },
        allowedAgentIds: ['reviewer']
      },
      'parent-1'
    )

    expect(port.prepareLaunch).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        scriptSource: 'return input',
        input: { task: 'review' },
        allowedAgentIds: ['reviewer']
      })
    )
    expect(prepared.content).toContain('native approval card')

    const operationSchema = tool.getToolDefinition().function.parameters.properties?.operation as {
      enum?: string[]
    }
    expect(operationSchema.enum).not.toContain('launch')
  })

  it('keeps launch out of the model-facing operation contract', async () => {
    expect(tool.getToolDefinition().function.parameters.properties?.operation).toMatchObject({
      enum: expect.not.arrayContaining(['launch'])
    })
    expect(
      await tool.getMutationPermissionDescription({ operation: 'list' }, 'parent-1')
    ).toBeNull()
  })

  it('routes only current-session actions and rechecks availability', async () => {
    await tool.call(
      {
        operation: 'retry',
        runId: 'run-1',
        invocationId: 'invocation-1',
        fromHere: true,
        confirmEffects: true
      },
      'parent-1'
    )

    expect(port.canUse).toHaveBeenCalledWith('parent-1')
    expect(port.retry).toHaveBeenCalledWith('parent-1', {
      runId: 'run-1',
      invocationId: 'invocation-1',
      fromHere: true,
      confirmEffects: true
    })

    vi.mocked(port.canUse).mockResolvedValue(false)
    await expect(tool.call({ operation: 'list' }, 'parent-1')).rejects.toThrow(
      'unavailable for the current session'
    )
  })

  it('returns a completed mutation even if its caller aborts after the side effect', async () => {
    const controller = new AbortController()
    vi.mocked(port.cancel).mockImplementation(async () => {
      controller.abort('caller stopped after cancel')
      return { id: 'run-1' } as any
    })

    await expect(
      tool.call(
        {
          operation: 'cancel',
          runId: 'run-1'
        },
        'parent-1',
        { signal: controller.signal }
      )
    ).resolves.toMatchObject({
      rawData: {
        toolResult: {
          run: { id: 'run-1' }
        }
      }
    })
    expect(port.cancel).toHaveBeenCalledOnce()
  })
})
