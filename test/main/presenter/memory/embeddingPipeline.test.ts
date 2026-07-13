import { describe, expect, it, vi } from 'vitest'

import { ERROR_RETRY_COOLDOWN_MS } from '@/presenter/memoryPresenter/runtimeConstants'
import { type IMemoryVectorStore } from '@/presenter/memoryPresenter/types'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import {
  FakeVectorStore,
  createFakeRepository,
  enabledConfig,
  makePresenter,
  textToVector
} from '../fakes/memoryFakes'

import {
  MemoryPresenter,
  embeddingDimensions,
  flushMicrotasks,
  memoryRuntimeForTests,
  waitForMemoryCondition
} from './serviceTestSupport'

describe('MemoryPresenter.processPendingEmbeddings (batch + fairness)', () => {
  it('embeds all pending rows in one getEmbeddings call and one upsert', async () => {
    const { presenter, repo, store, getEmbeddings } = makePresenter(enabledConfig)
    const contents = ['redis one', 'vue two', '简洁 three']
    for (const content of contents) {
      repo.insert({
        id: `m-${content}`,
        agentId: 'deepchat',
        kind: 'semantic',
        content,
        status: 'pending_embedding'
      })
    }
    const upsertSpy = vi.spyOn(store, 'upsert')

    await presenter.processPendingEmbeddings('deepchat')

    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(getEmbeddings.mock.calls[0][2]).toHaveLength(contents.length)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    expect(upsertSpy.mock.calls[0][0]).toHaveLength(contents.length)
    for (const content of contents) {
      expect(repo.getById(`m-${content}`)?.status).toBe('embedded')
    }
  })

  it('embeds only the queried agent rows so a backlog cannot starve another agent', async () => {
    const { presenter, repo, getEmbeddings } = makePresenter(enabledConfig)
    for (let i = 0; i < 100; i += 1) {
      repo.insert({
        id: `a-${i}`,
        agentId: 'agent-a',
        kind: 'semantic',
        content: `a${i} redis`,
        status: 'pending_embedding'
      })
    }
    repo.insert({
      id: 'b-1',
      agentId: 'agent-b',
      kind: 'semantic',
      content: 'b redis',
      status: 'pending_embedding'
    })

    await presenter.processPendingEmbeddings('agent-b')

    expect(repo.getById('b-1')?.status).toBe('embedded')
    expect(repo.getById('a-0')?.status).toBe('pending_embedding')
    expect(getEmbeddings.mock.calls[0][2]).toEqual(['b redis'])
  })

  it('serializes same-agent drains so concurrent triggers embed each row once', async () => {
    const { presenter, repo, getEmbeddings } = makePresenter(enabledConfig)
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis',
      status: 'pending_embedding'
    })
    repo.insert({
      id: 'm2',
      agentId: 'a',
      kind: 'semantic',
      content: 'vue',
      status: 'pending_embedding'
    })

    // Two background triggers fire for the same agent before the first drain settles.
    await Promise.all([
      presenter.processPendingEmbeddings('a'),
      presenter.processPendingEmbeddings('a')
    ])

    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(repo.getById('m1')?.status).toBe('embedded')
    expect(repo.getById('m2')?.status).toBe('embedded')
  })

  it('does not revive a forgotten memory while embeddings are in flight', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    let releaseEmbedding: (() => void) | null = null
    let resolveStarted: (() => void) | null = null
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const getEmbeddings = vi.fn(
      async (_p: string, _m: string, texts: string[]) =>
        new Promise<number[][]>((resolve) => {
          releaseEmbedding = () => resolve(texts.map((text) => textToVector(text)))
          resolveStarted?.()
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      generateText: vi.fn(async () => ''),
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis in flight',
      status: 'pending_embedding'
    })

    const drain = presenter.processPendingEmbeddings('a')
    await started
    expect(await presenter.forgetMemory('a', 'm1')).toBe(true)
    releaseEmbedding?.()
    await drain

    expect(repo.getById('m1')?.status).toBe('archived')
    expect(store.vectors.has('m1')).toBe(false)
  })

  it('does not mark a forgotten memory pending again after an embedding service failure', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    let rejectEmbedding: ((error: Error) => void) | null = null
    let resolveStarted: (() => void) | null = null
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const getEmbeddings = vi.fn(
      async () =>
        new Promise<number[][]>((_resolve, reject) => {
          rejectEmbedding = reject
          resolveStarted?.()
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      generateText: vi.fn(async () => ''),
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis retry',
      status: 'pending_embedding'
    })

    const drain = presenter.processPendingEmbeddings('a')
    await started
    expect(await presenter.forgetMemory('a', 'm1')).toBe(true)
    rejectEmbedding?.(new Error('ECONNRESET'))
    await drain

    expect(repo.getById('m1')?.status).toBe('archived')
  })

  it('does not mark a forgotten memory error after a vector write failure', async () => {
    const repo = createFakeRepository()
    let rejectUpsert: ((error: Error) => void) | null = null
    let resolveUpsertStarted: (() => void) | null = null
    const upsertStarted = new Promise<void>((resolve) => {
      resolveUpsertStarted = resolve
    })
    const failingStore: IMemoryVectorStore = {
      upsert: vi.fn(
        async () =>
          new Promise<void>((_resolve, reject) => {
            rejectUpsert = reject
            resolveUpsertStarted?.()
          })
      ),
      query: async () => [],
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => [],
      close: async () => {},
      isUsable: () => true
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => failingStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis write',
      status: 'pending_embedding'
    })

    const drain = presenter.processPendingEmbeddings('a')
    await upsertStarted
    expect(await presenter.forgetMemory('a', 'm1')).toBe(true)
    rejectUpsert?.(new Error('INSERT failed'))
    await drain

    expect(repo.getById('m1')?.status).toBe('archived')
  })

  it('marks the batch error (never embedded) when the vector store upsert fails', async () => {
    const repo = createFakeRepository()
    const failingStore: IMemoryVectorStore = {
      upsert: vi.fn(async () => {
        throw new Error('INSERT failed')
      }),
      query: async () => [],
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => [],
      close: async () => {},
      isUsable: () => true
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => failingStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis',
      status: 'pending_embedding'
    })
    repo.insert({
      id: 'm2',
      agentId: 'a',
      kind: 'semantic',
      content: 'vue',
      status: 'pending_embedding'
    })

    await presenter.processPendingEmbeddings('a')

    expect(repo.getById('m1')?.status).toBe('error')
    expect(repo.getById('m2')?.status).toBe('error')
  })

  it('marks only rows still live at vector-write time when the store is unusable', async () => {
    const repo = createFakeRepository()
    let resolveStarted: (() => void) | null = null
    let releaseEmbedding: (() => void) | null = null
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const unusableStore: IMemoryVectorStore = {
      upsert: async () => {},
      query: async () => [],
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => [],
      close: async () => {},
      isUsable: () => false
    }
    const getEmbeddings = vi.fn(
      async (_p: string, _m: string, texts: string[]) =>
        new Promise<number[][]>((resolve) => {
          releaseEmbedding = () => resolve(texts.map((text) => textToVector(text)))
          resolveStarted?.()
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      createVectorStore: async () => unusableStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'stale',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis stale',
      status: 'pending_embedding'
    })
    repo.insert({
      id: 'live',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis live',
      status: 'pending_embedding'
    })
    const drain = presenter.processPendingEmbeddings('a')
    await started
    repo.updateStatus('stale', 'fts_only')
    releaseEmbedding?.()
    await drain

    expect(repo.getById('stale')?.status).toBe('fts_only')
    expect(repo.getById('live')?.status).toBe('error')
  })

  it('forced reindex waits for an active drain before requeueing', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const resolvers: Array<() => void> = []
    const getEmbeddings = vi.fn(
      async (_p: string, _m: string, texts: string[]) =>
        new Promise<number[][]>((resolve) => {
          resolvers.push(() => resolve(texts.map((text) => textToVector(text))))
        })
    )
    const resetVectorStore = vi.fn(async () => {
      store.vectors.clear()
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      createVectorStore: async () => store,
      resetVectorStore
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis reindex',
      status: 'pending_embedding'
    })

    const drain = presenter.processPendingEmbeddings('a')
    await waitForMemoryCondition(() => resolvers.length === 1)
    const reindex = presenter.reindexEmbeddings('a', true)
    await flushMicrotasks()
    resolvers.shift()?.()
    await waitForMemoryCondition(() => resolvers.length === 1)
    resolvers.shift()?.()
    await Promise.all([drain, reindex])

    expect(resetVectorStore).toHaveBeenCalledWith('a')
    expect(repo.getById('m1')?.status).toBe('embedded')
    expect(store.vectors.has('m1')).toBe(true)
    expect(getEmbeddings).toHaveBeenCalledTimes(2)
  })

  it('keeps the batch pending (retryable) when the embedding service throws, then heals', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    let attempt = 0
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) => {
      attempt += 1
      if (attempt === 1) throw new Error('ECONNRESET')
      return texts.map((text) => textToVector(text))
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis',
      status: 'pending_embedding'
    })
    repo.insert({
      id: 'm2',
      agentId: 'a',
      kind: 'semantic',
      content: 'vue',
      status: 'pending_embedding'
    })

    await presenter.processPendingEmbeddings('a')
    // A transient service failure must not terminally strand the rows; they stay queued.
    expect(repo.getById('m1')?.status).toBe('pending_embedding')
    expect(repo.getById('m2')?.status).toBe('pending_embedding')

    await presenter.processPendingEmbeddings('a')
    expect(repo.getById('m1')?.status).toBe('embedded')
    expect(repo.getById('m2')?.status).toBe('embedded')
  })

  it('does not issue an empty error requeue when there are no error rows', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const requeueSpy = vi.spyOn(repo, 'requeueForEmbedding')

    await presenter.processPendingEmbeddings('a')

    expect(requeueSpy).not.toHaveBeenCalled()
  })

  it('cools down error retry even when a bounded requeue races to zero changes', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'err-01',
      agentId: 'a',
      kind: 'semantic',
      content: 'retry race',
      status: 'error'
    })
    const requeueSpy = vi.spyOn(repo, 'requeueForEmbedding')
    requeueSpy.mockReturnValueOnce(0)
    await presenter.processPendingEmbeddings('a')

    expect(requeueSpy).toHaveBeenCalledTimes(1)

    await presenter.processPendingEmbeddings('a')

    expect(requeueSpy).toHaveBeenCalledTimes(1)
  })

  it('advances error retry fairly instead of starving rows after the first batch', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    for (let index = 0; index < 51; index += 1) {
      repo.insert({
        id: `err-${String(index).padStart(2, '0')}`,
        agentId: 'a',
        kind: 'semantic',
        content: `retry ${index}`,
        status: 'error'
      })
    }
    await presenter.processPendingEmbeddings('a')
    expect(repo.getById('err-49')?.status).toBe('embedded')
    expect(repo.getById('err-50')?.status).toBe('error')

    const retryAt = Date.now() + ERROR_RETRY_COOLDOWN_MS + 1
    vi.spyOn(Date, 'now').mockReturnValue(retryAt)
    await presenter.processPendingEmbeddings('a')

    expect(repo.getById('err-50')?.status).toBe('embedded')
  })

  it('sets an error retry cooldown when embedding vectors have mismatched dimensions', async () => {
    const repo = createFakeRepository()
    const requeueSpy = vi.spyOn(repo, 'requeueForEmbedding')
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async () => [
        [1, 2, 3, 4],
        [1, 2]
      ],
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'ok',
      agentId: 'a',
      kind: 'semantic',
      content: 'ok',
      status: 'pending_embedding'
    })
    repo.insert({
      id: 'bad',
      agentId: 'a',
      kind: 'semantic',
      content: 'bad',
      status: 'pending_embedding'
    })
    await presenter.processPendingEmbeddings('a')

    expect(repo.getById('ok')?.status).toBe('embedded')
    expect(repo.getById('bad')?.status).toBe('error')
    requeueSpy.mockClear()

    await presenter.processPendingEmbeddings('a')

    expect(requeueSpy).not.toHaveBeenCalled()
    expect(repo.getById('bad')?.status).toBe('error')
  })
})

describe('MemoryPresenter embedding reindex (T5, AC-3.x)', () => {
  it('serializes coverage verification with embedding persistence for the same agent', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    repo.insert({
      id: 'embedded',
      agentId: 'a',
      kind: 'semantic',
      content: 'existing redis memory',
      status: 'pending_embedding'
    })
    repo.updateStatus('embedded', 'embedded', {
      embeddingId: 'embedded',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    store.vectors.set('embedded', textToVector('existing redis memory'))
    repo.insert({
      id: 'pending',
      agentId: 'a',
      kind: 'semantic',
      content: 'new redis memory',
      status: 'pending_embedding'
    })

    let releaseList!: () => void
    let listStarted!: () => void
    const started = new Promise<void>((resolve) => {
      listStarted = resolve
    })
    vi.spyOn(store, 'listMemoryIds').mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          listStarted()
          releaseList = () => resolve([...store.vectors.keys()].sort())
        })
    )
    const upsert = vi.spyOn(store, 'upsert')

    await presenter.recall('a', 'redis')
    await started
    const drain = presenter.processPendingEmbeddings('a')
    await flushMicrotasks()

    expect(upsert).not.toHaveBeenCalled()
    expect(repo.getById('pending')?.status).toBe('pending_embedding')

    releaseList()
    await drain

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(store.vectors.has('pending')).toBe(true)
    expect(repo.getById('pending')).toMatchObject({
      status: 'embedded',
      embedding_id: 'pending'
    })
  })

  it('deletes orphan vectors in bounded batches during warm reconcile', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    for (let index = 0; index < 601; index += 1) {
      store.vectors.set(`orphan-${String(index).padStart(4, '0')}`, textToVector('orphan redis'))
    }
    const deleteSpy = vi.spyOn(store, 'deleteByMemoryIds')

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => store.vectors.size === 0, 'orphan vectors were not deleted')

    expect(deleteSpy).toHaveBeenCalledTimes(2)
    expect(deleteSpy.mock.calls.map(([ids]) => ids.length)).toEqual([512, 89])
    expect(deleteSpy.mock.calls.every(([ids]) => ids.length <= 512)).toBe(true)
  })

  it('withholds readiness when coverage cleanup fails and retries on the next warm', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    store.vectors.set('orphan-0001', textToVector('orphan redis'))
    const deleteSpy = vi.spyOn(store, 'deleteByMemoryIds')
    deleteSpy.mockRejectedValueOnce(new Error('delete failed'))
    const internals = memoryRuntimeForTests(presenter)
    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => deleteSpy.mock.calls.length === 1)
    expect(store.vectors.has('orphan-0001')).toBe(true)
    expect(internals.isVectorReady('a')).toBe(false)

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(
      () => deleteSpy.mock.calls.length >= 2 && !store.vectors.has('orphan-0001'),
      'coverage verification did not retry after failure'
    )
    await waitForMemoryCondition(() => internals.isVectorReady('a'))
  })

  it('cleanupDeletedAgentResources waits for in-flight coverage verification', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    let releaseList!: () => void
    vi.spyOn(store, 'listMemoryIds').mockImplementationOnce(
      async () =>
        new Promise<string[]>((resolve) => {
          releaseList = () => resolve([])
        })
    )
    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(
      () => typeof releaseList === 'function',
      'coverage verification did not enter in-flight tracking'
    )

    let cleanupDone = false
    const cleanup = presenter.cleanupDeletedAgentResources('a').then(() => {
      cleanupDone = true
    })
    await flushMicrotasks()
    expect(cleanupDone).toBe(false)

    releaseList()
    await cleanup

    expect(cleanupDone).toBe(true)
  })

  it('reindexEmbeddings re-queues, rebuilds the store, and re-embeds with the new fingerprint', async () => {
    const repo = createFakeRepository()
    let config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm1' }
    }
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const resetVectorStore = vi.fn(async () => undefined)
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [0.1, 0.2]),
      createVectorStore,
      resetVectorStore
    })

    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    expect(repo.getById(id!)?.embedding_model).toBe('p:m1')
    expect(createVectorStore).toHaveBeenCalledTimes(1)

    // Same dimension, different model: the per-row fingerprint is what catches this.
    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm2' } }
    await presenter.reindexEmbeddings('a')

    // Non-destructive: the on-disk store is dropped and rebuilt, the SQLite row survives.
    expect(resetVectorStore).toHaveBeenCalledWith('a')
    expect(repo.getById(id!)).toBeDefined()
    expect(repo.getById(id!)?.status).toBe('embedded')
    expect(repo.getById(id!)?.embedding_model).toBe('p:m2')
    expect(createVectorStore).toHaveBeenCalledTimes(2)
  })

  it('treats a legacy NULL fingerprint as stale and re-embeds it', async () => {
    const repo = createFakeRepository()
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [0.1, 0.2]),
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    // A row embedded before the fingerprint column existed: status embedded, model NULL.
    repo.insert({ id: 'legacy', agentId: 'a', kind: 'semantic', content: 'redis' })
    repo.updateStatus('legacy', 'embedded', { embeddingId: 'legacy', embeddingDim: 2 })
    expect(repo.getById('legacy')?.embedding_model).toBeNull()

    await presenter.reindexEmbeddings('a')
    expect(repo.getById('legacy')?.embedding_model).toBe('p:m')
  })

  it('recall detects a stale fingerprint, answers from FTS, and kicks off a reindex (AC-3.1/3.3)', async () => {
    const repo = createFakeRepository()
    let config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm1' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [0.1, 0.2]),
      getDimensions: async () => ({ data: { dimensions: 2, normalized: false } }),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')

    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm2' } }
    const results = await presenter.recall('a', 'redis')
    // FTS still answers immediately; stale vectors are re-queued by the background warm.
    expect(results.some((item) => item.content === 'redis fact')).toBe(true)
    expect(repo.getById(id!)?.embedding_model).toBe('p:m1')

    await waitForMemoryCondition(() => repo.getById(id!)?.embedding_model === 'p:m2')
    expect(repo.getById(id!)?.embedding_model).toBe('p:m2')
  })

  it('invalidates readiness on the config hook and issues a new generation certificate', async () => {
    const repo = createFakeRepository()
    let config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm1' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_providerId, _modelId, texts) =>
        texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    const internals = memoryRuntimeForTests(presenter)
    expect(internals.isVectorReady('a', { providerId: 'p', modelId: 'm1' })).toBe(true)

    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm2' } }
    presenter.onAgentMemoryMaintenanceConfigChanged('a')
    expect(internals.isVectorReady('a', { providerId: 'p', modelId: 'm1' })).toBe(false)

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => repo.getById(id)?.embedding_model === 'p:m2')
    await waitForMemoryCondition(() =>
      internals.isVectorReady('a', { providerId: 'p', modelId: 'm2' })
    )
  })

  it('reindex recovers rows left in error by a prior failed embed', async () => {
    const repo = createFakeRepository()
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [0.1, 0.2]),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    // A row a previous embed gave up on (e.g. a vector store write failure).
    repo.insert({
      id: 'stuck',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis',
      status: 'error'
    })

    await presenter.reindexEmbeddings('a')
    expect(repo.getById('stuck')?.status).toBe('embedded')
    expect(repo.getById('stuck')?.embedding_model).toBe('p:m')
  })

  it('recall backfills fts_only rows once an embedding model is configured (P1-A)', async () => {
    const repo = createFakeRepository()
    let config: DeepChatAgentConfig = { memoryEnabled: true }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    // No embedding config yet: the row is deferred to fts_only.
    await presenter.processPendingEmbeddings('a')
    expect(repo.listByAgent('a')[0]?.status).toBe('fts_only')

    // Model configured later. recall reaches a healthy store and kicks the backfill.
    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm' } }
    const spy = vi.spyOn(presenter, 'backfillEmbeddings')
    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => spy.mock.calls.length > 0)
    expect(spy).toHaveBeenCalledWith('a')
    await spy.mock.results[0]?.value

    expect(repo.listByAgent('a')[0]?.status).toBe('embedded')
    expect(repo.listByAgent('a')[0]?.embedding_model).toBe('p:m')
  })

  it('does not issue an empty fts_only requeue during backfill', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const requeueSpy = vi.spyOn(repo, 'requeueForEmbedding')

    await presenter.backfillEmbeddings('a')

    expect(requeueSpy).not.toHaveBeenCalled()
  })

  it('re-drains rows a failed reindex left pending on the next backfill (P1-B)', async () => {
    const repo = createFakeRepository()
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    let serviceDown = false
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) => {
      if (serviceDown) throw new Error('embedding service down')
      return texts.map((text) => textToVector(text))
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(repo.listByAgent('a')[0]?.status).toBe('embedded')

    // A reindex during an outage re-queues then stalls: the row stays pending, never terminal.
    serviceDown = true
    await presenter.reindexEmbeddings('a')
    expect(repo.listByAgent('a')[0]?.status).toBe('pending_embedding')

    // Service recovers; the next backfill (as recall would trigger) re-drains the leftover.
    serviceDown = false
    await presenter.backfillEmbeddings('a')
    expect(repo.listByAgent('a')[0]?.status).toBe('embedded')
  })

  it('never vectorizes persona rows during reindex/backfill (P2)', async () => {
    const repo = createFakeRepository()
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'persona1',
      agentId: 'a',
      kind: 'persona',
      content: 'I answer concisely',
      status: 'fts_only'
    })
    repo.insert({
      id: 'fact1',
      agentId: 'a',
      kind: 'semantic',
      content: 'likes redis',
      status: 'fts_only'
    })

    await presenter.reindexEmbeddings('a')
    // The self-model stays fts_only; only the real memory is embedded.
    expect(repo.getById('persona1')?.status).toBe('fts_only')
    expect(repo.getById('fact1')?.status).toBe('embedded')
  })

  it('ignores an anomalous embedded persona: no reindex churn, not recalled (P2)', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    store.vectors.set('m1', textToVector('redis cached row'))
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    // Anomalous data: a persona wrongly marked embedded with a STALE fingerprint, its vector
    // already sitting in the sidecar (as a buggy backfill or manual import would leave it).
    repo.insert({
      id: 'persona1',
      agentId: 'a',
      kind: 'persona',
      content: 'redis persona',
      status: 'fts_only'
    })
    repo.updateStatus('persona1', 'embedded', {
      embeddingId: 'persona1',
      embeddingDim: 4,
      embeddingModel: 'p:OLD'
    })
    await store.upsert([{ memoryId: 'persona1', embedding: textToVector('redis persona') }])
    // A normal fact embedded with the current fingerprint.
    repo.insert({
      id: 'fact1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis fact',
      status: 'fts_only'
    })
    repo.updateStatus('fact1', 'embedded', {
      embeddingId: 'fact1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    await store.upsert([{ memoryId: 'fact1', embedding: textToVector('redis fact') }])

    const spy = vi.spyOn(presenter, 'reindexEmbeddings')
    const results = await presenter.recall('a', 'redis')

    // The stale persona must not be read as stale (no reindex), nor surface as a normal memory.
    expect(spy).not.toHaveBeenCalled()
    const ids = results.map((item) => item.id)
    expect(ids).toContain('fact1')
    expect(ids).not.toContain('persona1')
  })

  it('excludes persona rows from recall results (P2)', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'persona1',
      agentId: 'a',
      kind: 'persona',
      content: 'redis persona note',
      status: 'fts_only'
    })
    repo.insert({
      id: 'fact1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis fact',
      status: 'fts_only'
    })

    const results = await presenter.recall('a', 'redis')
    const ids = results.map((item) => item.id)
    expect(ids).toContain('fact1')
    expect(ids).not.toContain('persona1')
  })

  it('rebuilds an unusable sidecar so pending/fts_only rows recover (P1)', async () => {
    const repo = createFakeRepository()
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    let didReset = false
    const unusable: IMemoryVectorStore = {
      upsert: async () => {},
      query: async () => [],
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => [],
      close: async () => {},
      isUsable: () => false
    }
    const usable = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => (didReset ? usable : unusable))
    const resetVectorStore = vi.fn(async () => {
      didReset = true
    })
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore,
      resetVectorStore
    })
    // Only fts_only rows: no embedded row exists to flag the foreign sidecar as stale.
    repo.insert({
      id: 'fact1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis fact',
      status: 'fts_only'
    })

    const spy = vi.spyOn(presenter, 'reindexEmbeddings')
    await presenter.recall('a', 'redis')
    expect(getEmbeddings).not.toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['memory warmup'], expect.any(AbortSignal))
    await waitForMemoryCondition(() => spy.mock.calls.length > 0)
    expect(spy).toHaveBeenCalledWith('a', true)
    await spy.mock.results[0]?.value

    expect(resetVectorStore).toHaveBeenCalledWith('a')
    expect(repo.getById('fact1')?.status).toBe('embedded')
    getEmbeddings.mockClear()
    const querySpy = vi.spyOn(usable, 'query')
    await presenter.recall('a', 'redis')
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(querySpy).toHaveBeenCalled()
  })

  it('never queries an unusable vector store, falling back to FTS without errors (AC-5.3)', async () => {
    const repo = createFakeRepository()
    const query = vi.fn(async () => [])
    const unusableStore = { ...new FakeVectorStore(), isUsable: () => false, query }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => unusableStore
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })

    const results = await presenter.recall('a', 'redis')
    expect(query).not.toHaveBeenCalled()
    expect(results.some((item) => item.content === 'redis fact')).toBe(true)
  })
})
