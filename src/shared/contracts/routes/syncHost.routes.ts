import { z } from 'zod'
import { SyncHostAuditEntrySchema, SyncHostDeviceViewSchema } from '../syncHost'
import { defineRouteContract } from '../common'

const SyncHostStatusViewSchema = z.object({
  enabled: z.boolean(),
  running: z.boolean(),
  port: z.number().int().positive().nullable(),
  hostId: z.string(),
  deviceCount: z.number().int().nonnegative(),
  hasSnapshot: z.boolean()
})

const SyncHostPairingViewSchema = z.object({
  code: z.string(),
  hostId: z.string(),
  expiresAt: z.number().int().nonnegative(),
  attemptsRemaining: z.number().int().nonnegative()
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
    enabled: z.boolean()
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
