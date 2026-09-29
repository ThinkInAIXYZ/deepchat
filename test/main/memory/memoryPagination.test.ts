import { describe, expect, it } from 'vitest'

import { enabledConfig, makePresenter } from './support/memoryFakes'

describe('MemoryService management pagination', () => {
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
    expect(second.rows[0].lifecycle_state).toBe('archived')
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
    repo.seedSupersededBy('superseded', 'visible')

    expect(presenter.pageMemories('deepchat', null, 100).rows.map((row) => row.id)).toEqual([
      'visible'
    ])
  })

  it('keeps unavailable lineage sources nullable and rejects isolated or clearing roots', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    for (const [id, agentId] of [
      ['root', 'a'],
      ['visible-parent', 'a'],
      ['hidden-parent', 'a'],
      ['foreign-root', 'other']
    ] as const) {
      repo.insert({ id, agentId, kind: 'semantic', content: id, status: 'embedded' })
    }
    repo.seedSupersededBy('hidden-parent', 'visible-parent')
    repo.insertDerivations([
      {
        agentId: 'a',
        parentMemoryId: 'hidden-parent',
        childMemoryId: 'root',
        derivationKind: 'reflection',
        createdAt: 10
      },
      {
        agentId: 'a',
        parentMemoryId: 'visible-parent',
        childMemoryId: 'root',
        derivationKind: 'merge',
        createdAt: 20
      }
    ])

    expect(presenter.getLineage('a', 'root', 'parents', null, 20)).toEqual({
      items: [
        expect.objectContaining({ memoryId: 'hidden-parent', memory: null }),
        expect.objectContaining({
          memoryId: 'visible-parent',
          memory: expect.objectContaining({ id: 'visible-parent' })
        })
      ],
      nextCursor: null
    })
    expect(presenter.getLineage('a', 'foreign-root', 'parents', null, 20)).toBeNull()
    expect(presenter.getLineage('other', 'root', 'parents', null, 20)).toBeNull()

    const first = presenter.getLineage('a', 'root', 'parents', null, 1)!
    expect(first.items.map((item) => item.memoryId)).toEqual(['hidden-parent'])
    expect(first.nextCursor).toEqual({
      createdAt: 10,
      memoryId: 'hidden-parent',
      derivationKind: 'reflection'
    })
    repo.delete('visible-parent')
    expect(presenter.getLineage('a', 'root', 'parents', first.nextCursor, 1)).toEqual({
      items: [expect.objectContaining({ memoryId: 'visible-parent', memory: null })],
      nextCursor: null
    })

    repo.beginMemoryClear('a', 100)
    const { presenter: clearingPresenter } = makePresenter(enabledConfig, repo)
    expect(clearingPresenter.getLineage('a', 'root', 'parents', null, 20)).toBeNull()
  })

  it('pages only direct reflection impact and preserves sparse-page cursors and isolation', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    for (const [id, agentId] of [
      ['source', 'a'],
      ['hidden', 'a'],
      ['visible', 'a'],
      ['merge-child', 'a'],
      ['grandchild', 'a'],
      ['foreign', 'other']
    ] as const) {
      repo.insert({
        id,
        agentId,
        kind: id === 'source' ? 'semantic' : 'reflection',
        content: id,
        status: 'embedded'
      })
    }
    repo.seedArchived('hidden')
    repo.insertDerivations([
      {
        agentId: 'a',
        parentMemoryId: 'source',
        childMemoryId: 'hidden',
        derivationKind: 'reflection',
        createdAt: 10
      },
      {
        agentId: 'a',
        parentMemoryId: 'source',
        childMemoryId: 'visible',
        derivationKind: 'reflection',
        createdAt: 20
      },
      {
        agentId: 'a',
        parentMemoryId: 'source',
        childMemoryId: 'merge-child',
        derivationKind: 'merge',
        createdAt: 15
      },
      {
        agentId: 'a',
        parentMemoryId: 'visible',
        childMemoryId: 'grandchild',
        derivationKind: 'reflection',
        createdAt: 30
      },
      {
        agentId: 'other',
        parentMemoryId: 'source',
        childMemoryId: 'foreign',
        derivationKind: 'reflection',
        createdAt: 40
      }
    ])

    const first = presenter.getImpact('a', 'source', null, 1)!
    expect(first.items).toEqual([])
    expect(first.nextCursor).toEqual({
      createdAt: 10,
      memoryId: 'hidden',
      derivationKind: 'reflection'
    })
    expect(presenter.getImpact('a', 'source', first.nextCursor, 1)).toEqual({
      items: [
        {
          memory: expect.objectContaining({ id: 'visible' }),
          revision: repo.getById('visible')?.decision_revision
        }
      ],
      nextCursor: null
    })
    expect(presenter.getImpact('other', 'source', null, 20)).toBeNull()
  })
})
