import {
  orchestrationGetCapabilityRoute,
  orchestrationSetPolicyRoute
} from '@shared/contracts/routes'
import {
  DEFAULT_ORCHESTRATION_POLICY,
  type OrchestrationCapability,
  type OrchestrationPolicy
} from '@shared/workflow/orchestrationPolicy'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export interface OrchestrationRouteOptions {
  resolveCapability(
    target: { sessionId: string } | { agentId: string }
  ): Promise<OrchestrationCapability>
  getPolicy(sessionId: string): Promise<OrchestrationPolicy>
  setPolicy(sessionId: string, policy: OrchestrationPolicy): Promise<OrchestrationPolicy>
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
        if (input.policy === 'proactive' && !capability.available) {
          return orchestrationSetPolicyRoute.output.parse({
            applied: false,
            policy:
              capability.reason === 'session_unavailable'
                ? DEFAULT_ORCHESTRATION_POLICY
                : await options.getPolicy(input.sessionId),
            capability
          })
        }
        return orchestrationSetPolicyRoute.output.parse({
          applied: true,
          policy: await options.setPolicy(input.sessionId, input.policy),
          capability
        })
      }
    ]
  ])
}
