import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  memoryAddRoute,
  memoryApprovePersonaDraftRoute,
  memoryClearRoute,
  memoryDeleteRoute,
  memoryGetArchiveCandidateLifecyclePreviewRoute,
  memoryGetSourceSpanRoute,
  memoryGetHealthRoute,
  memoryGetLifecycleRoute,
  memoryGetStatusRoute,
  memoryListAuditEventsRoute,
  memoryListConflictsRoute,
  memoryListPersonaDraftsRoute,
  memoryListPersonaVersionsRoute,
  memoryListRoute,
  memoryListViewManifestsRoute,
  memoryRejectPersonaDraftRoute,
  memoryResolveConflictRoute,
  memoryRestoreRoute,
  memoryRollbackPersonaRoute,
  memorySearchRoute,
  memorySetPersonaAnchorRoute,
  type MemoryAddResult,
  type MemoryArchiveCandidateLifecyclePreview,
  type MemoryConflictItem,
  type MemoryAuditEvent,
  type MemoryHealthDto,
  type MemoryItem,
  type MemoryLifecycle,
  type MemorySearchResult,
  type MemorySourceSpan,
  type MemoryStatusDto,
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
}

export function createMemoryClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function list(agentId: string): Promise<MemoryItem[]> {
    const result = await bridge.invoke(memoryListRoute.name, { agentId })
    return result.memories
  }

  async function getStatus(agentId: string): Promise<MemoryStatusDto> {
    const result = await bridge.invoke(memoryGetStatusRoute.name, { agentId })
    return result.status
  }

  async function getHealth(agentId: string): Promise<MemoryHealthDto> {
    const result = await bridge.invoke(memoryGetHealthRoute.name, { agentId })
    return result.health
  }

  async function getLifecycle(agentId: string, memoryId: string): Promise<MemoryLifecycle[]> {
    const result = await bridge.invoke(memoryGetLifecycleRoute.name, { agentId, memoryId })
    return result.lifecycles
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
    options?: { limit?: number }
  ): Promise<MemorySearchResult[]> {
    const result = await bridge.invoke(memorySearchRoute.name, {
      agentId,
      query,
      limit: options?.limit
    })
    return result.results
  }

  async function add(agentId: string, input: MemoryAddInput): Promise<MemoryAddResult> {
    const payload: MemoryAddPayload = {
      agentId,
      content: input.content,
      importance: input.importance
    }
    if (input.category !== undefined) {
      payload.category = input.category
    } else if (input.kind !== undefined) {
      payload.kind = input.kind
    }

    const result = await bridge.invoke(memoryAddRoute.name, payload)
    return result.result
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

  async function remove(agentId: string, memoryId: string): Promise<boolean> {
    const result = await bridge.invoke(memoryDeleteRoute.name, { agentId, memoryId })
    return result.ok
  }

  async function clear(agentId: string): Promise<number> {
    const result = await bridge.invoke(memoryClearRoute.name, { agentId })
    return result.removed
  }

  async function restore(agentId: string, memoryId: string): Promise<boolean> {
    const result = await bridge.invoke(memoryRestoreRoute.name, { agentId, memoryId })
    return result.ok
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
  ): Promise<boolean> {
    const result = await bridge.invoke(memoryResolveConflictRoute.name, {
      agentId,
      challengerId,
      outcome
    })
    return result.ok
  }

  async function listPersonaVersions(agentId: string): Promise<MemoryItem[]> {
    const result = await bridge.invoke(memoryListPersonaVersionsRoute.name, { agentId })
    return result.versions
  }

  async function rollbackPersona(agentId: string, versionId: string): Promise<boolean> {
    const result = await bridge.invoke(memoryRollbackPersonaRoute.name, { agentId, versionId })
    return result.ok
  }

  async function listPersonaDrafts(agentId: string): Promise<MemoryItem[]> {
    const result = await bridge.invoke(memoryListPersonaDraftsRoute.name, { agentId })
    return result.drafts
  }

  async function approvePersonaDraft(agentId: string, draftId: string): Promise<boolean> {
    const result = await bridge.invoke(memoryApprovePersonaDraftRoute.name, { agentId, draftId })
    return result.ok
  }

  async function rejectPersonaDraft(agentId: string, draftId: string): Promise<boolean> {
    const result = await bridge.invoke(memoryRejectPersonaDraftRoute.name, { agentId, draftId })
    return result.ok
  }

  async function setPersonaAnchor(
    agentId: string,
    versionId: string,
    anchored: boolean
  ): Promise<boolean> {
    const result = await bridge.invoke(memorySetPersonaAnchorRoute.name, {
      agentId,
      versionId,
      anchored
    })
    return result.ok
  }

  function onUpdated(listener: (payload: MemoryUpdatedPayload) => void): () => void {
    return bridge.on(memoryUpdatedEvent.name, listener)
  }

  return {
    list,
    getStatus,
    getHealth,
    getLifecycle,
    getArchiveCandidateLifecyclePreview,
    search,
    add,
    listAuditEvents,
    listViewManifests,
    remove,
    clear,
    restore,
    getSourceSpan,
    listConflicts,
    resolveConflict,
    listPersonaVersions,
    rollbackPersona,
    listPersonaDrafts,
    approvePersonaDraft,
    rejectPersonaDraft,
    setPersonaAnchor,
    onUpdated
  }
}
