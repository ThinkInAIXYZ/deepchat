import { z } from 'zod'
import { TimestampMsSchema, defineRouteContract } from '../common'

export const SETTINGS_KEYS = [
  'fontSizeLevel',
  'fontFamily',
  'codeFontFamily',
  'artifactsEffectEnabled',
  'autoScrollEnabled',
  'autoCompactionEnabled',
  'autoCompactionTriggerThreshold',
  'autoCompactionRetainRecentPairs',
  'contentProtectionEnabled',
  'privacyModeEnabled',
  'notificationsEnabled',
  'launchAtLoginEnabled',
  'traceDebugEnabled',
  'copyWithCotEnabled',
  'loggingEnabled'
] as const

export const SettingsKeySchema = z.enum(SETTINGS_KEYS)

export const SettingsSnapshotValuesSchema = z.object({
  fontSizeLevel: z.number().int(),
  fontFamily: z.string(),
  codeFontFamily: z.string(),
  artifactsEffectEnabled: z.boolean(),
  autoScrollEnabled: z.boolean(),
  autoCompactionEnabled: z.boolean(),
  autoCompactionTriggerThreshold: z.number().int(),
  autoCompactionRetainRecentPairs: z.number().int(),
  contentProtectionEnabled: z.boolean(),
  privacyModeEnabled: z.boolean(),
  notificationsEnabled: z.boolean(),
  launchAtLoginEnabled: z.boolean(),
  traceDebugEnabled: z.boolean(),
  copyWithCotEnabled: z.boolean(),
  loggingEnabled: z.boolean()
})

export const SettingsChangeSchema = z.discriminatedUnion('key', [
  z.object({
    key: z.literal('fontSizeLevel'),
    value: z.number().int().min(0).max(4)
  }),
  z.object({
    key: z.literal('fontFamily'),
    value: z.string()
  }),
  z.object({
    key: z.literal('codeFontFamily'),
    value: z.string()
  }),
  z.object({
    key: z.literal('artifactsEffectEnabled'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('autoScrollEnabled'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('autoCompactionEnabled'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('autoCompactionTriggerThreshold'),
    value: z.number().int().min(5).max(95)
  }),
  z.object({
    key: z.literal('autoCompactionRetainRecentPairs'),
    value: z.number().int().min(1).max(10)
  }),
  z.object({
    key: z.literal('contentProtectionEnabled'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('privacyModeEnabled'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('notificationsEnabled'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('launchAtLoginEnabled'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('traceDebugEnabled'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('copyWithCotEnabled'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('loggingEnabled'),
    value: z.boolean()
  })
])

export const settingsGetSnapshotRoute = defineRouteContract({
  name: 'settings.getSnapshot',
  input: z
    .object({
      keys: z.array(SettingsKeySchema).optional()
    })
    .default({}),
  output: z.object({
    version: TimestampMsSchema,
    values: SettingsSnapshotValuesSchema.partial()
  })
})

export const settingsListSystemFontsRoute = defineRouteContract({
  name: 'settings.listSystemFonts',
  input: z.object({}).default({}),
  output: z.object({
    fonts: z.array(z.string())
  })
})

export const settingsUpdateRoute = defineRouteContract({
  name: 'settings.update',
  input: z.object({
    changes: z.array(SettingsChangeSchema).min(1)
  }),
  output: z.object({
    version: TimestampMsSchema,
    changedKeys: z.array(SettingsKeySchema).min(1),
    values: SettingsSnapshotValuesSchema.partial()
  })
})

export const SettingsActivityCategorySchema = z.enum([
  'provider',
  'model',
  'mcp',
  'data',
  'privacy',
  'appearance',
  'agent',
  'knowledge',
  'prompt',
  'shortcut',
  'system'
])

export const SettingsActivityActionSchema = z.enum([
  'created',
  'updated',
  'enabled',
  'disabled',
  'verified',
  'refreshed',
  'backup_created',
  'imported',
  'reset',
  'repaired',
  'cleared',
  'removed'
])

export const SettingsActivityRecordSchema = z.object({
  id: z.string(),
  category: SettingsActivityCategorySchema,
  action: SettingsActivityActionSchema,
  targetType: z.string(),
  targetId: z.string().nullable(),
  targetLabel: z.string(),
  routeName: z.string().nullable(),
  routeParams: z.record(z.string(), z.string()),
  summaryKey: z.string(),
  summaryParams: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  createdAt: TimestampMsSchema
})

export const SettingsActivityInputSchema = SettingsActivityRecordSchema.omit({
  id: true,
  createdAt: true
}).partial({
  targetId: true,
  targetLabel: true,
  routeName: true,
  routeParams: true,
  summaryParams: true
})

export const settingsActivityListRoute = defineRouteContract({
  name: 'settings.activity.list',
  input: z
    .object({
      limit: z.number().int().min(1).max(200).optional()
    })
    .default({}),
  output: z.object({
    activities: z.array(SettingsActivityRecordSchema)
  })
})

export type SettingsKey = z.infer<typeof SettingsKeySchema>
export type SettingsSnapshotValues = z.infer<typeof SettingsSnapshotValuesSchema>
export type SettingsChange = z.infer<typeof SettingsChangeSchema>
export type SettingsActivityCategory = z.infer<typeof SettingsActivityCategorySchema>
export type SettingsActivityAction = z.infer<typeof SettingsActivityActionSchema>
export type SettingsActivityRecord = z.infer<typeof SettingsActivityRecordSchema>
export type SettingsActivityInput = z.infer<typeof SettingsActivityInputSchema>
