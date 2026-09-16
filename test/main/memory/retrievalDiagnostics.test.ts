import { describe, expect, it, vi } from 'vitest'
import { ATEMPORAL_MEMORY_METADATA } from '@/memory/core/temporal'

import { MemoryService } from '@/memory'
import { MemoryRuntimeContext } from '@/memory/context'
import { VectorStoreQueryTimeoutError } from '@/memory/domain/types'
import { RetrievalService } from '@/memory/services/retrievalService'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import {
  createFakeRepository,
  FakeDirectiveRepository,
  FakeVectorStore
} from './support/memoryFakes'
import { createControlledPromise } from './serviceHarness'
import { makeRow } from './serviceTestSupport'

function createPresenter(options: { enabled?: boolean; embedding?: boolean } = {}) {
  const repository = createFakeRepository()
  const store = new FakeVectorStore()
  const generateText = vi.fn(async () => '[]')
  let embedding = options.embedding === false ? undefined : { providerId: 'p', modelId: 'm' }
  const presenter = new MemoryService({
    repository,
    directiveRepository: new FakeDirectiveRepository(),
    executeWithRateLimit: vi.fn(async () => undefined),
    resolveAgentConfig: () => ({
      memoryEnabled: options.enabled !== false,
      memoryEmbedding: embedding
    }),
    getEmbeddings: async (_provider, _model, texts) => texts.map(() => [1, 2, 3, 4]),
    getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
    generateText,
    createVectorStore: async () => store,
    resetVectorStore: async () => undefined
  })
  return {
    presenter,
    repository,
    store,
    generateText,
    setEmbedding(next: { providerId: string; modelId: string } | undefined) {
      embedding = next
    }
  }
}

describe('RetrievalService diagnostics', () => {
  it('revalidates batch vector candidates without losing pinned rows or query snapshots', async () => {
    const repository = createFakeRepository()
    const ids = ['valid', 'wrong-model', 'wrong-dimension', 'conflicted', 'archived', 'pinned']
    for (const id of ids) {
      repository.rows.set(id, makeRow(id, { agent_id: 'agent', embedding_dim: 4 }))
    }
    vi.spyOn(repository, 'searchWithStrategy').mockReturnValue({ rows: [], strategy: 'fts-only' })
    const policy = {
      resolveAgentConfig: () =>
        ({
          memoryEnabled: true,
          memoryEmbedding: { providerId: 'p', modelId: 'm' }
        }) as DeepChatAgentConfig
    }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const reindexEmbeddings = vi.fn(async () => undefined)
    const backfillEmbeddings = vi.fn(async () => undefined)
    const service = new RetrievalService({
      ctx,
      repository,
      policy,
      embeddingGateway: {
        getEmbeddings: async () => [[1, 2, 3, 4]],
        getDimensions: async () => ({ data: { dimensions: 4, normalized: false } })
      },
      vectorStore: {
        getRecallHealth: () => 'available',
        hasReadyCertificate: () => true,
        query: async () => [],
        queryBatch: async () => {
          // Rows change after candidate discovery; only the authoritative state may be returned.
          repository.rows.get('wrong-model')!.embedding_model = 'p:old'
          repository.rows.get('wrong-dimension')!.embedding_dim = 3
          repository.rows.get('conflicted')!.conflict_state = 'challenged'
          repository.seedArchived('archived', 2000)
          return [
            ids.filter((id) => id !== 'pinned').map((memoryId) => ({ memoryId, distance: 0 }))
          ]
        },
        markReady: () => undefined,
        clearReady: vi.fn()
      },
      workingMemory: {
        readWorkingMemory: () => null,
        flushWorkingMemoryIfDirty: () => undefined,
        scheduleWorkingRefresh: () => undefined
      },
      warmVectorStore: async () => undefined,
      warmEmbeddingConnection: () => undefined,
      reindexEmbeddings,
      backfillEmbeddings,
      isReindexing: () => false,
      deletePrunableVectorsForMemoryIds: async () => [],
      getActiveSuppressionTopics: () => []
    })

    const [result] = await service.retrieveForDecisions(
      'agent',
      [
        {
          kind: 'semantic',
          category: null,
          content: 'redis',
          importance: 0.5,
          temporal: ATEMPORAL_MEMORY_METADATA
        }
      ],
      3000,
      undefined,
      [['pinned']]
    )
    expect(result.neighbors.map((row) => row.id)).toEqual(['pinned', 'valid'])
    expect(result.queryVector).toEqual({
      vector: [1, 2, 3, 4],
      providerId: 'p',
      modelId: 'm',
      dimensions: 4
    })
    expect(reindexEmbeddings).not.toHaveBeenCalled()
    expect(backfillEmbeddings).not.toHaveBeenCalled()
  })

  it('keeps normal vector cold diagnostics out of empty injection manifests', async () => {
    const { presenter, repository } = createPresenter()
    vi.spyOn(repository, 'searchWithStrategy').mockReturnValue({
      rows: [],
      strategy: 'fts-only'
    })

    await expect(presenter.buildInjection('agent', 'redis')).resolves.toBeNull()
    expect(
      presenter.getHealth('agent').runtime.agent.retrieval.injection.degradationCounts.vectorCold
    ).toBe(1)
    await presenter.dispose()
  })

  it('records multiple degradations once without mixing retrieval purposes', async () => {
    const { presenter, repository } = createPresenter()
    vi.spyOn(repository, 'searchWithStrategy').mockReturnValue({
      rows: [],
      strategy: 'like-fallback'
    })

    await presenter.recall('agent', 'redis')
    await presenter.searchMemories('agent', 'redis')
    await presenter.buildInjection('agent', '')

    const retrieval = presenter.getHealth('agent').runtime.agent.retrieval
    expect(retrieval.recall.outcomeCounts.completed).toBe(1)
    expect(retrieval.recall.degradationCounts.ftsUnavailable).toBe(1)
    expect(retrieval.recall.degradationCounts.vectorCold).toBe(1)
    expect(retrieval.search.outcomeCounts.completed).toBe(1)
    expect(retrieval.injection.outcomeCounts.emptyQuery).toBe(1)
    expect(retrieval.decision.outcomeCounts.completed).toBe(0)
    await presenter.dispose()
  })

  it('records disabled and repository failures as terminal outcomes', async () => {
    const disabled = createPresenter({ enabled: false })
    await expect(disabled.presenter.recall('agent', 'redis')).resolves.toEqual([])
    expect(
      disabled.presenter.getHealth('agent').runtime.agent.retrieval.recall.outcomeCounts.disabled
    ).toBe(1)
    await disabled.presenter.dispose()

    const failing = createPresenter({ embedding: false })
    vi.spyOn(failing.repository, 'searchWithStrategy').mockImplementation(() => {
      throw new Error('storage failure')
    })
    await expect(failing.presenter.recall('agent', 'redis')).rejects.toThrow('storage failure')
    const recall = failing.presenter.getHealth('agent').runtime.agent.retrieval.recall
    expect(recall.outcomeCounts.failed).toBe(1)
    expect(recall.degradationCounts.storeError).toBe(1)
    await failing.presenter.dispose()
  })

  it('records batch decision retrieval as one decision operation', async () => {
    const { presenter, generateText } = createPresenter({ embedding: false })
    generateText
      .mockResolvedValueOnce('KEEP')
      .mockResolvedValueOnce(
        '[{"kind":"semantic","content":"first"},{"kind":"semantic","content":"second"}]'
      )

    await expect(
      presenter.extractAndStore({
        agentId: 'agent',
        spanText: 'two facts',
        model: { providerId: 'p', modelId: 'm' }
      })
    ).resolves.toMatchObject({ ok: true })

    const decision = presenter.getHealth('agent').runtime.agent.retrieval.decision
    expect(decision.outcomeCounts.completed).toBe(1)
    expect(decision.latencyMs.total.samples).toBe(1)
    await presenter.dispose()
  })

  it('records operation-fence teardown as extraction cancellation', async () => {
    const { presenter, generateText, setEmbedding } = createPresenter({ embedding: false })
    presenter.onAgentMemoryMaintenanceConfigChanged('agent')
    const triage = createControlledPromise<string>()
    generateText.mockImplementationOnce(() => triage.promise)
    const pending = presenter.extractAndStore({
      agentId: 'agent',
      spanText: 'pending fact',
      model: { providerId: 'p', modelId: 'm' }
    })
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledOnce())

    setEmbedding({ providerId: 'p', modelId: 'm2' })
    presenter.onAgentMemoryMaintenanceConfigChanged('agent')
    triage.resolve('KEEP')
    await expect(pending).resolves.toEqual({ ok: false })

    expect(presenter.getHealth('agent').runtime.agent.extraction).toMatchObject({
      chunksCompleted: 0,
      chunksCancelled: 1,
      chunksFailed: 0
    })
    await presenter.dispose()
  })

  it('records a vector query timeout while returning FTS results for the turn', async () => {
    vi.useFakeTimers()
    try {
      const { presenter, store } = createPresenter()
      const [memoryId] = presenter.writeMemoriesSync(
        [{ kind: 'semantic', content: 'redis setup' }],
        { agentId: 'agent' }
      )
      await presenter.processPendingEmbeddings('agent')
      const query = vi.spyOn(store, 'query').mockImplementation(() => new Promise(() => undefined))

      const recall = presenter.recall('agent', 'redis')
      await vi.advanceTimersByTimeAsync(2_000)

      await expect(recall).resolves.toEqual([expect.objectContaining({ id: memoryId })])
      expect(
        presenter.getHealth('agent').runtime.agent.retrieval.recall.degradationCounts.storeTimeout
      ).toBe(1)
      await expect(presenter.recall('agent', 'redis')).resolves.toEqual([
        expect.objectContaining({ id: memoryId })
      ])
      expect(query).toHaveBeenCalledTimes(1)
      expect(presenter.getHealth('agent').runtime.process.vector.warmupFailed).toBe(0)
      await presenter.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('propagates retrieval degradation into the injection manifest', async () => {
    vi.useFakeTimers()
    try {
      const { presenter, store } = createPresenter()
      presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis setup' }], {
        agentId: 'agent'
      })
      await presenter.processPendingEmbeddings('agent')
      vi.spyOn(store, 'query').mockImplementation(() => new Promise(() => undefined))

      const injection = presenter.buildInjection('agent', 'redis')
      await vi.advanceTimersByTimeAsync(2_000)

      await expect(injection).resolves.toMatchObject({
        payload: { memories: [expect.objectContaining({ content: 'redis setup' })] },
        manifest: { degradations: expect.arrayContaining(['storeTimeout']) }
      })
      await presenter.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('records batch vector timeouts as storeTimeout degradation', async () => {
    const repository = createFakeRepository()
    repository.insert({
      id: 'existing',
      agentId: 'agent',
      kind: 'semantic',
      content: 'redis setup',
      status: 'fts_only'
    })
    const embedding = { providerId: 'p', modelId: 'm' }
    const policy = {
      resolveAgentConfig: () =>
        ({ memoryEnabled: true, memoryEmbedding: embedding }) as DeepChatAgentConfig
    }
    const ctx = new MemoryRuntimeContext({
      policy,
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })
    const recordRecall = vi.fn()
    const getEmbeddings = vi.fn(async () => [[1, 2, 3, 4]])
    const clearReady = vi.fn()
    const service = new RetrievalService({
      ctx,
      repository,
      policy,
      embeddingGateway: {
        getEmbeddings,
        getDimensions: async () => ({ data: { dimensions: 4, normalized: false } })
      },
      vectorStore: {
        getRecallHealth: () => 'available',
        hasReadyCertificate: () => true,
        query: async () => [],
        queryBatch: async () => {
          throw new VectorStoreQueryTimeoutError('agent', 2_000)
        },
        markReady: () => undefined,
        clearReady
      },
      workingMemory: {
        readWorkingMemory: () => null,
        flushWorkingMemoryIfDirty: () => undefined,
        scheduleWorkingRefresh: () => undefined
      },
      warmVectorStore: async () => undefined,
      warmEmbeddingConnection: () => undefined,
      reindexEmbeddings: async () => undefined,
      backfillEmbeddings: async () => undefined,
      isReindexing: () => false,
      deletePrunableVectorsForMemoryIds: async () => [],
      getActiveSuppressionTopics: () => [],
      diagnostics: { recordRecall }
    })

    const candidates = [
      {
        kind: 'semantic' as const,
        category: null,
        content: 'redis',
        importance: 0.5,
        temporal: ATEMPORAL_MEMORY_METADATA
      }
    ]
    await expect(
      service.retrieveForDecisions('agent', candidates, Date.now())
    ).resolves.toHaveLength(1)
    expect(getEmbeddings).toHaveBeenCalledOnce()
    expect(clearReady).toHaveBeenCalledExactlyOnceWith('agent')
    expect(recordRecall).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({ degradations: expect.arrayContaining(['storeTimeout']) })
    )

    getEmbeddings.mockClear()
    recordRecall.mockClear()
    await expect(
      service.retrieveForDecisions('agent', candidates, Date.now(), [
        {
          vector: [1, 2, 3, 4],
          providerId: 'p',
          modelId: 'm',
          dimensions: 4
        }
      ])
    ).resolves.toHaveLength(1)
    expect(getEmbeddings).not.toHaveBeenCalled()
    expect(recordRecall).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({ degradations: expect.arrayContaining(['storeTimeout']) })
    )
  })
})
