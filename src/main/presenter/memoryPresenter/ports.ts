import type { MemoryModelRef } from './context'
import type { MemoryVectorMatch } from './types'

export const MEMORY_PERF_COUNTER_NAMES = [
  'sqliteStatements',
  'repositoryCalls',
  'materializedRows',
  'providerCalls',
  'duckDbStatements'
] as const

export const MEMORY_PERF_HIGH_WATER_NAMES = [
  'openStores',
  'activeLeases',
  'queueDepth',
  'cacheEntries'
] as const

export type MemoryPerfCounterName = (typeof MEMORY_PERF_COUNTER_NAMES)[number]
export type MemoryPerfHighWaterName = (typeof MEMORY_PERF_HIGH_WATER_NAMES)[number]

export interface MemoryPerfObserver {
  increment(name: MemoryPerfCounterName, amount?: number): void
  observe(name: MemoryPerfHighWaterName, value: number): void
}

export interface VectorStoreRetrievalPort {
  hasReadyCertificate(agentId: string, embedding: MemoryModelRef): boolean
  query(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    vector: number[],
    topK: number
  ): Promise<MemoryVectorMatch[]>
  queryBatch(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    vectors: readonly number[][],
    topK: number
  ): Promise<MemoryVectorMatch[][]>
  markReady(
    agentId: string,
    embedding: MemoryModelRef,
    dimensions: number,
    leaseEpoch?: number
  ): void
  clearReady(agentId: string): void
}

export interface WorkingMemoryReadPort {
  readWorkingMemory(agentId: string): string | null
  flushWorkingMemoryIfDirty(agentId: string): void
  scheduleWorkingRefresh(agentId: string): void
}
