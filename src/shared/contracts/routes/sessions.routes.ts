import { z } from 'zod'
import { OrchestrationPolicySchema } from '../../orchestration/policy'
import { ToolModeSchema } from '../../toolMode'
import type { SearchResult } from '@shared/types/core/search'
import type {
  Agent,
  AgentTransferImpact,
  AgentTapeContextResult,
  MessageTraceRecord,
  PendingSessionInputRecord
} from '@shared/types/agent-interface'
import type { DeepChatTapeReplaySlice } from '@shared/types/tape-replay'
import type { DeepChatTapeViewManifestRecord } from '@shared/types/tape-view-manifest'
import type {
  ExportTapeInspectorSupportTraceInput,
  ExportTapeInspectorSupportTraceOutput,
  GetTapeInspectorRecordDetailInput,
  GetTapeInspectorRecordDetailOutput,
  ListTapeInspectorEvidenceInput,
  ListTapeInspectorEvidenceOutput,
  ListTapeInspectorPageInput,
  ListTapeInspectorPageOutput,
  ResolveTapeInspectorEvidenceEntriesInput,
  ResolveTapeInspectorEvidenceEntriesOutput,
  TapeInspectorEvidenceRecord,
  TapeInspectorFactRecord,
  TapeInspectorRecordDetail
} from '@shared/types/tape-inspector'
import {
  TAPE_INSPECTOR_SUPPORT_EVIDENCE_LIMIT,
  TAPE_INSPECTOR_SUPPORT_FACT_LIMIT
} from '@shared/types/tape-inspector'
import {
  DEEPCHAT_NESTED_EXECUTION_AUDIT_OPERATION_LIMIT,
  type DeepChatNestedExecutionAudit
} from '@shared/types/execution-journal-audit'
import {
  AttachmentFallbackPolicySchema,
  AttachmentPreparationSummarySchema,
  SessionListItemSchema,
  SessionPageCursorSchema,
  MessagePageCursorSchema,
  ChatMessageRecordSchema,
  ChatMessagePageResultSchema,
  EntityIdSchema,
  JsonValueSchema,
  MessageFileSchema,
  UserMessageInlineItemSchema,
  PermissionModeSchema,
  SendMessageInputSchema,
  SessionCompactionSnapshotSchema,
  SessionCompactionStateSchema,
  SessionContextOccupancySnapshotSchema,
  SessionGenerationSettingsSchema,
  SessionGenerationSettingsPatchSchema,
  SubmissionIdSchema,
  SessionWithStateSchema,
  defineRouteContract
} from '../common'
import type { RouteContract } from '../common'
import { AcpConfigStateSchema, UsageDashboardDataSchema } from '../domainSchemas'
import { PROGRAMMATIC_TOOL_BATCH_MAX_STEPS } from './tools.routes'
import { AcpAuthChallengeSchema } from './acp-auth.routes'

const PendingSessionInputRecordSchema = z.custom<PendingSessionInputRecord>()
const MessageTraceRecordSchema = z.custom<MessageTraceRecord>()
const AgentTapeContextResultSchema = z.custom<AgentTapeContextResult>()
const DeepChatTapeViewManifestRecordSchema = z.custom<DeepChatTapeViewManifestRecord>()
const DeepChatTapeReplaySliceSchema = z.custom<DeepChatTapeReplaySlice>().nullable()
const ExecutionAuditIdentitySchema = z.string().min(1).max(1_024)
const ExecutionAuditHashSchema = z.string().regex(/^[0-9a-f]{64}$/u)
const TapeInspectorIdentitySchema = z.string().min(1).max(1_024)
const TapeInspectorSubscriptionIdSchema = z.string().min(1).max(128)
const TapeInspectorListTextSchema = z.string().max(1_024)
const TapeInspectorEntryKindSchema = z.enum([
  'event',
  'anchor',
  'message',
  'tool_call',
  'tool_result',
  'context'
])
const TapeInspectorFactFamilySchema = z.enum([
  'context',
  'journal',
  'contract',
  'view',
  'attempt',
  'anchor',
  'message',
  'lineage',
  'tool',
  'other'
])
const TapeInspectorSourceTypeSchema = z.enum([
  'session',
  'message',
  'assistant_block',
  'tool_call',
  'tool_result',
  'runtime_event',
  'migration',
  'summary',
  'fork',
  'subagent'
])
const TapeInspectorEntryCursorSchema = z.discriminatedUnion('sort', [
  z.object({
    sort: z.literal('entryId'),
    entryId: z.number().int().positive()
  }),
  z.object({
    sort: z.literal('name'),
    direction: z.enum(['asc', 'desc']),
    nameHash: ExecutionAuditHashSchema,
    entryId: z.number().int().positive(),
    snapshotMaxEntryId: z.number().int().positive()
  }),
  z.object({
    sort: z.literal('kind'),
    direction: z.enum(['asc', 'desc']),
    kind: TapeInspectorEntryKindSchema,
    entryId: z.number().int().positive(),
    snapshotMaxEntryId: z.number().int().positive()
  }),
  z.object({
    sort: z.literal('createdAt'),
    direction: z.enum(['asc', 'desc']),
    createdAt: z.number().int().nonnegative(),
    entryId: z.number().int().positive(),
    snapshotMaxEntryId: z.number().int().positive()
  })
])
const TapeInspectorSortSchema = z.discriminatedUnion('column', [
  z.object({
    column: z.literal('entryId'),
    direction: z.literal('asc')
  }),
  z.object({
    column: z.enum(['name', 'kind', 'createdAt']),
    direction: z.enum(['asc', 'desc'])
  })
])
const TapeInspectorFactsSchema = z.object({
  toolName: TapeInspectorListTextSchema.optional(),
  toolSource: z.enum(['agent', 'mcp']).optional(),
  targetServer: TapeInspectorListTextSchema.optional(),
  contentPreview: TapeInspectorListTextSchema.optional(),
  providerId: TapeInspectorListTextSchema.optional(),
  modelId: TapeInspectorListTextSchema.optional(),
  status: TapeInspectorListTextSchema.optional(),
  outcome: TapeInspectorListTextSchema.optional(),
  stopReason: TapeInspectorListTextSchema.optional(),
  retryDecision: TapeInspectorListTextSchema.optional(),
  errorCode: TapeInspectorListTextSchema.optional(),
  isError: z.boolean().optional(),
  selectedCount: z.number().int().nonnegative().optional(),
  droppedCount: z.number().int().nonnegative().optional(),
  tokenBudget: z.number().finite().nonnegative().optional(),
  estimatedTokens: z.number().finite().nonnegative().optional(),
  usage: z
    .object({
      inputTokens: z.number().finite().nonnegative(),
      outputTokens: z.number().finite().nonnegative(),
      totalTokens: z.number().finite().nonnegative(),
      cacheReadTokens: z.number().finite().nonnegative().optional(),
      cacheWriteTokens: z.number().finite().nonnegative().optional()
    })
    .optional()
})
const TapeInspectorFactRecordSchema = z.object({
  recordType: z.literal('fact'),
  key: z.custom<`entry:${number}`>(
    (value) => typeof value === 'string' && value.length <= 32 && /^entry:[1-9]\d*$/u.test(value)
  ),
  entryId: z.number().int().positive(),
  kind: TapeInspectorEntryKindSchema,
  family: TapeInspectorFactFamilySchema,
  name: TapeInspectorListTextSchema.nullable(),
  sourceType: TapeInspectorSourceTypeSchema.optional(),
  sourceId: TapeInspectorIdentitySchema.optional(),
  sourceSeq: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
  runId: TapeInspectorIdentitySchema.optional(),
  messageId: TapeInspectorIdentitySchema.optional(),
  requestSeq: z.number().int().positive().optional(),
  logicalRound: z.number().int().nonnegative().optional(),
  physicalAttempt: z.number().int().nonnegative().optional(),
  providerToolCallId: TapeInspectorIdentitySchema.optional(),
  childOrdinal: z.number().int().nonnegative().optional(),
  facts: TapeInspectorFactsSchema.optional(),
  hashes: z
    .object({
      payloadHash: ExecutionAuditHashSchema.optional(),
      metaHash: ExecutionAuditHashSchema.optional(),
      manifestHash: ExecutionAuditHashSchema.optional()
    })
    .optional(),
  integrity: z.enum(['valid', 'invalid', 'unverified']).optional(),
  traceEvidenceCount: z.number().int().nonnegative().optional()
}) satisfies z.ZodType<TapeInspectorFactRecord>
const TapeInspectorEvidenceCursorSchema = z.object({
  createdAt: z.number().int().nonnegative(),
  traceId: TapeInspectorIdentitySchema
})
const TapeInspectorEvidenceAppendCursorSchema = z.object({
  rowId: z.number().int().positive()
})
const TapeInspectorEvidenceRecordSchema = z.object({
  recordType: z.literal('evidence'),
  key: z.custom<`trace:${string}`>(
    (value) =>
      typeof value === 'string' &&
      value.startsWith('trace:') &&
      value.length > 6 &&
      value.length <= 1_030
  ),
  traceId: TapeInspectorIdentitySchema,
  messageId: TapeInspectorIdentitySchema,
  requestSeq: z.number().int().nonnegative(),
  logicalRound: z.number().int().nonnegative().optional(),
  physicalAttempt: z.number().int().nonnegative().optional(),
  providerId: TapeInspectorIdentitySchema,
  modelId: TapeInspectorIdentitySchema,
  createdAt: z.number().int().nonnegative(),
  truncated: z.boolean()
}) satisfies z.ZodType<TapeInspectorEvidenceRecord>
const TapeInspectorRecordDetailSchema = z.object({
  record: TapeInspectorFactRecordSchema,
  disclosure: z.enum(['structured', 'metadata_only']),
  provenance: z.object({
    sourceType: TapeInspectorSourceTypeSchema.optional(),
    sourceId: TapeInspectorIdentitySchema.optional(),
    sourceSeq: z.number().int().nonnegative().optional(),
    provenanceKey: TapeInspectorListTextSchema.optional()
  }),
  hashes: z.object({
    payloadHash: ExecutionAuditHashSchema,
    metaHash: ExecutionAuditHashSchema
  }),
  sizes: z.object({
    payloadBytes: z.number().int().nonnegative(),
    metaBytes: z.number().int().nonnegative()
  }),
  data: JsonValueSchema.optional()
}) satisfies z.ZodType<TapeInspectorRecordDetail>
const DeepChatNestedExecutionAuditSchema = z.object({
  schemaVersion: z.literal(1),
  state: z.enum(['available', 'corrupt', 'unavailable']),
  operations: z
    .array(
      z.object({
        runId: ExecutionAuditIdentitySchema,
        requestSeq: z.number().int().positive(),
        providerToolCallId: ExecutionAuditIdentitySchema,
        childOrdinal: z
          .number()
          .int()
          .nonnegative()
          .max(PROGRAMMATIC_TOOL_BATCH_MAX_STEPS - 1),
        toolName: z.string().min(1).max(512),
        toolSource: z.enum(['agent', 'mcp']),
        target: z.object({
          serverName: z.string().min(1).max(1_024),
          originalName: z.string().min(1).max(1_024).optional(),
          ownerPluginId: z.string().min(1).max(1_024).optional()
        }),
        argumentsHash: ExecutionAuditHashSchema,
        definitionHash: ExecutionAuditHashSchema,
        capabilityHash: ExecutionAuditHashSchema,
        status: z.enum(['success', 'error', 'indeterminate']),
        dispatchEntryId: z.number().int().positive(),
        dispatchCreatedAt: z.number().int().nonnegative(),
        outcomeEntryId: z.number().int().positive().nullable(),
        outcomeCreatedAt: z.number().int().nonnegative().nullable(),
        responseHash: ExecutionAuditHashSchema.nullable(),
        isError: z.boolean().nullable()
      })
    )
    .max(DEEPCHAT_NESTED_EXECUTION_AUDIT_OPERATION_LIMIT),
  truncated: z.boolean()
}) satisfies z.ZodType<DeepChatNestedExecutionAudit>
export interface HistorySearchOptions {
  limit?: number
}

export interface HistorySearchSessionHit {
  kind: 'session'
  sessionId: string
  title: string
  projectDir: string | null
  updatedAt: number
}

export interface HistorySearchMessageHit {
  kind: 'message'
  sessionId: string
  messageId: string
  title: string
  role: 'user' | 'assistant'
  snippet: string
  updatedAt: number
}

export type HistorySearchHit = HistorySearchSessionHit | HistorySearchMessageHit

const HistorySearchHitSchema = z.custom<HistorySearchHit>()
const SearchResultSchema = z.custom<SearchResult>()
const AgentSchema = z.custom<Agent>()
const AgentTransferImpactSchema = z.custom<AgentTransferImpact>()

const AcpSessionCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  input: z
    .object({
      hint: z.string()
    })
    .nullable()
    .optional()
})

export const SessionListFiltersSchema = z
  .object({
    agentId: EntityIdSchema.optional(),
    projectDir: z.string().optional(),
    includeSubagents: z.boolean().optional(),
    parentSessionId: EntityIdSchema.optional()
  })
  .default({})

export const CreateSessionInputSchema = z.object({
  agentId: EntityIdSchema,
  message: z.string(),
  submissionId: SubmissionIdSchema.optional(),
  files: z.array(MessageFileSchema).optional(),
  search: z.boolean().optional(),
  inlineItems: z.array(UserMessageInlineItemSchema).optional(),
  projectDir: z.string().nullable().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  permissionMode: PermissionModeSchema.optional(),
  activeSkills: z.array(z.string()).optional(),
  disabledAgentTools: z.array(z.string()).optional(),
  orchestrationPolicy: OrchestrationPolicySchema.optional(),
  toolModeOverride: ToolModeSchema.nullable().optional(),
  generationSettings: SessionGenerationSettingsPatchSchema.optional()
})

export const sessionsCreateRoute = defineRouteContract({
  name: 'sessions.create',
  input: CreateSessionInputSchema,
  output: z.object({
    session: SessionWithStateSchema,
    initialTurn: z
      .object({
        requestId: EntityIdSchema.nullable(),
        messageId: EntityIdSchema.nullable(),
        attachmentPreparation: AttachmentPreparationSummarySchema.optional()
      })
      .optional()
  })
})

export const sessionsRestoreRoute = defineRouteContract({
  name: 'sessions.restore',
  input: z.object({
    sessionId: EntityIdSchema,
    limit: z.number().int().positive().max(500).optional()
  }),
  output: z.object({
    session: SessionWithStateSchema.nullable(),
    messages: z.array(ChatMessageRecordSchema),
    nextCursor: MessagePageCursorSchema.nullable(),
    hasMore: z.boolean()
  })
})

export const sessionsListMessagesPageRoute = defineRouteContract({
  name: 'sessions.listMessagesPage',
  input: z.object({
    sessionId: EntityIdSchema,
    cursor: MessagePageCursorSchema.nullable().optional(),
    limit: z.number().int().positive().max(500).optional()
  }),
  output: ChatMessagePageResultSchema
})

export const sessionsListRoute = defineRouteContract({
  name: 'sessions.list',
  input: SessionListFiltersSchema,
  output: z.object({
    sessions: z.array(SessionWithStateSchema)
  })
})

export const sessionsListLightweightRoute = defineRouteContract({
  name: 'sessions.listLightweight',
  input: z.object({
    limit: z.number().int().positive().max(100).optional(),
    cursor: SessionPageCursorSchema.nullable().optional(),
    includeSubagents: z.boolean().optional(),
    agentId: EntityIdSchema.optional(),
    prioritizeSessionId: EntityIdSchema.optional()
  }),
  output: z.object({
    items: z.array(SessionListItemSchema),
    nextCursor: SessionPageCursorSchema.nullable(),
    hasMore: z.boolean()
  })
})

export const sessionsGetLightweightByIdsRoute = defineRouteContract({
  name: 'sessions.getLightweightByIds',
  input: z.object({
    sessionIds: z.array(EntityIdSchema)
  }),
  output: z.object({
    items: z.array(SessionListItemSchema)
  })
})

export const sessionsActivateRoute = defineRouteContract({
  name: 'sessions.activate',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    activated: z.literal(true)
  })
})

export const sessionsDeactivateRoute = defineRouteContract({
  name: 'sessions.deactivate',
  input: z.object({}),
  output: z.object({
    deactivated: z.literal(true)
  })
})

export const sessionsGetActiveRoute = defineRouteContract({
  name: 'sessions.getActive',
  input: z.object({}),
  output: z.object({
    session: SessionWithStateSchema.nullable()
  })
})

export const sessionsEnsureAcpDraftRoute = defineRouteContract({
  name: 'sessions.ensureAcpDraft',
  input: z.object({
    agentId: EntityIdSchema,
    projectDir: z.string().min(1),
    permissionMode: PermissionModeSchema.optional()
  }),
  output: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('ready'),
      session: SessionWithStateSchema
    }),
    z.object({
      status: z.literal('auth_required'),
      session: SessionWithStateSchema,
      challenge: AcpAuthChallengeSchema
    })
  ])
})

export const sessionsListPendingInputsRoute = defineRouteContract({
  name: 'sessions.listPendingInputs',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    items: z.array(PendingSessionInputRecordSchema),
    resumeAvailable: z.boolean()
  })
})

export const sessionsResumePendingQueueRoute = defineRouteContract({
  name: 'sessions.resumePendingQueue',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    started: z.boolean()
  })
})

export const sessionsRetryPendingQueueInputRoute = defineRouteContract({
  name: 'sessions.retryPendingQueueInput',
  input: z.object({
    sessionId: EntityIdSchema,
    itemId: EntityIdSchema
  }),
  output: z.object({
    accepted: z.boolean(),
    started: z.boolean()
  })
})

const PendingInputPayloadSchema = z.union([z.string(), SendMessageInputSchema])

export const sessionsQueuePendingInputRoute = defineRouteContract({
  name: 'sessions.queuePendingInput',
  input: z.object({
    sessionId: EntityIdSchema,
    content: PendingInputPayloadSchema
  }),
  output: z.object({
    item: PendingSessionInputRecordSchema
  })
})

export const sessionsUpdateQueuedInputRoute = defineRouteContract({
  name: 'sessions.updateQueuedInput',
  input: z.object({
    sessionId: EntityIdSchema,
    itemId: EntityIdSchema,
    content: PendingInputPayloadSchema
  }),
  output: z.object({
    item: PendingSessionInputRecordSchema
  })
})

export const sessionsMoveQueuedInputRoute = defineRouteContract({
  name: 'sessions.moveQueuedInput',
  input: z.object({
    sessionId: EntityIdSchema,
    itemId: EntityIdSchema,
    toIndex: z.number().int().nonnegative()
  }),
  output: z.object({
    items: z.array(PendingSessionInputRecordSchema)
  })
})

// Compatibility alias for queue-to-Steer promotion. It follows the same admission lifecycle as
// sessions.steerPendingInput.
export const sessionsConvertPendingInputToSteerRoute = defineRouteContract({
  name: 'sessions.convertPendingInputToSteer',
  input: z.object({
    sessionId: EntityIdSchema,
    itemId: EntityIdSchema
  }),
  output: z.object({
    item: PendingSessionInputRecordSchema
  })
})

export const sessionsSteerPendingInputRoute = defineRouteContract({
  name: 'sessions.steerPendingInput',
  input: z.object({
    sessionId: EntityIdSchema,
    itemId: EntityIdSchema
  }),
  output: z.object({
    item: PendingSessionInputRecordSchema
  })
})

export const sessionsDeletePendingInputRoute = defineRouteContract({
  name: 'sessions.deletePendingInput',
  input: z.object({
    sessionId: EntityIdSchema,
    itemId: EntityIdSchema
  }),
  output: z.object({
    deleted: z.literal(true)
  })
})

export const sessionsResolveBlockedPendingInputRoute = defineRouteContract({
  name: 'sessions.resolveBlockedPendingInput',
  input: z.object({
    sessionId: EntityIdSchema,
    itemId: EntityIdSchema,
    action: z.enum(['retry', 'send_without_image_content'])
  }),
  output: z.object({
    item: PendingSessionInputRecordSchema
  })
})

export const sessionsRetryMessageRoute = defineRouteContract({
  name: 'sessions.retryMessage',
  input: z.object({
    sessionId: EntityIdSchema,
    messageId: EntityIdSchema,
    attachmentFallbackPolicy: AttachmentFallbackPolicySchema.optional()
  }),
  output: z.object({
    retried: z.boolean(),
    accepted: z.boolean(),
    attachmentPreparation: AttachmentPreparationSummarySchema.optional()
  })
})

export const sessionsDeleteMessageRoute = defineRouteContract({
  name: 'sessions.deleteMessage',
  input: z.object({
    sessionId: EntityIdSchema,
    messageId: EntityIdSchema
  }),
  output: z.object({
    deleted: z.literal(true)
  })
})

export const sessionsEditUserMessageRoute = defineRouteContract({
  name: 'sessions.editUserMessage',
  input: z.object({
    sessionId: EntityIdSchema,
    messageId: EntityIdSchema,
    text: z.string()
  }),
  output: z.object({
    message: ChatMessageRecordSchema
  })
})

export const sessionsForkRoute = defineRouteContract({
  name: 'sessions.fork',
  input: z.object({
    sourceSessionId: EntityIdSchema,
    targetMessageId: EntityIdSchema,
    newTitle: z.string().optional()
  }),
  output: z.object({
    session: SessionWithStateSchema
  })
})

export const sessionsSearchHistoryRoute = defineRouteContract({
  name: 'sessions.searchHistory',
  input: z.object({
    query: z.string(),
    options: z
      .object({
        limit: z.number().int().positive().optional()
      })
      .optional()
  }),
  output: z.object({
    hits: z.array(HistorySearchHitSchema)
  })
})

export const sessionsGetSearchResultsRoute = defineRouteContract({
  name: 'sessions.getSearchResults',
  input: z.object({
    messageId: EntityIdSchema,
    searchId: z.string().optional()
  }),
  output: z.object({
    results: z.array(SearchResultSchema)
  })
})

export const sessionsGetTapeContextRoute = defineRouteContract({
  name: 'sessions.getTapeContext',
  input: z.object({
    sessionId: EntityIdSchema,
    entryIds: z.array(z.number().int().positive()).min(1).max(100),
    options: z
      .object({
        before: z.number().int().min(0).max(20).optional(),
        after: z.number().int().min(0).max(20).optional(),
        limit: z.number().int().positive().max(100).optional(),
        maxBytesPerEntry: z.number().int().min(0).max(8192).optional(),
        maxTotalBytes: z.number().int().min(0).max(65536).optional(),
        sourceSessionId: EntityIdSchema.trim().min(1).optional()
      })
      .optional()
  }),
  output: z.object({
    context: AgentTapeContextResultSchema
  })
})

const TapeInspectorPageInputCommonShape = {
  sessionId: EntityIdSchema,
  expectedTapeIncarnationId: TapeInspectorIdentitySchema.optional(),
  limit: z.number().int().positive().max(200).optional(),
  sort: TapeInspectorSortSchema.optional(),
  filters: z
    .object({
      kinds: z.array(TapeInspectorEntryKindSchema).max(6).optional(),
      families: z.array(TapeInspectorFactFamilySchema).max(10).optional(),
      name: TapeInspectorListTextSchema.optional(),
      namePrefix: TapeInspectorListTextSchema.optional(),
      factStatus: TapeInspectorListTextSchema.optional(),
      errorsOnly: z.boolean().optional(),
      messageId: TapeInspectorIdentitySchema.optional(),
      requestSeq: z.number().int().positive().optional()
    })
    .optional()
}
const ListTapeInspectorPageInputSchema = z.union([
  z.object({
    ...TapeInspectorPageInputCommonShape,
    mode: z.literal('tail'),
    cursor: z.undefined().optional()
  }),
  z.object({
    ...TapeInspectorPageInputCommonShape,
    expectedTapeIncarnationId: TapeInspectorIdentitySchema,
    mode: z.enum(['older', 'newer']),
    cursor: TapeInspectorEntryCursorSchema
  })
]) satisfies z.ZodType<ListTapeInspectorPageInput>
const ListTapeInspectorPageOutputSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    tapeIncarnationId: TapeInspectorIdentitySchema,
    snapshotMaxEntryId: z.number().int().nonnegative(),
    records: z.array(TapeInspectorFactRecordSchema).max(200),
    nextCursor: TapeInspectorEntryCursorSchema.nullable()
  }),
  z.object({
    status: z.literal('reset'),
    tapeIncarnationId: TapeInspectorIdentitySchema,
    snapshotMaxEntryId: z.number().int().nonnegative()
  })
]) satisfies z.ZodType<ListTapeInspectorPageOutput>

export const sessionsListTapeInspectorPageRoute = defineRouteContract({
  name: 'sessions.listTapeInspectorPage',
  input: ListTapeInspectorPageInputSchema,
  output: ListTapeInspectorPageOutputSchema
}) satisfies RouteContract<'sessions.listTapeInspectorPage'>

const TapeInspectorEvidencePageBaseShape = {
  sessionId: EntityIdSchema,
  limit: z.number().int().positive().max(200).optional(),
  messageId: TapeInspectorIdentitySchema.optional(),
  requestSeq: z.number().int().positive().optional(),
  physicalAttempt: z.number().int().nonnegative().nullable().optional()
}
const ListTapeInspectorEvidenceInputSchema = z.discriminatedUnion('mode', [
  z.object({
    ...TapeInspectorEvidencePageBaseShape,
    mode: z.literal('older'),
    cursor: TapeInspectorEvidenceCursorSchema.optional()
  }),
  z.object({
    ...TapeInspectorEvidencePageBaseShape,
    mode: z.literal('newer'),
    cursor: TapeInspectorEvidenceAppendCursorSchema.optional()
  })
]) satisfies z.ZodType<ListTapeInspectorEvidenceInput>
const ListTapeInspectorEvidenceOutputSchema = z.object({
  records: z.array(TapeInspectorEvidenceRecordSchema).max(200),
  nextCursor: TapeInspectorEvidenceCursorSchema.nullable(),
  newerCursor: TapeInspectorEvidenceAppendCursorSchema.nullable()
}) satisfies z.ZodType<ListTapeInspectorEvidenceOutput>

export const sessionsListTapeInspectorEvidenceRoute = defineRouteContract({
  name: 'sessions.listTapeInspectorEvidence',
  input: ListTapeInspectorEvidenceInputSchema,
  output: ListTapeInspectorEvidenceOutputSchema
}) satisfies RouteContract<'sessions.listTapeInspectorEvidence'>

const TapeInspectorEvidenceEntryIdentitySchema = z.object({
  messageId: TapeInspectorIdentitySchema,
  requestSeq: z.number().int().positive(),
  physicalAttempt: z.number().int().nonnegative()
})
const ResolveTapeInspectorEvidenceEntriesInputSchema = z.object({
  sessionId: EntityIdSchema,
  expectedTapeIncarnationId: TapeInspectorIdentitySchema,
  identities: z.array(TapeInspectorEvidenceEntryIdentitySchema).max(200)
}) satisfies z.ZodType<ResolveTapeInspectorEvidenceEntriesInput>
const ResolveTapeInspectorEvidenceEntriesOutputSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    tapeIncarnationId: TapeInspectorIdentitySchema,
    resolutions: z
      .array(
        TapeInspectorEvidenceEntryIdentitySchema.extend({
          entryId: z.number().int().positive().nullable()
        })
      )
      .max(200)
  }),
  z.object({
    status: z.literal('reset'),
    tapeIncarnationId: TapeInspectorIdentitySchema
  })
]) satisfies z.ZodType<ResolveTapeInspectorEvidenceEntriesOutput>

export const sessionsResolveTapeInspectorEvidenceEntriesRoute = defineRouteContract({
  name: 'sessions.resolveTapeInspectorEvidenceEntries',
  input: ResolveTapeInspectorEvidenceEntriesInputSchema,
  output: ResolveTapeInspectorEvidenceEntriesOutputSchema
}) satisfies RouteContract<'sessions.resolveTapeInspectorEvidenceEntries'>

const GetTapeInspectorRecordDetailOutputSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    tapeIncarnationId: TapeInspectorIdentitySchema,
    detail: TapeInspectorRecordDetailSchema
  }),
  z.object({
    status: z.literal('not_found'),
    tapeIncarnationId: TapeInspectorIdentitySchema
  }),
  z.object({
    status: z.literal('reset'),
    tapeIncarnationId: TapeInspectorIdentitySchema
  })
]) satisfies z.ZodType<GetTapeInspectorRecordDetailOutput>

const GetTapeInspectorRecordDetailInputSchema = z.object({
  sessionId: EntityIdSchema,
  expectedTapeIncarnationId: TapeInspectorIdentitySchema,
  entryId: z.number().int().positive()
}) satisfies z.ZodType<GetTapeInspectorRecordDetailInput>

export const sessionsGetTapeInspectorRecordDetailRoute = defineRouteContract({
  name: 'sessions.getTapeInspectorRecordDetail',
  input: GetTapeInspectorRecordDetailInputSchema,
  output: GetTapeInspectorRecordDetailOutputSchema
}) satisfies RouteContract<'sessions.getTapeInspectorRecordDetail'>

const ExportTapeInspectorSupportTraceOutputSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    trace: z.object({
      schemaVersion: z.literal(1),
      exportedAt: z.number().int().nonnegative(),
      sessionId: EntityIdSchema,
      tapeIncarnationId: TapeInspectorIdentitySchema,
      snapshotMaxEntryId: z.number().int().nonnegative(),
      facts: z.array(TapeInspectorRecordDetailSchema).max(TAPE_INSPECTOR_SUPPORT_FACT_LIMIT),
      evidence: z
        .array(TapeInspectorEvidenceRecordSchema)
        .max(TAPE_INSPECTOR_SUPPORT_EVIDENCE_LIMIT),
      truncated: z.object({
        facts: z.boolean(),
        evidence: z.boolean(),
        detailData: z.boolean()
      })
    })
  }),
  z.object({
    status: z.literal('reset'),
    tapeIncarnationId: TapeInspectorIdentitySchema,
    snapshotMaxEntryId: z.number().int().nonnegative()
  })
]) satisfies z.ZodType<ExportTapeInspectorSupportTraceOutput>

const ExportTapeInspectorSupportTraceInputSchema = z.object({
  sessionId: EntityIdSchema,
  expectedTapeIncarnationId: TapeInspectorIdentitySchema
}) satisfies z.ZodType<ExportTapeInspectorSupportTraceInput>

export const sessionsExportTapeInspectorSupportTraceRoute = defineRouteContract({
  name: 'sessions.exportTapeInspectorSupportTrace',
  input: ExportTapeInspectorSupportTraceInputSchema,
  output: ExportTapeInspectorSupportTraceOutputSchema
}) satisfies RouteContract<'sessions.exportTapeInspectorSupportTrace'>

export const sessionsSubscribeTapeInspectorHeadRoute = defineRouteContract({
  name: 'sessions.subscribeTapeInspectorHead',
  input: z.object({
    sessionId: EntityIdSchema,
    subscriptionId: TapeInspectorSubscriptionIdSchema
  }),
  output: z.object({
    subscribed: z.literal(true),
    tapeIncarnationId: TapeInspectorIdentitySchema,
    maxEntryId: z.number().int().nonnegative()
  })
}) satisfies RouteContract<'sessions.subscribeTapeInspectorHead'>

export const sessionsUnsubscribeTapeInspectorHeadRoute = defineRouteContract({
  name: 'sessions.unsubscribeTapeInspectorHead',
  input: z.object({
    subscriptionId: TapeInspectorSubscriptionIdSchema
  }),
  output: z.object({
    unsubscribed: z.literal(true)
  })
}) satisfies RouteContract<'sessions.unsubscribeTapeInspectorHead'>

export const sessionsListMessageTracesRoute = defineRouteContract({
  name: 'sessions.listMessageTraces',
  input: z.object({
    messageId: EntityIdSchema
  }),
  output: z.object({
    traces: z.array(MessageTraceRecordSchema),
    manifests: z.array(DeepChatTapeViewManifestRecordSchema),
    nestedExecutions: DeepChatNestedExecutionAuditSchema
  })
}) satisfies RouteContract<'sessions.listMessageTraces'>

export const sessionsExportMessageTapeReplaySliceRoute = defineRouteContract({
  name: 'sessions.exportMessageTapeReplaySlice',
  input: z.object({
    messageId: EntityIdSchema,
    options: z
      .object({
        requestSeq: z.number().int().positive().optional(),
        includeTapePayloads: z.boolean().optional(),
        includeTracePayload: z.boolean().optional()
      })
      .optional()
  }),
  output: z.object({
    slice: DeepChatTapeReplaySliceSchema
  })
})

export const sessionsTranslateTextRoute = defineRouteContract({
  name: 'sessions.translateText',
  input: z.object({
    text: z.string(),
    locale: z.string().optional(),
    agentId: EntityIdSchema.optional()
  }),
  output: z.object({
    text: z.string()
  })
})

export const sessionsGetAgentsRoute = defineRouteContract({
  name: 'sessions.getAgents',
  input: z.object({}),
  output: z.object({
    agents: z.array(AgentSchema)
  })
})

export const sessionsGetUsageDashboardRoute = defineRouteContract({
  name: 'sessions.getUsageDashboard',
  input: z.object({}).default({}),
  output: z.object({
    dashboard: UsageDashboardDataSchema
  })
})

export const sessionsRetryRtkHealthCheckRoute = defineRouteContract({
  name: 'sessions.retryRtkHealthCheck',
  input: z.object({}).default({}),
  output: z.object({
    retried: z.boolean()
  })
})

export const sessionsRenameRoute = defineRouteContract({
  name: 'sessions.rename',
  input: z.object({
    sessionId: EntityIdSchema,
    title: z.string().min(1)
  }),
  output: z.object({
    session: SessionWithStateSchema
  })
})

export const sessionsTogglePinnedRoute = defineRouteContract({
  name: 'sessions.togglePinned',
  input: z.object({
    sessionId: EntityIdSchema,
    pinned: z.boolean()
  }),
  output: z.object({
    session: SessionWithStateSchema
  })
})

export const sessionsClearMessagesRoute = defineRouteContract({
  name: 'sessions.clearMessages',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    cleared: z.literal(true)
  })
})

export const sessionsCompactRoute = defineRouteContract({
  name: 'sessions.compact',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    compacted: z.boolean(),
    state: SessionCompactionStateSchema
  })
})

export const sessionsGetCompactionSnapshotRoute = defineRouteContract({
  name: 'sessions.getCompactionSnapshot',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: SessionCompactionSnapshotSchema
})

export const sessionsGetContextOccupancyRoute = defineRouteContract({
  name: 'sessions.getContextOccupancy',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: SessionContextOccupancySnapshotSchema
})

export const sessionsExportRoute = defineRouteContract({
  name: 'sessions.export',
  input: z.object({
    sessionId: EntityIdSchema,
    format: z.enum(['markdown', 'html', 'txt', 'nowledge-mem'])
  }),
  output: z.object({
    filename: z.string(),
    content: z.string()
  })
})

export const sessionsDeleteRoute = defineRouteContract({
  name: 'sessions.delete',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    deleted: z.literal(true)
  })
})

export const sessionsGetAgentTransferImpactRoute = defineRouteContract({
  name: 'sessions.getAgentTransferImpact',
  input: z.object({
    agentId: EntityIdSchema
  }),
  output: z.object({
    impact: AgentTransferImpactSchema
  })
})

export const sessionsMoveAgentSessionsRoute = defineRouteContract({
  name: 'sessions.moveAgentSessions',
  input: z.object({
    fromAgentId: EntityIdSchema,
    toAgentId: EntityIdSchema
  }),
  output: z.object({
    movedSessionIds: z.array(EntityIdSchema),
    deletedSessionIds: z.array(EntityIdSchema)
  })
})

export const sessionsDeleteAgentSessionsRoute = defineRouteContract({
  name: 'sessions.deleteAgentSessions',
  input: z.object({
    agentId: EntityIdSchema
  }),
  output: z.object({
    deletedSessionIds: z.array(EntityIdSchema)
  })
})

export const sessionsMoveToAgentRoute = defineRouteContract({
  name: 'sessions.moveToAgent',
  input: z.object({
    sessionId: EntityIdSchema,
    toAgentId: EntityIdSchema
  }),
  output: z.object({
    session: SessionWithStateSchema
  })
})

export const sessionsGetAcpSessionCommandsRoute = defineRouteContract({
  name: 'sessions.getAcpSessionCommands',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    commands: z.array(AcpSessionCommandSchema)
  })
})

export const sessionsGetAcpSessionConfigOptionsRoute = defineRouteContract({
  name: 'sessions.getAcpSessionConfigOptions',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    state: AcpConfigStateSchema.nullable()
  })
})

export const sessionsSetAcpSessionConfigOptionRoute = defineRouteContract({
  name: 'sessions.setAcpSessionConfigOption',
  input: z.object({
    sessionId: EntityIdSchema,
    configId: z.string(),
    value: z.union([z.string(), z.boolean()])
  }),
  output: z.object({
    state: AcpConfigStateSchema.nullable()
  })
})

export const sessionsGetPermissionModeRoute = defineRouteContract({
  name: 'sessions.getPermissionMode',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    mode: PermissionModeSchema
  })
})

export const sessionsSetPermissionModeRoute = defineRouteContract({
  name: 'sessions.setPermissionMode',
  input: z.object({
    sessionId: EntityIdSchema,
    mode: PermissionModeSchema
  }),
  output: z.object({
    updated: z.literal(true)
  })
})

export const sessionsSetModelRoute = defineRouteContract({
  name: 'sessions.setModel',
  input: z.object({
    sessionId: EntityIdSchema,
    providerId: z.string().min(1),
    modelId: z.string().min(1)
  }),
  output: z.object({
    session: SessionWithStateSchema
  })
})

export const sessionsSetProjectDirRoute = defineRouteContract({
  name: 'sessions.setProjectDir',
  input: z.object({
    sessionId: EntityIdSchema,
    projectDir: z.string().nullable()
  }),
  output: z.object({
    session: SessionWithStateSchema
  })
})

export const sessionsGetGenerationSettingsRoute = defineRouteContract({
  name: 'sessions.getGenerationSettings',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    settings: SessionGenerationSettingsSchema.nullable()
  })
})

export const sessionsGetDisabledAgentToolsRoute = defineRouteContract({
  name: 'sessions.getDisabledAgentTools',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    disabledAgentTools: z.array(z.string())
  })
})

export const sessionsSetToolModeRoute = defineRouteContract({
  name: 'sessions.setToolMode',
  input: z.object({
    sessionId: EntityIdSchema,
    override: ToolModeSchema.nullable()
  }),
  output: z.object({
    session: SessionWithStateSchema
  })
})

export const sessionsUpdateDisabledAgentToolsRoute = defineRouteContract({
  name: 'sessions.updateDisabledAgentTools',
  input: z.object({
    sessionId: EntityIdSchema,
    disabledAgentTools: z.array(z.string())
  }),
  output: z.object({
    disabledAgentTools: z.array(z.string())
  })
})

export const sessionsUpdateGenerationSettingsRoute = defineRouteContract({
  name: 'sessions.updateGenerationSettings',
  input: z.object({
    sessionId: EntityIdSchema,
    settings: SessionGenerationSettingsPatchSchema
  }),
  output: z.object({
    settings: SessionGenerationSettingsSchema
  })
})
