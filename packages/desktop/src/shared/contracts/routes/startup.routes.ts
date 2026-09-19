import { z } from 'zod'
import { StartupBootstrapShellSchema, defineRouteContract } from '../common'

export const startupGetBootstrapRoute = defineRouteContract({
  name: 'startup.getBootstrap',
  input: z.object({}),
  output: z.object({
    bootstrap: StartupBootstrapShellSchema
  })
})
