import { z } from 'zod'
import { EntityIdSchema, ProviderModelSummarySchema, defineRouteContract } from '../common'
import {
  AcpDebugActionSchema,
  AcpDebugRunResultSchema,
  AcpConfigStateSchema,
  EmbeddingDimensionsSchema,
  LlmProviderSchema,
  LlmProviderSummarySchema,
  ModelScopeMcpSyncResultSchema,
  OllamaModelSchema,
  ProviderRateLimitStatusSchema
} from '../domainSchemas'
import { PROVIDER_IMPORT_CUSTOM_API_TYPES, PROVIDER_IMPORT_SOURCE_IDS } from '../../providerImport'

const ProviderImportSourceIdSchema = z.enum(PROVIDER_IMPORT_SOURCE_IDS)
const ProviderImportCustomApiTypeSchema = z.enum(PROVIDER_IMPORT_CUSTOM_API_TYPES)
const ProviderImportTargetKindSchema = z.enum(['builtin', 'custom', 'unsupported'])
const ProviderImportWarningSchema = z.enum([
  'already_configured',
  'missing_api_key',
  'unsupported_provider',
  'overwrites_previous_selection',
  'credential_only_import'
])
const ProviderImportApplyStatusSchema = z.enum(['created', 'updated', 'skipped', 'overwritten'])

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

export const providersListSummariesRoute = defineRouteContract({
  name: 'providers.listSummaries',
  input: z.object({}).default({}),
  output: z.object({
    providers: z.array(LlmProviderSummarySchema)
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

const ProviderKeyStatusSchema = z.object({
  remainNum: z.number().optional(),
  limit_remaining: z.string().optional(),
  usage: z.string().optional()
})

export const providersGetKeyStatusRoute = defineRouteContract({
  name: 'providers.getKeyStatus',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    status: ProviderKeyStatusSchema.nullable()
  })
})

export const providersUpdateRateLimitRoute = defineRouteContract({
  name: 'providers.updateRateLimit',
  input: z.object({
    providerId: EntityIdSchema,
    enabled: z.boolean(),
    qpsLimit: z.number().positive()
  }),
  output: z.object({
    config: z.object({
      enabled: z.boolean(),
      qpsLimit: z.number().positive()
    })
  })
})

export const providersGetEmbeddingDimensionsRoute = defineRouteContract({
  name: 'providers.getEmbeddingDimensions',
  input: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1)
  }),
  output: z.object({
    result: z.object({
      data: EmbeddingDimensionsSchema,
      errorMsg: z.string().optional()
    })
  })
})

export const providersSyncModelScopeMcpServersRoute = defineRouteContract({
  name: 'providers.syncModelScopeMcpServers',
  input: z.object({
    providerId: EntityIdSchema,
    syncOptions: z
      .object({
        page_number: z.number().int().positive().optional(),
        page_size: z.number().int().positive().optional(),
        timeout: z.number().int().positive().optional(),
        retryCount: z.number().int().nonnegative().optional()
      })
      .optional()
  }),
  output: z.object({
    result: ModelScopeMcpSyncResultSchema
  })
})

export const providersRunAcpDebugActionRoute = defineRouteContract({
  name: 'providers.runAcpDebugAction',
  input: z.object({
    agentId: z.string().min(1),
    action: AcpDebugActionSchema,
    payload: z.record(z.string(), z.unknown()).optional(),
    sessionId: z.string().optional(),
    workdir: z.string().optional(),
    methodName: z.string().optional()
  }),
  output: z.object({
    result: AcpDebugRunResultSchema
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

export const providersImportScanRoute = defineRouteContract({
  name: 'providers.import.scan',
  input: z.object({}).default({}),
  output: z.object({
    sessionId: z.string().min(1),
    sourceOrder: z.array(ProviderImportSourceIdSchema),
    sources: z.array(
      z.object({
        id: ProviderImportSourceIdSchema,
        name: z.string(),
        status: z.enum(['found', 'not_found', 'error', 'unsupported_platform']),
        configPath: z.string(),
        providerCount: z.number().int().nonnegative(),
        selectable: z.boolean(),
        defaultSelected: z.boolean(),
        message: z.string().optional()
      })
    ),
    providers: z.array(
      z.object({
        id: z.string().min(1),
        sourceId: ProviderImportSourceIdSchema,
        sourceName: z.string(),
        sourceProviderId: z.string(),
        name: z.string(),
        sourceType: z.string(),
        targetKind: ProviderImportTargetKindSchema,
        targetProviderId: z.string(),
        targetProviderName: z.string(),
        targetApiType: z.string(),
        apiKeyMasked: z.string(),
        baseUrl: z.string(),
        modelCount: z.number().int().nonnegative(),
        modelPreview: z.array(z.string()),
        configured: z.boolean(),
        selectable: z.boolean(),
        defaultSelected: z.boolean(),
        warnings: z.array(ProviderImportWarningSchema)
      })
    )
  })
})

export const providersImportApplyRoute = defineRouteContract({
  name: 'providers.import.apply',
  input: z.object({
    sessionId: z.string().min(1),
    selections: z.array(
      z.object({
        sourceId: ProviderImportSourceIdSchema,
        providerIds: z.array(z.string().min(1)),
        providerOptions: z
          .record(
            z.string().min(1),
            z.object({
              targetApiType: ProviderImportCustomApiTypeSchema.optional()
            })
          )
          .optional()
      })
    )
  }),
  output: z.object({
    summary: z.object({
      imported: z.number().int().nonnegative(),
      created: z.number().int().nonnegative(),
      updated: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      overwritten: z.number().int().nonnegative(),
      models: z.number().int().nonnegative()
    }),
    results: z.array(
      z.object({
        id: z.string().min(1),
        sourceId: ProviderImportSourceIdSchema,
        sourceName: z.string(),
        sourceProviderId: z.string(),
        name: z.string(),
        targetKind: ProviderImportTargetKindSchema,
        targetProviderId: z.string(),
        targetProviderName: z.string(),
        status: ProviderImportApplyStatusSchema,
        modelCount: z.number().int().nonnegative(),
        message: z.string().optional()
      })
    )
  })
})
