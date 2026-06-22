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
    const accessSpy = vi.spyOn(repo, 'recordAccess')

    await presenter.searchMemories('deepchat', 'redis')
    expect(accessSpy).not.toHaveBeenCalled()

    // Positive control: the recall path is the one that bumps access_count.
    await presenter.recall('deepchat', 'redis')
    expect(accessSpy).toHaveBeenCalled()
  })

  it('caps the result count to limit without widening topK', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert(seed('redis caching notes', 'm1'))
    repo.insert(seed('redis cluster setup', 'm2'))
    repo.insert(seed('redis persistence tuning', 'm3'))

    const limited = await presenter.searchMemories('deepchat', 'redis', { limit: 2 })
    expect(limited).toHaveLength(2)

    const all = await presenter.searchMemories('deepchat', 'redis')
    expect(all.length).toBeGreaterThanOrEqual(3)
  })

  it('returns nothing for an empty query', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert(seed('the user prefers redis', 'm1'))
    expect(await presenter.searchMemories('deepchat', '   ')).toEqual([])
  })
})
