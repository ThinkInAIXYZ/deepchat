import { describe, expect, it, vi } from 'vitest'

import { MemoryPresenter } from '@/presenter/memoryPresenter'
import { createFakeRepository, FakeVectorStore } from '../fakes/memoryFakes'

function createPresenter(getEmbeddings: () => Promise<number[][]>, withEmbedding = true) {
  const repository = createFakeRepository()
  const presenter = new MemoryPresenter({
    repository,
    executeWithRateLimit: vi.fn(async () => undefined),
    resolveAgentConfig: () => ({
      memoryEnabled: true,
      memoryEmbedding: withEmbedding ? { providerId: 'p', modelId: 'm' } : undefined
    }),
    getEmbeddings,
    getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
    createVectorStore: async () => new FakeVectorStore(),
    resetVectorStore: async () => undefined
  })
  return { presenter, repository }
}

describe('EmbeddingPipeline diagnostics', () => {
  it('counts only actual error transitions for an all-malformed batch', async () => {
    const { presenter } = createPresenter(async () => [[]])
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'malformed vector' }], {
      agentId: 'agent'
    })

    await presenter.processPendingEmbeddings('agent')

    expect(presenter.getHealth('agent').runtime.agent.embedding).toMatchObject({
      succeeded: 0,
      failed: 1,
      ftsOnly: 0
    })
    await presenter.dispose()
  })

  it('does not count retryable provider failures and counts a later success once', async () => {
    let fail = true
    const { presenter } = createPresenter(async () => {
      if (fail) throw new Error('retryable')
      return [[1, 2, 3, 4]]
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'retry vector' }], {
      agentId: 'agent'
    })

    await presenter.processPendingEmbeddings('agent')
    expect(presenter.getHealth('agent').runtime.agent.embedding).toMatchObject({
      succeeded: 0,
      failed: 0,
      ftsOnly: 0
    })

    fail = false
    await presenter.processPendingEmbeddings('agent')
    expect(presenter.getHealth('agent').runtime.agent.embedding).toMatchObject({
      succeeded: 1,
      failed: 0,
      ftsOnly: 0
    })
    await presenter.dispose()
  })

  it('reports FTS-only transitions separately from failures', async () => {
    const { presenter } = createPresenter(async () => [], false)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'lexical only' }], {
      agentId: 'agent'
    })

    await presenter.processPendingEmbeddings('agent')

    expect(presenter.getHealth('agent').runtime.agent.embedding).toMatchObject({
      succeeded: 0,
      failed: 0,
      ftsOnly: 1
    })
    await presenter.dispose()
  })

  it('records recoverable vector warmup outcomes as deferred', async () => {
    const repository = createFakeRepository()
    const presenter = new MemoryPresenter({
      repository,
      executeWithRateLimit: vi.fn(async () => undefined),
      resolveAgentConfig: () => ({
        memoryEnabled: true,
        memoryEmbedding: { providerId: 'p', modelId: 'm' }
      }),
      getEmbeddings: async () => [[1, 2, 3, 4]],
      getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
      createVectorStore: async () => {
        const store = new FakeVectorStore()
        store.isUsable = () => false
        return store
      },
      resetVectorStore: async () => undefined
    })

    await presenter.recall('agent', 'cold vector')
    await vi.waitFor(() => {
      expect(presenter.getHealth('agent').runtime.process.vector.warmupDeferred).toBeGreaterThan(0)
    })
    expect(presenter.getHealth('agent').runtime.process.vector.warmupFailed).toBe(0)
    await presenter.dispose()
  })
})
