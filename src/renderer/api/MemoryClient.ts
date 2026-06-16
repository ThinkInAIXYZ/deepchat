import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  memoryClearRoute,
  memoryDeleteRoute,
  memoryGetStatusRoute,
  memoryListPersonaVersionsRoute,
  memoryListRoute,
  memoryRollbackPersonaRoute,
  type MemoryItem,
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

  async function listPersonaVersions(agentId: string): Promise<MemoryItem[]> {
    const result = await bridge.invoke(memoryListPersonaVersionsRoute.name, { agentId })
    return result.versions
  }

  async function rollbackPersona(agentId: string, versionId: string): Promise<boolean> {
    const result = await bridge.invoke(memoryRollbackPersonaRoute.name, { agentId, versionId })
    return result.ok
  }

  /** 订阅记忆变更事件；返回取消订阅函数。 */
  function onUpdated(listener: (payload: MemoryUpdatedPayload) => void): () => void {
    return bridge.on(memoryUpdatedEvent.name, listener)
  }

  return {
    list,
    getStatus,
    remove,
    clear,
    listPersonaVersions,
    rollbackPersona,
    onUpdated
  }
}
