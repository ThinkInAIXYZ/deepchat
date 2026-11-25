import { z } from 'zod'
import { defineRouteContract } from '../common'

export const TERMINAL_INPUT_CHUNK_MAX = 16_384
export const TERMINAL_OUTPUT_CHUNK_MAX = 65_536

const TerminalDimensionSchema = z.object({
  cols: z.number().int().min(2).max(1_000),
  rows: z.number().int().min(1).max(500)
})

export const TerminalStatusSchema = z.enum(['running', 'exited'])

export const TerminalSnapshotSchema = z.object({
  terminalId: z.string().min(1),
  cwd: z.string().min(1),
  shell: z.string().min(1),
  replay: z.string(),
  // Character offset just past `replay`; output events at or before it are already included.
  outputEnd: z.number().int().nonnegative(),
  status: TerminalStatusSchema,
  exitCode: z.number().int().optional()
})

const TerminalOpenInputSchema = TerminalDimensionSchema.extend({
  sessionId: z.string().min(1),
  // Honored only for an unsent draft owned by the caller; persisted sessions use their record.
  draftWorkdir: z.string().min(1).max(4_096).optional()
})

export const terminalAttachRoute = defineRouteContract({
  name: 'terminal.attach',
  input: TerminalOpenInputSchema,
  output: TerminalSnapshotSchema
})

export const terminalRestartRoute = defineRouteContract({
  name: 'terminal.restart',
  input: TerminalOpenInputSchema,
  output: TerminalSnapshotSchema
})

export const terminalInputRoute = defineRouteContract({
  name: 'terminal.input',
  input: z.object({
    terminalId: z.string().min(1),
    data: z.string().min(1).max(TERMINAL_INPUT_CHUNK_MAX)
  }),
  output: z.object({ sent: z.literal(true) })
})

export const terminalResizeRoute = defineRouteContract({
  name: 'terminal.resize',
  input: TerminalDimensionSchema.extend({ terminalId: z.string().min(1) }),
  output: z.object({ resized: z.boolean() })
})

export const terminalKillRoute = defineRouteContract({
  name: 'terminal.kill',
  input: z.object({ terminalId: z.string().min(1) }),
  output: z.object({ killed: z.boolean() })
})
