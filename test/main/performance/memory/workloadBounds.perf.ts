import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryPresenter } from '@/presenter/memoryPresenter'
import {
  createFakeRepository,
  FakeVectorStore,
  textToVector
} from '../../presenter/fakes/memoryFakes'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'

import { buildAgentFixture, buildDecisionFixture } from './fixtures'
import { createMemoryPerfObserver } from './performanceObserver'

const SHARED_MODEL_CONFIG: DeepChatAgentConfig = {
  memoryEnabled: true,
  memoryEmbedding: { providerId: 'shared-provider', modelId: 'shared-model' }
}

async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Agent Memory #28 bounded workloads', () => {
  it('drains 101 embeddings in fixed 50-row provider and persistence batches', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const observer = createMemoryPerfObserver(true)
    for (let index = 0; index < 101; index += 1) {
      repo.insert({
        id: `embedding-${index}`,
        agentId: 'embedding-agent',
        kind: 'semantic',
        content: `embedding content ${index}`,
        status: 'pending_embedding'
      })
    }
    const getEmbeddings = vi.fn(async (_providerId: string, _modelId: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const upsert = vi.spyOn(store, 'upsert')
    const listByIds = vi.spyOn(repo, 'listByIds')
    const markReady = vi.spyOn(repo, 'markPendingEmbeddingsReady')
    const markError = vi.spyOn(repo, 'markPendingEmbeddingsError')
    const presenter = new MemoryPresenter({
      executeWithRateLimit: async () => undefined,
      repository: repo,
      perfObserver: observer,
      resolveAgentConfig: () => SHARED_MODEL_CONFIG,
      getEmbeddings,
      getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
      generateText: async () => '',
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })

    try {
      await presenter.processPendingEmbeddings('embedding-agent')

      expect(getEmbeddings.mock.calls.map((call) => call[2].length)).toEqual([50, 50, 1])
      expect(listByIds).toHaveBeenCalledTimes(3)
      expect(upsert.mock.calls.map((call) => call[0].length)).toEqual([50, 50, 1])
      expect(markReady).toHaveBeenCalledTimes(3)
      expect(markReady.mock.calls.flatMap((call) => call[1])).toHaveLength(101)
      expect(markError).not.toHaveBeenCalled()

      const snapshot = observer.snapshot()
      expect(snapshot.counters.providerCalls).toBe(3)
      expect(snapshot.counters.repositoryCalls).toBeLessThanOrEqual(24)
      expect(snapshot.counters.materializedRows).toBeLessThanOrEqual(404)
    } finally {
      await presenter.dispose()
    }
  })

  it('coordinates eight candidates with three neighbors each within steady provider caps', async () => {
    const fixture = buildDecisionFixture()
    const repo = createFakeRepository()
    const observer = createMemoryPerfObserver(true)
    for (const candidate of fixture) {
      for (const neighbor of candidate.neighbors) {
        repo.insert({
          id: neighbor.id,
          agentId: 'decision-agent',
          kind: 'semantic',
          content: neighbor.content,
          status: 'fts_only'
        })
      }
    }
    const decisionPrompts: string[] = []
    const generateText = vi.fn(async (_providerId: string, _modelId: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('You extract durable, long-term memories')) {
        return JSON.stringify(
          fixture.map((candidate) => ({
            category: 'project_fact',
            content: candidate.content,
            importance: 0.7
          }))
        )
      }
      if (prompt.includes('Candidate ')) {
        decisionPrompts.push(prompt)
        const indexes = [...prompt.matchAll(/^Candidate (\d+) \(/gmu)].map((match) =>
          Number(match[1])
        )
        return JSON.stringify(
          indexes.map((candidateIndex) => ({
            candidateIndex,
            decision: 'ADD',
            targetIndex: null
          }))
        )
      }
      return ''
    })
    const search = vi.spyOn(repo, 'search')
    const listByIds = vi.spyOn(repo, 'listByIds')
    const presenter = new MemoryPresenter({
      executeWithRateLimit: async () => undefined,
      repository: repo,
      perfObserver: observer,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })

    try {
      const result = await presenter.extractAndStore({
        agentId: 'decision-agent',
        spanText: 'Eight independent durable project facts.',
        model: { providerId: 'decision-provider', modelId: 'decision-model' }
      })
      expect(result.ok).toBe(true)
      expect(result.createdIds).toHaveLength(8)
      expect(search).toHaveBeenCalledTimes(8)
      expect(listByIds).toHaveBeenCalledTimes(1)
      expect(decisionPrompts).toHaveLength(2)
      expect(
        decisionPrompts.map((prompt) => [...prompt.matchAll(/^Candidate (\d+) \(/gmu)].length)
      ).toEqual([4, 4])
      expect(
        decisionPrompts.every((prompt) => [...prompt.matchAll(/^\[[0-2]\] /gmu)].length === 12)
      ).toBe(true)
      expect(generateText).toHaveBeenCalledTimes(4)

      const snapshot = observer.snapshot()
      expect(snapshot.counters.providerCalls).toBe(4)
      expect(snapshot.counters.providerCalls).toBeLessThanOrEqual(5)
      expect(snapshot.counters.repositoryCalls).toBeLessThanOrEqual(64)
      expect(snapshot.counters.materializedRows).toBeLessThanOrEqual(72)
    } finally {
      await presenter.dispose()
    }
  })

  it('prewarms only eight of 100 shared-model agents and warms the provider once', async () => {
    vi.useFakeTimers()
    const repo = createFakeRepository()
    const observer = createMemoryPerfObserver(true)
    for (const [index, agent] of buildAgentFixture(100).entries()) {
      repo.insert({
        id: `${agent.id}-memory`,
        agentId: agent.id,
        kind: 'semantic',
        content: `active memory ${index}`,
        status: 'pending_embedding',
        createdAt: index + 1
      })
      repo.updateStatus(`${agent.id}-memory`, 'embedded', {
        embeddingId: `${agent.id}-memory`,
        embeddingDim: 4,
        embeddingModel: 'shared-provider:shared-model'
      })
      repo.recordAccess(`${agent.id}-memory`, index + 1)
    }
    const getEmbeddings = vi.fn(async (_providerId: string, _modelId: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const createVectorStore = vi.fn(async (agentId: string) => {
      const store = new FakeVectorStore()
      store.vectors.set(
        `${agentId}-memory`,
        textToVector(`active memory ${Number(agentId.slice(6))}`)
      )
      return store
    })
    const presenter = new MemoryPresenter({
      executeWithRateLimit: async () => undefined,
      repository: repo,
      perfObserver: observer,
      resolveAgentConfig: () => SHARED_MODEL_CONFIG,
      getEmbeddings,
      getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
      generateText: async () => '',
      createVectorStore,
      resetVectorStore: async () => undefined
    })

    try {
      presenter.warmActiveAgents()
      await vi.advanceTimersByTimeAsync(20_000)
      await flushMicrotasks()

      expect(createVectorStore).toHaveBeenCalledTimes(8)
      expect(getEmbeddings).toHaveBeenCalledTimes(1)
      expect(observer.snapshot()).toMatchObject({
        counters: { providerCalls: 1 },
        highWaterMarks: { openStores: 8 }
      })
    } finally {
      await presenter.dispose()
    }
  })
})
