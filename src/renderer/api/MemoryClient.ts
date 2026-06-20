import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  memoryApprovePersonaDraftRoute,
  memoryClearRoute,
  memoryDeleteRoute,
  memoryGetSourceSpanRoute,
  memoryGetStatusRoute,
  memoryListConflictsRoute,
  memoryListPersonaDraftsRoute,
  memoryListPersonaVersionsRoute,
  memoryListRoute,
  memoryRejectPersonaDraftRoute,
  memoryResolveConflictRoute,
  memoryRestoreRoute,
  memoryRollbackPersonaRoute,
  memorySetPersonaAnchorRoute,
  type MemoryConflictItem,
  type MemoryItem,
  type MemorySourceSpan,
  type MemoryStatusDto
} from '@shared/contracts/routes'
import { memoryUpdatedEvent, type DeepchatEventPayload } from '@shared/contracts/events'
import { getDeepchatBridge } from './core'

export type MemoryUpdatedPayload = DeepchatEventPayload<typeof memoryUpdatedEvent.name>

export function createMemoryClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function list(agentId: string): Promise<MemoryItem[]> {
    const result = await bridge.invoke(memoryListRoute.name, { agentId })
    return result.memories
  }

  async function getStatus(agentId: string): Promise<MemoryStatusDto> {
    const result = await bridge.invoke(memoryGetStatusRoute.name, { agentId })
    return result.status
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
