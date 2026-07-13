import { describe, expect, it, vi } from 'vitest'

import { enabledConfig, makePresenter } from './fakes/memoryFakes'

function seed(content: string, id: string) {
  return {
    id,
    agentId: 'deepchat',
    kind: 'semantic' as const,
    content,
    status: 'embedded' as const,
    importance: 0.8
  }
}

function seedRedisRange(repo: { insert(input: ReturnType<typeof seed>): unknown }, count: number) {
  for (let i = 0; i < count; i += 1) {
    repo.insert(seed(`redis memory ${String(i).padStart(2, '0')}`, `m${i}`))
  }
}

describe('MemoryPresenter.searchMemories (read-only facade)', () => {
  it('surfaces matching rows with their retrieval score', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert(seed('the user prefers redis', 'm1'))

    const hits = await presenter.searchMemories('deepchat', 'redis')

    expect(hits.map((hit) => hit.row.id)).toContain('m1')
    const hit = hits.find((entry) => entry.row.id === 'm1')
    expect(typeof hit?.score).toBe('number')
    expect(hit?.row.content).toBe('the user prefers redis')
  })

  it('never records access while recall does (browsing must not skew fairness)', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert(seed('the user prefers redis', 'm1'))
    const accessSpy = vi.spyOn(repo, 'recordAccessBatch')

    await presenter.searchMemories('deepchat', 'redis')
    expect(accessSpy).not.toHaveBeenCalled()

    // Positive control: the recall path is the one that bumps access_count.
    await presenter.recall('deepchat', 'redis')
    expect(accessSpy).toHaveBeenCalled()
  })

  it('keeps management search on precise all-term keyword matching', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true })
    repo.insert(seed('redis setup', 'm1'))

    expect(await presenter.searchMemories('deepchat', 'please redis setup')).toEqual([])
    expect(
      (await presenter.recall('deepchat', 'please redis setup')).map((item) => item.id)
    ).toEqual(['m1'])
  })

  it('uses search limit as retrieval depth without changing recall topK', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    seedRedisRange(repo, 20)

    const limited = await presenter.searchMemories('deepchat', 'redis', { limit: 8 })
    expect(limited).toHaveLength(8)

    const recall = await presenter.recall('deepchat', 'redis')
    expect(recall).toHaveLength(6)
  })

  it('defaults management search depth to 50 and clamps direct callers at 100', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    seedRedisRange(repo, 120)

    await expect(presenter.searchMemories('deepchat', 'redis')).resolves.toHaveLength(50)
    await expect(
      presenter.searchMemories('deepchat', 'redis', { limit: 500 })
    ).resolves.toHaveLength(100)
  })

  it('does not let persona rows occupy management search result slots', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    for (let i = 0; i < 20; i += 1) {
      repo.insert({
        id: `persona-${i}`,
        agentId: 'deepchat',
        kind: 'persona',
        content: `redis persona ${i}`,
        status: 'fts_only'
      })
    }
    seedRedisRange(repo, 3)

    const hits = await presenter.searchMemories('deepchat', 'redis', { limit: 3 })

    expect(hits.map((hit) => hit.row.id)).toEqual(['m0', 'm1', 'm2'])
  })

  it('does not prune vectors from the read-only management search path', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis cache' }], {
      agentId: 'deepchat'
    })
    await presenter.processPendingEmbeddings('deepchat')
    repo.seedArchived(id, Date.now())
    const filterPrunable = vi.spyOn(repo, 'filterPrunableVectorRefs')
    const deleteByMemoryIds = vi.spyOn(store, 'deleteByMemoryIds')

    await presenter.searchMemories('deepchat', 'redis')

    expect(filterPrunable).not.toHaveBeenCalled()
    expect(deleteByMemoryIds).not.toHaveBeenCalled()
    expect(store.vectors.has(id)).toBe(true)
  })

  it('returns nothing for an empty query', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert(seed('the user prefers redis', 'm1'))
    expect(await presenter.searchMemories('deepchat', '   ')).toEqual([])
  })
})
