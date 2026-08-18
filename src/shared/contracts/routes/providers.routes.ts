import { z } from 'zod'
import { EntityIdSchema, ProviderModelSummarySchema, defineRouteContract } from '../common'
import { ModelType } from '../../model'
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

export const PROVIDER_CREDENTIAL_MAX_BYTES = 64 * 1024

const StoredProviderCredentialSchema = z
  .string()
  .min(1)
  .max(PROVIDER_CREDENTIAL_MAX_BYTES)
  .refine((value) => value.trim().length > 0, { message: 'Credential must not be blank' })
  .refine((value) => new TextEncoder().encode(value).byteLength <= PROVIDER_CREDENTIAL_MAX_BYTES, {
    message: 'Credential exceeds its UTF-8 byte limit'
  })

const PublicProviderApiTypeSchema = z.enum(PROVIDER_IMPORT_CUSTOM_API_TYPES)
const PublicProviderBaseUrlSchema = z
  .url()
  .max(4096)
  .superRefine((value, context) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      context.addIssue({ code: 'custom', message: 'Provider URL must use HTTP or HTTPS' })
    }
    if (url.username || url.password || url.search || url.hash) {
      context.addIssue({
        code: 'custom',
        message: 'Provider URL must not contain credentials, query parameters, or a fragment'
      })
    }
  })

export const PublicProviderModelSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().max(256),
    group: z.string().max(128),
    enabled: z.boolean(),
    custom: z.boolean(),
    vision: z.boolean(),
    functionCall: z.boolean(),
    reasoning: z.boolean(),
    enableSearch: z.boolean(),
    type: z.enum(ModelType).optional(),
    contextLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    maxTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()
  })
  .strict()

export const PublicProviderSchema = z
  .object({
    id: EntityIdSchema.max(128),
    name: z.string().min(1).max(256),
    apiType: z.string().min(1).max(128),
    enabled: z.boolean(),
    custom: z.boolean(),
    storedCredentialConfigured: z.boolean(),
    models: z.array(PublicProviderModelSchema).max(10_000)
  })
  .strict()

export const providersListPublicRoute = defineRouteContract({
  name: 'providers.listPublic',
  input: z.object({ enabledOnly: z.boolean().optional() }).strict().default({}),
  output: z.object({ providers: z.array(PublicProviderSchema).max(1_000) }).strict()
})

export const PublicProviderSummarySchema = PublicProviderSchema.omit({ models: true })

export const providersAddPublicRoute = defineRouteContract({
  name: 'providers.addPublic',
  input: z
    .object({
      name: z.string().trim().min(1).max(256),
      apiType: PublicProviderApiTypeSchema,
      baseUrl: PublicProviderBaseUrlSchema,
      enabled: z.boolean().optional().default(true)
    })
    .strict(),
  output: z.object({ provider: PublicProviderSummarySchema }).strict()
})

export const providersUpdatePublicRoute = defineRouteContract({
  name: 'providers.updatePublic',
  input: z
    .object({
      providerId: EntityIdSchema.max(128),
      updates: z
        .object({
          name: z.string().trim().min(1).max(256).optional(),
          apiType: PublicProviderApiTypeSchema.optional(),
          baseUrl: PublicProviderBaseUrlSchema.optional(),
          enabled: z.boolean().optional()
        })
        .strict()
        .refine((updates) => Object.keys(updates).length > 0, {
          message: 'At least one provider update is required'
        })
    })
    .strict(),
  output: z
    .object({
      provider: PublicProviderSummarySchema,
      requiresRebuild: z.boolean()
    })
    .strict()
})

export const providersSetCredentialRoute = defineRouteContract({
  name: 'providers.setCredential',
  input: z.discriminatedUnion('action', [
    z
      .object({
        providerId: EntityIdSchema.max(128),
        action: z.literal('set'),
        kind: z.literal('api-key'),
        value: StoredProviderCredentialSchema
      })
      .strict(),
    z
      .object({
        providerId: EntityIdSchema.max(128),
        action: z.literal('clear'),
        kind: z.literal('api-key')
      })
      .strict()
  ]),
  output: z
    .object({
      providerId: EntityIdSchema.max(128),
      action: z.enum(['set', 'clear']),
      kind: z.literal('api-key'),
      storedApiKeyConfigured: z.boolean()
    })
    .strict()
})

export type PublicProvider = z.infer<typeof PublicProviderSchema>
export type PublicProviderModel = z.infer<typeof PublicProviderModelSchema>
export type PublicProviderSummary = z.infer<typeof PublicProviderSummarySchema>

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

export const providersTestPublicConnectionRoute = defineRouteContract({
  name: 'providers.testPublicConnection',
  input: providersTestConnectionRoute.input,
  output: providersTestConnectionRoute.output
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

// Validates a draft provider configuration and loads its model catalog in a
// single main-process operation. Nothing is persisted and no enable flag is
// toggled: the draft only becomes a configured provider after the renderer
// commits it on success.
export const providersValidateDraftRoute = defineRouteContract({
  name: 'providers.validateDraft',
  input: z.object({
    provider: LlmProviderSchema
  }),
  output: z.object({
    isOk: z.boolean(),
    errorMsg: z.string().nullable(),
    models: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string().optional()
      })
    )
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
    requestId: z.string().min(1).max(128),
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
