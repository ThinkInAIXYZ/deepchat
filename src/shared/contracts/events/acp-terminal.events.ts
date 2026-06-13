import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'

const AcpExternalDependencySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  platform: z.array(z.string()).optional(),
  checkCommand: z.string().optional(),
  checkPaths: z.array(z.string()).optional(),
  installCommands: z
    .object({
      winget: z.string().optional(),
      chocolatey: z.string().optional(),
      scoop: z.string().optional()
    })
    .optional(),
  downloadUrl: z.string().optional(),
  requiredFor: z.array(z.string()).optional()
})

export const acpTerminalStartedEvent = defineEventContract({
  name: 'acpTerminal.started',
  payload: z.object({
    command: z.string(),
    version: TimestampMsSchema
  })
})

export const acpTerminalOutputEvent = defineEventContract({
  name: 'acpTerminal.output',
  payload: z.object({
    type: z.string(),
    data: z.string(),
    version: TimestampMsSchema
  })
})

export const acpTerminalExitedEvent = defineEventContract({
  name: 'acpTerminal.exited',
  payload: z.object({
    code: z.number().nullable(),
    signal: z.string().nullable(),
    version: TimestampMsSchema
  })
})

export const acpTerminalErrorEvent = defineEventContract({
  name: 'acpTerminal.error',
  payload: z.object({
    message: z.string(),
    version: TimestampMsSchema
  })
})

export const acpTerminalExternalDependenciesRequiredEvent = defineEventContract({
  name: 'acpTerminal.externalDependenciesRequired',
  payload: z.object({
    agentId: z.string().min(1),
    missingDeps: z.array(AcpExternalDependencySchema),
    version: TimestampMsSchema
  })
})
