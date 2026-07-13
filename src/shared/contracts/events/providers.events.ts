import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import { AcpDebugEventEntrySchema } from '../domainSchemas'

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

const ProviderRateLimitConfigSchema = z.object({
  enabled: z.boolean(),
  qpsLimit: z.number()
})

export const providersRateLimitConfigUpdatedEvent = defineEventContract({
  name: 'providers.rateLimit.configUpdated',
  payload: z.object({
    providerId: z.string().min(1),
    config: ProviderRateLimitConfigSchema,
    version: TimestampMsSchema
  })
})

export const providersRateLimitRequestQueuedEvent = defineEventContract({
  name: 'providers.rateLimit.requestQueued',
  payload: z.object({
    providerId: z.string().min(1),
    queueLength: z.number().int().nonnegative(),
    requestId: z.string().min(1),
    version: TimestampMsSchema
  })
})

export const providersRateLimitRequestExecutedEvent = defineEventContract({
  name: 'providers.rateLimit.requestExecuted',
  payload: z.object({
    providerId: z.string().min(1),
    timestamp: TimestampMsSchema,
    currentQps: z.number(),
    version: TimestampMsSchema
  })
})

export const providersAcpDebugEvent = defineEventContract({
  name: 'providers.acp.debug.event',
  payload: z.object({
    webContentsId: z.number().int().optional(),
    agentId: z.string().min(1),
    event: AcpDebugEventEntrySchema,
    version: TimestampMsSchema
  })
})
