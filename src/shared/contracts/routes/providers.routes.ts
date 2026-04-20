import { z } from 'zod'
import { EntityIdSchema, ProviderModelSummarySchema, defineRouteContract } from '../common'

export const providersListModelsRoute = defineRouteContract({
  name: 'providers.listModels',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    providerModels: z.array(ProviderModelSummarySchema),
    customModels: z.array(ProviderModelSummarySchema)
  })
})

export const providersTestConnectionRoute = defineRouteContract({
  name: 'providers.testConnection',
  input: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1).optional()
  }),
  output: z.object({
    isOk: z.boolean(),
    errorMsg: z.string().nullable()
  })
})
