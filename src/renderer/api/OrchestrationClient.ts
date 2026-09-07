import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  orchestrationGetCapabilityRoute,
  orchestrationInspectLiveDelegationRoute,
  orchestrationInterruptLiveDelegationRoute,
  orchestrationListLiveDelegationsRoute,
  orchestrationSetPolicyRoute
} from '@shared/contracts/routes'
import { liveDelegationChangedEvent, type DeepchatEventPayload } from '@shared/contracts/events'
import type { OrchestrationPolicy } from '@shared/orchestration/policy'
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

  async function listLiveDelegations(parentSessionId: string, limit = 100) {
    return orchestrationListLiveDelegationsRoute.output.parse(
      await bridge.invoke(orchestrationListLiveDelegationsRoute.name, {
        parentSessionId,
        limit
      })
    ).delegations
  }

  async function inspectLiveDelegation(parentSessionId: string, delegationId: string) {
    return orchestrationInspectLiveDelegationRoute.output.parse(
      await bridge.invoke(orchestrationInspectLiveDelegationRoute.name, {
        parentSessionId,
        delegationId
      })
    ).delegation
  }

  async function interruptLiveDelegation(parentSessionId: string, delegationId: string) {
    return orchestrationInterruptLiveDelegationRoute.output.parse(
      await bridge.invoke(orchestrationInterruptLiveDelegationRoute.name, {
        parentSessionId,
        delegationId
      })
    ).delegation
  }

  function onLiveDelegationChanged(
    listener: (payload: DeepchatEventPayload<typeof liveDelegationChangedEvent.name>) => void
  ) {
    return bridge.on(liveDelegationChangedEvent.name, listener)
  }

  return {
    getCapability,
    setPolicy,
    listLiveDelegations,
    inspectLiveDelegation,
    interruptLiveDelegation,
    onLiveDelegationChanged
  }
}
