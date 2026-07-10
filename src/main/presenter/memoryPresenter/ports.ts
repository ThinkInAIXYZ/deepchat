import type { MemoryModelRef } from './context'
import type { MemoryVectorMatch } from './types'

export interface VectorStoreRetrievalPort {
  isWarm(agentId: string, embedding: MemoryModelRef): boolean
  query(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    vector: number[],
    topK: number
  ): Promise<MemoryVectorMatch[]>
  markReady(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    generation?: number
  ): void
  clearReady(agentId: string): void
}

export interface WorkingMemoryReadPort {
  readWorkingMemory(agentId: string): string | null
  flushWorkingMemoryIfDirty(agentId: string): void
  scheduleWorkingRefresh(agentId: string): void
}
