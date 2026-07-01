import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  AGENT_MEMORY_CATEGORIES,
  AGENT_MEMORY_HEALTH_CATEGORY_KEYS,
  AGENT_MEMORY_HEALTH_KIND_KEYS,
  AGENT_MEMORY_HEALTH_STATUS_KEYS,
  AGENT_MEMORY_HEALTH_TOP_KIND_KEYS
} from '../../types/agent-memory'

/** URL-safe agent ids, matching the main-process memory storage guard. */
const AgentIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, 'invalid agentId')

export const MemoryItemSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  kind: z.enum(AGENT_MEMORY_HEALTH_TOP_KIND_KEYS),
  category: z.enum(AGENT_MEMORY_CATEGORIES).nullable(),
  content: z.string(),
  importance: z.number(),
  status: z.enum(AGENT_MEMORY_HEALTH_STATUS_KEYS),
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

// Search results reuse the management DTO and add the retrieval score plus which path(s) surfaced
// the row. Persona/working/archived/conflicted rows are excluded by the retrieval semantics.
export const MemorySearchResultSchema = MemoryItemSchema.extend({
  score: z.number(),
  sources: z.object({ vec: z.boolean().optional(), fts: z.boolean().optional() }).optional(),
  similarity: z.number().optional()
})

// Flattened write outcome for a user-added memory: the decision ring may create, dedupe-update,
// supersede, challenge a conflicting row, or no-op on an exact duplicate.
export const MemoryAddResultSchema = z.object({
  action: z.enum(['created', 'updated', 'superseded', 'challenged', 'noop']),
  memoryId: z.string().optional(),
  supersededId: z.string().optional(),
  conflictWith: z.string().optional(),
  reason: z.string().optional()
})

export const MemoryStatusSchema = z.object({
  total: z.number(),
  pendingEmbedding: z.number(),
  hasPersona: z.boolean(),
  reindexing: z.boolean().optional()
})

const NonnegativeCountSchema = z.number().int().nonnegative()
export const MEMORY_HEALTH_DEFAULT_AUDIT_SCAN_LIMIT = 200
export const MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT = 25
export const MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT = 200

function countRecordShape<const Keys extends readonly string[]>(
  keys: Keys
): { [Key in Keys[number]]: typeof NonnegativeCountSchema } {
  return Object.fromEntries(keys.map((key) => [key, NonnegativeCountSchema])) as {
    [Key in Keys[number]]: typeof NonnegativeCountSchema
  }
}

function createZeroCountRecord<const Keys extends readonly string[]>(
  keys: Keys
): Record<Keys[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<Keys[number], number>
}

export const MemoryHealthTopItemSchema = z.object({
  id: z.string(),
  kind: z.enum(AGENT_MEMORY_HEALTH_TOP_KIND_KEYS),
  category: z.enum(AGENT_MEMORY_CATEGORIES).nullable(),
  content: z.string(),
  importance: z.number(),
  accessCount: NonnegativeCountSchema,
  lastAccessed: z.number().nullable()
})

export const MemoryHealthRecentFailureSchema = z.object({
  eventType: z.string(),
  status: z.enum(['failed', 'skipped']),
  reason: z.string().nullable(),
  createdAt: z.number()
})

export const MemoryHealthSchema = z.object({
  totalRows: NonnegativeCountSchema,
  byKind: z.object(countRecordShape(AGENT_MEMORY_HEALTH_KIND_KEYS)),
  byCategory: z.object(countRecordShape(AGENT_MEMORY_HEALTH_CATEGORY_KEYS)),
  byStatus: z.object(countRecordShape(AGENT_MEMORY_HEALTH_STATUS_KEYS)),
  embeddings: z.object({
    pending: NonnegativeCountSchema,
    error: NonnegativeCountSchema,
    ftsOnly: NonnegativeCountSchema,
    stale: NonnegativeCountSchema
  }),
  lifecycle: z.object({
    archiveCandidates: NonnegativeCountSchema,
    archived: NonnegativeCountSchema
  }),
  conflicts: z.object({
    conflicted: NonnegativeCountSchema,
    challenged: NonnegativeCountSchema
  }),
  access: z.object({
    topAccessed: z.array(MemoryHealthTopItemSchema),
    neverAccessed: NonnegativeCountSchema
  }),
  quality: z.object({
    importanceAvg: z.number().nullable(),
    importanceMedian: z.number().nullable(),
    confidenceAvg: z.number().nullable()
  }),
  maintenance: z.object({
    completed: NonnegativeCountSchema,
    skipped: NonnegativeCountSchema,
    failed: NonnegativeCountSchema,
    scanLimit: z.number().int().positive(),
    recentFailures: z.array(MemoryHealthRecentFailureSchema)
  })
})

export type MemoryHealthDto = z.infer<typeof MemoryHealthSchema>

const MemoryLifecycleKindSchema = z.enum(AGENT_MEMORY_HEALTH_TOP_KIND_KEYS)
const MemoryLifecycleStatusSchema = z.enum(AGENT_MEMORY_HEALTH_STATUS_KEYS)
const MemoryLifecycleDecayTierSchema = z.enum(['fresh', 'aging', 'stale', 'archive_candidate'])

const MemoryLifecycleRecallSchema = z.object({
  weights: z.object({
    similarity: z.number(),
    recency: z.number(),
    importance: z.number()
  }),
  similarity: z.number(),
  similaritySource: z.literal('baseline'),
  recency: z.number(),
  importance: z.number(),
  confidenceFactor: z.number(),
  importanceFloor: z.number(),
  final: z.number(),
  flooredByImportance: z.boolean(),
  halfLifeMs: z.number()
})

export const MemoryLifecycleSchema = z
  .object({
    memoryId: z.string(),
    kind: MemoryLifecycleKindSchema,
    status: MemoryLifecycleStatusSchema,
    recallable: z.boolean(),
    decayTier: MemoryLifecycleDecayTierSchema,
    recall: MemoryLifecycleRecallSchema.nullable(),
    forget: z.object({
      anchorAt: z.number(),
      ageDays: z.number(),
      halfLifeDays: z.number(),
      decayScore: z.number(),
      materializedDecay: z.number().nullable(),
      materializedStale: z.boolean()
    }),
    archiveEligibility: z.object({
      eligible: z.boolean(),
      oldEnough: z.boolean(),
      decayedEnough: z.boolean(),
      neverAccessed: z.boolean(),
      active: z.boolean(),
      exempt: z.boolean(),
      exemptReasons: z.array(z.enum(['anchor', 'persona', 'working'])),
      gaps: z.object({
        daysUntilOldEnough: z.number().optional(),
        decayAboveThresholdBy: z.number().optional(),
        accessCount: z.number().int().nonnegative().optional()
      })
    })
  })
  .superRefine((lifecycle, ctx) => {
    if (lifecycle.kind === 'persona' && lifecycle.recall !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recall'],
        message: 'persona lifecycle recall must be null'
      })
    }

    if (lifecycle.kind !== 'persona' && lifecycle.recall === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recall'],
        message: 'non-persona lifecycle recall must be present'
      })
    }
  })

export type MemoryLifecycle = z.infer<typeof MemoryLifecycleSchema>

export const MemoryArchiveCandidateLifecyclePreviewSchema = z
  .object({
    lifecycles: z
      .array(MemoryLifecycleSchema)
      .max(MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT),
    previewLimit: z.literal(MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT),
    scanLimit: z.literal(MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT),
    scanned: NonnegativeCountSchema.max(MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT),
    previewTruncated: z.boolean(),
    scanTruncated: z.boolean()
  })
  .superRefine((preview, ctx) => {
    if (preview.previewTruncated && preview.lifecycles.length !== preview.previewLimit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lifecycles'],
        message: 'truncated archive candidate preview must fill the configured preview limit'
      })
    }
    if (preview.scanTruncated && preview.scanned !== preview.scanLimit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scanned'],
        message: 'truncated archive candidate preview must scan the configured scan limit'
      })
    }
  })

export type MemoryArchiveCandidateLifecyclePreview = z.infer<
  typeof MemoryArchiveCandidateLifecyclePreviewSchema
>

export function createEmptyArchiveCandidateLifecyclePreview(): MemoryArchiveCandidateLifecyclePreview {
  return {
    lifecycles: [],
    previewLimit: MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT,
    scanLimit: MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT,
    scanned: 0,
    previewTruncated: false,
    scanTruncated: false
  }
}

export function createEmptyMemoryHealth(
  scanLimit = MEMORY_HEALTH_DEFAULT_AUDIT_SCAN_LIMIT
): MemoryHealthDto {
  const normalizedScanLimit = Number.isFinite(scanLimit)
    ? Math.max(1, Math.floor(scanLimit))
    : MEMORY_HEALTH_DEFAULT_AUDIT_SCAN_LIMIT
  return {
    totalRows: 0,
    byKind: createZeroCountRecord(AGENT_MEMORY_HEALTH_KIND_KEYS),
    byCategory: createZeroCountRecord(AGENT_MEMORY_HEALTH_CATEGORY_KEYS),
    byStatus: createZeroCountRecord(AGENT_MEMORY_HEALTH_STATUS_KEYS),
    embeddings: { pending: 0, error: 0, ftsOnly: 0, stale: 0 },
    lifecycle: { archiveCandidates: 0, archived: 0 },
    conflicts: { conflicted: 0, challenged: 0 },
    access: { topAccessed: [], neverAccessed: 0 },
    quality: { importanceAvg: null, importanceMedian: null, confidenceAvg: null },
    maintenance: {
      completed: 0,
      skipped: 0,
      failed: 0,
      scanLimit: normalizedScanLimit,
      recentFailures: []
    }
  }
}

const JsonRecordSchema = z.record(z.string(), z.unknown())

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

export const memoryGetHealthRoute = defineRouteContract({
  name: 'memory.getHealth',
  input: z.object({ agentId: AgentIdSchema }),
  output: z.object({ health: MemoryHealthSchema })
})

export const memoryGetLifecycleRoute = defineRouteContract({
  name: 'memory.getLifecycle',
  input: z.object({ agentId: AgentIdSchema, memoryId: z.string().min(1) }),
  output: z.object({ lifecycles: z.array(MemoryLifecycleSchema) })
})

export const memoryGetArchiveCandidateLifecyclePreviewRoute = defineRouteContract({
  name: 'memory.getArchiveCandidateLifecyclePreview',
  input: z.object({ agentId: AgentIdSchema }),
  output: z.object({ preview: MemoryArchiveCandidateLifecyclePreviewSchema })
})

export const memorySearchRoute = defineRouteContract({
  name: 'memory.search',
  input: z.object({
    agentId: AgentIdSchema,
    query: z.string(),
    // Caps the result count only; it cannot widen the agent's configured topK.
    limit: z.number().int().positive().max(500).optional()
  }),
  output: z.object({ results: z.array(MemorySearchResultSchema) })
})

export const memoryAddRoute = defineRouteContract({
  name: 'memory.add',
  input: z.object({
    agentId: AgentIdSchema,
    content: z.string().min(1),
    kind: z.enum(['episodic', 'semantic']).optional(),
    category: z.enum(AGENT_MEMORY_CATEGORIES).optional(),
    importance: z.number().min(0).max(1).optional()
  }),
  output: z.object({ result: MemoryAddResultSchema })
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
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>
export type MemoryAddResult = z.infer<typeof MemoryAddResultSchema>
export type MemoryStatusDto = z.infer<typeof MemoryStatusSchema>
export type MemoryAuditEvent = z.infer<typeof MemoryAuditEventSchema>
export type MemoryViewManifest = z.infer<typeof MemoryViewManifestSchema>
export type MemorySourceSpan = z.infer<typeof memoryGetSourceSpanRoute.output>['span']
export type MemoryConflictItem = z.infer<
  typeof memoryListConflictsRoute.output
>['conflicts'][number]
