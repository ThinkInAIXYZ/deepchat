import { z } from 'zod'
import { ApiEndpointType, ModelType, NEW_API_ENDPOINT_TYPES } from '../model'
import { JsonValueSchema, ProviderModelSummarySchema } from './common'
import {
  ReasoningEffortSchema,
  ReasoningModeSchema,
  ReasoningVisibilitySchema,
  VerbositySchema
} from '../types/model-db'

export const ThemeModeSchema = z.enum(['dark', 'light', 'system'])

export const LanguageDirectionSchema = z.enum(['auto', 'rtl', 'ltr'])

export const ModelSelectionSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1)
})

export const DeepChatAgentModelPresetSchema = ModelSelectionSchema.extend({
  temperature: z.number().optional(),
  contextLength: z.number().int().optional(),
  maxTokens: z.number().int().optional(),
  thinkingBudget: z.number().int().optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  verbosity: VerbositySchema.optional(),
  forceInterleavedThinkingCompat: z.boolean().optional()
})

export const ProviderRateLimitStatusSchema = z.object({
  config: z.object({
    enabled: z.boolean(),
    qpsLimit: z.number()
  }),
  currentQps: z.number(),
  queueLength: z.number().int(),
  lastRequestTime: z.number().int()
})

export const LlmProviderSchema = z
  .object({
    id: z.string().min(1),
    capabilityProviderId: z.string().optional(),
    name: z.string(),
    apiType: z.string(),
    apiKey: z.string(),
    copilotClientId: z.string().optional(),
    baseUrl: z.string(),
    models: z.array(ProviderModelSummarySchema).optional(),
    customModels: z.array(ProviderModelSummarySchema).optional(),
    enable: z.boolean(),
    enabledModels: z.array(z.string()).optional(),
    disabledModels: z.array(z.string()).optional(),
    custom: z.boolean().optional(),
    oauthToken: z.string().optional(),
    websites: z
      .object({
        official: z.string(),
        apiKey: z.string(),
        name: z.string().optional(),
        icon: z.string().optional(),
        docs: z.string().optional(),
        models: z.string().optional(),
        defaultBaseUrl: z.string().optional()
      })
      .optional(),
    rateLimit: z
      .object({
        enabled: z.boolean(),
        qpsLimit: z.number()
      })
      .optional(),
    rateLimitConfig: z
      .object({
        enabled: z.boolean(),
        qpsLimit: z.number()
      })
      .optional(),
    credential: z
      .object({
        accessKeyId: z.string(),
        secretAccessKey: z.string(),
        region: z.string().optional()
      })
      .optional(),
    projectId: z.string().optional(),
    location: z.string().optional(),
    accountPrivateKey: z.string().optional(),
    accountClientEmail: z.string().optional(),
    apiVersion: z.enum(['v1', 'v1beta1']).optional(),
    endpointMode: z.enum(['standard', 'express']).optional()
  })
  .passthrough()

export const FileItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    type: z.string(),
    size: z.number().optional(),
    path: z.string(),
    description: z.string().optional(),
    content: z.string().optional(),
    createdAt: z.number().int().optional(),
    updatedAt: z.number().int().optional()
  })
  .passthrough()

export const PromptParameterSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean()
})

export const PromptMessageSchema = z.object({
  role: z.string(),
  content: z.object({
    text: z.string()
  })
})

export const PromptSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string(),
    content: z.string().optional(),
    parameters: z.array(PromptParameterSchema).optional(),
    files: z.array(FileItemSchema).optional(),
    messages: z.array(PromptMessageSchema).optional(),
    enabled: z.boolean().optional(),
    source: z.enum(['local', 'imported', 'builtin']).optional(),
    createdAt: z.number().int().optional(),
    updatedAt: z.number().int().optional()
  })
  .passthrough()

export const SystemPromptSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    content: z.string(),
    isDefault: z.boolean().optional(),
    createdAt: z.number().int().optional(),
    updatedAt: z.number().int().optional()
  })
  .passthrough()

export const ShortcutKeySettingSchema = z.record(z.string(), z.string())

export const ReasoningPortraitSchema = z
  .object({
    supported: z.boolean().optional(),
    defaultEnabled: z.boolean().optional(),
    mode: ReasoningModeSchema.optional(),
    budget: z
      .object({
        default: z.number().int().optional(),
        min: z.number().int().optional(),
        max: z.number().int().optional(),
        auto: z.number().int().optional(),
        off: z.number().int().optional(),
        unit: z.string().optional()
      })
      .optional(),
    effort: ReasoningEffortSchema.optional(),
    effortOptions: z.array(ReasoningEffortSchema).optional(),
    verbosity: VerbositySchema.optional(),
    verbosityOptions: z.array(VerbositySchema).optional(),
    level: z.string().optional(),
    levelOptions: z.array(z.string()).optional(),
    interleaved: z.boolean().optional(),
    summaries: z.boolean().optional(),
    visibility: ReasoningVisibilitySchema.optional(),
    continuation: z.array(z.string()).optional(),
    notes: z.array(z.string()).optional()
  })
  .passthrough()

export const ModelCapabilitiesSchema = z.object({
  supportsReasoning: z.boolean().nullable(),
  reasoningPortrait: ReasoningPortraitSchema.nullable(),
  thinkingBudgetRange: z
    .object({
      min: z.number().int().optional(),
      max: z.number().int().optional(),
      default: z.number().int().optional()
    })
    .nullable(),
  supportsSearch: z.boolean().nullable(),
  searchDefaults: z
    .object({
      default: z.boolean().optional(),
      forced: z.boolean().optional(),
      strategy: z.enum(['turbo', 'max']).optional()
    })
    .nullable(),
  supportsTemperatureControl: z.boolean().nullable(),
  temperatureCapability: z.boolean().nullable()
})

export const ModelConfigSchema = z
  .object({
    maxTokens: z.number().int(),
    contextLength: z.number().int(),
    temperature: z.number().optional(),
    vision: z.boolean(),
    functionCall: z.boolean(),
    reasoning: z.boolean(),
    type: z.nativeEnum(ModelType),
    isUserDefined: z.boolean().optional(),
    thinkingBudget: z.number().int().optional(),
    forceInterleavedThinkingCompat: z.boolean().optional(),
    reasoningEffort: ReasoningEffortSchema.optional(),
    reasoningVisibility: ReasoningVisibilitySchema.optional(),
    verbosity: VerbositySchema.optional(),
    maxCompletionTokens: z.number().int().optional(),
    conversationId: z.string().optional(),
    apiEndpoint: z.nativeEnum(ApiEndpointType).optional(),
    endpointType: z.enum(NEW_API_ENDPOINT_TYPES).optional(),
    enableSearch: z.boolean().optional(),
    forcedSearch: z.boolean().optional(),
    searchStrategy: z.enum(['turbo', 'balanced', 'precise']).optional()
  })
  .passthrough()

export const ProviderModelConfigEntrySchema = z.object({
  modelId: z.string().min(1),
  config: ModelConfigSchema
})

export const ModelConfigExportEntrySchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  config: ModelConfigSchema,
  source: z.enum(['user', 'provider', 'system']).optional()
})

export const ModelStatusMapSchema = z.record(z.string(), z.boolean())

export const ProviderModelCatalogSchema = z.object({
  providerModels: z.array(ProviderModelSummarySchema),
  customModels: z.array(ProviderModelSummarySchema),
  dbProviderModels: z.array(ProviderModelSummarySchema),
  modelStatusMap: ModelStatusMapSchema
})

export const AcpConfigOptionValueSchema = z
  .object({
    value: z.string(),
    label: z.string(),
    description: z.string().nullable().optional(),
    groupId: z.string().nullable().optional(),
    groupLabel: z.string().nullable().optional()
  })
  .passthrough()

export const AcpConfigOptionSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    description: z.string().nullable().optional(),
    type: z.enum(['select', 'boolean']),
    category: z.string().nullable().optional(),
    currentValue: z.union([z.string(), z.boolean()]),
    options: z.array(AcpConfigOptionValueSchema).optional()
  })
  .passthrough()

export const AcpConfigStateSchema = z.object({
  source: z.enum(['configOptions', 'legacy']),
  options: z.array(AcpConfigOptionSchema)
})

export const OllamaModelSchema = z
  .object({
    name: z.string(),
    model: z.string().optional(),
    size: z.number(),
    digest: z.string(),
    modified_at: z.union([z.string(), z.date()]),
    details: z
      .object({
        format: z.string(),
        family: z.string(),
        families: z.array(z.string()).optional(),
        parameter_size: z.string(),
        quantization_level: z.string()
      })
      .passthrough(),
    model_info: z
      .object({
        context_length: z.number().int().optional(),
        embedding_length: z.number().int().optional(),
        vision: z
          .object({
            embedding_length: z.number().int()
          })
          .optional(),
        general: z
          .object({
            architecture: z.string().optional(),
            file_type: z.string().optional(),
            parameter_count: z.number().optional(),
            quantization_version: z.number().optional()
          })
          .optional()
      })
      .passthrough()
      .optional(),
    capabilities: z.array(z.string()).optional()
  })
  .passthrough()

export const McpServerConfigSchema = z
  .object({
    type: z.string().optional(),
    enabled: z.boolean().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    name: z.string().optional(),
    env: z.record(z.string(), z.string()).optional()
  })
  .passthrough()

export const AcpAgentConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string().optional(),
    icon: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional()
  })
  .passthrough()

export const DeepChatAgentConfigSchema = z
  .object({
    defaultModelPreset: DeepChatAgentModelPresetSchema.nullable().optional(),
    assistantModel: ModelSelectionSchema.nullable().optional(),
    visionModel: ModelSelectionSchema.nullable().optional(),
    systemPrompt: z.string().optional(),
    permissionMode: z.enum(['default', 'full_access']).optional(),
    disabledAgentTools: z.array(z.string()).optional(),
    subagentEnabled: z.boolean().optional(),
    defaultProjectPath: z.string().nullable().optional()
  })
  .passthrough()

export const ConfigValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.null(),
  JsonValueSchema
])
