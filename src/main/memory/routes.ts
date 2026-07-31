import { isAgentMemoryCategory } from '@shared/types/agent-memory'
import { parseAgentMemorySourceEntryIds } from '@shared/lib/agentMemoryLineage'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import {
  decodeMemoryPageCursor,
  encodeMemoryPageCursor,
  memoryAddRoute,
  memoryApproveDirectiveRoute,
  memoryApprovePersonaDraftRoute,
  memoryArchiveRoute,
  memoryClearRoute,
  memoryCreateDirectiveRoute,
  memoryDeleteRoute,
  memoryDeleteDirectiveRoute,
  memoryGetArchiveCandidateLifecyclePreviewRoute,
  memoryGetByIdsRoute,
  memoryGetHealthRoute,
  memoryGetLifecycleRoute,
  memoryGetSourceSpanRoute,
  memoryGetStatusRoute,
  memoryListAuditEventsRoute,
  memoryListConflictsRoute,
  memoryListDirectivesRoute,
  memoryListPersonaDraftsRoute,
  memoryListPersonaVersionsRoute,
  memoryListRoute,
  memoryListViewManifestsRoute,
  memoryPageRoute,
  memoryRejectDirectiveRoute,
  memoryRejectPersonaDraftRoute,
  memoryReindexRoute,
  memoryResolveConflictRoute,
  memoryRestoreRoute,
  memoryRollbackPersonaRoute,
  memorySearchRoute,
  memorySetPersonaAnchorRoute,
  memoryUpdateRoute
} from '@shared/contracts/routes'
import {
  createEmptyArchiveCandidateLifecyclePreview,
  createEmptyMemoryHealth,
  type MemoryArchiveCandidateLifecyclePreview,
  type MemoryCommandResult,
  type MemoryHealthDto,
  type MemoryLifecycle,
  type MemoryUpdateResult
} from '@shared/contracts/routes/memory.routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { TapeInspectionReader } from '@/tape/ports/capabilities'
import type {
  MemoryConflictPair,
  MemoryConflictResolution,
  MemoryManagementPage,
  MemorySearchHit,
  MemoryScope,
  MemoryScopeContext,
  MemoryStatus,
  MemoryWriteOutcome
} from './types'
import type {
  AgentMemoryDirectiveRow,
  ExplicitMemoryDirectiveSource,
  MemoryDirectiveCommandResult,
  MemoryDirectiveInput,
  MemoryDirectiveListOptions
} from './domain/directives'
import type { CanonicalAgentMemoryRow as AgentMemoryRow, MemoryClearResult } from './domain/types'
import { projectLegacyStatus } from './domain/stateModel'
import type { AgentMemoryAuditRow, MemoryAuditListOptions } from './domain/audit'
import { temporalMetadataFromRow } from './core/temporal'

const MEMORY_PERSONA_STATES = ['draft', 'active', 'superseded', 'rejected'] as const
type MemoryPersonaState = (typeof MEMORY_PERSONA_STATES)[number]
const MEMORY_PERSONA_STATE_SET: ReadonlySet<string> = new Set(MEMORY_PERSONA_STATES)

export function formatMemorySourceRecordContent(
  record: Pick<ChatMessageRecord, 'role' | 'content'>
): string {
  try {
    const parsed = JSON.parse(record.content) as unknown
    if (record.role === 'user') {
      const text = (parsed as { text?: unknown })?.text
      return typeof text === 'string' ? text.trim() : ''
    }
    const blockText = (block: unknown): string => {
      const value = block as { type?: string; content?: unknown }
      return value?.type === 'content' && typeof value.content === 'string' ? value.content : ''
    }
    return (
      Array.isArray(parsed) ? parsed.map(blockText).filter(Boolean).join(' ') : blockText(parsed)
    ).trim()
  } catch {
    return ''
  }
}

function normalizeMemoryPersonaState(value: unknown): MemoryPersonaState | null {
  return typeof value === 'string' && MEMORY_PERSONA_STATE_SET.has(value)
    ? (value as MemoryPersonaState)
    : null
}

export function toMemoryItemDto(row: AgentMemoryRow) {
  const temporal = temporalMetadataFromRow(row)
  return {
    id: row.id,
    agentId: row.agent_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    kind: row.kind,
    category: isAgentMemoryCategory(row.category) ? row.category : null,
    content: row.content,
    importance: row.importance,
    status: projectLegacyStatus(row.lifecycle_state, row.embedding_state),
    sourceSession: row.source_session,
    sourceEntryIds: parseAgentMemorySourceEntryIds(row.source_entry_ids),
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    confidence: row.confidence,
    temporalKind: temporal.temporalKind,
    validFrom: temporal.validFrom,
    validUntil: temporal.validUntil,
    temporalConfidence: temporal.temporalConfidence,
    temporalPrecision: temporal.temporalPrecision,
    temporalTimeZone: temporal.temporalTimeZone,
    conflictState: row.conflict_state,
    conflictWith: row.conflict_with,
    personaState: normalizeMemoryPersonaState(row.persona_state),
    isAnchor: row.is_anchor === 1
  }
}

export function toMemoryDirectiveDto(row: AgentMemoryDirectiveRow) {
  return {
    id: row.id,
    agentId: row.agent_id,
    kind: row.kind,
    status: row.status,
    source: row.source,
    content: row.content,
    topic: row.normalized_topic,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toMemoryDirectiveCommandDto(result: MemoryDirectiveCommandResult) {
  return result.action === 'applied'
    ? { action: 'applied' as const, directive: toMemoryDirectiveDto(result.directive) }
    : result
}

function toMemoryAddResultDto(outcome: MemoryWriteOutcome) {
  switch (outcome.action) {
    case 'created':
    case 'updated':
      return {
        action: outcome.action,
        memoryId: outcome.id,
        ...(outcome.action === 'created' && outcome.reauthorized ? { reauthorized: true } : {})
      }
    case 'superseded':
      return { action: outcome.action, memoryId: outcome.id, supersededId: outcome.supersededId }
    case 'challenged':
      return {
        action: outcome.action,
        memoryId: outcome.challengerId,
        conflictWith: outcome.targetId
      }
    case 'noop':
      return { action: outcome.action, reason: outcome.reason }
  }
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function sanitizeRouteRefs(record: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  const safeKey = /(id|ids|type|status|action|reason|policy|seq|count|hash)$/i
  for (const [key, value] of Object.entries(record)) {
    if (safeKey.test(key) || key === 'createdAt' || key === 'updatedAt') {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
      ) {
        safe[key] = value
      } else if (Array.isArray(value)) {
        safe[key] = value.filter(
          (item) =>
            typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
        )
      } else {
        safe[key] = '{...}'
      }
    } else if (Array.isArray(value)) {
      safe[key] = `[${value.length}]`
    } else if (value && typeof value === 'object') {
      safe[key] = '{...}'
    } else if (value !== undefined) {
      safe[key] = '[redacted]'
    }
  }
  return safe
}

function toMemoryAuditEventDto(row: AgentMemoryAuditRow) {
  return {
    id: row.id,
    agentId: row.agent_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    sessionId: row.session_id,
    inputRefs: sanitizeRouteRefs(parseJsonRecord(row.input_refs_json)),
    outputRefs: sanitizeRouteRefs(parseJsonRecord(row.output_refs_json)),
    modelProviderId: row.model_provider_id,
    modelId: row.model_id,
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at
  }
}

type MemoryAuditEntries = {
  listByAgent(agentId: string, options: MemoryAuditListOptions): AgentMemoryAuditRow[]
}

interface MemoryRouteService {
  pageMemories(
    agentId: string,
    cursor: { createdAt: number; id: string } | null,
    limit: number
  ): MemoryManagementPage
  searchMemories(
    agentId: string,
    query: string,
    options: { limit?: number; scopeContext?: MemoryScopeContext }
  ): Promise<MemorySearchHit[]>
  addUserMemory(
    agentId: string,
    input: {
      content: string
      kind?: 'episodic' | 'semantic'
      category?: string | null
      importance?: number
      scope?: MemoryScope
    },
    sessionId?: string | null
  ): Promise<MemoryWriteOutcome>
  updateMemory(
    agentId: string,
    memoryId: string,
    patch: { content?: string; category?: string | null; importance?: number }
  ): MemoryUpdateResult
  getByIds(agentId: string, memoryIds: string[]): AgentMemoryRow[]
  getManagementVisibleByIds(agentId: string, memoryIds: string[]): AgentMemoryRow[]
  getStatus(agentId: string): MemoryStatus
  getHealth(agentId: string): MemoryHealthDto
  canReindex(agentId: string): boolean
  isReindexing(agentId: string): boolean
  reindexEmbeddings(agentId: string, force?: boolean): Promise<void>
  getLifecycle(agentId: string, memoryId: string): MemoryLifecycle | null
  getArchiveCandidateLifecyclePreview(agentId: string): MemoryArchiveCandidateLifecyclePreview
  deleteMemory(agentId: string, memoryId: string): Promise<MemoryCommandResult>
  archiveUserMemory(agentId: string, memoryId: string): Promise<MemoryCommandResult>
  clearMemoriesWithCleanup(agentId: string): Promise<MemoryClearResult>
  restoreMemory(agentId: string, memoryId: string): MemoryCommandResult
  listConflicts(agentId: string): MemoryConflictPair[]
  resolveConflict(
    agentId: string,
    challengerId: string,
    outcome: MemoryConflictResolution,
    actorType: 'scheduler' | 'user'
  ): Promise<MemoryCommandResult>
  listPersonaVersions(agentId: string): AgentMemoryRow[]
  rollbackPersona(agentId: string, versionId: string): Promise<MemoryCommandResult>
  listPersonaDrafts(agentId: string): { row: AgentMemoryRow; needsReview: boolean }[]
  approvePersonaDraft(agentId: string, draftId: string): Promise<MemoryCommandResult>
  rejectPersonaDraft(agentId: string, draftId: string): Promise<MemoryCommandResult>
  setPersonaAnchor(
    agentId: string,
    versionId: string,
    anchored: boolean
  ): Promise<MemoryCommandResult>
  listDirectives(agentId: string, options?: MemoryDirectiveListOptions): AgentMemoryDirectiveRow[]
  createDirectiveResult(
    agentId: string,
    input: MemoryDirectiveInput,
    source?: ExplicitMemoryDirectiveSource
  ): MemoryDirectiveCommandResult
  approveDirectiveResult(agentId: string, directiveId: string): MemoryDirectiveCommandResult
  rejectDirectiveResult(agentId: string, directiveId: string): MemoryDirectiveCommandResult
  deleteDirectiveResult(agentId: string, directiveId: string): MemoryCommandResult
}

export function createMemoryRoutes(deps: {
  memoryService: MemoryRouteService
  getAgentType(agentId: string): Promise<string | null>
  getTapeInspection(): TapeInspectionReader
  getAuditEntries(): MemoryAuditEntries
}): DeepchatRouteMap {
  const { memoryService } = deps
  const getSourceSpan = (agentId: string, memoryId: string) => {
    const [row] = memoryService.getManagementVisibleByIds(agentId, [memoryId])
    if (!row || row.agent_id !== agentId || !row.source_session) return null
    const sourceEntryIds = parseAgentMemorySourceEntryIds(row.source_entry_ids)
    if (!sourceEntryIds?.length) return null
    const entries = deps
      .getTapeInspection()
      .getEffectiveMessageSourceSpan(row.source_session, sourceEntryIds)
      .map((entry) => ({
        entryId: entry.entryId,
        role: entry.record.role,
        content: formatMemorySourceRecordContent(entry.record),
        orderSeq: entry.record.orderSeq
      }))
      .filter((entry) => entry.content.length > 0)
    return entries.length > 0 ? { sessionId: row.source_session, entries } : null
  }

  return createRouteMap([
    [
      memoryListRoute.name,
      async (rawInput) => {
        const input = memoryListRoute.input.parse(rawInput)
        const rows: AgentMemoryRow[] = []
        let cursor: { createdAt: number; id: string } | null = null
        do {
          const page = memoryService.pageMemories(input.agentId, cursor, 200)
          rows.push(...page.rows)
          cursor = page.nextCursor
        } while (cursor)
        return memoryListRoute.output.parse({
          memories: rows.map(toMemoryItemDto)
        })
      }
    ],
    [
      memoryPageRoute.name,
      async (rawInput) => {
        const input = memoryPageRoute.input.parse(rawInput)
        if ((await deps.getAgentType(input.agentId)) !== 'deepchat') {
          return memoryPageRoute.output.parse({ items: [], nextCursor: null })
        }
        const page = memoryService.pageMemories(
          input.agentId,
          input.cursor ? decodeMemoryPageCursor(input.cursor) : null,
          input.limit
        )
        return memoryPageRoute.output.parse({
          items: page.rows.map(toMemoryItemDto),
          nextCursor: page.nextCursor ? encodeMemoryPageCursor({ v: 1, ...page.nextCursor }) : null
        })
      }
    ],
    [
      memorySearchRoute.name,
      async (rawInput) => {
        const input = memorySearchRoute.input.parse(rawInput)
        const hits = await memoryService.searchMemories(input.agentId, input.query, {
          limit: input.limit,
          scopeContext: input.scopeContext
        })
        return memorySearchRoute.output.parse({
          results: hits.map((hit) => ({
            ...toMemoryItemDto(hit.row),
            score: hit.score,
            sources: hit.sources,
            similarity: hit.similarity
          }))
        })
      }
    ],
    [
      memoryAddRoute.name,
      async (rawInput) => {
        const input = memoryAddRoute.input.parse(rawInput)
        const outcome = await memoryService.addUserMemory(
          input.agentId,
          {
            content: input.content,
            kind: input.kind,
            category: input.category,
            importance: input.importance,
            scope: input.scope
          },
          input.sessionId
        )
        return memoryAddRoute.output.parse({ result: toMemoryAddResultDto(outcome) })
      }
    ],
    [
      memoryUpdateRoute.name,
      async (rawInput) => {
        const input = memoryUpdateRoute.input.parse(rawInput)
        if ((await deps.getAgentType(input.agentId)) !== 'deepchat') {
          return memoryUpdateRoute.output.parse({ result: { action: 'noop' } })
        }
        return memoryUpdateRoute.output.parse({
          result: memoryService.updateMemory(input.agentId, input.memoryId, input.patch)
        })
      }
    ],
    [
      memoryGetByIdsRoute.name,
      async (rawInput) => {
        const input = memoryGetByIdsRoute.input.parse(rawInput)
        if ((await deps.getAgentType(input.agentId)) !== 'deepchat') {
          return memoryGetByIdsRoute.output.parse({ memories: [] })
        }
        return memoryGetByIdsRoute.output.parse({
          memories: memoryService.getByIds(input.agentId, input.memoryIds).map(toMemoryItemDto)
        })
      }
    ],
    [
      memoryGetStatusRoute.name,
      async (rawInput) => {
        const input = memoryGetStatusRoute.input.parse(rawInput)
        return memoryGetStatusRoute.output.parse({ status: memoryService.getStatus(input.agentId) })
      }
    ],
    [
      memoryGetHealthRoute.name,
      async (rawInput) => {
        const input = memoryGetHealthRoute.input.parse(rawInput)
        const health =
          (await deps.getAgentType(input.agentId)) === 'deepchat'
            ? memoryService.getHealth(input.agentId)
            : createEmptyMemoryHealth()
        return memoryGetHealthRoute.output.parse({ health })
      }
    ],
    [
      memoryReindexRoute.name,
      async (rawInput) => {
        const input = memoryReindexRoute.input.parse(rawInput)
        if (
          (await deps.getAgentType(input.agentId)) !== 'deepchat' ||
          !memoryService.canReindex(input.agentId)
        ) {
          return memoryReindexRoute.output.parse({ started: false })
        }
        const already = memoryService.isReindexing(input.agentId)
        void memoryService.reindexEmbeddings(input.agentId, true).catch((error) => {
          console.warn(`[Memory] manual reindex failed for ${input.agentId}: ${String(error)}`)
        })
        return memoryReindexRoute.output.parse({ started: !already })
      }
    ],
    [
      memoryGetLifecycleRoute.name,
      async (rawInput) => {
        const input = memoryGetLifecycleRoute.input.parse(rawInput)
        const lifecycle =
          (await deps.getAgentType(input.agentId)) === 'deepchat'
            ? memoryService.getLifecycle(input.agentId, input.memoryId)
            : null
        return memoryGetLifecycleRoute.output.parse({ lifecycle })
      }
    ],
    [
      memoryGetArchiveCandidateLifecyclePreviewRoute.name,
      async (rawInput) => {
        const input = memoryGetArchiveCandidateLifecyclePreviewRoute.input.parse(rawInput)
        const preview =
          (await deps.getAgentType(input.agentId)) === 'deepchat'
            ? memoryService.getArchiveCandidateLifecyclePreview(input.agentId)
            : createEmptyArchiveCandidateLifecyclePreview()
        return memoryGetArchiveCandidateLifecyclePreviewRoute.output.parse({ preview })
      }
    ],
    [
      memoryListAuditEventsRoute.name,
      async (rawInput) => {
        const input = memoryListAuditEventsRoute.input.parse(rawInput)
        if ((await deps.getAgentType(input.agentId)) !== 'deepchat') {
          return memoryListAuditEventsRoute.output.parse({ events: [] })
        }
        const events = deps
          .getAuditEntries()
          .listByAgent(input.agentId, {
            eventType: input.eventType,
            actorType: input.actorType,
            sessionId: input.sessionId,
            status: input.status,
            startCreatedAt: input.startCreatedAt,
            endCreatedAt: input.endCreatedAt,
            limit: input.limit
          })
          .map(toMemoryAuditEventDto)
        return memoryListAuditEventsRoute.output.parse({ events })
      }
    ],
    [
      memoryListViewManifestsRoute.name,
      async (rawInput) => {
        const input = memoryListViewManifestsRoute.input.parse(rawInput)
        if ((await deps.getAgentType(input.agentId)) !== 'deepchat') {
          return memoryListViewManifestsRoute.output.parse({ manifests: [] })
        }
        const limit = input.limit ?? 100
        const manifests = deps
          .getTapeInspection()
          .listMemoryViewManifestsByAgent(input.agentId, {
            sessionId: input.sessionId,
            limit,
            messageId: input.messageId
          })
          .slice(0, limit)
        return memoryListViewManifestsRoute.output.parse({ manifests })
      }
    ],
    [
      memoryDeleteRoute.name,
      async (rawInput) => {
        const input = memoryDeleteRoute.input.parse(rawInput)
        return memoryDeleteRoute.output.parse(
          await memoryService.deleteMemory(input.agentId, input.memoryId)
        )
      }
    ],
    [
      memoryArchiveRoute.name,
      async (rawInput) => {
        const input = memoryArchiveRoute.input.parse(rawInput)
        if ((await deps.getAgentType(input.agentId)) !== 'deepchat') {
          return memoryArchiveRoute.output.parse({
            action: 'rejected',
            reason: 'unavailable'
          })
        }
        return memoryArchiveRoute.output.parse(
          await memoryService.archiveUserMemory(input.agentId, input.memoryId)
        )
      }
    ],
    [
      memoryClearRoute.name,
      async (rawInput) => {
        const input = memoryClearRoute.input.parse(rawInput)
        return memoryClearRoute.output.parse(
          await memoryService.clearMemoriesWithCleanup(input.agentId)
        )
      }
    ],
    [
      memoryRestoreRoute.name,
      async (rawInput) => {
        const input = memoryRestoreRoute.input.parse(rawInput)
        return memoryRestoreRoute.output.parse(
          memoryService.restoreMemory(input.agentId, input.memoryId)
        )
      }
    ],
    [
      memoryGetSourceSpanRoute.name,
      async (rawInput) => {
        const input = memoryGetSourceSpanRoute.input.parse(rawInput)
        return memoryGetSourceSpanRoute.output.parse({
          span: getSourceSpan(input.agentId, input.memoryId)
        })
      }
    ],
    [
      memoryListConflictsRoute.name,
      async (rawInput) => {
        const input = memoryListConflictsRoute.input.parse(rawInput)
        return memoryListConflictsRoute.output.parse({
          conflicts: memoryService.listConflicts(input.agentId).map((pair) => ({
            challenger: toMemoryItemDto(pair.challenger),
            target: toMemoryItemDto(pair.target)
          }))
        })
      }
    ],
    [
      memoryResolveConflictRoute.name,
      async (rawInput) => {
        const input = memoryResolveConflictRoute.input.parse(rawInput)
        return memoryResolveConflictRoute.output.parse(
          await memoryService.resolveConflict(
            input.agentId,
            input.challengerId,
            input.outcome,
            'user'
          )
        )
      }
    ],
    [
      memoryListPersonaVersionsRoute.name,
      async (rawInput) => {
        const input = memoryListPersonaVersionsRoute.input.parse(rawInput)
        return memoryListPersonaVersionsRoute.output.parse({
          versions: memoryService.listPersonaVersions(input.agentId).map(toMemoryItemDto)
        })
      }
    ],
    [
      memoryRollbackPersonaRoute.name,
      async (rawInput) => {
        const input = memoryRollbackPersonaRoute.input.parse(rawInput)
        return memoryRollbackPersonaRoute.output.parse(
          await memoryService.rollbackPersona(input.agentId, input.versionId)
        )
      }
    ],
    [
      memoryListPersonaDraftsRoute.name,
      async (rawInput) => {
        const input = memoryListPersonaDraftsRoute.input.parse(rawInput)
        return memoryListPersonaDraftsRoute.output.parse({
          drafts: memoryService
            .listPersonaDrafts(input.agentId)
            .map(({ row, needsReview }) => ({ ...toMemoryItemDto(row), needsReview }))
        })
      }
    ],
    [
      memoryApprovePersonaDraftRoute.name,
      async (rawInput) => {
        const input = memoryApprovePersonaDraftRoute.input.parse(rawInput)
        return memoryApprovePersonaDraftRoute.output.parse(
          await memoryService.approvePersonaDraft(input.agentId, input.draftId)
        )
      }
    ],
    [
      memoryRejectPersonaDraftRoute.name,
      async (rawInput) => {
        const input = memoryRejectPersonaDraftRoute.input.parse(rawInput)
        return memoryRejectPersonaDraftRoute.output.parse(
          await memoryService.rejectPersonaDraft(input.agentId, input.draftId)
        )
      }
    ],
    [
      memorySetPersonaAnchorRoute.name,
      async (rawInput) => {
        const input = memorySetPersonaAnchorRoute.input.parse(rawInput)
        return memorySetPersonaAnchorRoute.output.parse(
          await memoryService.setPersonaAnchor(input.agentId, input.versionId, input.anchored)
        )
      }
    ],
    [
      memoryListDirectivesRoute.name,
      async (rawInput) => {
        const input = memoryListDirectivesRoute.input.parse(rawInput)
        if ((await deps.getAgentType(input.agentId)) !== 'deepchat') {
          return memoryListDirectivesRoute.output.parse({ directives: [] })
        }
        return memoryListDirectivesRoute.output.parse({
          directives: memoryService
            .listDirectives(input.agentId, {
              statuses: input.statuses,
              limit: input.limit
            })
            .map(toMemoryDirectiveDto)
        })
      }
    ],
    [
      memoryCreateDirectiveRoute.name,
      async (rawInput) => {
        const input = memoryCreateDirectiveRoute.input.parse(rawInput)
        const result =
          (await deps.getAgentType(input.agentId)) === 'deepchat'
            ? memoryService.createDirectiveResult(input.agentId, input.directive, 'manual')
            : { action: 'rejected' as const, directive: null, reason: 'unavailable' as const }
        return memoryCreateDirectiveRoute.output.parse(toMemoryDirectiveCommandDto(result))
      }
    ],
    [
      memoryApproveDirectiveRoute.name,
      async (rawInput) => {
        const input = memoryApproveDirectiveRoute.input.parse(rawInput)
        const result =
          (await deps.getAgentType(input.agentId)) === 'deepchat'
            ? memoryService.approveDirectiveResult(input.agentId, input.directiveId)
            : { action: 'rejected' as const, directive: null, reason: 'unavailable' as const }
        return memoryApproveDirectiveRoute.output.parse(toMemoryDirectiveCommandDto(result))
      }
    ],
    [
      memoryRejectDirectiveRoute.name,
      async (rawInput) => {
        const input = memoryRejectDirectiveRoute.input.parse(rawInput)
        const result =
          (await deps.getAgentType(input.agentId)) === 'deepchat'
            ? memoryService.rejectDirectiveResult(input.agentId, input.directiveId)
            : { action: 'rejected' as const, directive: null, reason: 'unavailable' as const }
        return memoryRejectDirectiveRoute.output.parse(toMemoryDirectiveCommandDto(result))
      }
    ],
    [
      memoryDeleteDirectiveRoute.name,
      async (rawInput) => {
        const input = memoryDeleteDirectiveRoute.input.parse(rawInput)
        const result =
          (await deps.getAgentType(input.agentId)) === 'deepchat'
            ? memoryService.deleteDirectiveResult(input.agentId, input.directiveId)
            : { action: 'rejected' as const, reason: 'unavailable' as const }
        return memoryDeleteDirectiveRoute.output.parse(result)
      }
    ]
  ])
}
