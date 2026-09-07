import { describe, expect, it, vi } from 'vitest'

import {
  buildLegacyMemoryProvenanceKey,
  buildMemoryProvenanceKey,
  buildScopedMemoryProvenanceKey
} from '@/memory/core/scoring'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import {
  FakeVectorStore,
  createFakeRepository,
  enabledConfig,
  makePresenter,
  textToVector
} from './support/memoryFakes'
import { makeLLMPresenter, routedLLM, seedEmbedded } from './serviceTestSupport'

import { MemoryService, embeddingDimensions, waitForMemoryCondition } from './serviceTestSupport'

describe('MemoryService write + two-phase embedding', () => {
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

  it('deduplicates only within one exact applicability scope', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const content = 'user likes redis'
    const [globalId] = presenter.writeMemoriesSync([{ kind: 'semantic', content }], {
      agentId: 'a'
    })
    const [sessionOneId] = presenter.writeMemoriesSync([{ kind: 'semantic', content }], {
      agentId: 'a',
      scope: { type: 'session', id: 'session-1' }
    })
    const [sessionTwoId] = presenter.writeMemoriesSync([{ kind: 'semantic', content }], {
      agentId: 'a',
      scope: { type: 'session', id: 'session-2' }
    })

    expect(
      presenter.writeMemoriesSync([{ kind: 'semantic', content: ' user   likes redis ' }], {
        agentId: 'a',
        scope: { type: 'session', id: 'session-1' }
      })
    ).toEqual([])
    expect(repo.countByAgent('a')).toBe(3)
    expect(repo.getById(globalId)).toMatchObject({
      scope_type: 'agent',
      scope_id: null,
      provenance_key: buildMemoryProvenanceKey('a', 'semantic', content)
    })
    expect(repo.getById(sessionOneId)).toMatchObject({
      scope_type: 'session',
      scope_id: 'session-1',
      provenance_key: buildScopedMemoryProvenanceKey('a', 'semantic', content, {
        type: 'session',
        id: 'session-1'
      })
    })
    expect(repo.getById(sessionTwoId)?.provenance_key).not.toBe(
      repo.getById(sessionOneId)?.provenance_key
    )
  })

  it('never offers a different scope as a correction target', async () => {
    const repo = createFakeRepository()
    const generateText = vi.fn(async () =>
      JSON.stringify({ decision: 'UPDATE', targetIndex: 0, mergedContent: 'updated global fact' })
    )
    const presenter = new MemoryService({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true, memoryEmbedding: null }),
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => new FakeVectorStore()
    })
    repo.insert({
      id: 'global',
      agentId: 'a',
      kind: 'semantic',
      content: 'user prefers redis globally'
    })

    const result = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user prefers redis for this session' },
      { agentId: 'a', scope: { type: 'session', id: 'session-1' } },
      { providerId: 'p', modelId: 'm' }
    )

    expect(result.action).toBe('created')
    expect(generateText).not.toHaveBeenCalled()
    expect(repo.getById('global')?.content).toBe('user prefers redis globally')
    expect(repo.listByAgent('a')).toContainEqual(
      expect.objectContaining({ scope_type: 'session', scope_id: 'session-1' })
    )
  })

  it('enriches a migrated atemporal duplicate without replacing an established interval', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const content = 'user works on the memory project'
    const initial = presenter.writeMemoriesSync([{ kind: 'semantic', content }], { agentId: 'a' })
    const temporal = {
      temporalKind: 'state' as const,
      validFrom: 100,
      validUntil: 200,
      temporalConfidence: 0.8,
      temporalPrecision: 'exact' as const,
      temporalTimeZone: 'UTC'
    }

    expect(
      presenter.writeMemoriesSync([{ kind: 'semantic', content, temporal }], { agentId: 'a' })
    ).toEqual([])
    expect(repo.getById(initial[0])).toMatchObject({
      temporal_kind: 'state',
      valid_from: 100,
      valid_until: 200,
      temporal_confidence: 0.8,
      confidence: null,
      decision_revision: 2
    })

    expect(
      presenter.writeMemoriesSync(
        [
          {
            kind: 'semantic',
            content,
            temporal: { ...temporal, validFrom: 120, temporalConfidence: 1 }
          }
        ],
        { agentId: 'a' }
      )
    ).toEqual([])
    expect(repo.getById(initial[0])).toMatchObject({
      valid_from: 100,
      temporal_confidence: 0.8,
      decision_revision: 2
    })
  })

  it('retains temporal metadata from duplicate extraction candidates', async () => {
    const content = 'The release is planned for tomorrow.'
    const { presenter, repo } = makeLLMPresenter(
      routedLLM({
        extraction: JSON.stringify({
          memories: [
            { content, importance: 0.8 },
            {
              content,
              importance: 0.8,
              temporal: {
                temporalKind: 'plan',
                validFrom: '2026-07-27T00:00:00Z',
                validUntil: '2026-07-28T00:00:00Z',
                temporalConfidence: 0.9,
                temporalPrecision: 'day',
                timeZone: 'UTC'
              }
            }
          ]
        })
      })
    )

    await expect(
      presenter.extractAndStore({
        agentId: 'a',
        spanText: 'User: the release is planned for tomorrow',
        model: { providerId: 'main', modelId: 'main' }
      })
    ).resolves.toMatchObject({ ok: true })
    expect(repo.listByAgent('a')).toEqual([
      expect.objectContaining({
        content,
        temporal_kind: 'plan',
        valid_from: Date.parse('2026-07-27T00:00:00Z'),
        valid_until: Date.parse('2026-07-28T00:00:00Z'),
        temporal_confidence: 0.9
      })
    ])
  })

  it('supplies temporal context to correction decisions', async () => {
    const now = Date.parse('2026-07-26T00:00:00Z')
    const repo = createFakeRepository()
    let decisionPrompt = ''
    const presenter = new MemoryService({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true, memoryEmbedding: null }),
      getEmbeddings: async () => [],
      generateText: async (_providerId, _modelId, prompt) => {
        decisionPrompt = prompt
        return '{"decision":"ADD","targetIndex":null}'
      },
      createVectorStore: async () => new FakeVectorStore(),
      clock: {
        now: () => now,
        timeZone: () => 'UTC'
      }
    })
    repo.insert({
      id: 'previous-location',
      agentId: 'a',
      kind: 'semantic',
      content: 'user works in paris',
      temporal: {
        temporalKind: 'state',
        validFrom: Date.parse('2025-01-01T00:00:00Z'),
        validUntil: Date.parse('2026-01-01T00:00:00Z'),
        temporalConfidence: 0.95,
        temporalPrecision: 'day',
        temporalTimeZone: 'UTC'
      }
    })

    await presenter.rememberMemory(
      {
        kind: 'semantic',
        content: 'user works in berlin',
        temporal: {
          temporalKind: 'state',
          validFrom: Date.parse('2026-07-01T00:00:00Z'),
          validUntil: null,
          temporalConfidence: 0.95,
          temporalPrecision: 'day',
          temporalTimeZone: 'UTC'
        }
      },
      { agentId: 'a' },
      { providerId: 'p', modelId: 'm' }
    )

    expect(decisionPrompt).toContain('user works in berlin [Temporal: current state')
    expect(decisionPrompt).toContain('user works in paris [Temporal: expired state')
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

  it('does not swallow a commit callback error that resembles a uniqueness race', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const content = 'User likes durable writes'
    repo.insert({
      id: 'legacy',
      agentId: 'a',
      kind: 'semantic',
      content,
      provenanceKey: buildLegacyMemoryProvenanceKey('a', 'semantic', content)
    })
    const commitError = Object.assign(new Error('journal uniqueness failure'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE'
    })

    await expect(
      presenter.rememberMemory({ kind: 'semantic', content }, { agentId: 'a' }, null, () => {
        throw commitError
      })
    ).rejects.toBe(commitError)

    expect(repo.getById('legacy')?.provenance_key).toBe(
      buildLegacyMemoryProvenanceKey('a', 'semantic', content)
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

describe('MemoryService change events (onMemoryChanged)', () => {
  function makeWithSpy(config: DeepChatAgentConfig = enabledConfig) {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const onMemoryChanged = vi.fn()
    const presenter = new MemoryService({
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

  it('commits once immediately before a direct memory mutation', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const order: string[] = []
    const originalInsert = repo.insertClaimUnlessTombstoned.bind(repo)
    vi.spyOn(repo, 'insertClaimUnlessTombstoned').mockImplementation((input) => {
      order.push('mutation')
      return originalInsert(input)
    })
    const beforeMutation = vi.fn(() => order.push('commit'))

    await expect(
      presenter.rememberMemory(
        { kind: 'semantic', content: 'user prefers durable journals' },
        { agentId: 'a' },
        null,
        beforeMutation
      )
    ).resolves.toMatchObject({ action: 'created' })

    expect(order).toEqual(['commit', 'mutation'])
    expect(beforeMutation).toHaveBeenCalledOnce()
  })

  it('does not commit duplicate or tombstoned memory no-ops', async () => {
    const { presenter } = makePresenter(enabledConfig)
    const content = 'user prefers explicit recovery'
    const created = await presenter.rememberMemory(
      { kind: 'semantic', content },
      { agentId: 'a' },
      null
    )
    if (created.action !== 'created') throw new Error('expected memory creation')

    const duplicateCommit = vi.fn()
    await expect(
      presenter.rememberMemory(
        { kind: 'semantic', content },
        { agentId: 'a' },
        null,
        duplicateCommit
      )
    ).resolves.toMatchObject({ action: 'noop', reason: 'duplicate' })
    expect(duplicateCommit).not.toHaveBeenCalled()

    await presenter.deleteMemory('a', created.id)
    const tombstoneCommit = vi.fn()
    await expect(
      presenter.rememberMemory(
        { kind: 'semantic', content },
        { agentId: 'a' },
        { providerId: 'p', modelId: 'm' },
        tombstoneCommit
      )
    ).resolves.toEqual({ action: 'noop', reason: 'forgotten' })
    expect(tombstoneCommit).not.toHaveBeenCalled()
  })

  it('fails closed when the memory commit boundary cannot persist', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const journalError = new Error('journal unavailable')

    await expect(
      presenter.rememberMemory(
        { kind: 'semantic', content: 'do not write this memory' },
        { agentId: 'a' },
        null,
        () => {
          throw journalError
        }
      )
    ).rejects.toBe(journalError)

    expect(repo.countByAgent('a')).toBe(0)
  })

  it('emits "extract" when extraction writes new memories', async () => {
    const repo = createFakeRepository()
    const store = new FakeVectorStore()
    const onMemoryChanged = vi.fn()
    const presenter = new MemoryService({
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
    if (!result.ok) throw new Error('expected extraction to succeed')
    expect(onMemoryChanged).toHaveBeenCalledWith(
      'a',
      'extract',
      expect.objectContaining({ sessionId: 'session-1', createdIds: result.createdIds })
    )
  })

  it('finalizes the first committed candidate when a later candidate fails and retries idempotently', async () => {
    const repo = createFakeRepository()
    const onMemoryChanged = vi.fn()
    const generateText = vi.fn(async (_providerId: string, _modelId: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      return JSON.stringify([
        { kind: 'semantic', content: 'first durable fact', importance: 0.9 },
        { kind: 'semantic', content: 'second durable fact', importance: 0.8 }
      ])
    })
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
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
    const presenter = new MemoryService({
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

describe('MemoryService async write guards', () => {
  it('invalidates an empty clear while extraction triage is awaiting the provider', async () => {
    const repo = createFakeRepository()
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
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
    const onMemoryChanged = vi.fn()
    let resolveExtraction!: (value: string) => void
    let markExtractionStarted!: () => void
    const extractionStarted = new Promise<void>((resolve) => {
      markExtractionStarted = resolve
    })
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
    const onMemoryChanged = vi.fn()
    let resolveDecision!: (value: string) => void
    let markDecisionStarted!: () => void
    const decisionStarted = new Promise<void>((resolve) => {
      markDecisionStarted = resolve
    })
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
    let config: DeepChatAgentConfig = enabledConfig
    let resolveDecision!: (value: string) => void
    let markDecisionStarted!: () => void
    const decisionStarted = new Promise<void>((resolve) => {
      markDecisionStarted = resolve
    })
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
    const generateText = vi.fn(async () => 'KEEP')
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
    let managed = true
    let releaseExtraction!: () => void
    let extractionStarted!: () => void
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve
    })
    const extractionStartedGate = new Promise<void>((resolve) => {
      extractionStarted = resolve
    })
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
    let managed = true
    let releaseReflection!: () => void
    let reflectionStarted!: () => void
    const reflectionGate = new Promise<void>((resolve) => {
      releaseReflection = resolve
    })
    const reflectionStartedGate = new Promise<void>((resolve) => {
      reflectionStarted = resolve
    })
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
    let releaseReflection!: (value: string) => void
    let reflectionStarted!: () => void
    const reflectionStartedGate = new Promise<void>((resolve) => {
      reflectionStarted = resolve
    })
    const presenter = new MemoryService({
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
    const repo = createFakeRepository()
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
    const presenter = new MemoryService({
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

describe('writeMemoriesSync insert error classification (C2, AC-2.2)', () => {
  it('swallows UNIQUE constraint races as dedupe', () => {
    const repo = createFakeRepository()
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
    const repo = createFakeRepository()
    vi.spyOn(repo, 'insert').mockImplementation(() => {
      throw Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' })
    })
    const { presenter } = makePresenter(enabledConfig, repo)

    expect(() =>
      presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    ).toThrow('disk I/O error')
  })

  it('extractAndStore degrades to ok:false on a real insert error (cursor must not advance)', async () => {
    const repo = createFakeRepository()
    vi.spyOn(repo, 'insert').mockImplementation(() => {
      throw Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' })
    })
    const presenter = new MemoryService({
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
