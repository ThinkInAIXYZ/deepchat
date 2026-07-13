import { z } from 'zod'
import { defineRouteContract } from '../common'

export const acpTerminalInputRoute = defineRouteContract({
  name: 'acpTerminal.input',
  input: z.object({
    data: z.string()
  }),
  output: z.object({
    sent: z.literal(true)
  })
})

export const acpTerminalKillRoute = defineRouteContract({
  name: 'acpTerminal.kill',
  input: z.object({}).default({}),
  output: z.object({
    killed: z.literal(true)
  })
})
