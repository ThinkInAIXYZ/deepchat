import { z } from 'zod'
import { defineRouteContract } from '../contract'
import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_SURFACE_VERSION,
  LocalControlEffectSchema,
  LocalControlMethodSchema,
  LocalControlPrincipalSchema,
  LocalControlScopesSchema
} from '../localControl'

export const LocalControlTransportSchema = z.enum(['rpc', 'stream', 'upload', 'download'])
export const LocalControlApprovalModeSchema = z.enum(['never', 'policy'])
const LocalControlCallersSchema = z
  .array(LocalControlPrincipalSchema)
  .min(1)
  .max(2)
  .refine((callers) => new Set(callers).size === callers.length, {
    message: 'Duplicate local-control caller'
  })

export const LocalControlCapabilitySchema = z
  .object({
    method: LocalControlMethodSchema,
    possibleEffects: z.array(LocalControlEffectSchema).min(1),
    callers: LocalControlCallersSchema,
    scopes: LocalControlScopesSchema.min(1),
    transport: LocalControlTransportSchema,
    approval: LocalControlApprovalModeSchema,
    maxBodyBytes: z.number().int().positive(),
    timeoutMs: z.number().int().positive()
  })
  .strict()

export const cliStatusRoute = defineRouteContract({
  name: 'cli.status',
  input: z.object({}).default({}),
  output: z.object({
    running: z.boolean(),
    pid: z.number().int().positive(),
    startedAt: z.number().int().nonnegative(),
    uptimeMs: z.number().int().nonnegative(),
    endpointKind: z.enum(['unix', 'pipe']),
    activeConnections: z.number().int().nonnegative(),
    pendingRequests: z.number().int().nonnegative()
  })
})

export const cliVersionRoute = defineRouteContract({
  name: 'cli.version',
  input: z.object({}).default({}),
  output: z.object({
    appVersion: z.string().min(1),
    protocolVersion: z.literal(LOCAL_CONTROL_PROTOCOL_VERSION),
    surfaceVersion: z.literal(LOCAL_CONTROL_SURFACE_VERSION)
  })
})

export const cliCapabilitiesRoute = defineRouteContract({
  name: 'cli.capabilities',
  input: z.object({}).default({}),
  output: z.object({
    protocolVersion: z.literal(LOCAL_CONTROL_PROTOCOL_VERSION),
    surfaceVersion: z.literal(LOCAL_CONTROL_SURFACE_VERSION),
    capabilities: z.array(LocalControlCapabilitySchema)
  })
})

export const cliDoctorRoute = defineRouteContract({
  name: 'cli.doctor',
  input: z.object({}).default({}),
  output: z.object({
    healthy: z.boolean(),
    checks: z.array(
      z
        .object({
          id: z.enum(['transport', 'descriptor', 'surface', 'renderer']),
          status: z.enum(['ok', 'warning', 'error']),
          message: z.string().min(1).max(1024)
        })
        .strict()
    )
  })
})

export type CliCapability = z.infer<typeof LocalControlCapabilitySchema>
