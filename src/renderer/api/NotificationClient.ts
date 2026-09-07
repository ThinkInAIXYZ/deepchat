import type { DeepchatBridge } from '@shared/contracts/bridge'
import { semanticNotificationEvent, type DeepchatEventPayload } from '@shared/contracts/events'
import {
  notificationAcknowledgePresentationRoute,
  notificationRendererReadyRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export const createNotificationClient = (bridge: DeepchatBridge = getDeepchatBridge()) => ({
  onSemanticNotification: (
    listener: (payload: DeepchatEventPayload<typeof semanticNotificationEvent.name>) => void
  ) => bridge.on(semanticNotificationEvent.name, listener),

  notifyRendererReady: async (): Promise<boolean> => {
    const result = await bridge.invoke(notificationRendererReadyRoute.name, {})
    return result.ready
  },

  acknowledgePresentation: async (episodeId: string): Promise<boolean> => {
    const result = await bridge.invoke(notificationAcknowledgePresentationRoute.name, {
      episodeId
    })
    return result.accepted
  }
})

export type NotificationClient = ReturnType<typeof createNotificationClient>
