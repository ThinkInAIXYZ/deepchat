import type { DeepChatAgentConfig } from '@shared/types/agent-interface'

import type { MemoryModelRef } from '../domain/types'

export interface MemoryExecutionToken {
  agentId: string
  generation: number
}

export type MemoryExecutionConfigObservation = 'seeded' | 'unchanged' | 'changed'

export function resolveMemoryEmbedding(
  config: DeepChatAgentConfig | null | undefined
): MemoryModelRef | null {
  const embedding = config?.memoryEmbedding
  return embedding?.providerId && embedding?.modelId
    ? { providerId: embedding.providerId, modelId: embedding.modelId }
    : null
}

export function memoryEmbeddingFingerprint(embedding: MemoryModelRef): string
export function memoryEmbeddingFingerprint(embedding: null): null
export function memoryEmbeddingFingerprint(embedding: MemoryModelRef | null): string | null
export function memoryEmbeddingFingerprint(embedding: MemoryModelRef | null): string | null {
  return embedding ? JSON.stringify([embedding.providerId, embedding.modelId]) : null
}

export function memoryEmbeddingStorageFingerprint(embedding: MemoryModelRef): string
export function memoryEmbeddingStorageFingerprint(embedding: null): null
export function memoryEmbeddingStorageFingerprint(embedding: MemoryModelRef | null): string | null
export function memoryEmbeddingStorageFingerprint(embedding: MemoryModelRef | null): string | null {
  return embedding ? `${embedding.providerId}:${embedding.modelId}` : null
}

export function memoryExecutionConfigFingerprint(
  config: DeepChatAgentConfig | null | undefined
): string {
  return JSON.stringify([
    config?.memoryEnabled === true,
    memoryEmbeddingFingerprint(resolveMemoryEmbedding(config))
  ])
}
