import {
  notificationAcknowledgePresentationRoute,
  notificationRendererReadyRoute
} from '@shared/contracts/routes'
import { createRouteMap } from '@/routes/routeRegistry'

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
        return notificationRendererReadyRoute.output.parse({
          ready: await dependencies.rendererReady(context.webContentsId)
        })
      }
    ],
    [
      notificationAcknowledgePresentationRoute.name,
      async (rawInput, context) => {
        const input = notificationAcknowledgePresentationRoute.input.parse(rawInput)
        return notificationAcknowledgePresentationRoute.output.parse({
          accepted: await dependencies.acknowledgePresentation(
            input.episodeId,
            context.webContentsId
          )
        })
      }
    ]
  ])
