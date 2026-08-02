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
})
