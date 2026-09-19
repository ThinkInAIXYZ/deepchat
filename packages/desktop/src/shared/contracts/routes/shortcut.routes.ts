import { z } from 'zod'
import { defineRouteContract } from '../common'

export const shortcutRegisterRoute = defineRouteContract({
  name: 'shortcut.register',
  input: z.object({}).default({}),
  output: z.object({
    registered: z.literal(true)
  })
})

export const shortcutUnregisterRoute = defineRouteContract({
  name: 'shortcut.unregister',
  input: z.object({}).default({}),
  output: z.object({
    unregistered: z.literal(true)
  })
})

export const shortcutDestroyRoute = defineRouteContract({
  name: 'shortcut.destroy',
  input: z.object({}).default({}),
  output: z.object({
    destroyed: z.literal(true)
  })
})
