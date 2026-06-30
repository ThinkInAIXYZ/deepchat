import { z } from 'zod'
import { BrowserPageStatus } from '../types/browser'
import { ApiEndpointType, ModelType, NEW_API_ENDPOINT_TYPES } from '../model'
import {
  FileMetadataValueSchema,
  ImageGenerationOptionsSchema,
  VideoGenerationOptionsSchema,
  TtsSettingsSchema,
  JsonValueSchema,
  ProviderModelSummarySchema
} from './common'
import {
  ReasoningEffortSchema,
  ReasoningModeSchema,
  ReasoningVisibilitySchema,
  VerbositySchema
} from '../types/model-db'
import { ConflictStrategy } from '../types/skillSync'

export const ThemeModeSchema = z.enum(['dark', 'light', 'system'])

export const LanguageDirectionSchema = z.enum(['auto', 'rtl', 'ltr'])

export const ModelSelectionSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1)
})

export const BuiltinKnowledgeConfigSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  embedding: ModelSelectionSchema,
  rerank: ModelSelectionSchema.optional(),
  dimensions: z.number(),
  normalized: z.boolean(),
  chunkSize: z.number().optional(),
  chunkOverlap: z.number().optional(),
  fragmentsNumber: z.number(),
  separators: z.array(z.string()).optional(),
  enabled: z.boolean()
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

export const EmbeddingDimensionsSchema = z.object({
  dimensions: z.number(),
  normalized: z.boolean()
})

export const ModelScopeMcpSyncResultSchema = z.object({
  success: z.boolean().optional(),
  message: z.string().optional(),
  synced: z.number().int().nonnegative().optional(),
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.string())
})

export const AcpDebugActionSchema = z.enum([
  'initialize',
  'authenticate',
  'newSession',
  'loadSession',
  'sessionList',
  'sessionResume',
  'sessionClose',
  'sessionFork',
  'prompt',
  'cancel',
  'setSessionMode',
  'setSessionModel',
  'extMethod',
  'extNotification'
])

export const AcpDebugEventEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'request',
    'response',
    'notification',
    'permission',
    'lifecycle',
    'stderr',
    'error'
  ]),
  action: z.string(),
  agentId: z.string().min(1),
  sessionId: z.string().optional(),
  timestamp: z.number().int(),
  payload: z.unknown().optional(),
  message: z.string().optional()
})

export const AcpDebugRunResultSchema = z.object({
  status: z.enum(['ok', 'error']),
  sessionId: z.string().optional(),
  error: z.string().optional(),
  events: z.array(AcpDebugEventEntrySchema)
})

export const KnowledgeTaskStatusSchema = z.enum(['processing', 'completed', 'error', 'paused'])

export const KnowledgeFileMessageSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  path: z.string(),
  mimeType: z.string(),
  status: KnowledgeTaskStatusSchema,
  uploadedAt: z.number(),
  metadata: z.looseObject({
    size: z.number(),
    totalChunks: z.number(),
    errorReason: z.string().optional()
  })
})

export const KnowledgeFileResultSchema = z.object({
  data: KnowledgeFileMessageSchema.optional(),
  error: z.string().optional()
})

export const KnowledgeQueryResultSchema = z.object({
  id: z.string(),
  metadata: z.looseObject({
    from: z.string(),
    filePath: z.string(),
    content: z.string()
  }),
  distance: z.number()
})

export const KnowledgeFileValidationResultSchema = z.object({
  isSupported: z.boolean(),
  mimeType: z.string().optional(),
  adapterType: z.string().optional(),
  error: z.string().optional(),
  suggestedExtensions: z.array(z.string()).optional()
})

export const KnowledgeFileProgressSchema = z.object({
  fileId: z.string().min(1),
  completed: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  total: z.number().int().nonnegative()
})

export const SkillSyncConflictStrategySchema = z.enum(ConflictStrategy)

export const SkillSyncExternalSkillInfoSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string().optional(),
  path: z.string(),
  format: z.string(),
  lastModified: z.coerce.date()
})

export const SkillSyncScanResultSchema = z.looseObject({
  toolId: z.string().min(1),
  toolName: z.string(),
  available: z.boolean(),
  skillsDir: z.string(),
  skills: z.array(SkillSyncExternalSkillInfoSchema),
  error: z.string().optional()
})

export const SkillSyncCanonicalSkillSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string(),
  instructions: z.string(),
  allowedTools: z.array(z.string()).optional(),
  model: z.string().optional(),
  tags: z.array(z.string()).optional(),
  references: z
    .array(
      z.looseObject({
        name: z.string(),
        content: z.string(),
        relativePath: z.string()
      })
    )
    .optional(),
  scripts: z
    .array(
      z.looseObject({
        name: z.string(),
        content: z.string(),
        relativePath: z.string()
      })
    )
    .optional(),
  source: z
    .looseObject({
      tool: z.string(),
      originalPath: z.string(),
      originalFormat: z.string()
    })
    .optional()
})

export const SkillSyncImportPreviewSchema = z.looseObject({
  skill: SkillSyncCanonicalSkillSchema,
  source: SkillSyncExternalSkillInfoSchema,
  conflict: z
    .looseObject({
      existingSkillName: z.string(),
      strategy: SkillSyncConflictStrategySchema
    })
    .optional(),
  warnings: z.array(z.string())
})

export const SkillSyncExportPreviewSchema = z.looseObject({
  skillName: z.string().min(1),
  targetTool: z.string().min(1),
  targetPath: z.string(),
  convertedContent: z.string(),
  warnings: z.array(z.string()),
  conflict: z
    .looseObject({
      existingPath: z.string(),
      strategy: SkillSyncConflictStrategySchema
    })
    .optional(),
  exportOptions: z.record(z.string(), z.unknown()).optional()
})

export const SkillSyncResultSchema = z.looseObject({
  success: z.boolean(),
  imported: z.number().int().nonnegative(),
  exported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.array(
    z.looseObject({
      skill: z.string(),
      reason: z.string()
    })
  )
})

export const SkillSyncFormatCapabilitiesSchema = z.looseObject({
  hasFrontmatter: z.boolean(),
  supportsName: z.boolean(),
  supportsDescription: z.boolean(),
  supportsTools: z.boolean(),
  supportsModel: z.boolean(),
  supportsSubfolders: z.boolean(),
  supportsReferences: z.boolean(),
  supportsScripts: z.boolean()
})

export const SkillSyncExternalToolConfigSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  skillsDir: z.string(),
  filePattern: z.string(),
  format: z.string(),
  capabilities: SkillSyncFormatCapabilitiesSchema,
  isProjectLevel: z.boolean().optional()
})

export const SkillSyncNewDiscoverySchema = z.looseObject({
  toolId: z.string().min(1),
  toolName: z.string(),
  newSkills: z.array(SkillSyncExternalSkillInfoSchema)
})

export const SkillSyncOperationProgressSchema = z.looseObject({
  current: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  skillName: z.string(),
  status: z.enum(['success', 'failed', 'skipped'])
})

export const UsageStatsBackfillStatusSchema = z.object({
  status: z.enum(['idle', 'running', 'completed', 'failed']),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  error: z.string().nullable(),
  updatedAt: z.number()
})

export const UsageDashboardSummarySchema = z.object({
  messageCount: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative(),
  cacheHitRate: z.number(),
  estimatedCostUsd: z.number().nullable(),
  mostActiveDay: z.object({
    date: z.string().nullable(),
    messageCount: z.number().int().nonnegative()
  })
})

export const UsageDashboardCalendarDaySchema = z.object({
  date: z.string(),
  messageCount: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative(),
  estimatedCostUsd: z.number().nullable(),
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
})

export const UsageDashboardBreakdownItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  messageCount: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative(),
  estimatedCostUsd: z.number().nullable()
})

export const UsageDashboardRtkSummarySchema = z.object({
  totalCommands: z.number().int().nonnegative(),
  totalInputTokens: z.number().nonnegative(),
  totalOutputTokens: z.number().nonnegative(),
  totalSavedTokens: z.number().nonnegative(),
  avgSavingsPct: z.number(),
  totalTimeMs: z.number().nonnegative(),
  avgTimeMs: z.number().nonnegative()
})

export const UsageDashboardRtkDaySchema = z.object({
  date: z.string(),
  commands: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  savedTokens: z.number().nonnegative(),
  savingsPct: z.number(),
  totalTimeMs: z.number().nonnegative(),
  avgTimeMs: z.number().nonnegative()
})

export const UsageDashboardRtkDataSchema = z.object({
  scope: z.literal('deepchat'),
  enabled: z.boolean(),
  effectiveEnabled: z.boolean(),
  available: z.boolean(),
  health: z.enum(['checking', 'healthy', 'unhealthy']),
  checkedAt: z.number().nullable(),
  source: z.enum(['bundled', 'system', 'none']),
  failureStage: z.enum(['resolve', 'version', 'rewrite', 'smoke', 'gain', 'runtime']).nullable(),
  failureMessage: z.string().nullable(),
  summary: UsageDashboardRtkSummarySchema,
  daily: z.array(UsageDashboardRtkDaySchema)
})

export const UsageDashboardDataSchema = z.object({
  recordingStartedAt: z.number().nullable(),
  backfillStatus: UsageStatsBackfillStatusSchema,
  summary: UsageDashboardSummarySchema,
  calendar: z.array(UsageDashboardCalendarDaySchema),
  providerBreakdown: z.array(UsageDashboardBreakdownItemSchema),
  modelBreakdown: z.array(UsageDashboardBreakdownItemSchema),
  rtk: UsageDashboardRtkDataSchema
})

export const LlmProviderSchema = z.looseObject({
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
      authMode: z.enum(['accessKeys', 'profile']).optional(),
      accessKeyId: z.string(),
      secretAccessKey: z.string(),
      region: z.string().optional(),
      profile: z.string().optional()
    })
    .optional(),
  projectId: z.string().optional(),
  location: z.string().optional(),
  accountPrivateKey: z.string().optional(),
  accountClientEmail: z.string().optional(),
  apiVersion: z.enum(['v1', 'v1beta1']).optional(),
  endpointMode: z.enum(['standard', 'express']).optional()
})

export const LlmProviderSummarySchema = LlmProviderSchema.omit({
  models: true,
  customModels: true,
  enabledModels: true,
  disabledModels: true
})

export const FileItemSchema = z.looseObject({
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

export const PromptSchema = z.looseObject({
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

export const SystemPromptSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  content: z.string(),
  isDefault: z.boolean().optional(),
  createdAt: z.number().int().optional(),
  updatedAt: z.number().int().optional()
})

export const ShortcutKeySettingSchema = z.record(z.string(), z.string())

export const ReasoningPortraitSchema = z.looseObject({
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

export const ModelCapabilitiesSchema = z.object({
  supportsAudioInput: z.boolean().nullable(),
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

export const ModelConfigSchema = z.looseObject({
  maxTokens: z.number().int(),
  contextLength: z.number().int(),
  temperature: z.number().optional(),
  topP: z.number().min(0.1).max(1).optional(),
  vision: z.boolean(),
  speechRecognition: z.boolean().optional(),
  functionCall: z.boolean(),
  reasoning: z.boolean(),
  type: z.enum(ModelType),
  isUserDefined: z.boolean().optional(),
  thinkingBudget: z.number().int().optional(),
  forceInterleavedThinkingCompat: z.boolean().optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  reasoningVisibility: ReasoningVisibilitySchema.optional(),
  verbosity: VerbositySchema.optional(),
  maxCompletionTokens: z.number().int().optional(),
  conversationId: z.string().optional(),
  apiEndpoint: z.enum(ApiEndpointType).optional(),
  endpointType: z.enum(NEW_API_ENDPOINT_TYPES).optional(),
  ownedBy: z.string().optional(),
  enableSearch: z.boolean().optional(),
  forcedSearch: z.boolean().optional(),
  searchStrategy: z.enum(['turbo', 'balanced', 'precise']).optional(),
  imageGeneration: ImageGenerationOptionsSchema,
  videoGeneration: VideoGenerationOptionsSchema,
  tts: TtsSettingsSchema
})

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

export const AcpConfigOptionValueSchema = z.looseObject({
  value: z.string(),
  label: z.string(),
  description: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  groupLabel: z.string().nullable().optional()
})

export const AcpConfigOptionSchema = z.looseObject({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable().optional(),
  type: z.enum(['select', 'boolean']),
  category: z.string().nullable().optional(),
  currentValue: z.union([z.string(), z.boolean()]),
  options: z.array(AcpConfigOptionValueSchema).optional()
})

export const AcpConfigStateSchema = z.object({
  source: z.enum(['configOptions', 'legacy']),
  options: z.array(AcpConfigOptionSchema)
})

export const OllamaModelSchema = z.looseObject({
  name: z.string(),
  model: z.string().optional(),
  size: z.number(),
  digest: z.string(),
  modified_at: z.union([z.string(), z.date()]),
  details: z.looseObject({
    format: z.string(),
    family: z.string(),
    families: z.array(z.string()).optional(),
    parameter_size: z.string(),
    quantization_level: z.string()
  }),
  model_info: z
    .looseObject({
      context_length: z.number().int().optional(),
      embedding_length: z.number().int().optional(),
      vision: z
        .looseObject({
          embedding_length: z.number().int()
        })
        .optional(),
      general: z
        .looseObject({
          architecture: z.string().optional(),
          file_type: z.string().optional(),
          parameter_count: z.number().optional(),
          quantization_version: z.number().optional()
        })
        .optional()
    })
    .optional(),
  capabilities: z.array(z.string()).optional()
})

export const McpServerConfigSchema = z.looseObject({
  type: z.string().optional(),
  enabled: z.boolean().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  name: z.string().optional(),
  env: z.record(z.string(), z.unknown()).optional()
})

export const AcpAgentConfigSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional()
})

export const DeepChatAgentConfigSchema = z.looseObject({
  defaultModelPreset: DeepChatAgentModelPresetSchema.nullable().optional(),
  assistantModel: ModelSelectionSchema.nullable().optional(),
  visionModel: ModelSelectionSchema.nullable().optional(),
  imageGenerationModel: ModelSelectionSchema.nullable().optional(),
  systemPrompt: z.string().optional(),
  permissionMode: z.enum(['default', 'full_access']).optional(),
  disabledAgentTools: z.array(z.string()).optional(),
  enabledPluginIds: z.array(z.string()).nullable().optional(),
  enabledSkillNames: z.array(z.string()).nullable().optional(),
  enabledMcpServerIds: z.array(z.string()).nullable().optional(),
  subagentEnabled: z.boolean().optional(),
  defaultProjectPath: z.string().nullable().optional()
})

export const ConfigValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.null(),
  JsonValueSchema
])

export const PreparedMessageFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.string().optional(),
  size: z.number().optional(),
  content: z.string().optional(),
  mimeType: z.string().optional(),
  token: z.number().optional(),
  thumbnail: z.string().optional(),
  metadata: z.record(z.string(), FileMetadataValueSchema).optional()
})

export const DeviceInfoSchema = z.object({
  platform: z.string(),
  arch: z.string(),
  cpuModel: z.string(),
  totalMemory: z.number(),
  osVersion: z.string(),
  osVersionMetadata: z.array(
    z.object({
      name: z.string(),
      build: z.number().int()
    })
  )
})

export const ProjectSchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  icon: z.string().nullable(),
  lastAccessedAt: z.number().int(),
  exists: z.boolean()
})

export const EnvironmentSummarySchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  sessionCount: z.number().int(),
  lastUsedAt: z.number().int(),
  isTemp: z.boolean(),
  exists: z.boolean(),
  status: z.enum(['active', 'archived', 'removed']),
  sortOrder: z.number().int(),
  archivedAt: z.number().int().nullable(),
  removedAt: z.number().int().nullable()
})

export const WorkspaceInvalidationKindSchema = z.enum(['fs', 'git', 'full'])
export const WorkspaceInvalidationSourceSchema = z.enum(['watcher', 'fallback', 'lifecycle'])
export const WorkspaceWatchHealthSchema = z.enum(['healthy', 'degraded', 'failed'])
export const WorkspaceWatchModeSchema = z.enum([
  'native',
  'snapshot-polling',
  'git-metadata-polling'
])
export const WorkspaceWatchStatusReasonSchema = z.enum([
  'ready',
  'native-error',
  'utility-exit',
  'fallback-started',
  'overflow',
  'root-deleted',
  'shutdown'
])
export const WorkspaceFilePreviewKindSchema = z.enum([
  'text',
  'markdown',
  'html',
  'pdf',
  'svg',
  'image',
  'binary'
])
export const WorkspaceGitChangeTypeSchema = z.enum([
  'modified',
  'added',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'ignored',
  'unmerged'
])

export const WorkspaceFileNodeSchema: z.ZodType<{
  name: string
  path: string
  isDirectory: boolean
  children?: Array<{
    name: string
    path: string
    isDirectory: boolean
    children?: unknown[]
    expanded?: boolean
  }>
  expanded?: boolean
}> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    isDirectory: z.boolean(),
    children: z.array(WorkspaceFileNodeSchema).optional(),
    expanded: z.boolean().optional()
  })
)

export const WorkspaceFileMetadataSchema = z.object({
  fileName: z.string(),
  fileSize: z.number(),
  fileDescription: z.string().optional(),
  fileCreated: z.date(),
  fileModified: z.date()
})

export const WorkspaceFilePreviewSchema = z.object({
  path: z.string(),
  relativePath: z.string(),
  name: z.string(),
  mimeType: z.string(),
  kind: WorkspaceFilePreviewKindSchema,
  content: z.string(),
  previewUrl: z.string().optional(),
  thumbnail: z.string().optional(),
  language: z.string().nullable().optional(),
  metadata: WorkspaceFileMetadataSchema
})

export const WorkspaceGitFileChangeSchema = z.object({
  path: z.string(),
  relativePath: z.string(),
  previousPath: z.string().nullable().optional(),
  stagedStatus: z.string().nullable(),
  unstagedStatus: z.string().nullable(),
  type: WorkspaceGitChangeTypeSchema
})

export const WorkspaceGitStateSchema = z.object({
  workspacePath: z.string(),
  branch: z.string().nullable(),
  ahead: z.number().int(),
  behind: z.number().int(),
  changes: z.array(WorkspaceGitFileChangeSchema)
})

export const WorkspaceGitDiffSchema = z.object({
  workspacePath: z.string(),
  filePath: z.string().nullable(),
  relativePath: z.string().nullable(),
  staged: z.string(),
  unstaged: z.string()
})

export const WorkspaceLinkedFileResolutionSchema = z.object({
  path: z.string(),
  name: z.string(),
  relativePath: z.string(),
  workspaceRoot: z.string().nullable()
})

export const BrowserPageInfoSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  favicon: z.string().optional(),
  status: z.enum(BrowserPageStatus),
  createdAt: z.number().int(),
  updatedAt: z.number().int()
})

export const YoBrowserStatusSchema = z.object({
  initialized: z.boolean(),
  page: BrowserPageInfoSchema.nullable(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  visible: z.boolean(),
  loading: z.boolean()
})

export const RectangleSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})

export const WindowStateSchema = z.object({
  windowId: z.number().int().nullable(),
  exists: z.boolean(),
  isMaximized: z.boolean(),
  isFullScreen: z.boolean(),
  isFocused: z.boolean()
})
