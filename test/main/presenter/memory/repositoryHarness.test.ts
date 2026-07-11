import { describe, expect, it } from 'vitest'

import { createFakeRepository, FakeAuditRepository } from '../fakes/memoryFakes'
import { createCapabilityFragment, createMemoryServiceHarness } from './serviceHarness'

describe('memory repository fakes', () => {
  it('matches AgentMemoryTable list limit lower-clamp behavior without an upper cap', () => {
    const repo = createFakeRepository()
    const harness = createMemoryServiceHarness({
      read: createCapabilityFragment(repo, ['getById', 'listByAgent']),
      mutation: createCapabilityFragment(repo, ['insert'])
    })
    const repository = Object.assign({}, harness.compose(['read']), harness.compose(['mutation']))
    for (let index = 0; index < 3; index += 1) {
      repository.insert({
        id: `m${index}`,
        agentId: 'a',
        kind: 'semantic',
        content: `memory ${index}`,
        status: 'embedded',
        createdAt: index
      })
    }

    expect(repository.listByAgent('a')).toHaveLength(3)
    expect(repository.listByAgent('a', { limit: 0 })).toHaveLength(1)
    expect(repository.listByAgent('a', { limit: -10 })).toHaveLength(1)
    expect(repository.listByAgent('a', { limit: 2.8 })).toHaveLength(2)
    expect(repository.getById('m2')?.content).toBe('memory 2')
  })

  it('matches AgentMemoryTable targeted embedding metadata queries', () => {
    const repo = createFakeRepository()
    repo.insert({
      id: 'current',
      agentId: 'a',
      kind: 'semantic',
      content: 'current vector',
      createdAt: 2000
    })
    repo.updateStatus('current', 'embedded', {
      embeddingId: 'current',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    repo.insert({
      id: 'wrong-dim',
      agentId: 'a',
      kind: 'semantic',
      content: 'wrong dimension',
      createdAt: 1000
    })
    repo.updateStatus('wrong-dim', 'embedded', {
      embeddingId: 'wrong-dim',
      embeddingDim: 8,
      embeddingModel: 'p:m'
    })
    repo.insert({
      id: 'persona',
      agentId: 'excluded',
      kind: 'persona',
      content: 'persona'
    })
    repo.updateStatus('persona', 'embedded', {
      embeddingId: 'persona',
      embeddingDim: 8,
      embeddingModel: 'legacy:m'
    })
    repo.insert({
      id: 'working',
      agentId: 'excluded',
      kind: 'working',
      content: 'working'
    })
    repo.updateStatus('working', 'embedded', {
      embeddingId: 'working',
      embeddingDim: 8,
      embeddingModel: 'legacy:m'
    })
    const superseded = repo.insert({
      id: 'superseded',
      agentId: 'excluded',
      kind: 'semantic',
      content: 'superseded'
    })
    repo.updateStatus('superseded', 'embedded', {
      embeddingId: 'superseded',
      embeddingDim: 8,
      embeddingModel: 'legacy:m'
    })
    repo.markSuperseded(superseded.id, 'persona')

    expect(repo.getCurrentEmbeddingDimension('a', 'p:m')).toBe(4)
    expect(repo.hasStaleEmbeddings('a', 4, 'p:m')).toBe(true)
    expect(repo.hasStaleEmbeddings('a', 8, 'legacy:m')).toBe(true)
    expect(repo.getCurrentEmbeddingDimension('a', 'missing:m')).toBeNull()
    expect(repo.getCurrentEmbeddingDimension('excluded', 'legacy:m')).toBeNull()
    expect(repo.hasStaleEmbeddings('excluded', 4, 'p:m')).toBe(false)
  })

  it('matches AgentMemoryTable health category and top-accessed filters', () => {
    const repo = createFakeRepository()
    repo.insert({
      id: 'active',
      agentId: 'a',
      kind: 'semantic',
      category: 'project_fact',
      content: 'active',
      status: 'embedded'
    })
    repo.insert({
      id: 'legacy-category',
      agentId: 'a',
      kind: 'semantic',
      content: 'legacy',
      status: 'embedded'
    })
    repo.rows.get('legacy-category')!.category = 'legacy_unknown'
    repo.insert({
      id: 'archived',
      agentId: 'a',
      kind: 'semantic',
      content: 'archived',
      status: 'archived'
    })
    repo.insert({
      id: 'conflicted',
      agentId: 'a',
      kind: 'semantic',
      content: 'conflicted',
      status: 'conflicted'
    })
    const superseded = repo.insert({
      id: 'superseded',
      agentId: 'a',
      kind: 'semantic',
      content: 'superseded',
      status: 'embedded'
    })
    repo.markSuperseded(superseded.id, 'active')
    repo.insert({
      id: 'working',
      agentId: 'a',
      kind: 'working',
      content: 'working',
      status: 'fts_only'
    })

    for (const id of ['active', 'archived', 'conflicted', 'superseded', 'working']) {
      repo.recordAccess(id, 1000)
    }

    expect(repo.getHealthStats('a').byCategory.uncategorized).toBe(5)
    expect(repo.listTopAccessed('a', 5).map((row) => row.id)).toEqual(['active'])
  })

  it('matches AgentMemoryTable current dimension tie-break for equal timestamps', () => {
    const repo = createFakeRepository()
    repo.insert({
      id: 'same-time-old',
      agentId: 'a',
      kind: 'semantic',
      content: 'older same timestamp',
      createdAt: 3000
    })
    repo.updateStatus('same-time-old', 'embedded', {
      embeddingId: 'same-time-old',
      embeddingDim: 8,
      embeddingModel: 'p:m'
    })
    repo.insert({
      id: 'same-time-current',
      agentId: 'a',
      kind: 'semantic',
      content: 'newer same timestamp',
      createdAt: 3000
    })
    repo.updateStatus('same-time-current', 'embedded', {
      embeddingId: 'same-time-current',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })

    expect(repo.getCurrentEmbeddingDimension('a', 'p:m')).toBe(4)
  })

  it('matches AgentMemoryAuditTable list limit defaults and caps', () => {
    const auditRepo = new FakeAuditRepository()
    for (let index = 0; index < 505; index += 1) {
      auditRepo.insert({
        id: `audit-${index}`,
        agentId: 'a',
        eventType: 'memory/test',
        actorType: 'system',
        status: 'completed',
        createdAt: index
      })
    }

    expect(auditRepo.listByAgent('a')).toHaveLength(100)
    expect(auditRepo.listByAgent('a', { limit: 0 })).toHaveLength(1)
    expect(auditRepo.listByAgent('a', { limit: 999 })).toHaveLength(500)
  })
})
