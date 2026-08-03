import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  memoryAddRoute,
  memoryApproveDirectiveRoute,
  memoryArchiveRoute,
  memoryApprovePersonaDraftRoute,
  memoryClearRoute,
  memoryCreateDirectiveRoute,
  memoryDeleteRoute,
  memoryDeleteDirectiveRoute,
  memoryGetArchiveCandidateLifecyclePreviewRoute,
  memoryGetByIdsRoute,
  memoryGetSourceSpanRoute,
  memoryGetHealthRoute,
  memoryGetLifecycleRoute,
  memoryGetStatusRoute,
  memoryListAuditEventsRoute,
  memoryListConflictsRoute,
  memoryListDirectivesRoute,
  memoryListPersonaDraftsRoute,
  memoryListPersonaVersionsRoute,
  memoryPageRoute,
  memoryListRoute,
  memoryListViewManifestsRoute,
  memoryRejectDirectiveRoute,
  memoryRejectPersonaDraftRoute,
  memoryReindexRoute,
  memoryResolveConflictRoute,
  memoryRestoreRoute,
  memoryRollbackPersonaRoute,
  memorySearchRoute,
  memorySetPersonaAnchorRoute,
  memoryUpdateRoute,
  type MemoryAddResult,
  type MemoryArchiveCandidateLifecyclePreview,
  type MemoryConflictItem,
  type MemoryAuditEvent,
  type MemoryDirectiveCreateInput,
  type MemoryDirectiveCommandResult,
  type MemoryDirectiveItem,
  type MemoryHealthDto,
  type MemoryItem,
  type MemoryPage,
  type MemoryLifecycle,
  type MemoryCommandResult,
  type MemorySearchResult,
  type MemoryScopeContextInput,
  type MemoryScopeInput,
  type MemorySourceSpan,
  type MemoryStatusDto,
  type MemoryUpdateResult,
  type MemoryViewManifest
} from '@shared/contracts/routes'
import { memoryUpdatedEvent, type DeepchatEventPayload } from '@shared/contracts/events'
import type { AgentMemoryCategory } from '@shared/types/agent-memory'
import { getDeepchatBridge } from './core'

export type MemoryUpdatedPayload = DeepchatEventPayload<typeof memoryUpdatedEvent.name>

type MemoryAddKind = 'episodic' | 'semantic'
type MemoryAddInputBase = {
  content: string
  importance?: number
  sessionId?: string
  scope?: MemoryScopeInput
}
type MemoryAddByKindInput = MemoryAddInputBase & {
  kind?: MemoryAddKind
  category?: never
}
type MemoryAddByCategoryInput = MemoryAddInputBase & {
  kind?: never
  category: AgentMemoryCategory
}
type MemoryAddInput = MemoryAddByKindInput | MemoryAddByCategoryInput
type MemoryAddPayload = {
  agentId: string
  content: string
  kind?: MemoryAddKind
  category?: AgentMemoryCategory
  importance?: number
  sessionId?: string
  scope?: MemoryScopeInput
}
type MemoryUpdateInput = {
  content?: string
  category?: AgentMemoryCategory | null
  importance?: number
}

export function createMemoryClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  /** @deprecated Use page for bounded management reads. */
  async function list(agentId: string): Promise<MemoryItem[]> {
    const result = await bridge.invoke(memoryListRoute.name, { agentId })
    return result.memories
  }

  async function page(
    agentId: string,
    options: { cursor?: string; limit?: number } = {}
  ): Promise<MemoryPage> {
    return bridge.invoke(memoryPageRoute.name, {
      agentId,
      cursor: options.cursor,
      limit: options.limit
    })
  }

  async function getStatus(agentId: string): Promise<MemoryStatusDto> {
    const result = await bridge.invoke(memoryGetStatusRoute.name, { agentId })
    return result.status
  }

  async function getHealth(agentId: string): Promise<MemoryHealthDto> {
    const result = await bridge.invoke(memoryGetHealthRoute.name, { agentId })
    return result.health
  }

  async function getLifecycle(agentId: string, memoryId: string): Promise<MemoryLifecycle | null> {
    const result = await bridge.invoke(memoryGetLifecycleRoute.name, { agentId, memoryId })
    return result.lifecycle
  }

  async function getArchiveCandidateLifecyclePreview(
    agentId: string
  ): Promise<MemoryArchiveCandidateLifecyclePreview> {
    const result = await bridge.invoke(memoryGetArchiveCandidateLifecyclePreviewRoute.name, {
      agentId
    })
    return result.preview
  }

  async function search(
    agentId: string,
    query: string,
    options?: { limit?: number; scopeContext?: MemoryScopeContextInput }
  ): Promise<MemorySearchResult[]> {
    const result = await bridge.invoke(memorySearchRoute.name, {
      agentId,
      query,
      limit: options?.limit,
      scopeContext: options?.scopeContext
    })
    return result.results
  }

  async function add(agentId: string, input: MemoryAddInput): Promise<MemoryAddResult> {
    const payload: MemoryAddPayload = {
      agentId,
      content: input.content,
      importance: input.importance,
      sessionId: input.sessionId,
      scope: input.scope
    }
    if (input.category !== undefined) {
      payload.category = input.category
    } else if (input.kind !== undefined) {
      payload.kind = input.kind
    }

    const result = await bridge.invoke(memoryAddRoute.name, payload)
    return result.result
  }

  async function update(
    agentId: string,
    memoryId: string,
    patch: MemoryUpdateInput
  ): Promise<MemoryUpdateResult> {
    const result = await bridge.invoke(memoryUpdateRoute.name, { agentId, memoryId, patch })
    return result.result
  }

  async function getByIds(agentId: string, memoryIds: string[]): Promise<MemoryItem[]> {
    const result = await bridge.invoke(memoryGetByIdsRoute.name, { agentId, memoryIds })
    return result.memories
  }

  async function listAuditEvents(
    agentId: string,
    options?: {
      eventType?: string
      actorType?: 'scheduler' | 'user' | 'runtime'
      sessionId?: string
      status?: 'completed' | 'skipped' | 'failed'
      startCreatedAt?: number
      endCreatedAt?: number
      limit?: number
    }
  ): Promise<MemoryAuditEvent[]> {
    const result = await bridge.invoke(memoryListAuditEventsRoute.name, { agentId, ...options })
    return result.events
  }

  async function listViewManifests(
    agentId: string,
    options?: { sessionId?: string; messageId?: string; limit?: number }
  ): Promise<MemoryViewManifest[]> {
    const result = await bridge.invoke(memoryListViewManifestsRoute.name, {
      agentId,
      sessionId: options?.sessionId,
      messageId: options?.messageId,
      limit: options?.limit
    })
    return result.manifests
  }

  async function remove(agentId: string, memoryId: string): Promise<MemoryCommandResult> {
    return bridge.invoke(memoryDeleteRoute.name, { agentId, memoryId })
  }

  async function archive(agentId: string, memoryId: string): Promise<MemoryCommandResult> {
    return bridge.invoke(memoryArchiveRoute.name, { agentId, memoryId })
  }

  async function clear(
    agentId: string
  ): Promise<{ removed: number; cleanupPendingRestart: boolean }> {
    return bridge.invoke(memoryClearRoute.name, { agentId })
  }

  async function restore(agentId: string, memoryId: string): Promise<MemoryCommandResult> {
    return bridge.invoke(memoryRestoreRoute.name, { agentId, memoryId })
  }

  async function reindex(agentId: string): Promise<{ started: boolean }> {
    return bridge.invoke(memoryReindexRoute.name, { agentId })
  }

  async function getSourceSpan(agentId: string, memoryId: string): Promise<MemorySourceSpan> {
    const result = await bridge.invoke(memoryGetSourceSpanRoute.name, { agentId, memoryId })
    return result.span
  }

  async function listConflicts(agentId: string): Promise<MemoryConflictItem[]> {
    const result = await bridge.invoke(memoryListConflictsRoute.name, { agentId })
    return result.conflicts
  }

  async function resolveConflict(
    agentId: string,
    challengerId: string,
    outcome: 'keep_target' | 'keep_challenger' | 'keep_both'
  ): Promise<MemoryCommandResult> {
    return bridge.invoke(memoryResolveConflictRoute.name, {
      agentId,
      challengerId,
      outcome
    })
  }

  async function listPersonaVersions(agentId: string): Promise<MemoryItem[]> {
    const result = await bridge.invoke(memoryListPersonaVersionsRoute.name, { agentId })
    return result.versions
  }

  async function rollbackPersona(agentId: string, versionId: string): Promise<MemoryCommandResult> {
    return bridge.invoke(memoryRollbackPersonaRoute.name, { agentId, versionId })
  }

  async function listPersonaDrafts(agentId: string): Promise<MemoryItem[]> {
    const result = await bridge.invoke(memoryListPersonaDraftsRoute.name, { agentId })
    return result.drafts
  }

  async function approvePersonaDraft(
    agentId: string,
    draftId: string
  ): Promise<MemoryCommandResult> {
    return bridge.invoke(memoryApprovePersonaDraftRoute.name, { agentId, draftId })
  }

  async function rejectPersonaDraft(
    agentId: string,
    draftId: string
  ): Promise<MemoryCommandResult> {
    return bridge.invoke(memoryRejectPersonaDraftRoute.name, { agentId, draftId })
  }

  async function setPersonaAnchor(
    agentId: string,
    versionId: string,
    anchored: boolean
  ): Promise<MemoryCommandResult> {
    return bridge.invoke(memorySetPersonaAnchorRoute.name, {
      agentId,
      versionId,
      anchored
    })
  }

  async function listDirectives(
    agentId: string,
    options: {
      statuses?: MemoryDirectiveItem['status'][]
      limit?: number
    } = {}
  ): Promise<MemoryDirectiveItem[]> {
    const result = await bridge.invoke(memoryListDirectivesRoute.name, {
      agentId,
      statuses: options.statuses,
      limit: options.limit
    })
    return result.directives
  }

  async function createDirective(
    agentId: string,
    directive: MemoryDirectiveCreateInput
  ): Promise<MemoryDirectiveCommandResult> {
    return bridge.invoke(memoryCreateDirectiveRoute.name, { agentId, directive })
  }

  async function approveDirective(
    agentId: string,
    directiveId: string
  ): Promise<MemoryDirectiveCommandResult> {
    return bridge.invoke(memoryApproveDirectiveRoute.name, { agentId, directiveId })
  }

  async function rejectDirective(
    agentId: string,
    directiveId: string
  ): Promise<MemoryDirectiveCommandResult> {
    return bridge.invoke(memoryRejectDirectiveRoute.name, { agentId, directiveId })
  }

  async function deleteDirective(
    agentId: string,
    directiveId: string
  ): Promise<MemoryCommandResult> {
    return bridge.invoke(memoryDeleteDirectiveRoute.name, { agentId, directiveId })
  }

  function onUpdated(listener: (payload: MemoryUpdatedPayload) => void): () => void {
    return bridge.on(memoryUpdatedEvent.name, listener)
  }

  return {
    page,
    list,
    getStatus,
    getHealth,
    getLifecycle,
    getArchiveCandidateLifecyclePreview,
    search,
    add,
    update,
    getByIds,
    listAuditEvents,
    listViewManifests,
    remove,
    archive,
    clear,
    restore,
    reindex,
    getSourceSpan,
    listConflicts,
    resolveConflict,
    listPersonaVersions,
    rollbackPersona,
    listPersonaDrafts,
    approvePersonaDraft,
    rejectPersonaDraft,
    setPersonaAnchor,
    listDirectives,
    createDirective,
    approveDirective,
    rejectDirective,
    deleteDirective,
    onUpdated
  }
}
