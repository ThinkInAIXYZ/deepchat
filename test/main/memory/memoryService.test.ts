import { describe, expect, it } from 'vitest'

import { createEmptyMemoryHealth } from '@shared/contracts/routes'
import { enabledConfig, makePresenter } from './support/memoryFakes'
import { createFakeRepository, FakeAuditRepository, FakeVectorStore } from './support/memoryFakes'
import { MemoryService } from '@/memory'

describe('MemoryService facade', () => {
  it('composes the required runtime health contract for an empty Agent', async () => {
    const { presenter } = makePresenter(enabledConfig)

    expect(presenter.getHealth('deepchat')).toEqual(createEmptyMemoryHealth())
    await presenter.dispose()
  })

  it('delegates a write, embedding drain, recall, and cleanup across services', async () => {
    const { presenter } = makePresenter(enabledConfig)
    const [memoryId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'Redis listens on port 6379', importance: 0.8 }],
      { agentId: 'deepchat' }
    )

    await presenter.processPendingEmbeddings('deepchat')
    const recalled = await presenter.recall('deepchat', 'redis port', 5)
    expect(recalled.map((item) => item.id)).toContain(memoryId)
    expect(await presenter.clearMemories('deepchat')).toBe(1)
    expect(presenter.getStatus('deepchat').total).toBe(0)
    await presenter.dispose()
  })

  it('keeps dispose idempotent at the facade boundary', async () => {
    const { presenter } = makePresenter(enabledConfig)

    await presenter.dispose()
    await expect(presenter.dispose()).resolves.toBeUndefined()
  })

  it('does not scan or repair legacy shadow during presenter startup', async () => {
    const repository = createFakeRepository()
    const row = repository.insert({
      id: 'mismatch',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'private content'
    })
    repository.markPendingEmbeddingsReady('deepchat', [
      {
        id: row.id,
        expectedRevision: row.decision_revision,
        embeddingId: 'mismatch-vector',
        embeddingDim: 2,
        embeddingModel: 'test:model'
      }
    ])
    row.status = 'error'
    const auditRepository = new FakeAuditRepository()
    const presenter = new MemoryService({
      repository,
      auditRepository,
      resolveAgentConfig: () => enabledConfig,
      executeWithRateLimit: async () => undefined,
      getEmbeddings: async () => [],
      getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
      generateText: async () => '',
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })

    expect(row.status).toBe('error')
    expect(repository.countLegacyShadowMismatches()).toBe(1)
    const audits = auditRepository.listByAgent('deepchat', {
      eventType: 'memory/state_shadow_repair'
    })
    expect(audits).toHaveLength(0)
    await presenter.dispose()
  })
})
