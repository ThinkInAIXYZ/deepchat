import { describe, expect, it, vi } from 'vitest'

import { MemoryPresenter } from '@/presenter/memoryPresenter'
import { createFakeRepository, FakeVectorStore } from '../fakes/memoryFakes'

describe('MaintenanceService diagnostics', () => {
  it('records a missing-model heavy pass as skipped', async () => {
    const repository = createFakeRepository()
    const presenter = new MemoryPresenter({
      repository,
      executeWithRateLimit: vi.fn(async () => undefined),
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      resolveAgentDefaultModel: () => null,
      getEmbeddings: async () => [],
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })

    await presenter.runConsolidationPass('agent', Date.now())

    const maintenance = presenter.getHealth('agent').runtime.agent.maintenance
    expect(maintenance.skipped).toBe(1)
    expect(maintenance.heavyDurationMs.samples).toBe(1)
    expect(maintenance.llmCalls).toBe(0)
    await presenter.dispose()
  })
})
