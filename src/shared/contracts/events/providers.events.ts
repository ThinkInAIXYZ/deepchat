import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'

export const providersChangedEvent = defineEventContract({
  name: 'providers.changed',
  payload: z.object({
    reason: z.enum([
      'providers',
      'provider-atomic-update',
      'provider-batch-update',
      'provider-db-loaded',
      'provider-db-updated'
    ]),
    providerIds: z.array(z.string()).optional(),
    version: TimestampMsSchema
  })
})
