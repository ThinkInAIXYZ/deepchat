import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryRuntimeContext } from '@/presenter/memoryPresenter/context'
import {
  VectorStoreOperationTimeoutError,
  VectorStoreQueryTimeoutError,
  type MemoryVectorMatch
} from '@/presenter/memoryPresenter/domain/types'
import { VectorStoreManager } from '@/presenter/memoryPresenter/infra/vectorStoreManager'
import {
  MemoryVectorStorePostCommitError,
  MemoryVectorStoreQuarantineRequiredError
} from '@/presenter/memoryPresenter/infra/vectorStoreErrors'
import {
  RECALL_VECTOR_QUERY_GRACE_MS,
  RECALL_VECTOR_QUERY_TIMEOUT_MS,
  VECTOR_STORE_OPERATION_TIMEOUT_MS
} from '@/presenter/memoryPresenter/runtimeConstants'
import type {
  IMemoryVectorStore,
  MemoryEmbeddingRepositoryPort
} from '@/presenter/memoryPresenter/ports'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import { createControlledPromise } from './serviceHarness'

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

function createQueryManager(store: IMemoryVectorStore) {
  const embedding = { providerId: 'p', modelId: 'm' }
  const config = {
    current: { memoryEnabled: true, memoryEmbedding: embedding } as DeepChatAgentConfig
  }
  const policy = { resolveAgentConfig: () => config.current }
  const ctx = new MemoryRuntimeContext({
    policy,
    providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
  })
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
  return { config, embedding, manager, markVectorStoreQuarantined }
}

async function flushPromiseContinuations(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('VectorStoreManager certificate generations', () => {
  it('distinguishes config identities containing separator characters', async () => {
    let config = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'provider:region', modelId: 'model' }
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
    const first = { providerId: 'provider:region', modelId: 'model' }
    const second = { providerId: 'provider', modelId: 'region:model' }

    expect(manager.noteEmbeddingConfig('agent', first)).toBe(false)
    config = { memoryEnabled: true, memoryEmbedding: second } as DeepChatAgentConfig
    expect(manager.noteEmbeddingConfig('agent', second)).toBe(true)

    await manager.closeAllStores()
  })

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

  it('does not let an identity-transition finally revive a fatally quarantined lease', async () => {
    const firstEmbedding = { providerId: 'p', modelId: 'm1' }
    const secondEmbedding = { providerId: 'p', modelId: 'm2' }
    const config = {
      current: {
        memoryEnabled: true,
        memoryEmbedding: firstEmbedding
      } as DeepChatAgentConfig
    }
    const policy = { resolveAgentConfig: () => config.current }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const close = vi.fn(async () => undefined)
    const markVectorStoreQuarantined = vi.fn()
    const manager = new VectorStoreManager({
      ctx,
      policy,
      repository: {} as MemoryEmbeddingRepositoryPort,
      vectorStoreFactory: {
        createVectorStore: async () => ({ ...createStore(), close }),
        resetVectorStore: async () => undefined,
        markVectorStoreQuarantined
      }
    })
    const release = createControlledPromise<void>()
    const started = createControlledPromise<void>()
    const lease = manager.withStoreLease('agent', firstEmbedding, 4, async () => {
      started.resolve(undefined)
      await release.promise
      throw new Error('INTERNAL Error: fatal while identity transition drains')
    })
    await started.promise

    config.current = {
      memoryEnabled: true,
      memoryEmbedding: secondEmbedding
    } as DeepChatAgentConfig
    manager.noteEmbeddingConfig('agent', secondEmbedding)
    release.resolve(undefined)

    await expect(lease).rejects.toMatchObject({ reason: 'quarantined' })
    await flushPromiseContinuations()
    expect(manager.getRecallHealth('agent')).toBe('quarantined')
    await expect(
      manager.withStoreLease('agent', secondEmbedding, 4, async () => undefined)
    ).rejects.toMatchObject({ reason: 'quarantined' })
    expect(markVectorStoreQuarantined).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
    await manager.closeAllStores()
  })
})

describe('VectorStoreManager query deadlines', () => {
  it('starts the recall deadline before a wedged store open', async () => {
    vi.useFakeTimers()
    const embedding = { providerId: 'p', modelId: 'm' }
    const policy = {
      resolveAgentConfig: () =>
        ({ memoryEnabled: true, memoryEmbedding: embedding }) as DeepChatAgentConfig
    }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const storeOpen = createControlledPromise<IMemoryVectorStore>()
    const markVectorStoreQuarantined = vi.fn()
    const manager = new VectorStoreManager({
      ctx,
      policy,
      repository: {} as MemoryEmbeddingRepositoryPort,
      vectorStoreFactory: {
        createVectorStore: () => storeOpen.promise,
        resetVectorStore: async () => undefined,
        markVectorStoreQuarantined
      }
    })

    const pending = manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS)
    await timedOut
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_GRACE_MS)

    expect(manager.isQuarantined('agent')).toBe(true)
    expect(markVectorStoreQuarantined).toHaveBeenCalledTimes(1)
    storeOpen.resolve(createStore())
    await flushPromiseContinuations()
    await manager.closeAllStores()
  })

  it('shuts down around a wedged store open without waiting or writing a marker', async () => {
    vi.useFakeTimers()
    const embedding = { providerId: 'p', modelId: 'm' }
    const policy = {
      resolveAgentConfig: () =>
        ({ memoryEnabled: true, memoryEmbedding: embedding }) as DeepChatAgentConfig
    }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const storeOpen = createControlledPromise<IMemoryVectorStore>()
    const markVectorStoreQuarantined = vi.fn()
    const manager = new VectorStoreManager({
      ctx,
      policy,
      repository: {} as MemoryEmbeddingRepositoryPort,
      vectorStoreFactory: {
        createVectorStore: () => storeOpen.promise,
        resetVectorStore: async () => undefined,
        markVectorStoreQuarantined
      }
    })

    const pending = manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    await expect(manager.closeAllStores()).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS)
    await timedOut

    expect(markVectorStoreQuarantined).not.toHaveBeenCalled()
    storeOpen.resolve(createStore())
  })

  it('bounds non-recall store operations with the maintenance deadline', async () => {
    vi.useFakeTimers()
    const nativeUpsert = createControlledPromise<void>()
    const store = { ...createStore(), upsert: vi.fn(() => nativeUpsert.promise) }
    const { embedding, manager, markVectorStoreQuarantined } = createQueryManager(store)

    const pending = manager.withStoreLease('agent', embedding, 4, async (opened) => {
      await opened.upsert([])
    })
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreOperationTimeoutError)
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(VECTOR_STORE_OPERATION_TIMEOUT_MS)
    await timedOut
    nativeUpsert.resolve(undefined)
    await flushPromiseContinuations()

    expect(manager.isQuarantined('agent')).toBe(false)
    expect(markVectorStoreQuarantined).not.toHaveBeenCalled()
    await manager.closeAllStores()
  })

  it('returns a typed soft timeout and resumes only after the native query settles', async () => {
    vi.useFakeTimers()
    const nativeQuery = createControlledPromise<MemoryVectorMatch[]>()
    const query = vi
      .fn<IMemoryVectorStore['query']>()
      .mockReturnValueOnce(nativeQuery.promise)
      .mockResolvedValue([])
    const store = { ...createStore(), query }
    const { embedding, manager, markVectorStoreQuarantined } = createQueryManager(store)

    const pending = manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS)
    await timedOut

    await expect(manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)).rejects.toMatchObject({
      reason: 'admission-closed'
    })
    expect(query).toHaveBeenCalledTimes(1)

    nativeQuery.resolve([])
    await flushPromiseContinuations()
    await expect(manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)).resolves.toEqual([])
    expect(query).toHaveBeenCalledTimes(2)
    expect(markVectorStoreQuarantined).not.toHaveBeenCalled()
    await manager.closeAllStores()
  })

  it('quarantines an unsettled query when the shared grace deadline expires', async () => {
    vi.useFakeTimers()
    const nativeQuery = createControlledPromise<MemoryVectorMatch[]>()
    const close = vi.fn(async () => undefined)
    const store = { ...createStore(), query: vi.fn(() => nativeQuery.promise), close }
    const { embedding, manager, markVectorStoreQuarantined } = createQueryManager(store)

    const pending = manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS)
    await timedOut
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_GRACE_MS)

    expect(manager.isQuarantined('agent')).toBe(true)
    expect(markVectorStoreQuarantined).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
    nativeQuery.resolve([])
    await flushPromiseContinuations()
    await expect(manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)).rejects.toMatchObject({
      reason: 'quarantined'
    })
    await manager.closeAllStores()
    expect(close).not.toHaveBeenCalled()
  })

  it('applies one deadline to a batch without issuing work after the wedged query', async () => {
    vi.useFakeTimers()
    const nativeQuery = createControlledPromise<MemoryVectorMatch[]>()
    const query = vi
      .fn<IMemoryVectorStore['query']>()
      .mockReturnValueOnce(nativeQuery.promise)
      .mockResolvedValue([])
    const { embedding, manager } = createQueryManager({ ...createStore(), query })

    const pending = manager.queryBatch(
      'agent',
      embedding,
      4,
      [
        [1, 2, 3, 4],
        [4, 3, 2, 1]
      ],
      4
    )
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS)

    await timedOut
    expect(query).toHaveBeenCalledTimes(1)
    nativeQuery.resolve([])
    await flushPromiseContinuations()
    expect(query).toHaveBeenCalledTimes(1)
    await manager.closeAllStores()
  })

  it('does not extend grace when a sibling query times out later', async () => {
    vi.useFakeTimers()
    const first = createControlledPromise<MemoryVectorMatch[]>()
    const second = createControlledPromise<MemoryVectorMatch[]>()
    const query = vi
      .fn<IMemoryVectorStore['query']>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { embedding, manager, markVectorStoreQuarantined } = createQueryManager({
      ...createStore(),
      query
    })

    const firstCall = manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)
    const firstTimeout = expect(firstCall).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(1_000)
    const secondCall = manager.query('agent', embedding, 4, [4, 3, 2, 1], 4)
    const secondTimeout = expect(secondCall).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS - 1_000)
    await firstTimeout
    await vi.advanceTimersByTimeAsync(1_000)
    await secondTimeout

    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_GRACE_MS - 1_000)
    expect(markVectorStoreQuarantined).toHaveBeenCalledTimes(1)
    expect(manager.isQuarantined('agent')).toBe(true)
    first.resolve([])
    second.resolve([])
    await manager.closeAllStores()
  })

  it('converges a changed identity after the timed-out query settles without quarantine', async () => {
    vi.useFakeTimers()
    const nativeQuery = createControlledPromise<MemoryVectorMatch[]>()
    const { config, embedding, manager, markVectorStoreQuarantined } = createQueryManager({
      ...createStore(),
      query: vi.fn(() => nativeQuery.promise)
    })

    const pending = manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS)
    await timedOut
    const nextEmbedding = { providerId: 'p', modelId: 'm2' }
    config.current = {
      memoryEnabled: true,
      memoryEmbedding: nextEmbedding
    } as DeepChatAgentConfig
    manager.noteEmbeddingConfig('agent', nextEmbedding)
    nativeQuery.resolve([])
    await flushPromiseContinuations()

    await expect(manager.query('agent', nextEmbedding, 4, [1, 2, 3, 4], 4)).resolves.toEqual([])
    expect(markVectorStoreQuarantined).not.toHaveBeenCalled()
    expect(manager.isQuarantined('agent')).toBe(false)
    await manager.closeAllStores()
  })

  it('quarantines a fatal native rejection observed during grace', async () => {
    vi.useFakeTimers()
    const nativeQuery = createControlledPromise<MemoryVectorMatch[]>()
    const close = vi.fn(async () => undefined)
    const { embedding, manager, markVectorStoreQuarantined } = createQueryManager({
      ...createStore(),
      query: vi.fn(() => nativeQuery.promise),
      close
    })

    const pending = manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS)
    await timedOut
    nativeQuery.reject(new Error('INTERNAL Error: database has been invalidated'))
    await flushPromiseContinuations()

    expect(manager.isQuarantined('agent')).toBe(true)
    expect(markVectorStoreQuarantined).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
    await manager.closeAllStores()
  })

  it('releases an existing drain waiter when grace quarantines a wedged query', async () => {
    vi.useFakeTimers()
    const nativeQuery = createControlledPromise<MemoryVectorMatch[]>()
    const close = vi.fn(async () => undefined)
    const { embedding, manager, markVectorStoreQuarantined } = createQueryManager({
      ...createStore(),
      query: vi.fn(() => nativeQuery.promise),
      close
    })

    const pending = manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    const reset = manager.resetAgentStore('agent')
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS)
    await timedOut
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_GRACE_MS)

    await expect(reset).resolves.toBe('pending-restart')
    expect(markVectorStoreQuarantined).toHaveBeenCalledTimes(2)
    expect(close).not.toHaveBeenCalled()
    await manager.closeAllStores()
  })

  it('lets a reset that owns admission complete after the slow query settles', async () => {
    vi.useFakeTimers()
    const nativeQuery = createControlledPromise<MemoryVectorMatch[]>()
    const close = vi.fn(async () => undefined)
    const { embedding, manager, markVectorStoreQuarantined } = createQueryManager({
      ...createStore(),
      query: vi.fn(() => nativeQuery.promise),
      close
    })

    const pending = manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    const reset = manager.resetAgentStore('agent')
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS)
    await timedOut
    nativeQuery.resolve([])
    await flushPromiseContinuations()

    await expect(reset).resolves.toBe('completed')
    await expect(manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)).resolves.toEqual([])
    expect(markVectorStoreQuarantined).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
    await manager.closeAllStores()
  })

  it('detaches a suspect query during shutdown without writing a marker', async () => {
    vi.useFakeTimers()
    const nativeQuery = createControlledPromise<MemoryVectorMatch[]>()
    const close = vi.fn(async () => undefined)
    const { embedding, manager, markVectorStoreQuarantined } = createQueryManager({
      ...createStore(),
      query: vi.fn(() => nativeQuery.promise),
      close
    })

    const pending = manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS)
    await timedOut

    await expect(manager.closeAllStores()).resolves.toBeUndefined()
    expect(markVectorStoreQuarantined).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('does not resurrect state or quarantine when a query deadline fires after shutdown', async () => {
    vi.useFakeTimers()
    const nativeQuery = createControlledPromise<MemoryVectorMatch[]>()
    const close = vi.fn(async () => undefined)
    const { embedding, manager, markVectorStoreQuarantined } = createQueryManager({
      ...createStore(),
      query: vi.fn(() => nativeQuery.promise),
      close
    })

    const pending = manager.query('agent', embedding, 4, [1, 2, 3, 4], 4)
    const timedOut = expect(pending).rejects.toBeInstanceOf(VectorStoreQueryTimeoutError)
    await flushPromiseContinuations()
    const shutdown = manager.closeAllStores()
    await flushPromiseContinuations()
    await vi.advanceTimersByTimeAsync(RECALL_VECTOR_QUERY_TIMEOUT_MS)

    await timedOut
    await expect(shutdown).resolves.toBeUndefined()
    expect(markVectorStoreQuarantined).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})
