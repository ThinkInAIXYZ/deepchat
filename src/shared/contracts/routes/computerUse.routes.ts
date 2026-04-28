import { z } from 'zod'
import { defineRouteContract } from '../common'
import type {
  ComputerUsePermissionStatus,
  ComputerUsePermissionTarget,
  ComputerUseStatus
} from '@shared/types/computerUse'

const ComputerUsePermissionStateSchema = z.enum(['granted', 'missing', 'unknown'])
const ComputerUsePermissionStatusSchema: z.ZodType<ComputerUsePermissionStatus> = z.object({
  accessibility: ComputerUsePermissionStateSchema,
  screenRecording: ComputerUsePermissionStateSchema
})
const ComputerUsePermissionTargetSchema: z.ZodType<ComputerUsePermissionTarget> = z.enum([
  'all',
  'accessibility',
  'screenRecording'
])
const ComputerUseStatusSchema: z.ZodType<ComputerUseStatus> = z.object({
  platform: z.enum(['darwin', 'unsupported']),
  available: z.boolean(),
  enabled: z.boolean(),
  arch: z.enum(['arm64', 'x64', 'unknown']),
  helperPath: z.string().optional(),
  helperVersion: z.string().optional(),
  permissions: ComputerUsePermissionStatusSchema,
  mcpServer: z.enum(['notRegistered', 'registered', 'running', 'error']),
  lastError: z.string().optional()
})

export const computerUseGetStatusRoute = defineRouteContract({
  name: 'computerUse.getStatus',
  input: z.object({}),
  output: z.object({
    status: ComputerUseStatusSchema
  })
})

export const computerUseSetEnabledRoute = defineRouteContract({
  name: 'computerUse.setEnabled',
  input: z.object({
    enabled: z.boolean()
  }),
  output: z.object({
    status: ComputerUseStatusSchema
  })
})

export const computerUseOpenPermissionGuideRoute = defineRouteContract({
  name: 'computerUse.openPermissionGuide',
  input: z.object({
    target: ComputerUsePermissionTargetSchema.optional()
  }),
  output: z.object({
    opened: z.literal(true)
  })
})

export const computerUseCheckPermissionsRoute = defineRouteContract({
  name: 'computerUse.checkPermissions',
  input: z.object({}),
  output: z.object({
    permissions: ComputerUsePermissionStatusSchema
  })
})

export const computerUseRestartMcpServerRoute = defineRouteContract({
  name: 'computerUse.restartMcpServer',
  input: z.object({}),
  output: z.object({
    status: ComputerUseStatusSchema
  })
})
