import { z } from 'zod'
import { defineRouteContract } from '../common'

export const notificationRendererReadyRoute = defineRouteContract({
  name: 'notification.rendererReady',
  input: z.object({}).default({}),
  output: z.object({
    ready: z.boolean()
  })
})

export const notificationAcknowledgePresentationRoute = defineRouteContract({
  name: 'notification.acknowledgePresentation',
  input: z.object({
    episodeId: z.string().trim().min(1).max(96)
  }),
  output: z.object({
    accepted: z.boolean()
  })
})
