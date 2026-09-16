import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import { PluginCatalogInstallPhaseSchema } from '../routes/plugins.routes'

export const ocrRuntimeInstallProgressEvent = defineEventContract({
  name: 'ocr.runtimeInstall.progress',
  payload: z.object({
    assetId: z.string().min(1).max(128),
    version: z.string().min(1).max(128),
    phase: PluginCatalogInstallPhaseSchema,
    receivedBytes: z.number().nonnegative(),
    totalBytes: z.number().nonnegative().nullable(),
    error: z.string().max(2048).nullable(),
    updatedAt: TimestampMsSchema
  })
})
