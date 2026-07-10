import { describe, expect, it, vi } from 'vitest'
import type { PublishedSkillEntry, SkillMetadata } from '@shared/types/skill'
import {
  SkillRuntimeSnapshotCoordinator,
  SkillRuntimeSnapshotState
} from '@/presenter/skillPresenter/runtimeSnapshot'

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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
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

  it('settles publication bookkeeping even when a compatibility observer throws', async () => {
    const state = new SkillRuntimeSnapshotState()
    const publish = state.beginPublish(() => {
      throw new Error('compatibility observer failed')
    })
    publish.update((entries) => entries.set('a', createEntry('a')))
    const settlement = state.settlementPromise
    let settled = false
    void settlement?.then(() => {
      settled = true
    })

    expect(() => publish.end()).toThrow('compatibility observer failed')
    await Promise.resolve()

    expect(settled).toBe(true)
    expect(state.settlementPromise).toBeNull()
    expect(state.epoch).toBe(2)
    expect(state.snapshot.entries.has('a')).toBe(true)

    const next = state.beginPublish(() => {})
    next.end()
    expect(state.epoch).toBe(4)
  })
})

describe('SkillRuntimeSnapshotCoordinator', () => {
  it('quarantines invalid metadata-only readiness once for all current and later callers', async () => {
    const metadata = createEntry('invalid').metadata as SkillMetadata
    const stageEntry = vi.fn().mockResolvedValue(null)
    const coordinator = new SkillRuntimeSnapshotCoordinator({
      stageEntry,
      onPublished: vi.fn(),
      onStageError: vi.fn()
    })
    coordinator.seedFromMetadata([metadata])

    const createWait = () =>
      coordinator.wait({
        requiredSkillNames: ['invalid'],
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000
      })
    const [first, second] = await Promise.all([createWait(), createWait()])
    const third = await createWait()

    expect(stageEntry).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    expect(third.entries.get('invalid')).toMatchObject({
      availability: 'quarantined',
      allowedTools: [],
      sourceError: {
        code: 'INVALID_SOURCE',
        message: 'Skill source is invalid'
      }
    })
  })

  it('keeps raw readiness errors local and publishes only stable diagnostics', async () => {
    const metadata = createEntry('invalid').metadata as SkillMetadata
    const rawError = new Error('/private/skill/SKILL.md included secret body')
    const onStageError = vi.fn()
    const coordinator = new SkillRuntimeSnapshotCoordinator({
      stageEntry: vi.fn().mockRejectedValue(rawError),
      onPublished: vi.fn(),
      onStageError
    })
    coordinator.seedFromMetadata([metadata])

    const snapshot = await coordinator.wait({
      requiredSkillNames: ['invalid'],
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000
    })

    expect(onStageError).toHaveBeenCalledWith(metadata, rawError)
    expect(snapshot.entries.get('invalid')?.sourceError).toEqual({
      code: 'SOURCE_READ_FAILED',
      message: 'Skill source could not be read'
    })
    expect(JSON.stringify(snapshot.entries.get('invalid')?.sourceError)).not.toContain('/private')
    expect(JSON.stringify(snapshot.entries.get('invalid')?.sourceError)).not.toContain('secret')
  })

  it('rejects reset atomically while a publication is active', () => {
    const coordinator = new SkillRuntimeSnapshotCoordinator({
      stageEntry: vi.fn(),
      onPublished: vi.fn(),
      onStageError: vi.fn()
    })
    const sourcePath = '/skills/a/SKILL.md'
    const observation = coordinator.nextObservation(sourcePath)
    const end = coordinator.beginPublish()
    coordinator.publishEntry(createEntry('a'))

    expect(() => coordinator.reset()).toThrow(
      'Cannot reset skill runtime snapshot during publication'
    )
    expect(coordinator.currentObservation(sourcePath)).toBe(observation)

    end()
    expect(coordinator.snapshot.entries.has('a')).toBe(true)
    coordinator.reset()
    expect(coordinator.snapshot.entries.size).toBe(0)
  })

  it('invalidates a readiness stage that settles after reset', async () => {
    const metadata = createEntry('late').metadata as SkillMetadata
    const deferred = createDeferred<PublishedSkillEntry | null>()
    const coordinator = new SkillRuntimeSnapshotCoordinator({
      stageEntry: vi.fn().mockReturnValue(deferred.promise),
      onPublished: vi.fn(),
      onStageError: vi.fn()
    })
    coordinator.seedFromMetadata([metadata])
    const waiting = coordinator.wait({
      requiredSkillNames: ['late'],
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000
    })
    await Promise.resolve()

    coordinator.reset()
    deferred.resolve(createEntry('late'))

    await expect(waiting).resolves.toMatchObject({ epoch: 0 })
    expect(coordinator.snapshot.entries.has('late')).toBe(false)
  })
})
