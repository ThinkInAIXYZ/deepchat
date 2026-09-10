import { describe, expect, it, vi } from 'vitest'

import { MemoryRuntimeContext } from '@/memory/context'
import { MaintenanceBudget } from '@/memory/core/maintenanceBudget'
import type { MemoryMaintenanceRowMutationPort } from '@/memory/ports'
import { MergeService } from '@/memory/services/mergeService'
import { createControlledPromise } from './serviceHarness'
import { createFakeRepository, enabledConfig } from './support/memoryFakes'

const now = 100_000
const mergedContent = 'The user prefers Redis for caching.'
const decision = JSON.stringify({ decision: 'UPDATE', targetIndex: 0, mergedContent })

function makeHarness() {
  const repository = createFakeRepository()
  for (const [id, createdAt] of [
    ['older', 100],
    ['newer', 200]
  ] as const) {
    repository.insert({
      id,
      agentId: 'a',
      kind: 'semantic',
      content: `The user uses Redis: ${id}.`,
      createdAt,
      status: 'embedded'
    })
    repository.seedLegacyStatus(id, 'embedded', {
      embeddingId: id,
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
  }
  const policy = { resolveAgentConfig: () => enabledConfig }
  const onMemoryChanged = vi.fn()
  const onAgentMemoryMutated = vi.fn()
  const ctx = new MemoryRuntimeContext({
    policy,
    providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() },
    changeSink: { onMemoryChanged },
    onAgentMemoryMutated
  })
  const ports = {
    ctx,
    repository,
    policy,
    rows: {
      resolveProvenance: vi.fn<MemoryMaintenanceRowMutationPort['resolveProvenance']>(),
      bumpConfidence: vi.fn()
    },
    textGeneration: { generateText: vi.fn(async () => decision) },
    queryNeighborsByMemoryId: vi.fn(async () => [{ memoryId: 'newer', distance: 0.01 }]),
    warmVectorStore: vi.fn(async () => {}),
    syncWorkingMemoryAfterMutation: vi.fn(),
    triggerEmbedding: vi.fn(async () => {})
  }
  const service = new MergeService(ports)
  const budget = new MaintenanceBudget()
  const fence = ctx.captureOperationFence('a')
  return {
    ...ports,
    budget,
    onMemoryChanged,
    onAgentMemoryMutated,
    run: () =>
      service.mergeNearDuplicates('a', now, { providerId: 'llm', modelId: 'chat' }, fence, budget)
  }
}

function expectNoMergeEffects(h: ReturnType<typeof makeHarness>) {
  expect(h.rows.bumpConfidence).not.toHaveBeenCalled()
  expect(h.onAgentMemoryMutated).not.toHaveBeenCalled()
  expect(h.syncWorkingMemoryAfterMutation).not.toHaveBeenCalled()
  expect(h.triggerEmbedding).not.toHaveBeenCalled()
  expect(h.onMemoryChanged).not.toHaveBeenCalled()
  expect(h.repository.listDerivationsByChild('a', 'newer')).toEqual([])
  expect(h.repository.listDerivationsByChild('a', 'older')).toEqual([])
}

describe('MergeService boundary', () => {
  it('settles terminal seeds and defers live seeds when embedding dimensions are unavailable', async () => {
    const h = makeHarness()
    h.repository.rows.get('older')!.lifecycle_state = 'archived'
    vi.spyOn(h.repository, 'getCurrentEmbeddingDimension').mockReturnValue(null)
    const seeds = h.repository.listDirtySeeds('a', 10)
    expect(seeds.map((seed) => seed.memoryId)).toEqual(['older', 'newer'])

    expect(await h.run()).toEqual({ touched: false, calls: 0, failures: 0 })

    expect(h.repository.listDirtySeeds('a', 10)).toEqual([{ ...seeds[1], enqueuedAt: now }])
    expect(h.warmVectorStore).not.toHaveBeenCalled()
    expect(h.textGeneration.generateText).not.toHaveBeenCalled()
    expectNoMergeEffects(h)
  })

  it.each(['warmup', 'neighbors', 'decision'] as const)(
    'preserves queued work and prevents mutation when fenced during %s',
    async (stage) => {
      const h = makeHarness()
      const entered = createControlledPromise<void>()
      const resume = createControlledPromise<void>()
      const pause = async () => {
        entered.resolve()
        await resume.promise
      }
      if (stage === 'warmup') h.warmVectorStore.mockImplementation(pause)
      if (stage === 'neighbors')
        h.queryNeighborsByMemoryId.mockImplementation(async () => {
          await pause()
          return [{ memoryId: 'newer', distance: 0.01 }]
        })
      if (stage === 'decision')
        h.textGeneration.generateText.mockImplementation(async () => {
          await pause()
          return decision
        })
      const seeds = h.repository.listDirtySeeds('a', 10)
      const before = structuredClone([...h.repository.rows.values()])
      const pass = h.run()
      await entered.promise
      h.ctx.invalidateAgentOperations('a')
      resume.resolve()

      expect(await pass).toEqual({
        touched: false,
        calls: stage === 'decision' ? 1 : 0,
        failures: 0
      })
      expect([...h.repository.rows.values()]).toEqual(before)
      expect(h.repository.listDirtySeeds('a', 10)).toEqual(seeds)
      expect(h.textGeneration.generateText).toHaveBeenCalledTimes(stage === 'decision' ? 1 : 0)
      if (stage === 'warmup') expect(h.queryNeighborsByMemoryId).not.toHaveBeenCalled()
      expectNoMergeEffects(h)
    }
  )

  it('rolls back the survivor update when the retired revision conflicts', async () => {
    const h = makeHarness()
    const before = { ...h.repository.getById('newer')! }
    const update = vi.spyOn(h.repository, 'updateUserContentAndInvalidateEmbedding')
    vi.spyOn(h.repository, 'markSupersededIfRevision').mockReturnValue(false)

    expect(await h.run()).toEqual({ touched: false, calls: 1, failures: 0 })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'newer',
        expectedRevision: before.decision_revision,
        content: mergedContent
      })
    )
    expect(h.repository.getById('newer')).toEqual(before)
    expect(h.repository.getById('older')?.superseded_by).toBeNull()
    expect(h.repository.countDirtySeeds('a')).toBe(0)
    expectNoMergeEffects(h)
  })

  it('does not resurrect tombstoned merged content or retire either input', async () => {
    const h = makeHarness()
    const forgotten = h.repository.insert({
      id: 'forgotten',
      agentId: 'a',
      kind: 'semantic',
      content: mergedContent
    })
    h.repository.tombstoneAndDelete({
      agentId: 'a',
      id: forgotten.id,
      expectedRevision: forgotten.decision_revision,
      createdAt: 1
    })
    const retire = vi.spyOn(h.repository, 'markSupersededIfRevision')

    expect(await h.run()).toEqual({ touched: false, calls: 1, failures: 0 })

    expect(retire).not.toHaveBeenCalled()
    expect(h.repository.getById('forgotten')).toBeUndefined()
    for (const id of ['older', 'newer']) {
      expect(h.repository.getById(id)?.content).toBe(`The user uses Redis: ${id}.`)
      expect(h.repository.getById(id)?.superseded_by).toBeNull()
      expect(h.repository.getById(id)?.embedding_state).toBe('ready')
    }
    expect(h.repository.countDirtySeeds('a')).toBe(0)
    expectNoMergeEffects(h)
  })

  it('keeps the provenance owner even when older and emits effects only after commit', async () => {
    const h = makeHarness()
    h.rows.resolveProvenance.mockReturnValue(h.repository.getById('older'))
    h.syncWorkingMemoryAfterMutation.mockImplementation(() => {
      expect(h.repository.getById('older')?.content).toBe(mergedContent)
      expect(h.repository.getById('newer')?.superseded_by).toBe('older')
      expect(h.repository.listDerivationsByChild('a', 'older')).toEqual([
        expect.objectContaining({ parent_memory_id: 'newer', derivation_kind: 'merge' })
      ])
    })

    expect(await h.run()).toEqual({ touched: true, calls: 1, failures: 0 })

    expect(h.repository.getById('older')?.embedding_state).toBe('pending')
    expect(h.rows.bumpConfidence).toHaveBeenCalledExactlyOnceWith('older')
    expect(h.onAgentMemoryMutated).toHaveBeenCalledExactlyOnceWith('a')
    expect(h.syncWorkingMemoryAfterMutation).toHaveBeenCalledExactlyOnceWith('a')
    expect(h.triggerEmbedding).toHaveBeenCalledExactlyOnceWith('a')
    expect(h.onMemoryChanged).toHaveBeenCalledExactlyOnceWith('a', 'extract')
  })
})
