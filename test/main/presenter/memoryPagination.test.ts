import { describe, expect, it } from 'vitest'

import { enabledConfig, makePresenter } from './fakes/memoryFakes'

describe('MemoryPresenter management pagination', () => {
  it('uses a stable created-at/id keyset and keeps archived rows in management pages', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    for (const id of ['x', 'y', 'z']) {
      repo.insert({
        id,
        agentId: 'deepchat',
        kind: 'semantic',
        content: `memory ${id}`,
        status: id === 'x' ? 'archived' : 'embedded',
        createdAt: 1000
      })
    }
    repo.insert({
      id: 'older',
      agentId: 'deepchat',
      kind: 'episodic',
      content: 'older memory',
      status: 'embedded',
      createdAt: 900
    })

    const first = presenter.pageMemories('deepchat', null, 2)
    expect(first.rows.map((row) => row.id)).toEqual(['z', 'y'])
    expect(first.nextCursor).toEqual({ createdAt: 1000, id: 'y' })

    const second = presenter.pageMemories('deepchat', first.nextCursor, 2)
    expect(second.rows.map((row) => row.id)).toEqual(['x', 'older'])
    expect(second.rows[0].status).toBe('archived')
    expect(second.nextCursor).toBeNull()
  })

  it('excludes internal, superseded, and conflicted rows from management pages', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'visible',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'visible',
      status: 'embedded'
    })
    repo.insert({
      id: 'persona',
      agentId: 'deepchat',
      kind: 'persona',
      content: 'persona',
      status: 'fts_only'
    })
    repo.insert({
      id: 'working',
      agentId: 'deepchat',
      kind: 'working',
      content: 'working',
      status: 'fts_only'
    })
    repo.insert({
      id: 'conflicted',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'conflicted',
      status: 'conflicted'
    })
    repo.insert({
      id: 'superseded',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'superseded',
      status: 'embedded'
    })
    repo.markSuperseded('superseded', 'visible')

    expect(presenter.pageMemories('deepchat', null, 100).rows.map((row) => row.id)).toEqual([
      'visible'
    ])
  })
})
