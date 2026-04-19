import { z } from 'zod'
import { EntityIdSchema, SendMessageInputSchema, defineRouteContract } from '../common'

export const chatSendMessageRoute = defineRouteContract({
  name: 'chat.sendMessage',
  input: z.object({
    sessionId: EntityIdSchema,
    content: z.union([z.string(), SendMessageInputSchema])
  }),
  output: z.object({
    accepted: z.boolean()
  })
})

export const chatStopStreamRoute = defineRouteContract({
  name: 'chat.stopStream',
  input: z
    .object({
      sessionId: EntityIdSchema.optional(),
      requestId: EntityIdSchema.optional()
    })
    .refine((value) => Boolean(value.sessionId || value.requestId), {
      message: 'sessionId or requestId is required'
    }),
  output: z.object({
    stopped: z.boolean()
  })
})
