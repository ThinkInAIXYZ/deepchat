import { describe, expect, it, vi } from 'vitest'
import {
  orchestrationGetCapabilityRoute,
  orchestrationSetPolicyRoute
} from '@shared/contracts/routes'
import { createOrchestrationRoutes } from '@/orchestration/routes'
import type { OrchestrationPolicy } from '@shared/workflow/orchestrationPolicy'

const context = { webContentsId: 1, windowId: 1 }

describe('orchestration routes', () => {
  it('queries capability and enables proactive policy only when allowed', async () => {
    const resolveCapability = vi.fn().mockResolvedValue({
      available: false,
      reason: 'subagents_disabled'
    })
    const getPolicy = vi.fn().mockResolvedValue('explicit')
    const setPolicy = vi.fn(
      async (_sessionId: string, policy: OrchestrationPolicy): Promise<OrchestrationPolicy> =>
        policy
    )
    const routes = createOrchestrationRoutes({ resolveCapability, getPolicy, setPolicy })
    const getCapability = routes.get(orchestrationGetCapabilityRoute.name)!
    const updatePolicy = routes.get(orchestrationSetPolicyRoute.name)!

    await expect(getCapability({ agentId: 'deepchat' }, context)).resolves.toEqual({
      capability: { available: false, reason: 'subagents_disabled' }
    })
    expect(resolveCapability).toHaveBeenLastCalledWith({ agentId: 'deepchat' })

    await expect(
      updatePolicy({ sessionId: 'parent-1', policy: 'proactive' }, context)
    ).resolves.toEqual({
      applied: false,
      policy: 'explicit',
      capability: { available: false, reason: 'subagents_disabled' }
    })
    expect(setPolicy).not.toHaveBeenCalled()

    await expect(
      updatePolicy({ sessionId: 'parent-1', policy: 'explicit' }, context)
    ).resolves.toEqual({
      applied: true,
      policy: 'explicit',
      capability: { available: false, reason: 'subagents_disabled' }
    })
    expect(setPolicy).toHaveBeenCalledWith('parent-1', 'explicit')

    resolveCapability.mockResolvedValueOnce({ available: true })
    await expect(
      updatePolicy({ sessionId: 'parent-1', policy: 'proactive' }, context)
    ).resolves.toEqual({
      applied: true,
      policy: 'proactive',
      capability: { available: true }
    })
    expect(setPolicy).toHaveBeenLastCalledWith('parent-1', 'proactive')
  })

  it('returns a stable rejection when the target session disappears', async () => {
    const resolveCapability = vi.fn().mockResolvedValue({
      available: false,
      reason: 'session_unavailable'
    })
    const getPolicy = vi.fn().mockRejectedValue(new Error('Session not found'))
    const setPolicy = vi.fn()
    const routes = createOrchestrationRoutes({ resolveCapability, getPolicy, setPolicy })
    const updatePolicy = routes.get(orchestrationSetPolicyRoute.name)!

    await expect(
      updatePolicy({ sessionId: 'deleted-session', policy: 'proactive' }, context)
    ).resolves.toEqual({
      applied: false,
      policy: 'explicit',
      capability: { available: false, reason: 'session_unavailable' }
    })
    expect(getPolicy).not.toHaveBeenCalled()
    expect(setPolicy).not.toHaveBeenCalled()
  })
})
