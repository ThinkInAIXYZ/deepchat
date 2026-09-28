import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { AcpAgentRuntime } from './instance'
import type { AcpRuntimeOwner } from './client/acpRuntimeOwner'
import {
  acpExtensionsInspectRoute,
  acpRateLimitsRefreshRoute,
  acpTasksListRoute,
  acpTaskControlRoute,
  acpPlanReadRoute,
  acpGoalControlRoute,
  acpHistoryReadRoute,
  acpHistoryImportRoute,
  acpAuthCancelRoute,
  acpElicitationListRoute,
  acpElicitationRespondRoute,
  acpAuthInputRoute,
  acpAuthInspectRoute,
  acpAuthStartRoute,
  acpAuthStatusRoute
} from '@shared/contracts/routes'
import { createRouteMap, requireRendererCaller } from '@/routes/routeRegistry'
import type { AcpAuthService } from './auth/acpAuthService'

export function createAcpRoutes(dependencies: {
  auth: AcpAuthService
  owner: AcpRuntimeOwner
  runtime: AcpAgentRuntime
  importHistory(sessionId: string): Promise<void>
}) {
  const controller = () => dependencies.owner.getOrCreate().sessionController
  return createRouteMap([
    [
      acpHistoryReadRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const { sessionId } = acpHistoryReadRoute.input.parse(rawInput)
        await dependencies.runtime.readHistory(toAppSessionId(sessionId))
        return { read: true }
      }
    ],
    [
      acpHistoryImportRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const { sessionId } = acpHistoryImportRoute.input.parse(rawInput)
        await dependencies.importHistory(sessionId)
        return { imported: true }
      }
    ],
    [
      acpGoalControlRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const input = acpGoalControlRoute.input.parse(rawInput)
        await dependencies.runtime.controlGoal(
          toAppSessionId(input.sessionId),
          input.action,
          input.objective
        )
        return { started: true }
      }
    ],
    [
      acpExtensionsInspectRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const input = acpExtensionsInspectRoute.input.parse(rawInput)
        return {
          state: await controller().getExtensions(toAppSessionId(input.sessionId), input.agentId)
        }
      }
    ],
    [
      acpRateLimitsRefreshRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const { sessionId, ...filters } = acpRateLimitsRefreshRoute.input.parse(rawInput)
        await controller().refreshRateLimits(toAppSessionId(sessionId), filters)
        return { refreshed: true }
      }
    ],
    [
      acpTasksListRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const input = acpTasksListRoute.input.parse(rawInput)
        await controller().listRemoteTasks(toAppSessionId(input.sessionId))
        return { refreshed: true }
      }
    ],
    [
      acpTaskControlRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const input = acpTaskControlRoute.input.parse(rawInput)
        return controller().controlRemoteTask(
          toAppSessionId(input.sessionId),
          input.taskId,
          input.action,
          input.tail
        )
      }
    ],
    [
      acpPlanReadRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const input = acpPlanReadRoute.input.parse(rawInput)
        return controller().readPlanFile(toAppSessionId(input.sessionId), input.planId)
      }
    ],
    [
      acpElicitationListRoute.name,
      async (_input, context) => {
        requireRendererCaller(context)
        const bridge = dependencies.owner.peek()?.processManager.elicitation
        return acpElicitationListRoute.output.parse({
          requests: bridge?.list() ?? [],
          version: bridge?.version ?? 0
        })
      }
    ],
    [
      acpElicitationRespondRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const input = acpElicitationRespondRoute.input.parse(rawInput)
        return {
          resolved:
            (await dependencies.owner.peek()?.processManager.elicitation.respond(input)) ?? false
        }
      }
    ],
    [
      acpAuthInspectRoute.name,
      async (rawInput, context) => {
        const caller = requireRendererCaller(context)
        const input = acpAuthInspectRoute.input.parse(rawInput)
        return acpAuthInspectRoute.output.parse({
          challenge: await dependencies.auth.inspect(
            input.agentId,
            input.workdir,
            caller.webContentsId
          )
        })
      }
    ],
    [
      acpAuthStartRoute.name,
      async (rawInput, context) => {
        const input = acpAuthStartRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        return acpAuthStartRoute.output.parse(
          await dependencies.auth.start(input.challengeId, input.methodId, caller.webContentsId)
        )
      }
    ],
    [
      acpAuthInputRoute.name,
      async (rawInput, context) => {
        const input = acpAuthInputRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        dependencies.auth.write(input.runId, caller.webContentsId, input.data)
        return acpAuthInputRoute.output.parse({ sent: true })
      }
    ],
    [
      acpAuthCancelRoute.name,
      async (rawInput, context) => {
        const input = acpAuthCancelRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        return acpAuthCancelRoute.output.parse({
          cancelled: dependencies.auth.cancel(input.runId, caller.webContentsId)
        })
      }
    ],
    [
      acpAuthStatusRoute.name,
      async (rawInput, context) => {
        const input = acpAuthStatusRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        return acpAuthStatusRoute.output.parse(
          dependencies.auth.getStatus(input.challengeId, caller.webContentsId)
        )
      }
    ]
  ])
}
