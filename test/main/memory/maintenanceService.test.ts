import { describe, expect, it, vi } from 'vitest'

import type { MaintenanceBudget } from '@/memory/core/maintenanceBudget'
import type { AgentMemoryRow } from '@/memory/domain/types'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import {
  FakeAuditRepository,
  FakeVectorStore,
  createFakeRepository,
  enabledConfig,
  textToVector
} from './support/memoryFakes'
import {
  DAY,
  MemoryService,
  decisionCalls,
  embeddingDimensions,
  embeddingConfig,
  flushMicrotasks,
  makeLLMPresenter,
  makeRow,
  memoryRuntimeForTests,
  routedLLM,
  seedEmbedded
} from './serviceTestSupport'

describe('MemoryService archiving (T-B3)', () => {
  function makeArchivePresenter() {
    return makeLLMPresenter(routedLLM({}))
  }

  it('archives by current age and importance while honoring lifecycle exemptions', () => {
    const { presenter, repo } = makeArchivePresenter()
    const now = 1_000 * DAY
    const old = now - 200 * DAY
    const make = (id: string, over: Partial<AgentMemoryRow>) =>
      repo.rows.set(id, makeRow(id, { agent_id: 'a', created_at: old, ...over }))

    make('stale', { decay_score: 0.01, created_at: now - 300 * DAY })
    make('accessed', { decay_score: 0.01, access_count: 2 })
    make('recent', { decay_score: 0.01, created_at: now })
    make('lively', { decay_score: 0.01, importance: 1 })
    make('anchored', { decay_score: 0.01, is_anchor: 1 })
    make('persona', { decay_score: 0.01, kind: 'persona' })

    const archived = presenter.archiveStale('a', now)
    expect(archived).toBe(2)
    expect(repo.getById('stale')?.status).toBe('archived')
    expect(repo.getById('accessed')?.status).toBe('archived')
    for (const id of ['recent', 'lively', 'anchored', 'persona']) {
      expect(repo.getById(id)?.status).not.toBe('archived')
    }
  })

  it('archived memories drop out of recall but are never hard-deleted, and can be restored', async () => {
    const { presenter, repo } = makeArchivePresenter()
    const deleteSpy = vi.spyOn(repo, 'delete')
    const now = 1_000 * DAY
    const id = await seedEmbedded(presenter, 'user likes redis')
    repo.rows.get(id)!.created_at = now - 200 * DAY
    repo.updateDecayScore(id, 0.01)

    expect(presenter.archiveStale('a', now)).toBe(1)
    expect(deleteSpy).not.toHaveBeenCalled()
    const recalled = await presenter.recall('a', 'redis')
    expect(recalled.some((item) => item.id === id)).toBe(false)

    expect(presenter.restoreMemory('a', id)).toBe(true)
    expect(repo.getById(id)?.status).toBe('pending_embedding')
  })
})

describe('MemoryService offline consolidation (T-B4..T-B6)', () => {
  it('recall and buildInjection make zero LLM calls; merging only happens in the pass (T-B4)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
    })
    const { presenter } = makeLLMPresenter(generateText)
    await seedEmbedded(presenter, 'user likes redis')
    generateText.mockClear()

    await presenter.recall('a', 'redis')
    await presenter.buildInjection('a', 'redis')
    expect(generateText).not.toHaveBeenCalled()
  })

  it('merges near-duplicates in the pass and supersedes the older row (T-B5)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user prefers redis"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const oldId = await seedEmbedded(presenter, 'user likes redis a')
    const newId = await seedEmbedded(presenter, 'user likes redis b')
    // Recent rows so the same pass merges but never archives them.
    repo.rows.get(oldId)!.created_at = now - 2000
    repo.rows.get(newId)!.created_at = now - 1000

    await presenter.runConsolidationPass('a', now)
    const active = repo.listByAgent('a')
    expect(active).toHaveLength(1)
    expect(repo.getById(oldId)?.superseded_by).toBe(newId)
  })

  it.each(['edit', 'archive', 'delete'] as const)(
    'does not apply a stale maintenance merge after a user %s',
    async (mutation) => {
      let resolveDecision!: (value: string) => void
      let markDecisionStarted!: () => void
      const decisionStarted = new Promise<void>((resolve) => {
        markDecisionStarted = resolve
      })
      const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
        if (!prompt.includes('Choose exactly ONE decision')) return ''
        markDecisionStarted()
        return new Promise<string>((resolve) => {
          resolveDecision = resolve
        })
      })
      const { presenter, repo } = makeLLMPresenter(generateText)
      const now = 1_000 * DAY
      const oldId = await seedEmbedded(presenter, 'user likes redis a')
      const currentId = await seedEmbedded(presenter, 'user likes redis b')
      repo.rows.get(oldId)!.created_at = now - 2_000
      repo.rows.get(currentId)!.created_at = now - 1_000

      const pass = presenter.runConsolidationPass('a', now)
      await decisionStarted
      let editedId = currentId
      if (mutation === 'edit') {
        const edit = presenter.updateMemory('a', currentId, { content: 'user edited truth' })
        expect(edit.action).not.toBe('noop')
        editedId = edit.memoryId
      } else if (mutation === 'archive') {
        expect(await presenter.archiveUserMemory('a', currentId)).toBe(true)
      } else {
        expect(await presenter.deleteMemory('a', currentId)).toBe(true)
      }
      resolveDecision(
        '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"stale maintenance truth"}'
      )
      await pass

      expect(repo.getById(oldId)?.superseded_by).toBeNull()
      if (mutation === 'edit') {
        expect(repo.getById(editedId)?.content).toBe('user edited truth')
      } else if (mutation === 'archive') {
        expect(repo.getById(currentId)?.status).toBe('archived')
      } else {
        expect(repo.getById(currentId)).toBeUndefined()
      }
    }
  )

  it('warms a cold vector store before offline near-duplicate merging', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const now = 1_000 * DAY
    const generateText = routedLLM({
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user prefers redis"}'
    })
    const createVectorStore = vi.fn(async () => store)
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryService({
      repository: repo,
      resolveAgentConfig: () => embeddingConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      generateText,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'old',
      agentId: 'a',
      kind: 'semantic',
      content: 'alpha redis habit',
      status: 'embedded',
      createdAt: now - 2000
    })
    repo.seedLegacyStatus('old', 'embedded', {
      embeddingId: 'old',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    repo.insert({
      id: 'new',
      agentId: 'a',
      kind: 'semantic',
      content: 'beta redis habit',
      status: 'embedded',
      createdAt: now - 1000
    })
    repo.seedLegacyStatus('new', 'embedded', {
      embeddingId: 'new',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    await store.upsert([
      { memoryId: 'old', embedding: textToVector('alpha redis habit') },
      { memoryId: 'new', embedding: textToVector('beta redis habit') }
    ])
    getEmbeddings.mockClear()

    await presenter.runConsolidationPass('a', now)

    expect(createVectorStore).toHaveBeenCalledTimes(1)
    expect(getEmbeddings.mock.calls.map((call) => call[2])).not.toContainEqual([
      'alpha redis habit'
    ])
    expect(getEmbeddings.mock.calls.map((call) => call[2])).not.toContainEqual(['beta redis habit'])
    expect(repo.listByAgent('a')).toHaveLength(1)
    expect(repo.getById('old')?.superseded_by).toBe('new')
  })

  it('bounds stored-vector consolidation scans and resumes with a compound cursor', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
    })
    const { presenter, repo, store } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const queryByMemoryId = vi.spyOn(store, 'queryByMemoryId').mockResolvedValue([])
    for (let i = 0; i < 70; i += 1) {
      const id = `m-${String(i).padStart(2, '0')}`
      repo.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: `memory ${i}`,
        status: 'embedded',
        createdAt: now - 1000
      })
      repo.seedLegacyStatus(id, 'embedded', {
        embeddingId: id,
        embeddingDim: 4,
        embeddingModel: 'p:m'
      })
      store.vectors.set(id, textToVector(`memory ${i}`))
    }

    await presenter.runConsolidationPass('a', now)
    expect(queryByMemoryId).toHaveBeenCalledTimes(64)
    expect(decisionCalls(generateText)).toBe(0)

    await presenter.runConsolidationPass('a', now + 6 * 60 * 60 * 1000 + 1)
    expect(queryByMemoryId).toHaveBeenCalledTimes(70)
  })

  it('skips vector neighbor scans after earlier maintenance steps exhaust the token budget', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
    })
    const { presenter, store } = makeLLMPresenter(generateText)
    await seedEmbedded(presenter, 'user likes bounded maintenance')
    const queryByMemoryId = vi.spyOn(store, 'queryByMemoryId')
    vi.spyOn(
      memoryRuntimeForTests(presenter).conflictService,
      'runChallengeResolutionPass'
    ).mockImplementation(async (_agentId, _model, budget: MaintenanceBudget) => {
      for (let index = 0; index < 4; index += 1) {
        expect(budget.reserve('challenge', 6_000)).toBe(true)
      }
      return { touched: false, calls: 4, failures: 0 }
    })

    await presenter.runConsolidationPass('a', 1_000 * DAY)

    expect(queryByMemoryId).not.toHaveBeenCalled()
  })

  it('respects the cooldown: a second pass within the window does no LLM work (T-B5)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const firstId = await seedEmbedded(presenter, 'user likes redis a')
    const secondId = await seedEmbedded(presenter, 'user likes redis b')
    repo.rows.get(firstId)!.created_at = now
    repo.rows.get(secondId)!.created_at = now + 1
    await presenter.runConsolidationPass('a', now)
    const callsAfterFirst = generateText.mock.calls.length
    await presenter.runConsolidationPass('a', now + 60 * 1000)
    expect(generateText.mock.calls.length).toBe(callsAfterFirst)
  })

  it('does not advance the LLM cooldown when no consolidation model is available', async () => {
    const repo = createFakeRepository()
    const auditRepo = new FakeAuditRepository()
    const store = new FakeVectorStore()
    const generateText = routedLLM({
      decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
    })
    let agentDefaultModel: { providerId: string; modelId: string } | null = null
    const presenter = new MemoryService({
      repository: repo,
      auditRepository: auditRepo,
      resolveAgentConfig: () => ({
        memoryEnabled: true,
        memoryEmbedding: { providerId: 'p', modelId: 'm' },
        memoryExtractionModel: null
      }),
      resolveAgentDefaultModel: () => agentDefaultModel,
      getEmbeddings: async (_p, _m, texts) => texts.map((t) => textToVector(t)),
      generateText,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    const now = 1_000 * DAY
    const firstId = await seedEmbedded(presenter, 'user likes redis a')
    const secondId = await seedEmbedded(presenter, 'user likes redis b')
    repo.rows.get(firstId)!.created_at = now
    repo.rows.get(secondId)!.created_at = now + 1
    await presenter.runConsolidationPass('a', now)
    expect(decisionCalls(generateText)).toBe(0)
    expect(auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBeNull()
    expect(auditRepo.listByAgent('a')[0]).toMatchObject({
      event_type: 'memory/maintenance_llm',
      status: 'skipped',
      reason: 'missing-model'
    })

    agentDefaultModel = { providerId: 'default', modelId: 'default' }
    await presenter.runConsolidationPass('a', now + 1)
    expect(decisionCalls(generateText)).toBeGreaterThan(0)
    expect(auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBe(now + 1)
  })

  it('cheap maintenance during cooldown does not create row-level LLM stamps', async () => {
    const repo = createFakeRepository()
    const auditRepo = new FakeAuditRepository()
    const store = new FakeVectorStore()
    const generateText = routedLLM({
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"merged"}'
    })
    const now = 1_000 * DAY
    const first = new MemoryService({
      repository: repo,
      auditRepository: auditRepo,
      resolveAgentConfig: () => embeddingConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((t) => textToVector(t)),
      generateText,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    const memoryId = await seedEmbedded(first, 'user likes redis')
    repo.rows.get(memoryId)!.created_at = now
    repo.insert({
      id: 'stale',
      agentId: 'a',
      kind: 'semantic',
      content: 'old redis note',
      status: 'embedded',
      createdAt: now - 300 * DAY
    })
    first.refreshWorkingMemory('a')
    const workingId = [...repo.rows.values()].find((row) => row.kind === 'working')?.id
    expect(workingId).toBeTruthy()
    expect(repo.getLastConsolidatedAt('a')).toBeNull()

    auditRepo.insert({
      id: 'audit-existing',
      agentId: 'a',
      eventType: 'memory/maintenance_llm',
      actorType: 'scheduler',
      status: 'completed',
      createdAt: now
    })

    const restarted = new MemoryService({
      repository: repo,
      auditRepository: auditRepo,
      resolveAgentConfig: () => embeddingConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((t) => textToVector(t)),
      generateText,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    await restarted.runConsolidationPass('a', now + 60 * 1000)
    expect(decisionCalls(generateText)).toBe(0)
    expect(repo.getById(memoryId)?.last_consolidated_at).toBeNull()
    expect(repo.getById('stale')?.status).toBe('archived')
    expect(repo.getById('stale')?.last_consolidated_at).toBeNull()
    expect(repo.getById(workingId!)?.last_consolidated_at).toBeNull()
    expect(auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBe(now)
  })

  it('bounds the merge LLM calls per pass to the budget (T-B5)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
    })
    const { presenter } = makeLLMPresenter(generateText)
    for (let i = 0; i < 20; i += 1) {
      await seedEmbedded(presenter, `user likes redis variant ${i}`)
    }
    generateText.mockClear()
    await presenter.runConsolidationPass('a', 1_000 * DAY)
    // Every iteration finds a mergeable neighbor, so the pass consumes the full budget exactly once.
    expect(decisionCalls(generateText)).toBe(2)
  })

  it('limits heavy maintenance to two agents while a third waits fairly', async () => {
    const repo = createFakeRepository()
    let active = 0
    let maxActive = 0
    let started = 0
    let release!: () => void
    let resolveFirstPair!: () => void
    const firstPairStarted = new Promise<void>((resolve) => {
      resolveFirstPair = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const generateText = vi.fn(async (_providerId: string, _modelId: string, prompt: string) => {
      if (!prompt.includes('durable, high-level insights')) return '[]'
      active += 1
      started += 1
      maxActive = Math.max(maxActive, active)
      if (started === 2) resolveFirstPair()
      await gate
      active -= 1
      return '[]'
    })
    const presenter = new MemoryService({
      repository: repo,
      resolveAgentConfig: () => ({
        memoryEnabled: true,
        memoryExtractionModel: { providerId: 'p', modelId: 'm' }
      }),
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    try {
      for (const agentId of ['a', 'b', 'c']) {
        presenter.writeMemoriesSync(
          Array.from({ length: 6 }, (_, index) => ({
            kind: 'semantic' as const,
            content: `${agentId} fact ${index}`,
            importance: 0.9
          })),
          { agentId }
        )
      }

      const passes = ['a', 'b', 'c'].map((agentId) =>
        presenter.runConsolidationPass(agentId, 1_000 * DAY)
      )
      await firstPairStarted
      expect(started).toBe(2)
      expect(maxActive).toBe(2)

      release()
      await Promise.all(passes)
      expect(started).toBe(3)
      expect(maxActive).toBe(2)
    } finally {
      await presenter.dispose()
    }
  })

  it('records failed maintenance and throttles heavy passes when every LLM call fails', async () => {
    const generateText = routedLLM({ throwDecision: true })
    const { presenter, repo, auditRepo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const firstId = await seedEmbedded(presenter, 'user likes redis a')
    const secondId = await seedEmbedded(presenter, 'user likes redis b')
    repo.rows.get(firstId)!.created_at = now
    repo.rows.get(secondId)!.created_at = now + 1

    await presenter.runConsolidationPass('a', now)
    const callsAfterFailure = decisionCalls(generateText)
    expect(callsAfterFailure).toBeGreaterThan(0)
    expect(auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBeNull()
    expect(auditRepo.listByAgent('a')[0]).toMatchObject({
      event_type: 'memory/maintenance_llm',
      status: 'failed',
      reason: 'all-llm-steps-failed'
    })
    expect(repo.getLastConsolidatedAt('a')).toBeNull()

    await presenter.runConsolidationPass('a', now + 5 * 60 * 1000)
    expect(decisionCalls(generateText)).toBe(callsAfterFailure)
    expect(auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBeNull()

    await presenter.runConsolidationPass('a', now + 31 * 60 * 1000)
    expect(decisionCalls(generateText)).toBeGreaterThan(callsAfterFailure)
    expect(auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBeNull()
  })

  it('does not keep completed cooldown when heavy maintenance aborts after memory is disabled', async () => {
    const config: DeepChatAgentConfig = { ...embeddingConfig }
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('Choose exactly ONE decision')) {
        config.memoryEnabled = false
        return '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
      }
      return ''
    })
    const { presenter, repo, auditRepo } = makeLLMPresenter(generateText, config)
    const now = 1_000 * DAY
    const firstId = await seedEmbedded(presenter, 'user likes redis a')
    const secondId = await seedEmbedded(presenter, 'user likes redis b')
    repo.rows.get(firstId)!.created_at = now
    repo.rows.get(secondId)!.created_at = now + 1

    await presenter.runConsolidationPass('a', now)
    expect(decisionCalls(generateText)).toBe(1)
    expect(auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBeNull()

    config.memoryEnabled = true
    await presenter.runConsolidationPass('a', now + 60 * 1000)

    expect(decisionCalls(generateText)).toBeGreaterThan(1)
    expect(auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBeNull()
  })

  it('does not archive a just-merged old row in the same pass (T-B5)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user prefers redis"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const oldId = await seedEmbedded(presenter, 'user likes redis a')
    const newId = await seedEmbedded(presenter, 'user likes redis b')
    // Both rows are old and never accessed: without the merge re-anchoring the survivor's clock,
    // refreshDecayScores + archiveStale would archive it in the same pass.
    repo.rows.get(oldId)!.created_at = now - 201 * DAY
    repo.rows.get(newId)!.created_at = now - 200 * DAY

    await presenter.runConsolidationPass('a', now)
    const survivor = repo.getById(newId)
    expect(survivor?.superseded_by).toBeNull()
    expect(survivor?.status).not.toBe('archived')
  })

  it('NOOP leaves both near-duplicates intact instead of superseding one (T-B5)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const id1 = await seedEmbedded(presenter, 'user likes redis a')
    const id2 = await seedEmbedded(presenter, 'user likes redis b')
    repo.rows.get(id1)!.created_at = now - 2000
    repo.rows.get(id2)!.created_at = now - 1000

    await presenter.runConsolidationPass('a', now)
    expect(repo.listByAgent('a')).toHaveLength(2)
    expect(repo.getById(id1)?.superseded_by).toBeNull()
    expect(repo.getById(id2)?.superseded_by).toBeNull()
  })

  it('does not apply an oversized model-generated maintenance merge', async () => {
    const generateText = routedLLM({
      decision: JSON.stringify({
        decision: 'UPDATE',
        targetIndex: 0,
        mergedContent: 'x'.repeat(2_001)
      })
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const firstId = await seedEmbedded(presenter, 'user likes redis a')
    const secondId = await seedEmbedded(presenter, 'user likes redis b')
    repo.rows.get(firstId)!.created_at = now - 2_000
    repo.rows.get(secondId)!.created_at = now - 1_000

    await presenter.runConsolidationPass('a', now)

    expect(repo.getById(firstId)?.superseded_by).toBeNull()
    expect(repo.getById(secondId)?.superseded_by).toBeNull()
    expect(repo.listByAgent('a')).toHaveLength(2)
  })

  it('a pass re-run after the cooldown does not merge an already-merged pair again (T-B5)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user prefers redis"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const oldId = await seedEmbedded(presenter, 'user likes redis a')
    const newId = await seedEmbedded(presenter, 'user likes redis b')
    repo.rows.get(oldId)!.created_at = now - 2000
    repo.rows.get(newId)!.created_at = now - 1000

    await presenter.runConsolidationPass('a', now)
    expect(repo.listByAgent('a')).toHaveLength(1)
    expect(repo.getById(oldId)?.superseded_by).toBe(newId)

    const callsAfterFirst = decisionCalls(generateText)
    await presenter.runConsolidationPass('a', now + 6 * 60 * 60 * 1000 + 1)
    expect(repo.listByAgent('a')).toHaveLength(1)
    expect(repo.getById(oldId)?.superseded_by).toBe(newId)
    expect(repo.getById(newId)?.superseded_by).toBeNull()
    expect(decisionCalls(generateText)).toBe(callsAfterFirst)
  })

  it('merge carries forward the higher importance of the pair (T-B5)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers redis"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const oldId = await seedEmbedded(presenter, 'user likes redis a')
    const newId = await seedEmbedded(presenter, 'user likes redis b')
    repo.rows.get(oldId)!.created_at = now - 2000
    repo.rows.get(oldId)!.importance = 0.9
    repo.rows.get(newId)!.created_at = now - 1000
    repo.rows.get(newId)!.importance = 0.2

    await presenter.runConsolidationPass('a', now)
    expect(repo.getById(newId)?.superseded_by).toBeNull()
    expect(repo.getById(newId)?.importance).toBe(0.9)
  })

  it('does not write secondary category onto a reflection merge survivor', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user likes redis"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    repo.insert({
      id: 'semantic-secondary',
      agentId: 'a',
      kind: 'semantic',
      category: 'project_fact',
      content: 'user likes redis semantic',
      importance: 0.7,
      status: 'pending_embedding',
      createdAt: now - 2000
    })
    repo.insert({
      id: 'reflection-primary',
      agentId: 'a',
      kind: 'reflection',
      content: 'user likes redis reflection',
      importance: 0.8,
      status: 'pending_embedding',
      createdAt: now - 1000
    })
    await presenter.processPendingEmbeddings('a')

    await presenter.runConsolidationPass('a', now)

    expect(repo.getById('reflection-primary')?.superseded_by).toBeNull()
    expect(repo.getById('reflection-primary')?.category).toBeNull()
    expect(repo.getById('semantic-secondary')?.superseded_by).toBe('reflection-primary')
  })

  it('absorbs secondary category into an uncategorized atomic merge survivor', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user likes redis"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    repo.insert({
      id: 'categorized-secondary',
      agentId: 'a',
      kind: 'semantic',
      category: 'project_fact',
      content: 'user likes redis project',
      status: 'pending_embedding',
      createdAt: now - 2000
    })
    repo.insert({
      id: 'uncategorized-primary',
      agentId: 'a',
      kind: 'semantic',
      content: 'user likes redis current',
      status: 'pending_embedding',
      createdAt: now - 1000
    })
    await presenter.processPendingEmbeddings('a')

    await presenter.runConsolidationPass('a', now)

    expect(repo.getById('uncategorized-primary')?.category).toBe('project_fact')
    expect(repo.getById('categorized-secondary')?.superseded_by).toBe('uncategorized-primary')
  })

  it('preserves existing category on an atomic merge survivor', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user likes redis"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    repo.insert({
      id: 'project-secondary',
      agentId: 'a',
      kind: 'semantic',
      category: 'project_fact',
      content: 'user likes redis project',
      status: 'pending_embedding',
      createdAt: now - 2000
    })
    repo.insert({
      id: 'preference-primary',
      agentId: 'a',
      kind: 'semantic',
      category: 'user_preference',
      content: 'user likes redis preference',
      status: 'pending_embedding',
      createdAt: now - 1000
    })
    await presenter.processPendingEmbeddings('a')

    await presenter.runConsolidationPass('a', now)

    expect(repo.getById('preference-primary')?.category).toBe('user_preference')
    expect(repo.getById('project-secondary')?.superseded_by).toBe('preference-primary')
  })

  it('the cooldown survives a fresh presenter via the completed maintenance audit (T-B5)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user prefers redis"}'
    })
    const first = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const oldId = await seedEmbedded(first.presenter, 'user likes redis a')
    const newId = await seedEmbedded(first.presenter, 'user likes redis b')
    first.repo.rows.get(oldId)!.created_at = now - 2000
    first.repo.rows.get(newId)!.created_at = now - 1000
    await first.presenter.runConsolidationPass('a', now)

    expect(first.auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBe(now)

    const restarted = makeLLMPresenter(generateText, embeddingConfig, first.repo, first.auditRepo)
    const callsBefore = decisionCalls(generateText)
    await restarted.presenter.runConsolidationPass('a', now + 60 * 1000)
    expect(decisionCalls(generateText)).toBe(callsBefore)
  })

  it('debounces a burst of extractions into one pass; dispose cancels the armed timer (AC-4.2)', async () => {
    vi.useFakeTimers()
    try {
      let extracted = 0
      const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
        if (prompt.includes('KEEP or SKIP')) return 'KEEP'
        if (prompt.includes('JSON array')) {
          extracted += 1
          return `[{"kind":"semantic","content":"fact ${extracted}","importance":0.5}]`
        }
        if (prompt.includes('Choose exactly ONE decision')) {
          return '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
        }
        return ''
      })
      const { presenter } = makeLLMPresenter(generateText)
      const passSpy = vi.spyOn(presenter, 'runConsolidationPass').mockResolvedValue()

      const span = (text: string) => ({
        agentId: 'a',
        spanText: text,
        model: { providerId: 'main', modelId: 'main' }
      })
      await presenter.extractAndStore(span('User: one'))
      await presenter.extractAndStore(span('User: two'))
      expect(passSpy).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(passSpy).toHaveBeenCalledTimes(1)

      passSpy.mockClear()
      await presenter.extractAndStore(span('User: three'))
      await presenter.dispose()
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(passSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an earlier write debounce when a config arm would fire later (SDD-13)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    try {
      let extracted = 0
      const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
        if (prompt.includes('KEEP or SKIP')) return 'KEEP'
        if (prompt.includes('JSON array')) {
          extracted += 1
          return `[{"kind":"semantic","content":"fact ${extracted}","importance":0.5}]`
        }
        if (prompt.includes('Choose exactly ONE decision')) {
          return '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
        }
        return ''
      })
      const { presenter } = makeLLMPresenter(generateText)
      const passSpy = vi.spyOn(presenter, 'runConsolidationPass').mockResolvedValue()

      await presenter.extractAndStore({
        agentId: 'a',
        spanText: 'User: one',
        model: { providerId: 'main', modelId: 'main' }
      })
      await vi.advanceTimersByTimeAsync(60 * 1000)

      presenter.onAgentMemoryMaintenanceConfigChanged('a')

      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 - 1)
      expect(passSpy).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(passSpy.mock.calls.map(([agentId]) => agentId)).toEqual(['a'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('arms startup maintenance once with deterministic stagger and no periodic sweep (SDD-13)', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      repo.rows.set('a1', makeRow('a1', { agent_id: 'agent-a' }))
      repo.rows.set('b1', makeRow('b1', { agent_id: 'agent-b' }))
      repo.rows.set('disabled1', makeRow('disabled1', { agent_id: 'disabled' }))
      repo.rows.set('orphan1', makeRow('orphan1', { agent_id: 'orphan' }))
      repo.rows.set('archived1', makeRow('archived1', { agent_id: 'archived', status: 'archived' }))

      const presenter = new MemoryService({
        repository: repo,
        resolveAgentConfig: (agentId) =>
          agentId === 'disabled' ? { memoryEnabled: false } : enabledConfig,
        isManagedAgent: (agentId) => agentId !== 'orphan',
        getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
        generateText: async () => '',
        createVectorStore: async () => new FakeVectorStore(),
        resetVectorStore: async () => undefined
      })
      const passSpy = vi.spyOn(presenter, 'runConsolidationPass').mockResolvedValue()

      presenter.startBackgroundMaintenance()
      presenter.startBackgroundMaintenance()

      await vi.advanceTimersByTimeAsync(60 * 1000 + 5 * 60 * 1000 - 1)
      expect(passSpy).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(passSpy.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-a'])

      await vi.advanceTimersByTimeAsync(5 * 1000)
      expect(passSpy.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-a', 'agent-b'])

      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect(passSpy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('prewarms enabled active agents before the delayed maintenance arm', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      repo.insert({
        id: 'a1',
        agentId: 'agent-a',
        kind: 'semantic',
        content: 'redis fact',
        status: 'embedded'
      })
      repo.seedLegacyStatus('a1', 'embedded', {
        embeddingId: 'a1',
        embeddingDim: 4,
        embeddingModel: 'p:m'
      })
      repo.insert({
        id: 'b1',
        agentId: 'agent-b',
        kind: 'semantic',
        content: 'vue fact',
        status: 'embedded'
      })
      repo.seedLegacyStatus('b1', 'embedded', {
        embeddingId: 'b1',
        embeddingDim: 4,
        embeddingModel: 'p:m'
      })
      repo.insert({
        id: 'disabled1',
        agentId: 'disabled',
        kind: 'semantic',
        content: 'disabled fact',
        status: 'fts_only'
      })
      const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
        texts.map((text) => textToVector(text))
      )
      const createVectorStore = vi.fn(async (agentId: string) => {
        const store = new FakeVectorStore()
        if (agentId === 'agent-a') store.vectors.set('a1', textToVector('redis fact'))
        if (agentId === 'agent-b') store.vectors.set('b1', textToVector('vue fact'))
        return store
      })
      const presenter = new MemoryService({
        repository: repo,
        resolveAgentConfig: (agentId) =>
          agentId === 'disabled' ? { memoryEnabled: false } : enabledConfig,
        getEmbeddings,
        getDimensions: embeddingDimensions,
        generateText: async () => '',
        createVectorStore,
        resetVectorStore: async () => undefined
      })

      presenter.warmActiveAgents()
      await vi.advanceTimersByTimeAsync(0)
      await flushMicrotasks()
      expect(createVectorStore.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-a'])
      expect(getEmbeddings).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1500)
      await flushMicrotasks()
      expect(createVectorStore.mock.calls.map(([agentId]) => agentId)).toEqual([
        'agent-a',
        'agent-b'
      ])
      // The provider/model connection is shared process-wide even though each agent opens its
      // own vector store.
      expect(getEmbeddings).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels pending prewarm timers when an agent is deleted', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      for (const [agentId, content] of [
        ['agent-a', 'redis fact'],
        ['agent-b', 'vue fact']
      ] as const) {
        repo.insert({
          id: `${agentId}-memory`,
          agentId,
          kind: 'semantic',
          content,
          status: 'fts_only'
        })
      }
      const createVectorStore = vi.fn(
        async (
          _agentId: string,
          _embedding: { providerId: string; modelId: string },
          _dimensions: number
        ) => new FakeVectorStore()
      )
      const resetVectorStore = vi.fn(async () => undefined)
      const presenter = new MemoryService({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
        getDimensions: embeddingDimensions,
        generateText: async () => '',
        createVectorStore,
        resetVectorStore
      })

      presenter.warmActiveAgents()
      await vi.advanceTimersByTimeAsync(0)
      await flushMicrotasks()
      expect(createVectorStore.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-a'])

      await presenter.cleanupDeletedAgentResources('agent-b')
      await vi.advanceTimersByTimeAsync(1500)
      await flushMicrotasks()

      expect(resetVectorStore).toHaveBeenCalledWith('agent-b')
      expect(createVectorStore.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-a'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not arm startup maintenance after dispose during the startup delay (SDD-13)', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      repo.rows.set('a1', makeRow('a1', { agent_id: 'agent-a' }))
      const listSpy = vi.spyOn(repo, 'listAgentIdsWithMemories')
      const presenter = new MemoryService({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
        generateText: async () => '',
        createVectorStore: async () => new FakeVectorStore(),
        resetVectorStore: async () => undefined
      })
      const passSpy = vi.spyOn(presenter, 'runConsolidationPass').mockResolvedValue()

      presenter.startBackgroundMaintenance()
      await presenter.dispose()
      await vi.advanceTimersByTimeAsync(60 * 1000 + 5 * 60 * 1000)

      expect(listSpy).not.toHaveBeenCalled()
      expect(passSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips startup maintenance when active-agent enumeration fails (SDD-13)', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      vi.spyOn(repo, 'listAgentIdsWithMemories').mockImplementation(() => {
        throw new Error('repo unavailable')
      })
      const presenter = new MemoryService({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
        generateText: async () => '',
        createVectorStore: async () => new FakeVectorStore(),
        resetVectorStore: async () => undefined
      })
      const passSpy = vi.spyOn(presenter, 'runConsolidationPass').mockResolvedValue()

      presenter.startBackgroundMaintenance()
      await vi.advanceTimersByTimeAsync(60 * 1000 + 5 * 60 * 1000)

      expect(passSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets a non-write config arm replace a later pending arm (SDD-13)', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      repo.rows.set('a1', makeRow('a1', { agent_id: 'agent-a' }))
      repo.rows.set('b1', makeRow('b1', { agent_id: 'agent-b' }))
      const presenter = new MemoryService({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
        generateText: async () => '',
        createVectorStore: async () => new FakeVectorStore(),
        resetVectorStore: async () => undefined
      })
      const passSpy = vi.spyOn(presenter, 'runConsolidationPass').mockResolvedValue()

      presenter.onAgentMemoryMaintenanceConfigChanged('agent-a')
      presenter.onAgentMemoryMaintenanceConfigChanged('agent-b')

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(passSpy.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-a', 'agent-b'])

      await vi.advanceTimersByTimeAsync(5 * 1000)
      expect(passSpy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('synchronizes lazy admission across runtime and vector identity only once', async () => {
    let config = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'provider-a', modelId: 'model-a' }
    } as DeepChatAgentConfig
    const presenter = new MemoryService({
      repository: createFakeRepository(),
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      generateText: async () => '',
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    const original = presenter.captureExecutionToken('agent-a')

    config = {
      ...config,
      memoryEmbedding: { providerId: 'provider-b', modelId: 'model-b' }
    }
    const changed = presenter.captureExecutionToken('agent-a')
    presenter.onAgentMemoryMaintenanceConfigChanged('agent-a')
    const afterNotification = presenter.captureExecutionToken('agent-a')

    expect(changed.generation).toBe(original.generation + 1)
    expect(afterNotification.generation).toBe(changed.generation)
    expect(presenter.canContinueExecution(changed)).toBe(true)
    await presenter.dispose()
  })

  it('arms memory config changes only for agents with active memory (SDD-13)', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      repo.rows.set('a1', makeRow('a1', { agent_id: 'agent-a' }))
      repo.rows.set('disabled1', makeRow('disabled1', { agent_id: 'disabled' }))
      repo.rows.set('orphan1', makeRow('orphan1', { agent_id: 'orphan' }))
      repo.rows.set('archived1', makeRow('archived1', { agent_id: 'archived', status: 'archived' }))
      const presenter = new MemoryService({
        repository: repo,
        resolveAgentConfig: (agentId) =>
          agentId === 'disabled' ? { memoryEnabled: false } : enabledConfig,
        isManagedAgent: (agentId) => agentId !== 'orphan',
        getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
        generateText: async () => '',
        createVectorStore: async () => new FakeVectorStore(),
        resetVectorStore: async () => undefined
      })
      const passSpy = vi.spyOn(presenter, 'runConsolidationPass').mockResolvedValue()

      presenter.onAgentMemoryMaintenanceConfigChanged('empty')
      presenter.onAgentMemoryMaintenanceConfigChanged('archived')
      presenter.onAgentMemoryMaintenanceConfigChanged('disabled')
      presenter.onAgentMemoryMaintenanceConfigChanged('orphan')
      presenter.onAgentMemoryMaintenanceConfigChanged('agent-a')

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(passSpy.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-a'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not arm memory config changes after dispose (SDD-13)', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      repo.rows.set('a1', makeRow('a1', { agent_id: 'agent-a' }))
      const listSpy = vi.spyOn(repo, 'listAgentIdsWithMemories')
      const presenter = new MemoryService({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
        generateText: async () => '',
        createVectorStore: async () => new FakeVectorStore(),
        resetVectorStore: async () => undefined
      })
      const passSpy = vi.spyOn(presenter, 'runConsolidationPass').mockResolvedValue()

      await presenter.dispose()
      presenter.onAgentMemoryMaintenanceConfigChanged('agent-a')
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 5 * 1000)

      expect(listSpy).not.toHaveBeenCalled()
      expect(passSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not advance cooldown on missing-model skip and can be re-armed later (SDD-13)', async () => {
    vi.useFakeTimers()
    try {
      const repo = createFakeRepository()
      const auditRepo = new FakeAuditRepository()
      const store = new FakeVectorStore()
      const generateText = routedLLM({
        decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
      })
      let agentDefaultModel: { providerId: string; modelId: string } | null = null
      const presenter = new MemoryService({
        repository: repo,
        auditRepository: auditRepo,
        resolveAgentConfig: () => ({
          memoryEnabled: true,
          memoryEmbedding: { providerId: 'p', modelId: 'm' },
          memoryExtractionModel: null
        }),
        resolveAgentDefaultModel: () => agentDefaultModel,
        getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
        generateText,
        createVectorStore: async () => store,
        resetVectorStore: async () => undefined
      })

      const now = 1_000 * DAY
      const firstId = await seedEmbedded(presenter, 'user likes redis a')
      const secondId = await seedEmbedded(presenter, 'user likes redis b')
      repo.rows.get(firstId)!.created_at = now
      repo.rows.get(secondId)!.created_at = now + 1

      await presenter.runConsolidationPass('a', now)
      expect(auditRepo.listByAgent('a')[0]).toMatchObject({
        event_type: 'memory/maintenance_llm',
        status: 'skipped',
        reason: 'missing-model'
      })
      expect(auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBeNull()

      const retryAt = now + 1
      vi.setSystemTime(retryAt)
      agentDefaultModel = { providerId: 'default', modelId: 'default' }
      presenter.onAgentMemoryMaintenanceConfigChanged('a')
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(decisionCalls(generateText)).toBeGreaterThan(0)
      expect(auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBe(
        retryAt + 5 * 60 * 1000
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not run for a disabled agent (T-B6)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"x"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText, {
      memoryEnabled: false,
      memoryEmbedding: { providerId: 'p', modelId: 'm' },
      memoryExtractionModel: { providerId: 'cheap', modelId: 'cheap' }
    })
    repo.rows.set('m1', makeRow('m1', { agent_id: 'a', content: 'a', status: 'embedded' }))
    repo.rows.set('m2', makeRow('m2', { agent_id: 'a', content: 'b', status: 'embedded' }))

    await presenter.runConsolidationPass('a', 1_000 * DAY)
    expect(generateText).not.toHaveBeenCalled()
    expect(repo.listByAgent('a')).toHaveLength(2)
  })
})
