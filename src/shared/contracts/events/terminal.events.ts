import { z } from 'zod'
import { defineEventContract } from '../common'
import { TERMINAL_OUTPUT_CHUNK_MAX } from '../routes/terminal.routes'

export const terminalOutputEvent = defineEventContract({
  name: 'terminal.output',
  payload: z.object({
    terminalId: z.string().min(1),
    // Character offset of `data` within the terminal's whole output stream.
    offset: z.number().int().nonnegative(),
    data: z.string().max(TERMINAL_OUTPUT_CHUNK_MAX)
  })
})

export const terminalExitEvent = defineEventContract({
  name: 'terminal.exit',
  payload: z.object({
    terminalId: z.string().min(1),
    exitCode: z.number().int(),
    signal: z.number().int().optional()
  })
})
