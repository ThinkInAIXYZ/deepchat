import { describe, expect, it, vi } from 'vitest'

import { isSafeAgentId } from '@/presenter/memoryPresenter'
import { buildMemoryProvenanceKey } from '@/presenter/memoryPresenter/core/scoring'
import { WARM_DIMENSION_FAILURE_COOLDOWN_MS } from '@/presenter/memoryPresenter/runtimeConstants'
import { type IMemoryVectorStore } from '@/presenter/memoryPresenter/types'
import { createEmptyMemoryHealth } from '@shared/contracts/routes'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import {
  FakeVectorStore,
  createFakeRepository,
  enabledConfig,
  makePresenter,
  textToVector
} from '../fakes/memoryFakes'
import { DAY, makeLLMPresenter, routedLLM, seedEmbedded } from './serviceTestSupport'

import {
  MemoryPresenter,
  embeddingDimensions,
  flushMicrotasks,
  memoryRuntimeForTests,
  waitForMemoryCondition
} from './serviceTestSupport'

describe('MemoryPresenter management', () => {
  it('clearMemories removes all and clears vectors', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(store.vectors.size).toBe(1)
    const removed = await presenter.clearMemories('a')
    expect(removed).toBe(1)
    expect(store.vectors.size).toBe(0)
  })

  it('clearMemories invalidates a cached working blob', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis working fact' }], {
      agentId: 'a'
    })
    presenter.refreshWorkingMemory('a')
    expect((await presenter.buildInjection('a', ''))?.payload.working).toContain(
      'redis working fact'
    )

    await presenter.clearMemories('a')

    expect([...repo.rows.values()].some((row) => row.kind === 'working')).toBe(false)
    expect((await presenter.buildInjection('a', ''))?.payload.working ?? '').not.toContain(
      'redis working fact'
    )
  })

  it('clearMemories closes the cached store, resets disk, and re-creates it next time', async () => {
    const repo = createFakeRepository()
    const stores: FakeVectorStore[] = []
    const createVectorStore = vi.fn(async () => {
      const s = new FakeVectorStore()
      stores.push(s)
      return s
    })
    const resetVectorStore = vi.fn(async () => undefined)
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(createVectorStore).toHaveBeenCalledTimes(1)
    const closeSpy = vi.spyOn(stores[0], 'close')

    await presenter.clearMemories('a')
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(resetVectorStore).toHaveBeenCalledWith('a')

    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'pg' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(createVectorStore).toHaveBeenCalledTimes(2)
  })

  it('clearMemories resets the on-disk store even when nothing is cached', async () => {
    const repo = createFakeRepository()
    const resetVectorStore = vi.fn(async () => undefined)
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore
    })
    // Simulate a fresh process: a memory row exists on disk but no vector store is cached.
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    expect(createVectorStore).not.toHaveBeenCalled()

    await presenter.clearMemories('a')
    expect(resetVectorStore).toHaveBeenCalledWith('a')
  })

  it('retries a failed vector reset on the next lease instead of bricking admission', async () => {
    const repo = createFakeRepository()
    let resetAttempts = 0
    const resetVectorStore = vi.fn(async () => {
      resetAttempts += 1
      if (resetAttempts === 1) throw new Error('transient reset failure')
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore
    })

    expect(await presenter.clearMemories('a')).toBe(0)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis after reset' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')

    expect(resetVectorStore).toHaveBeenCalledTimes(2)
    expect(repo.listByAgent('a')[0]?.status).toBe('embedded')
  })

  it('cleanupDeletedAgentResources clears runtime state even when vector reset fails', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    store.vectors.set('m1', textToVector('redis cached row'))
    const createVectorStore = vi.fn(async () => store)
    let resetAttempts = 0
    const resetVectorStore = vi.fn(async () => {
      resetAttempts += 1
      if (resetAttempts === 1) throw new Error('reset failed')
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore,
      resetVectorStore
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis cached row',
      status: 'embedded',
      provenanceKey: buildMemoryProvenanceKey('a', 'semantic', 'redis cached row')
    })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: textToVector('').length,
      embeddingModel: 'p:m'
    })
    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(
      () => presenter.getHealth('a').runtime.process.vector.openStores === 1,
      'vector store did not become ready'
    )
    expect(createVectorStore).toHaveBeenCalledTimes(1)

    await expect(presenter.cleanupDeletedAgentResources('a')).rejects.toThrow('reset failed')

    expect(resetVectorStore).toHaveBeenCalledWith('a')
    expect(presenter.getHealth('a').runtime.process.vector.openStores).toBe(0)
    expect(store.closeCount).toBeGreaterThan(0)

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(
      () => presenter.getHealth('a').runtime.process.vector.openStores === 1,
      'vector store did not recover after failed cleanup reset'
    )
    expect(createVectorStore).toHaveBeenCalledTimes(2)
  })

  it('cleanupDeletedAgentResources waits for in-flight embedding drains before clearing tracking', async () => {
    const repo = createFakeRepository()
    let managed = true
    let resolveEmbeddings!: (vectors: number[][]) => void
    const getEmbeddings = vi.fn(
      async () =>
        new Promise<number[][]>((resolve) => {
          resolveEmbeddings = resolve
        })
    )
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      isManagedAgent: () => managed,
      getEmbeddings,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    const drain = presenter.processPendingEmbeddings('a')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getEmbeddings).toHaveBeenCalledTimes(1)

    managed = false
    let cleanupSettled = false
    const cleanup = presenter.cleanupDeletedAgentResources('a').then(() => {
      cleanupSettled = true
    })
    await Promise.resolve()
    expect(cleanupSettled).toBe(false)

    resolveEmbeddings([[1, 0, 0, 0]])
    await cleanup
    await drain

    expect(cleanupSettled).toBe(true)
    expect(createVectorStore).not.toHaveBeenCalled()
    expect(repo.getById(id)?.status).toBe('pending_embedding')
  })

  it('cleanupDeletedAgentResources waits for in-flight embedding warmups before clearing tracking', async () => {
    const repo = createFakeRepository()
    let managed = true
    let resolveWarmup!: () => void
    const getEmbeddings = vi.fn(
      async () =>
        new Promise<number[][]>((resolve) => {
          resolveWarmup = () => resolve([textToVector('memory warmup')])
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      isManagedAgent: () => managed,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    const internals = memoryRuntimeForTests(presenter)

    internals.warmEmbeddingConnection('a', { providerId: 'p', modelId: 'm' })
    await waitForMemoryCondition(() => getEmbeddings.mock.calls.length === 1)
    expect(getEmbeddings).toHaveBeenCalledTimes(1)

    managed = false
    let cleanupSettled = false
    const cleanup = presenter.cleanupDeletedAgentResources('a').then(() => {
      cleanupSettled = true
    })
    await Promise.resolve()
    expect(cleanupSettled).toBe(false)

    resolveWarmup()
    await cleanup

    expect(cleanupSettled).toBe(true)
  })

  it('cleanupDeletedAgentResources blocks late warmups from spawning backfill work', async () => {
    const repo = createFakeRepository()
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis cold row',
      status: 'fts_only',
      provenanceKey: buildMemoryProvenanceKey('a', 'semantic', 'redis cold row')
    })
    let resolveDimensions: (() => void) | undefined
    let resolveBackfill: (() => void) | undefined
    let backfillStarted = false
    const getDimensions = vi.fn(
      async () =>
        new Promise<{ data: { dimensions: number; normalized: boolean } }>((resolve) => {
          resolveDimensions = () =>
            resolve({ data: { dimensions: textToVector('').length, normalized: false } })
        })
    )
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) => {
      if (texts[0] === 'memory warmup') return texts.map((text) => textToVector(text))
      backfillStarted = true
      return await new Promise<number[][]>((resolve) => {
        resolveBackfill = () => resolve(texts.map((text) => textToVector(text)))
      })
    })
    const stores: FakeVectorStore[] = []
    const createVectorStore = vi.fn(async () => {
      const store = new FakeVectorStore()
      stores.push(store)
      return store
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getDimensions,
      getEmbeddings,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => resolveDimensions !== undefined)

    let cleanupSettled = false
    const cleanup = presenter.cleanupDeletedAgentResources('a').then(() => {
      cleanupSettled = true
    })
    await Promise.resolve()
    expect(cleanupSettled).toBe(false)

    resolveDimensions?.()
    await cleanup

    expect(cleanupSettled).toBe(true)
    expect(backfillStarted).toBe(false)
    expect(resolveBackfill).toBeUndefined()
    expect(createVectorStore).not.toHaveBeenCalled()
    expect(presenter.getHealth('a').runtime.process.vector.openStores).toBe(0)
    expect(stores).toEqual([])
  })

  it('cleanupDeletedAgentResources waits for in-flight persona evolution before clearing tracking', async () => {
    const repo = createFakeRepository()
    let managed = true
    let resolveText!: (value: string) => void
    const generateText = vi.fn(
      async () =>
        new Promise<string>((resolve) => {
          resolveText = resolve
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true, personaEvolutionEnabled: true }),
      isManagedAgent: () => managed,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    for (let index = 0; index < 6; index += 1) {
      repo.insert({
        id: `p-${index}`,
        agentId: 'a',
        kind: 'semantic',
        content: `persona fact ${index}`,
        importance: 1,
        status: 'embedded',
        createdAt: 2000 + index
      })
    }
    const persona = presenter.maybeEvolvePersona('a', { providerId: 'p', modelId: 'm' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(generateText).toHaveBeenCalledTimes(1)

    managed = false
    let cleanupSettled = false
    const cleanup = presenter.cleanupDeletedAgentResources('a').then(() => {
      cleanupSettled = true
    })
    await Promise.resolve()
    expect(cleanupSettled).toBe(false)

    resolveText('I am concise and technical.')
    await cleanup
    await persona

    expect(cleanupSettled).toBe(true)
    expect(repo.listPersonaVersions('a')).toHaveLength(0)
  })

  it('concurrent vector-store access shares a single create (promise cache)', async () => {
    const repo = createFakeRepository()
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    // Two cold-cache recalls return from FTS immediately; the background warm still shares one open.
    await Promise.all([presenter.recall('a', 'redis'), presenter.recall('a', 'redis')])
    expect(createVectorStore).not.toHaveBeenCalled()
    await waitForMemoryCondition(() => getEmbeddings.mock.calls.length === 1)
    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['memory warmup'], expect.any(AbortSignal))
    await waitForMemoryCondition(() => createVectorStore.mock.calls.length === 1)
    expect(createVectorStore).toHaveBeenCalledTimes(1)
  })

  it('cold recall returns FTS without awaiting query embeddings or a slow store open', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    await store.upsert([{ memoryId: 'm1', embedding: textToVector('redis fact') }])
    let resolveCreate: () => void = () => {}
    const createVectorStore = vi.fn(
      () =>
        new Promise<FakeVectorStore>((resolve) => {
          resolveCreate = () => resolve(store)
        })
    )
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      generateText: async () => '',
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    const internals = memoryRuntimeForTests(presenter)

    const first = await presenter.recall('a', 'redis')
    const second = await presenter.recall('a', 'redis')
    expect(first.map((item) => item.id)).toContain('m1')
    expect(second.map((item) => item.id)).toContain('m1')
    expect(getEmbeddings).not.toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['memory warmup'], expect.any(AbortSignal))

    await waitForMemoryCondition(() => createVectorStore.mock.calls.length === 1)
    expect(createVectorStore).toHaveBeenCalledTimes(1)

    const querySpy = vi.spyOn(store, 'query')
    resolveCreate()
    await waitForMemoryCondition(
      () => internals.isVectorReady('a'),
      'vector store did not become ready'
    )

    const warm = await presenter.recall('a', 'redis')
    expect(warm.map((item) => item.id)).toContain('m1')
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(querySpy).toHaveBeenCalledTimes(1)
  })

  it('cold searchMemories returns FTS without awaiting query embeddings or a slow store open', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    await store.upsert([{ memoryId: 'm1', embedding: textToVector('redis fact') }])
    let resolveCreate: () => void = () => {}
    const createVectorStore = vi.fn(
      () =>
        new Promise<FakeVectorStore>((resolve) => {
          resolveCreate = () => resolve(store)
        })
    )
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      generateText: async () => '',
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    const internals = memoryRuntimeForTests(presenter)

    const cold = await presenter.searchMemories('a', 'redis')
    expect(cold.map((hit) => hit.row.id)).toEqual(['m1'])
    expect(getEmbeddings).not.toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['memory warmup'], expect.any(AbortSignal))

    await waitForMemoryCondition(() => createVectorStore.mock.calls.length === 1)
    expect(createVectorStore).toHaveBeenCalledTimes(1)
    const querySpy = vi.spyOn(store, 'query')
    resolveCreate()
    await waitForMemoryCondition(
      () => internals.isVectorReady('a'),
      'vector store did not become ready'
    )

    const warm = await presenter.searchMemories('a', 'redis')
    expect(warm.map((hit) => hit.row.id)).toContain('m1')
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(querySpy).toHaveBeenCalledTimes(1)
  })

  it('validates stale embeddings once during warmup and never on ordinary recall', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    await store.upsert([{ memoryId: 'm1', embedding: textToVector('redis fact') }])
    const staleSpy = vi.spyOn(repo, 'hasStaleEmbeddings')
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_providerId, _modelId, texts) =>
        texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    const internals = memoryRuntimeForTests(presenter)

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => internals.isVectorReady('a'))
    expect(staleSpy).toHaveBeenCalledTimes(1)

    await presenter.recall('a', 'redis')
    await presenter.recall('a', 'redis')
    expect(staleSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale sidecar hit when the authoritative row is pending embedding', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    const [memoryId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'redis obsolete wording' }],
      { agentId: 'a' }
    )
    await presenter.processPendingEmbeddings('a')
    expect(store.vectors.has(memoryId)).toBe(true)

    const current = repo.getById(memoryId)!
    expect(
      repo.updateDecisionContentIfRevision({
        agentId: 'a',
        id: memoryId,
        expectedRevision: current.decision_revision,
        content: 'completely unrelated replacement',
        provenanceKey: buildMemoryProvenanceKey(
          'a',
          'semantic',
          'completely unrelated replacement'
        ),
        at: Date.now()
      })
    ).toBe(true)
    expect(repo.getById(memoryId)?.status).toBe('pending_embedding')

    const recalled = await presenter.recall('a', 'redis obsolete wording')
    expect(recalled.map((item) => item.id)).not.toContain(memoryId)
  })

  it('keeps a readiness certificate across a resource-only close and reopen', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => store)
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_providerId, _modelId, texts) =>
        texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    const [memoryId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'redis reopen fact' }],
      { agentId: 'a' }
    )
    await presenter.processPendingEmbeddings('a')
    const internals = memoryRuntimeForTests(presenter)
    expect(internals.isVectorReady('a')).toBe(true)

    await internals.vectorStoreService.closeAgentStore('a')
    expect(presenter.getHealth('a').runtime.process.vector.openStores).toBe(0)
    expect(internals.isVectorReady('a')).toBe(true)

    const recalled = await presenter.recall('a', 'redis reopen fact')
    expect(recalled.map((item) => item.id)).toContain(memoryId)
    expect(createVectorStore).toHaveBeenCalledTimes(2)
    expect(internals.isVectorReady('a')).toBe(true)
  })

  it('agent-facing recall keywordizes long English messages for FTS-only recall', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis setup',
      status: 'fts_only'
    })

    const recalled = await presenter.recall('a', 'Could you please explain the redis setup again?')

    expect(recalled.map((item) => item.id)).toEqual(['m1'])
  })

  it('agent-facing recall uses deterministic terms without corpus stats', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis setup',
      status: 'fts_only'
    })
    repo.insert({
      id: 'm2',
      agentId: 'a',
      kind: 'semantic',
      content: 'please review the dashboard notes',
      status: 'fts_only'
    })
    repo.insert({
      id: 'm3',
      agentId: 'a',
      kind: 'semantic',
      content: 'please summarize the release notes',
      status: 'fts_only'
    })
    repo.insert({
      id: 'm4',
      agentId: 'a',
      kind: 'semantic',
      content: 'please update the checklist',
      status: 'fts_only'
    })

    const recalled = await presenter.recall('a', 'please redis setup')

    expect(recalled.map((item) => item.id).sort()).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('agent-facing recall keeps a single domain term even when it is frequent', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true })
    for (const id of ['m1', 'm2', 'm3', 'm4']) {
      repo.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: `${id} redis note`,
        status: 'fts_only'
      })
    }

    const recalled = await presenter.recall('a', 'redis')

    expect(recalled.map((item) => item.id).sort()).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('agent-facing recall skips keyword search when no candidate hits but still tries vector recall', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis setup' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const querySpy = vi.spyOn(store, 'query')

    await presenter.recall('a', 'zzzz qqqq')

    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['zzzz qqqq'], expect.any(AbortSignal))
    expect(querySpy).toHaveBeenCalled()
  })

  it('agent-facing recall keywordizes CJK messages instead of requiring an entire sentence match', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: '用户偏好简洁的中文回答问题',
      status: 'fts_only'
    })

    const recalled = await presenter.recall('a', '请继续用中文回答这个问题，谢谢')

    expect(recalled.map((item) => item.id)).toEqual(['m1'])
  })

  it('warm recall soft-times out query embedding and keeps vector readiness for later turns', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      const store = new FakeVectorStore()
      let blockQueryEmbedding = false
      const getEmbeddings = vi.fn((_p: string, _m: string, texts: string[]) => {
        if (blockQueryEmbedding && texts[0] !== 'memory warmup') {
          return new Promise<number[][]>(() => undefined)
        }
        return Promise.resolve(texts.map((text) => textToVector(text)))
      })
      const createVectorStore = vi.fn(async () => store)
      const presenter = new MemoryPresenter({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings,
        getDimensions: embeddingDimensions,
        createVectorStore,
        resetVectorStore: async () => undefined
      })
      const [memoryId] = presenter.writeMemoriesSync(
        [{ kind: 'semantic', content: 'redis setup' }],
        {
          agentId: 'a'
        }
      )
      const internals = memoryRuntimeForTests(presenter)
      await presenter.processPendingEmbeddings('a')
      expect(internals.isVectorReady('a')).toBe(true)

      blockQueryEmbedding = true
      const clearReadySpy = vi.spyOn(internals.vectorStoreService, 'clearReady')
      const backfillSpy = vi.spyOn(presenter, 'backfillEmbeddings')
      const reindexSpy = vi.spyOn(presenter, 'reindexEmbeddings')
      const recall = presenter.recall('a', 'Could you explain the redis setup again?')

      await vi.advanceTimersByTimeAsync(801)
      const recalled = await recall

      expect(recalled.map((item) => item.id)).toEqual([memoryId])
      expect(clearReadySpy).not.toHaveBeenCalled()
      expect(backfillSpy).not.toHaveBeenCalled()
      expect(reindexSpy).not.toHaveBeenCalled()
      expect(internals.isVectorReady('a')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a fresh query embedding after the prior absolute deadline', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      const store = new FakeVectorStore()
      let blockQueryEmbedding = false
      let queryEmbeddingCalls = 0
      const getEmbeddings = vi.fn((_p: string, _m: string, texts: string[]) => {
        if (blockQueryEmbedding && texts[0] !== 'memory warmup') {
          queryEmbeddingCalls += 1
          return new Promise<number[][]>(() => undefined)
        }
        return Promise.resolve(texts.map((text) => textToVector(text)))
      })
      const presenter = new MemoryPresenter({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings,
        getDimensions: embeddingDimensions,
        createVectorStore: async () => store,
        resetVectorStore: async () => undefined
      })
      const [memoryId] = presenter.writeMemoriesSync(
        [{ kind: 'semantic', content: 'redis setup' }],
        { agentId: 'a' }
      )
      await presenter.processPendingEmbeddings('a')

      blockQueryEmbedding = true
      const first = presenter.recall('a', 'redis setup')
      await vi.advanceTimersByTimeAsync(801)
      expect((await first).map((item) => item.id)).toEqual([memoryId])
      expect(queryEmbeddingCalls).toBe(1)

      const second = presenter.recall('a', 'redis setup')
      await vi.advanceTimersByTimeAsync(801)

      expect((await second).map((item) => item.id)).toEqual([memoryId])
      expect(queryEmbeddingCalls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shares identical concurrent query embeddings and returns vector hits to both callers', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    let resolveQueryEmbedding: ((vectors: number[][]) => void) | null = null
    const getEmbeddings = vi.fn((_p: string, _m: string, texts: string[]) => {
      if (texts[0] === 'redis') {
        return new Promise<number[][]>((resolve) => {
          resolveQueryEmbedding = resolve
        })
      }
      return Promise.resolve(texts.map((text) => textToVector(text)))
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    const [memoryId] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis setup' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    getEmbeddings.mockClear()

    const first = presenter.recall('a', 'redis')
    const second = presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => resolveQueryEmbedding !== null)
    resolveQueryEmbedding?.([textToVector('redis')])

    const [firstHits, secondHits] = await Promise.all([first, second])
    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(firstHits.find((item) => item.id === memoryId)?.sources?.vec).toBe(true)
    expect(secondHits.find((item) => item.id === memoryId)?.sources?.vec).toBe(true)
  })

  it('allows two distinct query embeddings and skips only the third fresh query', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const pendingQueryEmbeddings: Array<(vectors: number[][]) => void> = []
    let blockQueryEmbedding = false
    let queryEmbeddingCalls = 0
    const getEmbeddings = vi.fn((_p: string, _m: string, texts: string[]) => {
      if (blockQueryEmbedding && texts[0] !== 'memory warmup') {
        queryEmbeddingCalls += 1
        return new Promise<number[][]>((resolve) => pendingQueryEmbeddings.push(resolve))
      }
      return Promise.resolve(texts.map((text) => textToVector(text)))
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    const [memoryId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'redis vue setup' }],
      { agentId: 'a' }
    )
    await presenter.processPendingEmbeddings('a')

    blockQueryEmbedding = true
    const first = presenter.recall('a', 'redis setup')
    const second = presenter.recall('a', 'vue setup')
    await waitForMemoryCondition(() => pendingQueryEmbeddings.length === 2)
    const third = await presenter.recall('a', 'setup')
    pendingQueryEmbeddings[0]([textToVector('redis setup')])
    pendingQueryEmbeddings[1]([textToVector('vue setup')])

    const [firstHits, secondHits] = await Promise.all([first, second])
    expect(firstHits.find((item) => item.id === memoryId)?.sources?.vec).toBe(true)
    expect(secondHits.find((item) => item.id === memoryId)?.sources?.vec).toBe(true)
    expect(third.find((item) => item.id === memoryId)?.sources?.vec).not.toBe(true)
    expect(third.map((item) => item.id)).toEqual([memoryId])
    expect(queryEmbeddingCalls).toBe(2)
  })

  it('replaces stale query embedding in-flight entries without late-settle deletion', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      const store = new FakeVectorStore()
      let blockQueryEmbedding = false
      let queryEmbeddingCalls = 0
      const pendingQueryEmbeddings: Array<(vectors: number[][]) => void> = []
      const getEmbeddings = vi.fn((_p: string, _m: string, texts: string[]) => {
        if (blockQueryEmbedding && texts[0] !== 'memory warmup') {
          queryEmbeddingCalls += 1
          return new Promise<number[][]>((resolve) => pendingQueryEmbeddings.push(resolve))
        }
        return Promise.resolve(texts.map((text) => textToVector(text)))
      })
      const presenter = new MemoryPresenter({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings,
        getDimensions: embeddingDimensions,
        createVectorStore: async () => store,
        resetVectorStore: async () => undefined
      })
      const [memoryId] = presenter.writeMemoriesSync(
        [{ kind: 'semantic', content: 'redis setup' }],
        { agentId: 'a' }
      )
      await presenter.processPendingEmbeddings('a')

      blockQueryEmbedding = true
      const first = presenter.recall('a', 'redis setup')
      await vi.advanceTimersByTimeAsync(801)
      expect((await first).map((item) => item.id)).toEqual([memoryId])
      expect(queryEmbeddingCalls).toBe(1)

      await vi.advanceTimersByTimeAsync(30_001)
      const second = presenter.recall('a', 'redis setup')
      await vi.advanceTimersByTimeAsync(801)
      expect((await second).map((item) => item.id)).toEqual([memoryId])
      expect(queryEmbeddingCalls).toBe(2)

      pendingQueryEmbeddings[0]?.([textToVector('redis setup')])
      await flushMicrotasks()
      const third = presenter.recall('a', 'redis setup')
      await vi.advanceTimersByTimeAsync(801)
      expect((await third).map((item) => item.id)).toEqual([memoryId])
      expect(queryEmbeddingCalls).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cools down repeated getDimensions failures while keeping cold recall on FTS', async () => {
    const repo = createFakeRepository()
    const getDimensions = vi.fn(async () => {
      throw new Error('dimensions down')
    })
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      getDimensions,
      generateText: async () => '',
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis fact',
      status: 'fts_only'
    })

    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).toContain('m1')
    await waitForMemoryCondition(
      () => getDimensions.mock.calls.length === 1,
      'first dimension failure did not settle'
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).toContain('m1')
    await flushMicrotasks()
    expect(getDimensions).toHaveBeenCalledTimes(1)
    expect(createVectorStore).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 0))
    const retryAt = Date.now() + WARM_DIMENSION_FAILURE_COOLDOWN_MS + 1
    vi.spyOn(Date, 'now').mockReturnValue(retryAt)
    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(
      () => getDimensions.mock.calls.length === 2,
      'dimension retry did not run after cooldown'
    )
  })

  it('cold rememberMemory still short-circuits exact provenance duplicates before recall', async () => {
    const repo = createFakeRepository()
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const generateText = vi.fn(async () => '')
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      generateText,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    const [existingId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'user likes redis' }],
      { agentId: 'a' }
    )

    const outcome = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user likes redis' },
      { agentId: 'a' },
      { providerId: 'main', modelId: 'main' }
    )

    expect(outcome).toEqual({ action: 'noop', reason: 'duplicate', id: existingId })
    expect(createVectorStore).not.toHaveBeenCalled()
    expect(getEmbeddings).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
    expect(repo.countByAgent('a')).toBe(1)
  })

  it('cold rememberMemory does not block on vector-only semantic neighbors', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    await store.upsert([{ memoryId: 'm1', embedding: textToVector('user likes redis') }])
    let resolveCreate: () => void = () => {}
    const createVectorStore = vi.fn(
      () =>
        new Promise<FakeVectorStore>((resolve) => {
          resolveCreate = () => resolve(store)
        })
    )
    const newContent = 'postgres preference'
    const embeddingCalls: Array<{ texts: string[]; rowExists: boolean }> = []
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) => {
      embeddingCalls.push({
        texts,
        rowExists: Boolean(
          repo.getByProvenanceKey('a', buildMemoryProvenanceKey('a', 'semantic', texts[0]))
        )
      })
      return texts.map((text) => textToVector(text))
    })
    const generateText = vi.fn(async () => '{"decision":"NOOP","targetIndex":0}')
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      generateText,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'user likes redis' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    const internals = memoryRuntimeForTests(presenter)

    const outcome = await presenter.rememberMemory(
      { kind: 'semantic', content: newContent },
      { agentId: 'a' },
      { providerId: 'main', modelId: 'main' }
    )

    expect(outcome.action).toBe('created')
    expect(generateText).not.toHaveBeenCalled()
    expect(repo.listByAgent('a').map((row) => row.content)).toContain(newContent)
    expect(embeddingCalls.map((call) => call.texts)).toContainEqual(['memory warmup'])
    const rowEmbeddingCalls = embeddingCalls.filter((call) => call.texts[0] !== 'memory warmup')
    expect(rowEmbeddingCalls.length).toBeGreaterThan(0)
    expect(rowEmbeddingCalls.every((call) => call.rowExists)).toBe(true)

    await waitForMemoryCondition(() => createVectorStore.mock.calls.length === 1)
    expect(createVectorStore).toHaveBeenCalledTimes(1)
    resolveCreate()
    await waitForMemoryCondition(
      () => internals.isVectorReady('a'),
      'vector store did not become ready'
    )
  })

  it('processPendingEmbeddings does not open the sidecar for a row cleared during the await', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => store)
    let resolveEmb: () => void = () => {}
    const getEmbeddings = vi.fn(
      () =>
        new Promise<number[][]>((resolve) => {
          resolveEmb = () => resolve([textToVector('redis')])
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    const ids = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    const pending = presenter.processPendingEmbeddings('a') // suspends on getEmbeddings
    await presenter.clearMemories('a') // deletes the row + resets the store
    resolveEmb()
    await pending
    // Row was gone before the store was opened → no sidecar (re)created, no orphan vector.
    expect(createVectorStore).not.toHaveBeenCalled()
    expect(store.vectors.has(ids[0])).toBe(false)
  })

  it('clearMemories awaits an in-flight create, then closes and resets it', async () => {
    const repo = createFakeRepository()
    const created = new FakeVectorStore()
    let resolveCreate: () => void = () => {}
    const createVectorStore = vi.fn(
      () =>
        new Promise<IMemoryVectorStore>((resolve) => {
          resolveCreate = () => resolve(created)
        })
    )
    // Models the on-disk reset: deleting the file drops whatever the in-flight create wrote.
    const resetVectorStore = vi.fn(async () => {
      created.vectors.clear()
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    const closeSpy = vi.spyOn(created, 'close')

    // An embedding blocks inside createVectorStore, holding the per-agent lock.
    const embedding = presenter.processPendingEmbeddings('a')
    await new Promise((r) => setTimeout(r, 0))
    expect(createVectorStore).toHaveBeenCalledTimes(1)

    // Clearing while the create is in flight must queue behind the lock, not race past it.
    const clear = presenter.clearMemories('a')
    await new Promise((r) => setTimeout(r, 0))
    expect(resetVectorStore).not.toHaveBeenCalled()

    resolveCreate()
    await Promise.all([embedding, clear])

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(resetVectorStore).toHaveBeenCalledWith('a')
    // The cleared row was deleted before the embedding resumed → no orphan vector written.
    expect(created.vectors.size).toBe(0)
  })

  it('deleteMemory only deletes owned memory', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const ids = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    expect(await presenter.deleteMemory('other-agent', ids[0])).toBe(false)
    expect(await presenter.deleteMemory('a', ids[0])).toBe(true)
    expect(repo.countByAgent('a')).toBe(0)
  })

  it('forgetMemory archives owned memory and restore re-enables recall', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    const ids = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis cache' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).toContain(ids[0])

    expect(await presenter.forgetMemory('other-agent', ids[0])).toBe(false)
    expect(repo.getById(ids[0])?.status).toBe('embedded')
    expect(await presenter.forgetMemory('a', ids[0])).toBe(true)
    expect(repo.getById(ids[0])?.status).toBe('archived')
    expect(repo.rows.has(ids[0])).toBe(true)
    expect(store.vectors.has(ids[0])).toBe(true)
    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).not.toContain(ids[0])

    expect(presenter.restoreMemory('a', ids[0])).toBe(true)
    await presenter.processPendingEmbeddings('a')
    expect(repo.getById(ids[0])?.status).toBe('embedded')
    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).toContain(ids[0])
  })

  it('inline-prunes vector matches that SQLite rejects as dead', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis cache' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    repo.archive(id, Date.now())
    expect(store.vectors.has(id)).toBe(true)

    await presenter.recall('a', 'redis')

    await waitForMemoryCondition(() => !store.vectors.has(id), 'dead vector was not pruned')
  })

  it('does not delete restored vectors from an in-flight inline prune', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis cache' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    repo.archive(id, Date.now())
    const originalFilterPrunable = repo.filterPrunableVectorRefs.bind(repo)
    const filterPrunable = vi
      .spyOn(repo, 'filterPrunableVectorRefs')
      .mockImplementation((agentId, ids, embeddingDim, embeddingModel) => {
        if (ids.includes(id)) {
          repo.updateStatus(id, 'embedded', {
            embeddingId: id,
            embeddingDim,
            embeddingModel
          })
          store.vectors.set(id, textToVector('redis cache restored'))
        }
        return originalFilterPrunable(agentId, ids, embeddingDim, embeddingModel)
      })
    const deleteByMemoryIds = vi.spyOn(store, 'deleteByMemoryIds')

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => filterPrunable.mock.calls.length > 0)

    expect(deleteByMemoryIds).not.toHaveBeenCalled()
    expect(repo.getById(id)).toMatchObject({
      status: 'embedded',
      embedding_id: id,
      embedding_dim: 4,
      embedding_model: 'p:m'
    })
    expect(store.vectors.has(id)).toBe(true)
  })

  it('maintenance sweep deletes prunable vectors before clearing embedding refs', async () => {
    const generateText = routedLLM({})
    const { presenter, repo, store } = makeLLMPresenter(generateText)
    const id = await seedEmbedded(presenter, 'user likes redis')
    repo.archive(id, Date.now())
    expect(store.vectors.has(id)).toBe(true)
    expect(repo.getById(id)?.embedding_id).toBe(id)

    await presenter.runConsolidationPass('a', 1_000 * DAY)

    expect(store.vectors.has(id)).toBe(false)
    expect(repo.getById(id)).toMatchObject({
      status: 'archived',
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null
    })
  })

  it('does not delete restored vectors when a row changes before guarded prune', async () => {
    const generateText = routedLLM({})
    const { presenter, repo, store } = makeLLMPresenter(generateText)
    const id = await seedEmbedded(presenter, 'user likes redis')
    repo.archive(id, Date.now())
    const originalFilterPrunable = repo.filterPrunableVectorRefs.bind(repo)
    const deleteByMemoryIds = vi.spyOn(store, 'deleteByMemoryIds')
    vi.spyOn(repo, 'filterPrunableVectorRefs').mockImplementation(
      (agentId, ids, embeddingDim, embeddingModel) => {
        if (ids.includes(id)) {
          repo.updateStatus(id, 'embedded', {
            embeddingId: id,
            embeddingDim,
            embeddingModel
          })
          store.vectors.set(id, textToVector('user likes redis restored'))
        }
        return originalFilterPrunable(agentId, ids, embeddingDim, embeddingModel)
      }
    )

    await presenter.runConsolidationPass('a', 1_000 * DAY)

    expect(deleteByMemoryIds).not.toHaveBeenCalled()
    expect(repo.getById(id)).toMatchObject({
      status: 'embedded',
      embedding_id: id,
      embedding_dim: 4,
      embedding_model: 'p:m'
    })
    expect(store.vectors.has(id)).toBe(true)
  })

  it('does not let stale-dimension refs starve current-dimension vector pruning', async () => {
    const generateText = routedLLM({})
    const { presenter, repo, store } = makeLLMPresenter(generateText)
    const liveId = await seedEmbedded(presenter, 'live current vector')
    repo.setAnchor(liveId, true)
    for (let index = 0; index < 260; index += 1) {
      const id = `old-${index}`
      repo.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: `old archived ${index}`,
        status: 'embedded',
        createdAt: index
      })
      repo.updateStatus(id, 'embedded', {
        embeddingId: id,
        embeddingDim: 8,
        embeddingModel: 'p:m'
      })
      repo.archive(id, Date.now())
      store.vectors.set(id, textToVector(`old archived ${index}`))
    }
    for (let index = 0; index < 2; index += 1) {
      const id = `current-${index}`
      repo.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: `current archived ${index}`,
        status: 'embedded',
        createdAt: 1000 + index
      })
      repo.updateStatus(id, 'embedded', {
        embeddingId: id,
        embeddingDim: 4,
        embeddingModel: 'p:m'
      })
      repo.archive(id, Date.now())
      store.vectors.set(id, textToVector(`current archived ${index}`))
    }

    await presenter.runConsolidationPass('a', 1_000 * DAY)

    expect(store.vectors.has('current-0')).toBe(false)
    expect(store.vectors.has('current-1')).toBe(false)
    expect(repo.getById('current-0')).toMatchObject({
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null
    })
    expect(repo.getById('old-0')).toMatchObject({
      embedding_id: 'old-0',
      embedding_dim: 8,
      embedding_model: 'p:m'
    })
    expect(store.vectors.has('old-0')).toBe(true)
    expect(repo.getById(liveId)?.status).toBe('embedded')
  })

  it('surfaces guarded prune filter failures instead of treating them as no-op deletes', async () => {
    const generateText = routedLLM({})
    const { presenter, repo, store } = makeLLMPresenter(generateText)
    const id = await seedEmbedded(presenter, 'user likes redis')
    repo.archive(id, Date.now())
    vi.spyOn(repo, 'filterPrunableVectorRefs').mockImplementation(() => {
      throw new Error('filter failed')
    })

    await expect(presenter.runConsolidationPass('a', 1_000 * DAY)).rejects.toThrow('filter failed')

    expect(repo.getById(id)?.embedding_id).toBe(id)
    expect(store.vectors.has(id)).toBe(true)
  })

  it('restores and re-embeds a memory after maintenance prunes its archived vector', async () => {
    const generateText = routedLLM({})
    const { presenter, repo, store } = makeLLMPresenter(generateText)
    const id = await seedEmbedded(presenter, 'user likes redis')
    repo.archive(id, Date.now())
    await presenter.runConsolidationPass('a', 1_000 * DAY)
    expect(store.vectors.has(id)).toBe(false)
    expect(repo.getById(id)?.embedding_id).toBeNull()

    expect(presenter.restoreMemory('a', id)).toBe(true)
    await presenter.processPendingEmbeddings('a')

    expect(repo.getById(id)).toMatchObject({
      status: 'embedded',
      embedding_id: id,
      embedding_dim: 4,
      embedding_model: 'p:m'
    })
    expect(store.vectors.has(id)).toBe(true)
    expect(
      (await presenter.recall('a', 'redis')).find((item) => item.id === id)?.sources?.vec
    ).toBe(true)
  })

  it('getByIds returns owned memories in input order without status filtering', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const ids = presenter.writeMemoriesSync(
      [
        { kind: 'semantic', content: 'active redis' },
        { kind: 'semantic', content: 'archived redis' },
        { kind: 'semantic', content: 'superseded redis' }
      ],
      { agentId: 'a' }
    )
    repo.archive(ids[1], 2000)
    repo.markSuperseded(ids[2], ids[0])
    repo.insert({
      id: 'other-agent-memory',
      agentId: 'other',
      kind: 'semantic',
      content: 'other agent memory'
    })

    expect(presenter.getByIds('a', [ids[2], ids[2], 'missing', ids[1], ids[0], ids[1]])).toEqual([
      expect.objectContaining({ id: ids[2], superseded_by: ids[0] }),
      expect.objectContaining({ id: ids[1], status: 'archived' }),
      expect.objectContaining({ id: ids[0], status: 'pending_embedding' })
    ])
    expect(presenter.getByIds('a', ['other-agent-memory'])).toEqual([])
  })

  it('keeps source-span lookups inside management visibility', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const ids = presenter.writeMemoriesSync(
      [
        { kind: 'semantic', content: 'active source' },
        { kind: 'semantic', content: 'archived source' },
        { kind: 'semantic', content: 'superseded source' },
        { kind: 'semantic', content: 'conflicted source' }
      ],
      { agentId: 'a' }
    )
    repo.archive(ids[1])
    repo.markSuperseded(ids[2], ids[0])
    repo.updateStatus(ids[3], 'conflicted')
    repo.insert({
      id: 'persona-source',
      agentId: 'a',
      kind: 'persona',
      content: 'hidden persona',
      status: 'fts_only'
    })

    expect(
      presenter
        .getManagementVisibleByIds('a', [ids[2], ids[1], ids[3], 'persona-source', ids[0]])
        .map((row) => row.id)
    ).toEqual([ids[1], ids[0]])
  })

  it('archiveUserMemory soft-archives owned memory and writes content-free user audit', async () => {
    const { presenter, repo, auditRepo } = makePresenter(enabledConfig)
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis cache' }], {
      agentId: 'a'
    })

    await expect(presenter.archiveUserMemory('other-agent', id)).resolves.toBe(false)
    await expect(presenter.archiveUserMemory('a', id)).resolves.toBe(true)

    expect(repo.getById(id)?.status).toBe('archived')
    const [firstAudit] = auditRepo.listByAgent('a', {
      eventType: 'memory/archive',
      actorType: 'user'
    })
    expect(firstAudit).toMatchObject({
      event_type: 'memory/archive',
      actor_type: 'user',
      status: 'completed',
      reason: null
    })
    expect(JSON.parse(firstAudit.input_refs_json)).toEqual({ memoryId: id })
    expect(JSON.parse(firstAudit.output_refs_json)).toEqual({ action: 'archived', memoryId: id })
    expect(firstAudit.input_refs_json).not.toContain('redis cache')
    expect(firstAudit.output_refs_json).not.toContain('redis cache')

    await expect(presenter.archiveUserMemory('a', id)).resolves.toBe(true)
    const archiveAudits = auditRepo.listByAgent('a', {
      eventType: 'memory/archive',
      actorType: 'user'
    })
    expect(archiveAudits).toHaveLength(2)
    expect(archiveAudits.some((audit) => audit.reason === 'already_archived')).toBe(true)
    expect(presenter.restoreMemory('a', id)).toBe(true)
    expect(repo.getById(id)?.status).toBe('pending_embedding')
  })

  it('refuses generic archive/restore/forget for persona and working rows without audit writes', async () => {
    const { presenter, repo, auditRepo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'persona',
      agentId: 'a',
      kind: 'persona',
      content: 'active self model',
      status: 'archived',
      personaState: 'active'
    })
    repo.insert({
      id: 'working',
      agentId: 'a',
      kind: 'working',
      content: 'working blob',
      status: 'fts_only'
    })

    expect(presenter.listMemories('a').map((row) => row.id)).not.toEqual(
      expect.arrayContaining(['persona', 'working'])
    )
    expect(presenter.getByIds('a', ['persona', 'working']).map((row) => row.id)).toEqual([
      'persona',
      'working'
    ])
    await expect(presenter.forgetMemory('a', 'persona')).resolves.toBe(false)
    await expect(presenter.archiveUserMemory('a', 'persona')).resolves.toBe(false)
    expect(presenter.restoreMemory('a', 'persona')).toBe(false)
    await expect(presenter.forgetMemory('a', 'working')).resolves.toBe(false)

    expect(repo.getById('persona')).toMatchObject({
      status: 'archived',
      persona_state: 'active'
    })
    expect(repo.getById('working')?.status).toBe('fts_only')
    expect(auditRepo.listByAgent('a', { eventType: 'memory/archive' })).toHaveLength(0)
  })

  it('prunes legacy persona and working vectors before repairing their statuses', async () => {
    const { presenter, repo, auditRepo, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'live current memory' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    repo.insert({
      id: 'persona',
      agentId: 'a',
      kind: 'persona',
      content: 'active self model',
      status: 'fts_only',
      personaState: 'active'
    })
    repo.updateStatus('persona', 'pending_embedding', {
      embeddingId: 'persona',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    repo.insert({
      id: 'working',
      agentId: 'a',
      kind: 'working',
      content: 'working blob',
      status: 'embedded'
    })
    repo.updateStatus('working', 'embedded', {
      embeddingId: 'working',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    await store.upsert([
      { memoryId: 'persona', embedding: textToVector('active self model') },
      { memoryId: 'working', embedding: textToVector('working blob') }
    ])

    await presenter.runConsolidationPass('a', 1_000 * DAY)

    expect(repo.getById('persona')).toMatchObject({
      status: 'fts_only',
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null
    })
    expect(repo.getById('working')).toMatchObject({
      status: 'fts_only',
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null
    })
    expect(store.vectors.has('persona')).toBe(false)
    expect(store.vectors.has('working')).toBe(false)
    expect(presenter.getHealth('a').embeddings.pending).toBe(0)
    expect(presenter.getStatus('a').pendingEmbedding).toBe(0)
    expect(auditRepo.listByAgent('a', { eventType: 'memory/repair' })).toHaveLength(1)
  })

  it('keeps internal-kind embedding refs when vector prune fails', async () => {
    const { presenter, repo, auditRepo, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'live current memory' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    vi.spyOn(store, 'deleteByMemoryIds').mockRejectedValue(new Error('delete failed'))
    repo.insert({
      id: 'persona',
      agentId: 'a',
      kind: 'persona',
      content: 'active self model',
      status: 'fts_only',
      personaState: 'active'
    })
    repo.updateStatus('persona', 'pending_embedding', {
      embeddingId: 'persona',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    await store.upsert([{ memoryId: 'persona', embedding: textToVector('active self model') }])

    await presenter.runConsolidationPass('a', 1_000 * DAY)

    expect(repo.getById('persona')).toMatchObject({
      status: 'fts_only',
      embedding_id: 'persona',
      embedding_dim: 4,
      embedding_model: 'p:m'
    })
    expect(store.vectors.has('persona')).toBe(true)
    expect(auditRepo.listByAgent('a', { eventType: 'memory/repair' })).toHaveLength(1)
  })
})

describe('MemoryPresenter agentId safety guards', () => {
  it('isSafeAgentId accepts well-formed ids and rejects traversal/garbage', () => {
    expect(isSafeAgentId('deepchat')).toBe(true)
    expect(isSafeAgentId('deepchat-Ab12_xy')).toBe(true)
    expect(isSafeAgentId('../../etc/passwd')).toBe(false)
    expect(isSafeAgentId('a/b')).toBe(false)
    expect(isSafeAgentId('a\\b')).toBe(false)
    expect(isSafeAgentId('a.b')).toBe(false)
    expect(isSafeAgentId('')).toBe(false)
    expect(isSafeAgentId('x'.repeat(129))).toBe(false)
  })

  it('management methods reject malformed agentId', async () => {
    const { presenter } = makePresenter(enabledConfig)
    expect(() => presenter.listMemories('../escape')).toThrow(/invalid agentId/)
    expect(() => presenter.getStatus('bad/id')).toThrow(/invalid agentId/)
    expect(() => presenter.getHealth('bad/id')).toThrow(/invalid agentId/)
    expect(() => presenter.listPersonaVersions('bad.id')).toThrow(/invalid agentId/)
    expect(() => presenter.listPersonaDrafts('bad.id')).toThrow(/invalid agentId/)
    await expect(presenter.rollbackPersona('bad id', 'v')).rejects.toThrow(/invalid agentId/)
    await expect(presenter.approvePersonaDraft('bad/id', 'd')).rejects.toThrow(/invalid agentId/)
    await expect(presenter.rejectPersonaDraft('bad/id', 'd')).rejects.toThrow(/invalid agentId/)
    await expect(presenter.setPersonaAnchor('bad/id', 'v', true)).rejects.toThrow(/invalid agentId/)
    await expect(presenter.deleteMemory('bad/id', 'm')).rejects.toThrow(/invalid agentId/)
    await expect(presenter.clearMemories('bad/id')).rejects.toThrow(/invalid agentId/)
  })

  it('management methods no-op for unmanaged (nonexistent) agents', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      isManagedAgent: (id) => id === 'real',
      getEmbeddings: async () => [],
      generateText: async () => '[]',
      createVectorStore: async () => store
    })
    // The internal write path (extraction) bypasses the management guard with a trusted agentId.
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'real' })

    // Well-formed but not a real agent: reads come back empty and mutations are no-ops.
    expect(presenter.listMemories('ghost')).toEqual([])
    expect(presenter.getStatus('ghost')).toEqual({
      total: 0,
      pendingEmbedding: 0,
      hasPersona: false,
      activeMemoryCount: 0,
      archivedMemoryCount: 0,
      conflictCount: 0,
      personaDraftCount: 0,
      personaVersionCount: 0
    })
    expect(presenter.getHealth('ghost')).toEqual(createEmptyMemoryHealth())
    expect(await presenter.clearMemories('ghost')).toBe(0)
    expect(await presenter.rollbackPersona('ghost', 'v')).toBe(false)

    // A real agent works normally.
    expect(presenter.listMemories('real')).toHaveLength(1)
    expect(repo.countByAgent('real')).toBe(1)
  })
})

describe('MemoryPresenter health read model', () => {
  it('assembles health from read-only repository and audit stats', () => {
    const { presenter, repo, auditRepo } = makePresenter(enabledConfig)
    const now = Date.now()
    repo.insert({
      id: 'current',
      agentId: 'a',
      kind: 'semantic',
      category: 'project_fact',
      content: 'repo uses pnpm',
      createdAt: now - DAY
    })
    repo.updateStatus('current', 'embedded', {
      embeddingId: 'current',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    repo.insert({
      id: 'legacy',
      agentId: 'a',
      kind: 'semantic',
      content: 'legacy vector',
      createdAt: now - 2 * DAY
    })
    repo.updateStatus('legacy', 'embedded', {
      embeddingId: 'legacy',
      embeddingDim: 8,
      embeddingModel: 'p:m'
    })
    repo.insert({
      id: 'archive',
      agentId: 'a',
      kind: 'semantic',
      category: 'heuristic',
      content: 'old unused',
      createdAt: now - 400 * DAY
    })
    repo.updateDecayScore('archive', 0.01)
    repo.recordAccess('current', now)
    auditRepo.insert({
      id: 'audit-1',
      agentId: 'a',
      eventType: 'memory/maintenance_llm',
      actorType: 'scheduler',
      status: 'failed',
      reason: 'model unavailable',
      createdAt: 4000
    })

    const archiveSpy = vi.spyOn(repo, 'archive')
    const deleteSpy = vi.spyOn(repo, 'delete')
    const insertSpy = vi.spyOn(repo, 'insert')
    const updateStatusSpy = vi.spyOn(repo, 'updateStatus')

    const health = presenter.getHealth('a')

    expect(health.totalRows).toBe(3)
    expect(health.byCategory.project_fact).toBe(1)
    expect(health.embeddings.stale).toBe(1)
    expect(health.lifecycle.archiveCandidates).toBe(1)
    expect(health.access.topAccessed).toEqual([
      expect.objectContaining({
        id: 'current',
        category: 'project_fact',
        accessCount: 1
      })
    ])
    expect(health.maintenance.failed).toBe(1)
    expect(health.maintenance.recentFailures[0]).toEqual({
      eventType: 'memory/maintenance_llm',
      status: 'failed',
      reason: 'model unavailable',
      createdAt: 4000
    })
    expect(archiveSpy).not.toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
    expect(updateStatusSpy).not.toHaveBeenCalled()
  })

  it('returns stale=0 without an embedding config', () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true } as DeepChatAgentConfig)
    repo.insert({ id: 'legacy', agentId: 'a', kind: 'semantic', content: 'legacy' })
    repo.updateStatus('legacy', 'embedded', {
      embeddingId: 'legacy',
      embeddingDim: 8,
      embeddingModel: 'old:model'
    })

    expect(presenter.getHealth('a').embeddings.stale).toBe(0)
  })
})

describe('MemoryPresenter dispose lifecycle (C4, AC-4.1)', () => {
  it('closes cached vector stores and is idempotent', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const closeSpy = vi.spyOn(store, 'close')

    await presenter.dispose()
    expect(closeSpy).toHaveBeenCalledTimes(1)

    await presenter.dispose()
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('dispose waits for in-flight embedding warmups before clearing tracking', async () => {
    let resolveWarmup!: () => void
    const getEmbeddings = vi.fn(
      async () =>
        new Promise<number[][]>((resolve) => {
          resolveWarmup = () => resolve([textToVector('memory warmup')])
        })
    )
    const presenter = new MemoryPresenter({
      repository: createFakeRepository(),
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    const internals = memoryRuntimeForTests(presenter)

    internals.warmEmbeddingConnection('a', { providerId: 'p', modelId: 'm' })
    await waitForMemoryCondition(() => getEmbeddings.mock.calls.length === 1)
    expect(getEmbeddings).toHaveBeenCalledTimes(1)

    let disposed = false
    const dispose = presenter.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)

    resolveWarmup()
    await dispose

    expect(disposed).toBe(true)
  })
})
