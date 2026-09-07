import { describe, expect, it, vi } from 'vitest'
import { createRendererRouteContext } from '@/routes/routeRegistry'
import {
  orchestrationGetCapabilityRoute,
  orchestrationInspectLiveDelegationRoute,
  orchestrationInterruptLiveDelegationRoute,
  orchestrationListLiveDelegationsRoute,
  orchestrationSetPolicyRoute
} from '@shared/contracts/routes'
import { createOrchestrationRoutes } from '@/orchestration/routes'
import type { OrchestrationPolicy } from '@shared/orchestration/policy'

const context = createRendererRouteContext(1, 1)
const liveSummary = {
  schemaVersion: 1 as const,
  id: 'delegation-1',
  parentSessionId: 'parent-1',
  childSessionId: 'child-1',
  slotId: 'reviewer',
  targetAgentId: 'deepchat',
  title: 'Review architecture',
  status: 'idle' as const,
  lastTurnSeq: 1,
  createdAt: 10,
  updatedAt: 20,
  revision: 2,
  summaryPreview: 'Done.',
  errorPreview: null
}

function createLiveDelegations() {
  return {
    list: vi.fn().mockReturnValue([liveSummary]),
    inspect: vi.fn().mockReturnValue({ delegation: liveSummary, turns: [] }),
    interrupt: vi.fn().mockResolvedValue({ delegation: liveSummary, turns: [] })
  }
}

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
    const routes = createOrchestrationRoutes({
      resolveCapability,
      getPolicy,
      setPolicy,
      liveDelegations: createLiveDelegations()
    })
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
    const routes = createOrchestrationRoutes({
      resolveCapability,
      getPolicy,
      setPolicy,
      liveDelegations: createLiveDelegations()
    })
    const updatePolicy = routes.get(orchestrationSetPolicyRoute.name)!

    await expect(
      updatePolicy({ sessionId: 'deleted-session', policy: 'proactive' }, context)
    ).resolves.toEqual({
      applied: false,
      policy: 'explicit',
      capability: { available: false, reason: 'session_unavailable' }
    })
    await expect(
      updatePolicy({ sessionId: 'deleted-session', policy: 'explicit' }, context)
    ).resolves.toEqual({
      applied: false,
      policy: 'explicit',
      capability: { available: false, reason: 'session_unavailable' }
    })
    expect(getPolicy).not.toHaveBeenCalled()
    expect(setPolicy).not.toHaveBeenCalled()
  })

  it('forwards the requested parent identity for live delegation operations', async () => {
    const liveDelegations = createLiveDelegations()
    const routes = createOrchestrationRoutes({
      resolveCapability: vi.fn(),
      getPolicy: vi.fn(),
      setPolicy: vi.fn(),
      liveDelegations
    })

    await expect(
      routes.get(orchestrationListLiveDelegationsRoute.name)!(
        {
          parentSessionId: 'parent-1',
          limit: 20
        },
        context
      )
    ).resolves.toEqual({ delegations: [liveSummary] })
    await expect(
      routes.get(orchestrationInspectLiveDelegationRoute.name)!(
        {
          parentSessionId: 'parent-1',
          delegationId: 'delegation-1'
        },
        context
      )
    ).resolves.toEqual({ delegation: { delegation: liveSummary, turns: [] } })
    await expect(
      routes.get(orchestrationInterruptLiveDelegationRoute.name)!(
        {
          parentSessionId: 'parent-1',
          delegationId: 'delegation-1'
        },
        context
      )
    ).resolves.toEqual({ delegation: { delegation: liveSummary, turns: [] } })

    expect(liveDelegations.list).toHaveBeenCalledWith('parent-1', 20)
    expect(liveDelegations.inspect).toHaveBeenCalledWith('parent-1', 'delegation-1')
    expect(liveDelegations.interrupt).toHaveBeenCalledWith('parent-1', 'delegation-1')
  })
})
