import { z } from 'zod'
import { SPLASH_DEBUG_MODES } from '../splash'
import { defineRouteContract } from '../common'

export const debugShowSplashScenarioRoute = defineRouteContract({
  name: 'debug.showSplashScenario',
  input: z.object({
    mode: z.enum(SPLASH_DEBUG_MODES)
  }),
  output: z.object({
    shown: z.boolean()
  })
})

export const debugCloseSplashScenarioRoute = defineRouteContract({
  name: 'debug.closeSplashScenario',
  input: z.object({}),
  output: z.object({
    closed: z.boolean()
  })
})

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
