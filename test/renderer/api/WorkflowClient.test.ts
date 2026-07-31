import { describe, expect, it, vi } from 'vitest'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import { createWorkflowClient } from '@api/WorkflowClient'

describe('WorkflowClient', () => {
  it('uses only typed workflow routes and events', async () => {
    const invoke = vi.fn(async (routeName: string) => {
      if (routeName === 'workflow.list') {
        return { runs: [] }
      }
      if (routeName === 'workflow.synthesize') {
        return {
          receipt: {
            runId: 'run-1',
            pendingInputId: 'pending-1',
            state: 'claimed'
          }
        }
      }
      if (routeName === 'workflow.saved.list') {
        return {
          directoryPath: '/repo/.deepchat/workflows',
          workflows: []
        }
      }
      if (routeName === 'workflow.saved.prepareLaunch') {
        return {
          approval: {
            approvalId: '50d6dbb8-45cb-4a76-af9c-9137cb4695ac',
            sourceHash: 'a'.repeat(64),
            scopeHash: 'b'.repeat(64),
            expiresAt: 10_000,
            summary: {
              workspacePath: '/repo',
              capabilityScopeHash: 'c'.repeat(64),
              allowedAgentIds: ['deepchat'],
              maxInvocations: 128,
              maxPendingInvocations: 64,
              budget: null,
              capabilities: ['deepchat-child-sessions'],
              outline: {
                schemaVersion: 1,
                confidence: 'exact',
                truncated: false,
                nodes: []
              }
            }
          }
        }
      }
      throw new Error(`Unexpected route: ${routeName}`)
    })
    const on = vi.fn(() => vi.fn())
    const workflow = createWorkflowClient({ invoke, on } as unknown as DeepchatBridge)

    await expect(workflow.list('parent-1', 20)).resolves.toEqual([])
    await expect(workflow.synthesize('parent-1', 'run-1')).resolves.toEqual({
      runId: 'run-1',
      pendingInputId: 'pending-1',
      state: 'claimed'
    })
    await expect(workflow.listSaved('parent-1')).resolves.toEqual({
      directoryPath: '/repo/.deepchat/workflows',
      workflows: []
    })
    await expect(
      workflow.prepareSavedLaunch('parent-1', {
        name: 'review',
        argsText: '{"scope":"src"}',
        expectedSourceHash: 'd'.repeat(64)
      })
    ).resolves.toMatchObject({
      approvalId: '50d6dbb8-45cb-4a76-af9c-9137cb4695ac'
    })
    const runListener = vi.fn()
    const invocationListener = vi.fn()
    const stopRun = workflow.onRunChanged(runListener)
    const stopInvocation = workflow.onInvocationChanged(invocationListener)

    expect(invoke).toHaveBeenNthCalledWith(1, 'workflow.list', {
      parentSessionId: 'parent-1',
      limit: 20
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'workflow.synthesize', {
      parentSessionId: 'parent-1',
      runId: 'run-1'
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'workflow.saved.list', {
      parentSessionId: 'parent-1'
    })
    expect(invoke).toHaveBeenNthCalledWith(4, 'workflow.saved.prepareLaunch', {
      parentSessionId: 'parent-1',
      name: 'review',
      argsText: '{"scope":"src"}',
      expectedSourceHash: 'd'.repeat(64)
    })
    expect(on).toHaveBeenCalledWith('workflow.run.changed', runListener)
    expect(on).toHaveBeenCalledWith('workflow.invocation.changed', invocationListener)
    expect(stopRun).toBeTypeOf('function')
    expect(stopInvocation).toBeTypeOf('function')
  })
})
