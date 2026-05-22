import { z } from 'zod'
import { TimestampMsSchema, defineRouteContract } from '../common'

export const DatabaseSecurityPasswordStorageSchema = z.enum(['safeStorage', 'manual', 'none'])

export const DatabaseSecurityStatusSchema = z.object({
  enabled: z.boolean(),
  cipher: z.literal('sqlcipher'),
  safeStorageAvailable: z.boolean(),
  safeStorageBackend: z.string().optional(),
  passwordStorage: DatabaseSecurityPasswordStorageSchema,
  manualUnlockRequired: z.boolean(),
  migrationInProgress: z.boolean(),
  lastMigrationAt: TimestampMsSchema.optional()
})

export const databaseSecurityGetStatusRoute = defineRouteContract({
  name: 'databaseSecurity.getStatus',
  input: z.object({}).default({}),
  output: z.object({
    status: DatabaseSecurityStatusSchema
  })
})

export const databaseSecurityEnableRoute = defineRouteContract({
  name: 'databaseSecurity.enable',
  input: z.object({
    password: z.string().min(1)
  }),
  output: z.object({
    status: DatabaseSecurityStatusSchema
  })
})

export const databaseSecurityChangePasswordRoute = defineRouteContract({
  name: 'databaseSecurity.changePassword',
  input: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1)
  }),
  output: z.object({
    status: DatabaseSecurityStatusSchema
  })
})

export const databaseSecurityDisableRoute = defineRouteContract({
  name: 'databaseSecurity.disable',
  input: z.object({
    currentPassword: z.string().min(1)
  }),
  output: z.object({
    status: DatabaseSecurityStatusSchema
  })
})

export type DatabaseSecurityPasswordStorage = z.infer<typeof DatabaseSecurityPasswordStorageSchema>
export type DatabaseSecurityStatus = z.infer<typeof DatabaseSecurityStatusSchema>
