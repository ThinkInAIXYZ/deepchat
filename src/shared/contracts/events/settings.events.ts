import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import { SettingsKeySchema, SettingsSnapshotValuesSchema } from '../routes/settings.routes'

export const settingsChangedEvent = defineEventContract({
  name: 'settings.changed',
  payload: z.object({
    changedKeys: z.array(SettingsKeySchema).min(1),
    version: TimestampMsSchema,
    values: SettingsSnapshotValuesSchema.partial()
  })
})
