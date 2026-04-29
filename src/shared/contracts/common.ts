import { z } from 'zod'
import { ModelType, NEW_API_ENDPOINT_TYPES } from '../model'
import type { Agent } from '../types/agent-interface'
import {
  ReasoningEffortSchema,
  ReasoningVisibilitySchema,
  VerbositySchema
} from '../types/model-db'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [key: string]: JsonValue
    }

export const EntityIdSchema = z.string().min(1)
export const TimestampMsSchema = z.number().int().nonnegative()

export const ToolCallImagePreviewSchema = z.object({
  id: z.string().min(1),
  data: z.string().min(1),
  mimeType: z.string().min(1),
  title: z.string().optional(),
  source: z.enum(['tool_output', 'file_read', 'screenshot', 'mcp_image'])
})

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema)
  ])
)

export const FileMetadataValueSchema = z.union([JsonValueSchema, z.date()])

export const AppErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retriable: z.boolean().default(false),
  details: z.record(JsonValueSchema).optional()
})

export const PermissionModeSchema = z.enum(['default', 'full_access'])
export const SessionStatusSchema = z.enum(['idle', 'generating', 'error'])
export const SessionKindSchema = z.enum(['regular', 'subagent'])
export const AgentTypeSchema = z.enum(['deepchat', 'acp'])
export const AgentSourceSchema = z.enum(['builtin', 'manual', 'registry'])

export const DeepChatSubagentMetaSchema = z
  .object({
    slotId: EntityIdSchema,
    displayName: z.string(),
    targetAgentId: EntityIdSchema.nullable().optional()
  })
  .nullable()

export const SessionGenerationSettingsSchema = z.object({
  systemPrompt: z.string(),
  temperature: z.number(),
  contextLength: z.number().int(),
  maxTokens: z.number().int(),
  timeout: z.number().int(),
  thinkingBudget: z.number().int().optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  reasoningVisibility: ReasoningVisibilitySchema.optional(),
  verbosity: VerbositySchema.optional(),
  forceInterleavedThinkingCompat: z.boolean().optional()
})

export const SessionGenerationSettingsPatchSchema = SessionGenerationSettingsSchema.partial()

export const MessageFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.string().optional(),
  size: z.number().optional(),
  content: z.string().optional(),
  mimeType: z.string().optional(),
  token: z.number().optional(),
  thumbnail: z.string().optional(),
  metadata: z.record(FileMetadataValueSchema).optional()
})

export const SendMessageInputSchema = z.object({
  text: z.string(),
  files: z.array(MessageFileSchema).optional()
})

export const ToolInteractionResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('permission'),
    granted: z.boolean()
  }),
  z.object({
    kind: z.literal('question_option'),
    optionLabel: z.string()
  }),
  z.object({
    kind: z.literal('question_custom'),
    answerText: z.string()
  }),
  z.object({
    kind: z.literal('question_other')
  })
])

export const ToolInteractionResultSchema = z.object({
  resumed: z.boolean().optional(),
  waitingForUserMessage: z.boolean().optional()
})

export const ProviderModelSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  group: z.string(),
  providerId: z.string(),
  enabled: z.boolean().optional(),
  isCustom: z.boolean().optional(),
  vision: z.boolean().optional(),
  functionCall: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  enableSearch: z.boolean().optional(),
  type: z.nativeEnum(ModelType).optional(),
  contextLength: z.number().int().optional(),
  maxTokens: z.number().int().optional(),
  description: z.string().optional(),
  supportedEndpointTypes: z.array(z.enum(NEW_API_ENDPOINT_TYPES)).optional(),
  endpointType: z.enum(NEW_API_ENDPOINT_TYPES).optional()
})

export const SessionWithStateSchema = z.object({
  id: EntityIdSchema,
  agentId: EntityIdSchema,
  title: z.string(),
  projectDir: z.string().nullable(),
  isPinned: z.boolean(),
  isDraft: z.boolean().optional(),
  sessionKind: SessionKindSchema,
  parentSessionId: EntityIdSchema.nullable().optional(),
  subagentEnabled: z.boolean(),
  subagentMeta: DeepChatSubagentMetaSchema.optional(),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
  status: SessionStatusSchema,
  providerId: z.string(),
  modelId: z.string()
})

export const SessionListItemSchema = SessionWithStateSchema.omit({
  providerId: true,
  modelId: true
})

export const ActiveSessionSummarySchema = SessionWithStateSchema

export const SessionPageCursorSchema = z.object({
  updatedAt: TimestampMsSchema,
  id: EntityIdSchema
})

export const AgentBootstrapItemSchema = z.object({
  id: EntityIdSchema,
  name: z.string(),
  type: AgentTypeSchema,
  agentType: AgentTypeSchema.optional(),
  enabled: z.boolean(),
  protected: z.boolean().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  source: AgentSourceSchema.optional(),
  avatar: z.custom<Agent['avatar']>().optional()
})

export const StartupBootstrapShellSchema = z.object({
  startupRunId: z.string(),
  activeSessionId: EntityIdSchema.nullable(),
  activeSession: SessionListItemSchema.nullable().optional(),
  agents: z.array(AgentBootstrapItemSchema),
  defaultProjectPath: z.string().nullable()
})

export const StartupWorkloadTargetSchema = z.enum(['main', 'settings'])
export const StartupWorkloadPhaseSchema = z.enum(['interactive', 'deferred', 'background'])
export const StartupWorkloadStateSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled'
])
export const StartupWorkloadTaskIdSchema = z.enum([
  'main.bootstrap',
  'main.session.firstPage',
  'main.provider.warmup',
  'settings.providers.summary',
  'settings.provider.models',
  'settings.ollama',
  'settings.skills.catalog',
  'settings.skills.syncScan',
  'settings.mcp.runtime',
  'settings.remote.runtime'
])

export const StartupWorkloadTaskSchema = z.object({
  id: StartupWorkloadTaskIdSchema,
  phase: StartupWorkloadPhaseSchema,
  state: StartupWorkloadStateSchema,
  labelKey: z.string().min(1),
  progress: z.number().min(0).max(1).optional(),
  startedAt: TimestampMsSchema.optional(),
  updatedAt: TimestampMsSchema.optional()
})

export const StartupWorkloadChangedPayloadSchema = z.object({
  startupRunId: z.string(),
  target: StartupWorkloadTargetSchema,
  tasks: z.array(StartupWorkloadTaskSchema)
})

export const ChatMessageRecordSchema = z.object({
  id: EntityIdSchema,
  sessionId: EntityIdSchema,
  orderSeq: z.number().int(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  status: z.enum(['pending', 'sent', 'error']),
  isContextEdge: z.number().int(),
  metadata: z.string(),
  traceCount: z.number().int().optional(),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema
})

export const AssistantMessageBlockSchema = z.object({
  id: EntityIdSchema.optional(),
  type: z.enum(['content', 'search', 'reasoning_content', 'error', 'tool_call', 'action', 'image']),
  content: z.string().optional(),
  status: z.enum(['pending', 'success', 'error', 'loading', 'granted', 'denied']),
  timestamp: TimestampMsSchema,
  reasoning_time: z
    .union([
      z.number(),
      z.object({
        start: TimestampMsSchema,
        end: TimestampMsSchema
      })
    ])
    .optional(),
  image_data: z
    .object({
      data: z.string(),
      mimeType: z.string()
    })
    .optional(),
  tool_call: z
    .object({
      id: EntityIdSchema.optional(),
      name: z.string().optional(),
      params: z.string().optional(),
      response: z.string().optional(),
      rtkApplied: z.boolean().optional(),
      rtkMode: z.enum(['rewrite', 'direct', 'bypass']).optional(),
      rtkFallbackReason: z.string().optional(),
      imagePreviews: z.array(ToolCallImagePreviewSchema).optional(),
      server_name: z.string().optional(),
      server_icons: z.string().optional(),
      server_description: z.string().optional()
    })
    .optional(),
  extra: z.record(JsonValueSchema).optional(),
  action_type: z.enum(['tool_call_permission', 'question_request', 'rate_limit']).optional()
})

export interface RouteContract<
  Name extends string = string,
  InputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny = z.ZodTypeAny
> {
  name: Name
  input: InputSchema
  output: OutputSchema
}

export interface EventContract<
  Name extends string = string,
  PayloadSchema extends z.ZodTypeAny = z.ZodTypeAny
> {
  name: Name
  payload: PayloadSchema
}

export function defineRouteContract<
  const Name extends string,
  InputSchema extends z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny
>(contract: {
  name: Name
  input: InputSchema
  output: OutputSchema
}): RouteContract<Name, InputSchema, OutputSchema> {
  return contract
}

export function defineEventContract<
  const Name extends string,
  PayloadSchema extends z.ZodTypeAny
>(contract: { name: Name; payload: PayloadSchema }): EventContract<Name, PayloadSchema> {
  return contract
}
