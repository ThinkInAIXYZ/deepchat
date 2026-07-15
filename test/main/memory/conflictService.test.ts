import { describe, expect, it, vi } from 'vitest'

import { buildMemoryProvenanceKey } from '@/memory/core/scoring'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import { createFakeRepository, FakeAuditRepository } from './support/memoryFakes'
import {
  DAY,
  decisionCalls,
  embeddingConfig,
  makeLLMPresenter,
  memoryRuntimeForTests,
  routedLLM,
  seedConflicted,
  seedEmbedded
} from './serviceTestSupport'

describe('MemoryService decision ring (T-A1..T-A5)', () => {
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
    const repo = createFakeRepository()
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

    repo.seedArchived(targetId)
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
    repo.seedConflictState('orphan-target', 'challenged')
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

  it('continues challenge resolution after a merged challenger hits provenance uniqueness', async () => {
    const mergedContent = 'occupied merged memory'
    const generateText = routedLLM({
      decision: [
        `{"decision":"UPDATE","targetIndex":0,"mergedContent":"${mergedContent}"}`,
        '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
      ]
    })
    const { presenter, repo, auditRepo } = makeLLMPresenter(generateText)
    const firstTargetId = await seedEmbedded(presenter, 'first target memory')
    const secondTargetId = await seedEmbedded(presenter, 'second target memory')
    seedConflicted(repo, 'c1', firstTargetId, 'first challenger memory')
    seedConflicted(repo, 'c2', secondTargetId, 'second challenger memory')
    repo.insert({
      id: 'provenance-owner',
      agentId: 'a',
      kind: 'semantic',
      content: mergedContent,
      provenanceKey: buildMemoryProvenanceKey('a', 'semantic', mergedContent)
    })
    const activateResolvedChallenger = repo.activateResolvedChallenger.bind(repo)
    vi.spyOn(repo, 'activateResolvedChallenger').mockImplementation((input) => {
      if (input.id === 'c1' && input.provenanceKey) {
        throw new Error('UNIQUE constraint failed: agent_memory.agent_id, provenance_key')
      }
      return activateResolvedChallenger(input)
    })

    const result = await memoryRuntimeForTests(
      presenter
    ).conflictService.runChallengeResolutionPass('a', {
      providerId: 'main',
      modelId: 'main'
    })

    expect(result).toEqual({ touched: true, calls: 2, failures: 0 })
    expect(repo.getById('c1')).toMatchObject({
      lifecycle_state: 'conflicted',
      conflict_with: firstTargetId,
      decision_revision: 1
    })
    expect(repo.getById(firstTargetId)?.conflict_state).toBe('challenged')
    expect(repo.getById('c2')).toMatchObject({
      lifecycle_state: 'archived',
      conflict_with: null,
      superseded_by: secondTargetId
    })
    expect(repo.getById(secondTargetId)?.conflict_state).toBeNull()
    expect(auditRepo.listByAgent('a', { eventType: 'memory/challenge_resolved' })).toHaveLength(1)
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
      if (input.lifecycleState === 'conflicted') throw new Error('UNIQUE constraint failed')
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
      if (input.lifecycleState === 'conflicted') repo.seedArchived(targetId, Date.now())
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
    const repo = createFakeRepository()
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
          repo.updateUserMetadataIfRevision({
            agentId: 'a',
            id: targetId,
            expectedRevision: repo.getById(targetId)!.decision_revision,
            importance: 0.7
          })
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
    const repo = createFakeRepository()
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
          repo.updateUserMetadataIfRevision({
            agentId: 'a',
            id: targetId,
            expectedRevision: repo.getById(targetId)!.decision_revision,
            importance: 0.7
          })
        }
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
    expect(presenter.getHealth('a').runtime.agent.extraction.casRetries).toBe(1)
  })

  it('returns concurrent-update after a second stale decision without mutating the target', async () => {
    const repo = createFakeRepository()
    let targetId = ''
    let decisionCallCount = 0
    const generateText = vi.fn(async (_providerId: string, _modelId: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      if (prompt.includes('JSON array')) {
        return '[{"kind":"semantic","content":"user changed redis preference","importance":0.8}]'
      }
      if (prompt.includes('Choose exactly ONE decision')) {
        decisionCallCount += 1
        repo.updateUserMetadataIfRevision({
          agentId: 'a',
          id: targetId,
          expectedRevision: repo.getById(targetId)!.decision_revision,
          importance: 0.7 + decisionCallCount * 0.01
        })
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
    const repo = createFakeRepository()
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
      repo.seedLegacyStatus(id, 'embedded', {
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
          const targetId = targetIds[candidateIndex]
          repo.updateUserMetadataIfRevision({
            agentId: 'a',
            id: targetId,
            expectedRevision: repo.getById(targetId)!.decision_revision,
            importance: 0.7
          })
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
    expect(presenter.getHealth('a').runtime.agent.extraction.casRetries).toBe(4)
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
