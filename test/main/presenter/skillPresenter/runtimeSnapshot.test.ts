import { describe, expect, it, vi } from 'vitest'
import type { PublishedSkillEntry, SkillMetadata } from '@shared/types/skill'
import { SkillRuntimeSnapshotState } from '@/presenter/skillPresenter/runtimeSnapshot'

function createEntry(name: string): PublishedSkillEntry {
  const metadata: SkillMetadata = {
    name,
    description: name,
    path: `/skills/${name}/SKILL.md`,
    skillRoot: `/skills/${name}`
  }
  return Object.freeze({
    sourceVersion: name,
    availability: 'metadata_only' as const,
    metadata: Object.freeze(metadata),
    allowedTools: Object.freeze([])
  })
}

describe('SkillRuntimeSnapshotState', () => {
  it('keeps the epoch odd until every overlapping publication settles', async () => {
    const state = new SkillRuntimeSnapshotState()
    const onPublished = vi.fn()
    const first = state.beginPublish(onPublished)
    first.update((entries) => entries.set('a', createEntry('a')))
    const settlement = state.settlementPromise
    const second = state.beginPublish(onPublished)
    second.update((entries) => entries.set('b', createEntry('b')))

    expect(state.epoch).toBe(1)
    expect(state.snapshot.epoch).toBe(0)
    expect(state.snapshot.entries.size).toBe(0)
    first.end()
    expect(state.epoch).toBe(1)
    expect(onPublished).not.toHaveBeenCalled()

    second.end()
    await settlement
    expect(state.epoch).toBe(2)
    expect(state.snapshot.epoch).toBe(2)
    expect([...state.snapshot.entries.keys()]).toEqual(['a', 'b'])
    expect(onPublished).toHaveBeenCalledTimes(1)
  })

  it('does not expose mutating map methods from a published snapshot', () => {
    const state = new SkillRuntimeSnapshotState()
    state.replace(new Map([['a', createEntry('a')]]), () => {})
    const entries = state.snapshot.entries as Map<string, PublishedSkillEntry>

    expect(() => entries.set('b', createEntry('b'))).toThrow(TypeError)
    expect(() => entries.delete('a')).toThrow(TypeError)
    expect([...state.snapshot.entries.keys()]).toEqual(['a'])
  })

  it('rejects updates through a settled publication handle', () => {
    const state = new SkillRuntimeSnapshotState()
    const publish = state.beginPublish(() => {})
    publish.end()

    expect(() => publish.update((entries) => entries.clear())).toThrow(
      'Skill runtime entries can only change inside an active publish window'
    )
  })
})
