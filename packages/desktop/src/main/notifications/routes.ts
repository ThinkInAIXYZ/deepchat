import {
  notificationAcknowledgePresentationRoute,
  notificationRendererReadyRoute
} from '@shared/contracts/routes'
import { createRouteMap, requireRendererCaller } from '@/routes/routeRegistry'

export type NotificationRoutesDependencies = Readonly<{
  rendererReady: (webContentsId: number) => Promise<boolean>
  acknowledgePresentation: (episodeId: string, webContentsId: number) => Promise<boolean>
}>

export const createNotificationRoutes = (dependencies: NotificationRoutesDependencies) =>
  createRouteMap([
    [
      notificationRendererReadyRoute.name,
      async (rawInput, context) => {
        notificationRendererReadyRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        return notificationRendererReadyRoute.output.parse({
          ready: await dependencies.rendererReady(caller.webContentsId)
        })
      }
    ],
    [
      notificationAcknowledgePresentationRoute.name,
      async (rawInput, context) => {
        const input = notificationAcknowledgePresentationRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        return notificationAcknowledgePresentationRoute.output.parse({
          accepted: await dependencies.acknowledgePresentation(
            input.episodeId,
            caller.webContentsId
          )
        })
      }
    ]
  ])
