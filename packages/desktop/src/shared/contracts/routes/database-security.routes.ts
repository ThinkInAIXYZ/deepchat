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

export const DatabaseSchemaIssueKindSchema = z.enum([
  'missing_table',
  'missing_column',
  'missing_index',
  'column_type_mismatch'
])

export const DatabaseSchemaIssueSchema = z.object({
  kind: DatabaseSchemaIssueKindSchema,
  table: z.string().min(1),
  name: z.string().min(1),
  repairable: z.boolean(),
  message: z.string(),
  expectedType: z.string().nullable().optional(),
  actualType: z.string().nullable().optional()
})

export const DatabaseSchemaDiagnosisSchema = z.object({
  checkedAt: TimestampMsSchema,
  isHealthy: z.boolean(),
  issues: z.array(DatabaseSchemaIssueSchema),
  repairableIssues: z.array(DatabaseSchemaIssueSchema),
  manualIssues: z.array(DatabaseSchemaIssueSchema)
})

export const DatabaseRepairStatusSchema = z.enum(['healthy', 'repaired', 'manual-action-required'])

export const DatabaseRepairReportSchema = z.object({
  startedAt: TimestampMsSchema,
  finishedAt: TimestampMsSchema,
  status: DatabaseRepairStatusSchema,
  backupPath: z.string().nullable(),
  diagnosisBeforeRepair: DatabaseSchemaDiagnosisSchema,
  diagnosisAfterRepair: DatabaseSchemaDiagnosisSchema,
  repairedIssues: z.array(DatabaseSchemaIssueSchema),
  remainingIssues: z.array(DatabaseSchemaIssueSchema)
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

export const databaseSecurityRepairSchemaRoute = defineRouteContract({
  name: 'databaseSecurity.repairSchema',
  input: z.object({}).default({}),
  output: z.object({
    report: DatabaseRepairReportSchema
  })
})

export type DatabaseSecurityPasswordStorage = z.infer<typeof DatabaseSecurityPasswordStorageSchema>
export type DatabaseSecurityStatus = z.infer<typeof DatabaseSecurityStatusSchema>
export type DatabaseSchemaIssueKind = z.infer<typeof DatabaseSchemaIssueKindSchema>
export type DatabaseSchemaIssue = z.infer<typeof DatabaseSchemaIssueSchema>
export type DatabaseSchemaDiagnosis = z.infer<typeof DatabaseSchemaDiagnosisSchema>
export type DatabaseRepairStatus = z.infer<typeof DatabaseRepairStatusSchema>
export type DatabaseRepairReport = z.infer<typeof DatabaseRepairReportSchema>
