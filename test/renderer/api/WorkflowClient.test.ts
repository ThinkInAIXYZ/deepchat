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
    const listener = vi.fn()
    const stop = workflow.onRunChanged(listener)

    expect(invoke).toHaveBeenNthCalledWith(1, 'workflow.list', {
      parentSessionId: 'parent-1',
      limit: 20
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'workflow.synthesize', {
      parentSessionId: 'parent-1',
      runId: 'run-1'
    })
    expect(on).toHaveBeenCalledWith('workflow.run.changed', listener)
    expect(stop).toBeTypeOf('function')
  })
})
