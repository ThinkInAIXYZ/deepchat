import { z } from 'zod'
import { SyncHostAuditEntrySchema, SyncHostDeviceViewSchema } from '../syncHost'
import { defineRouteContract } from '../common'

export const SyncTunnelConfigSchema = z.object({
  mode: z.enum(['quick', 'named', 'external']),
  publicUrl: z.string().max(2048).default('')
})
export type SyncTunnelConfig = z.infer<typeof SyncTunnelConfigSchema>
export const SyncTunnelStatusSchema = z.object({
  phase: z.enum(['stopped', 'starting', 'connected', 'external', 'failed']),
  publicUrl: z.string(),
  error: z.string().nullable()
})
export type SyncTunnelStatus = z.infer<typeof SyncTunnelStatusSchema>

const SyncHostStatusViewSchema = z.object({
  enabled: z.boolean(),
  running: z.boolean(),
  port: z.number().int().positive().nullable(),
  hostId: z.string(),
  deviceCount: z.number().int().nonnegative(),
  hasSnapshot: z.boolean(),
  configuredPort: z.number().int().min(0).max(65535),
  publishedAt: z.number().nullable(),
  preparing: z.boolean().default(false),
  tunnelConfig: SyncTunnelConfigSchema.default({ mode: 'external', publicUrl: '' }),
  hasTunnelToken: z.boolean().default(false),
  tunnel: SyncTunnelStatusSchema.default({ phase: 'stopped', publicUrl: '', error: null })
})

const SyncHostPairingViewSchema = z.object({
  code: z.string(),
  hostId: z.string(),
  expiresAt: z.number().int().nonnegative()
})

export const syncHostGetStatusRoute = defineRouteContract({
  name: 'syncHost.getStatus',
  input: z.object({}).default({}),
  output: z.object({
    status: SyncHostStatusViewSchema,
    pairing: SyncHostPairingViewSchema.nullable()
  })
})

export const syncHostSetEnabledRoute = defineRouteContract({
  name: 'syncHost.setEnabled',
  input: z.object({
    enabled: z.boolean(),
    port: z.number().int().min(1).max(65535).optional(),
    consent: z.boolean().optional(),
    tunnel: SyncTunnelConfigSchema.extend({ token: z.string().max(8192).optional() }).optional()
  }),
  output: z.object({
    status: SyncHostStatusViewSchema
  })
})

export const syncHostCreatePairingCodeRoute = defineRouteContract({
  name: 'syncHost.createPairingCode',
  input: z.object({}).default({}),
  output: z.object({
    pairing: SyncHostPairingViewSchema.nullable()
  })
})

export const syncHostListDevicesRoute = defineRouteContract({
  name: 'syncHost.listDevices',
  input: z.object({}).default({}),
  output: z.object({
    devices: z.array(SyncHostDeviceViewSchema)
  })
})

export const syncHostRevokeDeviceRoute = defineRouteContract({
  name: 'syncHost.revokeDevice',
  input: z.object({
    deviceId: z.string().min(1)
  }),
  output: z.object({
    revoked: z.boolean()
  })
})

export const syncHostRenameDeviceRoute = defineRouteContract({
  name: 'syncHost.renameDevice',
  input: z.object({
    deviceId: z.string().min(1),
    name: z.string().min(1)
  }),
  output: z.object({
    renamed: z.boolean()
  })
})

export const syncHostGetAuditRoute = defineRouteContract({
  name: 'syncHost.getAudit',
  input: z.object({}).default({}),
  output: z.object({
    entries: z.array(SyncHostAuditEntrySchema)
  })
})

export const syncHostPublishRoute = defineRouteContract({
  name: 'syncHost.publish',
  input: z.object({}).default({}),
  output: z.object({ status: SyncHostStatusViewSchema })
})
