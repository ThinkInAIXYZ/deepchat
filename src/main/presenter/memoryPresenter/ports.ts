import type { MemoryModelRef } from './context'
import type { IMemoryVectorStore } from './types'

export interface VectorStoreRetrievalPort {
  isWarm(agentId: string, embedding: MemoryModelRef): boolean
  getVectorStore(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number
  ): Promise<IMemoryVectorStore>
  markReady(agentId: string, embedding: MemoryModelRef, dimensions: number): void
  clearReady(agentId: string): void
}

export interface WorkingMemoryReadPort {
  readWorkingMemory(agentId: string): string | null
  scheduleWorkingRefresh(agentId: string): void
}
