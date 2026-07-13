import { describe, expect, it, vi } from 'vitest'

import {
  createCompositeMemoryPerfObserver,
  MemoryDiagnosticsCollector
} from '@/presenter/memoryPresenter/infra/diagnostics/memoryDiagnosticsCollector'

const recallSample = (duration: number) => ({
  purpose: 'recall' as const,
  latencyMs: { total: duration },
  ftsCandidates: 1,
  vectorCandidates: 2,
  selected: 1,
  outcome: 'completed' as const,
  degradations: []
})

describe('MemoryDiagnosticsCollector', () => {
  it('uses nearest-rank percentiles over a 256-sample bounded ring', () => {
    const collector = new MemoryDiagnosticsCollector()
    for (let value = 1; value <= 257; value += 1) {
      collector.recordRecall('agent', recallSample(value))
    }
    expect(collector.snapshot('agent').agent.retrieval.recall.latencyMs.total).toEqual({
      samples: 256,
      p50: 129,
      p95: 245,
      max: 257
    })
  })

  it('keeps 10,000 recorded samples bounded by the configured ring capacity', () => {
    const collector = new MemoryDiagnosticsCollector()
    for (let value = 1; value <= 10_000; value += 1) {
      collector.recordRecall('agent', recallSample(value))
    }

    expect(collector.snapshot('agent').agent.retrieval.recall.latencyMs.total).toEqual({
      samples: 256,
      p50: 9_872,
      p95: 9_988,
      max: 10_000
    })
  })

  it('does not run a TTL sweep for every hot-path record', () => {
    const now = vi.fn(() => 1)
    const collector = new MemoryDiagnosticsCollector({ now })

    for (let index = 0; index < 10; index += 1) {
      collector.recordRecall('agent', recallSample(index))
    }

    expect(now).toHaveBeenCalledTimes(10)
  })

  it('evicts per-Agent state by LRU without changing process gauges', () => {
    let now = 1
    const collector = new MemoryDiagnosticsCollector({ now: () => now, maxAgents: 2 })
    collector.recordRecall('a', recallSample(1))
    now += 1
    collector.recordRecall('b', recallSample(2))
    collector.observeVectorResources(3, 2)
    now += 1
    collector.recordRecall('a', recallSample(3))
    now += 1
    collector.recordRecall('c', recallSample(4))

    const evicted = collector.snapshot('b')
    expect(evicted.agent.retrieval.recall.latencyMs.total.samples).toBe(0)
    expect(evicted.process.vector).toMatchObject({ openStores: 3, activeLeases: 2 })
  })

  it('evicts the least-recently-used Agent when the default 65th Agent is recorded', () => {
    let now = 0
    const collector = new MemoryDiagnosticsCollector({ now: () => now })
    for (let index = 0; index < 65; index += 1) {
      now = index
      collector.recordRecall(`agent-${index}`, recallSample(index + 1))
    }

    expect(collector.snapshot('agent-0').agent.retrieval.recall.latencyMs.total.samples).toBe(0)
    expect(collector.snapshot('agent-64').agent.retrieval.recall.latencyMs.total.samples).toBe(1)
  })

  it.each([Number.NaN, 0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'uses the default bounds for invalid capacity %s',
    (capacity) => {
      const agentCollector = new MemoryDiagnosticsCollector({ maxAgents: capacity })
      for (let index = 0; index < 65; index += 1) {
        agentCollector.recordRecall(`agent-${index}`, recallSample(index + 1))
      }
      expect(
        agentCollector.snapshot('agent-0').agent.retrieval.recall.latencyMs.total.samples
      ).toBe(0)

      const sampleCollector = new MemoryDiagnosticsCollector({ sampleCapacity: capacity })
      for (let value = 1; value <= 257; value += 1) {
        sampleCollector.recordRecall('agent', recallSample(value))
      }
      expect(sampleCollector.snapshot('agent').agent.retrieval.recall.latencyMs.total.samples).toBe(
        256
      )
    }
  )

  it('floors positive fractional capacities before enforcing their bounds', () => {
    const collector = new MemoryDiagnosticsCollector({ maxAgents: 2.9, sampleCapacity: 2.9 })
    collector.recordRecall('a', recallSample(1))
    collector.recordRecall('b', recallSample(2))
    collector.recordRecall('c', recallSample(3))

    expect(collector.snapshot('a').agent.retrieval.recall.latencyMs.total.samples).toBe(0)
    expect(collector.snapshot('c').agent.retrieval.recall.latencyMs.total).toEqual({
      samples: 1,
      p50: 3,
      p95: 3,
      max: 3
    })

    collector.recordRecall('c', recallSample(4))
    collector.recordRecall('c', recallSample(5))
    expect(collector.snapshot('c').agent.retrieval.recall.latencyMs.total).toEqual({
      samples: 2,
      p50: 4,
      p95: 5,
      max: 5
    })
  })

  it('expires, cleans, and disposes state deterministically', () => {
    let now = 0
    const collector = new MemoryDiagnosticsCollector({ now: () => now, agentTtlMs: 10 })
    collector.recordRecall('agent', recallSample(1))
    collector.observeProviderQueue(4)
    now = 11
    expect(collector.snapshot('agent').agent.retrieval.recall.latencyMs.total.samples).toBe(0)
    expect(collector.snapshot('agent').process.providerAdmission.queued).toBe(4)
    collector.cleanupAgent('agent')
    collector.clear()
    expect(collector.snapshot('agent').process.providerAdmission.queued).toBe(0)
  })

  it('computes extraction queue age at snapshot time', () => {
    let now = 100
    const collector = new MemoryDiagnosticsCollector({ now: () => now })
    collector.observeExtractionQueue(2, 90)
    now = 145
    expect(collector.snapshot('agent').process.extractionQueue).toEqual({
      depth: 2,
      oldestQueuedAgeMs: 55
    })
  })

  it('returns immutable snapshots containing only bounded diagnostic fields', () => {
    const collector = new MemoryDiagnosticsCollector()
    collector.recordRecall('agent', recallSample(10))
    const first = collector.snapshot('agent')
    first.agent.retrieval.recall.outcomeCounts.completed = 99
    const serialized = JSON.stringify(collector.snapshot('agent'))
    expect(serialized).not.toContain('fixture-secret-marker')
    expect(collector.snapshot('agent').agent.retrieval.recall.outcomeCounts.completed).toBe(1)
  })

  it('isolates failing observers from the production observation', () => {
    const healthy = { increment: vi.fn(), observe: vi.fn() }
    const composite = createCompositeMemoryPerfObserver([
      {
        increment: () => {
          throw new Error('counter')
        },
        observe: () => {
          throw new Error('gauge')
        }
      },
      healthy
    ])
    expect(() => composite.increment('providerCalls')).not.toThrow()
    expect(() => composite.observe('openStores', 2)).not.toThrow()
    expect(healthy.increment).toHaveBeenCalledOnce()
    expect(healthy.observe).toHaveBeenCalledOnce()
  })

  it('swallows recorder input failures without changing the prior snapshot', () => {
    const collector = new MemoryDiagnosticsCollector()
    collector.recordRecall('agent', recallSample(1))
    const broken = {
      get latencyMs(): { total: number } {
        throw new Error('diagnostics input failure')
      },
      ftsCandidates: 0,
      vectorCandidates: 0,
      selected: 0,
      purpose: 'recall' as const,
      outcome: 'completed' as const,
      degradations: []
    }

    expect(() => collector.recordRecall('agent', broken)).not.toThrow()
    expect(collector.snapshot('agent').agent.retrieval.recall.latencyMs.total.samples).toBe(1)
  })
})
