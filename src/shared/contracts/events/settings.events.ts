import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import { SettingsKeySchema, SettingsSnapshotValuesSchema } from '../routes/settings.routes'

const SettingsRouteNameSchema = z.enum([
  'settings-overview',
  'settings-common',
  'settings-display',
  'settings-environments',
  'settings-provider',
  'settings-dashboard',
  'settings-mcp',
  'settings-deepchat-agents',
  'settings-acp',
  'settings-remote',
  'settings-notifications-hooks',
  'settings-scheduled-tasks',
  'settings-plugins',
  'settings-skills',
  'settings-prompt',
  'settings-memory',
  'settings-knowledge-base',
  'settings-database',
  'settings-shortcut',
  'settings-about'
])

export const SettingsNavigationPayloadSchema = z.object({
  routeName: SettingsRouteNameSchema,
  params: z.record(z.string(), z.string()).optional(),
  section: z.string().optional()
})

export const settingsChangedEvent = defineEventContract({
  name: 'settings.changed',
  payload: z.object({
    changedKeys: z.array(SettingsKeySchema).min(1),
    version: TimestampMsSchema,
    values: SettingsSnapshotValuesSchema.partial()
  })
})

export const settingsNavigateRequestedEvent = defineEventContract({
  name: 'settings.navigateRequested',
  payload: SettingsNavigationPayloadSchema
})

export const settingsProviderInstallRequestedEvent = defineEventContract({
  name: 'settings.providerInstallRequested',
  payload: z.object({})
})

export const settingsCheckForUpdatesRequestedEvent = defineEventContract({
  name: 'settings.checkForUpdatesRequested',
  payload: z.object({})
})
