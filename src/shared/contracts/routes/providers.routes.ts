import { z } from 'zod'
import { EntityIdSchema, ProviderModelSummarySchema, defineRouteContract } from '../common'
import {
  AcpConfigStateSchema,
  LlmProviderSchema,
  OllamaModelSchema,
  ProviderRateLimitStatusSchema
} from '../domainSchemas'

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

export const providersListRoute = defineRouteContract({
  name: 'providers.list',
  input: z.object({}).default({}),
  output: z.object({
    providers: z.array(LlmProviderSchema)
  })
})

export const providersListDefaultsRoute = defineRouteContract({
  name: 'providers.listDefaults',
  input: z.object({}).default({}),
  output: z.object({
    providers: z.array(LlmProviderSchema)
  })
})

export const providersSetByIdRoute = defineRouteContract({
  name: 'providers.setById',
  input: z.object({
    providerId: EntityIdSchema,
    provider: LlmProviderSchema
  }),
  output: z.object({
    provider: LlmProviderSchema
  })
})

export const providersUpdateRoute = defineRouteContract({
  name: 'providers.update',
  input: z.object({
    providerId: EntityIdSchema,
    updates: LlmProviderSchema.partial()
  }),
  output: z.object({
    provider: LlmProviderSchema,
    requiresRebuild: z.boolean()
  })
})

export const providersAddRoute = defineRouteContract({
  name: 'providers.add',
  input: z.object({
    provider: LlmProviderSchema
  }),
  output: z.object({
    provider: LlmProviderSchema
  })
})

export const providersRemoveRoute = defineRouteContract({
  name: 'providers.remove',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    removed: z.boolean()
  })
})

export const providersReorderRoute = defineRouteContract({
  name: 'providers.reorder',
  input: z.object({
    providers: z.array(LlmProviderSchema)
  }),
  output: z.object({
    providers: z.array(LlmProviderSchema)
  })
})

export const providersGetRateLimitStatusRoute = defineRouteContract({
  name: 'providers.getRateLimitStatus',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    status: ProviderRateLimitStatusSchema
  })
})

export const providersRefreshModelsRoute = defineRouteContract({
  name: 'providers.refreshModels',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    refreshed: z.boolean()
  })
})

export const providersListOllamaModelsRoute = defineRouteContract({
  name: 'providers.listOllamaModels',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    models: z.array(OllamaModelSchema)
  })
})

export const providersListOllamaRunningModelsRoute = defineRouteContract({
  name: 'providers.listOllamaRunningModels',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    models: z.array(OllamaModelSchema)
  })
})

export const providersPullOllamaModelRoute = defineRouteContract({
  name: 'providers.pullOllamaModel',
  input: z.object({
    providerId: EntityIdSchema,
    modelName: z.string().min(1)
  }),
  output: z.object({
    success: z.boolean()
  })
})

export const providersWarmupAcpProcessRoute = defineRouteContract({
  name: 'providers.warmupAcpProcess',
  input: z.object({
    agentId: z.string().min(1),
    workdir: z.string().optional()
  }),
  output: z.object({
    warmedUp: z.boolean()
  })
})

export const providersGetAcpProcessConfigOptionsRoute = defineRouteContract({
  name: 'providers.getAcpProcessConfigOptions',
  input: z.object({
    agentId: z.string().min(1),
    workdir: z.string().optional()
  }),
  output: z.object({
    state: AcpConfigStateSchema.nullable()
  })
})
