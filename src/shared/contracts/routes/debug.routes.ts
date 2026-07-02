import { z } from 'zod'
import { defineRouteContract } from '../common'

export const debugCreateMockChatSessionRoute = defineRouteContract({
  name: 'debug.createMockChatSession',
  input: z.object({}),
  output: z.object({
    created: z.boolean(),
    sessionId: z.string().nullable(),
    title: z.string().nullable(),
    messageCount: z.number().int().nonnegative()
  })
})
