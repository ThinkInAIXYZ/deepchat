import { z } from 'zod'
import { OrchestrationPolicySchema } from '../orchestration/policy'
import { ModelType, NEW_API_ENDPOINT_TYPES } from '../model'
import type { Agent } from '../types/agent-interface'
import {
  ReasoningEffortSchema,
  ReasoningVisibilitySchema,
  VerbositySchema
} from '../types/model-db'
import {
  OPENAI_IMAGE_GENERATION_BACKGROUND_VALUES,
  IMAGE_GENERATION_MODERATION_VALUES,
  IMAGE_GENERATION_OUTPUT_FORMAT_VALUES,
  IMAGE_GENERATION_QUALITY_VALUES
} from '../imageGenerationSettings'
import { TTS_RESPONSE_FORMAT_VALUES } from '../ttsSettings'
import {
  ATTACHMENT_FALLBACK_POLICIES,
  ATTACHMENT_OCR_MAX_TEXT_CHARACTERS,
  ATTACHMENT_OCR_MAX_TOKENS,
  ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS,
  ATTACHMENT_PDF_OCR_MAX_TOKENS,
  ATTACHMENT_PREPARATION_ACTIONS,
  ATTACHMENT_PREPARATION_MAX_ISSUES,
  ATTACHMENT_PREPARATION_STATUSES,
  ATTACHMENT_REPRESENTATION_PREFERENCES,
  ATTACHMENT_UNAVAILABLE_REASONS,
  PDF_LOW_TEXT_PAGE_SAMPLE_LIMIT,
  PDF_PAGE_COUNT_SANITY_LIMIT
} from '../types/attachment'
import { isValidDocumentOcrTextPageSpans } from '../utils/documentOcrText'
import { LiveDelegationSubagentContextSchema } from '../orchestration/liveDelegation'

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
export const SubmissionIdSchema = z.string().min(1).max(128)
export const TimestampMsSchema = z.number().int().nonnegative()

// A monotonically increasing state token. Unlike TimestampMsSchema, this is not
// tied to wall-clock time and is safe for ordered snapshot/event application.
export const RevisionSchema = z.number().int().nonnegative()

export const ToolCallImagePreviewSchema = z.object({
  id: z.string().min(1),
  data: z.string().min(1).nullable().optional(),
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
    z.record(z.string(), JsonValueSchema)
  ])
)

export const FileMetadataValueSchema = z.union([JsonValueSchema, z.date()])

export const ImageGenerationOptionsSchema = z
  .object({
    size: z.string().optional(),
    quality: z.enum(IMAGE_GENERATION_QUALITY_VALUES).optional(),
    outputFormat: z.enum(IMAGE_GENERATION_OUTPUT_FORMAT_VALUES).optional(),
    outputCompression: z.number().int().min(0).max(100).optional(),
    background: z.enum(OPENAI_IMAGE_GENERATION_BACKGROUND_VALUES).optional(),
    moderation: z.enum(IMAGE_GENERATION_MODERATION_VALUES).optional()
  })
  .optional()

export const VideoGenerationOptionsSchema = z
  .object({
    seconds: z.string().optional(),
    size: z.string().optional(),
    ratio: z.string().optional(),
    duration: z.number().int().min(-1).optional(),
    resolution: z.string().optional(),
    watermark: z.boolean().optional(),
    generateAudio: z.boolean().optional(),
    inputReference: z
      .union([
        z.string(),
        z.object({
          data: z.string(),
          mimeType: z.string().optional()
        })
      ])
      .optional(),
    references: z
      .array(
        z
          .object({
            type: z.enum(['image', 'video', 'audio']),
            url: z.string().optional(),
            data: z.string().optional(),
            mimeType: z.string().optional()
          })
          .refine((value) => Boolean(value.url || value.data))
      )
      .optional()
  })
  .optional()

export const TtsSettingsSchema = z
  .object({
    voice: z.string().optional(),
    responseFormat: z.enum(TTS_RESPONSE_FORMAT_VALUES).optional(),
    speed: z.number().min(0.25).max(4.0).optional(),
    instructions: z.string().optional()
  })
  .optional()

export const AppErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retriable: z.boolean().default(false),
  details: z.record(z.string(), JsonValueSchema).optional()
})

export const PermissionModeSchema = z.enum(['default', 'auto_approve', 'full_access'])
export const SessionStatusSchema = z.enum(['idle', 'generating', 'error'])
export const SessionKindSchema = z.enum(['regular', 'subagent'])
export const AgentTypeSchema = z.enum(['deepchat', 'acp'])
export const AgentSourceSchema = z.enum(['builtin', 'manual', 'registry'])
export const SessionCompactionStateSchema = z.object({
  status: z.enum(['idle', 'compacting', 'compacted']),
  cursorOrderSeq: z.number().int().positive(),
  summaryUpdatedAt: TimestampMsSchema.nullable()
})

export const DeepChatSubagentMetaSchema = z
  .object({
    slotId: EntityIdSchema,
    displayName: z.string(),
    targetAgentId: EntityIdSchema.nullable().optional(),
    liveDelegation: LiveDelegationSubagentContextSchema.optional()
  })
  .nullable()

export const SessionGenerationSettingsSchema = z.object({
  systemPrompt: z.string(),
  temperature: z.number(),
  topP: z.number().min(0.1).max(1).optional(),
  contextLength: z.number().int(),
  maxTokens: z.number().int(),
  timeout: z.number().int(),
  thinkingBudget: z.number().int().optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  reasoningVisibility: ReasoningVisibilitySchema.optional(),
  verbosity: VerbositySchema.optional(),
  forceInterleavedThinkingCompat: z.boolean().optional(),
  imageGeneration: ImageGenerationOptionsSchema,
  videoGeneration: VideoGenerationOptionsSchema
})

export const SessionGenerationSettingsPatchSchema = SessionGenerationSettingsSchema.partial()

export const AttachmentRepresentationPreferenceSchema = z.enum(
  ATTACHMENT_REPRESENTATION_PREFERENCES
)

export const AttachmentFallbackPolicySchema = z.enum(ATTACHMENT_FALLBACK_POLICIES)

export const AttachmentUnavailableReasonSchema = z.enum(ATTACHMENT_UNAVAILABLE_REASONS)

export const AttachmentPreparationSummarySchema = z.object({
  status: z.enum(ATTACHMENT_PREPARATION_STATUSES),
  issues: z
    .array(
      z.object({
        attachmentIndex: z.number().int().nonnegative(),
        reason: AttachmentUnavailableReasonSchema
      })
    )
    .max(ATTACHMENT_PREPARATION_MAX_ISSUES),
  suggestedActions: z.array(z.enum(ATTACHMENT_PREPARATION_ACTIONS)).max(3)
})

export const PdfEmbeddedTextCoverageSchema = z
  .object({
    routingRevision: z.string().min(1).max(128),
    pageCount: z.number().int().min(1).max(PDF_PAGE_COUNT_SANITY_LIMIT),
    substantivePageCount: z.number().int().nonnegative(),
    lowTextPageCount: z.number().int().nonnegative(),
    lowTextPageSamples: z.array(z.number().int().positive()).max(PDF_LOW_TEXT_PAGE_SAMPLE_LIMIT),
    hasEmbeddedText: z.boolean()
  })
  .superRefine((value, context) => {
    if (
      value.substantivePageCount > value.pageCount ||
      value.lowTextPageCount > value.pageCount ||
      value.substantivePageCount + value.lowTextPageCount !== value.pageCount ||
      value.lowTextPageSamples.length > value.lowTextPageCount ||
      (value.substantivePageCount > 0 && !value.hasEmbeddedText)
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid PDF embedded-text coverage' })
    }
    if (
      value.lowTextPageSamples.some(
        (pageNumber, index) =>
          pageNumber > value.pageCount ||
          (index > 0 && pageNumber <= value.lowTextPageSamples[index - 1])
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid PDF low-text page samples' })
    }
  })

const AttachmentDocumentPageSpanSchema = z.object({
  pageNumber: z.number().int().positive(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  complete: z.boolean()
})

const AttachmentDocumentOcrSnapshotSchema = z
  .object({
    pageSpans: z
      .array(AttachmentDocumentPageSpanSchema)
      .min(1)
      .max(ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS),
    sourcePageCountHint: z.number().int().min(1).max(PDF_PAGE_COUNT_SANITY_LIMIT).optional(),
    includedThroughPage: z.number().int().min(1).max(PDF_PAGE_COUNT_SANITY_LIMIT),
    includedThroughPageComplete: z.boolean(),
    artifactTermination: z.enum([
      'request_complete',
      'stopped_by_output_limit',
      'resource_limited'
    ]),
    generationOutputLimitReached: z.boolean(),
    embeddedTextCoverage: PdfEmbeddedTextCoverageSchema.optional()
  })
  .superRefine((value, context) => {
    const lastSpan = value.pageSpans.at(-1)
    if (!lastSpan) {
      context.addIssue({ code: 'custom', message: 'Document OCR coverage is empty' })
      return
    }
    const invalidSpans = value.pageSpans.some(
      (span, index) =>
        span.pageNumber !== index + 1 ||
        span.end < span.start ||
        (index === 0 ? span.start !== 0 : span.start !== value.pageSpans[index - 1].end) ||
        (!span.complete && index !== value.pageSpans.length - 1) ||
        (!span.complete && span.end === span.start)
    )
    if (
      invalidSpans ||
      value.includedThroughPage !== lastSpan.pageNumber ||
      value.includedThroughPageComplete !== lastSpan.complete ||
      (value.generationOutputLimitReached && lastSpan.complete) ||
      (value.artifactTermination === 'stopped_by_output_limit' &&
        !value.generationOutputLimitReached)
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid document OCR coverage' })
    }
  })

export const AttachmentResolvedRepresentationSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('image') }),
    z.object({ kind: z.literal('embedded_text') }),
    z.object({
      kind: z.literal('ocr_text'),
      text: z
        .string()
        .max(ATTACHMENT_OCR_MAX_TEXT_CHARACTERS)
        .refine((value) => value.trim().length > 0, { message: 'OCR text must not be blank' }),
      tokenCount: z.number().int().min(1).max(ATTACHMENT_PDF_OCR_MAX_TOKENS),
      truncated: z.boolean(),
      document: AttachmentDocumentOcrSnapshotSchema.optional()
    }),
    z.object({
      kind: z.literal('unavailable'),
      reason: AttachmentUnavailableReasonSchema
    })
  ])
  .superRefine((value, context) => {
    if (value.kind !== 'ocr_text') return
    if (!value.document && value.tokenCount > ATTACHMENT_OCR_MAX_TOKENS) {
      context.addIssue({ code: 'custom', message: 'Image OCR token count exceeds its limit' })
    }
    if (
      value.document &&
      value.truncated !==
        (value.document.generationOutputLimitReached ||
          value.document.artifactTermination === 'resource_limited')
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid document OCR truncation state' })
    }
    if (
      value.document &&
      !isValidDocumentOcrTextPageSpans(value.text, value.document.pageSpans, {
        maxSpans: ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS
      })
    ) {
      context.addIssue({ code: 'custom', message: 'Document OCR text coverage is incomplete' })
    }
  })

export const MessageFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.string().optional(),
  size: z.number().optional(),
  content: z.string().optional(),
  mimeType: z.string().optional(),
  token: z.number().optional(),
  thumbnail: z.string().optional(),
  metadata: z.record(z.string(), FileMetadataValueSchema).optional(),
  pdfTextCoverage: PdfEmbeddedTextCoverageSchema.optional(),
  requestedRepresentation: AttachmentRepresentationPreferenceSchema.optional()
})

export const UserMessageInlineItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('skill'),
    offset: z.number().int().nonnegative(),
    skillName: z.string()
  }),
  z.object({
    type: z.literal('file'),
    offset: z.number().int().nonnegative(),
    fileName: z.string(),
    filePath: z.string(),
    mimeType: z.string().optional()
  })
])

export const SendMessageInputSchema = z.object({
  text: z.string(),
  files: z.array(MessageFileSchema).optional(),
  activeSkills: z.array(z.string()).optional(),
  inlineItems: z.array(UserMessageInlineItemSchema).optional(),
  attachmentFallbackPolicy: AttachmentFallbackPolicySchema.optional()
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
  waitingForUserMessage: z.boolean().optional(),
  handledInline: z.boolean().optional()
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
  type: z.enum(ModelType).optional(),
  contextLength: z.number().int().optional(),
  maxTokens: z.number().int().optional(),
  description: z.string().optional(),
  supportedEndpointTypes: z.array(z.enum(NEW_API_ENDPOINT_TYPES)).optional(),
  selectableEndpointTypes: z.array(z.enum(NEW_API_ENDPOINT_TYPES)).optional(),
  endpointType: z.enum(NEW_API_ENDPOINT_TYPES).optional(),
  ownedBy: z.string().optional()
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
  subagentMeta: DeepChatSubagentMetaSchema.optional(),
  orchestrationPolicy: OrchestrationPolicySchema,
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
  revision: RevisionSchema.optional(),
  metadata: z
    .object({
      source: z.literal('cron_job'),
      cronJobId: EntityIdSchema,
      cronJobRunId: EntityIdSchema,
      scheduledAt: TimestampMsSchema
    })
    .nullable()
    .optional(),
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

export const MessagePageCursorSchema = z.object({
  orderSeq: z.number().int(),
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
  defaultProjectPath: z.string().nullable(),
  defaultChatWorkspacePath: z.string().nullable().optional()
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

export const ChatMessagePageResultSchema = z.object({
  messages: z.array(ChatMessageRecordSchema),
  nextCursor: MessagePageCursorSchema.nullable(),
  hasMore: z.boolean()
})

export const AssistantMessageBlockSchema = z.object({
  id: EntityIdSchema.optional(),
  type: z.enum([
    'content',
    'search',
    'reasoning_content',
    'plan',
    'error',
    'tool_call',
    'action',
    'image'
  ]),
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
      server_description: z.string().optional(),
      mcpResult: z
        .object({
          schemaVersion: z.literal(1),
          serverId: z.string().min(1).max(256),
          configGeneration: z.number().int().positive(),
          bindingHash: z.string().min(1).max(256),
          toolName: z.string().min(1).max(256),
          isError: z.boolean().optional(),
          content: z.array(JsonValueSchema).max(512).optional(),
          structuredContent: JsonValueSchema.optional(),
          meta: z.record(z.string(), JsonValueSchema).optional(),
          app: z
            .object({
              schemaVersion: z.literal(1),
              serverId: z.string().min(1).max(256),
              configGeneration: z.number().int().positive(),
              bindingHash: z.string().min(1).max(256),
              serverName: z.string().min(1).max(256),
              toolName: z.string().min(1).max(256),
              resourceUri: z.string().startsWith('ui://').max(4096),
              resourceMimeType: z.literal('text/html;profile=mcp-app')
            })
            .optional(),
          modelContext: z
            .object({
              content: z.array(JsonValueSchema).max(128).optional(),
              structuredContent: z.record(z.string(), JsonValueSchema).optional(),
              approvedHash: z.string().length(64).optional()
            })
            .optional(),
          truncated: z
            .object({
              content: z.boolean().optional(),
              structuredContent: z.boolean().optional(),
              meta: z.boolean().optional(),
              binaryContentOmitted: z.boolean().optional()
            })
            .optional()
        })
        .optional()
    })
    .optional(),
  extra: z.record(z.string(), JsonValueSchema).optional(),
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
