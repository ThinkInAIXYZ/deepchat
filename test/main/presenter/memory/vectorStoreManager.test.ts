import { describe, expect, it, vi } from 'vitest'

import { MemoryRuntimeContext } from '@/presenter/memoryPresenter/context'
import { VectorStoreManager } from '@/presenter/memoryPresenter/infra/vectorStoreManager'
import {
  MemoryVectorStorePostCommitError,
  MemoryVectorStoreQuarantineRequiredError
} from '@/presenter/memoryPresenter/infra/vectorStoreErrors'
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
        resetVectorStore: async () => undefined,
        markVectorStoreQuarantined: () => undefined
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
        resetVectorStore: async () => undefined,
        markVectorStoreQuarantined: () => undefined
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

describe('VectorStoreManager open failures', () => {
  it('persists quarantine and permanently closes same-process admission', async () => {
    const embedding = { providerId: 'p', modelId: 'm' }
    const policy = {
      resolveAgentConfig: () =>
        ({ memoryEnabled: true, memoryEmbedding: embedding }) as DeepChatAgentConfig
    }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const markVectorStoreQuarantined = vi.fn()
    const createVectorStore = vi.fn(async () => {
      throw new MemoryVectorStoreQuarantineRequiredError('preserve failed')
    })
    const resetVectorStore = vi.fn(async () => undefined)
    const manager = new VectorStoreManager({
      ctx,
      policy,
      repository: {} as MemoryEmbeddingRepositoryPort,
      vectorStoreFactory: {
        createVectorStore,
        resetVectorStore,
        markVectorStoreQuarantined
      }
    })

    await expect(
      manager.withStoreLease('agent', embedding, 4, async () => undefined)
    ).rejects.toMatchObject({ name: 'VectorStoreLeaseUnavailableError', reason: 'quarantined' })
    await expect(
      manager.withStoreLease('agent', embedding, 4, async () => undefined)
    ).rejects.toMatchObject({ reason: 'quarantined' })
    await expect(manager.resetAgentStore('agent')).resolves.toBe('pending-restart')
    await expect(manager.withVectorMutation('agent', async () => undefined)).rejects.toMatchObject({
      reason: 'quarantined'
    })
    manager.markReady('agent', embedding, 4)
    expect(manager.hasReadyCertificate('agent', embedding)).toBe(false)
    await manager.settleAgent('agent')
    await expect(
      manager.withStoreLease('agent', embedding, 4, async () => undefined)
    ).rejects.toMatchObject({ reason: 'quarantined' })

    expect(createVectorStore).toHaveBeenCalledTimes(1)
    expect(markVectorStoreQuarantined).toHaveBeenCalledTimes(2)
    expect(resetVectorStore).not.toHaveBeenCalled()
    await manager.closeAllStores()
  })

  it('keeps admission quarantined when marker persistence itself fails', async () => {
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
        createVectorStore: async () => {
          throw new MemoryVectorStoreQuarantineRequiredError('preserve failed')
        },
        resetVectorStore: async () => undefined,
        markVectorStoreQuarantined: () => {
          throw new Error('disk read-only')
        }
      }
    })

    await expect(
      manager.withStoreLease('agent', embedding, 4, async () => undefined)
    ).rejects.toMatchObject({ reason: 'quarantined' })
    await expect(
      manager.withStoreLease('agent', embedding, 4, async () => undefined)
    ).rejects.toMatchObject({ reason: 'quarantined' })
    await expect(manager.resetAgentStore('agent')).rejects.toMatchObject({
      name: 'VectorStoreQuarantineMarkerError'
    })
    await manager.closeAllStores()
  })

  it('persists quarantine after a committed store fails its final open', async () => {
    const embedding = { providerId: 'p', modelId: 'm' }
    const policy = {
      resolveAgentConfig: () =>
        ({ memoryEnabled: true, memoryEmbedding: embedding }) as DeepChatAgentConfig
    }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const markVectorStoreQuarantined = vi.fn()
    const createVectorStore = vi.fn(async () => {
      throw new MemoryVectorStorePostCommitError(new Error('final open failed'))
    })
    const manager = new VectorStoreManager({
      ctx,
      policy,
      repository: {} as MemoryEmbeddingRepositoryPort,
      vectorStoreFactory: {
        createVectorStore,
        resetVectorStore: async () => undefined,
        markVectorStoreQuarantined
      }
    })

    await expect(
      manager.withStoreLease('agent', embedding, 4, async () => undefined)
    ).rejects.toMatchObject({ reason: 'quarantined' })
    await expect(
      manager.withStoreLease('agent', embedding, 4, async () => undefined)
    ).rejects.toMatchObject({ reason: 'quarantined' })

    expect(createVectorStore).toHaveBeenCalledTimes(1)
    expect(markVectorStoreQuarantined).toHaveBeenCalledTimes(1)
    await manager.closeAllStores()
  })
})

describe('VectorStoreManager runtime fatal failures', () => {
  it('quarantines without closing a store whose native state may be invalid', async () => {
    const embedding = { providerId: 'p', modelId: 'm' }
    const policy = {
      resolveAgentConfig: () =>
        ({ memoryEnabled: true, memoryEmbedding: embedding }) as DeepChatAgentConfig
    }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const close = vi.fn(async () => undefined)
    const store = { ...createStore(), close }
    const markVectorStoreQuarantined = vi.fn()
    const manager = new VectorStoreManager({
      ctx,
      policy,
      repository: {} as MemoryEmbeddingRepositoryPort,
      vectorStoreFactory: {
        createVectorStore: async () => store,
        resetVectorStore: async () => undefined,
        markVectorStoreQuarantined
      }
    })

    await expect(
      manager.withStoreLease('agent', embedding, 4, async () => {
        throw new Error('INTERNAL Error: database has been invalidated')
      })
    ).rejects.toMatchObject({ reason: 'quarantined' })
    await expect(
      manager.withStoreLease('agent', embedding, 4, async () => undefined)
    ).rejects.toMatchObject({ reason: 'quarantined' })

    expect(markVectorStoreQuarantined).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
    await manager.closeAllStores()
    expect(close).not.toHaveBeenCalled()
  })

  it('settles and shuts down without awaiting a quarantined active lease', async () => {
    const embedding = { providerId: 'p', modelId: 'm' }
    const policy = {
      resolveAgentConfig: () =>
        ({ memoryEnabled: true, memoryEmbedding: embedding }) as DeepChatAgentConfig
    }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const close = vi.fn(async () => undefined)
    const store = { ...createStore(), close }
    const manager = new VectorStoreManager({
      ctx,
      policy,
      repository: {} as MemoryEmbeddingRepositoryPort,
      vectorStoreFactory: {
        createVectorStore: async () => store,
        resetVectorStore: async () => undefined,
        markVectorStoreQuarantined: () => undefined
      }
    })
    let markWedgedLeaseStarted!: () => void
    const wedgedLeaseStarted = new Promise<void>((resolve) => {
      markWedgedLeaseStarted = resolve
    })
    const neverSettles = new Promise<void>(() => undefined)
    const wedgedLease = manager
      .withStoreLease('agent', embedding, 4, async () => {
        markWedgedLeaseStarted()
        await neverSettles
      })
      .catch(() => undefined)
    void wedgedLease
    await wedgedLeaseStarted

    await expect(
      manager.withStoreLease('agent', embedding, 4, async () => {
        throw new Error('INTERNAL Error: concurrent fatal failure')
      })
    ).rejects.toMatchObject({ reason: 'quarantined' })

    await expect(manager.settleAgent('agent')).resolves.toBeUndefined()
    await expect(manager.closeAllStores()).resolves.toBeUndefined()
    expect(close).not.toHaveBeenCalled()
  })

  it('converts an in-progress reset to pending when lease drain discovers quarantine', async () => {
    const embedding = { providerId: 'p', modelId: 'm' }
    const policy = {
      resolveAgentConfig: () =>
        ({ memoryEnabled: true, memoryEmbedding: embedding }) as DeepChatAgentConfig
    }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const close = vi.fn(async () => undefined)
    const store = { ...createStore(), close }
    const resetVectorStore = vi.fn(async () => undefined)
    const markVectorStoreQuarantined = vi.fn()
    const manager = new VectorStoreManager({
      ctx,
      policy,
      repository: {} as MemoryEmbeddingRepositoryPort,
      vectorStoreFactory: {
        createVectorStore: async () => store,
        resetVectorStore,
        markVectorStoreQuarantined
      }
    })
    let markLeaseStarted!: () => void
    let releaseLease!: () => void
    const leaseStarted = new Promise<void>((resolve) => {
      markLeaseStarted = resolve
    })
    const leaseGate = new Promise<void>((resolve) => {
      releaseLease = resolve
    })
    const lease = manager.withStoreLease('agent', embedding, 4, async () => {
      markLeaseStarted()
      await leaseGate
      throw new Error('INTERNAL Error: fatal while reset drains')
    })
    await leaseStarted
    const reset = manager.resetAgentStore('agent')
    releaseLease()

    await expect(lease).rejects.toMatchObject({ reason: 'quarantined' })
    await expect(reset).resolves.toBe('pending-restart')
    expect(markVectorStoreQuarantined).toHaveBeenCalledTimes(2)
    expect(close).not.toHaveBeenCalled()
    expect(resetVectorStore).not.toHaveBeenCalled()
    await manager.closeAllStores()
  })
})
