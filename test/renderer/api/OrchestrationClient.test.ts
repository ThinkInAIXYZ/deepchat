import { describe, expect, it, vi } from 'vitest'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import { createOrchestrationClient } from '@api/OrchestrationClient'

describe('OrchestrationClient', () => {
  it('uses the typed capability and policy routes', async () => {
    const invoke = vi.fn(async (routeName: string) => {
      if (routeName === 'orchestration.getCapability') {
        return { capability: { available: true } }
      }
      if (routeName === 'orchestration.setPolicy') {
        return {
          applied: true,
          policy: 'proactive',
          capability: { available: true }
        }
      }
      throw new Error(`Unexpected route: ${routeName}`)
    })
    const orchestration = createOrchestrationClient({
      invoke,
      on: vi.fn()
    } as unknown as DeepchatBridge)

    await expect(orchestration.getCapability({ agentId: 'deepchat' })).resolves.toEqual({
      available: true
    })
    await expect(orchestration.setPolicy('session-1', 'proactive')).resolves.toEqual({
      applied: true,
      policy: 'proactive',
      capability: { available: true }
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'orchestration.getCapability', {
      agentId: 'deepchat'
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'orchestration.setPolicy', {
      sessionId: 'session-1',
      policy: 'proactive'
    })
  })

  it('uses typed live-delegation routes and event contracts', async () => {
    const summary = {
      schemaVersion: 1,
      id: 'delegation-1',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      slotId: 'reviewer',
      targetAgentId: 'deepchat',
      title: 'Review architecture',
      status: 'idle',
      lastTurnSeq: 1,
      createdAt: 10,
      updatedAt: 20,
      revision: 2,
      summaryPreview: 'Done.',
      errorPreview: null
    }
    const invoke = vi.fn(async (routeName: string) => {
      if (routeName === 'orchestration.liveDelegation.list') {
        return { delegations: [summary] }
      }
      if (
        routeName === 'orchestration.liveDelegation.inspect' ||
        routeName === 'orchestration.liveDelegation.interrupt'
      ) {
        return { delegation: { delegation: summary, turns: [] } }
      }
      throw new Error(`Unexpected route: ${routeName}`)
    })
    const on = vi.fn().mockReturnValue(vi.fn())
    const orchestration = createOrchestrationClient({ invoke, on } as unknown as DeepchatBridge)

    await expect(orchestration.listLiveDelegations('parent-1', 20)).resolves.toEqual([summary])
    await expect(orchestration.inspectLiveDelegation('parent-1', 'delegation-1')).resolves.toEqual({
      delegation: summary,
      turns: []
    })
    await expect(
      orchestration.interruptLiveDelegation('parent-1', 'delegation-1')
    ).resolves.toEqual({ delegation: summary, turns: [] })
    const listener = vi.fn()
    orchestration.onLiveDelegationChanged(listener)

    expect(invoke).toHaveBeenNthCalledWith(1, 'orchestration.liveDelegation.list', {
      parentSessionId: 'parent-1',
      limit: 20
    })
    expect(on).toHaveBeenCalledWith('orchestration.liveDelegation.changed', listener)
  })
})
