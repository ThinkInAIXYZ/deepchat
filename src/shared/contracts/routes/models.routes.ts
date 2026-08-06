import { z } from 'zod'
import { EntityIdSchema, ProviderModelSummarySchema, defineRouteContract } from '../common'
import {
  ModelCapabilitiesSchema,
  ModelConfigExportEntrySchema,
  ModelConfigSchema,
  ProviderModelCatalogSchema,
  ProviderModelConfigEntrySchema
} from '../domainSchemas'
import { CapabilitySnapshotQuerySchema } from '../../types/model-capabilities'

export const MODEL_INVOKE_MAX_TOTAL_INPUT_CHARACTERS = 4 * 1024 * 1024
export const MODEL_INVOKE_MAX_OUTPUT_CHARACTERS = 3 * 1024 * 1024

export const ModelInvokeUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    cachedTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional()
  })
  .strict()

export const ModelInvokeLatencySchema = z
  .object({
    queueMs: z.number().int().nonnegative(),
    firstEventMs: z.number().int().nonnegative().nullable(),
    firstTextMs: z.number().int().nonnegative().nullable(),
    totalMs: z.number().int().nonnegative()
  })
  .strict()

export const ModelInvokeProviderFailureSchema = z
  .object({
    statusCode: z.number().int().min(100).max(599).optional(),
    retryable: z.boolean()
  })
  .strict()

export const ModelInvokeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), text: z.string().max(1024 * 1024) }).strict(),
  z.object({ type: z.literal('reasoning_delta'), text: z.string().max(1024 * 1024) }).strict(),
  z.object({ type: z.literal('usage'), usage: ModelInvokeUsageSchema }).strict(),
  z
    .object({
      type: z.literal('rate_limit'),
      providerId: EntityIdSchema.max(128),
      qpsLimit: z.number().nonnegative(),
      currentQps: z.number().nonnegative(),
      queueLength: z.number().int().nonnegative(),
      estimatedWaitTimeMs: z.number().nonnegative().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('stop'),
      reason: z.enum(['tool_use', 'max_tokens', 'max_turn_requests', 'error', 'complete'])
    })
    .strict()
])

const ModelInvokeMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z
      .string()
      .min(1)
      .max(1024 * 1024)
  })
  .strict()

export const modelsInvokeRoute = defineRouteContract({
  name: 'models.invoke',
  input: z
    .object({
      providerId: EntityIdSchema.max(128),
      modelId: z.string().min(1).max(256),
      messages: z.array(ModelInvokeMessageSchema).min(1).max(128),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(1).max(1_000_000).optional()
    })
    .strict()
    .superRefine((input, context) => {
      const totalCharacters = input.messages.reduce(
        (total, message) => total + message.content.length,
        0
      )
      if (totalCharacters > MODEL_INVOKE_MAX_TOTAL_INPUT_CHARACTERS) {
        context.addIssue({
          code: 'custom',
          message: 'Model invocation input exceeds the total character limit',
          path: ['messages']
        })
      }
    }),
  output: z
    .object({
      providerId: EntityIdSchema.max(128),
      modelId: z.string().min(1).max(256),
      text: z.string().max(MODEL_INVOKE_MAX_OUTPUT_CHARACTERS),
      reasoning: z.string().max(MODEL_INVOKE_MAX_OUTPUT_CHARACTERS).optional(),
      usage: ModelInvokeUsageSchema.optional(),
      finishReason: z.enum(['tool_use', 'max_tokens', 'max_turn_requests', 'error', 'complete']),
      latency: ModelInvokeLatencySchema
    })
    .strict()
    .superRefine((output, context) => {
      if (
        output.text.length + (output.reasoning?.length ?? 0) >
        MODEL_INVOKE_MAX_OUTPUT_CHARACTERS
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Model invocation output exceeds the total character limit',
          path: ['text']
        })
      }
    })
})

export type ModelInvokeInput = z.infer<typeof modelsInvokeRoute.input>
export type ModelInvokeOutput = z.infer<typeof modelsInvokeRoute.output>
export type ModelInvokeEvent = z.infer<typeof ModelInvokeEventSchema>

export const modelsGetProviderCatalogRoute = defineRouteContract({
  name: 'models.getProviderCatalog',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    catalog: ProviderModelCatalogSchema
  })
})

export const modelsListRuntimeRoute = defineRouteContract({
  name: 'models.listRuntime',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    models: z.array(ProviderModelSummarySchema)
  })
})

export const modelsSetStatusRoute = defineRouteContract({
  name: 'models.setStatus',
  input: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1),
    enabled: z.boolean()
  }),
  output: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1),
    enabled: z.boolean()
  })
})

export const modelsAddCustomRoute = defineRouteContract({
  name: 'models.addCustom',
  input: z.object({
    providerId: EntityIdSchema,
    model: z.looseObject(
      ProviderModelSummarySchema.omit({
        providerId: true,
        group: true,
        isCustom: true
      }).shape
    )
  }),
  output: z.object({
    model: ProviderModelSummarySchema
  })
})

export const modelsRemoveCustomRoute = defineRouteContract({
  name: 'models.removeCustom',
  input: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1)
  }),
  output: z.object({
    removed: z.boolean()
  })
})

export const modelsUpdateCustomRoute = defineRouteContract({
  name: 'models.updateCustom',
  input: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1),
    updates: ProviderModelSummarySchema.partial()
  }),
  output: z.object({
    updated: z.boolean()
  })
})

export const modelsGetConfigRoute = defineRouteContract({
  name: 'models.getConfig',
  input: z.object({
    modelId: z.string().min(1),
    providerId: z.string().min(1).optional()
  }),
  output: z.object({
    config: ModelConfigSchema
  })
})

export const PublicModelConfigSchema = ModelConfigSchema.omit({
  conversationId: true,
  ownedBy: true
})
  .extend({
    maxTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    contextLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxCompletionTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()
  })
  .strip()

const PublicModelConfigInputSchema = PublicModelConfigSchema.omit({ isUserDefined: true }).strict()

export const modelsGetPublicConfigRoute = defineRouteContract({
  name: 'models.getPublicConfig',
  input: z
    .object({
      modelId: z.string().min(1),
      providerId: EntityIdSchema
    })
    .strict(),
  output: z.object({ config: PublicModelConfigSchema }).strict()
})

export const modelsSetPublicConfigRoute = defineRouteContract({
  name: 'models.setPublicConfig',
  input: z
    .object({
      modelId: z.string().min(1),
      providerId: EntityIdSchema,
      config: PublicModelConfigInputSchema
    })
    .strict(),
  output: modelsGetPublicConfigRoute.output
})

export const modelsSetConfigRoute = defineRouteContract({
  name: 'models.setConfig',
  input: z.object({
    modelId: z.string().min(1),
    providerId: EntityIdSchema,
    config: ModelConfigSchema
  }),
  output: z.object({
    config: ModelConfigSchema
  })
})

export const modelsResetConfigRoute = defineRouteContract({
  name: 'models.resetConfig',
  input: z.object({
    modelId: z.string().min(1),
    providerId: EntityIdSchema
  }),
  output: z.object({
    reset: z.boolean()
  })
})

export const modelsGetProviderConfigsRoute = defineRouteContract({
  name: 'models.getProviderConfigs',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    configs: z.array(ProviderModelConfigEntrySchema)
  })
})

export const modelsHasUserConfigRoute = defineRouteContract({
  name: 'models.hasUserConfig',
  input: z.object({
    modelId: z.string().min(1),
    providerId: EntityIdSchema
  }),
  output: z.object({
    hasConfig: z.boolean()
  })
})

export const modelsExportConfigsRoute = defineRouteContract({
  name: 'models.exportConfigs',
  input: z.object({}).default({}),
  output: z.object({
    configs: z.record(z.string(), ModelConfigExportEntrySchema)
  })
})

export const modelsImportConfigsRoute = defineRouteContract({
  name: 'models.importConfigs',
  input: z.object({
    configs: z.record(z.string(), ModelConfigExportEntrySchema),
    overwrite: z.boolean().default(false)
  }),
  output: z.object({
    imported: z.boolean(),
    overwrite: z.boolean()
  })
})

export const modelsSetBatchStatusRoute = defineRouteContract({
  name: 'models.setBatchStatus',
  input: z.object({
    providerId: EntityIdSchema,
    updates: z.array(
      z.object({
        modelId: z.string().min(1),
        enabled: z.boolean()
      })
    )
  }),
  output: z.object({
    results: z.array(
      z.object({
        modelId: z.string().min(1),
        enabled: z.boolean()
      })
    )
  })
})

export const modelsGetCapabilitiesRoute = defineRouteContract({
  name: 'models.getCapabilities',
  input: CapabilitySnapshotQuerySchema,
  output: z.object({
    capabilities: ModelCapabilitiesSchema
  })
})

export const modelsTranscribeAudioRoute = defineRouteContract({
  name: 'models.transcribeAudio',
  input: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1),
    audioBase64: z.string().min(1).max(15_000_000),
    mimeType: z.string().min(1).max(255),
    filename: z.string().min(1).max(255).optional()
  }),
  output: z.object({
    text: z.string()
  })
})
