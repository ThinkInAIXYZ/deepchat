import { describe, expect, it, vi } from 'vitest'

import {
  buildLegacyMemoryProvenanceKey,
  buildMemoryProvenanceKey
} from '@/presenter/memoryPresenter/core/scoring'
import { WORKING_PROVENANCE_SEED } from '@/presenter/memoryPresenter/runtimeConstants'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import {
  FakeVectorStore,
  createFakeRepository,
  enabledConfig,
  makePresenter,
  textToVector
} from '../fakes/memoryFakes'
import {
  DAY,
  makeLLMPresenter,
  routedLLM,
  seedConflicted,
  seedEmbedded
} from './serviceTestSupport'

import { MemoryPresenter, embeddingDimensions, waitForMemoryCondition } from './serviceTestSupport'

describe('working-memory L1 (T5)', () => {
  it('refreshes one working blob and injects it at session open without recall', async () => {
    const { presenter, repo, getEmbeddings } = makePresenter(enabledConfig)
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'user prefers redis',
      importance: 0.9
    })
    repo.insert({
      id: 'r1',
      agentId: 'deepchat',
      kind: 'reflection',
      content: 'user is a backend engineer',
      importance: 0.8
    })
    presenter.refreshWorkingMemory('deepchat')
    const working = [...repo.rows.values()].filter((row) => row.kind === 'working')
    expect(working).toHaveLength(1)
    expect(working[0].content).toContain('user prefers redis')

    // Empty query at session open: no embedding/recall, but the blob is injected.
    getEmbeddings.mockClear()
    const payload = await presenter.buildInjection('deepchat', '')
    expect(payload?.payload.working).toContain('user prefers redis')
    expect(payload?.payload.memories).toHaveLength(0)
    expect(getEmbeddings).not.toHaveBeenCalled()
  })

  it('keeps a single working row across refreshes', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'fact one',
      importance: 0.9
    })
    presenter.refreshWorkingMemory('deepchat')
    repo.insert({
      id: 's2',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'fact two',
      importance: 0.95
    })
    presenter.refreshWorkingMemory('deepchat')
    const working = [...repo.rows.values()].filter((row) => row.kind === 'working')
    expect(working).toHaveLength(1)
    expect(working[0].content).toContain('fact two')
  })

  it('debounces mutation refreshes and lets a read synchronously flush dirty state', async () => {
    vi.useFakeTimers()
    try {
      const { presenter, repo } = makePresenter(enabledConfig)
      const listCandidates = vi.spyOn(repo, 'listWorkingCandidates')
      for (let index = 0; index < 20; index += 1) {
        await presenter.rememberMemory(
          { kind: 'semantic', content: `debounced fact ${index}` },
          { agentId: 'deepchat' }
        )
      }

      expect(listCandidates).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(99)
      expect(listCandidates).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(listCandidates).toHaveBeenCalledTimes(1)

      await presenter.rememberMemory(
        { kind: 'semantic', content: 'read flush fact' },
        { agentId: 'deepchat' }
      )
      expect(listCandidates).toHaveBeenCalledTimes(1)
      expect((await presenter.buildInjection('deepchat', ''))?.payload.working).toContain(
        'read flush fact'
      )
      expect(listCandidates).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(100)
      expect(listCandidates).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refreshes the working blob after soft forget and restore', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'stale redis preference',
      importance: 0.9,
      status: 'embedded'
    })
    presenter.refreshWorkingMemory('deepchat')
    expect((await presenter.buildInjection('deepchat', ''))?.payload.working).toContain(
      'stale redis preference'
    )

    expect(await presenter.forgetMemory('deepchat', 's1')).toBe(true)
    expect((await presenter.buildInjection('deepchat', ''))?.payload.working ?? '').not.toContain(
      'stale redis preference'
    )

    expect(presenter.restoreMemory('deepchat', 's1')).toBe(true)
    expect((await presenter.buildInjection('deepchat', ''))?.payload.working).toContain(
      'stale redis preference'
    )
  })

  it('refreshes the working blob after hard delete', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'delete me from working memory',
      importance: 0.9,
      status: 'embedded'
    })
    presenter.refreshWorkingMemory('deepchat')
    expect((await presenter.buildInjection('deepchat', ''))?.payload.working).toContain(
      'delete me from working memory'
    )

    expect(await presenter.deleteMemory('deepchat', 's1')).toBe(true)
    expect((await presenter.buildInjection('deepchat', ''))?.payload.working ?? '').not.toContain(
      'delete me from working memory'
    )
  })

  it('refreshes the working blob after stale archive', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const now = 1_000_000_000_000
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'archive me from working memory',
      importance: 0.9,
      status: 'embedded',
      createdAt: now - 300 * DAY
    })
    repo.updateDecayScore('s1', 0.01)
    presenter.refreshWorkingMemory('deepchat')
    expect((await presenter.buildInjection('deepchat', ''))?.payload.working).toContain(
      'archive me from working memory'
    )

    expect(presenter.archiveStale('deepchat', now)).toBe(1)
    expect((await presenter.buildInjection('deepchat', ''))?.payload.working ?? '').not.toContain(
      'archive me from working memory'
    )
  })

  it('refreshes the working blob after extraction creates a memory', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user prefers valkey","importance":0.8}]'
    })
    const { presenter } = makeLLMPresenter(generateText)

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer valkey',
      model: { providerId: 'main', modelId: 'main' }
    })

    expect(result.ok).toBe(true)
    expect((await presenter.buildInjection('a', ''))?.payload.working).toContain(
      'user prefers valkey'
    )
  })

  it('refreshes the working blob after remember updates an existing memory', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers postgres"}'
    })
    const { presenter } = makeLLMPresenter(generateText)
    await seedEmbedded(presenter, 'user prefers redis')
    presenter.refreshWorkingMemory('a')
    expect((await presenter.buildInjection('a', ''))?.payload.working).toContain(
      'user prefers redis'
    )

    const outcome = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user prefers redis and postgres', importance: 0.8 },
      { agentId: 'a' },
      { providerId: 'main', modelId: 'main' }
    )

    expect(outcome.action).toBe('updated')
    const working = (await presenter.buildInjection('a', ''))?.payload.working ?? ''
    expect(working).toContain('user prefers postgres')
    expect(working).not.toContain('user prefers redis')
  })

  it('refreshes the working blob after challenge and conflict resolution', async () => {
    const { presenter, repo } = makeLLMPresenter(routedLLM({}))
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    presenter.refreshWorkingMemory('a')
    seedConflicted(repo, 'c1', targetId, 'user dislikes redis')
    expect((await presenter.buildInjection('a', ''))?.payload.working).toContain('user likes redis')

    expect(await presenter.resolveConflict('a', 'c1', 'keep_challenger')).toBe(true)
    const resolvedWorking = (await presenter.buildInjection('a', ''))?.payload.working ?? ''
    expect(repo.getById(targetId)?.status).toBe('archived')
    expect(resolvedWorking).toContain('user dislikes redis')
    expect(resolvedWorking).not.toContain('user likes redis')
  })

  it('deletes a stale working blob when memory is disabled during mutation', async () => {
    let config: DeepChatAgentConfig = { memoryEnabled: true }
    const repo = createFakeRepository()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async () => [],
      generateText: async () => '[]',
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 's1',
      agentId: 'a',
      kind: 'semantic',
      content: 'disabled stale working fact',
      importance: 0.9,
      status: 'embedded'
    })
    presenter.refreshWorkingMemory('a')
    expect([...repo.rows.values()].some((row) => row.kind === 'working')).toBe(true)

    config = { memoryEnabled: false }
    expect(await presenter.forgetMemory('a', 's1')).toBe(true)
    await waitForMemoryCondition(
      () => ![...repo.rows.values()].some((row) => row.kind === 'working')
    )
    expect([...repo.rows.values()].some((row) => row.kind === 'working')).toBe(false)

    config = { memoryEnabled: true }
    expect((await presenter.buildInjection('a', ''))?.payload.working ?? '').not.toContain(
      'disabled stale working fact'
    )
  })

  it('skips an oversized memory instead of emptying the blob', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'big',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'x'.repeat(2000),
      importance: 0.99
    })
    repo.insert({
      id: 'small',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'small resident fact',
      importance: 0.9
    })
    presenter.refreshWorkingMemory('deepchat')
    const working = [...repo.rows.values()].find((row) => row.kind === 'working')
    expect(working?.content).toContain('small resident fact')
    expect(working?.content).not.toContain('x'.repeat(2000))
  })

  it('continues past the first oversized working candidate page', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const listWorkingCandidatesSpy = vi.spyOn(repo, 'listWorkingCandidates')
    for (let index = 0; index < 64; index += 1) {
      repo.insert({
        id: `long-${String(index).padStart(3, '0')}`,
        agentId: 'deepchat',
        kind: 'semantic',
        content: `oversized ${index} ${'x'.repeat(2000)}`,
        importance: 1,
        createdAt: 10_000 - index
      })
    }
    repo.insert({
      id: 'short-after-page',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'short fact after long candidates',
      importance: 0.9,
      createdAt: 1
    })

    presenter.refreshWorkingMemory('deepchat')

    const working = [...repo.rows.values()].find((row) => row.kind === 'working')
    expect(working?.content).toContain('short fact after long candidates')
    expect(listWorkingCandidatesSpy.mock.calls.length).toBeGreaterThan(1)
    expect(listWorkingCandidatesSpy.mock.calls[1][2]).toMatchObject({ id: 'long-063' })
  })

  it('falls back to recall when no working blob exists', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'likes redis',
      status: 'embedded',
      importance: 0.9
    })
    const payload = await presenter.buildInjection('deepchat', 'redis')
    expect(payload?.payload.working).toBeFalsy()
    expect(payload?.payload.memories.map((item) => item.id)).toContain('s1')
  })

  it('fails injection closed when forget commits during an awaited vector query', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    let releaseQuery!: () => void
    let markQueryStarted!: () => void
    const queryGate = new Promise<void>((resolve) => {
      releaseQuery = resolve
    })
    const queryStarted = new Promise<void>((resolve) => {
      markQueryStarted = resolve
    })
    vi.spyOn(store, 'query').mockImplementation(async () => {
      markQueryStarted()
      await queryGate
      return [{ memoryId: 's1', distance: 0 }]
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_providerId, _modelId, texts) => texts.map(textToVector),
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 's1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis private fact',
      status: 'pending_embedding'
    })
    await presenter.processPendingEmbeddings('a')

    const injection = presenter.buildInjection('a', 'redis')
    await queryStarted
    await presenter.forgetMemory('a', 's1')
    releaseQuery()

    await expect(injection).resolves.toBeNull()
  })

  it('fails injection closed when a candidate commits during an awaited vector query', async () => {
    const repo = createFakeRepository()
    const { presenter, store } = makePresenter(enabledConfig, repo)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis private fact' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')

    let releaseQuery!: () => void
    let markQueryStarted!: () => void
    const queryGate = new Promise<void>((resolve) => {
      releaseQuery = resolve
    })
    const queryStarted = new Promise<void>((resolve) => {
      markQueryStarted = resolve
    })
    vi.spyOn(store, 'query').mockImplementation(async () => {
      markQueryStarted()
      await queryGate
      return []
    })

    const injection = presenter.buildInjection('a', 'redis')
    await queryStarted
    await presenter.rememberMemory(
      { kind: 'semantic', content: 'new concurrent fact' },
      { agentId: 'a' }
    )
    releaseQuery()

    await expect(injection).resolves.toBeNull()
  })

  it('never surfaces the working blob in recall', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'redis fact',
      status: 'embedded',
      importance: 0.9
    })
    presenter.refreshWorkingMemory('deepchat')
    const results = await presenter.recall('deepchat', 'redis')
    expect(results.some((item) => item.kind === 'working')).toBe(false)
  })

  it('does nothing when memory is disabled', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: false })
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'fact',
      importance: 0.9
    })
    presenter.refreshWorkingMemory('deepchat')
    expect([...repo.rows.values()].some((row) => row.kind === 'working')).toBe(false)
    expect(await presenter.buildInjection('deepchat', 'q')).toBeNull()
  })

  it('does not rewrite an unchanged working blob or bump it when read', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'fact one',
      importance: 0.9
    })
    presenter.refreshWorkingMemory('deepchat')
    const workingRow = [...repo.rows.values()].find((row) => row.kind === 'working')!
    const stamp = workingRow.last_accessed
    const updateSpy = vi.spyOn(repo, 'updateInternalContent')
    presenter.refreshWorkingMemory('deepchat')
    expect(updateSpy).not.toHaveBeenCalled()
    await presenter.buildInjection('deepchat', '')
    expect(repo.getById(workingRow.id)?.last_accessed).toBe(stamp)
  })

  it('re-reads and retries a working-memory content CAS once', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'fact one',
      importance: 0.9
    })
    presenter.refreshWorkingMemory('deepchat')
    repo.insert({
      id: 's2',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'fact two',
      importance: 0.8
    })
    const updateInternalContent = repo.updateInternalContent.bind(repo)
    const updateSpy = vi
      .spyOn(repo, 'updateInternalContent')
      .mockImplementationOnce(() => false)
      .mockImplementation((input) => updateInternalContent(input))

    presenter.refreshWorkingMemory('deepchat')

    expect(updateSpy).toHaveBeenCalledTimes(2)
    expect([...repo.rows.values()].find((row) => row.kind === 'working')?.content).toContain(
      'fact two'
    )
  })

  it('removes the working row when candidates disappear after a rejected content CAS', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'fact one',
      importance: 0.9
    })
    presenter.refreshWorkingMemory('deepchat')
    repo.insert({
      id: 's2',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'fact two',
      importance: 0.8
    })
    const updateSpy = vi.spyOn(repo, 'updateInternalContent').mockImplementationOnce(() => {
      repo.delete('s1')
      repo.delete('s2')
      return false
    })

    presenter.refreshWorkingMemory('deepchat')

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect([...repo.rows.values()].some((row) => row.kind === 'working')).toBe(false)
  })

  it('lazy re-keys a legacy working row without bumping its decision revision', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const legacyKey = buildLegacyMemoryProvenanceKey('deepchat', 'working', WORKING_PROVENANCE_SEED)
    const row = repo.insert({
      id: 'legacy-working',
      agentId: 'deepchat',
      kind: 'working',
      content: '- legacy working fact',
      status: 'fts_only',
      provenanceKey: legacyKey
    })

    const injection = await presenter.buildInjection('deepchat', '')

    expect(injection?.payload.working).toContain('legacy working fact')
    expect(repo.getById(row.id)?.provenance_key).toBe(
      buildMemoryProvenanceKey('deepchat', 'working', WORKING_PROVENANCE_SEED)
    )
    expect(repo.getById(row.id)?.decision_revision).toBe(row.decision_revision)
  })

  it('keeps the v2 working row and removes a redundant legacy internal row', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'working-v2',
      agentId: 'deepchat',
      kind: 'working',
      content: '- current working fact',
      status: 'fts_only',
      provenanceKey: buildMemoryProvenanceKey('deepchat', 'working', WORKING_PROVENANCE_SEED)
    })
    repo.insert({
      id: 'working-v1',
      agentId: 'deepchat',
      kind: 'working',
      content: '- stale working fact',
      status: 'fts_only',
      provenanceKey: buildLegacyMemoryProvenanceKey('deepchat', 'working', WORKING_PROVENANCE_SEED)
    })

    const injection = await presenter.buildInjection('deepchat', '')

    expect(injection?.payload.working).toContain('current working fact')
    expect(repo.getById('working-v2')).toBeDefined()
    expect(repo.getById('working-v1')).toBeUndefined()
  })

  it('does not dirty working memory during a no-change consolidation pass', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const now = 1_000_000_000_000
    // Recent relative to `now` so the same pass does not archive it before the blob build.
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'redis fact',
      importance: 0.9,
      createdAt: now
    })
    await presenter.runConsolidationPass('deepchat', now)
    expect([...repo.rows.values()].some((row) => row.kind === 'working')).toBe(false)
  })

  it('schedules an async refresh on a cold-start miss and serves the blob next open', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'likes redis',
      status: 'embedded',
      importance: 0.9
    })
    // First open: no blob yet, so this turn is served by recall and a refresh is kicked off.
    const first = await presenter.buildInjection('deepchat', 'redis')
    expect(first?.payload.working).toBeFalsy()
    expect(first?.payload.memories.map((item) => item.id)).toContain('s1')
    await waitForMemoryCondition(() =>
      [...repo.rows.values()].some((row) => row.kind === 'working')
    )
    // Next open: the background refresh has produced the blob.
    const second = await presenter.buildInjection('deepchat', '')
    expect(second?.payload.working).toContain('likes redis')
  })

  it('coalesces concurrent cold-start misses into a single refresh', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const listWorkingCandidatesSpy = vi.spyOn(repo, 'listWorkingCandidates')
    // Two opens race before the refresh macrotask runs; the in-flight flag collapses them to one.
    await Promise.all([
      presenter.buildInjection('deepchat', 'q'),
      presenter.buildInjection('deepchat', 'q')
    ])
    await waitForMemoryCondition(() => listWorkingCandidatesSpy.mock.calls.length > 0)
    const workingRefreshScans = listWorkingCandidatesSpy.mock.calls.filter(
      ([agentId]) => agentId === 'deepchat'
    )
    expect(workingRefreshScans).toHaveLength(1)
  })

  it('refreshes again after a new memory even right after an empty cold-start miss', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    // Empty agent: the first open misses and its scheduled refresh finds nothing to blob.
    await presenter.buildInjection('deepchat', 'q')
    await new Promise((resolve) => setTimeout(resolve, 0))
    // A memory lands moments later; the next open must not be suppressed by a refresh timer.
    repo.insert({
      id: 's1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'likes redis',
      status: 'embedded',
      importance: 0.9
    })
    await presenter.buildInjection('deepchat', '')
    await waitForMemoryCondition(() =>
      [...repo.rows.values()].some((row) => row.kind === 'working')
    )
    const served = await presenter.buildInjection('deepchat', '')
    expect(served?.payload.working).toContain('likes redis')
  })
})
