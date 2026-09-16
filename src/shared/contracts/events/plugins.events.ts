import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import { PluginCatalogInstallPhaseSchema } from '../routes/plugins.routes'

export const pluginInstallProgressEvent = defineEventContract({
  name: 'plugins.install.progress',
  payload: z.object({
    pluginId: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
    phase: PluginCatalogInstallPhaseSchema,
    receivedBytes: z.number().nonnegative(),
    totalBytes: z.number().nonnegative().nullable(),
    error: z.string().max(2048).nullable(),
    updatedAt: TimestampMsSchema
  })
})
