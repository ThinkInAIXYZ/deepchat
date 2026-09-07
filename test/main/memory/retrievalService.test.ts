import { describe, expect, it, vi } from 'vitest'

import { appendMemorySection, buildMemorySection } from '@/memory'
import {
  buildMemoryProvenanceKey,
  decayScore,
  distanceToSimilarity,
  fuse,
  parseSourceEntryIds,
  recencyScore,
  resolveRetrieval,
  retrievalScore
} from '@/memory/core/scoring'
import { MEMORY_TEMPORAL_UNCERTAIN_STATE_FACTOR } from '@/memory/core/temporal'
import { createMemoryProviderCapacityError } from '@/memory/core/providerCancellation'
import { FTS_SIMILARITY_BASELINE } from '@/memory/types'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import { enabledConfig, makePresenter, textToVector } from './support/memoryFakes'
import {
  DAY,
  deferred,
  flushMicrotasks,
  makeLLMPresenter,
  makeRow,
  memoryRuntimeForTests,
  routedLLM,
  seedEmbedded
} from './serviceTestSupport'

describe('memory scoring', () => {
  it('distanceToSimilarity clamps to [0,1]', () => {
    expect(distanceToSimilarity(0)).toBe(1)
    expect(distanceToSimilarity(1)).toBe(0)
    expect(distanceToSimilarity(2)).toBe(0)
    expect(distanceToSimilarity(-1)).toBe(1)
  })

  it('recencyScore decays by half-life', () => {
    const half = 1000
    expect(recencyScore(0, 0, half)).toBeCloseTo(1)
    expect(recencyScore(0, 1000, half)).toBeCloseTo(0.5)
    expect(recencyScore(0, 2000, half)).toBeCloseTo(0.25)
  })

  it('retrievalScore combines weighted components', () => {
    const score = retrievalScore({ importance: 1, created_at: 1000 }, 1, 1000, {
      similarity: 0.6,
      recency: 0.25,
      importance: 0.15
    })
    expect(score).toBeCloseTo(0.6 + 0.25 + 0.15)
  })

  it('category does not affect retrieval or decay scoring', () => {
    const now = 10 * DAY
    const weights = { similarity: 0.6, recency: 0.25, importance: 0.15 }
    const uncategorized = makeRow('uncategorized', { category: null, created_at: now - DAY })
    const categorized = makeRow('categorized', {
      category: 'project_fact',
      created_at: now - DAY
    })

    expect(decayScore(uncategorized, now)).toBeCloseTo(decayScore(categorized, now))
    expect(retrievalScore(uncategorized, 0.8, now, weights)).toBeCloseTo(
      retrievalScore(categorized, 0.8, now, weights)
    )
  })

  it('resolveRetrieval falls back to defaults and validates rrfK / similarityThreshold', () => {
    const defaults = resolveRetrieval(null)
    expect(defaults.topK).toBe(6)
    expect(defaults.rrfK).toBe(60)
    expect(defaults.similarityThreshold).toBe(0.2)
    expect(resolveRetrieval({ topK: 3, rrfK: 30, similarityThreshold: 0.5 })).toMatchObject({
      topK: 3,
      rrfK: 30,
      similarityThreshold: 0.5
    })
    // Illegal values fall back rather than corrupting recall.
    expect(resolveRetrieval({ rrfK: 0, similarityThreshold: 2 })).toMatchObject({
      rrfK: 60,
      similarityThreshold: 0.2
    })
    // Non-finite / out-of-range numbers fall back instead of producing a runaway LIMIT or NaN.
    expect(
      resolveRetrieval({ topK: Infinity, rrfK: Number.NaN, similarityThreshold: Number.NaN })
    ).toMatchObject({ topK: 6, rrfK: 60, similarityThreshold: 0.2 })
    expect(resolveRetrieval({ topK: 10_000 }).topK).toBe(100)
    expect(resolveRetrieval({ rrfK: 10_000 }).rrfK).toBe(1000)
    // A single bad weight discards the whole set so scores never go NaN.
    expect(
      resolveRetrieval({ weights: { similarity: Number.NaN, recency: 0.3, importance: 0.2 } })
        .weights
    ).toEqual({ similarity: 0.6, recency: 0.25, importance: 0.15 })
    expect(
      resolveRetrieval({ weights: { similarity: -1, recency: 0.3, importance: 0.2 } }).weights
    ).toEqual({ similarity: 0.6, recency: 0.25, importance: 0.15 })
    expect(
      resolveRetrieval({ weights: { similarity: 0.5, recency: 0.3, importance: 0.2 } }).weights
    ).toEqual({ similarity: 0.5, recency: 0.3, importance: 0.2 })
  })

  it('provenance key is stable and dedupes on normalized content', () => {
    const a = buildMemoryProvenanceKey('agent', 'semantic', '  Likes   Redis  ')
    const b = buildMemoryProvenanceKey('agent', 'semantic', 'Likes Redis')
    expect(a).toBe(b)
    expect(buildMemoryProvenanceKey('agent', 'semantic', 'likes redis')).not.toBe(a)
    const c = buildMemoryProvenanceKey('agent', 'episodic', 'Likes Redis')
    expect(c).not.toBe(a)
    expect(buildMemoryProvenanceKey('agent', 'semantic', 'Cafe\u0301')).toBe(
      buildMemoryProvenanceKey('agent', 'semantic', 'Café')
    )
  })
})

describe('memory fuse (RRF)', () => {
  const weights = { similarity: 0.6, recency: 0.25, importance: 0.15 }
  const opts = { topK: 10, rrfK: 60, weights, now: 1000 }

  it('boosts a memory found by both paths above single-path hits (T-R1)', () => {
    const both = makeRow('both')
    const ftsOnly = makeRow('ftsOnly')
    const vecOnly = makeRow('vecOnly')
    const result = fuse(
      [both, ftsOnly],
      [
        { row: both, similarity: 0.5 },
        { row: vecOnly, similarity: 0.5 }
      ],
      opts
    )
    expect(result[0].id).toBe('both')
    expect(result[0].sources).toEqual({ fts: true, vec: true })
  })

  it('keeps a strong vector hit above a weak keyword-only hit (T-R2, AC-1.1)', () => {
    // M_vec: high similarity, surfaced only by the vector path (no query substring).
    // M_fts: keyword-only hit scored at the FTS baseline; retrievalScore reranks M_vec on top.
    const mVec = makeRow('mVec')
    const mFts = makeRow('mFts', { importance: 0.9 })
    const result = fuse([mFts], [{ row: mVec, similarity: 0.95 }], opts)
    expect(result.map((item) => item.id)).toEqual(['mVec', 'mFts'])
  })

  it('keeps the FTS-only similarity baseline at the reviewed retrieval value', () => {
    expect(FTS_SIMILARITY_BASELINE).toBe(0.3)
  })

  it('keeps a strong vector hit above a weak keyword hit at a worse RRF rank (AC-1.1)', () => {
    // The boundary pure RRF-primary ordering got wrong: the weak keyword hit is at FTS rank 0
    // (best RRF), the strong vector hit only at vector rank 1 (behind a decoy). retrievalScore
    // must still rerank the strong vector hit above the weak keyword hit.
    const decoy = makeRow('decoy')
    const mVec = makeRow('mVec')
    const mFts = makeRow('mFts')
    const result = fuse(
      [mFts],
      [
        { row: decoy, similarity: 0.97 },
        { row: mVec, similarity: 0.95 }
      ],
      opts
    )
    const ids = result.map((item) => item.id)
    expect(ids.indexOf('mVec')).toBeLessThan(ids.indexOf('mFts'))
  })

  it('carries source markers and parsed lineage onto recall items (AC-4.3/5.1)', () => {
    const row = makeRow('m1', { source_session: 's1', source_entry_ids: JSON.stringify([7, 8]) })
    const [item] = fuse([], [{ row, similarity: 0.9 }], opts)
    expect(item.sources).toEqual({ vec: true })
    expect(item.sourceSession).toBe('s1')
    expect(item.sourceEntryIds).toEqual([7, 8])
  })

  it('filters stale current-state claims and traces uncertain temporal penalties', () => {
    const current = makeRow('current', {
      temporal_kind: 'state',
      valid_from: 500,
      valid_until: 1_500,
      temporal_confidence: 0.9,
      temporal_precision: 'exact',
      temporal_timezone: 'UTC'
    })
    const uncertain = makeRow('uncertain', {
      temporal_kind: 'state',
      valid_from: 0,
      valid_until: 500,
      temporal_confidence: 0.6,
      temporal_precision: 'exact',
      temporal_timezone: 'UTC'
    })
    const expired = makeRow('expired', {
      temporal_kind: 'state',
      valid_from: 0,
      valid_until: 500,
      temporal_confidence: 0.9,
      temporal_precision: 'exact',
      temporal_timezone: 'UTC'
    })

    const result = fuse([uncertain, expired, current], [], {
      ...opts,
      temporalMode: 'current',
      trace: true
    })

    expect(result.map((item) => item.id)).toEqual(['current', 'uncertain'])
    expect(result[1].temporalAnnotation).toContain('possibly outdated state')
    expect(result[1].breakdown?.temporal).toEqual({
      status: 'expired',
      confidence: 0.6,
      factor: MEMORY_TEMPORAL_UNCERTAIN_STATE_FACTOR
    })
    expect(
      fuse([expired], [], { ...opts, temporalMode: 'evidence' }).map((item) => item.id)
    ).toEqual(['expired'])
  })

  it('decays reflections slower than semantic units via per-kind half-life', () => {
    const day = 24 * 60 * 60 * 1000
    const semantic = makeRow('semantic', { kind: 'semantic', created_at: 0 })
    const reflection = makeRow('reflection', { kind: 'reflection', created_at: 0 })
    // Both keyword-only at the same baseline; only the per-kind half-life differs. Over 30 days the
    // reflection's 60d half-life decays far less than the semantic 14d default, so it ranks on top
    // even when listed at a worse keyword rank.
    const aged = { topK: 10, rrfK: 60, weights, now: 30 * day }
    const result = fuse([semantic, reflection], [], aged)
    expect(result.map((item) => item.id)).toEqual(['reflection', 'semantic'])
  })

  it('parseSourceEntryIds tolerates malformed lineage', () => {
    expect(parseSourceEntryIds(null)).toBeNull()
    expect(parseSourceEntryIds('not json')).toBeNull()
    expect(parseSourceEntryIds('[]')).toBeNull()
    expect(parseSourceEntryIds('[3,1,-2,"x"]')).toEqual([3, 1])
  })
})

describe('buildMemorySection / appendMemorySection', () => {
  it('returns empty string for null payload', () => {
    expect(buildMemorySection(null)).toBe('')
    expect(appendMemorySection('base', null)).toBe('base')
  })

  it('renders self-model and memories', () => {
    const section = buildMemorySection({
      selfModel: 'I am concise',
      memories: [{ id: '1', kind: 'semantic', content: 'user likes redis' }]
    })
    expect(section).toContain('## Self-Model')
    expect(section).toContain('I am concise')
    expect(section).toContain('## Relevant Memories')
    expect(section).toContain('user likes redis')
  })

  it('renders temporal qualification without changing stored claim content', () => {
    const section = buildMemorySection({
      selfModel: null,
      memories: [
        {
          id: 'plan',
          kind: 'semantic',
          content: 'The release was planned for July.',
          temporalAnnotation: '[Temporal: previously planned; 2026-07 (UTC)]'
        }
      ]
    })

    expect(section).toContain(
      'The release was planned for July. [Temporal: previously planned; 2026-07 (UTC)]'
    )
  })

  it('appends to existing prompt without overwriting', () => {
    const result = appendMemorySection('USER PROMPT', {
      selfModel: 'persona',
      memories: []
    })
    expect(result.startsWith('USER PROMPT')).toBe(true)
    expect(result).toContain('## Self-Model')
  })
})

describe('MemoryService recall + injection', () => {
  it('recall returns vector-similar memories ranked', async () => {
    const { presenter } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync(
      [
        { kind: 'semantic', content: 'user prefers redis caching' },
        { kind: 'semantic', content: 'user builds vue apps' }
      ],
      { agentId: 'a' }
    )
    await presenter.processPendingEmbeddings('a')
    const results = await presenter.recall('a', 'redis question')
    expect(results[0].content).toContain('redis')
  })

  it('recalls only global and explicitly applicable narrow scopes', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true, memoryEmbedding: null })
    const insert = (
      id: string,
      scope:
        | { type: 'agent' }
        | { type: 'user'; id: string }
        | { type: 'project'; id: string }
        | { type: 'session'; id: string }
    ) =>
      repo.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: `redis scoped fact ${id}`,
        scope
      })
    insert('global', { type: 'agent' })
    insert('user-1', { type: 'user', id: 'user-1' })
    insert('project-1', { type: 'project', id: 'project-1' })
    insert('session-1', { type: 'session', id: 'session-1' })
    insert('session-2', { type: 'session', id: 'session-2' })

    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).toEqual(['global'])
    expect(
      (await presenter.recall('a', 'redis', undefined, { sessionId: 'session-1' }))
        .map((item) => item.id)
        .sort()
    ).toEqual(['global', 'session-1'])
    expect(
      (
        await presenter.searchMemories('a', 'redis', {
          scopeContext: {
            userId: 'user-1',
            projectId: 'project-1',
            sessionId: 'session-1'
          }
        })
      )
        .map((hit) => hit.row.id)
        .sort()
    ).toEqual(['global', 'project-1', 'session-1', 'user-1'])
  })

  it('adaptively refills vector candidates when other scopes fill the first page', async () => {
    const { presenter, store } = makePresenter({
      ...enabledConfig,
      memoryRetrieval: { topK: 1 }
    })
    for (let index = 0; index < 20; index += 1) {
      presenter.writeMemoriesSync(
        [{ kind: 'semantic', content: `unrelated other scope ${index}` }],
        { agentId: 'a', scope: { type: 'session', id: 'session-2' } }
      )
    }
    const [applicableId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'applicable vector-only fact' }],
      { agentId: 'a', scope: { type: 'session', id: 'session-1' } }
    )
    await presenter.processPendingEmbeddings('a')
    for (const memoryId of store.vectors.keys()) {
      store.vectors.set(memoryId, textToVector('redis'))
    }
    const querySpy = vi.spyOn(store, 'query')

    const recalled = await presenter.recall('a', 'redis', undefined, {
      sessionId: 'session-1'
    })

    expect(recalled.map((item) => item.id)).toEqual([applicableId])
    expect(querySpy.mock.calls.map(([, options]) => options.topK)).toEqual([8, 32])
  })

  it('cancels an adaptive vector refill when the directive read epoch changes', async () => {
    const { presenter, repo, store } = makePresenter({
      ...enabledConfig,
      memoryRetrieval: { topK: 1 }
    })
    for (let index = 0; index < 20; index += 1) {
      presenter.writeMemoriesSync(
        [{ kind: 'semantic', content: `unrelated other scope ${index}` }],
        { agentId: 'a', scope: { type: 'session', id: 'session-2' } }
      )
    }
    const [applicableId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'applicable vector-only fact' }],
      { agentId: 'a', scope: { type: 'session', id: 'session-1' } }
    )
    await presenter.processPendingEmbeddings('a')
    for (const memoryId of store.vectors.keys()) {
      store.vectors.set(memoryId, textToVector('redis'))
    }
    const draft = presenter.suggestDirective('a', {
      kind: 'suppress_topic',
      content: 'Do not surface Project Saffron.',
      topic: 'Project Saffron'
    })
    const originalQuery = store.query.bind(store)
    const pendingRefill = deferred<Array<{ memoryId: string; distance: number }>>()
    const querySpy = vi.spyOn(store, 'query').mockImplementation((embedding, options) => {
      if (options.topK === 32) return pendingRefill.promise
      return originalQuery(embedding, options)
    })

    const recall = presenter.recall('a', 'redis', undefined, {
      sessionId: 'session-1'
    })
    await vi.waitFor(() => expect(querySpy).toHaveBeenCalledTimes(2))
    expect(presenter.approveDirective('a', draft!.id)).toMatchObject({ status: 'active' })
    pendingRefill.resolve(await originalQuery(textToVector('redis'), { topK: 32 }))

    await expect(recall).resolves.toEqual([])
    expect(repo.getById(applicableId)?.access_count).toBe(0)
  })

  it('retains vectors that belong to an inapplicable scope during inline cleanup', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    const [sessionOneId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'session one redis fact' }],
      { agentId: 'a', scope: { type: 'session', id: 'session-1' } }
    )
    const [sessionTwoId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'exclusive second session topic' }],
      { agentId: 'a', scope: { type: 'session', id: 'session-2' } }
    )
    await presenter.processPendingEmbeddings('a')
    expect(store.vectors.has(sessionOneId)).toBe(true)
    expect(store.vectors.has(sessionTwoId)).toBe(true)
    const deletePrunableVectors = vi.spyOn(
      memoryRuntimeForTests(presenter).vectorStoreService,
      'deletePrunableVectorsForMemoryIds'
    )

    await presenter.recall('a', 'exclusive second session topic', undefined, {
      sessionId: 'session-1'
    })
    await flushMicrotasks()

    expect(deletePrunableVectors).not.toHaveBeenCalled()
    expect(store.vectors.has(sessionTwoId)).toBe(true)
    expect(repo.getById(sessionTwoId)).toMatchObject({
      scope_type: 'session',
      scope_id: 'session-2',
      embedding_state: 'ready'
    })
  })

  it('buildInjection returns null when disabled', async () => {
    const { presenter } = makePresenter({ memoryEnabled: false })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'x' }], { agentId: 'a' })
    expect(await presenter.buildInjection('a', 'x')).toBeNull()
  })

  it('buildInjection includes self-model and recalled memories', async () => {
    const { presenter } = makePresenter(enabledConfig)
    const draft = presenter.evolvePersona('a', 'I answer concisely')
    await presenter.approvePersonaDraft('a', draft!)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const payload = await presenter.buildInjection('a', 'redis')
    expect(payload?.payload.selfModel).toBe('I answer concisely')
    expect(payload?.payload.memories.length).toBeGreaterThan(0)
  })

  it('records injection access only through the runtime-selected manifest seam', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')

    const payload = await presenter.buildInjection('a', 'redis')
    expect(payload?.payload.memories.map((memory) => memory.id)).toContain(id)
    expect(repo.getById(id)?.access_count).toBe(0)

    presenter.recordInjectionAccess('a', [id, id], 1234)
    expect(repo.getById(id)?.access_count).toBe(1)
    expect(repo.getById(id)?.last_accessed).toBe(1234)
  })

  it('adaptively refills recall candidates after filtering expired states', async () => {
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: null,
      memoryRetrieval: { topK: 2 }
    }
    const { presenter, repo } = makePresenter(config)
    for (let index = 0; index < 50; index += 1) {
      repo.insert({
        id: `expired-${index}`,
        agentId: 'a',
        kind: 'semantic',
        content: `redis expired state ${index}`,
        temporal: {
          temporalKind: 'state',
          validFrom: 0,
          validUntil: 1,
          temporalConfidence: 0.95,
          temporalPrecision: 'exact',
          temporalTimeZone: 'UTC'
        }
      })
    }
    repo.insert({
      id: 'current-a',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis current fact a'
    })
    repo.insert({
      id: 'current-b',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis current fact b'
    })
    const recordAccess = vi.spyOn(repo, 'recordAccessBatch')
    const search = vi.spyOn(repo, 'searchWithStrategy')

    const recalled = await presenter.recall('a', 'redis')

    expect(recalled.map((item) => item.id)).toEqual(['current-a', 'current-b'])
    expect(recordAccess).toHaveBeenCalledWith(['current-a', 'current-b'], expect.any(Number))
    expect(search.mock.calls.map(([, , limit]) => limit)).toEqual([8, 32, 128])
  })

  it('adaptively refills after topic suppression before top-k and access accounting', async () => {
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: null,
      memoryRetrieval: { topK: 2 }
    }
    const { presenter, repo } = makePresenter(config)
    for (let index = 0; index < 50; index += 1) {
      repo.insert({
        id: `saffron-${index}`,
        agentId: 'a',
        kind: 'semantic',
        content: `redis Project Saffron detail ${index}`,
        createdAt: 10_000 - index
      })
    }
    repo.insert({
      id: 'safe-a',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis safe fact a',
      createdAt: 1_000
    })
    repo.insert({
      id: 'safe-b',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis safe fact b',
      createdAt: 900
    })
    presenter.createDirective('a', {
      kind: 'suppress_topic',
      content: 'Do not surface Project Saffron.',
      topic: 'Project Saffron'
    })
    const recordAccess = vi.spyOn(repo, 'recordAccessBatch')
    const search = vi.spyOn(repo, 'searchWithStrategy')

    const recalled = await presenter.recall('a', 'redis')

    expect(recalled.map((item) => item.id)).toEqual(['safe-a', 'safe-b'])
    expect(recordAccess).toHaveBeenCalledWith(['safe-a', 'safe-b'], expect.any(Number))
    expect(repo.getById('saffron-0')?.access_count).toBe(0)
    expect(search.mock.calls.map(([, , limit]) => limit)).toEqual([8, 32, 128])
  })

  it('reports candidate budget exhaustion when every bounded page is ineligible', async () => {
    const { presenter, repo } = makePresenter({
      memoryEnabled: true,
      memoryEmbedding: null,
      memoryRetrieval: { topK: 1 }
    })
    for (let index = 0; index <= 800; index += 1) {
      repo.insert({
        id: `expired-${index}`,
        agentId: 'a',
        kind: 'semantic',
        content: `redis expired state ${index}`,
        temporal: {
          temporalKind: 'state',
          validFrom: 0,
          validUntil: 1,
          temporalConfidence: 0.95,
          temporalPrecision: 'exact',
          temporalTimeZone: 'UTC'
        }
      })
    }

    const injection = await presenter.buildInjection('a', 'redis')

    expect(injection).toMatchObject({
      payload: { memories: [] },
      manifest: {
        degradations: expect.arrayContaining(['candidateBudgetExhausted'])
      }
    })
  })

  it('keeps draft suppressions inert and revalidates runtime access against active directives', async () => {
    const { presenter, repo } = makePresenter({
      memoryEnabled: true,
      memoryEmbedding: null,
      memoryRetrieval: { topK: 4 }
    })
    repo.insert({
      id: 'saffron',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis Project Saffron detail'
    })
    repo.insert({
      id: 'safe',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis public detail'
    })
    const draft = presenter.suggestDirective('a', {
      kind: 'suppress_topic',
      content: 'Do not surface Project Saffron.',
      topic: 'Project Saffron'
    })

    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).toContain('saffron')
    const suppressedAccessBeforeApproval = repo.getById('saffron')?.access_count
    expect(presenter.approveDirective('a', draft!.id)).toMatchObject({ status: 'active' })
    expect((await presenter.searchMemories('a', 'redis')).map((item) => item.row.id)).toEqual(
      expect.arrayContaining(['saffron', 'safe'])
    )
    const injection = await presenter.buildInjection('a', 'redis')
    expect(injection?.payload.memories.map((memory) => memory.id)).toEqual(['safe'])

    presenter.recordInjectionAccess('a', ['saffron', 'safe'], 1_234)
    expect(repo.getById('saffron')?.access_count).toBe(suppressedAccessBeforeApproval)
    expect(repo.getById('safe')?.access_count).toBe(2)
    expect(repo.getById('safe')?.last_accessed).toBe(1_234)
  })

  it('cancels a stale recall when suppression is approved during asynchronous retrieval', async () => {
    const { presenter, repo, getEmbeddings } = makePresenter(enabledConfig)
    const [memoryId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'redis Project Saffron detail' }],
      { agentId: 'a' }
    )
    await presenter.processPendingEmbeddings('a')
    const draft = presenter.suggestDirective('a', {
      kind: 'suppress_topic',
      content: 'Do not surface Project Saffron.',
      topic: 'Project Saffron'
    })
    const pendingEmbedding = deferred<number[][]>()
    const callsBeforeRecall = getEmbeddings.mock.calls.length
    getEmbeddings.mockImplementationOnce(() => pendingEmbedding.promise)

    const recall = presenter.recall('a', 'redis')
    await vi.waitFor(() => {
      expect(getEmbeddings).toHaveBeenCalledTimes(callsBeforeRecall + 1)
    })
    expect(presenter.approveDirective('a', draft!.id)).toMatchObject({ status: 'active' })
    pendingEmbedding.resolve([textToVector('redis')])

    await expect(recall).resolves.toEqual([])
    expect(repo.getById(memoryId)?.access_count).toBe(0)
  })

  it('records injection access only for rows owned by the requested agent', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const [aId] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'a redis fact' }], {
      agentId: 'a'
    })
    const [bId] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'b redis fact' }], {
      agentId: 'b'
    })

    presenter.recordInjectionAccess('a', [aId, bId], 1234)

    expect(repo.getById(aId)?.access_count).toBe(1)
    expect(repo.getById(aId)?.last_accessed).toBe(1234)
    expect(repo.getById(bId)?.access_count).toBe(0)
    expect(repo.getById(bId)?.last_accessed).toBeNull()
  })

  it('buildInjection does not request heavy retrieval breakdown by default', async () => {
    const { presenter } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const payload = await presenter.buildInjection('a', 'redis')
    expect(payload?.payload.memories[0]?.breakdown).toBeUndefined()
  })

  it('does not return or record a stale recall across an enabled ABA transition', async () => {
    let memoryEnabled = true
    const config = {
      get memoryEnabled() {
        return memoryEnabled
      },
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    } as DeepChatAgentConfig
    const { presenter, repo, getEmbeddings } = makePresenter(config)
    const [memoryId] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    const pendingEmbedding = deferred<number[][]>()
    const callsBeforeRecall = getEmbeddings.mock.calls.length
    getEmbeddings.mockImplementationOnce(() => pendingEmbedding.promise)

    const recall = presenter.recall('a', 'redis')
    await vi.waitFor(() => {
      expect(getEmbeddings).toHaveBeenCalledTimes(callsBeforeRecall + 1)
    })
    memoryEnabled = false
    presenter.onAgentMemoryMaintenanceConfigChanged('a')
    memoryEnabled = true
    presenter.onAgentMemoryMaintenanceConfigChanged('a')
    pendingEmbedding.resolve([textToVector('redis')])

    await expect(recall).resolves.toEqual([])
    expect(repo.getById(memoryId)?.access_count).toBe(0)
    await presenter.dispose()
  })

  it('does not return stale search results across an enabled ABA transition', async () => {
    let memoryEnabled = true
    const config = {
      get memoryEnabled() {
        return memoryEnabled
      },
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    } as DeepChatAgentConfig
    const { presenter, getEmbeddings } = makePresenter(config)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const pendingEmbedding = deferred<number[][]>()
    const callsBeforeSearch = getEmbeddings.mock.calls.length
    getEmbeddings.mockImplementationOnce(() => pendingEmbedding.promise)

    const search = presenter.searchMemories('a', 'redis')
    await vi.waitFor(() => {
      expect(getEmbeddings).toHaveBeenCalledTimes(callsBeforeSearch + 1)
    })
    memoryEnabled = false
    presenter.onAgentMemoryMaintenanceConfigChanged('a')
    memoryEnabled = true
    presenter.onAgentMemoryMaintenanceConfigChanged('a')
    pendingEmbedding.resolve([textToVector('redis')])

    await expect(search).resolves.toEqual([])
    await presenter.dispose()
  })

  it('rethrows a real retrieval error even when the operation fence becomes stale', async () => {
    let memoryEnabled = true
    const config = {
      get memoryEnabled() {
        return memoryEnabled
      },
      memoryEmbedding: null
    } as DeepChatAgentConfig
    const { presenter, repo } = makePresenter(config)
    const failure = new Error('storage unavailable')
    failure.name = 'AbortError'
    vi.spyOn(repo, 'searchWithStrategy').mockImplementation(() => {
      memoryEnabled = false
      presenter.onAgentMemoryMaintenanceConfigChanged('a')
      memoryEnabled = true
      presenter.onAgentMemoryMaintenanceConfigChanged('a')
      throw failure
    })

    await expect(presenter.recall('a', 'redis')).rejects.toBe(failure)
    await presenter.dispose()
  })

  it('rethrows provider capacity rejection when the operation fence becomes stale', async () => {
    let memoryEnabled = true
    const config = {
      get memoryEnabled() {
        return memoryEnabled
      },
      memoryEmbedding: null
    } as DeepChatAgentConfig
    const { presenter, repo } = makePresenter(config)
    const failure = createMemoryProviderCapacityError(
      '[Memory] provider request capacity exhausted'
    )
    vi.spyOn(repo, 'searchWithStrategy').mockImplementation(() => {
      memoryEnabled = false
      presenter.onAgentMemoryMaintenanceConfigChanged('a')
      memoryEnabled = true
      presenter.onAgentMemoryMaintenanceConfigChanged('a')
      throw failure
    })

    await expect(presenter.recall('a', 'redis')).rejects.toBe(failure)
    await presenter.dispose()
  })

  it('preserves vector-store recovery before rethrowing a stale real error', async () => {
    let memoryEnabled = true
    const config = {
      get memoryEnabled() {
        return memoryEnabled
      },
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    } as DeepChatAgentConfig
    const { presenter, store } = makePresenter(config)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const failure = new Error('vector store unavailable')
    vi.spyOn(store, 'query').mockImplementation(async () => {
      memoryEnabled = false
      presenter.onAgentMemoryMaintenanceConfigChanged('a')
      memoryEnabled = true
      presenter.onAgentMemoryMaintenanceConfigChanged('a')
      throw failure
    })
    const vectorStore = memoryRuntimeForTests(presenter).vectorStoreService
    const clearReady = vi.spyOn(vectorStore, 'clearReady')

    await expect(presenter.recall('a', 'redis')).rejects.toBe(failure)
    expect(clearReady).toHaveBeenCalledWith('a')
    await presenter.dispose()
  })

  it('does not seed execution state for an unmanaged search Agent', async () => {
    const { presenter } = makePresenter(enabledConfig, undefined, {
      isManagedAgent: (agentId) => agentId !== 'unmanaged-agent'
    })

    await expect(presenter.searchMemories('unmanaged-agent', 'redis')).resolves.toEqual([])
    const runtime = (
      presenter as unknown as {
        runtime: { listObservedExecutionAgentIds(): string[] }
      }
    ).runtime
    expect(runtime.listObservedExecutionAgentIds()).not.toContain('unmanaged-agent')
    await presenter.dispose()
  })

  it('returns no injection from a read admitted before an enabled ABA transition', async () => {
    let memoryEnabled = true
    const config = {
      get memoryEnabled() {
        return memoryEnabled
      },
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    } as DeepChatAgentConfig
    const { presenter, getEmbeddings } = makePresenter(config)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const pendingEmbedding = deferred<number[][]>()
    const callsBeforeInjection = getEmbeddings.mock.calls.length
    getEmbeddings.mockImplementationOnce(() => pendingEmbedding.promise)

    const injection = presenter.buildInjection('a', 'redis')
    await vi.waitFor(() => {
      expect(getEmbeddings).toHaveBeenCalledTimes(callsBeforeInjection + 1)
    })
    memoryEnabled = false
    presenter.onAgentMemoryMaintenanceConfigChanged('a')
    memoryEnabled = true
    presenter.onAgentMemoryMaintenanceConfigChanged('a')
    pendingEmbedding.resolve([textToVector('redis')])

    await expect(injection).resolves.toBeNull()
    await presenter.dispose()
  })
})

describe('MemoryService forgetting score (T-B1..T-B2)', () => {
  it('decay only reranks: an old active memory still appears, just lower (T-B1)', () => {
    const now = 1_000 * DAY
    const recent = makeRow('recent', { created_at: now })
    const old = makeRow('old', { created_at: now - 200 * DAY })
    const weights = { similarity: 0.6, recency: 0.25, importance: 0.15 }
    const result = fuse([recent, old], [], { topK: 10, rrfK: 60, weights, now })
    expect(result.map((item) => item.id)).toEqual(['recent', 'old'])
    expect(result).toHaveLength(2)
  })

  it('confidence lifts the score and high importance never sinks below the floor (T-B2)', () => {
    const now = 1_000 * DAY
    const weights = { similarity: 0.6, recency: 0.25, importance: 0.15 }
    const neutral = retrievalScore(
      { importance: 0.5, created_at: now, confidence: null },
      0.5,
      now,
      weights
    )
    const confident = retrievalScore(
      { importance: 0.5, created_at: now, confidence: 1 },
      0.5,
      now,
      weights
    )
    expect(confident).toBeGreaterThan(neutral)

    // Heavily decayed, low confidence, but high importance: floored at coef * importance.
    const floored = retrievalScore(
      { importance: 1, created_at: now - 5_000 * DAY, confidence: 0 },
      0,
      now,
      weights
    )
    expect(floored).toBeCloseTo(0.15)
  })

  it('decayScore anchors on last access and decays with the 30-day half-life', () => {
    const now = 1_000 * DAY
    const fresh = decayScore({ created_at: now, last_accessed: null, importance: 0 }, now)
    const stale = decayScore(
      { created_at: now - 60 * DAY, last_accessed: null, importance: 0 },
      now
    )
    expect(fresh).toBeCloseTo(1)
    expect(stale).toBeCloseTo(0.25)
  })

  it('decayScore slows down for high-importance memories', () => {
    const now = 1_000 * DAY
    const low = decayScore({ created_at: now - 60 * DAY, last_accessed: null, importance: 0 }, now)
    const high = decayScore({ created_at: now - 60 * DAY, last_accessed: null, importance: 1 }, now)
    expect(high).toBeGreaterThan(low)
  })

  it('UPDATE corroboration raises confidence monotonically (T-B2)', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user prefers redis cluster","importance":0.8}]',
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers redis cluster"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const id = await seedEmbedded(presenter, 'user likes redis')
    expect(repo.getById(id)?.confidence).toBe(null)
    await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer redis cluster',
      model: { providerId: 'main', modelId: 'main' }
    })
    const bumped = repo.getById(id)?.confidence
    expect(bumped).toBeGreaterThan(0.7)
  })
})
