import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import { ModelConfigSchema } from '../domainSchemas'

export const modelsChangedEvent = defineEventContract({
  name: 'models.changed',
  payload: z.object({
    reason: z.enum([
      'provider-models',
      'custom-models',
      'provider-db-loaded',
      'provider-db-updated',
      'runtime-refresh',
      'agents'
    ]),
    providerId: z.string().optional(),
    version: TimestampMsSchema
  })
})

export const modelsStatusChangedEvent = defineEventContract({
  name: 'models.status.changed',
  payload: z.object({
    providerId: z.string(),
    modelId: z.string(),
    enabled: z.boolean(),
    version: TimestampMsSchema
  })
})

export const modelBatchStatusChangedEvent = defineEventContract({
  name: 'models.batch.status.changed',
  payload: z.object({
    providerId: z.string(),
    updates: z.array(
      z.object({
        modelId: z.string(),
        enabled: z.boolean()
      })
    ),
    version: TimestampMsSchema
  })
})

export const modelsConfigChangedEvent = defineEventContract({
  name: 'models.config.changed',
  payload: z.object({
    changeType: z.enum(['updated', 'reset', 'imported']),
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    config: ModelConfigSchema.optional(),
    overwrite: z.boolean().optional(),
    version: TimestampMsSchema
  })
})
