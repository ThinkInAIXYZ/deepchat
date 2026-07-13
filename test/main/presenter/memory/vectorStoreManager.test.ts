import { describe, expect, it, vi } from 'vitest'

import { MemoryRuntimeContext } from '@/presenter/memoryPresenter/context'
import { VectorStoreManager } from '@/presenter/memoryPresenter/infra/vectorStoreManager'
import type {
  IMemoryVectorStore,
  MemoryEmbeddingRepositoryPort
} from '@/presenter/memoryPresenter/ports'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'

function createStore(): IMemoryVectorStore {
  return {
    upsert: async () => undefined,
    query: async () => [],
    queryByMemoryId: async () => [],
    deleteByMemoryIds: async () => undefined,
    listMemoryIds: async () => [],
    close: async () => undefined,
    isUsable: () => true
  }
}

describe('VectorStoreManager certificate generations', () => {
  it('rejects a stale config lease epoch and only certifies the new identity', async () => {
    let config = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm1' }
    } as DeepChatAgentConfig
    const policy = { resolveAgentConfig: () => config }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const manager = new VectorStoreManager({
      ctx,
      policy,
      repository: {} as MemoryEmbeddingRepositoryPort,
      vectorStoreFactory: {
        createVectorStore: async () => createStore(),
        resetVectorStore: async () => undefined
      }
    })
    const first = { providerId: 'p', modelId: 'm1' }
    let firstEpoch = 0
    await manager.withStoreLease('agent', first, 4, async (_store, epoch) => {
      firstEpoch = epoch
      manager.markReady('agent', first, 4, epoch)
    })
    expect(manager.hasReadyCertificate('agent', first)).toBe(true)

    const second = { providerId: 'p', modelId: 'm2' }
    config = { memoryEnabled: true, memoryEmbedding: second } as DeepChatAgentConfig
    manager.noteEmbeddingConfig('agent', second)
    manager.markReady('agent', second, 4, firstEpoch)
    expect(manager.hasReadyCertificate('agent', second)).toBe(false)

    let secondEpoch = 0
    await manager.withStoreLease('agent', second, 4, async (_store, epoch) => {
      secondEpoch = epoch
      manager.markReady('agent', second, 4, epoch)
    })
    expect(secondEpoch).toBeGreaterThan(firstEpoch)
    expect(manager.hasReadyCertificate('agent', second)).toBe(true)
    await manager.closeAllStores()
  })

  it('invalidates a ready certificate when the logical store identity changes', async () => {
    const embedding = { providerId: 'p', modelId: 'm' }
    const policy = {
      resolveAgentConfig: () =>
        ({ memoryEnabled: true, memoryEmbedding: embedding }) as DeepChatAgentConfig
    }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const manager = new VectorStoreManager({
      ctx,
      policy,
      repository: {} as MemoryEmbeddingRepositoryPort,
      vectorStoreFactory: {
        createVectorStore: async () => createStore(),
        resetVectorStore: async () => undefined
      }
    })
    await manager.withStoreLease('agent', embedding, 4, async (_store, epoch) => {
      manager.markReady('agent', embedding, 4, epoch)
    })
    expect(manager.hasReadyCertificate('agent', embedding)).toBe(true)

    await manager.withStoreLease('agent', embedding, 8, async () => undefined)

    expect(manager.hasReadyCertificate('agent', embedding)).toBe(false)
    await manager.closeAllStores()
  })
})
