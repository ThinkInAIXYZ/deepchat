import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryPresenter as BaseMemoryPresenter } from '@/presenter/memoryPresenter'
import type { VectorReadyCertificate } from '@/presenter/memoryPresenter/infra/vectorStoreManager'
import type { IMemoryVectorStore } from '@/presenter/memoryPresenter/types'
import {
  EMBEDDING_WARM_FAILURE_COOLDOWN_MS,
  VECTOR_STORE_IDLE_TTL_MS,
  VECTOR_STORE_SOFT_CAP
} from '@/presenter/memoryPresenter/runtimeConstants'
import { enabledConfig, FakeRepository, FakeVectorStore, textToVector } from './fakes/memoryFakes'

class MemoryPresenter extends BaseMemoryPresenter {
  constructor(deps: ConstructorParameters<typeof BaseMemoryPresenter>[0]) {
    super({ executeWithRateLimit: vi.fn(async () => undefined), ...deps })
  }
}

interface EmbeddingScaleTestSeams {
  embedding: {
    warmEmbeddingConnection(
      agentId: string,
      embedding: { providerId: string; modelId: string }
    ): void
    getMutableRuntimeStateForTests(): {
      embeddingWarmups: Map<string, Promise<void>>
      embeddingWarmSuccesses: Set<string>
      embeddingWarmFailureUntil: Map<string, number>
    }
  }
  vectorStore: {
    noteEmbeddingConfig(
      agentId: string,
      embedding: { providerId: string; modelId: string } | null
    ): void
    withStoreLease<T>(
      agentId: string,
      embedding: { providerId: string; modelId: string },
      dimensions: number,
      task: (store: IMemoryVectorStore, generation: number) => Promise<T>
    ): Promise<T>
    markReady(
      agentId: string,
      embedding: { providerId: string; modelId: string },
      dimensions: number
    ): void
    runResourceConvergenceForTests(now?: number): Promise<void>
    getResourceStatsForTests(): { openStores: number }
    getMutableRuntimeStateForTests(): {
      vectorStores: Map<string, Promise<IMemoryVectorStore>>
      vectorStoreReady: Map<string, VectorReadyCertificate>
    }
  }
}

function internals(presenter: MemoryPresenter): EmbeddingScaleTestSeams {
  return presenter as unknown as EmbeddingScaleTestSeams
}

function makeScalePresenter(options: {
  repository?: FakeRepository
  getEmbeddings?: (providerId: string, modelId: string, texts: string[]) => Promise<number[][]>
  createVectorStore?: (
    agentId: string,
    embedding: { providerId: string; modelId: string },
    dimensions: number
  ) => Promise<IMemoryVectorStore>
}) {
  const repository = options.repository ?? new FakeRepository()
  const store = new FakeVectorStore()
  const presenter = new MemoryPresenter({
    repository,
    resolveAgentConfig: () => enabledConfig,
    getEmbeddings:
      options.getEmbeddings ??
      (async (_providerId, _modelId, texts) => texts.map((text) => textToVector(text))),
    createVectorStore: options.createVectorStore ?? (async () => store),
    resetVectorStore: async () => undefined
  })
  return { presenter, repository, store }
}

async function settleWarmup(presenter: MemoryPresenter): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      internals(presenter).embedding.getMutableRuntimeStateForTests().embeddingWarmups.size === 0
    ) {
      return
    }
    await Promise.resolve()
  }
  throw new Error('embedding warmup did not settle')
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('embedding persistence scale contract', () => {
  it('materializes once and persists a valid batch with one ready update', async () => {
    const { presenter, repository, store } = makeScalePresenter({})
    for (const id of ['m1', 'm2']) {
      repository.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: `memory ${id}`,
        status: 'pending_embedding'
      })
    }
    const listByIds = vi.spyOn(repository, 'listByIds')
    const markReady = vi.spyOn(repository, 'markPendingEmbeddingsReady')
    const markError = vi.spyOn(repository, 'markPendingEmbeddingsError')
    const upsert = vi.spyOn(store, 'upsert')

    await presenter.processPendingEmbeddings('a')

    expect(listByIds).toHaveBeenCalledTimes(1)
    expect(listByIds).toHaveBeenCalledWith('a', ['m1', 'm2'])
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toHaveLength(2)
    expect(markReady).toHaveBeenCalledTimes(1)
    expect(markReady.mock.calls[0][1]).toHaveLength(2)
    expect(markError).not.toHaveBeenCalled()
    await presenter.dispose()
  })

  it('drains a 101-row backlog in fixed 50-row chunks without another trigger', async () => {
    const repository = new FakeRepository()
    for (let index = 0; index < 101; index += 1) {
      repository.insert({
        id: `m-${String(index).padStart(3, '0')}`,
        agentId: 'a',
        kind: 'semantic',
        content: `memory ${index}`,
        status: 'pending_embedding'
      })
    }
    const getEmbeddings = vi.fn(async (_providerId: string, _modelId: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const { presenter } = makeScalePresenter({ repository, getEmbeddings })

    await presenter.processPendingEmbeddings('a', 500)

    expect(getEmbeddings.mock.calls.map((call) => call[2].length)).toEqual([50, 50, 1])
    expect(repository.listPendingEmbedding(200, 'a')).toEqual([])
    expect(repository.listEmbeddingStatusIds('a', ['embedded'], 200).length).toBe(101)
    await presenter.dispose()
  })

  it('continues draining a concurrently edited row at its new revision', async () => {
    const repository = new FakeRepository()
    repository.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'original memory',
      status: 'pending_embedding'
    })
    const store = new FakeVectorStore()
    const upsert = vi.spyOn(store, 'upsert').mockImplementation(async (records) => {
      for (const record of records) store.vectors.set(record.memoryId, record.embedding)
      repository.updateDecisionContentIfRevision({
        agentId: 'a',
        id: 'm1',
        expectedRevision: 1,
        content: 'edited memory',
        provenanceKey: null,
        at: 1
      })
    })
    const { presenter } = makeScalePresenter({
      repository,
      createVectorStore: async () => store
    })

    await presenter.processPendingEmbeddings('a')

    expect(upsert).toHaveBeenCalledTimes(2)
    expect(store.vectors.has('m1')).toBe(true)
    expect(repository.getById('m1')).toMatchObject({
      content: 'edited memory',
      status: 'embedded',
      decision_revision: 2,
      embedding_id: 'm1'
    })
    await presenter.dispose()
  })

  it('does no persistence work when the provider fails the whole batch', async () => {
    const repository = new FakeRepository()
    repository.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'retryable memory',
      status: 'pending_embedding'
    })
    const { presenter } = makeScalePresenter({
      repository,
      getEmbeddings: async () => {
        throw new Error('provider unavailable')
      }
    })
    const listByIds = vi.spyOn(repository, 'listByIds')
    const markReady = vi.spyOn(repository, 'markPendingEmbeddingsReady')
    const markError = vi.spyOn(repository, 'markPendingEmbeddingsError')

    await presenter.processPendingEmbeddings('a')

    expect(listByIds).not.toHaveBeenCalled()
    expect(markReady).not.toHaveBeenCalled()
    expect(markError).not.toHaveBeenCalled()
    expect(repository.getById('m1')?.status).toBe('pending_embedding')
    await presenter.dispose()
  })

  it('marks a malformed-only batch in one update without opening a vector store', async () => {
    const repository = new FakeRepository()
    repository.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'malformed vector memory',
      status: 'pending_embedding'
    })
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const { presenter } = makeScalePresenter({
      repository,
      getEmbeddings: async () => [[Number.NaN, 2]],
      createVectorStore
    })
    const markError = vi.spyOn(repository, 'markPendingEmbeddingsError')

    await presenter.processPendingEmbeddings('a')

    expect(createVectorStore).not.toHaveBeenCalled()
    expect(markError).toHaveBeenCalledTimes(1)
    expect(markError.mock.calls[0][1]).toEqual([{ id: 'm1', expectedRevision: 1 }])
    expect(repository.getById('m1')?.status).toBe('error')
    await presenter.dispose()
  })

  it('shares one dirty drain promise and batches malformed vector failures', async () => {
    const repository = new FakeRepository()
    for (const id of ['valid', 'invalid']) {
      repository.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: id,
        status: 'pending_embedding'
      })
    }
    let release!: () => void
    let resolveStarted!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const getEmbeddings = vi.fn(
      async () =>
        new Promise<number[][]>((resolve) => {
          release = () =>
            resolve([
              [1, 2],
              [Number.NaN, 2]
            ])
          resolveStarted()
        })
    )
    const { presenter, store } = makeScalePresenter({ repository, getEmbeddings })
    const markReady = vi.spyOn(repository, 'markPendingEmbeddingsReady')
    const markError = vi.spyOn(repository, 'markPendingEmbeddingsError')
    const upsert = vi.spyOn(store, 'upsert')

    const first = presenter.processPendingEmbeddings('a')
    await providerStarted
    const second = presenter.processPendingEmbeddings('a')
    expect(second).toBe(first)
    release()
    await Promise.all([first, second])

    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(markReady).toHaveBeenCalledTimes(1)
    expect(markReady.mock.calls[0][1].map((update) => update.id)).toEqual(['valid'])
    expect(markError).toHaveBeenCalledTimes(1)
    expect(markError.mock.calls[0][1]).toEqual([{ id: 'invalid', expectedRevision: 1 }])
    await presenter.dispose()
  })
})

describe('embedding warm and vector resource bounds', () => {
  it('drains the old identity before admitting a lease for changed embedding config', async () => {
    let config = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'old-provider', modelId: 'old-model' }
    }
    const stores: FakeVectorStore[] = []
    const presenter = new MemoryPresenter({
      repository: new FakeRepository(),
      resolveAgentConfig: () => config,
      getEmbeddings: async () => [],
      createVectorStore: async () => {
        const store = new FakeVectorStore()
        stores.push(store)
        return store
      },
      resetVectorStore: async () => undefined
    })
    const vectorStore = internals(presenter).vectorStore
    let releaseOldLease!: () => void
    let resolveOldLeaseStarted!: () => void
    const oldLeaseStarted = new Promise<void>((resolve) => {
      resolveOldLeaseStarted = resolve
    })
    const oldEmbedding = { providerId: 'old-provider', modelId: 'old-model' }
    const oldLease = vectorStore.withStoreLease('a', oldEmbedding, 4, async () => {
      resolveOldLeaseStarted()
      await new Promise<void>((resolve) => {
        releaseOldLease = resolve
      })
    })
    await oldLeaseStarted
    vectorStore.markReady('a', oldEmbedding, 4)
    expect(vectorStore.getMutableRuntimeStateForTests().vectorStoreReady.has('a')).toBe(true)

    const nextEmbedding = { providerId: 'next-provider', modelId: 'next-model' }
    config = { memoryEnabled: true, memoryEmbedding: nextEmbedding }
    vectorStore.noteEmbeddingConfig('a', nextEmbedding)
    expect(vectorStore.getMutableRuntimeStateForTests().vectorStoreReady.has('a')).toBe(false)

    let nextLeaseStarted = false
    const nextLease = vectorStore.withStoreLease('a', nextEmbedding, 4, async () => {
      nextLeaseStarted = true
    })
    await Promise.resolve()
    expect(nextLeaseStarted).toBe(false)
    expect(stores[0].closeCount).toBe(0)

    releaseOldLease()
    await Promise.all([oldLease, nextLease])
    expect(stores[0].closeCount).toBe(1)
    expect(stores).toHaveLength(2)
    expect(nextLeaseStarted).toBe(true)
    await presenter.dispose()
  })

  it('caches provider/model warm success and cools down failures for five minutes', async () => {
    vi.useFakeTimers()
    const getEmbeddings = vi
      .fn<(providerId: string, modelId: string, texts: string[]) => Promise<number[][]>>()
      .mockRejectedValueOnce(new Error('warm failed'))
      .mockResolvedValue([[1, 2, 3, 4]])
    const { presenter } = makeScalePresenter({ getEmbeddings })
    const embedding = { providerId: 'p', modelId: 'm' }

    internals(presenter).embedding.warmEmbeddingConnection('agent-a', embedding)
    await settleWarmup(presenter)
    expect(getEmbeddings).toHaveBeenCalledTimes(1)

    internals(presenter).embedding.warmEmbeddingConnection('agent-b', embedding)
    await Promise.resolve()
    expect(getEmbeddings).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(EMBEDDING_WARM_FAILURE_COOLDOWN_MS)
    internals(presenter).embedding.warmEmbeddingConnection('agent-b', embedding)
    await settleWarmup(presenter)
    expect(getEmbeddings).toHaveBeenCalledTimes(2)

    internals(presenter).embedding.warmEmbeddingConnection('agent-a', embedding)
    await Promise.resolve()
    expect(getEmbeddings).toHaveBeenCalledTimes(2)
    await presenter.dispose()
  })

  it('evicts the least recently used store while retaining its ready certificate', async () => {
    vi.useFakeTimers()
    const repository = new FakeRepository()
    const stores = new Map<string, FakeVectorStore[]>()
    const { presenter } = makeScalePresenter({
      repository,
      createVectorStore: async (agentId) => {
        const store = new FakeVectorStore()
        const versions = stores.get(agentId) ?? []
        versions.push(store)
        stores.set(agentId, versions)
        return store
      }
    })
    const vectorStore = internals(presenter).vectorStore
    const baseTime = 1_000_000

    for (let index = 0; index <= VECTOR_STORE_SOFT_CAP; index += 1) {
      vi.setSystemTime(baseTime + index)
      const agentId = `agent-${index}`
      repository.insert({
        id: `memory-${index}`,
        agentId,
        kind: 'semantic',
        content: `memory ${index}`,
        status: 'pending_embedding'
      })
      await presenter.processPendingEmbeddings(agentId)
    }
    const runtime = vectorStore.getMutableRuntimeStateForTests()
    const certificate = runtime.vectorStoreReady.get('agent-0')

    await vectorStore.runResourceConvergenceForTests(baseTime + VECTOR_STORE_SOFT_CAP)

    expect(vectorStore.getResourceStatsForTests().openStores).toBe(VECTOR_STORE_SOFT_CAP)
    expect(runtime.vectorStores.has('agent-0')).toBe(false)
    expect(runtime.vectorStoreReady.get('agent-0')).toEqual(certificate)
    expect(stores.get('agent-0')?.[0].closeCount).toBe(1)

    vi.setSystemTime(baseTime + VECTOR_STORE_SOFT_CAP + 1)
    await presenter.recall('agent-0', 'memory 0')
    expect(stores.get('agent-0')).toHaveLength(2)
    expect(runtime.vectorStoreReady.get('agent-0')).toEqual(certificate)
    await presenter.dispose()
  })

  it('closes an idle store at the TTL without invalidating readiness', async () => {
    vi.useFakeTimers()
    const repository = new FakeRepository()
    const { presenter, store } = makeScalePresenter({ repository })
    vi.setSystemTime(1_000_000)
    repository.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'idle memory',
      status: 'pending_embedding'
    })
    await presenter.processPendingEmbeddings('a')
    const vectorStore = internals(presenter).vectorStore
    const runtime = vectorStore.getMutableRuntimeStateForTests()
    const certificate = runtime.vectorStoreReady.get('a')

    await vectorStore.runResourceConvergenceForTests(1_000_000 + VECTOR_STORE_IDLE_TTL_MS)

    expect(vectorStore.getResourceStatsForTests().openStores).toBe(0)
    expect(store.closeCount).toBe(1)
    expect(runtime.vectorStoreReady.get('a')).toEqual(certificate)
    await presenter.dispose()
  })

  it('skips an active lease and evicts the next idle store when over capacity', async () => {
    vi.useFakeTimers()
    const repository = new FakeRepository()
    const stores = new Map<string, FakeVectorStore>()
    let blockOldestQuery = false
    let releaseOldestQuery!: () => void
    let resolveQueryStarted!: () => void
    const queryStarted = new Promise<void>((resolve) => {
      resolveQueryStarted = resolve
    })
    const { presenter } = makeScalePresenter({
      repository,
      createVectorStore: async (agentId) => {
        const store = new FakeVectorStore()
        if (agentId === 'agent-0') {
          vi.spyOn(store, 'query').mockImplementation(async (embedding, options) => {
            if (!blockOldestQuery) {
              return FakeVectorStore.prototype.query.call(store, embedding, options)
            }
            resolveQueryStarted()
            return new Promise((resolve) => {
              releaseOldestQuery = () => resolve([])
            })
          })
        }
        stores.set(agentId, store)
        return store
      }
    })
    const vectorStore = internals(presenter).vectorStore
    const baseTime = 2_000_000

    for (let index = 0; index <= VECTOR_STORE_SOFT_CAP; index += 1) {
      vi.setSystemTime(baseTime + index)
      const agentId = `agent-${index}`
      repository.insert({
        id: `memory-${index}`,
        agentId,
        kind: 'semantic',
        content: `memory ${index}`,
        status: 'pending_embedding'
      })
      await presenter.processPendingEmbeddings(agentId)
    }

    vi.setSystemTime(baseTime)
    blockOldestQuery = true
    const recall = presenter.recall('agent-0', 'memory 0')
    await queryStarted

    await vectorStore.runResourceConvergenceForTests(baseTime + VECTOR_STORE_SOFT_CAP)

    const runtime = vectorStore.getMutableRuntimeStateForTests()
    expect(vectorStore.getResourceStatsForTests().openStores).toBe(VECTOR_STORE_SOFT_CAP)
    expect(runtime.vectorStores.has('agent-0')).toBe(true)
    expect(runtime.vectorStores.has('agent-1')).toBe(false)
    expect(stores.get('agent-0')?.closeCount).toBe(0)
    expect(stores.get('agent-1')?.closeCount).toBe(1)

    releaseOldestQuery()
    await recall
    await presenter.dispose()
  })
})
