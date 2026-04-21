import { z } from 'zod'
import type { SearchResult } from '@shared/types/core/search'
import type {
  Agent,
  MessageTraceRecord,
  PendingSessionInputRecord,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { HistorySearchHit } from '@shared/types/presenters/agent-session.presenter'
import {
  SessionListItemSchema,
  SessionPageCursorSchema,
  ChatMessageRecordSchema,
  EntityIdSchema,
  MessageFileSchema,
  PermissionModeSchema,
  SessionGenerationSettingsSchema,
  SessionGenerationSettingsPatchSchema,
  SessionWithStateSchema,
  defineRouteContract
} from '../common'
import { AcpConfigStateSchema } from '../domainSchemas'

const PendingSessionInputRecordSchema = z.custom<PendingSessionInputRecord>()
const MessageTraceRecordSchema = z.custom<MessageTraceRecord>()
const HistorySearchHitSchema = z.custom<HistorySearchHit>()
const SearchResultSchema = z.custom<SearchResult>()
const AgentSchema = z.custom<Agent>()

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
  files: z.array(MessageFileSchema).optional(),
  projectDir: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  permissionMode: PermissionModeSchema.optional(),
  activeSkills: z.array(z.string()).optional(),
  disabledAgentTools: z.array(z.string()).optional(),
  subagentEnabled: z.boolean().optional(),
  generationSettings: SessionGenerationSettingsPatchSchema.optional()
})

export const sessionsCreateRoute = defineRouteContract({
  name: 'sessions.create',
  input: CreateSessionInputSchema,
  output: z.object({
    session: SessionWithStateSchema
  })
})

export const sessionsRestoreRoute = defineRouteContract({
  name: 'sessions.restore',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    session: SessionWithStateSchema.nullable(),
    messages: z.array(ChatMessageRecordSchema)
  })
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
  output: z.object({
    session: SessionWithStateSchema
  })
})

export const sessionsListPendingInputsRoute = defineRouteContract({
  name: 'sessions.listPendingInputs',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    items: z.array(PendingSessionInputRecordSchema)
  })
})

const PendingInputPayloadSchema = z.union([z.string(), z.custom<SendMessageInput>()])

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

export const sessionsResumePendingQueueRoute = defineRouteContract({
  name: 'sessions.resumePendingQueue',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    resumed: z.literal(true)
  })
})

export const sessionsRetryMessageRoute = defineRouteContract({
  name: 'sessions.retryMessage',
  input: z.object({
    sessionId: EntityIdSchema,
    messageId: EntityIdSchema
  }),
  output: z.object({
    retried: z.literal(true)
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

export const sessionsListMessageTracesRoute = defineRouteContract({
  name: 'sessions.listMessageTraces',
  input: z.object({
    messageId: EntityIdSchema
  }),
  output: z.object({
    traces: z.array(MessageTraceRecordSchema)
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

export const sessionsRenameRoute = defineRouteContract({
  name: 'sessions.rename',
  input: z.object({
    sessionId: EntityIdSchema,
    title: z.string().min(1)
  }),
  output: z.object({
    updated: z.literal(true)
  })
})

export const sessionsTogglePinnedRoute = defineRouteContract({
  name: 'sessions.togglePinned',
  input: z.object({
    sessionId: EntityIdSchema,
    pinned: z.boolean()
  }),
  output: z.object({
    updated: z.literal(true)
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

export const sessionsSetSubagentEnabledRoute = defineRouteContract({
  name: 'sessions.setSubagentEnabled',
  input: z.object({
    sessionId: EntityIdSchema,
    enabled: z.boolean()
  }),
  output: z.object({
    session: SessionWithStateSchema
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
