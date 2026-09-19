import { describe, expect, it } from 'vitest'

import { createFakeRepository, FakeAuditRepository } from './support/memoryFakes'
import { createCapabilityFragment, createMemoryServiceHarness } from './serviceHarness'

describe('memory repository fakes', () => {
  it('matches AgentMemoryTable list limit lower-clamp behavior without an upper cap', () => {
    const repo = createFakeRepository()
    const harness = createMemoryServiceHarness({
      read: createCapabilityFragment(repo, ['getById', 'listByAgent']),
      mutation: createCapabilityFragment(repo, ['insertClaimUnlessTombstoned'])
    })
    const repository = Object.assign({}, harness.compose(['read']), harness.compose(['mutation']))
    for (let index = 0; index < 3; index += 1) {
      repository.insertClaimUnlessTombstoned({
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
    repo.seedLegacyStatus('current', 'embedded', {
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
    repo.seedLegacyStatus('wrong-dim', 'embedded', {
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
    repo.seedLegacyStatus('persona', 'embedded', {
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
    repo.seedLegacyStatus('working', 'embedded', {
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
    repo.seedLegacyStatus('superseded', 'embedded', {
      embeddingId: 'superseded',
      embeddingDim: 8,
      embeddingModel: 'legacy:m'
    })
    repo.seedSupersededBy(superseded.id, 'persona')

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
    repo.seedSupersededBy(superseded.id, 'active')
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

  it('matches AgentMemoryTable pending-clear bookkeeping fences', () => {
    const repo = createFakeRepository()
    for (const id of ['access', 'decay', 'confidence', 'consolidated']) {
      repo.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: `${id} claim`
      })
    }
    repo.insert({
      id: 'other-agent',
      agentId: 'b',
      kind: 'semantic',
      content: 'other agent claim'
    })
    const before = new Map(
      ['access', 'decay', 'confidence', 'consolidated'].map((id) => [id, { ...repo.getById(id)! }])
    )

    repo.beginMemoryClear('a', 2_000)
    repo.recordAccessBatch(['access', 'other-agent'], 3_000)
    repo.updateDecayScore('decay', 0.25, 3_000)
    repo.setConfidence('confidence', 0.9)
    repo.setLastConsolidatedAt('consolidated', 3_000)

    for (const [id, row] of before) {
      expect(repo.getById(id)).toEqual(row)
    }
    expect(repo.getById('other-agent')).toMatchObject({
      last_accessed: 3_000,
      access_count: 1
    })
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
    repo.seedLegacyStatus('same-time-old', 'embedded', {
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
    repo.seedLegacyStatus('same-time-current', 'embedded', {
      embeddingId: 'same-time-current',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })

    expect(repo.getCurrentEmbeddingDimension('a', 'p:m')).toBe(4)
  })

  it('matches AgentMemoryTable exact-forgetting tombstone behavior', () => {
    const repo = createFakeRepository()
    const claim = repo.insert({
      id: 'forgotten',
      agentId: 'a',
      kind: 'semantic',
      content: '  private   fact ',
      provenanceKey: 'private-source'
    })

    expect(
      repo.tombstoneAndDelete({
        agentId: 'a',
        id: claim.id,
        expectedRevision: claim.decision_revision,
        createdAt: 1_000
      })
    ).toMatchObject({ id: claim.id })
    expect(repo.tombstones.size).toBe(2)
    expect(JSON.stringify([...repo.tombstones.values()])).not.toContain('private fact')
    expect(JSON.stringify([...repo.tombstones.values()])).not.toContain('private-source')
    expect(
      repo.insertClaimUnlessTombstoned({
        id: 'replay',
        agentId: 'a',
        kind: 'semantic',
        content: 'private fact',
        provenanceKey: 'new-source'
      })
    ).toBeNull()
    expect(
      repo.insertClaimUnlessTombstoned({
        id: 'other-agent',
        agentId: 'b',
        kind: 'semantic',
        content: 'private fact',
        provenanceKey: 'private-source'
      })
    ).toMatchObject({ id: 'other-agent' })

    expect(repo.retireAgentMemoryNamespace('a')).toBe(0)
    expect(repo.tombstones.size).toBe(0)
    expect(
      repo.insertClaimUnlessTombstoned({
        id: 'after-retirement',
        agentId: 'a',
        kind: 'semantic',
        content: 'private fact',
        provenanceKey: 'new-source'
      })
    ).toMatchObject({ id: 'after-retirement' })
  })

  it('matches AgentMemoryTable explicit relearn behavior', () => {
    const repo = createFakeRepository()
    const claim = repo.insert({
      id: 'forgotten',
      agentId: 'a',
      kind: 'semantic',
      content: 'private fact',
      provenanceKey: 'private-source'
    })
    repo.tombstoneAndDelete({
      agentId: 'a',
      id: claim.id,
      expectedRevision: claim.decision_revision,
      createdAt: 1_000
    })

    expect(
      repo.insertExplicitlyReauthorizedClaim({
        id: 'unrelated',
        agentId: 'a',
        kind: 'semantic',
        content: 'unrelated fact',
        provenanceKey: 'unrelated-source'
      })
    ).toBeNull()
    expect(repo.tombstones.size).toBe(2)
    expect(
      repo.insertExplicitlyReauthorizedClaim({
        id: 'reauthorized',
        agentId: 'a',
        kind: 'semantic',
        content: ' private   fact ',
        provenanceKey: 'private-source'
      })
    ).toMatchObject({ id: 'reauthorized' })
    expect(repo.tombstones.size).toBe(0)
  })

  it('restricts runtime raw mutations to internal memory kinds', () => {
    const repo = createFakeRepository()
    expect(() =>
      repo.insertInternalMemory({
        id: 'invalid-internal',
        agentId: 'a',
        kind: 'semantic',
        content: 'user claim'
      } as unknown as Parameters<typeof repo.insertInternalMemory>[0])
    ).toThrow(/unsupported internal memory kind/)
    const claim = repo.insert({
      id: 'claim',
      agentId: 'a',
      kind: 'semantic',
      content: 'user claim'
    })
    const working = repo.insertInternalMemory({
      id: 'working',
      agentId: 'a',
      kind: 'working',
      content: 'working projection'
    })

    expect(repo.deleteInternalMemory('a', claim.id)).toBe(false)
    expect(repo.deleteInternalMemory('other', working.id)).toBe(false)
    expect(repo.deleteInternalMemory('a', working.id)).toBe(true)
    expect(repo.getById(claim.id)).toBeDefined()
  })

  it('matches durable lineage and generation-checked dirty work behavior', () => {
    const repo = createFakeRepository()
    const parent = repo.insert({
      id: 'parent',
      agentId: 'a',
      kind: 'semantic',
      content: 'source claim',
      status: 'embedded',
      createdAt: 1_000
    })
    repo.insert({
      id: 'child',
      agentId: 'a',
      kind: 'reflection',
      content: 'derived claim',
      createdAt: 1_100
    })
    const edge = {
      agentId: 'a',
      parentMemoryId: parent.id,
      childMemoryId: 'child',
      derivationKind: 'reflection' as const,
      createdAt: 1_100
    }

    expect(
      repo.insertDerivations([
        edge,
        edge,
        {
          ...edge,
          parentMemoryId: 'child'
        }
      ])
    ).toBe(1)
    expect(repo.listDerivationsByChild('a', 'child')).toHaveLength(1)
    const staleSeed = repo.listDirtySeeds('a', 10)[0]
    expect(
      repo.updateUserMetadataIfRevision({
        agentId: 'a',
        id: parent.id,
        expectedRevision: parent.decision_revision,
        importance: 0.9,
        lastAccessedAt: 2_000
      })
    ).toBe(true)
    const currentSeed = repo.listDirtySeeds('a', 10).find((seed) => seed.memoryId === parent.id)!
    expect(currentSeed.generation).toBe(staleSeed.generation + 1)
    expect(repo.deferDirtySeeds('a', [staleSeed], 2_500)).toBe(0)
    expect(repo.deferDirtySeeds('a', [currentSeed], 2_500)).toBe(1)
    expect(repo.listDirtySeeds('a', 10).find((seed) => seed.memoryId === parent.id)).toEqual({
      ...currentSeed,
      enqueuedAt: 2_500
    })
    expect(repo.settleDirtySeeds('a', [staleSeed])).toBe(0)
    expect(repo.settleDirtySeeds('a', [currentSeed])).toBe(1)

    repo.delete(parent.id)
    expect(repo.listDerivationsByParent('a', parent.id)).toHaveLength(1)
    expect(repo.countDirtySeeds('a')).toBe(2)
    expect(repo.retireAgentMemoryNamespace('a')).toBe(1)
    expect(repo.listDerivationsByChild('a', 'child')).toEqual([])
    expect(repo.countDirtySeeds('a')).toBe(0)
  })

  it('rolls back claims, tombstones, lineage, and dirty work together', () => {
    const repo = createFakeRepository()
    const claim = repo.insert({
      id: 'claim',
      agentId: 'a',
      kind: 'semantic',
      content: 'source claim',
      provenanceKey: 'source',
      createdAt: 1_000
    })
    const initialSeed = repo.listDirtySeeds('a', 10)[0]

    expect(() =>
      repo.runInTransaction(() => {
        repo.insertDerivations([
          {
            agentId: 'a',
            parentMemoryId: claim.id,
            childMemoryId: 'derived-claim',
            derivationKind: 'manual_edit',
            createdAt: 2_000
          }
        ])
        repo.tombstoneAndDelete({
          agentId: 'a',
          id: claim.id,
          expectedRevision: claim.decision_revision,
          createdAt: 2_000
        })
        throw new Error('rollback')
      })
    ).toThrow('rollback')

    expect(repo.getById(claim.id)).toEqual(claim)
    expect(repo.tombstones.size).toBe(0)
    expect(repo.listDerivationsByChild('a', claim.id)).toEqual([])
    expect(repo.listDirtySeeds('a', 10)).toEqual([initialSeed])
  })

  it('matches AgentMemoryAuditTable list limit defaults and caps', () => {
    const auditRepo = new FakeAuditRepository()
    for (let index = 0; index < 505; index += 1) {
      auditRepo.insert({
        id: `audit-${index}`,
        agentId: 'a',
        eventType: 'memory/test',
        actorType: 'runtime',
        status: 'completed',
        createdAt: index
      })
    }

    expect(auditRepo.listByAgent('a')).toHaveLength(100)
    expect(auditRepo.listByAgent('a', { limit: 0 })).toHaveLength(1)
    expect(auditRepo.listByAgent('a', { limit: 999 })).toHaveLength(500)
  })
})
