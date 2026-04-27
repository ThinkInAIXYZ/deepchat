import { z } from 'zod'
import { defineRouteContract } from '../common'
import type {
  ComputerUsePermissionStatus,
  ComputerUsePermissionTarget,
  ComputerUseStatus
} from '@shared/types/computerUse'

const ComputerUseStatusSchema = z.custom<ComputerUseStatus>()
const ComputerUsePermissionStatusSchema = z.custom<ComputerUsePermissionStatus>()
const ComputerUsePermissionTargetSchema = z.custom<ComputerUsePermissionTarget>()

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
