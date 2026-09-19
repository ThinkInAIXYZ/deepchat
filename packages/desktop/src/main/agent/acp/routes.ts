import {
  acpAuthCancelRoute,
  acpAuthInputRoute,
  acpAuthInspectRoute,
  acpAuthStartRoute,
  acpAuthStatusRoute
} from '@shared/contracts/routes'
import { createRouteMap, requireRendererCaller } from '@/routes/routeRegistry'
import type { AcpAuthService } from './auth/acpAuthService'

export function createAcpRoutes(dependencies: { auth: AcpAuthService }) {
  return createRouteMap([
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
