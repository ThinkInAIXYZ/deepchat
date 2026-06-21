import { z } from 'zod'
import { defineRouteContract } from '../common'

/** URL-safe agent ids, matching the main-process memory storage guard. */
const AgentIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, 'invalid agentId')

export const MemoryItemSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  kind: z.enum(['episodic', 'semantic', 'reflection', 'persona']),
  content: z.string(),
  importance: z.number(),
  status: z.enum(['pending_embedding', 'embedded', 'error', 'fts_only', 'archived', 'conflicted']),
  sourceSession: z.string().nullable(),
  sourceEntryIds: z.array(z.number().int().nonnegative()).nullable(),
  supersededBy: z.string().nullable(),
  createdAt: z.number(),
  confidence: z.number().nullable().optional(),
  conflictState: z.string().nullable().optional(),
  conflictWith: z.string().nullable().optional(),
  // Persona lifecycle (null for non-persona rows). isAnchor surfaces the drift guard; needsReview is
  // computed per draft against the active self-model and only set on the persona-drafts route.
  personaState: z.enum(['draft', 'active', 'superseded', 'rejected']).nullable().optional(),
  isAnchor: z.boolean().optional(),
  needsReview: z.boolean().optional()
})

export const MemoryStatusSchema = z.object({
  total: z.number(),
  pendingEmbedding: z.number(),
  hasPersona: z.boolean(),
  reindexing: z.boolean().optional()
})

const JsonRecordSchema = z.record(z.unknown())

export const MemoryAuditEventSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  eventType: z.string(),
  actorType: z.enum(['scheduler', 'user', 'runtime']),
  sessionId: z.string().nullable(),
  inputRefs: JsonRecordSchema,
  outputRefs: JsonRecordSchema,
  modelProviderId: z.string().nullable(),
  modelId: z.string().nullable(),
  status: z.enum(['completed', 'skipped', 'failed']),
  reason: z.string().nullable(),
  createdAt: z.number()
})

export const MemoryViewManifestSchema = z.object({
  sessionId: z.string(),
  messageId: z.string().nullable(),
  entryId: z.number(),
  policyVersion: z.number().nullable(),
  tokenBudget: z.number(),
  estimatedTokens: z.number(),
  selectedCount: z.number(),
  droppedCount: z.number(),
  queryHash: z.string().nullable(),
  createdAt: z.number()
})

export const memoryListRoute = defineRouteContract({
  name: 'memory.list',
  input: z.object({ agentId: AgentIdSchema }),
  output: z.object({ memories: z.array(MemoryItemSchema) })
})

export const memoryGetStatusRoute = defineRouteContract({
  name: 'memory.getStatus',
  input: z.object({ agentId: AgentIdSchema }),
  output: z.object({ status: MemoryStatusSchema })
})

export const memoryListAuditEventsRoute = defineRouteContract({
  name: 'memory.listAuditEvents',
  input: z.object({
    agentId: AgentIdSchema,
    eventType: z.string().optional(),
    actorType: z.enum(['scheduler', 'user', 'runtime']).optional(),
    sessionId: z.string().optional(),
    status: z.enum(['completed', 'skipped', 'failed']).optional(),
    startCreatedAt: z.number().optional(),
    endCreatedAt: z.number().optional(),
    limit: z.number().int().positive().max(500).optional()
  }),
  output: z.object({ events: z.array(MemoryAuditEventSchema) })
})

export const memoryListViewManifestsRoute = defineRouteContract({
  name: 'memory.listViewManifests',
  input: z.object({
    agentId: AgentIdSchema,
    sessionId: z.string().optional(),
    messageId: z.string().optional(),
    limit: z.number().int().positive().max(500).optional()
  }),
  output: z.object({ manifests: z.array(MemoryViewManifestSchema) })
})

export const memoryDeleteRoute = defineRouteContract({
  name: 'memory.delete',
  input: z.object({ agentId: AgentIdSchema, memoryId: z.string() }),
  output: z.object({ ok: z.boolean() })
})

export const memoryClearRoute = defineRouteContract({
  name: 'memory.clear',
  input: z.object({ agentId: AgentIdSchema }),
  output: z.object({ removed: z.number() })
})

export const memoryRestoreRoute = defineRouteContract({
  name: 'memory.restore',
  input: z.object({ agentId: AgentIdSchema, memoryId: z.string() }),
  output: z.object({ ok: z.boolean() })
})

export const memoryGetSourceSpanRoute = defineRouteContract({
  name: 'memory.getSourceSpan',
  input: z.object({ agentId: AgentIdSchema, memoryId: z.string() }),
  output: z.object({
    span: z
      .object({
        sessionId: z.string(),
        entries: z.array(
          z.object({
            entryId: z.number().int().nonnegative(),
            role: z.enum(['user', 'assistant']),
            content: z.string(),
            orderSeq: z.number()
          })
        )
      })
      .nullable()
  })
})

export const memoryListConflictsRoute = defineRouteContract({
  name: 'memory.listConflicts',
  input: z.object({ agentId: AgentIdSchema }),
  output: z.object({
    conflicts: z.array(z.object({ challenger: MemoryItemSchema, target: MemoryItemSchema }))
  })
})

export const memoryResolveConflictRoute = defineRouteContract({
  name: 'memory.resolveConflict',
  input: z.object({
    agentId: AgentIdSchema,
    challengerId: z.string(),
    outcome: z.enum(['keep_target', 'keep_challenger', 'keep_both'])
  }),
  output: z.object({ ok: z.boolean() })
})

export const memoryListPersonaVersionsRoute = defineRouteContract({
  name: 'memory.listPersonaVersions',
  input: z.object({ agentId: AgentIdSchema }),
  output: z.object({ versions: z.array(MemoryItemSchema) })
})

export const memoryRollbackPersonaRoute = defineRouteContract({
  name: 'memory.rollbackPersona',
  input: z.object({ agentId: AgentIdSchema, versionId: z.string() }),
  output: z.object({ ok: z.boolean() })
})

export const memoryListPersonaDraftsRoute = defineRouteContract({
  name: 'memory.listPersonaDrafts',
  input: z.object({ agentId: AgentIdSchema }),
  output: z.object({ drafts: z.array(MemoryItemSchema) })
})

export const memoryApprovePersonaDraftRoute = defineRouteContract({
  name: 'memory.approvePersonaDraft',
  input: z.object({ agentId: AgentIdSchema, draftId: z.string() }),
  output: z.object({ ok: z.boolean() })
})

export const memoryRejectPersonaDraftRoute = defineRouteContract({
  name: 'memory.rejectPersonaDraft',
  input: z.object({ agentId: AgentIdSchema, draftId: z.string() }),
  output: z.object({ ok: z.boolean() })
})

export const memorySetPersonaAnchorRoute = defineRouteContract({
  name: 'memory.setPersonaAnchor',
  input: z.object({ agentId: AgentIdSchema, versionId: z.string(), anchored: z.boolean() }),
  output: z.object({ ok: z.boolean() })
})

export type MemoryItem = z.infer<typeof MemoryItemSchema>
export type MemoryStatusDto = z.infer<typeof MemoryStatusSchema>
export type MemoryAuditEvent = z.infer<typeof MemoryAuditEventSchema>
export type MemoryViewManifest = z.infer<typeof MemoryViewManifestSchema>
export type MemorySourceSpan = z.infer<typeof memoryGetSourceSpanRoute.output>['span']
export type MemoryConflictItem = z.infer<
  typeof memoryListConflictsRoute.output
>['conflicts'][number]
