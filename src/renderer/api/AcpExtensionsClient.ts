import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  acpElicitationChangedEvent,
  acpExtensionsChangedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import {
  acpElicitationListRoute,
  acpElicitationRespondRoute,
  acpExtensionsInspectRoute,
  acpRateLimitsRefreshRoute,
  acpTasksListRoute,
  acpTaskControlRoute,
  acpGoalControlRoute,
  acpHistoryReadRoute,
  acpHistoryImportRoute
} from '@shared/contracts/routes'
import type { AcpElicitationDecision } from '@shared/types/acp-elicitation'
import { getDeepchatBridge } from './core'

export function createAcpExtensionsClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  return {
    inspect: (sessionId: string, agentId: string) =>
      bridge.invoke(acpExtensionsInspectRoute.name, { sessionId, agentId }),
    refreshRateLimits: (sessionId: string) =>
      bridge.invoke(acpRateLimitsRefreshRoute.name, { sessionId }),
    listTasks: (sessionId: string) => bridge.invoke(acpTasksListRoute.name, { sessionId }),
    controlTask: (sessionId: string, taskId: string, action: 'output' | 'cancel') =>
      bridge.invoke(acpTaskControlRoute.name, { sessionId, taskId, action }),
    readHistory: (sessionId: string) => bridge.invoke(acpHistoryReadRoute.name, { sessionId }),
    importHistory: (sessionId: string) => bridge.invoke(acpHistoryImportRoute.name, { sessionId }),
    controlGoal: (
      sessionId: string,
      action: 'set' | 'pause' | 'resume' | 'clear',
      objective?: string
    ) => bridge.invoke(acpGoalControlRoute.name, { sessionId, action, objective }),
    onExtensionsChanged: (
      listener: (event: DeepchatEventPayload<typeof acpExtensionsChangedEvent.name>) => void
    ) => bridge.on(acpExtensionsChangedEvent.name, listener),
    listElicitations: () => bridge.invoke(acpElicitationListRoute.name, {}),
    respond: (decision: AcpElicitationDecision) =>
      bridge.invoke(
        acpElicitationRespondRoute.name,
        acpElicitationRespondRoute.input.parse(decision)
      ),
    onElicitationChanged: (listener: () => void) =>
      bridge.on(acpElicitationChangedEvent.name, listener)
  }
}
