import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  orchestrationGetCapabilityRoute,
  orchestrationSetPolicyRoute
} from '@shared/contracts/routes'
import type { OrchestrationPolicy } from '@shared/workflow/orchestrationPolicy'
import { getDeepchatBridge } from './core'

export function createOrchestrationClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getCapability(target: { sessionId: string } | { agentId: string }) {
    return orchestrationGetCapabilityRoute.output.parse(
      await bridge.invoke(orchestrationGetCapabilityRoute.name, target)
    ).capability
  }

  async function setPolicy(sessionId: string, policy: OrchestrationPolicy) {
    return orchestrationSetPolicyRoute.output.parse(
      await bridge.invoke(orchestrationSetPolicyRoute.name, { sessionId, policy })
    )
  }

  return { getCapability, setPolicy }
}
