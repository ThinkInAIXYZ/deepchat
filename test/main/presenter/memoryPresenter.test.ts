import { describe, expect, it, vi } from 'vitest'

import {
  MemoryPresenter as BaseMemoryPresenter,
  appendMemorySection,
  buildMemorySection,
  isSafeAgentId
} from '@/presenter/memoryPresenter'
import {
  buildLegacyMemoryProvenanceKey,
  buildMemoryProvenanceKey,
  decayScore,
  distanceToSimilarity,
  fuse,
  parseSourceEntryIds,
  recencyScore,
  resolveRetrieval,
  retrievalScore
} from '@/presenter/memoryPresenter/core/scoring'
import { WORKING_PROVENANCE_SEED } from '@/presenter/memoryPresenter/runtimeConstants'
import {
  FTS_SIMILARITY_BASELINE,
  type AgentMemoryRow,
  type IMemoryVectorStore,
  type MemoryVectorMatch
} from '@/presenter/memoryPresenter/types'
import type { VectorReadyCertificate } from '@/presenter/memoryPresenter/infra/vectorStoreManager'
import type { MaintenanceBudget } from '@/presenter/memoryPresenter/core/maintenanceBudget'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import { createEmptyMemoryHealth } from '@shared/contracts/routes'
import {
  enabledConfig,
  FakeAuditRepository,
  FakeRepository,
  FakeVectorStore,
  makePresenter,
  textToVector
} from './fakes/memoryFakes'

class MemoryPresenter extends BaseMemoryPresenter {
  constructor(deps: ConstructorParameters<typeof BaseMemoryPresenter>[0]) {
    super({ executeWithRateLimit: vi.fn(async () => undefined), ...deps })
  }
}

const embeddingDimensions = async () => ({
  data: { dimensions: textToVector('').length, normalized: false }
})

async function waitForMemoryCondition(
  condition: () => boolean,
  message = 'memory background condition was not met'
): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

async function flushMicrotasks(cycles = 3): Promise<void> {
  for (let i = 0; i < cycles; i += 1) {
    await Promise.resolve()
  }
}

type MemoryPresenterRuntimeTestSeams = {
  embedding: {
    warmEmbeddingConnection(
      agentId: string,
      embedding: { providerId: string; modelId: string }
    ): void
    getMutableRuntimeStateForTests(): {
      embeddingWarmups: Map<string, Promise<void>>
      vectorStoreWarmups: Map<string, Promise<void>>
      vectorStoreDimensionFailures: Map<string, number>
      embeddingDrains: Map<string, Promise<unknown>>
      reindexing: Map<string, Promise<void>>
      backfilling: Map<string, Promise<void>>
      errorRetryAt: Map<string, number>
      errorRetryAfterId: Map<string, string | null>
    }
  }
  vectorStore: {
    clearReady(agentId: string): void
    closeAgentStore(agentId: string): Promise<void>
    getMutableRuntimeStateForTests(): {
      vectorStores: Map<string, Promise<IMemoryVectorStore>>
      vectorStoreIdentities: Map<string, string>
      vectorStoreReady: Map<string, VectorReadyCertificate>
      vectorStoreLocks: Map<string, Promise<unknown>>
    }
  }
  maintenance: {
    getMutableRuntimeStateForTests(): {
      consolidationTimers: Map<string, NodeJS.Timeout>
      lastConsolidationAt: Map<string, number>
    }
  }
  reflection: {
    getMutableRuntimeStateForTests(): { reflectionAttemptWatermark: Map<string, number> }
  }
  persona: {
    getMutableRuntimeStateForTests(): {
      personaAttemptWatermark: Map<string, number>
      personaLocks: Map<string, Promise<unknown>>
    }
  }
  workingMemory: {
    getMutableRuntimeStateForTests(): { workingRefreshInFlight: Set<string> }
  }
  conflict: {
    repairConflictIntegrity(agentId: string): {
      repairedTargets: number
      archivedChallengers: number
      clearedTargets: number
      clearedLinks: number
    }
  }
}

function memoryRuntimeForTests(presenter: MemoryPresenter) {
  const internals = presenter as unknown as MemoryPresenterRuntimeTestSeams
  return {
    embeddingService: internals.embedding,
    vectorStoreService: internals.vectorStore,
    conflictService: internals.conflict,
    ...internals.embedding.getMutableRuntimeStateForTests(),
    ...internals.vectorStore.getMutableRuntimeStateForTests(),
    ...internals.maintenance.getMutableRuntimeStateForTests(),
    ...internals.reflection.getMutableRuntimeStateForTests(),
    ...internals.persona.getMutableRuntimeStateForTests(),
    ...internals.workingMemory.getMutableRuntimeStateForTests(),
    warmEmbeddingConnection: (
      agentId: string,
      embedding: { providerId: string; modelId: string }
    ) => internals.embedding.warmEmbeddingConnection(agentId, embedding),
    clearVectorStoreReady: (agentId: string) => internals.vectorStore.clearReady(agentId)
  }
}

describe('memory repository fakes', () => {
  it('matches AgentMemoryTable list limit lower-clamp behavior without an upper cap', () => {
    const repo = new FakeRepository()
    for (let index = 0; index < 3; index += 1) {
      repo.insert({
        id: `m${index}`,
        agentId: 'a',
        kind: 'semantic',
        content: `memory ${index}`,
        status: 'embedded',
        createdAt: index
      })
    }

    expect(repo.listByAgent('a')).toHaveLength(3)
    expect(repo.listByAgent('a', { limit: 0 })).toHaveLength(1)
    expect(repo.listByAgent('a', { limit: -10 })).toHaveLength(1)
    expect(repo.listByAgent('a', { limit: 2.8 })).toHaveLength(2)
  })

  it('matches AgentMemoryTable targeted embedding metadata queries', () => {
    const repo = new FakeRepository()
    repo.insert({
      id: 'current',
      agentId: 'a',
      kind: 'semantic',
      content: 'current vector',
      createdAt: 2000
    })
    repo.updateStatus('current', 'embedded', {
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
    repo.updateStatus('wrong-dim', 'embedded', {
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
    repo.updateStatus('persona', 'embedded', {
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
    repo.updateStatus('working', 'embedded', {
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
    repo.updateStatus('superseded', 'embedded', {
      embeddingId: 'superseded',
      embeddingDim: 8,
      embeddingModel: 'legacy:m'
    })
    repo.markSuperseded(superseded.id, 'persona')

    expect(repo.getCurrentEmbeddingDimension('a', 'p:m')).toBe(4)
    expect(repo.hasStaleEmbeddings('a', 4, 'p:m')).toBe(true)
    expect(repo.hasStaleEmbeddings('a', 8, 'legacy:m')).toBe(true)
    expect(repo.getCurrentEmbeddingDimension('a', 'missing:m')).toBeNull()
    expect(repo.getCurrentEmbeddingDimension('excluded', 'legacy:m')).toBeNull()
    expect(repo.hasStaleEmbeddings('excluded', 4, 'p:m')).toBe(false)
  })

  it('matches AgentMemoryTable health category and top-accessed filters', () => {
    const repo = new FakeRepository()
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
    repo.markSuperseded(superseded.id, 'active')
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

  it('matches AgentMemoryTable current dimension tie-break for equal timestamps', () => {
    const repo = new FakeRepository()
    repo.insert({
      id: 'same-time-old',
      agentId: 'a',
      kind: 'semantic',
      content: 'older same timestamp',
      createdAt: 3000
    })
    repo.updateStatus('same-time-old', 'embedded', {
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
    repo.updateStatus('same-time-current', 'embedded', {
      embeddingId: 'same-time-current',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })

    expect(repo.getCurrentEmbeddingDimension('a', 'p:m')).toBe(4)
  })

  it('matches AgentMemoryAuditTable list limit defaults and caps', () => {
    const auditRepo = new FakeAuditRepository()
    for (let index = 0; index < 505; index += 1) {
      auditRepo.insert({
        id: `audit-${index}`,
        agentId: 'a',
        eventType: 'memory/test',
        actorType: 'system',
        status: 'completed',
        createdAt: index
      })
    }

    expect(auditRepo.listByAgent('a')).toHaveLength(100)
    expect(auditRepo.listByAgent('a', { limit: 0 })).toHaveLength(1)
    expect(auditRepo.listByAgent('a', { limit: 999 })).toHaveLength(500)
  })
})

describe('reflection rows (T3)', () => {
  it('participate in recall alongside atomic units', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'r1',
      agentId: 'deepchat',
      kind: 'reflection',
      content: 'the user works on redis backends',
      status: 'embedded',
      importance: 0.8
    })
    const results = await presenter.recall('deepchat', 'redis')
    expect(results.map((item) => item.id)).toContain('r1')
    expect(results.find((item) => item.id === 'r1')?.kind).toBe('reflection')
  })
})

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
    const repo = new FakeRepository()
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
    const repo = new FakeRepository()
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
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const { presenter } = makePresenter(enabledConfig, repo)
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
    const internals = memoryRuntimeForTests(presenter)
    const cachedStore = await internals.vectorStores.get('a')
    vi.spyOn(cachedStore ?? store, 'query').mockImplementation(async () => {
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
    const updateSpy = vi.spyOn(repo, 'updateContent')
    presenter.refreshWorkingMemory('deepchat')
    expect(updateSpy).not.toHaveBeenCalled()
    await presenter.buildInjection('deepchat', '')
    expect(repo.getById(workingRow.id)?.last_accessed).toBe(stamp)
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

function makeRow(id: string, overrides: Partial<AgentMemoryRow> = {}): AgentMemoryRow {
  return {
    id,
    agent_id: 'a',
    user_scope: null,
    kind: 'semantic',
    category: null,
    content: id,
    importance: 0.5,
    status: 'embedded',
    embedding_id: null,
    embedding_dim: null,
    embedding_model: null,
    source_session: null,
    provenance_key: null,
    is_anchor: 0,
    superseded_by: null,
    created_at: 1000,
    last_accessed: null,
    access_count: 0,
    decay_score: null,
    source_entry_ids: null,
    confidence: null,
    last_consolidated_at: null,
    conflict_state: null,
    conflict_with: null,
    persona_state: null,
    ...overrides
  }
}

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

  it('appends to existing prompt without overwriting', () => {
    const result = appendMemorySection('USER PROMPT', {
      selfModel: 'persona',
      memories: []
    })
    expect(result.startsWith('USER PROMPT')).toBe(true)
    expect(result).toContain('## Self-Model')
  })
})

describe('MemoryPresenter write + two-phase embedding', () => {
  it('writeMemoriesSync dedupes by provenance', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const first = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'user likes redis' }], {
      agentId: 'a'
    })
    const second = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'user   likes redis' }],
      { agentId: 'a' }
    )
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
    expect(repo.countByAgent('a')).toBe(1)
  })

  it('lazy re-keys a matching legacy provenance owner without bumping its decision revision', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const content = 'User likes Redis'
    repo.insert({
      id: 'legacy',
      agentId: 'a',
      kind: 'semantic',
      content,
      provenanceKey: buildLegacyMemoryProvenanceKey('a', 'semantic', content)
    })

    const created = presenter.writeMemoriesSync([{ kind: 'semantic', content }], { agentId: 'a' })

    expect(created).toEqual([])
    expect(repo.getById('legacy')).toMatchObject({
      provenance_key: buildMemoryProvenanceKey('a', 'semantic', content),
      decision_revision: 1
    })
    const restarted = makePresenter(enabledConfig, repo).presenter
    expect(restarted.writeMemoriesSync([{ kind: 'semantic', content }], { agentId: 'a' })).toEqual(
      []
    )
  })

  it('treats a legacy FNV collision with different v2-normalized content as a new memory', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const legacyContent = 'collision-149599'
    const collidingContent = 'collision-312382'
    expect(buildLegacyMemoryProvenanceKey('a', 'semantic', legacyContent)).toBe(
      buildLegacyMemoryProvenanceKey('a', 'semantic', collidingContent)
    )
    repo.insert({
      id: 'legacy-collision',
      agentId: 'a',
      kind: 'semantic',
      content: legacyContent,
      provenanceKey: buildLegacyMemoryProvenanceKey('a', 'semantic', legacyContent)
    })

    const created = presenter.writeMemoriesSync([{ kind: 'semantic', content: collidingContent }], {
      agentId: 'a'
    })

    expect(created).toHaveLength(1)
    expect(repo.countByAgent('a')).toBe(2)
    expect(repo.getById(created[0])?.provenance_key).toBe(
      buildMemoryProvenanceKey('a', 'semantic', collidingContent)
    )
  })

  it('revalidates an equivalent v2 owner after a lazy re-key UNIQUE race', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const content = 'User likes Redis'
    const legacyKey = buildLegacyMemoryProvenanceKey('a', 'semantic', content)
    const v2Key = buildMemoryProvenanceKey('a', 'semantic', content)
    repo.insert({
      id: 'legacy',
      agentId: 'a',
      kind: 'semantic',
      content,
      provenanceKey: legacyKey
    })
    const concurrent = repo.insert({
      id: 'concurrent',
      agentId: 'a',
      kind: 'semantic',
      content: '  User   likes Redis  '
    })
    const originalLookup = repo.getByProvenanceKey.bind(repo)
    let v2Reads = 0
    vi.spyOn(repo, 'getByProvenanceKey').mockImplementation((agentId, provenanceKey) => {
      if (provenanceKey !== v2Key) return originalLookup(agentId, provenanceKey)
      v2Reads += 1
      return v2Reads === 1 ? undefined : concurrent
    })
    vi.spyOn(repo, 'rekeyProvenance').mockImplementation(() => {
      throw new Error('UNIQUE constraint failed')
    })

    const created = presenter.writeMemoriesSync([{ kind: 'semantic', content }], { agentId: 'a' })

    expect(created).toEqual([])
    expect(repo.getById('legacy')?.provenance_key).toBe(legacyKey)
    expect(v2Reads).toBe(2)
  })

  it('does not accept a different-content v2 owner after a lazy re-key UNIQUE race', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const content = 'User likes Redis'
    const legacyKey = buildLegacyMemoryProvenanceKey('a', 'semantic', content)
    const v2Key = buildMemoryProvenanceKey('a', 'semantic', content)
    repo.insert({
      id: 'legacy',
      agentId: 'a',
      kind: 'semantic',
      content,
      provenanceKey: legacyKey
    })
    const concurrentCollision = repo.insert({
      id: 'concurrent-collision',
      agentId: 'a',
      kind: 'semantic',
      content: 'different content'
    })
    const originalLookup = repo.getByProvenanceKey.bind(repo)
    let v2Reads = 0
    vi.spyOn(repo, 'getByProvenanceKey').mockImplementation((agentId, provenanceKey) => {
      if (provenanceKey !== v2Key) return originalLookup(agentId, provenanceKey)
      v2Reads += 1
      return v2Reads === 1 ? undefined : concurrentCollision
    })
    vi.spyOn(repo, 'rekeyProvenance').mockImplementation(() => {
      throw new Error('UNIQUE constraint failed')
    })

    const created = presenter.writeMemoriesSync([{ kind: 'semantic', content }], { agentId: 'a' })

    expect(created).toHaveLength(1)
    expect(repo.getById(created[0])?.content).toBe(content)
    expect(repo.getById('legacy')?.provenance_key).toBe(legacyKey)
    expect(repo.getById('concurrent-collision')?.content).toBe('different content')
    expect(v2Reads).toBe(2)
  })

  it('processPendingEmbeddings embeds and flips status to embedded', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const row = repo.listByAgent('a')[0]
    expect(row.status).toBe('embedded')
    expect(store.vectors.size).toBe(1)
  })

  it('degrades to fts_only when no embedding config', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true, memoryEmbedding: null })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(repo.listByAgent('a')[0].status).toBe('fts_only')
  })
})

describe('MemoryPresenter recall + injection', () => {
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
})

describe('MemoryPresenter guarded persona evolution', () => {
  it('evolvePersona writes a draft that is not active and not injected', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const draft = presenter.evolvePersona('a', 'a draft self-model', null)
    expect(repo.getById(draft!)?.persona_state).toBe('draft')
    expect(repo.getActivePersona('a')).toBeUndefined()
    const payload = await presenter.buildInjection('a', 'anything')
    expect(payload?.payload.selfModel ?? null).toBeNull()
  })

  it('evolvePersona refuses unmanaged or disabled agents', () => {
    const unmanagedRepo = new FakeRepository()
    const unmanagedPresenter = new MemoryPresenter({
      repository: unmanagedRepo,
      resolveAgentConfig: () => enabledConfig,
      isManagedAgent: () => false,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => {}
    })
    expect(unmanagedPresenter.evolvePersona('a', 'draft', null)).toBeNull()
    expect(unmanagedRepo.listPersonaVersions('a')).toHaveLength(0)

    const disabledRepo = new FakeRepository()
    const disabledPresenter = new MemoryPresenter({
      repository: disabledRepo,
      resolveAgentConfig: () => ({ memoryEnabled: false, personaEvolutionEnabled: true }),
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => {}
    })
    expect(disabledPresenter.evolvePersona('a', 'draft', null)).toBeNull()
    expect(disabledRepo.listPersonaVersions('a')).toHaveLength(0)
  })

  it('approve promotes the draft to active and supersedes the previous active', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    await presenter.approvePersonaDraft('a', v1!)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    // The pending draft is not yet injected.
    expect((await presenter.buildInjection('a', 'q'))?.payload.selfModel).toBe('v1')
    await presenter.approvePersonaDraft('a', v2!)
    expect(repo.getById(v1!)?.superseded_by).toBe(v2)
    expect(repo.getById(v1!)?.persona_state).toBe('superseded')
    expect(repo.getActivePersona('a')?.id).toBe(v2)
    expect((await presenter.buildInjection('a', 'q'))?.payload.selfModel).toBe('v2')
  })

  it('reject discards the draft and leaves the active persona unchanged', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    await presenter.approvePersonaDraft('a', v1!)
    const draft = presenter.evolvePersona('a', 'unwanted', null)
    expect(await presenter.rejectPersonaDraft('a', draft!)).toBe(true)
    expect(repo.getById(draft!)?.persona_state).toBe('rejected')
    expect(presenter.listPersonaDrafts('a')).toHaveLength(0)
    expect(repo.getActivePersona('a')?.content).toBe('v1')
  })

  it('approving anchored active still replaces it (explicit user action)', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    await presenter.approvePersonaDraft('a', v1!)
    expect(await presenter.setPersonaAnchor('a', v1!, true)).toBe(true)
    expect(repo.getById(v1!)?.is_anchor).toBe(1)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    await presenter.approvePersonaDraft('a', v2!)
    expect(repo.getActivePersona('a')?.id).toBe(v2)
    // The anchored predecessor is superseded, never left as a second active row (single-active invariant).
    expect(repo.getById(v1!)?.persona_state).toBe('superseded')
    expect(
      repo.listPersonaVersions('a').filter((row) => row.persona_state === 'active')
    ).toHaveLength(1)
  })

  it('rollback refuses while the current active is anchored', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    await presenter.approvePersonaDraft('a', v1!)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    await presenter.approvePersonaDraft('a', v2!)
    await presenter.setPersonaAnchor('a', v2!, true)
    expect(await presenter.rollbackPersona('a', v1!)).toBe(false)
    expect(repo.getActivePersona('a')?.id).toBe(v2)
    expect(repo.getById(v2!)?.superseded_by).toBeNull()
  })

  it('rollback re-activates a historical version when not anchored', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    await presenter.approvePersonaDraft('a', v1!)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    await presenter.approvePersonaDraft('a', v2!)
    expect(await presenter.rollbackPersona('a', v1!)).toBe(true)
    expect(repo.getActivePersona('a')?.id).toBe(v1)
    expect(repo.getById(v2!)?.superseded_by).toBe(v1)
  })

  it('rollback refuses a pending draft so an unapproved self-model cannot be activated', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const active = presenter.evolvePersona('a', 'approved', null)
    await presenter.approvePersonaDraft('a', active!)
    const draft = presenter.evolvePersona('a', 'unapproved draft', null)
    expect(repo.getById(draft!)?.persona_state).toBe('draft')
    expect(await presenter.rollbackPersona('a', draft!)).toBe(false)
    expect(repo.getById(draft!)?.persona_state).toBe('draft')
    expect(repo.getActivePersona('a')?.id).toBe(active)
  })

  it('rollback refuses a rejected version so a discarded self-model can never return', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const active = presenter.evolvePersona('a', 'approved', null)
    await presenter.approvePersonaDraft('a', active!)
    const draft = presenter.evolvePersona('a', 'rejected draft', null)
    await presenter.rejectPersonaDraft('a', draft!)
    expect(repo.getById(draft!)?.persona_state).toBe('rejected')
    expect(await presenter.rollbackPersona('a', draft!)).toBe(false)
    expect(repo.getById(draft!)?.persona_state).toBe('rejected')
    expect(repo.getActivePersona('a')?.id).toBe(active)
  })

  it('legacy persona rows (persona_state NULL) are interpreted by superseded_by', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({ id: 'old-active', agentId: 'a', kind: 'persona', content: 'old', createdAt: 10 })
    repo.insert({ id: 'old-super', agentId: 'a', kind: 'persona', content: 'older', createdAt: 20 })
    repo.markSuperseded('old-super', 'old-active')
    expect(presenter.getStatus('a').hasPersona).toBe(true)
    expect(repo.getActivePersona('a')?.id).toBe('old-active')
  })
})

describe('MemoryPresenter.maybeEvolvePersona (guarded, default off)', () => {
  const model = { providerId: 'p', modelId: 'm' }
  const seedUnits = (repo: FakeRepository, agentId: string, n: number, from = 2000): void => {
    for (let i = 0; i < n; i += 1) {
      repo.insert({
        id: `u-${agentId}-${i}`,
        agentId,
        kind: 'semantic',
        content: `durable fact number ${i}`,
        importance: 1,
        status: 'embedded',
        createdAt: from + i
      })
    }
  }
  const personaLLM = (text: string): ReturnType<typeof vi.fn> =>
    vi.fn(async (_p: string, _m: string, prompt: string) =>
      prompt.includes('stable self-model') ? text : ''
    )
  const makePersona = (config: DeepChatAgentConfig, generateText: ReturnType<typeof vi.fn>) => {
    const repo = new FakeRepository()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => {}
    })
    return { presenter, repo, generateText }
  }

  it('produces no draft and never calls the model when the flag is off (default)', async () => {
    const generateText = personaLLM('I am concise.')
    const { presenter, repo } = makePersona({ memoryEnabled: true }, generateText)
    seedUnits(repo, 'a', 6)
    expect(await presenter.maybeEvolvePersona('a', model)).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
    expect(presenter.listPersonaDrafts('a')).toHaveLength(0)
  })

  it('stays off while memory stays on (decoupled switches)', async () => {
    const generateText = personaLLM('I am concise.')
    const { presenter, repo } = makePersona(
      { memoryEnabled: true, personaEvolutionEnabled: false },
      generateText
    )
    seedUnits(repo, 'a', 6)
    expect(await presenter.maybeEvolvePersona('a', model)).toBeNull()
    // Memory recall still works with the flag off.
    expect((await presenter.recall('a', 'durable fact')).length).toBeGreaterThan(0)
  })

  it('writes a draft once enough importance accumulates; the draft is not injected', async () => {
    const generateText = personaLLM('I am concise and technical.')
    const { presenter, repo } = makePersona(
      { memoryEnabled: true, personaEvolutionEnabled: true },
      generateText
    )
    seedUnits(repo, 'a', 6)
    const result = await presenter.maybeEvolvePersona('a', model)
    expect(result?.draftId).toBeTruthy()
    expect(result?.needsReview).toBe(false)
    expect(repo.getById(result!.draftId)?.persona_state).toBe('draft')
    expect(repo.getActivePersona('a')).toBeUndefined()
    expect((await presenter.buildInjection('a', 'q'))?.payload.selfModel ?? null).toBeNull()
  })

  it('does not write a draft when the agent is deleted during persona generation', async () => {
    let managed = true
    let resolveText!: (value: string) => void
    const generateText = vi.fn(
      async () =>
        new Promise<string>((resolve) => {
          resolveText = resolve
        })
    )
    const repo = new FakeRepository()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true, personaEvolutionEnabled: true }),
      isManagedAgent: () => managed,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => {}
    })
    seedUnits(repo, 'a', 6)

    const pending = presenter.maybeEvolvePersona('a', model)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(generateText).toHaveBeenCalledTimes(1)

    managed = false
    resolveText('I am concise and technical.')

    expect(await pending).toBeNull()
    expect(repo.listPersonaVersions('a')).toHaveLength(0)
  })

  it('does not write a draft when memories are cleared during persona generation', async () => {
    let resolveText!: (value: string) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const generateText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveText = resolve
          markStarted()
        })
    )
    const repo = new FakeRepository()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true, personaEvolutionEnabled: true }),
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    seedUnits(repo, 'a', 6)

    const pending = presenter.maybeEvolvePersona('a', model)
    await started
    expect(await presenter.clearMemories('a')).toBe(6)
    resolveText('I am concise and technical.')

    await expect(pending).resolves.toBeNull()
    expect(repo.countByAgent('a')).toBe(0)
  })

  it('flags needsReview when the draft drifts far from the active self-model', async () => {
    const generateText = personaLLM(
      'I am a wholly different self-model that bears no resemblance to before.'
    )
    const { presenter, repo } = makePersona(
      { memoryEnabled: true, personaEvolutionEnabled: true },
      generateText
    )
    const v1 = presenter.evolvePersona('a', 'short', null)
    await presenter.approvePersonaDraft('a', v1!)
    seedUnits(repo, 'a', 6, 3000)
    const result = await presenter.maybeEvolvePersona('a', model)
    expect(result?.needsReview).toBe(true)
  })

  it('keeps at most one outstanding draft and serializes concurrent passes', async () => {
    const generateText = personaLLM('I am concise.')
    const { presenter, repo } = makePersona(
      { memoryEnabled: true, personaEvolutionEnabled: true },
      generateText
    )
    seedUnits(repo, 'a', 6)
    const [first, second] = await Promise.all([
      presenter.maybeEvolvePersona('a', model),
      presenter.maybeEvolvePersona('a', model)
    ])
    const produced = [first, second].filter(Boolean)
    expect(produced).toHaveLength(1)
    expect(presenter.listPersonaDrafts('a')).toHaveLength(1)
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite an active self-model and never injects an unapproved draft (no silent drift)', async () => {
    const generateText = personaLLM('I am a freshly distilled self-model.')
    const { presenter, repo } = makePersona(
      { memoryEnabled: true, personaEvolutionEnabled: true },
      generateText
    )
    const v1 = presenter.evolvePersona('a', 'approved self-model', null)
    await presenter.approvePersonaDraft('a', v1!)
    seedUnits(repo, 'a', 6, 3000)
    await presenter.maybeEvolvePersona('a', model)
    // The active persona text is unchanged until the new draft is explicitly approved.
    expect((await presenter.buildInjection('a', 'q'))?.payload.selfModel).toBe(
      'approved self-model'
    )
    expect(repo.getActivePersona('a')?.content).toBe('approved self-model')
  })
})

describe('MemoryPresenter management', () => {
  it('clearMemories removes all and clears vectors', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(store.vectors.size).toBe(1)
    const removed = await presenter.clearMemories('a')
    expect(removed).toBe(1)
    expect(store.vectors.size).toBe(0)
  })

  it('clearMemories invalidates a cached working blob', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis working fact' }], {
      agentId: 'a'
    })
    presenter.refreshWorkingMemory('a')
    expect((await presenter.buildInjection('a', ''))?.payload.working).toContain(
      'redis working fact'
    )

    await presenter.clearMemories('a')

    expect([...repo.rows.values()].some((row) => row.kind === 'working')).toBe(false)
    expect((await presenter.buildInjection('a', ''))?.payload.working ?? '').not.toContain(
      'redis working fact'
    )
  })

  it('clearMemories closes the cached store, resets disk, and re-creates it next time', async () => {
    const repo = new FakeRepository()
    const stores: FakeVectorStore[] = []
    const createVectorStore = vi.fn(async () => {
      const s = new FakeVectorStore()
      stores.push(s)
      return s
    })
    const resetVectorStore = vi.fn(async () => undefined)
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(createVectorStore).toHaveBeenCalledTimes(1)
    const closeSpy = vi.spyOn(stores[0], 'close')

    await presenter.clearMemories('a')
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(resetVectorStore).toHaveBeenCalledWith('a')

    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'pg' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(createVectorStore).toHaveBeenCalledTimes(2)
  })

  it('clearMemories resets the on-disk store even when nothing is cached', async () => {
    const repo = new FakeRepository()
    const resetVectorStore = vi.fn(async () => undefined)
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore
    })
    // Simulate a fresh process: a memory row exists on disk but no vector store is cached.
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    expect(createVectorStore).not.toHaveBeenCalled()

    await presenter.clearMemories('a')
    expect(resetVectorStore).toHaveBeenCalledWith('a')
  })

  it('retries a failed vector reset on the next lease instead of bricking admission', async () => {
    const repo = new FakeRepository()
    let resetAttempts = 0
    const resetVectorStore = vi.fn(async () => {
      resetAttempts += 1
      if (resetAttempts === 1) throw new Error('transient reset failure')
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore
    })

    expect(await presenter.clearMemories('a')).toBe(0)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis after reset' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')

    expect(resetVectorStore).toHaveBeenCalledTimes(2)
    expect(repo.listByAgent('a')[0]?.status).toBe('embedded')
  })

  it('cleanupDeletedAgentResources clears runtime state even when vector reset fails', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    store.vectors.set('m1', textToVector('redis cached row'))
    const createVectorStore = vi.fn(async () => store)
    const resetVectorStore = vi.fn(async () => {
      throw new Error('reset failed')
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore,
      resetVectorStore
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis cached row',
      status: 'embedded',
      provenanceKey: buildMemoryProvenanceKey('a', 'semantic', 'redis cached row')
    })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: textToVector('').length,
      embeddingModel: 'p:m'
    })
    const internals = memoryRuntimeForTests(presenter)
    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(
      () => internals.vectorStoreReady.has('a'),
      'vector store did not become ready'
    )
    expect(createVectorStore).toHaveBeenCalledTimes(1)
    expect(internals.vectorStores.has('a')).toBe(true)
    expect(internals.vectorStoreIdentities.has('a')).toBe(true)
    expect(internals.vectorStoreReady.has('a')).toBe(true)

    const timer = setTimeout(() => {}, 10000)
    if (typeof timer.unref === 'function') timer.unref()
    internals.lastConsolidationAt.set('a', 1)
    internals.reflectionAttemptWatermark.set('a', 2)
    internals.personaAttemptWatermark.set('a', 3)
    internals.consolidationTimers.set('a', timer)
    internals.personaLocks.set('a', Promise.resolve())
    internals.workingRefreshInFlight.add('a')
    internals.reindexing.set('a', Promise.resolve())
    internals.backfilling.set('a', Promise.resolve())
    internals.embeddingDrains.set('a', Promise.resolve())
    internals.vectorStoreLocks.set('a', Promise.resolve())

    await expect(presenter.cleanupDeletedAgentResources('a')).rejects.toThrow('reset failed')

    expect(resetVectorStore).toHaveBeenCalledWith('a')
    expect(internals.lastConsolidationAt.has('a')).toBe(false)
    expect(internals.reflectionAttemptWatermark.has('a')).toBe(false)
    expect(internals.personaAttemptWatermark.has('a')).toBe(false)
    expect(internals.consolidationTimers.has('a')).toBe(false)
    expect(internals.personaLocks.has('a')).toBe(false)
    expect(internals.workingRefreshInFlight.has('a')).toBe(false)
    expect(internals.reindexing.has('a')).toBe(false)
    expect(internals.backfilling.has('a')).toBe(false)
    expect(internals.embeddingDrains.has('a')).toBe(false)
    expect(internals.vectorStores.has('a')).toBe(false)
    expect(internals.vectorStoreIdentities.has('a')).toBe(false)
    expect(internals.vectorStoreReady.has('a')).toBe(false)
    expect(internals.vectorStoreLocks.has('a')).toBe(false)
    expect(store.closeCount).toBeGreaterThan(0)
  })

  it('cleanupDeletedAgentResources waits for in-flight embedding drains before clearing tracking', async () => {
    const repo = new FakeRepository()
    let managed = true
    let resolveEmbeddings!: (vectors: number[][]) => void
    const getEmbeddings = vi.fn(
      async () =>
        new Promise<number[][]>((resolve) => {
          resolveEmbeddings = resolve
        })
    )
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      isManagedAgent: () => managed,
      getEmbeddings,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    const internals = memoryRuntimeForTests(presenter)

    const drain = presenter.processPendingEmbeddings('a')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(internals.embeddingDrains.has('a')).toBe(true)

    managed = false
    let cleanupSettled = false
    const cleanup = presenter.cleanupDeletedAgentResources('a').then(() => {
      cleanupSettled = true
    })
    await Promise.resolve()
    expect(cleanupSettled).toBe(false)

    resolveEmbeddings([[1, 0, 0, 0]])
    await cleanup
    await drain

    expect(cleanupSettled).toBe(true)
    expect(internals.embeddingDrains.has('a')).toBe(false)
    expect(createVectorStore).not.toHaveBeenCalled()
    expect(repo.getById(id)?.status).toBe('pending_embedding')
  })

  it('cleanupDeletedAgentResources waits for in-flight embedding warmups before clearing tracking', async () => {
    const repo = new FakeRepository()
    let managed = true
    let resolveWarmup!: () => void
    const getEmbeddings = vi.fn(
      async () =>
        new Promise<number[][]>((resolve) => {
          resolveWarmup = () => resolve([textToVector('memory warmup')])
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      isManagedAgent: () => managed,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    const internals = memoryRuntimeForTests(presenter)

    internals.warmEmbeddingConnection('a', { providerId: 'p', modelId: 'm' })
    await waitForMemoryCondition(() => getEmbeddings.mock.calls.length === 1)
    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(internals.embeddingWarmups.size).toBe(1)

    managed = false
    let cleanupSettled = false
    const cleanup = presenter.cleanupDeletedAgentResources('a').then(() => {
      cleanupSettled = true
    })
    await Promise.resolve()
    expect(cleanupSettled).toBe(false)

    resolveWarmup()
    await cleanup

    expect(cleanupSettled).toBe(true)
    expect(internals.embeddingWarmups.size).toBe(0)
  })

  it('cleanupDeletedAgentResources blocks late warmups from spawning backfill work', async () => {
    const repo = new FakeRepository()
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis cold row',
      status: 'fts_only',
      provenanceKey: buildMemoryProvenanceKey('a', 'semantic', 'redis cold row')
    })
    let resolveDimensions: (() => void) | undefined
    let resolveBackfill: (() => void) | undefined
    let backfillStarted = false
    const getDimensions = vi.fn(
      async () =>
        new Promise<{ data: { dimensions: number; normalized: boolean } }>((resolve) => {
          resolveDimensions = () =>
            resolve({ data: { dimensions: textToVector('').length, normalized: false } })
        })
    )
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) => {
      if (texts[0] === 'memory warmup') return texts.map((text) => textToVector(text))
      backfillStarted = true
      return await new Promise<number[][]>((resolve) => {
        resolveBackfill = () => resolve(texts.map((text) => textToVector(text)))
      })
    })
    const stores: FakeVectorStore[] = []
    const createVectorStore = vi.fn(async () => {
      const store = new FakeVectorStore()
      stores.push(store)
      return store
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getDimensions,
      getEmbeddings,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    const internals = memoryRuntimeForTests(presenter)

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => resolveDimensions !== undefined)
    expect(internals.vectorStoreWarmups.size).toBe(1)

    let cleanupSettled = false
    const cleanup = presenter.cleanupDeletedAgentResources('a').then(() => {
      cleanupSettled = true
    })
    await Promise.resolve()
    expect(cleanupSettled).toBe(false)

    resolveDimensions?.()
    await cleanup

    expect(cleanupSettled).toBe(true)
    expect(backfillStarted).toBe(false)
    expect(resolveBackfill).toBeUndefined()
    expect(createVectorStore).not.toHaveBeenCalled()
    expect(internals.vectorStoreWarmups.size).toBe(0)
    expect(internals.backfilling.has('a')).toBe(false)
    expect(internals.vectorStores.has('a')).toBe(false)
    expect(internals.vectorStoreIdentities.has('a')).toBe(false)
    expect(internals.vectorStoreReady.has('a')).toBe(false)
    expect(stores).toEqual([])
  })

  it('cleanupDeletedAgentResources waits for in-flight persona evolution before clearing tracking', async () => {
    const repo = new FakeRepository()
    let managed = true
    let resolveText!: (value: string) => void
    const generateText = vi.fn(
      async () =>
        new Promise<string>((resolve) => {
          resolveText = resolve
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true, personaEvolutionEnabled: true }),
      isManagedAgent: () => managed,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    for (let index = 0; index < 6; index += 1) {
      repo.insert({
        id: `p-${index}`,
        agentId: 'a',
        kind: 'semantic',
        content: `persona fact ${index}`,
        importance: 1,
        status: 'embedded',
        createdAt: 2000 + index
      })
    }
    const internals = memoryRuntimeForTests(presenter)

    const persona = presenter.maybeEvolvePersona('a', { providerId: 'p', modelId: 'm' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(internals.personaLocks.has('a')).toBe(true)

    managed = false
    let cleanupSettled = false
    const cleanup = presenter.cleanupDeletedAgentResources('a').then(() => {
      cleanupSettled = true
    })
    await Promise.resolve()
    expect(cleanupSettled).toBe(false)

    resolveText('I am concise and technical.')
    await cleanup
    await persona

    expect(cleanupSettled).toBe(true)
    expect(internals.personaLocks.has('a')).toBe(false)
    expect(repo.listPersonaVersions('a')).toHaveLength(0)
  })

  it('concurrent vector-store access shares a single create (promise cache)', async () => {
    const repo = new FakeRepository()
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    // Two cold-cache recalls return from FTS immediately; the background warm still shares one open.
    await Promise.all([presenter.recall('a', 'redis'), presenter.recall('a', 'redis')])
    expect(createVectorStore).not.toHaveBeenCalled()
    await waitForMemoryCondition(() => getEmbeddings.mock.calls.length === 1)
    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['memory warmup'], expect.any(AbortSignal))
    await waitForMemoryCondition(() => createVectorStore.mock.calls.length === 1)
    expect(createVectorStore).toHaveBeenCalledTimes(1)
  })

  it('cold recall returns FTS without awaiting query embeddings or a slow store open', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    await store.upsert([{ memoryId: 'm1', embedding: textToVector('redis fact') }])
    let resolveCreate: () => void = () => {}
    const createVectorStore = vi.fn(
      () =>
        new Promise<FakeVectorStore>((resolve) => {
          resolveCreate = () => resolve(store)
        })
    )
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      generateText: async () => '',
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    const internals = memoryRuntimeForTests(presenter)

    const first = await presenter.recall('a', 'redis')
    const second = await presenter.recall('a', 'redis')
    expect(first.map((item) => item.id)).toContain('m1')
    expect(second.map((item) => item.id)).toContain('m1')
    expect(getEmbeddings).not.toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['memory warmup'], expect.any(AbortSignal))

    await waitForMemoryCondition(() => createVectorStore.mock.calls.length === 1)
    expect(createVectorStore).toHaveBeenCalledTimes(1)

    const querySpy = vi.spyOn(store, 'query')
    resolveCreate()
    await waitForMemoryCondition(
      () => internals.vectorStoreReady.has('a'),
      'vector store did not become ready'
    )

    const warm = await presenter.recall('a', 'redis')
    expect(warm.map((item) => item.id)).toContain('m1')
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(querySpy).toHaveBeenCalledTimes(1)
  })

  it('cold searchMemories returns FTS without awaiting query embeddings or a slow store open', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    await store.upsert([{ memoryId: 'm1', embedding: textToVector('redis fact') }])
    let resolveCreate: () => void = () => {}
    const createVectorStore = vi.fn(
      () =>
        new Promise<FakeVectorStore>((resolve) => {
          resolveCreate = () => resolve(store)
        })
    )
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      generateText: async () => '',
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    const internals = memoryRuntimeForTests(presenter)

    const cold = await presenter.searchMemories('a', 'redis')
    expect(cold.map((hit) => hit.row.id)).toEqual(['m1'])
    expect(getEmbeddings).not.toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['memory warmup'], expect.any(AbortSignal))

    await waitForMemoryCondition(() => createVectorStore.mock.calls.length === 1)
    expect(createVectorStore).toHaveBeenCalledTimes(1)
    const querySpy = vi.spyOn(store, 'query')
    resolveCreate()
    await waitForMemoryCondition(
      () => internals.vectorStoreReady.has('a'),
      'vector store did not become ready'
    )

    const warm = await presenter.searchMemories('a', 'redis')
    expect(warm.map((hit) => hit.row.id)).toContain('m1')
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(querySpy).toHaveBeenCalledTimes(1)
  })

  it('validates stale embeddings once during warmup and never on ordinary recall', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    await store.upsert([{ memoryId: 'm1', embedding: textToVector('redis fact') }])
    const staleSpy = vi.spyOn(repo, 'hasStaleEmbeddings')
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_providerId, _modelId, texts) =>
        texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    const internals = memoryRuntimeForTests(presenter)

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => internals.vectorStoreReady.has('a'))
    expect(staleSpy).toHaveBeenCalledTimes(1)

    await presenter.recall('a', 'redis')
    await presenter.recall('a', 'redis')
    expect(staleSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale sidecar hit when the authoritative row is pending embedding', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    const [memoryId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'redis obsolete wording' }],
      { agentId: 'a' }
    )
    await presenter.processPendingEmbeddings('a')
    expect(store.vectors.has(memoryId)).toBe(true)

    const current = repo.getById(memoryId)!
    expect(
      repo.updateDecisionContentIfRevision({
        agentId: 'a',
        id: memoryId,
        expectedRevision: current.decision_revision,
        content: 'completely unrelated replacement',
        provenanceKey: buildMemoryProvenanceKey(
          'a',
          'semantic',
          'completely unrelated replacement'
        ),
        at: Date.now()
      })
    ).toBe(true)
    expect(repo.getById(memoryId)?.status).toBe('pending_embedding')

    const recalled = await presenter.recall('a', 'redis obsolete wording')
    expect(recalled.map((item) => item.id)).not.toContain(memoryId)
  })

  it('keeps a readiness certificate across a resource-only close and reopen', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => store)
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_providerId, _modelId, texts) =>
        texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    const [memoryId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'redis reopen fact' }],
      { agentId: 'a' }
    )
    await presenter.processPendingEmbeddings('a')
    const internals = memoryRuntimeForTests(presenter)
    const certificate = internals.vectorStoreReady.get('a')

    await internals.vectorStoreService.closeAgentStore('a')
    expect(internals.vectorStores.has('a')).toBe(false)
    expect(internals.vectorStoreReady.get('a')).toEqual(certificate)

    const recalled = await presenter.recall('a', 'redis reopen fact')
    expect(recalled.map((item) => item.id)).toContain(memoryId)
    expect(createVectorStore).toHaveBeenCalledTimes(2)
    expect(internals.vectorStoreReady.get('a')).toEqual(certificate)
  })

  it('agent-facing recall keywordizes long English messages for FTS-only recall', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis setup',
      status: 'fts_only'
    })

    const recalled = await presenter.recall('a', 'Could you please explain the redis setup again?')

    expect(recalled.map((item) => item.id)).toEqual(['m1'])
  })

  it('agent-facing recall uses deterministic terms without corpus stats', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis setup',
      status: 'fts_only'
    })
    repo.insert({
      id: 'm2',
      agentId: 'a',
      kind: 'semantic',
      content: 'please review the dashboard notes',
      status: 'fts_only'
    })
    repo.insert({
      id: 'm3',
      agentId: 'a',
      kind: 'semantic',
      content: 'please summarize the release notes',
      status: 'fts_only'
    })
    repo.insert({
      id: 'm4',
      agentId: 'a',
      kind: 'semantic',
      content: 'please update the checklist',
      status: 'fts_only'
    })

    const recalled = await presenter.recall('a', 'please redis setup')

    expect(recalled.map((item) => item.id).sort()).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('agent-facing recall keeps a single domain term even when it is frequent', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true })
    for (const id of ['m1', 'm2', 'm3', 'm4']) {
      repo.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: `${id} redis note`,
        status: 'fts_only'
      })
    }

    const recalled = await presenter.recall('a', 'redis')

    expect(recalled.map((item) => item.id).sort()).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('agent-facing recall skips keyword search when no candidate hits but still tries vector recall', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis setup' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const querySpy = vi.spyOn(store, 'query')

    await presenter.recall('a', 'zzzz qqqq')

    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['zzzz qqqq'], expect.any(AbortSignal))
    expect(querySpy).toHaveBeenCalled()
  })

  it('agent-facing recall keywordizes CJK messages instead of requiring an entire sentence match', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: '用户偏好简洁的中文回答问题',
      status: 'fts_only'
    })

    const recalled = await presenter.recall('a', '请继续用中文回答这个问题，谢谢')

    expect(recalled.map((item) => item.id)).toEqual(['m1'])
  })

  it('warm recall soft-times out query embedding and keeps vector readiness for later turns', async () => {
    vi.useFakeTimers()
    try {
      const repo = new FakeRepository()
      const store = new FakeVectorStore()
      let blockQueryEmbedding = false
      const getEmbeddings = vi.fn((_p: string, _m: string, texts: string[]) => {
        if (blockQueryEmbedding && texts[0] !== 'memory warmup') {
          return new Promise<number[][]>(() => undefined)
        }
        return Promise.resolve(texts.map((text) => textToVector(text)))
      })
      const createVectorStore = vi.fn(async () => store)
      const presenter = new MemoryPresenter({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings,
        getDimensions: embeddingDimensions,
        createVectorStore,
        resetVectorStore: async () => undefined
      })
      const [memoryId] = presenter.writeMemoriesSync(
        [{ kind: 'semantic', content: 'redis setup' }],
        {
          agentId: 'a'
        }
      )
      const internals = memoryRuntimeForTests(presenter)
      await presenter.processPendingEmbeddings('a')
      expect(internals.vectorStoreReady.has('a')).toBe(true)

      blockQueryEmbedding = true
      const clearReadySpy = vi.spyOn(internals.vectorStoreService, 'clearReady')
      const backfillSpy = vi.spyOn(presenter, 'backfillEmbeddings')
      const reindexSpy = vi.spyOn(presenter, 'reindexEmbeddings')
      const recall = presenter.recall('a', 'Could you explain the redis setup again?')

      await vi.advanceTimersByTimeAsync(801)
      const recalled = await recall

      expect(recalled.map((item) => item.id)).toEqual([memoryId])
      expect(clearReadySpy).not.toHaveBeenCalled()
      expect(backfillSpy).not.toHaveBeenCalled()
      expect(reindexSpy).not.toHaveBeenCalled()
      expect(internals.vectorStoreReady.has('a')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a fresh query embedding after the prior absolute deadline', async () => {
    vi.useFakeTimers()
    try {
      const repo = new FakeRepository()
      const store = new FakeVectorStore()
      let blockQueryEmbedding = false
      let queryEmbeddingCalls = 0
      const getEmbeddings = vi.fn((_p: string, _m: string, texts: string[]) => {
        if (blockQueryEmbedding && texts[0] !== 'memory warmup') {
          queryEmbeddingCalls += 1
          return new Promise<number[][]>(() => undefined)
        }
        return Promise.resolve(texts.map((text) => textToVector(text)))
      })
      const presenter = new MemoryPresenter({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings,
        getDimensions: embeddingDimensions,
        createVectorStore: async () => store,
        resetVectorStore: async () => undefined
      })
      const [memoryId] = presenter.writeMemoriesSync(
        [{ kind: 'semantic', content: 'redis setup' }],
        { agentId: 'a' }
      )
      await presenter.processPendingEmbeddings('a')

      blockQueryEmbedding = true
      const first = presenter.recall('a', 'redis setup')
      await vi.advanceTimersByTimeAsync(801)
      expect((await first).map((item) => item.id)).toEqual([memoryId])
      expect(queryEmbeddingCalls).toBe(1)

      const second = presenter.recall('a', 'redis setup')
      await vi.advanceTimersByTimeAsync(801)

      expect((await second).map((item) => item.id)).toEqual([memoryId])
      expect(queryEmbeddingCalls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shares identical concurrent query embeddings and returns vector hits to both callers', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    let resolveQueryEmbedding: ((vectors: number[][]) => void) | null = null
    const getEmbeddings = vi.fn((_p: string, _m: string, texts: string[]) => {
      if (texts[0] === 'redis') {
        return new Promise<number[][]>((resolve) => {
          resolveQueryEmbedding = resolve
        })
      }
      return Promise.resolve(texts.map((text) => textToVector(text)))
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    const [memoryId] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis setup' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    getEmbeddings.mockClear()

    const first = presenter.recall('a', 'redis')
    const second = presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => resolveQueryEmbedding !== null)
    resolveQueryEmbedding?.([textToVector('redis')])

    const [firstHits, secondHits] = await Promise.all([first, second])
    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(firstHits.find((item) => item.id === memoryId)?.sources?.vec).toBe(true)
    expect(secondHits.find((item) => item.id === memoryId)?.sources?.vec).toBe(true)
  })

  it('allows two distinct query embeddings and skips only the third fresh query', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const pendingQueryEmbeddings: Array<(vectors: number[][]) => void> = []
    let blockQueryEmbedding = false
    let queryEmbeddingCalls = 0
    const getEmbeddings = vi.fn((_p: string, _m: string, texts: string[]) => {
      if (blockQueryEmbedding && texts[0] !== 'memory warmup') {
        queryEmbeddingCalls += 1
        return new Promise<number[][]>((resolve) => pendingQueryEmbeddings.push(resolve))
      }
      return Promise.resolve(texts.map((text) => textToVector(text)))
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    const [memoryId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'redis vue setup' }],
      { agentId: 'a' }
    )
    await presenter.processPendingEmbeddings('a')

    blockQueryEmbedding = true
    const first = presenter.recall('a', 'redis setup')
    const second = presenter.recall('a', 'vue setup')
    await waitForMemoryCondition(() => pendingQueryEmbeddings.length === 2)
    const third = await presenter.recall('a', 'setup')
    pendingQueryEmbeddings[0]([textToVector('redis setup')])
    pendingQueryEmbeddings[1]([textToVector('vue setup')])

    const [firstHits, secondHits] = await Promise.all([first, second])
    expect(firstHits.find((item) => item.id === memoryId)?.sources?.vec).toBe(true)
    expect(secondHits.find((item) => item.id === memoryId)?.sources?.vec).toBe(true)
    expect(third.find((item) => item.id === memoryId)?.sources?.vec).not.toBe(true)
    expect(third.map((item) => item.id)).toEqual([memoryId])
    expect(queryEmbeddingCalls).toBe(2)
  })

  it('replaces stale query embedding in-flight entries without late-settle deletion', async () => {
    vi.useFakeTimers()
    try {
      const repo = new FakeRepository()
      const store = new FakeVectorStore()
      let blockQueryEmbedding = false
      let queryEmbeddingCalls = 0
      const pendingQueryEmbeddings: Array<(vectors: number[][]) => void> = []
      const getEmbeddings = vi.fn((_p: string, _m: string, texts: string[]) => {
        if (blockQueryEmbedding && texts[0] !== 'memory warmup') {
          queryEmbeddingCalls += 1
          return new Promise<number[][]>((resolve) => pendingQueryEmbeddings.push(resolve))
        }
        return Promise.resolve(texts.map((text) => textToVector(text)))
      })
      const presenter = new MemoryPresenter({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings,
        getDimensions: embeddingDimensions,
        createVectorStore: async () => store,
        resetVectorStore: async () => undefined
      })
      const [memoryId] = presenter.writeMemoriesSync(
        [{ kind: 'semantic', content: 'redis setup' }],
        { agentId: 'a' }
      )
      await presenter.processPendingEmbeddings('a')

      blockQueryEmbedding = true
      const first = presenter.recall('a', 'redis setup')
      await vi.advanceTimersByTimeAsync(801)
      expect((await first).map((item) => item.id)).toEqual([memoryId])
      expect(queryEmbeddingCalls).toBe(1)

      await vi.advanceTimersByTimeAsync(30_001)
      const second = presenter.recall('a', 'redis setup')
      await vi.advanceTimersByTimeAsync(801)
      expect((await second).map((item) => item.id)).toEqual([memoryId])
      expect(queryEmbeddingCalls).toBe(2)

      pendingQueryEmbeddings[0]?.([textToVector('redis setup')])
      await flushMicrotasks()
      const third = presenter.recall('a', 'redis setup')
      await vi.advanceTimersByTimeAsync(801)
      expect((await third).map((item) => item.id)).toEqual([memoryId])
      expect(queryEmbeddingCalls).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cools down repeated getDimensions failures while keeping cold recall on FTS', async () => {
    const repo = new FakeRepository()
    const getDimensions = vi.fn(async () => {
      throw new Error('dimensions down')
    })
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      getDimensions,
      generateText: async () => '',
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    const internals = memoryRuntimeForTests(presenter)
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis fact',
      status: 'fts_only'
    })

    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).toContain('m1')
    await waitForMemoryCondition(
      () => getDimensions.mock.calls.length === 1 && internals.vectorStoreWarmups.size === 0,
      'first dimension failure did not settle'
    )

    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).toContain('m1')
    await waitForMemoryCondition(
      () => internals.vectorStoreWarmups.size === 0,
      'cooldown warmup did not settle'
    )
    expect(getDimensions).toHaveBeenCalledTimes(1)
    expect(createVectorStore).not.toHaveBeenCalled()

    internals.vectorStoreDimensionFailures.set('a::p::m', Date.now() - 31_000)
    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(
      () => getDimensions.mock.calls.length === 2 && internals.vectorStoreWarmups.size === 0,
      'dimension retry did not run after cooldown'
    )
  })

  it('cold rememberMemory still short-circuits exact provenance duplicates before recall', async () => {
    const repo = new FakeRepository()
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const generateText = vi.fn(async () => '')
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      generateText,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    const [existingId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'user likes redis' }],
      { agentId: 'a' }
    )

    const outcome = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user likes redis' },
      { agentId: 'a' },
      { providerId: 'main', modelId: 'main' }
    )

    expect(outcome).toEqual({ action: 'noop', reason: 'duplicate', id: existingId })
    expect(createVectorStore).not.toHaveBeenCalled()
    expect(getEmbeddings).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
    expect(repo.countByAgent('a')).toBe(1)
  })

  it('cold rememberMemory does not block on vector-only semantic neighbors', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    await store.upsert([{ memoryId: 'm1', embedding: textToVector('user likes redis') }])
    let resolveCreate: () => void = () => {}
    const createVectorStore = vi.fn(
      () =>
        new Promise<FakeVectorStore>((resolve) => {
          resolveCreate = () => resolve(store)
        })
    )
    const newContent = 'postgres preference'
    const embeddingCalls: Array<{ texts: string[]; rowExists: boolean }> = []
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) => {
      embeddingCalls.push({
        texts,
        rowExists: Boolean(
          repo.getByProvenanceKey('a', buildMemoryProvenanceKey('a', 'semantic', texts[0]))
        )
      })
      return texts.map((text) => textToVector(text))
    })
    const generateText = vi.fn(async () => '{"decision":"NOOP","targetIndex":0}')
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      generateText,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'user likes redis' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    const internals = memoryRuntimeForTests(presenter)

    const outcome = await presenter.rememberMemory(
      { kind: 'semantic', content: newContent },
      { agentId: 'a' },
      { providerId: 'main', modelId: 'main' }
    )

    expect(outcome.action).toBe('created')
    expect(generateText).not.toHaveBeenCalled()
    expect(repo.listByAgent('a').map((row) => row.content)).toContain(newContent)
    expect(embeddingCalls.map((call) => call.texts)).toContainEqual(['memory warmup'])
    const rowEmbeddingCalls = embeddingCalls.filter((call) => call.texts[0] !== 'memory warmup')
    expect(rowEmbeddingCalls.length).toBeGreaterThan(0)
    expect(rowEmbeddingCalls.every((call) => call.rowExists)).toBe(true)

    await waitForMemoryCondition(() => createVectorStore.mock.calls.length === 1)
    expect(createVectorStore).toHaveBeenCalledTimes(1)
    resolveCreate()
    await waitForMemoryCondition(
      () => internals.vectorStoreReady.has('a'),
      'vector store did not become ready'
    )
  })

  it('processPendingEmbeddings does not open the sidecar for a row cleared during the await', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => store)
    let resolveEmb: () => void = () => {}
    const getEmbeddings = vi.fn(
      () =>
        new Promise<number[][]>((resolve) => {
          resolveEmb = () => resolve([textToVector('redis')])
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    const ids = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    const pending = presenter.processPendingEmbeddings('a') // suspends on getEmbeddings
    await presenter.clearMemories('a') // deletes the row + resets the store
    resolveEmb()
    await pending
    // Row was gone before the store was opened → no sidecar (re)created, no orphan vector.
    expect(createVectorStore).not.toHaveBeenCalled()
    expect(store.vectors.has(ids[0])).toBe(false)
  })

  it('clearMemories awaits an in-flight create, then closes and resets it', async () => {
    const repo = new FakeRepository()
    const created = new FakeVectorStore()
    let resolveCreate: () => void = () => {}
    const createVectorStore = vi.fn(
      () =>
        new Promise<IMemoryVectorStore>((resolve) => {
          resolveCreate = () => resolve(created)
        })
    )
    // Models the on-disk reset: deleting the file drops whatever the in-flight create wrote.
    const resetVectorStore = vi.fn(async () => {
      created.vectors.clear()
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    const closeSpy = vi.spyOn(created, 'close')

    // An embedding blocks inside createVectorStore, holding the per-agent lock.
    const embedding = presenter.processPendingEmbeddings('a')
    await new Promise((r) => setTimeout(r, 0))
    expect(createVectorStore).toHaveBeenCalledTimes(1)

    // Clearing while the create is in flight must queue behind the lock, not race past it.
    const clear = presenter.clearMemories('a')
    await new Promise((r) => setTimeout(r, 0))
    expect(resetVectorStore).not.toHaveBeenCalled()

    resolveCreate()
    await Promise.all([embedding, clear])

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(resetVectorStore).toHaveBeenCalledWith('a')
    // The cleared row was deleted before the embedding resumed → no orphan vector written.
    expect(created.vectors.size).toBe(0)
  })

  it('deleteMemory only deletes owned memory', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const ids = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    expect(await presenter.deleteMemory('other-agent', ids[0])).toBe(false)
    expect(await presenter.deleteMemory('a', ids[0])).toBe(true)
    expect(repo.countByAgent('a')).toBe(0)
  })

  it('forgetMemory archives owned memory and restore re-enables recall', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    const ids = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis cache' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).toContain(ids[0])

    expect(await presenter.forgetMemory('other-agent', ids[0])).toBe(false)
    expect(repo.getById(ids[0])?.status).toBe('embedded')
    expect(await presenter.forgetMemory('a', ids[0])).toBe(true)
    expect(repo.getById(ids[0])?.status).toBe('archived')
    expect(repo.rows.has(ids[0])).toBe(true)
    expect(store.vectors.has(ids[0])).toBe(true)
    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).not.toContain(ids[0])

    expect(presenter.restoreMemory('a', ids[0])).toBe(true)
    await presenter.processPendingEmbeddings('a')
    expect(repo.getById(ids[0])?.status).toBe('embedded')
    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).toContain(ids[0])
  })

  it('inline-prunes vector matches that SQLite rejects as dead', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis cache' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    repo.archive(id, Date.now())
    expect(store.vectors.has(id)).toBe(true)

    await presenter.recall('a', 'redis')

    await waitForMemoryCondition(() => !store.vectors.has(id), 'dead vector was not pruned')
  })

  it('does not delete restored vectors from an in-flight inline prune', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis cache' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    repo.archive(id, Date.now())
    const originalFilterPrunable = repo.filterPrunableVectorRefs.bind(repo)
    const filterPrunable = vi
      .spyOn(repo, 'filterPrunableVectorRefs')
      .mockImplementation((agentId, ids, embeddingDim, embeddingModel) => {
        if (ids.includes(id)) {
          repo.updateStatus(id, 'embedded', {
            embeddingId: id,
            embeddingDim,
            embeddingModel
          })
          store.vectors.set(id, textToVector('redis cache restored'))
        }
        return originalFilterPrunable(agentId, ids, embeddingDim, embeddingModel)
      })
    const deleteByMemoryIds = vi.spyOn(store, 'deleteByMemoryIds')

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => filterPrunable.mock.calls.length > 0)

    expect(deleteByMemoryIds).not.toHaveBeenCalled()
    expect(repo.getById(id)).toMatchObject({
      status: 'embedded',
      embedding_id: id,
      embedding_dim: 4,
      embedding_model: 'p:m'
    })
    expect(store.vectors.has(id)).toBe(true)
  })

  it('maintenance sweep deletes prunable vectors before clearing embedding refs', async () => {
    const generateText = routedLLM({})
    const { presenter, repo, store } = makeLLMPresenter(generateText)
    const id = await seedEmbedded(presenter, 'user likes redis')
    repo.archive(id, Date.now())
    expect(store.vectors.has(id)).toBe(true)
    expect(repo.getById(id)?.embedding_id).toBe(id)

    await presenter.runConsolidationPass('a', 1_000 * DAY)

    expect(store.vectors.has(id)).toBe(false)
    expect(repo.getById(id)).toMatchObject({
      status: 'archived',
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null
    })
  })

  it('does not delete restored vectors when a row changes before guarded prune', async () => {
    const generateText = routedLLM({})
    const { presenter, repo, store } = makeLLMPresenter(generateText)
    const id = await seedEmbedded(presenter, 'user likes redis')
    repo.archive(id, Date.now())
    const originalFilterPrunable = repo.filterPrunableVectorRefs.bind(repo)
    const deleteByMemoryIds = vi.spyOn(store, 'deleteByMemoryIds')
    vi.spyOn(repo, 'filterPrunableVectorRefs').mockImplementation(
      (agentId, ids, embeddingDim, embeddingModel) => {
        if (ids.includes(id)) {
          repo.updateStatus(id, 'embedded', {
            embeddingId: id,
            embeddingDim,
            embeddingModel
          })
          store.vectors.set(id, textToVector('user likes redis restored'))
        }
        return originalFilterPrunable(agentId, ids, embeddingDim, embeddingModel)
      }
    )

    await presenter.runConsolidationPass('a', 1_000 * DAY)

    expect(deleteByMemoryIds).not.toHaveBeenCalled()
    expect(repo.getById(id)).toMatchObject({
      status: 'embedded',
      embedding_id: id,
      embedding_dim: 4,
      embedding_model: 'p:m'
    })
    expect(store.vectors.has(id)).toBe(true)
  })

  it('does not let stale-dimension refs starve current-dimension vector pruning', async () => {
    const generateText = routedLLM({})
    const { presenter, repo, store } = makeLLMPresenter(generateText)
    const liveId = await seedEmbedded(presenter, 'live current vector')
    repo.setAnchor(liveId, true)
    for (let index = 0; index < 260; index += 1) {
      const id = `old-${index}`
      repo.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: `old archived ${index}`,
        status: 'embedded',
        createdAt: index
      })
      repo.updateStatus(id, 'embedded', {
        embeddingId: id,
        embeddingDim: 8,
        embeddingModel: 'p:m'
      })
      repo.archive(id, Date.now())
      store.vectors.set(id, textToVector(`old archived ${index}`))
    }
    for (let index = 0; index < 2; index += 1) {
      const id = `current-${index}`
      repo.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: `current archived ${index}`,
        status: 'embedded',
        createdAt: 1000 + index
      })
      repo.updateStatus(id, 'embedded', {
        embeddingId: id,
        embeddingDim: 4,
        embeddingModel: 'p:m'
      })
      repo.archive(id, Date.now())
      store.vectors.set(id, textToVector(`current archived ${index}`))
    }

    await presenter.runConsolidationPass('a', 1_000 * DAY)

    expect(store.vectors.has('current-0')).toBe(false)
    expect(store.vectors.has('current-1')).toBe(false)
    expect(repo.getById('current-0')).toMatchObject({
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null
    })
    expect(repo.getById('old-0')).toMatchObject({
      embedding_id: 'old-0',
      embedding_dim: 8,
      embedding_model: 'p:m'
    })
    expect(store.vectors.has('old-0')).toBe(true)
    expect(repo.getById(liveId)?.status).toBe('embedded')
  })

  it('surfaces guarded prune filter failures instead of treating them as no-op deletes', async () => {
    const generateText = routedLLM({})
    const { presenter, repo, store } = makeLLMPresenter(generateText)
    const id = await seedEmbedded(presenter, 'user likes redis')
    repo.archive(id, Date.now())
    vi.spyOn(repo, 'filterPrunableVectorRefs').mockImplementation(() => {
      throw new Error('filter failed')
    })

    await expect(presenter.runConsolidationPass('a', 1_000 * DAY)).rejects.toThrow('filter failed')

    expect(repo.getById(id)?.embedding_id).toBe(id)
    expect(store.vectors.has(id)).toBe(true)
  })

  it('restores and re-embeds a memory after maintenance prunes its archived vector', async () => {
    const generateText = routedLLM({})
    const { presenter, repo, store } = makeLLMPresenter(generateText)
    const id = await seedEmbedded(presenter, 'user likes redis')
    repo.archive(id, Date.now())
    await presenter.runConsolidationPass('a', 1_000 * DAY)
    expect(store.vectors.has(id)).toBe(false)
    expect(repo.getById(id)?.embedding_id).toBeNull()

    expect(presenter.restoreMemory('a', id)).toBe(true)
    await presenter.processPendingEmbeddings('a')

    expect(repo.getById(id)).toMatchObject({
      status: 'embedded',
      embedding_id: id,
      embedding_dim: 4,
      embedding_model: 'p:m'
    })
    expect(store.vectors.has(id)).toBe(true)
    expect(
      (await presenter.recall('a', 'redis')).find((item) => item.id === id)?.sources?.vec
    ).toBe(true)
  })

  it('getByIds returns owned memories in input order without status filtering', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const ids = presenter.writeMemoriesSync(
      [
        { kind: 'semantic', content: 'active redis' },
        { kind: 'semantic', content: 'archived redis' },
        { kind: 'semantic', content: 'superseded redis' }
      ],
      { agentId: 'a' }
    )
    repo.archive(ids[1], 2000)
    repo.markSuperseded(ids[2], ids[0])
    repo.insert({
      id: 'other-agent-memory',
      agentId: 'other',
      kind: 'semantic',
      content: 'other agent memory'
    })

    expect(presenter.getByIds('a', [ids[2], ids[2], 'missing', ids[1], ids[0], ids[1]])).toEqual([
      expect.objectContaining({ id: ids[2], superseded_by: ids[0] }),
      expect.objectContaining({ id: ids[1], status: 'archived' }),
      expect.objectContaining({ id: ids[0], status: 'pending_embedding' })
    ])
    expect(presenter.getByIds('a', ['other-agent-memory'])).toEqual([])
  })

  it('keeps source-span lookups inside management visibility', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const ids = presenter.writeMemoriesSync(
      [
        { kind: 'semantic', content: 'active source' },
        { kind: 'semantic', content: 'archived source' },
        { kind: 'semantic', content: 'superseded source' },
        { kind: 'semantic', content: 'conflicted source' }
      ],
      { agentId: 'a' }
    )
    repo.archive(ids[1])
    repo.markSuperseded(ids[2], ids[0])
    repo.updateStatus(ids[3], 'conflicted')
    repo.insert({
      id: 'persona-source',
      agentId: 'a',
      kind: 'persona',
      content: 'hidden persona',
      status: 'fts_only'
    })

    expect(
      presenter
        .getManagementVisibleByIds('a', [ids[2], ids[1], ids[3], 'persona-source', ids[0]])
        .map((row) => row.id)
    ).toEqual([ids[1], ids[0]])
  })

  it('archiveUserMemory soft-archives owned memory and writes content-free user audit', async () => {
    const { presenter, repo, auditRepo } = makePresenter(enabledConfig)
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis cache' }], {
      agentId: 'a'
    })

    await expect(presenter.archiveUserMemory('other-agent', id)).resolves.toBe(false)
    await expect(presenter.archiveUserMemory('a', id)).resolves.toBe(true)

    expect(repo.getById(id)?.status).toBe('archived')
    const [firstAudit] = auditRepo.listByAgent('a', {
      eventType: 'memory/archive',
      actorType: 'user'
    })
    expect(firstAudit).toMatchObject({
      event_type: 'memory/archive',
      actor_type: 'user',
      status: 'completed',
      reason: null
    })
    expect(JSON.parse(firstAudit.input_refs_json)).toEqual({ memoryId: id })
    expect(JSON.parse(firstAudit.output_refs_json)).toEqual({ action: 'archived', memoryId: id })
    expect(firstAudit.input_refs_json).not.toContain('redis cache')
    expect(firstAudit.output_refs_json).not.toContain('redis cache')

    await expect(presenter.archiveUserMemory('a', id)).resolves.toBe(true)
    const archiveAudits = auditRepo.listByAgent('a', {
      eventType: 'memory/archive',
      actorType: 'user'
    })
    expect(archiveAudits).toHaveLength(2)
    expect(archiveAudits.some((audit) => audit.reason === 'already_archived')).toBe(true)
    expect(presenter.restoreMemory('a', id)).toBe(true)
    expect(repo.getById(id)?.status).toBe('pending_embedding')
  })

  it('refuses generic archive/restore/forget for persona and working rows without audit writes', async () => {
    const { presenter, repo, auditRepo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'persona',
      agentId: 'a',
      kind: 'persona',
      content: 'active self model',
      status: 'archived',
      personaState: 'active'
    })
    repo.insert({
      id: 'working',
      agentId: 'a',
      kind: 'working',
      content: 'working blob',
      status: 'fts_only'
    })

    expect(presenter.listMemories('a').map((row) => row.id)).not.toEqual(
      expect.arrayContaining(['persona', 'working'])
    )
    expect(presenter.getByIds('a', ['persona', 'working']).map((row) => row.id)).toEqual([
      'persona',
      'working'
    ])
    await expect(presenter.forgetMemory('a', 'persona')).resolves.toBe(false)
    await expect(presenter.archiveUserMemory('a', 'persona')).resolves.toBe(false)
    expect(presenter.restoreMemory('a', 'persona')).toBe(false)
    await expect(presenter.forgetMemory('a', 'working')).resolves.toBe(false)

    expect(repo.getById('persona')).toMatchObject({
      status: 'archived',
      persona_state: 'active'
    })
    expect(repo.getById('working')?.status).toBe('fts_only')
    expect(auditRepo.listByAgent('a', { eventType: 'memory/archive' })).toHaveLength(0)
  })

  it('prunes legacy persona and working vectors before repairing their statuses', async () => {
    const { presenter, repo, auditRepo, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'live current memory' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    repo.insert({
      id: 'persona',
      agentId: 'a',
      kind: 'persona',
      content: 'active self model',
      status: 'fts_only',
      personaState: 'active'
    })
    repo.updateStatus('persona', 'pending_embedding', {
      embeddingId: 'persona',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    repo.insert({
      id: 'working',
      agentId: 'a',
      kind: 'working',
      content: 'working blob',
      status: 'embedded'
    })
    repo.updateStatus('working', 'embedded', {
      embeddingId: 'working',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    await store.upsert([
      { memoryId: 'persona', embedding: textToVector('active self model') },
      { memoryId: 'working', embedding: textToVector('working blob') }
    ])

    await presenter.runConsolidationPass('a', 1_000 * DAY)

    expect(repo.getById('persona')).toMatchObject({
      status: 'fts_only',
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null
    })
    expect(repo.getById('working')).toMatchObject({
      status: 'fts_only',
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null
    })
    expect(store.vectors.has('persona')).toBe(false)
    expect(store.vectors.has('working')).toBe(false)
    expect(presenter.getHealth('a').embeddings.pending).toBe(0)
    expect(presenter.getStatus('a').pendingEmbedding).toBe(0)
    expect(auditRepo.listByAgent('a', { eventType: 'memory/repair' })).toHaveLength(1)
  })

  it('keeps internal-kind embedding refs when vector prune fails', async () => {
    const { presenter, repo, auditRepo, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'live current memory' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    vi.spyOn(store, 'deleteByMemoryIds').mockRejectedValue(new Error('delete failed'))
    repo.insert({
      id: 'persona',
      agentId: 'a',
      kind: 'persona',
      content: 'active self model',
      status: 'fts_only',
      personaState: 'active'
    })
    repo.updateStatus('persona', 'pending_embedding', {
      embeddingId: 'persona',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    await store.upsert([{ memoryId: 'persona', embedding: textToVector('active self model') }])

    await presenter.runConsolidationPass('a', 1_000 * DAY)

    expect(repo.getById('persona')).toMatchObject({
      status: 'fts_only',
      embedding_id: 'persona',
      embedding_dim: 4,
      embedding_model: 'p:m'
    })
    expect(store.vectors.has('persona')).toBe(true)
    expect(auditRepo.listByAgent('a', { eventType: 'memory/repair' })).toHaveLength(1)
  })
})

describe('MemoryPresenter.processPendingEmbeddings (batch + fairness)', () => {
  it('embeds all pending rows in one getEmbeddings call and one upsert', async () => {
    const { presenter, repo, store, getEmbeddings } = makePresenter(enabledConfig)
    const contents = ['redis one', 'vue two', '简洁 three']
    for (const content of contents) {
      repo.insert({
        id: `m-${content}`,
        agentId: 'deepchat',
        kind: 'semantic',
        content,
        status: 'pending_embedding'
      })
    }
    const upsertSpy = vi.spyOn(store, 'upsert')

    await presenter.processPendingEmbeddings('deepchat')

    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(getEmbeddings.mock.calls[0][2]).toHaveLength(contents.length)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    expect(upsertSpy.mock.calls[0][0]).toHaveLength(contents.length)
    for (const content of contents) {
      expect(repo.getById(`m-${content}`)?.status).toBe('embedded')
    }
  })

  it('embeds only the queried agent rows so a backlog cannot starve another agent', async () => {
    const { presenter, repo, getEmbeddings } = makePresenter(enabledConfig)
    for (let i = 0; i < 100; i += 1) {
      repo.insert({
        id: `a-${i}`,
        agentId: 'agent-a',
        kind: 'semantic',
        content: `a${i} redis`,
        status: 'pending_embedding'
      })
    }
    repo.insert({
      id: 'b-1',
      agentId: 'agent-b',
      kind: 'semantic',
      content: 'b redis',
      status: 'pending_embedding'
    })

    await presenter.processPendingEmbeddings('agent-b')

    expect(repo.getById('b-1')?.status).toBe('embedded')
    expect(repo.getById('a-0')?.status).toBe('pending_embedding')
    expect(getEmbeddings.mock.calls[0][2]).toEqual(['b redis'])
  })

  it('serializes same-agent drains so concurrent triggers embed each row once', async () => {
    const { presenter, repo, getEmbeddings } = makePresenter(enabledConfig)
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis',
      status: 'pending_embedding'
    })
    repo.insert({
      id: 'm2',
      agentId: 'a',
      kind: 'semantic',
      content: 'vue',
      status: 'pending_embedding'
    })

    // Two background triggers fire for the same agent before the first drain settles.
    await Promise.all([
      presenter.processPendingEmbeddings('a'),
      presenter.processPendingEmbeddings('a')
    ])

    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(repo.getById('m1')?.status).toBe('embedded')
    expect(repo.getById('m2')?.status).toBe('embedded')
  })

  it('does not revive a forgotten memory while embeddings are in flight', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    let releaseEmbedding: (() => void) | null = null
    let resolveStarted: (() => void) | null = null
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const getEmbeddings = vi.fn(
      async (_p: string, _m: string, texts: string[]) =>
        new Promise<number[][]>((resolve) => {
          releaseEmbedding = () => resolve(texts.map((text) => textToVector(text)))
          resolveStarted?.()
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      generateText: vi.fn(async () => ''),
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis in flight',
      status: 'pending_embedding'
    })

    const drain = presenter.processPendingEmbeddings('a')
    await started
    expect(await presenter.forgetMemory('a', 'm1')).toBe(true)
    releaseEmbedding?.()
    await drain

    expect(repo.getById('m1')?.status).toBe('archived')
    expect(store.vectors.has('m1')).toBe(false)
  })

  it('does not mark a forgotten memory pending again after an embedding service failure', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    let rejectEmbedding: ((error: Error) => void) | null = null
    let resolveStarted: (() => void) | null = null
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const getEmbeddings = vi.fn(
      async () =>
        new Promise<number[][]>((_resolve, reject) => {
          rejectEmbedding = reject
          resolveStarted?.()
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      generateText: vi.fn(async () => ''),
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis retry',
      status: 'pending_embedding'
    })

    const drain = presenter.processPendingEmbeddings('a')
    await started
    expect(await presenter.forgetMemory('a', 'm1')).toBe(true)
    rejectEmbedding?.(new Error('ECONNRESET'))
    await drain

    expect(repo.getById('m1')?.status).toBe('archived')
  })

  it('does not mark a forgotten memory error after a vector write failure', async () => {
    const repo = new FakeRepository()
    let rejectUpsert: ((error: Error) => void) | null = null
    let resolveUpsertStarted: (() => void) | null = null
    const upsertStarted = new Promise<void>((resolve) => {
      resolveUpsertStarted = resolve
    })
    const failingStore: IMemoryVectorStore = {
      upsert: vi.fn(
        async () =>
          new Promise<void>((_resolve, reject) => {
            rejectUpsert = reject
            resolveUpsertStarted?.()
          })
      ),
      query: async () => [],
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => [],
      close: async () => {},
      isUsable: () => true
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => failingStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis write',
      status: 'pending_embedding'
    })

    const drain = presenter.processPendingEmbeddings('a')
    await upsertStarted
    expect(await presenter.forgetMemory('a', 'm1')).toBe(true)
    rejectUpsert?.(new Error('INSERT failed'))
    await drain

    expect(repo.getById('m1')?.status).toBe('archived')
  })

  it('marks the batch error (never embedded) when the vector store upsert fails', async () => {
    const repo = new FakeRepository()
    const failingStore: IMemoryVectorStore = {
      upsert: vi.fn(async () => {
        throw new Error('INSERT failed')
      }),
      query: async () => [],
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => [],
      close: async () => {},
      isUsable: () => true
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => failingStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis',
      status: 'pending_embedding'
    })
    repo.insert({
      id: 'm2',
      agentId: 'a',
      kind: 'semantic',
      content: 'vue',
      status: 'pending_embedding'
    })

    await presenter.processPendingEmbeddings('a')

    expect(repo.getById('m1')?.status).toBe('error')
    expect(repo.getById('m2')?.status).toBe('error')
  })

  it('marks only rows still live at vector-write time when the store is unusable', async () => {
    const repo = new FakeRepository()
    let resolveStarted: (() => void) | null = null
    let releaseEmbedding: (() => void) | null = null
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const unusableStore: IMemoryVectorStore = {
      upsert: async () => {},
      query: async () => [],
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => [],
      close: async () => {},
      isUsable: () => false
    }
    const getEmbeddings = vi.fn(
      async (_p: string, _m: string, texts: string[]) =>
        new Promise<number[][]>((resolve) => {
          releaseEmbedding = () => resolve(texts.map((text) => textToVector(text)))
          resolveStarted?.()
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      createVectorStore: async () => unusableStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'stale',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis stale',
      status: 'pending_embedding'
    })
    repo.insert({
      id: 'live',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis live',
      status: 'pending_embedding'
    })
    const drain = presenter.processPendingEmbeddings('a')
    await started
    repo.updateStatus('stale', 'fts_only')
    releaseEmbedding?.()
    await drain

    expect(repo.getById('stale')?.status).toBe('fts_only')
    expect(repo.getById('live')?.status).toBe('error')
  })

  it('forced reindex waits for an active drain before requeueing', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const resolvers: Array<() => void> = []
    const getEmbeddings = vi.fn(
      async (_p: string, _m: string, texts: string[]) =>
        new Promise<number[][]>((resolve) => {
          resolvers.push(() => resolve(texts.map((text) => textToVector(text))))
        })
    )
    const resetVectorStore = vi.fn(async () => {
      store.vectors.clear()
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      createVectorStore: async () => store,
      resetVectorStore
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis reindex',
      status: 'pending_embedding'
    })

    const drain = presenter.processPendingEmbeddings('a')
    await waitForMemoryCondition(() => resolvers.length === 1)
    const reindex = presenter.reindexEmbeddings('a', true)
    await flushMicrotasks()
    resolvers.shift()?.()
    await waitForMemoryCondition(() => resolvers.length === 1)
    resolvers.shift()?.()
    await Promise.all([drain, reindex])

    expect(resetVectorStore).toHaveBeenCalledWith('a')
    expect(repo.getById('m1')?.status).toBe('embedded')
    expect(store.vectors.has('m1')).toBe(true)
    expect(getEmbeddings).toHaveBeenCalledTimes(2)
  })

  it('keeps the batch pending (retryable) when the embedding service throws, then heals', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    let attempt = 0
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) => {
      attempt += 1
      if (attempt === 1) throw new Error('ECONNRESET')
      return texts.map((text) => textToVector(text))
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis',
      status: 'pending_embedding'
    })
    repo.insert({
      id: 'm2',
      agentId: 'a',
      kind: 'semantic',
      content: 'vue',
      status: 'pending_embedding'
    })

    await presenter.processPendingEmbeddings('a')
    // A transient service failure must not terminally strand the rows; they stay queued.
    expect(repo.getById('m1')?.status).toBe('pending_embedding')
    expect(repo.getById('m2')?.status).toBe('pending_embedding')

    await presenter.processPendingEmbeddings('a')
    expect(repo.getById('m1')?.status).toBe('embedded')
    expect(repo.getById('m2')?.status).toBe('embedded')
  })

  it('does not issue an empty error requeue when there are no error rows', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const requeueSpy = vi.spyOn(repo, 'requeueForEmbedding')

    await presenter.processPendingEmbeddings('a')

    expect(requeueSpy).not.toHaveBeenCalled()
  })

  it('cools down error retry even when a bounded requeue races to zero changes', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'err-01',
      agentId: 'a',
      kind: 'semantic',
      content: 'retry race',
      status: 'error'
    })
    const requeueSpy = vi.spyOn(repo, 'requeueForEmbedding')
    requeueSpy.mockReturnValueOnce(0)
    const internals = memoryRuntimeForTests(presenter)

    await presenter.processPendingEmbeddings('a')

    expect(requeueSpy).toHaveBeenCalledTimes(1)
    expect(internals.errorRetryAt.has('a')).toBe(true)
    expect(internals.errorRetryAfterId.get('a')).toBe('err-01')

    await presenter.processPendingEmbeddings('a')

    expect(requeueSpy).toHaveBeenCalledTimes(1)
  })

  it('advances error retry fairly instead of starving rows after the first batch', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    for (let index = 0; index < 51; index += 1) {
      repo.insert({
        id: `err-${String(index).padStart(2, '0')}`,
        agentId: 'a',
        kind: 'semantic',
        content: `retry ${index}`,
        status: 'error'
      })
    }
    const internals = memoryRuntimeForTests(presenter)

    await presenter.processPendingEmbeddings('a')
    expect(repo.getById('err-49')?.status).toBe('embedded')
    expect(repo.getById('err-50')?.status).toBe('error')
    expect(internals.errorRetryAfterId.get('a')).toBe('err-49')

    internals.errorRetryAt.set('a', 0)
    await presenter.processPendingEmbeddings('a')

    expect(repo.getById('err-50')?.status).toBe('embedded')
  })

  it('sets an error retry cooldown when embedding vectors have mismatched dimensions', async () => {
    const repo = new FakeRepository()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async () => [
        [1, 2, 3, 4],
        [1, 2]
      ],
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'ok',
      agentId: 'a',
      kind: 'semantic',
      content: 'ok',
      status: 'pending_embedding'
    })
    repo.insert({
      id: 'bad',
      agentId: 'a',
      kind: 'semantic',
      content: 'bad',
      status: 'pending_embedding'
    })
    const internals = memoryRuntimeForTests(presenter)

    await presenter.processPendingEmbeddings('a')

    expect(repo.getById('ok')?.status).toBe('embedded')
    expect(repo.getById('bad')?.status).toBe('error')
    expect(internals.errorRetryAt.has('a')).toBe(true)
  })
})

describe('MemoryPresenter change events (onMemoryChanged)', () => {
  function makeWithSpy(config: DeepChatAgentConfig = enabledConfig) {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const onMemoryChanged = vi.fn()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async () => [],
      generateText: async () => '[]',
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined,
      onMemoryChanged
    })
    return { presenter, repo, onMemoryChanged }
  }

  it('emits "delete" when an owned memory is deleted', async () => {
    const { presenter, onMemoryChanged } = makeWithSpy()
    const ids = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    onMemoryChanged.mockClear()
    await presenter.deleteMemory('a', ids[0])
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'delete', { memoryId: ids[0] })
  })

  it('emits "clear" only when something was removed', async () => {
    const { presenter, onMemoryChanged } = makeWithSpy()
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    onMemoryChanged.mockClear()
    await presenter.clearMemories('a')
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'clear')

    onMemoryChanged.mockClear()
    await presenter.clearMemories('a') // already empty
    expect(onMemoryChanged).not.toHaveBeenCalled()
  })

  it('emits "reindex" when a manual reindex returns early with no rows', async () => {
    const { presenter, onMemoryChanged } = makeWithSpy()

    await presenter.reindexEmbeddings('a')

    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'reindex')
  })

  it('emits persona reasons through the draft / approve / rollback lifecycle', async () => {
    const { presenter, onMemoryChanged } = makeWithSpy()
    const v1 = presenter.evolvePersona('a', 'v1', null)
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'persona-draft')
    await presenter.approvePersonaDraft('a', v1!)
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'persona-approve')
    const v2 = presenter.evolvePersona('a', 'v2', null)
    await presenter.approvePersonaDraft('a', v2!)
    onMemoryChanged.mockClear()
    await presenter.setPersonaAnchor('a', v2!, true)
    expect(onMemoryChanged).toHaveBeenCalledTimes(1)
    expect(onMemoryChanged).toHaveBeenLastCalledWith('a', 'persona-anchor')
    await presenter.setPersonaAnchor('a', v2!, false)
    expect(onMemoryChanged).toHaveBeenCalledTimes(2)
    expect(onMemoryChanged).toHaveBeenLastCalledWith('a', 'persona-anchor')
    onMemoryChanged.mockClear()
    await presenter.rollbackPersona('a', v1!)
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'persona-rollback')
  })

  it('emits "extract" when rememberMemory writes a new memory', async () => {
    const { presenter, onMemoryChanged } = makeWithSpy()
    const created = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user prefers redis' },
      { agentId: 'a' }
    )
    expect(created.action).toBe('created')
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'extract')

    // A dedupe hit (same content) emits no event.
    onMemoryChanged.mockClear()
    const again = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user prefers redis' },
      { agentId: 'a' }
    )
    expect(again).toEqual(expect.objectContaining({ action: 'noop', reason: 'duplicate' }))
    expect(onMemoryChanged).not.toHaveBeenCalled()
  })

  it('emits "extract" when extraction writes new memories', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const onMemoryChanged = vi.fn()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText: async () => '[{"kind":"semantic","content":"likes redis","importance":0.9}]',
      createVectorStore: async () => store,
      onMemoryChanged
    })
    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis',
      model: { providerId: 'p', modelId: 'm' },
      sourceSession: 'session-1'
    })
    expect(result.ok).toBe(true)
    expect(onMemoryChanged).toHaveBeenCalledWith(
      'a',
      'extract',
      expect.objectContaining({ sessionId: 'session-1', createdIds: result.createdIds })
    )
  })

  it('finalizes the first committed candidate when a later candidate fails and retries idempotently', async () => {
    const repo = new FakeRepository()
    const onMemoryChanged = vi.fn()
    const generateText = vi.fn(async (_providerId: string, _modelId: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      return JSON.stringify([
        { kind: 'semantic', content: 'first durable fact', importance: 0.9 },
        { kind: 'semantic', content: 'second durable fact', importance: 0.8 }
      ])
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined,
      onMemoryChanged
    })
    const originalInsert = repo.insert.bind(repo)
    let failSecond = true
    vi.spyOn(repo, 'insert').mockImplementation((input) => {
      if (failSecond && input.content === 'second durable fact') {
        throw new Error('injected second-candidate failure')
      }
      return originalInsert(input)
    })

    await expect(
      presenter.extractAndStore({
        agentId: 'a',
        spanText: 'User: remember two facts',
        model: { providerId: 'p', modelId: 'm' },
        sourceSession: 'session-1'
      })
    ).resolves.toEqual({ ok: false })
    await waitForMemoryCondition(() =>
      repo.listByAgent('a').some((row) => row.content === 'first durable fact')
    )
    await presenter.buildInjection('a', '')
    expect([...repo.rows.values()].find((row) => row.kind === 'working')?.content).toContain(
      'first durable fact'
    )
    expect(onMemoryChanged).toHaveBeenCalledWith(
      'a',
      'extract',
      expect.objectContaining({ sessionId: 'session-1' })
    )

    failSecond = false
    onMemoryChanged.mockClear()
    const retry = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: remember two facts',
      model: { providerId: 'p', modelId: 'm' },
      sourceSession: 'session-1'
    })
    expect(retry.ok).toBe(true)
    expect(
      [...repo.rows.values()].filter(
        (row) => row.kind === 'semantic' && row.content === 'first durable fact'
      )
    ).toHaveLength(1)
    expect(
      [...repo.rows.values()].filter(
        (row) => row.kind === 'semantic' && row.content === 'second durable fact'
      )
    ).toHaveLength(1)
  })

  it('emits chip createdIds only for pure created rows in mixed extraction outcomes', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const onMemoryChanged = vi.fn()
    const generateText = routedLLM({
      extraction: JSON.stringify([
        { kind: 'semantic', content: 'new alpha', importance: 0.8 },
        { kind: 'semantic', content: 'redis', importance: 0.8 },
        { kind: 'semantic', content: 'postgres', importance: 0.8 }
      ]),
      decision: [
        '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"redis replaced"}',
        '{"decision":"CHALLENGE","targetIndex":0,"mergedContent":null}'
      ]
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({
        memoryEnabled: true,
        memoryEmbedding: { providerId: 'p', modelId: 'm' },
        memoryExtractionModel: { providerId: 'cheap', modelId: 'cheap' }
      }),
      getEmbeddings: async (_providerId, _modelId, texts) =>
        texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      generateText,
      createVectorStore: async () => store,
      onMemoryChanged
    })
    await seedEmbedded(presenter, 'redis old')
    await seedEmbedded(presenter, 'postgres old')
    onMemoryChanged.mockClear()

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: new alpha, redis, postgres',
      model: { providerId: 'main', modelId: 'main' },
      sourceSession: 'session-1'
    })

    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(3)
    const chipCreatedIds = onMemoryChanged.mock.calls[0]?.[2]?.createdIds
    const supersedeCreatedIds = result.createdIds.filter((id) =>
      [...repo.rows.values()].some((row) => row.superseded_by === id)
    )
    const challengeCreatedIds = result.createdIds.filter(
      (id) => repo.getById(id)?.status === 'conflicted'
    )

    expect(chipCreatedIds).toHaveLength(1)
    expect(supersedeCreatedIds).toHaveLength(1)
    expect(challengeCreatedIds).toHaveLength(1)
    expect(result.createdIds).toContain(chipCreatedIds![0])
    expect(chipCreatedIds).not.toContain(supersedeCreatedIds[0])
    expect(chipCreatedIds).not.toContain(challengeCreatedIds[0])
    expect(onMemoryChanged).toHaveBeenCalledWith(
      'a',
      'extract',
      expect.objectContaining({
        sessionId: 'session-1',
        createdIds: chipCreatedIds
      })
    )
  })
})

describe('MemoryPresenter async write guards', () => {
  it('invalidates an empty clear while extraction triage is awaiting the provider', async () => {
    const repo = new FakeRepository()
    const onMemoryChanged = vi.fn()
    let resolveTriage!: (value: string) => void
    let markTriageStarted!: () => void
    const triageStarted = new Promise<void>((resolve) => {
      markTriageStarted = resolve
    })
    const generateText = vi.fn(
      () =>
        new Promise<string>((resolveText) => {
          resolveTriage = resolveText
          markTriageStarted()
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined,
      onMemoryChanged
    })

    const pending = presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: remember this later',
      model: { providerId: 'p', modelId: 'm' }
    })
    await triageStarted
    expect(await presenter.clearMemories('a')).toBe(0)
    resolveTriage('KEEP')

    await expect(pending).resolves.toEqual({ ok: false })
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(repo.countByAgent('a')).toBe(0)
    expect(onMemoryChanged).not.toHaveBeenCalled()
  })

  it('invalidates a non-empty clear while candidate extraction is awaiting the provider', async () => {
    const repo = new FakeRepository()
    const onMemoryChanged = vi.fn()
    let resolveExtraction!: (value: string) => void
    let markExtractionStarted!: () => void
    const extractionStarted = new Promise<void>((resolve) => {
      markExtractionStarted = resolve
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText: async (_providerId, _modelId, prompt) => {
        if (prompt.includes('KEEP or SKIP')) return 'KEEP'
        markExtractionStarted()
        return new Promise<string>((resolve) => {
          resolveExtraction = resolve
        })
      },
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined,
      onMemoryChanged
    })
    repo.insert({ id: 'existing', agentId: 'a', kind: 'semantic', content: 'old fact' })

    const pending = presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: remember this later',
      model: { providerId: 'p', modelId: 'm' }
    })
    await extractionStarted
    expect(await presenter.clearMemories('a')).toBe(1)
    onMemoryChanged.mockClear()
    resolveExtraction('[{"kind":"semantic","content":"late orphan","importance":0.9}]')

    await expect(pending).resolves.toEqual({ ok: false })
    expect(repo.countByAgent('a')).toBe(0)
    expect(onMemoryChanged).not.toHaveBeenCalled()
  })

  it('invalidates clear while a decision is awaiting the provider', async () => {
    const repo = new FakeRepository()
    const onMemoryChanged = vi.fn()
    let resolveDecision!: (value: string) => void
    let markDecisionStarted!: () => void
    const decisionStarted = new Promise<void>((resolve) => {
      markDecisionStarted = resolve
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_providerId, _modelId, texts) => texts.map(textToVector),
      getDimensions: embeddingDimensions,
      generateText: async (_providerId, _modelId, prompt) => {
        if (prompt.includes('KEEP or SKIP')) return 'KEEP'
        if (prompt.includes('JSON array')) {
          return '[{"kind":"semantic","content":"redis preference","importance":0.9}]'
        }
        markDecisionStarted()
        return new Promise<string>((resolve) => {
          resolveDecision = resolve
        })
      },
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined,
      onMemoryChanged
    })
    repo.insert({
      id: 'target',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis fact',
      status: 'embedded'
    })

    const pending = presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: redis preference',
      model: { providerId: 'p', modelId: 'm' }
    })
    await decisionStarted
    expect(await presenter.clearMemories('a')).toBe(1)
    onMemoryChanged.mockClear()
    resolveDecision('{"decision":"UPDATE","targetIndex":0,"mergedContent":"late update"}')

    await expect(pending).resolves.toEqual({ ok: false })
    expect(repo.countByAgent('a')).toBe(0)
    expect(onMemoryChanged).not.toHaveBeenCalled()
  })

  it('invalidates a slow decision when the embedding identity changes', async () => {
    const repo = new FakeRepository()
    let config: DeepChatAgentConfig = enabledConfig
    let resolveDecision!: (value: string) => void
    let markDecisionStarted!: () => void
    const decisionStarted = new Promise<void>((resolve) => {
      markDecisionStarted = resolve
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_providerId, _modelId, texts) => texts.map(textToVector),
      getDimensions: embeddingDimensions,
      generateText: async (_providerId, _modelId, prompt) => {
        if (prompt.includes('KEEP or SKIP')) return 'KEEP'
        if (prompt.includes('JSON array')) {
          return '[{"kind":"semantic","content":"redis preference","importance":0.9}]'
        }
        markDecisionStarted()
        return new Promise<string>((resolve) => {
          resolveDecision = resolve
        })
      },
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'target',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis fact',
      status: 'embedded'
    })
    presenter.onAgentMemoryMaintenanceConfigChanged('a')

    const pending = presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: redis preference',
      model: { providerId: 'p', modelId: 'm' }
    })
    await decisionStarted
    config = {
      ...enabledConfig,
      memoryEmbedding: { providerId: 'p', modelId: 'm2' }
    }
    presenter.onAgentMemoryMaintenanceConfigChanged('a')
    resolveDecision('{"decision":"UPDATE","targetIndex":0,"mergedContent":"late update"}')

    await expect(pending).resolves.toEqual({ ok: false })
    expect(repo.getById('target')?.content).toBe('redis fact')
    expect(repo.listByAgent('a')).toHaveLength(1)
  })

  it('does not start extraction for unmanaged agents', async () => {
    const repo = new FakeRepository()
    const generateText = vi.fn(async () => 'KEEP')
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      isManagedAgent: () => false,
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })

    await expect(
      presenter.extractAndStore({
        agentId: 'a',
        spanText: 'User: remember this later',
        model: { providerId: 'p', modelId: 'm' }
      })
    ).resolves.toEqual({ ok: false })

    expect(generateText).not.toHaveBeenCalled()
    expect(repo.countByAgent('a')).toBe(0)
  })

  it('does not write extraction results after the agent becomes unmanaged', async () => {
    const repo = new FakeRepository()
    let managed = true
    let releaseExtraction!: () => void
    let extractionStarted!: () => void
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve
    })
    const extractionStartedGate = new Promise<void>((resolve) => {
      extractionStarted = resolve
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      isManagedAgent: () => managed,
      getEmbeddings: async () => [],
      generateText: async (_providerId, _modelId, prompt) => {
        if (prompt.includes('KEEP or SKIP')) return 'KEEP'
        if (prompt.includes('JSON array')) {
          extractionStarted()
          await extractionGate
          return '[{"kind":"semantic","content":"late orphan","importance":0.9}]'
        }
        return ''
      },
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })

    const pending = presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: remember this later',
      model: { providerId: 'p', modelId: 'm' }
    })
    await extractionStartedGate
    managed = false
    releaseExtraction()

    await expect(pending).resolves.toEqual({ ok: false })
    expect(repo.countByAgent('a')).toBe(0)
  })

  it('does not write reflection results after the agent becomes unmanaged', async () => {
    const repo = new FakeRepository()
    let managed = true
    let releaseReflection!: () => void
    let reflectionStarted!: () => void
    const reflectionGate = new Promise<void>((resolve) => {
      releaseReflection = resolve
    })
    const reflectionStartedGate = new Promise<void>((resolve) => {
      reflectionStarted = resolve
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      isManagedAgent: () => managed,
      getEmbeddings: async () => [],
      generateText: async (_providerId, _modelId, prompt) => {
        if (prompt.includes('high-level insights')) {
          reflectionStarted()
          await reflectionGate
          return '["late reflection"]'
        }
        return ''
      },
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    for (let index = 0; index < 6; index += 1) {
      repo.insert({
        id: `m-${index}`,
        agentId: 'a',
        kind: 'semantic',
        content: `important fact ${index}`,
        importance: 1,
        status: 'embedded',
        createdAt: 100 + index
      })
    }

    const pending = presenter.maybeReflect('a', { providerId: 'p', modelId: 'm' })
    await reflectionStartedGate
    managed = false
    releaseReflection()

    await expect(pending).resolves.toBeNull()
    expect(repo.listByAgent('a', { kinds: ['reflection'] })).toHaveLength(0)
  })

  it('does not write reflection results after memories are cleared', async () => {
    const repo = new FakeRepository()
    let releaseReflection!: (value: string) => void
    let reflectionStarted!: () => void
    const reflectionStartedGate = new Promise<void>((resolve) => {
      reflectionStarted = resolve
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText: async (_providerId, _modelId, prompt) => {
        if (!prompt.includes('high-level insights')) return ''
        reflectionStarted()
        return new Promise<string>((resolve) => {
          releaseReflection = resolve
        })
      },
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    for (let index = 0; index < 6; index += 1) {
      repo.insert({
        id: `clear-reflection-${index}`,
        agentId: 'a',
        kind: 'semantic',
        content: `important fact ${index}`,
        importance: 1,
        status: 'embedded',
        createdAt: 100 + index
      })
    }

    const pending = presenter.maybeReflect('a', { providerId: 'p', modelId: 'm' })
    await reflectionStartedGate
    expect(await presenter.clearMemories('a')).toBe(6)
    releaseReflection('["late reflection"]')

    await expect(pending).resolves.toBeNull()
    expect(repo.countByAgent('a')).toBe(0)
  })

  it('does not remember, recall, or inject for unmanaged agents', async () => {
    const repo = new FakeRepository()
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis fact',
      status: 'embedded'
    })
    repo.insert({
      id: 'w1',
      agentId: 'a',
      kind: 'working',
      content: 'working fact',
      status: 'fts_only',
      provenanceKey: buildMemoryProvenanceKey('a', 'working', 'session-working-blob')
    })
    const searchSpy = vi.spyOn(repo, 'search')
    const insertSpy = vi.spyOn(repo, 'insert')
    const getByProvenanceKeySpy = vi.spyOn(repo, 'getByProvenanceKey')
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      isManagedAgent: () => false,
      getEmbeddings: async () => [[1, 0, 0, 0]],
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })

    await expect(
      presenter.rememberMemory({ kind: 'semantic', content: 'new fact' }, { agentId: 'a' }, null)
    ).resolves.toEqual({ action: 'noop', reason: 'disposed' })
    await expect(presenter.recall('a', 'redis')).resolves.toEqual([])
    await expect(presenter.buildInjection('a', 'redis')).resolves.toBeNull()

    expect(insertSpy).not.toHaveBeenCalled()
    expect(searchSpy).not.toHaveBeenCalled()
    expect(getByProvenanceKeySpy).not.toHaveBeenCalled()
  })
})

describe('MemoryPresenter agentId safety guards', () => {
  it('isSafeAgentId accepts well-formed ids and rejects traversal/garbage', () => {
    expect(isSafeAgentId('deepchat')).toBe(true)
    expect(isSafeAgentId('deepchat-Ab12_xy')).toBe(true)
    expect(isSafeAgentId('../../etc/passwd')).toBe(false)
    expect(isSafeAgentId('a/b')).toBe(false)
    expect(isSafeAgentId('a\\b')).toBe(false)
    expect(isSafeAgentId('a.b')).toBe(false)
    expect(isSafeAgentId('')).toBe(false)
    expect(isSafeAgentId('x'.repeat(129))).toBe(false)
  })

  it('management methods reject malformed agentId', async () => {
    const { presenter } = makePresenter(enabledConfig)
    expect(() => presenter.listMemories('../escape')).toThrow(/invalid agentId/)
    expect(() => presenter.getStatus('bad/id')).toThrow(/invalid agentId/)
    expect(() => presenter.getHealth('bad/id')).toThrow(/invalid agentId/)
    expect(() => presenter.listPersonaVersions('bad.id')).toThrow(/invalid agentId/)
    expect(() => presenter.listPersonaDrafts('bad.id')).toThrow(/invalid agentId/)
    await expect(presenter.rollbackPersona('bad id', 'v')).rejects.toThrow(/invalid agentId/)
    await expect(presenter.approvePersonaDraft('bad/id', 'd')).rejects.toThrow(/invalid agentId/)
    await expect(presenter.rejectPersonaDraft('bad/id', 'd')).rejects.toThrow(/invalid agentId/)
    await expect(presenter.setPersonaAnchor('bad/id', 'v', true)).rejects.toThrow(/invalid agentId/)
    await expect(presenter.deleteMemory('bad/id', 'm')).rejects.toThrow(/invalid agentId/)
    await expect(presenter.clearMemories('bad/id')).rejects.toThrow(/invalid agentId/)
  })

  it('management methods no-op for unmanaged (nonexistent) agents', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      isManagedAgent: (id) => id === 'real',
      getEmbeddings: async () => [],
      generateText: async () => '[]',
      createVectorStore: async () => store
    })
    // The internal write path (extraction) bypasses the management guard with a trusted agentId.
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'real' })

    // Well-formed but not a real agent: reads come back empty and mutations are no-ops.
    expect(presenter.listMemories('ghost')).toEqual([])
    expect(presenter.getStatus('ghost')).toEqual({
      total: 0,
      pendingEmbedding: 0,
      hasPersona: false,
      activeMemoryCount: 0,
      archivedMemoryCount: 0,
      conflictCount: 0,
      personaDraftCount: 0,
      personaVersionCount: 0
    })
    expect(presenter.getHealth('ghost')).toEqual(createEmptyMemoryHealth())
    expect(await presenter.clearMemories('ghost')).toBe(0)
    expect(await presenter.rollbackPersona('ghost', 'v')).toBe(false)

    // A real agent works normally.
    expect(presenter.listMemories('real')).toHaveLength(1)
    expect(repo.countByAgent('real')).toBe(1)
  })
})

describe('MemoryPresenter health read model', () => {
  it('assembles health from read-only repository and audit stats', () => {
    const { presenter, repo, auditRepo } = makePresenter(enabledConfig)
    const now = Date.now()
    repo.insert({
      id: 'current',
      agentId: 'a',
      kind: 'semantic',
      category: 'project_fact',
      content: 'repo uses pnpm',
      createdAt: now - DAY
    })
    repo.updateStatus('current', 'embedded', {
      embeddingId: 'current',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    repo.insert({
      id: 'legacy',
      agentId: 'a',
      kind: 'semantic',
      content: 'legacy vector',
      createdAt: now - 2 * DAY
    })
    repo.updateStatus('legacy', 'embedded', {
      embeddingId: 'legacy',
      embeddingDim: 8,
      embeddingModel: 'p:m'
    })
    repo.insert({
      id: 'archive',
      agentId: 'a',
      kind: 'semantic',
      category: 'heuristic',
      content: 'old unused',
      createdAt: now - 400 * DAY
    })
    repo.updateDecayScore('archive', 0.01)
    repo.recordAccess('current', now)
    auditRepo.insert({
      id: 'audit-1',
      agentId: 'a',
      eventType: 'memory/maintenance_llm',
      actorType: 'scheduler',
      status: 'failed',
      reason: 'model unavailable',
      createdAt: 4000
    })

    const archiveSpy = vi.spyOn(repo, 'archive')
    const deleteSpy = vi.spyOn(repo, 'delete')
    const insertSpy = vi.spyOn(repo, 'insert')
    const updateStatusSpy = vi.spyOn(repo, 'updateStatus')

    const health = presenter.getHealth('a')

    expect(health.totalRows).toBe(3)
    expect(health.byCategory.project_fact).toBe(1)
    expect(health.embeddings.stale).toBe(1)
    expect(health.lifecycle.archiveCandidates).toBe(1)
    expect(health.access.topAccessed).toEqual([
      expect.objectContaining({
        id: 'current',
        category: 'project_fact',
        accessCount: 1
      })
    ])
    expect(health.maintenance.failed).toBe(1)
    expect(health.maintenance.recentFailures[0]).toEqual({
      eventType: 'memory/maintenance_llm',
      status: 'failed',
      reason: 'model unavailable',
      createdAt: 4000
    })
    expect(archiveSpy).not.toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
    expect(updateStatusSpy).not.toHaveBeenCalled()
  })

  it('returns stale=0 without an embedding config', () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true } as DeepChatAgentConfig)
    repo.insert({ id: 'legacy', agentId: 'a', kind: 'semantic', content: 'legacy' })
    repo.updateStatus('legacy', 'embedded', {
      embeddingId: 'legacy',
      embeddingDim: 8,
      embeddingModel: 'old:model'
    })

    expect(presenter.getHealth('a').embeddings.stale).toBe(0)
  })
})

describe('writeMemoriesSync insert error classification (C2, AC-2.2)', () => {
  it('swallows UNIQUE constraint races as dedupe', () => {
    const repo = new FakeRepository()
    const uniqueError = Object.assign(
      new Error('UNIQUE constraint failed: agent_memory.provenance_key'),
      { code: 'SQLITE_CONSTRAINT_UNIQUE' }
    )
    vi.spyOn(repo, 'insert').mockImplementation(() => {
      throw uniqueError
    })
    const { presenter } = makePresenter(enabledConfig, repo)

    const created = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    expect(created).toEqual([])
  })

  it('rethrows non-UNIQUE SQLite errors instead of silently dropping memories', () => {
    const repo = new FakeRepository()
    vi.spyOn(repo, 'insert').mockImplementation(() => {
      throw Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' })
    })
    const { presenter } = makePresenter(enabledConfig, repo)

    expect(() =>
      presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    ).toThrow('disk I/O error')
  })

  it('extractAndStore degrades to ok:false on a real insert error (cursor must not advance)', async () => {
    const repo = new FakeRepository()
    vi.spyOn(repo, 'insert').mockImplementation(() => {
      throw Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' })
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText: async () => '[{"kind":"semantic","content":"likes redis","importance":0.9}]',
      createVectorStore: async () => new FakeVectorStore()
    })

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis',
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(result.ok).toBe(false)
  })
})

describe('MemoryPresenter embedding reindex (T5, AC-3.x)', () => {
  it('serializes coverage verification with embedding persistence for the same agent', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    repo.insert({
      id: 'embedded',
      agentId: 'a',
      kind: 'semantic',
      content: 'existing redis memory',
      status: 'pending_embedding'
    })
    repo.updateStatus('embedded', 'embedded', {
      embeddingId: 'embedded',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    store.vectors.set('embedded', textToVector('existing redis memory'))
    repo.insert({
      id: 'pending',
      agentId: 'a',
      kind: 'semantic',
      content: 'new redis memory',
      status: 'pending_embedding'
    })

    let releaseList!: () => void
    let listStarted!: () => void
    const started = new Promise<void>((resolve) => {
      listStarted = resolve
    })
    vi.spyOn(store, 'listMemoryIds').mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          listStarted()
          releaseList = () => resolve([...store.vectors.keys()].sort())
        })
    )
    const upsert = vi.spyOn(store, 'upsert')

    await presenter.recall('a', 'redis')
    await started
    const drain = presenter.processPendingEmbeddings('a')
    await flushMicrotasks()

    expect(upsert).not.toHaveBeenCalled()
    expect(repo.getById('pending')?.status).toBe('pending_embedding')

    releaseList()
    await drain

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(store.vectors.has('pending')).toBe(true)
    expect(repo.getById('pending')).toMatchObject({
      status: 'embedded',
      embedding_id: 'pending'
    })
  })

  it('deletes orphan vectors in bounded batches during warm reconcile', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    for (let index = 0; index < 601; index += 1) {
      store.vectors.set(`orphan-${String(index).padStart(4, '0')}`, textToVector('orphan redis'))
    }
    const deleteSpy = vi.spyOn(store, 'deleteByMemoryIds')

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => store.vectors.size === 0, 'orphan vectors were not deleted')

    expect(deleteSpy).toHaveBeenCalledTimes(2)
    expect(deleteSpy.mock.calls.map(([ids]) => ids.length)).toEqual([512, 89])
    expect(deleteSpy.mock.calls.every(([ids]) => ids.length <= 512)).toBe(true)
  })

  it('withholds readiness when coverage cleanup fails and retries on the next warm', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    store.vectors.set('orphan-0001', textToVector('orphan redis'))
    const deleteSpy = vi.spyOn(store, 'deleteByMemoryIds')
    deleteSpy.mockRejectedValueOnce(new Error('delete failed'))
    const internals = memoryRuntimeForTests(presenter)

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => deleteSpy.mock.calls.length === 1)
    expect(store.vectors.has('orphan-0001')).toBe(true)
    expect(internals.vectorStoreReady.has('a')).toBe(false)

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(
      () => deleteSpy.mock.calls.length >= 2 && !store.vectors.has('orphan-0001'),
      'coverage verification did not retry after failure'
    )
    await waitForMemoryCondition(() => internals.vectorStoreReady.has('a'))
  })

  it('cleanupDeletedAgentResources waits for in-flight coverage verification', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    let releaseList!: () => void
    vi.spyOn(store, 'listMemoryIds').mockImplementationOnce(
      async () =>
        new Promise<string[]>((resolve) => {
          releaseList = () => resolve([])
        })
    )
    const internals = memoryRuntimeForTests(presenter)

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(
      () => internals.vectorStoreWarmups.size === 1 && typeof releaseList === 'function',
      'coverage verification did not enter in-flight tracking'
    )

    let cleanupDone = false
    const cleanup = presenter.cleanupDeletedAgentResources('a').then(() => {
      cleanupDone = true
    })
    await flushMicrotasks()
    expect(cleanupDone).toBe(false)

    releaseList()
    await cleanup

    expect(cleanupDone).toBe(true)
    expect(internals.vectorStoreWarmups.size).toBe(0)
  })

  it('reindexEmbeddings re-queues, rebuilds the store, and re-embeds with the new fingerprint', async () => {
    const repo = new FakeRepository()
    let config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm1' }
    }
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const resetVectorStore = vi.fn(async () => undefined)
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [0.1, 0.2]),
      createVectorStore,
      resetVectorStore
    })

    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    expect(repo.getById(id!)?.embedding_model).toBe('p:m1')
    expect(createVectorStore).toHaveBeenCalledTimes(1)

    // Same dimension, different model: the per-row fingerprint is what catches this.
    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm2' } }
    await presenter.reindexEmbeddings('a')

    // Non-destructive: the on-disk store is dropped and rebuilt, the SQLite row survives.
    expect(resetVectorStore).toHaveBeenCalledWith('a')
    expect(repo.getById(id!)).toBeDefined()
    expect(repo.getById(id!)?.status).toBe('embedded')
    expect(repo.getById(id!)?.embedding_model).toBe('p:m2')
    expect(createVectorStore).toHaveBeenCalledTimes(2)
  })

  it('treats a legacy NULL fingerprint as stale and re-embeds it', async () => {
    const repo = new FakeRepository()
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [0.1, 0.2]),
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    // A row embedded before the fingerprint column existed: status embedded, model NULL.
    repo.insert({ id: 'legacy', agentId: 'a', kind: 'semantic', content: 'redis' })
    repo.updateStatus('legacy', 'embedded', { embeddingId: 'legacy', embeddingDim: 2 })
    expect(repo.getById('legacy')?.embedding_model).toBeNull()

    await presenter.reindexEmbeddings('a')
    expect(repo.getById('legacy')?.embedding_model).toBe('p:m')
  })

  it('recall detects a stale fingerprint, answers from FTS, and kicks off a reindex (AC-3.1/3.3)', async () => {
    const repo = new FakeRepository()
    let config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm1' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [0.1, 0.2]),
      getDimensions: async () => ({ data: { dimensions: 2, normalized: false } }),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')

    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm2' } }
    const results = await presenter.recall('a', 'redis')
    // FTS still answers immediately; stale vectors are re-queued by the background warm.
    expect(results.some((item) => item.content === 'redis fact')).toBe(true)
    expect(repo.getById(id!)?.embedding_model).toBe('p:m1')

    await waitForMemoryCondition(() => repo.getById(id!)?.embedding_model === 'p:m2')
    expect(repo.getById(id!)?.embedding_model).toBe('p:m2')
  })

  it('invalidates readiness on the config hook and issues a new generation certificate', async () => {
    const repo = new FakeRepository()
    let config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm1' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_providerId, _modelId, texts) =>
        texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    const internals = memoryRuntimeForTests(presenter)
    const firstCertificate = internals.vectorStoreReady.get('a')!

    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm2' } }
    presenter.onAgentMemoryMaintenanceConfigChanged('a')
    expect(internals.vectorStoreReady.has('a')).toBe(false)

    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => repo.getById(id)?.embedding_model === 'p:m2')
    await waitForMemoryCondition(() => internals.vectorStoreReady.get('a')?.modelId === 'm2')
    const secondCertificate = internals.vectorStoreReady.get('a')!
    expect(secondCertificate.configGeneration).toBeGreaterThan(firstCertificate.configGeneration)
    expect(secondCertificate.storeGeneration).toBeGreaterThan(firstCertificate.storeGeneration)
  })

  it('reindex recovers rows left in error by a prior failed embed', async () => {
    const repo = new FakeRepository()
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [0.1, 0.2]),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    // A row a previous embed gave up on (e.g. a vector store write failure).
    repo.insert({ id: 'stuck', agentId: 'a', kind: 'semantic', content: 'redis', status: 'error' })

    await presenter.reindexEmbeddings('a')
    expect(repo.getById('stuck')?.status).toBe('embedded')
    expect(repo.getById('stuck')?.embedding_model).toBe('p:m')
  })

  it('recall backfills fts_only rows once an embedding model is configured (P1-A)', async () => {
    const repo = new FakeRepository()
    let config: DeepChatAgentConfig = { memoryEnabled: true }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    // No embedding config yet: the row is deferred to fts_only.
    await presenter.processPendingEmbeddings('a')
    expect(repo.listByAgent('a')[0]?.status).toBe('fts_only')

    // Model configured later. recall reaches a healthy store and kicks the backfill.
    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm' } }
    const spy = vi.spyOn(presenter, 'backfillEmbeddings')
    await presenter.recall('a', 'redis')
    await waitForMemoryCondition(() => spy.mock.calls.length > 0)
    expect(spy).toHaveBeenCalledWith('a')
    await spy.mock.results[0]?.value

    expect(repo.listByAgent('a')[0]?.status).toBe('embedded')
    expect(repo.listByAgent('a')[0]?.embedding_model).toBe('p:m')
  })

  it('does not issue an empty fts_only requeue during backfill', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const requeueSpy = vi.spyOn(repo, 'requeueForEmbedding')

    await presenter.backfillEmbeddings('a')

    expect(requeueSpy).not.toHaveBeenCalled()
  })

  it('re-drains rows a failed reindex left pending on the next backfill (P1-B)', async () => {
    const repo = new FakeRepository()
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    let serviceDown = false
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) => {
      if (serviceDown) throw new Error('embedding service down')
      return texts.map((text) => textToVector(text))
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(repo.listByAgent('a')[0]?.status).toBe('embedded')

    // A reindex during an outage re-queues then stalls: the row stays pending, never terminal.
    serviceDown = true
    await presenter.reindexEmbeddings('a')
    expect(repo.listByAgent('a')[0]?.status).toBe('pending_embedding')

    // Service recovers; the next backfill (as recall would trigger) re-drains the leftover.
    serviceDown = false
    await presenter.backfillEmbeddings('a')
    expect(repo.listByAgent('a')[0]?.status).toBe('embedded')
  })

  it('never vectorizes persona rows during reindex/backfill (P2)', async () => {
    const repo = new FakeRepository()
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    repo.insert({
      id: 'persona1',
      agentId: 'a',
      kind: 'persona',
      content: 'I answer concisely',
      status: 'fts_only'
    })
    repo.insert({
      id: 'fact1',
      agentId: 'a',
      kind: 'semantic',
      content: 'likes redis',
      status: 'fts_only'
    })

    await presenter.reindexEmbeddings('a')
    // The self-model stays fts_only; only the real memory is embedded.
    expect(repo.getById('persona1')?.status).toBe('fts_only')
    expect(repo.getById('fact1')?.status).toBe('embedded')
  })

  it('ignores an anomalous embedded persona: no reindex churn, not recalled (P2)', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    store.vectors.set('m1', textToVector('redis cached row'))
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    // Anomalous data: a persona wrongly marked embedded with a STALE fingerprint, its vector
    // already sitting in the sidecar (as a buggy backfill or manual import would leave it).
    repo.insert({
      id: 'persona1',
      agentId: 'a',
      kind: 'persona',
      content: 'redis persona',
      status: 'fts_only'
    })
    repo.updateStatus('persona1', 'embedded', {
      embeddingId: 'persona1',
      embeddingDim: 4,
      embeddingModel: 'p:OLD'
    })
    await store.upsert([{ memoryId: 'persona1', embedding: textToVector('redis persona') }])
    // A normal fact embedded with the current fingerprint.
    repo.insert({
      id: 'fact1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis fact',
      status: 'fts_only'
    })
    repo.updateStatus('fact1', 'embedded', {
      embeddingId: 'fact1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    await store.upsert([{ memoryId: 'fact1', embedding: textToVector('redis fact') }])

    const spy = vi.spyOn(presenter, 'reindexEmbeddings')
    const results = await presenter.recall('a', 'redis')

    // The stale persona must not be read as stale (no reindex), nor surface as a normal memory.
    expect(spy).not.toHaveBeenCalled()
    const ids = results.map((item) => item.id)
    expect(ids).toContain('fact1')
    expect(ids).not.toContain('persona1')
  })

  it('excludes persona rows from recall results (P2)', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'persona1',
      agentId: 'a',
      kind: 'persona',
      content: 'redis persona note',
      status: 'fts_only'
    })
    repo.insert({
      id: 'fact1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis fact',
      status: 'fts_only'
    })

    const results = await presenter.recall('a', 'redis')
    const ids = results.map((item) => item.id)
    expect(ids).toContain('fact1')
    expect(ids).not.toContain('persona1')
  })

  it('rebuilds an unusable sidecar so pending/fts_only rows recover (P1)', async () => {
    const repo = new FakeRepository()
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    let didReset = false
    const unusable: IMemoryVectorStore = {
      upsert: async () => {},
      query: async () => [],
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => [],
      close: async () => {},
      isUsable: () => false
    }
    const usable = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => (didReset ? usable : unusable))
    const resetVectorStore = vi.fn(async () => {
      didReset = true
    })
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore,
      resetVectorStore
    })
    // Only fts_only rows: no embedded row exists to flag the foreign sidecar as stale.
    repo.insert({
      id: 'fact1',
      agentId: 'a',
      kind: 'semantic',
      content: 'redis fact',
      status: 'fts_only'
    })

    const spy = vi.spyOn(presenter, 'reindexEmbeddings')
    await presenter.recall('a', 'redis')
    expect(getEmbeddings).not.toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['memory warmup'], expect.any(AbortSignal))
    await waitForMemoryCondition(() => spy.mock.calls.length > 0)
    expect(spy).toHaveBeenCalledWith('a', true)
    await spy.mock.results[0]?.value

    expect(resetVectorStore).toHaveBeenCalledWith('a')
    expect(repo.getById('fact1')?.status).toBe('embedded')
    getEmbeddings.mockClear()
    const querySpy = vi.spyOn(usable, 'query')
    await presenter.recall('a', 'redis')
    expect(getEmbeddings).toHaveBeenCalledWith('p', 'm', ['redis'], expect.any(AbortSignal))
    expect(querySpy).toHaveBeenCalled()
  })

  it('never queries an unusable vector store, falling back to FTS without errors (AC-5.3)', async () => {
    const repo = new FakeRepository()
    const query = vi.fn(async () => [])
    const unusableStore = { ...new FakeVectorStore(), isUsable: () => false, query }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => unusableStore
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })

    const results = await presenter.recall('a', 'redis')
    expect(query).not.toHaveBeenCalled()
    expect(results.some((item) => item.content === 'redis fact')).toBe(true)
  })
})

describe('MemoryPresenter dispose lifecycle (C4, AC-4.1)', () => {
  it('closes cached vector stores and is idempotent', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const closeSpy = vi.spyOn(store, 'close')

    await presenter.dispose()
    expect(closeSpy).toHaveBeenCalledTimes(1)

    await presenter.dispose()
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('dispose waits for in-flight embedding warmups before clearing tracking', async () => {
    let resolveWarmup!: () => void
    const getEmbeddings = vi.fn(
      async () =>
        new Promise<number[][]>((resolve) => {
          resolveWarmup = () => resolve([textToVector('memory warmup')])
        })
    )
    const presenter = new MemoryPresenter({
      repository: new FakeRepository(),
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      getDimensions: embeddingDimensions,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    const internals = memoryRuntimeForTests(presenter)

    internals.warmEmbeddingConnection('a', { providerId: 'p', modelId: 'm' })
    await waitForMemoryCondition(() => getEmbeddings.mock.calls.length === 1)
    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(internals.embeddingWarmups.size).toBe(1)

    let disposed = false
    const dispose = presenter.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)

    resolveWarmup()
    await dispose

    expect(disposed).toBe(true)
    expect(internals.embeddingWarmups.size).toBe(0)
  })
})

// ==================== SDD-4: consolidation & forgetting ====================

const DAY = 24 * 60 * 60 * 1000

const embeddingConfig: DeepChatAgentConfig = {
  memoryEnabled: true,
  memoryEmbedding: { providerId: 'p', modelId: 'm' },
  memoryExtractionModel: { providerId: 'cheap', modelId: 'cheap' }
}

// Routes a single generateText stub by prompt so triage/extraction/decision can be controlled
// independently. The decision-prompt branch returns whatever JSON the test wants.
function routedLLM(opts: {
  extraction?: string
  decision?: string | string[]
  throwDecision?: boolean
}) {
  let decisionIndex = 0
  return vi.fn(async (_p: string, _m: string, prompt: string) => {
    if (prompt.includes('KEEP or SKIP')) return 'KEEP'
    if (prompt.includes('JSON array')) return opts.extraction ?? '[]'
    if (prompt.includes('Choose exactly ONE decision')) {
      if (opts.throwDecision) throw new Error('decision model down')
      const candidateIndexes = [...prompt.matchAll(/^Candidate (\d+) \(/gm)].map((match) =>
        Number(match[1])
      )
      if (candidateIndexes.length > 0) {
        const batch = candidateIndexes.map((candidateIndex) => {
          const raw = Array.isArray(opts.decision)
            ? (opts.decision[decisionIndex++] ??
              '{"decision":"ADD","targetIndex":null,"mergedContent":null}')
            : (opts.decision ?? '{"decision":"ADD","targetIndex":null,"mergedContent":null}')
          return { ...JSON.parse(raw), candidateIndex }
        })
        return JSON.stringify(batch)
      }
      if (Array.isArray(opts.decision)) {
        return (
          opts.decision[decisionIndex++] ??
          '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
        )
      }
      return opts.decision ?? '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
    }
    return ''
  })
}

function makeLLMPresenter(
  generateText: ReturnType<typeof vi.fn>,
  config = embeddingConfig,
  repo = new FakeRepository(),
  auditRepo = new FakeAuditRepository()
) {
  const store = new FakeVectorStore()
  const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
    texts.map((text) => textToVector(text))
  )
  const getDimensions = vi.fn(async () => ({
    data: { dimensions: textToVector('').length, normalized: false }
  }))
  const presenter = new MemoryPresenter({
    repository: repo,
    auditRepository: auditRepo,
    resolveAgentConfig: () => config,
    getEmbeddings,
    getDimensions,
    generateText,
    createVectorStore: async () => store,
    resetVectorStore: async () => {
      store.vectors.clear()
    }
  })
  return { presenter, repo, auditRepo, store, getEmbeddings, getDimensions, generateText }
}

async function seedEmbedded(
  presenter: MemoryPresenter,
  content: string,
  agentId = 'a'
): Promise<string> {
  const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content }], { agentId })
  await presenter.processPendingEmbeddings(agentId)
  return id!
}

function seedConflicted(repo: FakeRepository, id: string, targetId: string, content: string): void {
  repo.insert({
    id,
    agentId: 'a',
    kind: 'semantic',
    content,
    status: 'conflicted',
    conflictWith: targetId
  })
  repo.markConflict(targetId, 'challenged')
}

const decisionCalls = (generateText: ReturnType<typeof vi.fn>) =>
  generateText.mock.calls.filter((call) => String(call[2]).includes('Choose exactly ONE decision'))
    .length

describe('MemoryPresenter decision ring (T-A1..T-A5)', () => {
  it('does not admit a second decision partition after destructive clear', async () => {
    const extraction = Array.from({ length: 8 }, (_, index) => ({
      kind: 'semantic',
      content: `redis clear race ${index} updated`,
      importance: 0.8
    }))
    let releaseDecision!: (value: string) => void
    let markDecisionStarted!: () => void
    const decisionStarted = new Promise<void>((resolve) => {
      markDecisionStarted = resolve
    })
    let decisionCount = 0
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('JSON array')) return JSON.stringify(extraction)
      if (!prompt.includes('Choose exactly ONE decision')) return ''
      decisionCount += 1
      markDecisionStarted()
      return new Promise<string>((resolve) => {
        releaseDecision = resolve
      })
    })
    const { presenter } = makeLLMPresenter(generateText)
    for (let index = 0; index < 8; index += 1) {
      await seedEmbedded(presenter, `redis clear race ${index} baseline`)
    }

    const pending = presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User updated eight redis topics before clearing memory',
      model: { providerId: 'main', modelId: 'main' }
    })
    await decisionStarted
    expect(await presenter.clearMemories('a')).toBe(8)
    releaseDecision('[]')

    await expect(pending).resolves.toEqual({ ok: false })
    expect(decisionCount).toBe(1)
  })

  it('cancels a slow decision after permanent forget without reviving the cached owner', async () => {
    let releaseDecision!: (value: string) => void
    let markDecisionStarted!: () => void
    const decisionStarted = new Promise<void>((resolve) => {
      markDecisionStarted = resolve
    })
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('JSON array')) {
        return JSON.stringify([
          { kind: 'semantic', content: 'permanently forgotten fact', importance: 0.8 },
          { kind: 'semantic', content: 'redis neighbor update', importance: 0.8 }
        ])
      }
      if (!prompt.includes('Choose exactly ONE decision')) return ''
      markDecisionStarted()
      return new Promise<string>((resolve) => {
        releaseDecision = resolve
      })
    })
    const repo = new FakeRepository()
    const auditRepo = new FakeAuditRepository()
    const { presenter } = makeLLMPresenter(generateText, embeddingConfig, repo, auditRepo)
    repo.insert({
      id: 'forgotten-owner',
      agentId: 'a',
      kind: 'semantic',
      content: 'permanently forgotten fact',
      status: 'archived'
    })
    await seedEmbedded(presenter, 'redis neighbor baseline')

    const pending = presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User repeats one old fact and updates redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    await decisionStarted
    expect(await presenter.forgetMemory('a', 'forgotten-owner')).toBe(true)
    releaseDecision('[{"candidateIndex":1,"decision":"NOOP","targetIndex":0}]')

    await expect(pending).resolves.toEqual({ ok: false })
    expect(repo.getById('forgotten-owner')?.status).toBe('archived')
    expect(auditRepo.hasForgetEvent('a', 'forgotten-owner')).toBe(true)
  })

  it('bounds eight-candidate steady-state provider work to two decision batches', async () => {
    const extraction = Array.from({ length: 8 }, (_, index) => ({
      kind: 'semantic',
      content: `redis topic ${index} updated`,
      importance: 0.8
    }))
    const generateText = routedLLM({
      extraction: JSON.stringify(extraction),
      decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
    })
    const { presenter, getEmbeddings } = makeLLMPresenter(generateText)
    for (let index = 0; index < 8; index += 1) {
      await seedEmbedded(presenter, `redis topic ${index} baseline`)
    }
    getEmbeddings.mockClear()

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User updated eight redis topics',
      model: { providerId: 'main', modelId: 'main' }
    })

    expect(result).toEqual({ ok: true, createdIds: [] })
    expect(generateText).toHaveBeenCalledTimes(4)
    expect(decisionCalls(generateText)).toBe(2)
    expect(getEmbeddings).toHaveBeenCalledTimes(1)
    expect(getEmbeddings.mock.calls[0][2]).toHaveLength(8)
  })

  it('ADD: model keeps the candidate as a new memory alongside the related neighbor', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user prefers redis","importance":0.8}]',
      decision: '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    await seedEmbedded(presenter, 'user likes redis')

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(1)
    expect(repo.countByAgent('a')).toBe(2)
    expect(decisionCalls(generateText)).toBe(1)
  })

  it('UPDATE: reuses the neighbor row, refreshes content, adds no new row', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user prefers redis","importance":0.8}]',
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers redis 7"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const neighborId = await seedEmbedded(presenter, 'user likes redis')

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer redis 7',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(0)
    expect(repo.countByAgent('a')).toBe(1)
    expect(repo.getById(neighborId)?.content).toBe('user prefers redis 7')
    expect(repo.getById(neighborId)?.status).toBe('pending_embedding')
  })

  it('rolls back decision content and embedding reset when confidence update fails', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user prefers redis","importance":0.8}]',
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"stale partial update"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    const before = { ...repo.getById(targetId)! }
    vi.spyOn(repo, 'setConfidence').mockImplementation(() => {
      throw new Error('injected confidence failure')
    })

    await expect(
      presenter.extractAndStore({
        agentId: 'a',
        spanText: 'User: I prefer redis',
        model: { providerId: 'main', modelId: 'main' }
      })
    ).resolves.toEqual({ ok: false })

    expect(repo.getById(targetId)).toMatchObject({
      content: before.content,
      status: before.status,
      embedding_id: before.embedding_id,
      embedding_dim: before.embedding_dim,
      embedding_model: before.embedding_model,
      decision_revision: before.decision_revision
    })
  })

  it('SUPERSEDE: links the old row to the new one and recall returns only the new', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user dislikes redis now","importance":0.8}]',
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user dislikes redis now"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const oldId = await seedEmbedded(presenter, 'user likes redis')

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: actually I dislike redis now',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(1)
    const newId = result.createdIds[0]
    expect(repo.getById(oldId)?.superseded_by).toBe(newId)
    await presenter.processPendingEmbeddings('a')
    const recalled = await presenter.recall('a', 'redis')
    expect(recalled.some((item) => item.id === oldId)).toBe(false)
    expect(recalled.some((item) => item.id === newId)).toBe(true)
  })

  it('SUPERSEDE retires the old row into an existing duplicate when the merged wording collides', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user now hates redis","importance":0.8}]',
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user prefers postgres"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const oldId = await seedEmbedded(presenter, 'user likes redis')
    const existingId = await seedEmbedded(presenter, 'user prefers postgres')

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I hate redis now',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(0)
    expect(repo.getById(oldId)?.superseded_by).toBe(existingId)
    expect(repo.getById(existingId)?.superseded_by).toBeNull()
  })

  it('NOOP: writes nothing and leaves the neighbor untouched', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user prefers redis","importance":0.8}]',
      decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const neighborId = await seedEmbedded(presenter, 'user likes redis')

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: still redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(0)
    expect(repo.countByAgent('a')).toBe(1)
    expect(repo.getById(neighborId)?.content).toBe('user likes redis')
  })

  it('CHALLENGE: stores the challenger as conflicted and keeps it out of default recall', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user dislikes redis","importance":0.8}]',
      decision: '{"decision":"CHALLENGE","targetIndex":0,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const neighborId = await seedEmbedded(presenter, 'user likes redis')

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: actually I dislike redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(1)
    expect(repo.countByAgent('a')).toBe(1)
    expect(repo.getById(neighborId)?.conflict_state).toBe('challenged')
    const challenger = repo.getById(result.createdIds[0])
    expect(challenger?.status).toBe('conflicted')
    expect(challenger?.conflict_with).toBe(neighborId)
    expect(presenter.listMemories('a').map((row) => row.id)).not.toContain(challenger?.id)
    expect(presenter.listConflicts('a')[0]).toMatchObject({
      challenger: expect.objectContaining({ id: challenger?.id }),
      target: expect.objectContaining({ id: neighborId })
    })
    expect((await presenter.recall('a', 'redis')).map((item) => item.id)).toContain(neighborId)
  })

  it('rejects generic mutations for both sides of an unresolved conflict aggregate', async () => {
    const { presenter, repo } = makeLLMPresenter(routedLLM({}))
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    seedConflicted(repo, 'challenger', targetId, 'user dislikes redis')

    expect(presenter.updateMemory('a', targetId, { content: 'edited target' })).toMatchObject({
      action: 'noop',
      reason: 'conflict'
    })
    expect(
      presenter.updateMemory('a', 'challenger', { content: 'edited challenger' })
    ).toMatchObject({ action: 'noop', reason: 'conflict' })
    await expect(presenter.archiveUserMemory('a', targetId)).resolves.toBe(false)
    await expect(presenter.forgetMemory('a', 'challenger')).resolves.toBe(false)
    await expect(presenter.deleteMemory('a', targetId)).resolves.toBe(false)

    repo.archive(targetId)
    expect(presenter.restoreMemory('a', targetId)).toBe(false)
  })

  it('repairs conflict integrity idempotently with one content-free aggregate audit', async () => {
    const { presenter, repo, auditRepo } = makeLLMPresenter(routedLLM({}))
    repo.insert({
      id: 'target-needs-flag',
      agentId: 'a',
      kind: 'semantic',
      content: 'target one',
      status: 'embedded'
    })
    repo.insert({
      id: 'valid-challenger',
      agentId: 'a',
      kind: 'semantic',
      content: 'challenger one',
      status: 'conflicted',
      conflictWith: 'target-needs-flag'
    })
    repo.insert({
      id: 'missing-target-challenger',
      agentId: 'a',
      kind: 'semantic',
      content: 'challenger two',
      status: 'conflicted',
      conflictWith: 'missing-target'
    })
    repo.insert({
      id: 'orphan-target',
      agentId: 'a',
      kind: 'semantic',
      content: 'orphan target',
      status: 'embedded'
    })
    repo.markConflict('orphan-target', 'challenged')
    repo.insert({
      id: 'residual-link',
      agentId: 'a',
      kind: 'semantic',
      content: 'residual link',
      status: 'embedded',
      conflictWith: 'missing-target'
    })

    const conflictService = memoryRuntimeForTests(presenter).conflictService
    expect(conflictService.repairConflictIntegrity('a')).toEqual({
      repairedTargets: 1,
      archivedChallengers: 1,
      clearedTargets: 1,
      clearedLinks: 1
    })
    expect(repo.getById('target-needs-flag')?.conflict_state).toBe('challenged')
    expect(repo.getById('missing-target-challenger')).toMatchObject({
      status: 'archived',
      conflict_with: null
    })
    expect(repo.getById('orphan-target')?.conflict_state).toBeNull()
    expect(repo.getById('residual-link')?.conflict_with).toBeNull()
    expect(conflictService.repairConflictIntegrity('a')).toEqual({
      repairedTargets: 0,
      archivedChallengers: 0,
      clearedTargets: 0,
      clearedLinks: 0
    })

    const repairAudits = auditRepo
      .listByAgent('a')
      .filter((audit) => audit.event_type === 'memory/conflict_repair')
    expect(repairAudits).toHaveLength(1)
    expect(repairAudits[0].output_refs_json).not.toContain('target-needs-flag')
    expect(repairAudits[0].output_refs_json).not.toContain('missing-target-challenger')
  })

  it('keeps sibling challengers resolvable when keeping the target', async () => {
    const { presenter, repo } = makeLLMPresenter(routedLLM({}))
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    seedConflicted(repo, 'c1', targetId, 'user dislikes redis')
    seedConflicted(repo, 'c2', targetId, 'user avoids redis')

    expect(await presenter.resolveConflict('a', 'c1', 'keep_target')).toBe(true)
    expect(repo.getById(targetId)?.conflict_state).toBe('challenged')
    expect(repo.getById('c1')?.status).toBe('archived')
    expect(presenter.listConflicts('a').map((pair) => pair.challenger.id)).toEqual(['c2'])

    expect(await presenter.resolveConflict('a', 'c2', 'keep_target')).toBe(true)
    expect(repo.getById(targetId)?.conflict_state).toBeNull()
    expect(presenter.listConflicts('a')).toHaveLength(0)
  })

  it('keeps sibling challengers resolvable when keeping both', async () => {
    const { presenter, repo } = makeLLMPresenter(routedLLM({}))
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    seedConflicted(repo, 'c1', targetId, 'user dislikes redis')
    seedConflicted(repo, 'c2', targetId, 'user sometimes likes redis')

    expect(await presenter.resolveConflict('a', 'c1', 'keep_both')).toBe(true)
    expect(repo.getById('c1')?.status).toBe('pending_embedding')
    expect(repo.getById('c1')?.conflict_with).toBeNull()
    expect(repo.getById(targetId)?.conflict_state).toBe('challenged')
    expect(presenter.listConflicts('a').map((pair) => pair.challenger.id)).toEqual(['c2'])

    expect(await presenter.resolveConflict('a', 'c2', 'keep_both')).toBe(true)
    expect(repo.getById('c2')?.status).toBe('pending_embedding')
    expect(repo.getById(targetId)?.conflict_state).toBeNull()
  })

  it('folds sibling challengers into the winning challenger', async () => {
    const { presenter, repo } = makeLLMPresenter(routedLLM({}))
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    seedConflicted(repo, 'c1', targetId, 'user dislikes redis')
    seedConflicted(repo, 'c2', targetId, 'user avoids redis')

    expect(await presenter.resolveConflict('a', 'c1', 'keep_challenger')).toBe(true)
    expect(repo.getById('c1')?.status).toBe('pending_embedding')
    expect(repo.getById('c1')?.conflict_with).toBeNull()
    expect(repo.getById(targetId)?.status).toBe('archived')
    expect(repo.getById(targetId)?.superseded_by).toBe('c1')
    expect(repo.getById('c2')?.status).toBe('archived')
    expect(repo.getById('c2')?.superseded_by).toBe('c1')
    expect(repo.getById('c2')?.conflict_with).toBeNull()
    expect(presenter.listConflicts('a')).toHaveLength(0)
  })

  it('does not resolve conflicts when the agent cannot write memory', async () => {
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' },
      memoryExtractionModel: { providerId: 'cheap', modelId: 'cheap' }
    }
    const { presenter, repo } = makeLLMPresenter(routedLLM({}), config)
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    seedConflicted(repo, 'c1', targetId, 'user dislikes redis')

    config.memoryEnabled = false

    expect(await presenter.resolveConflict('a', 'c1', 'keep_challenger')).toBe(false)
    expect(repo.getById('c1')?.status).toBe('conflicted')
    expect(repo.getById('c1')?.conflict_with).toBe(targetId)
    expect(repo.getById(targetId)?.conflict_state).toBe('challenged')
  })

  it('preserves merged content when challenge resolution updates a challenger', async () => {
    const generateText = routedLLM({
      decision:
        '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers valkey over redis"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    seedConflicted(repo, 'c1', targetId, 'user prefers valkey')

    await presenter.runConsolidationPass('a', now)
    await presenter.processPendingEmbeddings('a')

    expect(repo.getById('c1')?.content).toBe('user prefers valkey over redis')
    expect(repo.getById('c1')?.provenance_key).toBe(
      buildMemoryProvenanceKey('a', 'semantic', 'user prefers valkey over redis')
    )
    expect(repo.getById('c1')?.status).toBe('embedded')
    expect(repo.getById(targetId)?.status).toBe('archived')
  })

  it('does not mark the target challenged when the challenger insert races and fails', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user dislikes redis","importance":0.8}]',
      decision: '{"decision":"CHALLENGE","targetIndex":0,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    const originalInsert = repo.insert.bind(repo)
    vi.spyOn(repo, 'insert').mockImplementation((input) => {
      if (input.status === 'conflicted') throw new Error('UNIQUE constraint failed')
      return originalInsert(input)
    })

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: actually I dislike redis',
      model: { providerId: 'main', modelId: 'main' }
    })

    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(0)
    expect(repo.getById(targetId)?.conflict_state).toBeNull()
    expect(repo.listByAgent('a', { statuses: ['conflicted'] })).toHaveLength(0)
  })

  it('rolls back the challenger when the target is invalidated during the transaction', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user dislikes redis","importance":0.8}]',
      decision: '{"decision":"CHALLENGE","targetIndex":0,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    const originalInsert = repo.insert.bind(repo)
    vi.spyOn(repo, 'insert').mockImplementation((input) => {
      const row = originalInsert(input)
      if (input.status === 'conflicted') repo.archive(targetId, Date.now())
      return row
    })

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: actually I dislike redis',
      model: { providerId: 'main', modelId: 'main' }
    })

    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(0)
    expect(repo.getById(targetId)?.status).toBe('embedded')
    expect(repo.getById(targetId)?.conflict_state).toBeNull()
    expect(repo.listByAgent('a', { statuses: ['conflicted'] })).toHaveLength(0)
  })

  it.each([
    {
      decision: 'UPDATE',
      response:
        '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user strongly prefers redis"}'
    },
    {
      decision: 'SUPERSEDE',
      response: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user dislikes redis now"}'
    },
    {
      decision: 'CHALLENGE',
      response: '{"decision":"CHALLENGE","targetIndex":0,"mergedContent":null}'
    }
  ])('re-recalls and retries one stale $decision decision', async ({ decision, response }) => {
    const repo = new FakeRepository()
    let targetId = ''
    let decisionCallCount = 0
    const generateText = vi.fn(async (_providerId: string, _modelId: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('JSON array')) {
        return '[{"kind":"semantic","content":"user changed redis preference","importance":0.8}]'
      }
      if (prompt.includes('Choose exactly ONE decision')) {
        decisionCallCount += 1
        if (decisionCallCount === 1) {
          repo.updateUserMetadata(targetId, { importance: 0.7 })
        }
        return response
      }
      return ''
    })
    const { presenter } = makeLLMPresenter(generateText, embeddingConfig, repo)
    targetId = await seedEmbedded(presenter, 'user likes redis')

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: my redis preference changed',
      model: { providerId: 'main', modelId: 'main' }
    })

    if (!result.ok) throw new Error('expected ok')
    expect(decisionCallCount).toBe(2)
    if (decision === 'UPDATE') {
      expect(repo.getById(targetId)?.content).toBe('user strongly prefers redis')
    } else if (decision === 'SUPERSEDE') {
      expect(repo.getById(targetId)?.superseded_by).not.toBeNull()
    } else {
      expect(repo.getById(targetId)?.conflict_state).toBe('challenged')
    }
  })

  it('does not retry a failed candidate embedding provider call during CAS contention', async () => {
    const repo = new FakeRepository()
    let targetId = ''
    let decisionCallCount = 0
    const generateText = vi.fn(async (_providerId: string, _modelId: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('JSON array')) {
        return '[{"kind":"semantic","content":"user changed redis preference","importance":0.8}]'
      }
      if (prompt.includes('Choose exactly ONE decision')) {
        decisionCallCount += 1
        if (decisionCallCount === 1) repo.updateUserMetadata(targetId, { importance: 0.7 })
        return '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers redis"}'
      }
      return ''
    })
    const { presenter, getEmbeddings } = makeLLMPresenter(generateText, embeddingConfig, repo)
    targetId = await seedEmbedded(presenter, 'user likes redis')
    getEmbeddings.mockClear()
    getEmbeddings.mockRejectedValue(new Error('query embedding unavailable'))

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: my redis preference changed',
      model: { providerId: 'main', modelId: 'main' }
    })

    expect(result.ok).toBe(true)
    expect(decisionCallCount).toBe(2)
    const candidateEmbeddingCalls = getEmbeddings.mock.calls.filter(([, , texts]) =>
      texts.includes('user changed redis preference')
    )
    expect(candidateEmbeddingCalls).toHaveLength(1)
    expect(getEmbeddings).toHaveBeenCalledTimes(2)
    expect(repo.getById(targetId)?.content).toBe('user prefers redis')
  })

  it('returns concurrent-update after a second stale decision without mutating the target', async () => {
    const repo = new FakeRepository()
    let targetId = ''
    let decisionCallCount = 0
    const generateText = vi.fn(async (_providerId: string, _modelId: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('JSON array')) {
        return '[{"kind":"semantic","content":"user changed redis preference","importance":0.8}]'
      }
      if (prompt.includes('Choose exactly ONE decision')) {
        decisionCallCount += 1
        repo.updateUserMetadata(targetId, { importance: 0.7 + decisionCallCount * 0.01 })
        return '{"decision":"UPDATE","targetIndex":0,"mergedContent":"stale overwrite"}'
      }
      return ''
    })
    const { presenter } = makeLLMPresenter(generateText, embeddingConfig, repo)
    targetId = await seedEmbedded(presenter, 'user likes redis')

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: my redis preference changed',
      model: { providerId: 'main', modelId: 'main' }
    })

    if (!result.ok) throw new Error('expected ok')
    expect(decisionCallCount).toBe(2)
    expect(result.createdIds).toEqual([])
    expect(repo.getById(targetId)?.content).toBe('user likes redis')
    expect(repo.countByAgent('a')).toBe(1)
  })

  it('retries only the first four conflicts in original order with one provider batch', async () => {
    const repo = new FakeRepository()
    const candidates = Array.from({ length: 5 }, (_, index) => ({
      kind: 'semantic' as const,
      content: `candidate ${index} updated`,
      importance: 0.8
    }))
    const targetIds = candidates.map((_, index) => {
      const id = `target-${index}`
      repo.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content: `target ${index} original`,
        status: 'embedded'
      })
      repo.updateStatus(id, 'embedded', {
        embeddingId: id,
        embeddingDim: 4,
        embeddingModel: 'p:m'
      })
      return id
    })
    let searchCall = 0
    vi.spyOn(repo, 'search').mockImplementation(() => {
      const targetIndex = searchCall < 5 ? searchCall : searchCall - 5
      searchCall += 1
      return [repo.getById(targetIds[targetIndex])!]
    })
    let decisionBatch = 0
    const generateText = vi.fn(async (_providerId: string, _modelId: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('JSON array')) return JSON.stringify(candidates)
      if (!prompt.includes('Choose exactly ONE decision')) return ''
      decisionBatch += 1
      const indexes = [...prompt.matchAll(/^Candidate (\d+) \(/gm)].map((match) => Number(match[1]))
      if (decisionBatch <= 2) {
        indexes.forEach((candidateIndex) => {
          repo.updateUserMetadata(targetIds[candidateIndex], { importance: 0.7 })
        })
      }
      return JSON.stringify(
        indexes.map((candidateIndex) => ({
          candidateIndex,
          decision: 'UPDATE',
          targetIndex: 0,
          mergedContent: `target ${candidateIndex} merged`
        }))
      )
    })
    const { presenter } = makeLLMPresenter(
      generateText,
      { memoryEnabled: true, memoryExtractionModel: { providerId: 'cheap', modelId: 'cheap' } },
      repo
    )

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User updated five candidates',
      model: { providerId: 'main', modelId: 'main' }
    })

    expect(result).toEqual({ ok: true, createdIds: [] })
    expect(decisionBatch).toBe(3)
    expect(searchCall).toBe(9)
    targetIds.slice(0, 4).forEach((id, index) => {
      expect(repo.getById(id)?.content).toBe(`target ${index} merged`)
    })
    expect(repo.getById(targetIds[4])?.content).toBe('target 4 original')
    expect(repo.countByAgent('a')).toBe(5)
  })

  it('falls back to a plain ADD when the decision model throws or returns garbage (T-A2)', async () => {
    const thrown = routedLLM({
      extraction: '[{"kind":"semantic","content":"user prefers redis","importance":0.8}]',
      throwDecision: true
    })
    const a = makeLLMPresenter(thrown)
    await seedEmbedded(a.presenter, 'user likes redis')
    const r1 = await a.presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!r1.ok) throw new Error('expected ok')
    expect(r1.createdIds).toHaveLength(1)
    expect(a.repo.countByAgent('a')).toBe(2)

    const garbage = routedLLM({
      extraction: '[{"kind":"semantic","content":"user prefers redis","importance":0.8}]',
      decision: 'not json at all'
    })
    const b = makeLLMPresenter(garbage)
    await seedEmbedded(b.presenter, 'user likes redis')
    const r2 = await b.presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!r2.ok) throw new Error('expected ok')
    expect(r2.createdIds).toHaveLength(1)
    expect(b.repo.countByAgent('a')).toBe(2)
  })

  it('treats oversized model-generated merged content as an invalid decision', async () => {
    const generateText = routedLLM({
      decision: JSON.stringify({
        decision: 'UPDATE',
        targetIndex: 0,
        mergedContent: 'x'.repeat(2_001)
      })
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const targetId = await seedEmbedded(presenter, 'user likes redis')

    const outcome = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user strongly likes redis', importance: 0.8 },
      { agentId: 'a' },
      { providerId: 'main', modelId: 'main' }
    )

    expect(outcome.action).toBe('created')
    expect(repo.getById(targetId)?.content).toBe('user likes redis')
    expect(repo.countByAgent('a')).toBe(2)
  })

  it('short-circuits a byte-level duplicate before any neighbor recall or decision call (T-A4)', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user likes redis","importance":0.8}]',
      decision: '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
    })
    const { presenter, repo, getEmbeddings } = makeLLMPresenter(generateText)
    await seedEmbedded(presenter, 'user likes redis')
    getEmbeddings.mockClear()

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(0)
    expect(repo.countByAgent('a')).toBe(1)
    expect(decisionCalls(generateText)).toBe(0)
    // No neighbor recall happened, so the candidate was never embedded for a query.
    expect(getEmbeddings).not.toHaveBeenCalled()
  })

  it('merges two near-duplicate preferences into one truth instead of storing both (T-A5)', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user prefers redis format","importance":0.8}]',
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers redis"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    await seedEmbedded(presenter, 'user prefers redis output')

    await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer redis format',
      model: { providerId: 'main', modelId: 'main' }
    })
    expect(repo.countByAgent('a')).toBe(1)
  })

  it('does not write candidate category onto a reflection UPDATE target', async () => {
    const generateText = routedLLM({
      decision:
        '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user likes redis reflection"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    repo.insert({
      id: 'reflection-target',
      agentId: 'a',
      kind: 'reflection',
      content: 'user likes redis',
      importance: 0.8,
      status: 'pending_embedding'
    })
    await presenter.processPendingEmbeddings('a')

    const outcome = await presenter.rememberMemory(
      {
        content: 'user likes redis preference',
        category: 'user_preference',
        importance: 0.2
      },
      { agentId: 'a' },
      { providerId: 'main', modelId: 'main' }
    )

    expect(outcome).toMatchObject({ action: 'updated', id: 'reflection-target' })
    expect(repo.getById('reflection-target')?.kind).toBe('reflection')
    expect(repo.getById('reflection-target')?.category).toBeNull()
  })

  it('explicit rememberMemory uses the decision ring when a model is available', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    await seedEmbedded(presenter, 'user likes redis')
    const outcome = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user prefers redis' },
      { agentId: 'a' },
      { providerId: 'main', modelId: 'main' }
    )
    expect(outcome).toEqual(expect.objectContaining({ action: 'noop', id: expect.any(String) }))
    expect(repo.countByAgent('a')).toBe(1)
    expect(decisionCalls(generateText)).toBeGreaterThan(0)
  })
})

describe('MemoryPresenter forgetting score (T-B1..T-B2)', () => {
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

describe('MemoryPresenter archiving (T-B3)', () => {
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

describe('MemoryPresenter offline consolidation (T-B4..T-B6)', () => {
  it('recall and buildInjection make zero LLM calls; merging only happens in the pass (T-B4)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
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
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const now = 1_000 * DAY
    const generateText = routedLLM({
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user prefers redis"}'
    })
    const createVectorStore = vi.fn(async () => store)
    const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    )
    const presenter = new MemoryPresenter({
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
    repo.updateStatus('old', 'embedded', {
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
    repo.updateStatus('new', 'embedded', {
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
      repo.updateStatus(id, 'embedded', {
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
    vi.spyOn((presenter as any).conflict, 'runChallengeResolutionPass').mockImplementation(
      async (_agentId: string, _model: unknown, budget: MaintenanceBudget) => {
        for (let index = 0; index < 4; index += 1) {
          expect(budget.reserve('challenge', 6_000)).toBe(true)
        }
        return { touched: false, calls: 4, failures: 0 }
      }
    )

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
    const repo = new FakeRepository()
    const auditRepo = new FakeAuditRepository()
    const store = new FakeVectorStore()
    const generateText = routedLLM({
      decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
    })
    let agentDefaultModel: { providerId: string; modelId: string } | null = null
    const presenter = new MemoryPresenter({
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
    const repo = new FakeRepository()
    const auditRepo = new FakeAuditRepository()
    const store = new FakeVectorStore()
    const generateText = routedLLM({
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"merged"}'
    })
    const now = 1_000 * DAY
    const first = new MemoryPresenter({
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

    const restarted = new MemoryPresenter({
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
    const repo = new FakeRepository()
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
    const presenter = new MemoryPresenter({
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
      const repo = new FakeRepository()
      repo.rows.set('a1', makeRow('a1', { agent_id: 'agent-a' }))
      repo.rows.set('b1', makeRow('b1', { agent_id: 'agent-b' }))
      repo.rows.set('disabled1', makeRow('disabled1', { agent_id: 'disabled' }))
      repo.rows.set('orphan1', makeRow('orphan1', { agent_id: 'orphan' }))
      repo.rows.set('archived1', makeRow('archived1', { agent_id: 'archived', status: 'archived' }))

      const presenter = new MemoryPresenter({
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
      const repo = new FakeRepository()
      repo.insert({
        id: 'a1',
        agentId: 'agent-a',
        kind: 'semantic',
        content: 'redis fact',
        status: 'embedded'
      })
      repo.updateStatus('a1', 'embedded', {
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
      repo.updateStatus('b1', 'embedded', {
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
      const presenter = new MemoryPresenter({
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
      const repo = new FakeRepository()
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
      const createVectorStore = vi.fn(async () => new FakeVectorStore())
      const resetVectorStore = vi.fn(async () => undefined)
      const presenter = new MemoryPresenter({
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
      const repo = new FakeRepository()
      repo.rows.set('a1', makeRow('a1', { agent_id: 'agent-a' }))
      const listSpy = vi.spyOn(repo, 'listAgentIdsWithMemories')
      const presenter = new MemoryPresenter({
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
      const repo = new FakeRepository()
      vi.spyOn(repo, 'listAgentIdsWithMemories').mockImplementation(() => {
        throw new Error('repo unavailable')
      })
      const presenter = new MemoryPresenter({
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
      const repo = new FakeRepository()
      repo.rows.set('a1', makeRow('a1', { agent_id: 'agent-a' }))
      repo.rows.set('b1', makeRow('b1', { agent_id: 'agent-b' }))
      const presenter = new MemoryPresenter({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
        generateText: async () => '',
        createVectorStore: async () => new FakeVectorStore(),
        resetVectorStore: async () => undefined
      })
      const passSpy = vi.spyOn(presenter, 'runConsolidationPass').mockResolvedValue()

      presenter.onBuiltinDeepChatMemoryMaintenanceConfigChanged()
      presenter.onAgentMemoryMaintenanceConfigChanged('agent-b')

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(passSpy.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-a', 'agent-b'])

      await vi.advanceTimersByTimeAsync(5 * 1000)
      expect(passSpy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips builtin config fan-out when active-agent enumeration fails (SDD-13)', async () => {
    vi.useFakeTimers()
    try {
      const repo = new FakeRepository()
      vi.spyOn(repo, 'listAgentIdsWithMemories').mockImplementation(() => {
        throw new Error('repo unavailable')
      })
      const presenter = new MemoryPresenter({
        repository: repo,
        resolveAgentConfig: () => enabledConfig,
        getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
        generateText: async () => '',
        createVectorStore: async () => new FakeVectorStore(),
        resetVectorStore: async () => undefined
      })
      const passSpy = vi.spyOn(presenter, 'runConsolidationPass').mockResolvedValue()

      expect(() => presenter.onBuiltinDeepChatMemoryMaintenanceConfigChanged()).not.toThrow()
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 5 * 1000)

      expect(passSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('arms memory config changes only for agents with active memory (SDD-13)', async () => {
    vi.useFakeTimers()
    try {
      const repo = new FakeRepository()
      repo.rows.set('a1', makeRow('a1', { agent_id: 'agent-a' }))
      repo.rows.set('disabled1', makeRow('disabled1', { agent_id: 'disabled' }))
      repo.rows.set('orphan1', makeRow('orphan1', { agent_id: 'orphan' }))
      repo.rows.set('archived1', makeRow('archived1', { agent_id: 'archived', status: 'archived' }))
      const presenter = new MemoryPresenter({
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
      const repo = new FakeRepository()
      repo.rows.set('a1', makeRow('a1', { agent_id: 'agent-a' }))
      const listSpy = vi.spyOn(repo, 'listAgentIdsWithMemories')
      const presenter = new MemoryPresenter({
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
      presenter.onBuiltinDeepChatMemoryMaintenanceConfigChanged()
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
      const repo = new FakeRepository()
      const auditRepo = new FakeAuditRepository()
      const store = new FakeVectorStore()
      const generateText = routedLLM({
        decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
      })
      let agentDefaultModel: { providerId: string; modelId: string } | null = null
      const presenter = new MemoryPresenter({
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

  it('fans out builtin config changes with deterministic stagger (SDD-13)', async () => {
    vi.useFakeTimers()
    try {
      const repo = new FakeRepository()
      repo.rows.set('b1', makeRow('b1', { agent_id: 'agent-b' }))
      repo.rows.set('a1', makeRow('a1', { agent_id: 'agent-a' }))
      repo.rows.set('disabled1', makeRow('disabled1', { agent_id: 'agent-aa-disabled' }))
      repo.rows.set('orphan1', makeRow('orphan1', { agent_id: 'agent-ab-orphan' }))
      repo.rows.set('archived1', makeRow('archived1', { agent_id: 'archived', status: 'archived' }))
      const presenter = new MemoryPresenter({
        repository: repo,
        resolveAgentConfig: (agentId) =>
          agentId === 'agent-aa-disabled' ? { memoryEnabled: false } : enabledConfig,
        isManagedAgent: (agentId) => agentId !== 'agent-ab-orphan',
        getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
        generateText: async () => '',
        createVectorStore: async () => new FakeVectorStore(),
        resetVectorStore: async () => undefined
      })
      const passSpy = vi.spyOn(presenter, 'runConsolidationPass').mockResolvedValue()

      presenter.onBuiltinDeepChatMemoryMaintenanceConfigChanged()
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(passSpy.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-a'])

      await vi.advanceTimersByTimeAsync(5 * 1000)
      expect(passSpy.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-a', 'agent-b'])
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

describe('MemoryPresenter lifecycle revival (SDD-8)', () => {
  it('re-mentioning an archived fact restores it instead of swallowing it (AC-1.1)', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user likes redis","importance":0.8}]'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const id = await seedEmbedded(presenter, 'user likes redis')
    repo.archive(id, 1)
    expect(repo.getById(id)?.status).toBe('archived')

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(0)
    expect(repo.countByAgent('a')).toBe(1)
    expect(repo.getById(id)?.status).not.toBe('archived')
    await presenter.processPendingEmbeddings('a')
    const recalled = await presenter.recall('a', 'redis')
    expect(recalled.some((m) => m.id === id)).toBe(true)
  })

  it('re-stating a superseded preference can revive it after a SUPERSEDE decision (AC-1.2)', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user likes redis","importance":0.8}]',
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user likes redis"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const aId = await seedEmbedded(presenter, 'user likes redis')
    const bId = await seedEmbedded(presenter, 'user dislikes redis')
    repo.markSuperseded(aId, bId)

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis again',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(0)
    expect(repo.getById(aId)?.superseded_by).toBeNull()
    expect(repo.getById(bId)?.superseded_by).toBe(aId)
    await presenter.processPendingEmbeddings('a')
    const recalled = await presenter.recall('a', 'redis')
    expect(recalled.some((m) => m.id === aId)).toBe(true)
    expect(recalled.some((m) => m.id === bId)).toBe(false)
  })

  it('ADD fallback revives a superseded provenance owner instead of dropping the fact', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user likes redis","importance":0.8}]',
      decision: '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const ownerId = await seedEmbedded(presenter, 'user likes redis')
    const headId = await seedEmbedded(presenter, 'user dislikes redis')
    repo.markSuperseded(ownerId, headId)

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis again',
      model: { providerId: 'main', modelId: 'main' }
    })

    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(0)
    expect(repo.getById(ownerId)).toMatchObject({
      status: 'pending_embedding',
      superseded_by: null
    })
    expect(repo.getById(headId)?.superseded_by).toBe(ownerId)
  })

  it('CHALLENGE fallback revives a superseded provenance owner and retires the head', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user likes redis","importance":0.8}]',
      decision: '{"decision":"CHALLENGE","targetIndex":0,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const ownerId = await seedEmbedded(presenter, 'user likes redis')
    const headId = await seedEmbedded(presenter, 'user dislikes redis')
    repo.markSuperseded(ownerId, headId)

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis again',
      model: { providerId: 'main', modelId: 'main' }
    })

    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(0)
    expect(repo.getById(ownerId)?.superseded_by).toBeNull()
    expect(repo.getById(headId)?.superseded_by).toBe(ownerId)
    expect(repo.listByAgent('a', { statuses: ['conflicted'], includeSuperseded: true })).toEqual([])
  })

  it('CHALLENGE fallback does not fold a target invalidated before the collision path', async () => {
    const repo = new FakeRepository()
    let headId = ''
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('JSON array')) {
        return '[{"kind":"semantic","content":"user likes redis","importance":0.8}]'
      }
      if (prompt.includes('Choose exactly ONE decision')) {
        if (headId) repo.archive(headId, Date.now())
        return '{"decision":"CHALLENGE","targetIndex":0,"mergedContent":null}'
      }
      return ''
    })
    const { presenter } = makeLLMPresenter(generateText, embeddingConfig, repo)
    const ownerId = await seedEmbedded(presenter, 'user likes redis')
    headId = await seedEmbedded(presenter, 'user dislikes redis')
    repo.markSuperseded(ownerId, headId)

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis again',
      model: { providerId: 'main', modelId: 'main' }
    })

    if (!result.ok) throw new Error('expected ok')
    expect(repo.getById(ownerId)?.superseded_by).toBe(headId)
    expect(repo.getById(headId)).toMatchObject({
      status: 'archived',
      superseded_by: null
    })
    expect(repo.listByAgent('a', { statuses: ['conflicted'], includeSuperseded: true })).toEqual([])
  })

  it('SUPERSEDE whose merged wording collides with an archived row revives it and folds the target in (AC-1.4)', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user now hates redis","importance":0.8}]',
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user prefers postgres"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    const archivedId = await seedEmbedded(presenter, 'user prefers postgres')
    repo.archive(archivedId, 1)

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I hate redis now',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    expect(repo.getById(archivedId)?.status).not.toBe('archived')
    expect(repo.getById(targetId)?.superseded_by).toBe(archivedId)
  })

  it('SUPERSEDE whose merged wording collides with a superseded row revives it and retires its head (AC-1.4)', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user now hates redis","importance":0.8}]',
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user prefers postgres"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    const collisionId = await seedEmbedded(presenter, 'user prefers postgres')
    const headId = await seedEmbedded(presenter, 'team uses mysql')
    repo.markSuperseded(collisionId, headId)

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I hate redis now',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    // The superseded collision row is revived as current truth: its former head retires into it and
    // the SUPERSEDE target folds in too.
    expect(repo.getById(collisionId)?.superseded_by).toBeNull()
    expect(repo.getById(headId)?.superseded_by).toBe(collisionId)
    expect(repo.getById(targetId)?.superseded_by).toBe(collisionId)
    await presenter.processPendingEmbeddings('a')
    const recalled = await presenter.recall('a', 'postgres')
    expect(recalled.some((m) => m.id === collisionId)).toBe(true)
    expect(recalled.some((m) => m.id === targetId || m.id === headId)).toBe(false)
  })

  it('after an UPDATE, re-mentioning the new wording short-circuits via the synced key (AC-2.1)', async () => {
    let extractN = 0
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('JSON array')) {
        extractN += 1
        const content = extractN === 1 ? 'user uses macos' : 'user uses macos 15'
        return `[{"kind":"semantic","content":"${content}","importance":0.8}]`
      }
      if (prompt.includes('Choose exactly ONE decision')) {
        return '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user uses macos 15"}'
      }
      return ''
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    await seedEmbedded(presenter, 'user uses macos sonoma')

    const span = (text: string) => ({
      agentId: 'a',
      spanText: text,
      model: { providerId: 'main', modelId: 'main' }
    })
    await presenter.extractAndStore(span('User: macos 15'))
    expect(repo.countByAgent('a')).toBe(1)
    const row = repo.listByAgent('a')[0]
    expect(row.content).toBe('user uses macos 15')
    expect(row.provenance_key).toBe(buildMemoryProvenanceKey('a', 'semantic', 'user uses macos 15'))

    const decisionsAfterFirst = decisionCalls(generateText)
    await presenter.extractAndStore(span('User: still macos 15'))
    expect(repo.countByAgent('a')).toBe(1)
    expect(decisionCalls(generateText)).toBe(decisionsAfterFirst)
  })

  it('consolidation merge syncs the survivor provenance key to the merged content (AC-2.2)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers redis"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const oldId = await seedEmbedded(presenter, 'user likes redis a')
    const newId = await seedEmbedded(presenter, 'user likes redis b')
    repo.rows.get(oldId)!.created_at = now - 2000
    repo.rows.get(newId)!.created_at = now - 1000

    await presenter.runConsolidationPass('a', now)
    const survivor = repo.getById(newId)!
    expect(survivor.content).toBe('user prefers redis')
    expect(survivor.provenance_key).toBe(
      buildMemoryProvenanceKey('a', survivor.kind, 'user prefers redis')
    )
  })

  it('an UPDATE whose merged content collides with an active row folds the target into the owner (AC-2.3)', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user enjoys redis","importance":0.8}]',
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers vue"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const ownerId = await seedEmbedded(presenter, 'user prefers vue')
    const targetId = await seedEmbedded(presenter, 'user likes redis')

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I enjoy redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    // The target folds into the active key owner instead of orphaning the merged wording.
    expect(repo.getById(targetId)?.superseded_by).toBe(ownerId)
    expect(repo.getById(ownerId)?.superseded_by).toBeNull()
    expect(repo.getById(ownerId)?.content).toBe('user prefers vue')
    // Exactly one active row owns the merged content.
    expect(repo.listByAgent('a')).toHaveLength(1)
    expect(repo.listByAgent('a')[0].id).toBe(ownerId)
  })

  it('an UPDATE whose merged content collides with an archived row revives the owner and folds in (AC-2.4)', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user enjoys redis","importance":0.8}]',
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers vue"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const ownerId = await seedEmbedded(presenter, 'user prefers vue')
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    repo.archive(ownerId, 1)

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I enjoy redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    if (!result.ok) throw new Error('expected ok')
    // The archived owner is revived and becomes the survivor; the target folds into it.
    expect(repo.getById(ownerId)?.status).not.toBe('archived')
    expect(repo.getById(targetId)?.superseded_by).toBe(ownerId)
    expect(repo.listByAgent('a')).toHaveLength(1)
    expect(repo.listByAgent('a')[0].id).toBe(ownerId)
  })

  it('rolls back an archived provenance revive when the fold transaction fails', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user enjoys redis","importance":0.8}]',
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers vue"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const ownerId = await seedEmbedded(presenter, 'user prefers vue')
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    repo.archive(ownerId, 1)
    const markSuperseded = vi.spyOn(repo, 'markSupersededIfRevision')
    markSuperseded.mockImplementationOnce(() => {
      throw new Error('fold failed')
    })

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I enjoy redis',
      model: { providerId: 'main', modelId: 'main' }
    })

    expect(result.ok).toBe(false)
    expect(repo.getById(ownerId)?.status).toBe('archived')
    expect(repo.getById(targetId)?.superseded_by).toBeNull()
  })

  it('an UPDATE whose merged content collides with a superseded row revives the owner', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user enjoys redis","importance":0.8}]',
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers vue"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    const ownerId = await seedEmbedded(presenter, 'user prefers vue')
    const headId = await seedEmbedded(presenter, 'user prefers react')
    repo.markSuperseded(ownerId, headId)

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I enjoy redis',
      model: { providerId: 'main', modelId: 'main' }
    })

    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(0)
    expect(repo.getById(ownerId)).toMatchObject({
      status: 'pending_embedding',
      superseded_by: null
    })
    expect(repo.getById(headId)?.superseded_by).toBe(ownerId)
    expect(repo.getById(targetId)?.superseded_by).toBe(ownerId)
  })

  it('an UPDATE collision with user-forgotten provenance is a true noop', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user enjoys redis","importance":0.8}]',
      decision: '{"decision":"UPDATE","targetIndex":0,"mergedContent":"user prefers vue"}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const ownerId = await seedEmbedded(presenter, 'user prefers vue')
    const targetId = await seedEmbedded(presenter, 'user likes redis')
    expect(await presenter.archiveUserMemory('a', ownerId)).toBe(true)
    const targetBefore = repo.getById(targetId)!
    const beforeSnapshot = {
      content: targetBefore.content,
      provenanceKey: targetBefore.provenance_key,
      confidence: targetBefore.confidence
    }

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I enjoy redis',
      model: { providerId: 'main', modelId: 'main' }
    })

    if (!result.ok) throw new Error('expected ok')
    const targetAfter = repo.getById(targetId)!
    expect(result.createdIds).toHaveLength(0)
    expect(repo.getById(ownerId)?.status).toBe('archived')
    expect(targetAfter.content).toBe(beforeSnapshot.content)
    expect(targetAfter.provenance_key).toBe(beforeSnapshot.provenanceKey)
    expect(targetAfter.status).toBe('embedded')
    expect(targetAfter.confidence).toBe(beforeSnapshot.confidence)
    expect(targetAfter.superseded_by).toBeNull()
  })

  it('restore audit offsets a prior forget so a decay-archived memory can be learned again', async () => {
    vi.useFakeTimers()
    try {
      const generateText = routedLLM({
        extraction: '[{"kind":"semantic","content":"user likes redis","importance":0.8}]'
      })
      const { presenter, repo, auditRepo } = makeLLMPresenter(generateText)
      vi.setSystemTime(1000)
      const id = await seedEmbedded(presenter, 'user likes redis')
      vi.setSystemTime(2000)
      expect(await presenter.forgetMemory('a', id)).toBe(true)
      vi.setSystemTime(3000)
      expect(presenter.restoreMemory('a', id)).toBe(true)
      expect(auditRepo.hasForgetEvent('a', id)).toBe(false)
      vi.setSystemTime(4000)
      repo.archive(id, Date.now())

      vi.setSystemTime(5000)
      const result = await presenter.extractAndStore({
        agentId: 'a',
        spanText: 'User: I like redis',
        model: { providerId: 'main', modelId: 'main' }
      })

      if (!result.ok) throw new Error('expected ok')
      expect(result.createdIds).toHaveLength(0)
      expect(repo.getById(id)?.status).toBe('pending_embedding')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a forget after restore remains the latest provenance tombstone', async () => {
    vi.useFakeTimers()
    try {
      const generateText = routedLLM({
        extraction: '[{"kind":"semantic","content":"user likes redis","importance":0.8}]'
      })
      const { presenter, repo, auditRepo } = makeLLMPresenter(generateText)
      vi.setSystemTime(1000)
      const id = await seedEmbedded(presenter, 'user likes redis')
      vi.setSystemTime(2000)
      expect(await presenter.forgetMemory('a', id)).toBe(true)
      vi.setSystemTime(3000)
      expect(presenter.restoreMemory('a', id)).toBe(true)
      vi.setSystemTime(4000)
      repo.archive(id, Date.now())
      vi.setSystemTime(5000)
      expect(await presenter.forgetMemory('a', id)).toBe(true)
      expect(auditRepo.hasForgetEvent('a', id)).toBe(true)

      vi.setSystemTime(6000)
      const result = await presenter.extractAndStore({
        agentId: 'a',
        spanText: 'User: I like redis',
        model: { providerId: 'main', modelId: 'main' }
      })

      if (!result.ok) throw new Error('expected ok')
      expect(result.createdIds).toHaveLength(0)
      expect(repo.getById(id)?.status).toBe('archived')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a consolidation pass interrupted by dispose writes nothing to the repository (AC-3.1)', async () => {
    let resolveLLM = (): void => {}
    const llmGate = new Promise<void>((resolve) => {
      resolveLLM = resolve
    })
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('Choose exactly ONE decision')) {
        await llmGate
        return '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"user prefers redis"}'
      }
      return ''
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const now = 1_000 * DAY
    const oldId = await seedEmbedded(presenter, 'user likes redis a')
    const newId = await seedEmbedded(presenter, 'user likes redis b')
    repo.rows.get(oldId)!.created_at = now - 2000
    repo.rows.get(newId)!.created_at = now - 1000
    const markSpy = vi.spyOn(repo, 'markSuperseded')

    const pass = presenter.runConsolidationPass('a', now)
    await Promise.resolve()
    await presenter.dispose()
    resolveLLM()
    await pass

    expect(markSpy).not.toHaveBeenCalled()
    expect(repo.getById(oldId)?.superseded_by).toBeNull()
  })

  it('dispose waits for an in-flight timer-fired pass before returning (AC-3.2)', async () => {
    vi.useFakeTimers()
    try {
      const generateText = routedLLM({
        extraction: '[{"kind":"semantic","content":"user likes redis","importance":0.8}]',
        decision: '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
      })
      const { presenter } = makeLLMPresenter(generateText)
      let resolvePass = (): void => {}
      const passGate = new Promise<void>((resolve) => {
        resolvePass = resolve
      })
      vi.spyOn(presenter, 'runConsolidationPass').mockReturnValue(passGate)

      await presenter.extractAndStore({
        agentId: 'a',
        spanText: 'User: I like redis',
        model: { providerId: 'main', modelId: 'main' }
      })
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      let disposed = false
      const disposePromise = presenter.dispose().then(() => {
        disposed = true
      })
      await Promise.resolve()
      expect(disposed).toBe(false)

      resolvePass()
      await disposePromise
      expect(disposed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('recall after dispose never starts a backfill, so no row is written (AC-3.3)', async () => {
    const repo = new FakeRepository()
    let config: DeepChatAgentConfig = { memoryEnabled: true }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(repo.listByAgent('a')[0]?.status).toBe('fts_only')

    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm' } }
    const spy = vi.spyOn(presenter, 'backfillEmbeddings')
    await presenter.dispose()
    await presenter.recall('a', 'redis')

    expect(spy).not.toHaveBeenCalled()
    expect(repo.listByAgent('a')[0]?.status).toBe('fts_only')
  })

  it('dispose aborts an in-flight backfill and ignores its late result (AC-3.4)', async () => {
    const repo = new FakeRepository()
    let resolveEmb: () => void = () => {}
    let config: DeepChatAgentConfig = { memoryEnabled: true }
    const getEmbeddings = vi.fn(
      () =>
        new Promise<number[][]>((resolve) => {
          resolveEmb = () => resolve([textToVector('redis')])
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(repo.listByAgent('a')[0]?.status).toBe('fts_only')

    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm' } }
    const backfill = presenter.backfillEmbeddings('a')
    await new Promise((r) => setTimeout(r, 0)) // park inside getEmbeddings

    let disposed = false
    const disposePromise = presenter.dispose().then(() => {
      disposed = true
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(disposed).toBe(true)

    resolveEmb()
    await Promise.all([backfill, disposePromise])
    expect(disposed).toBe(true)
    expect(repo.listByAgent('a')[0]?.status).toBe('pending_embedding')
  })

  it('a recall whose embedding await spans dispose records no access and reopens no store (AC-3.5)', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    let blockRecall = false
    let resolveEmb: () => void = () => {}
    const getEmbeddings = vi.fn((_p: string, _m: string, texts: string[]) => {
      if (!blockRecall) return Promise.resolve(texts.map((t) => textToVector(t)))
      return new Promise<number[][]>((resolve) => {
        resolveEmb = () => resolve(texts.map((t) => textToVector(t)))
      })
    })
    const createVectorStore = vi.fn(async () => store)
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a') // opens + caches the store once
    expect(createVectorStore).toHaveBeenCalledTimes(1)

    // A recall starts and parks inside getEmbeddings.
    blockRecall = true
    const recordSpy = vi.spyOn(repo, 'recordAccessBatch')
    const recall = presenter.recall('a', 'redis')
    await new Promise((r) => setTimeout(r, 0))

    // Teardown happens while the recall is suspended.
    await presenter.dispose()

    // The embedding resolves only now; the recall must bail before opening a store or recording access.
    resolveEmb()
    const results = await recall
    expect(results).toEqual([])
    expect(recordSpy).not.toHaveBeenCalled()
    expect(createVectorStore).toHaveBeenCalledTimes(1) // dispose closed it; no reopen after teardown
  })

  it('a no-op LLM maintenance pass persists the cooldown in audit only (AC-6.1)', async () => {
    const repo = new FakeRepository()
    const auditRepo = new FakeAuditRepository()
    const store = new FakeVectorStore()
    const now = 1_000 * DAY
    const make = (gen: ReturnType<typeof vi.fn>) =>
      new MemoryPresenter({
        repository: repo,
        auditRepository: auditRepo,
        resolveAgentConfig: () => embeddingConfig,
        getEmbeddings: async (_p, _m, texts) => texts.map((t) => textToVector(t)),
        generateText: gen,
        createVectorStore: async () => store,
        resetVectorStore: async () => undefined
      })

    // A pure no-op pass: a single isolated, recent row — nothing to merge, nothing to archive.
    const first = make(routedLLM({}))
    const [solo] = first.writeMemoriesSync([{ kind: 'semantic', content: 'user likes redis' }], {
      agentId: 'a'
    })
    await first.processPendingEmbeddings('a')
    repo.rows.get(solo)!.created_at = now
    expect(repo.getLastConsolidatedAt('a')).toBeNull()

    await first.runConsolidationPass('a', now)
    expect(repo.getLastConsolidatedAt('a')).toBeNull()
    expect(auditRepo.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBe(now)

    // Restart: a fresh presenter has an empty in-memory cooldown map and must read the audit anchor.
    first.writeMemoriesSync([{ kind: 'semantic', content: 'user really likes redis' }], {
      agentId: 'a'
    })
    await first.processPendingEmbeddings('a')

    const gen2 = routedLLM({
      decision: '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"merged"}'
    })
    const second = make(gen2)
    await second.runConsolidationPass('a', now + 60 * 60 * 1000) // +1h, within the 6h cooldown
    expect(decisionCalls(gen2)).toBe(0) // cooldown short-circuited before any decision call
  })

  it('an extraction whose decision await spans dispose writes nothing (AC-3.6)', async () => {
    let resolveDecision = (): void => {}
    const decisionGate = new Promise<void>((resolve) => {
      resolveDecision = resolve
    })
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('JSON array')) {
        return '[{"kind":"semantic","content":"user likes redis","importance":0.8}]'
      }
      if (prompt.includes('Choose exactly ONE decision')) {
        await decisionGate
        return '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
      }
      return ''
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    // A neighbor so decideWrite reaches the decision call rather than the no-neighbor insert.
    await seedEmbedded(presenter, 'user enjoys redis')
    const insertSpy = vi.spyOn(repo, 'insert')

    const extraction = presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    // Drain microtasks so the extraction parks on the gated decision await before teardown.
    await new Promise((r) => setTimeout(r, 0))
    await presenter.dispose()
    resolveDecision()
    await extraction

    // decideWrite bailed after the decision await: no new row, no markSuperseded.
    expect(insertSpy).not.toHaveBeenCalled()
    expect(repo.countByAgent('a')).toBe(1) // only the seeded neighbor
  })

  it('write methods are no-ops after dispose (AC-3.7)', async () => {
    const { presenter, repo } = makeLLMPresenter(routedLLM({}))
    const id = await seedEmbedded(presenter, 'user likes redis')
    await presenter.dispose()
    const insertSpy = vi.spyOn(repo, 'insert')
    const deleteSpy = vi.spyOn(repo, 'delete')

    expect(presenter.evolvePersona('a', 'new persona')).toBeNull()
    expect(
      await presenter.rememberMemory({ kind: 'semantic', content: 'x' }, { agentId: 'a' })
    ).toEqual({ action: 'noop', reason: 'disposed' })
    expect(await presenter.deleteMemory('a', id)).toBe(false)
    expect(await presenter.clearMemories('a')).toBe(0)
    expect(await presenter.rollbackPersona('a', id)).toBe(false)
    expect(presenter.restoreMemory('a', id)).toBe(false)

    expect(insertSpy).not.toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(repo.countByAgent('a')).toBe(1)
  })

  it('a recall whose vector-store open spans dispose reads nothing and leaks no store (AC-3.8)', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    let blockCreate = false
    let resolveCreate: () => void = () => {}
    const createVectorStore = vi.fn(() => {
      if (!blockCreate) return Promise.resolve(store)
      return new Promise<IMemoryVectorStore>((resolve) => {
        resolveCreate = () => resolve(store)
      })
    })
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((t) => textToVector(t)),
      getDimensions: embeddingDimensions,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    // An embedded row that matches the current fingerprint so recall reaches getVectorStore (not the
    // stale-reindex branch). No store is opened during setup, so the recall is the first open.
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })

    blockCreate = true
    const getByIdSpy = vi.spyOn(repo, 'getById')
    const recordSpy = vi.spyOn(repo, 'recordAccessBatch')
    const backfillSpy = vi.spyOn(presenter, 'backfillEmbeddings')
    const reindexSpy = vi.spyOn(presenter, 'reindexEmbeddings')
    const closeSpy = vi.spyOn(store, 'close')
    const recall = presenter.recall('a', 'redis')
    await new Promise((r) => setTimeout(r, 0)) // background warm is parked inside createVectorStore
    const results = await recall
    expect(results.some((item) => item.id === 'm1')).toBe(true)
    expect(getByIdSpy).not.toHaveBeenCalled()
    expect(recordSpy).toHaveBeenCalledWith(['m1'], expect.any(Number))

    let disposed = false
    const disposePromise = presenter.dispose().then(() => {
      disposed = true
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(disposed).toBe(false) // dispose awaits the in-flight open lock

    resolveCreate()
    await disposePromise
    expect(disposed).toBe(true)
    expect(backfillSpy).not.toHaveBeenCalled()
    expect(reindexSpy).not.toHaveBeenCalled()
    expect(closeSpy).toHaveBeenCalledTimes(1) // the background warm store is closed, not leaked
  })

  it('a recall whose vector query spans dispose reads no rows and records no access (AC-3.9)', async () => {
    const repo = new FakeRepository()
    let blockQuery = false
    let resolveQuery: () => void = () => {}
    const store: IMemoryVectorStore = {
      upsert: async () => {},
      query: vi.fn(() => {
        if (!blockQuery) return Promise.resolve([])
        return new Promise<MemoryVectorMatch[]>((resolve) => {
          resolveQuery = () => resolve([{ memoryId: 'm1', distance: 0.01 }])
        })
      }),
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => ['m1'],
      close: async () => {},
      isUsable: () => true
    }
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((t) => textToVector(t)),
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })

    await presenter.recall('a', 'redis')
    const internals = memoryRuntimeForTests(presenter)
    await waitForMemoryCondition(
      () => internals.vectorStoreReady.has('a'),
      'vector store did not become ready'
    )

    blockQuery = true
    const getByIdSpy = vi.spyOn(repo, 'getById')
    const recordSpy = vi.spyOn(repo, 'recordAccessBatch')
    const backfillSpy = vi.spyOn(presenter, 'backfillEmbeddings')
    const recall = presenter.recall('a', 'redis')
    await new Promise((r) => setTimeout(r, 0)) // park inside store.query

    let disposeSettled = false
    const dispose = presenter.dispose().then(() => {
      disposeSettled = true
    })
    await Promise.resolve()
    expect(disposeSettled).toBe(false)
    resolveQuery()
    const [results] = await Promise.all([recall, dispose.then(() => [])])
    expect(results).toEqual([])
    expect(getByIdSpy).not.toHaveBeenCalled() // disposed re-check after query skips the match loop
    expect(recordSpy).not.toHaveBeenCalled()
    expect(backfillSpy).not.toHaveBeenCalled()
  })

  it('bounds dispose at 5s without closing a store that still has an active native lease', async () => {
    const repo = new FakeRepository()
    let blockQuery = false
    const close = vi.fn(async () => undefined)
    const store: IMemoryVectorStore = {
      upsert: async () => {},
      query: () => (blockQuery ? new Promise(() => undefined) : Promise.resolve([])),
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => ['m1'],
      close,
      isUsable: () => true
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    await presenter.recall('a', 'redis')
    const internals = memoryRuntimeForTests(presenter)
    await waitForMemoryCondition(
      () => internals.vectorStoreReady.has('a'),
      'vector store did not become ready'
    )

    blockQuery = true
    void presenter.recall('a', 'redis')
    await new Promise((resolve) => setTimeout(resolve, 0))
    vi.useFakeTimers()
    try {
      const dispose = presenter.dispose()
      const assertion = expect(dispose).resolves.toBeUndefined()
      await vi.advanceTimersByTimeAsync(5_000)
      await assertion
      expect(close).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes idle agent stores while another agent has a stuck native lease', async () => {
    const repo = new FakeRepository()
    let blockAgentA = false
    const closeA = vi.fn(async () => undefined)
    const storeB = new FakeVectorStore()
    storeB.vectors.set('m-b', textToVector('redis fact'))
    const closeB = vi.spyOn(storeB, 'close')
    const storeA: IMemoryVectorStore = {
      upsert: async () => {},
      query: () => (blockAgentA ? new Promise(() => undefined) : Promise.resolve([])),
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => ['m-a'],
      close: closeA,
      isUsable: () => true
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore: async (agentId) => (agentId === 'a' ? storeA : storeB),
      resetVectorStore: async () => undefined
    })
    for (const agentId of ['a', 'b']) {
      repo.insert({ id: `m-${agentId}`, agentId, kind: 'semantic', content: 'redis fact' })
      repo.updateStatus(`m-${agentId}`, 'embedded', {
        embeddingId: `m-${agentId}`,
        embeddingDim: 4,
        embeddingModel: 'p:m'
      })
      await presenter.recall(agentId, 'redis')
    }
    const internals = memoryRuntimeForTests(presenter)
    await waitForMemoryCondition(
      () => internals.vectorStoreReady.has('a') && internals.vectorStoreReady.has('b')
    )

    blockAgentA = true
    void presenter.recall('a', 'redis')
    await new Promise((resolve) => setTimeout(resolve, 0))
    vi.useFakeTimers()
    try {
      const dispose = presenter.dispose()
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(dispose).resolves.toBeUndefined()
      expect(closeB).toHaveBeenCalledTimes(1)
      expect(closeA).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a delete whose store await spans dispose skips the vector op (AC-3.10)', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    store.vectors.set('m1', textToVector('redis fact')) // so warm-up recall opens + caches the store
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((t) => textToVector(t)),
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })

    const warm = await presenter.recall('a', 'redis')
    expect(warm.length).toBeGreaterThan(0) // the per-agent store is now cached

    const deleteSpy = vi.spyOn(store, 'deleteByMemoryIds')
    // deleteMemory removes the SQLite row synchronously, then awaits the cached store. dispose() flips
    // `disposed` synchronously before that await resumes, so the vector op must be skipped.
    const del = presenter.deleteMemory('a', 'm1')
    const disp = presenter.dispose()
    const [ok] = await Promise.all([del, disp])

    expect(ok).toBe(true) // the authoritative SQLite delete still happened
    expect(repo.getById('m1')).toBeUndefined()
    expect(deleteSpy).not.toHaveBeenCalled() // no write against the store dispose just closed
  })

  it('deletes vectors from the row snapshot embedding store even after config changes', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => store)
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({
        memoryEnabled: true,
        memoryEmbedding: { providerId: 'p', modelId: 'current' }
      }),
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:legacy'
    })
    store.vectors.set('m1', textToVector('redis fact'))
    const deleteSpy = vi.spyOn(store, 'deleteByMemoryIds')

    expect(await presenter.deleteMemory('a', 'm1')).toBe(true)

    expect(createVectorStore).toHaveBeenCalledWith('a', { providerId: 'p', modelId: 'legacy' }, 4)
    expect(deleteSpy).toHaveBeenCalledWith(['m1'])
    expect(repo.getById('m1')).toBeUndefined()
  })

  it('keeps the row snapshot embedding model when delete must infer the dimension', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => store)
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({
        memoryEnabled: true,
        memoryEmbedding: { providerId: 'p', modelId: 'current' }
      }),
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'legacy-ref', agentId: 'a', kind: 'semantic', content: 'legacy ref' })
    repo.updateStatus('legacy-ref', 'embedded', {
      embeddingId: 'legacy-ref',
      embeddingDim: 4,
      embeddingModel: 'p:legacy'
    })
    repo.insert({ id: 'current-ref', agentId: 'a', kind: 'semantic', content: 'current ref' })
    repo.updateStatus('current-ref', 'embedded', {
      embeddingId: 'current-ref',
      embeddingDim: 6,
      embeddingModel: 'p:current'
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: null,
      embeddingModel: 'p:legacy'
    })
    store.vectors.set('m1', textToVector('redis fact'))
    const deleteSpy = vi.spyOn(store, 'deleteByMemoryIds')

    expect(await presenter.deleteMemory('a', 'm1')).toBe(true)

    expect(createVectorStore).toHaveBeenCalledWith('a', { providerId: 'p', modelId: 'legacy' }, 4)
    expect(deleteSpy).toHaveBeenCalledWith(['m1'])
  })

  it('does not fail the SQLite delete when opening the vector store fails', async () => {
    const repo = new FakeRepository()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => {
        throw new Error('open failed')
      },
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })

    await expect(presenter.deleteMemory('a', 'm1')).resolves.toBe(true)
    expect(repo.getById('m1')).toBeUndefined()
  })

  it('schedules a forced reindex when delete finds an unusable vector store', async () => {
    const repo = new FakeRepository()
    const unusableStore: IMemoryVectorStore = {
      upsert: async () => {},
      query: async () => [],
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => [],
      close: async () => {},
      isUsable: () => false
    }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => unusableStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    const reindexSpy = vi.spyOn(presenter, 'reindexEmbeddings').mockResolvedValue()

    expect(await presenter.deleteMemory('a', 'm1')).toBe(true)

    expect(reindexSpy).toHaveBeenCalledWith('a', true)
    expect(repo.getById('m1')).toBeUndefined()
  })

  it('dispose waits for an in-flight vector delete before closing the store (AC-3.11)', async () => {
    const { presenter, repo, store } = makeLLMPresenter(routedLLM({}))
    const id = await seedEmbedded(presenter, 'user likes redis')

    let resolveDelete: () => void = () => {}
    const deleteGate = new Promise<void>((resolve) => {
      resolveDelete = resolve
    })
    const deleteSpy = vi.spyOn(store, 'deleteByMemoryIds').mockImplementation(async () => {
      await deleteGate
    })
    const closeSpy = vi.spyOn(store, 'close')

    const del = presenter.deleteMemory('a', id)
    await new Promise((r) => setTimeout(r, 0)) // park inside deleteByMemoryIds (disposed still false)
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(repo.getById(id)).toBeUndefined() // SQLite row already gone

    let disposed = false
    const disp = presenter.dispose().then(() => {
      disposed = true
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(disposed).toBe(false) // dispose blocks on the in-flight delete via vectorStoreLocks
    expect(closeSpy).not.toHaveBeenCalled() // the store is not closed mid-DELETE

    resolveDelete()
    const [ok] = await Promise.all([del, disp])
    expect(ok).toBe(true)
    expect(disposed).toBe(true)
    expect(closeSpy).toHaveBeenCalledTimes(1) // closed only after the delete resolved
  })

  it('an extraction whose triage await spans dispose fires no extraction call (AC-3.12)', async () => {
    let resolveTriage: () => void = () => {}
    const triageGate = new Promise<void>((resolve) => {
      resolveTriage = resolve
    })
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) {
        await triageGate
        return 'KEEP'
      }
      if (prompt.includes('JSON array')) {
        return '[{"kind":"semantic","content":"user likes redis","importance":0.8}]'
      }
      return ''
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const insertSpy = vi.spyOn(repo, 'insert')

    const extraction = presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis',
      model: { providerId: 'main', modelId: 'main' }
    })
    await new Promise((r) => setTimeout(r, 0)) // park on the gated triage await
    await presenter.dispose()
    resolveTriage()
    const result = await extraction

    expect(result).toEqual({ ok: false })
    // Only the triage call ran; the extraction LLM is never fired after teardown begins.
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(generateText.mock.calls[0][2]).toContain('KEEP or SKIP')
    expect(insertSpy).not.toHaveBeenCalled()
  })
})
