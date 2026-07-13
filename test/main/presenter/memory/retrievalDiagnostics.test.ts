import { describe, expect, it, vi } from 'vitest'

import { MemoryPresenter } from '@/presenter/memoryPresenter'
import { createFakeRepository, FakeVectorStore } from '../fakes/memoryFakes'
import { createControlledPromise } from './serviceHarness'

function createPresenter(options: { enabled?: boolean; embedding?: boolean } = {}) {
  const repository = createFakeRepository()
  const generateText = vi.fn(async () => '[]')
  let embedding = options.embedding === false ? undefined : { providerId: 'p', modelId: 'm' }
  const presenter = new MemoryPresenter({
    repository,
    executeWithRateLimit: vi.fn(async () => undefined),
    resolveAgentConfig: () => ({
      memoryEnabled: options.enabled !== false,
      memoryEmbedding: embedding
    }),
    getEmbeddings: async (_provider, _model, texts) => texts.map(() => [1, 2, 3, 4]),
    getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
    generateText,
    createVectorStore: async () => new FakeVectorStore(),
    resetVectorStore: async () => undefined
  })
  return {
    presenter,
    repository,
    generateText,
    setEmbedding(next: { providerId: string; modelId: string } | undefined) {
      embedding = next
    }
  }
}

describe('RetrievalService diagnostics', () => {
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
})
