import { describe, expect, it, vi } from 'vitest'

import { buildMemoryProvenanceKey } from '@/memory/core/scoring'
import { type IMemoryVectorStore, type MemoryVectorMatch } from '@/memory/types'
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
  decisionCalls,
  embeddingConfig,
  makeLLMPresenter,
  routedLLM,
  seedEmbedded
} from './serviceTestSupport'

import {
  MemoryService,
  embeddingDimensions,
  memoryRuntimeForTests,
  waitForMemoryCondition
} from './serviceTestSupport'

describe('MemoryService lifecycle revival (SDD-8)', () => {
  it('re-mentioning an archived fact restores it instead of swallowing it (AC-1.1)', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user likes redis","importance":0.8}]'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    const id = await seedEmbedded(presenter, 'user likes redis')
    repo.seedArchived(id, 1)
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
    repo.seedSupersededBy(aId, bId)

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
    repo.seedSupersededBy(ownerId, headId)

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
    repo.seedSupersededBy(ownerId, headId)

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
    const repo = createFakeRepository()
    let headId = ''
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('JSON array')) {
        return '[{"kind":"semantic","content":"user likes redis","importance":0.8}]'
      }
      if (prompt.includes('Choose exactly ONE decision')) {
        if (headId) repo.seedArchived(headId, Date.now())
        return '{"decision":"CHALLENGE","targetIndex":0,"mergedContent":null}'
      }
      return ''
    })
    const { presenter } = makeLLMPresenter(generateText, embeddingConfig, repo)
    const ownerId = await seedEmbedded(presenter, 'user likes redis')
    headId = await seedEmbedded(presenter, 'user dislikes redis')
    repo.seedSupersededBy(ownerId, headId)

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
    repo.seedArchived(archivedId, 1)

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
    repo.seedSupersededBy(collisionId, headId)

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
    repo.seedArchived(ownerId, 1)

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
    repo.seedArchived(ownerId, 1)
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
    repo.seedSupersededBy(ownerId, headId)

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
      repo.seedArchived(id, Date.now())

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
      repo.seedArchived(id, Date.now())
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
    const markSpy = vi.spyOn(repo, 'seedSupersededBy')

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
    const repo = createFakeRepository()
    let config: DeepChatAgentConfig = { memoryEnabled: true }
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
    let resolveEmb: () => void = () => {}
    let config: DeepChatAgentConfig = { memoryEnabled: true }
    const getEmbeddings = vi.fn(
      () =>
        new Promise<number[][]>((resolve) => {
          resolveEmb = () => resolve([textToVector('redis')])
        })
    )
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
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
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
    const auditRepo = new FakeAuditRepository()
    const store = new FakeVectorStore()
    const now = 1_000 * DAY
    const make = (gen: ReturnType<typeof vi.fn>) =>
      new MemoryService({
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

  it('dispose detaches from a vector-store open without touching the late store (AC-3.8)', async () => {
    const repo = createFakeRepository()
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
    const presenter = new MemoryService({
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
    repo.seedLegacyStatus('m1', 'embedded', {
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
    vi.useFakeTimers()
    try {
      const disposePromise = presenter.dispose().then(() => {
        disposed = true
      })
      await vi.advanceTimersByTimeAsync(5_000)
      await disposePromise
      expect(disposed).toBe(true)
      expect(closeSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }

    resolveCreate()
    await new Promise((r) => setTimeout(r, 0))
    expect(backfillSpy).not.toHaveBeenCalled()
    expect(reindexSpy).not.toHaveBeenCalled()
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('a recall whose vector query spans dispose reads no rows and records no access (AC-3.9)', async () => {
    const repo = createFakeRepository()
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
    const presenter = new MemoryService({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((t) => textToVector(t)),
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.seedLegacyStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })

    await presenter.recall('a', 'redis')
    const internals = memoryRuntimeForTests(presenter)
    await waitForMemoryCondition(
      () => internals.isVectorReady('a'),
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
    const repo = createFakeRepository()
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
    const presenter = new MemoryService({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.seedLegacyStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    await presenter.recall('a', 'redis')
    const internals = memoryRuntimeForTests(presenter)
    await waitForMemoryCondition(
      () => internals.isVectorReady('a'),
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
    const repo = createFakeRepository()
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
    const presenter = new MemoryService({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      getDimensions: embeddingDimensions,
      createVectorStore: async (agentId) => (agentId === 'a' ? storeA : storeB),
      resetVectorStore: async () => undefined
    })
    for (const agentId of ['a', 'b']) {
      repo.insert({ id: `m-${agentId}`, agentId, kind: 'semantic', content: 'redis fact' })
      repo.seedLegacyStatus(`m-${agentId}`, 'embedded', {
        embeddingId: `m-${agentId}`,
        embeddingDim: 4,
        embeddingModel: 'p:m'
      })
      await presenter.recall(agentId, 'redis')
    }
    const internals = memoryRuntimeForTests(presenter)
    await waitForMemoryCondition(() => internals.isVectorReady('a') && internals.isVectorReady('b'))

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
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    store.vectors.set('m1', textToVector('redis fact')) // so warm-up recall opens + caches the store
    const config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const presenter = new MemoryService({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((t) => textToVector(t)),
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.seedLegacyStatus('m1', 'embedded', {
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
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => store)
    const presenter = new MemoryService({
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
    repo.seedLegacyStatus('m1', 'embedded', {
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
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => store)
    const presenter = new MemoryService({
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
    repo.seedLegacyStatus('legacy-ref', 'embedded', {
      embeddingId: 'legacy-ref',
      embeddingDim: 4,
      embeddingModel: 'p:legacy'
    })
    repo.insert({ id: 'current-ref', agentId: 'a', kind: 'semantic', content: 'current ref' })
    repo.seedLegacyStatus('current-ref', 'embedded', {
      embeddingId: 'current-ref',
      embeddingDim: 6,
      embeddingModel: 'p:current'
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.seedLegacyStatus('m1', 'embedded', {
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
    const repo = createFakeRepository()
    const presenter = new MemoryService({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => {
        throw new Error('open failed')
      },
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.seedLegacyStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })

    await expect(presenter.deleteMemory('a', 'm1')).resolves.toBe(true)
    expect(repo.getById('m1')).toBeUndefined()
  })

  it('schedules a forced reindex when delete finds an unusable vector store', async () => {
    const repo = createFakeRepository()
    const unusableStore: IMemoryVectorStore = {
      upsert: async () => {},
      query: async () => [],
      queryByMemoryId: async () => [],
      deleteByMemoryIds: async () => {},
      listMemoryIds: async () => [],
      close: async () => {},
      isUsable: () => false
    }
    const presenter = new MemoryService({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => unusableStore,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.seedLegacyStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })
    const reindexSpy = vi.spyOn(presenter, 'reindexEmbeddings').mockResolvedValue()

    expect(await presenter.deleteMemory('a', 'm1')).toBe(true)

    expect(reindexSpy).toHaveBeenCalledWith('a', true)
    expect(repo.getById('m1')).toBeUndefined()
  })

  it('dispose detaches from an in-flight vector delete without closing its store (AC-3.11)', async () => {
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
    let disp!: Promise<void>
    vi.useFakeTimers()
    try {
      disp = presenter.dispose().then(() => {
        disposed = true
      })
      await vi.advanceTimersByTimeAsync(5_000)
      await disp
      expect(disposed).toBe(true)
      expect(closeSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }

    resolveDelete()
    const [ok] = await Promise.all([del, disp])
    expect(ok).toBe(true)
    expect(closeSpy).not.toHaveBeenCalled()
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
