import {
  orchestrationGetCapabilityRoute,
  orchestrationInspectLiveDelegationRoute,
  orchestrationInterruptLiveDelegationRoute,
  orchestrationListLiveDelegationsRoute,
  orchestrationSetPolicyRoute
} from '@shared/contracts/routes'
import {
  DEFAULT_ORCHESTRATION_POLICY,
  type OrchestrationCapability,
  type OrchestrationPolicy
} from '@shared/orchestration/policy'
import type {
  LiveDelegationDetail,
  LiveDelegationSummary
} from '@shared/orchestration/liveDelegation'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export interface OrchestrationRouteOptions {
  resolveCapability(
    target: { sessionId: string } | { agentId: string }
  ): Promise<OrchestrationCapability>
  getPolicy(sessionId: string): Promise<OrchestrationPolicy>
  setPolicy(sessionId: string, policy: OrchestrationPolicy): Promise<OrchestrationPolicy>
  liveDelegations: {
    list(parentSessionId: string, limit?: number): LiveDelegationSummary[]
    inspect(parentSessionId: string, delegationId: string): LiveDelegationDetail
    interrupt(parentSessionId: string, delegationId: string): Promise<LiveDelegationDetail>
  }
}

export function createOrchestrationRoutes(options: OrchestrationRouteOptions): DeepchatRouteMap {
  return createRouteMap([
    [
      orchestrationGetCapabilityRoute.name,
      async (rawInput) => {
        const input = orchestrationGetCapabilityRoute.input.parse(rawInput)
        return orchestrationGetCapabilityRoute.output.parse({
          capability: await options.resolveCapability(input)
        })
      }
    ],
    [
      orchestrationSetPolicyRoute.name,
      async (rawInput) => {
        const input = orchestrationSetPolicyRoute.input.parse(rawInput)
        const capability = await options.resolveCapability({ sessionId: input.sessionId })
        if (!capability.available && capability.reason === 'session_unavailable') {
          return orchestrationSetPolicyRoute.output.parse({
            applied: false,
            policy: DEFAULT_ORCHESTRATION_POLICY,
            capability
          })
        }
        if (input.policy === 'proactive' && !capability.available) {
          return orchestrationSetPolicyRoute.output.parse({
            applied: false,
            policy: await options.getPolicy(input.sessionId),
            capability
          })
        }
        return orchestrationSetPolicyRoute.output.parse({
          applied: true,
          policy: await options.setPolicy(input.sessionId, input.policy),
          capability
        })
      }
    ],
    [
      orchestrationListLiveDelegationsRoute.name,
      async (rawInput) => {
        const input = orchestrationListLiveDelegationsRoute.input.parse(rawInput)
        return orchestrationListLiveDelegationsRoute.output.parse({
          delegations: options.liveDelegations.list(input.parentSessionId, input.limit)
        })
      }
    ],
    [
      orchestrationInspectLiveDelegationRoute.name,
      async (rawInput) => {
        const input = orchestrationInspectLiveDelegationRoute.input.parse(rawInput)
        return orchestrationInspectLiveDelegationRoute.output.parse({
          delegation: options.liveDelegations.inspect(input.parentSessionId, input.delegationId)
        })
      }
    ],
    [
      orchestrationInterruptLiveDelegationRoute.name,
      async (rawInput) => {
        const input = orchestrationInterruptLiveDelegationRoute.input.parse(rawInput)
        return orchestrationInterruptLiveDelegationRoute.output.parse({
          delegation: await options.liveDelegations.interrupt(
            input.parentSessionId,
            input.delegationId
          )
        })
      }
    ]
  ])
}
