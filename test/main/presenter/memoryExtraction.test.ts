import { describe, expect, it, vi } from 'vitest'

import {
  buildExtractionPrompt,
  buildTriagePrompt,
  parseMemoryCandidates,
  parseTriageDecision,
  personaChangeRatio,
  PERSONA_MAX_CHANGE_RATIO
} from '@/presenter/memoryPresenter/extraction'

describe('personaChangeRatio', () => {
  it('is 0 for identical or both-empty self-models', () => {
    expect(personaChangeRatio('I am concise.', 'I am concise.')).toBe(0)
    expect(personaChangeRatio('', '')).toBe(0)
    expect(personaChangeRatio(null, undefined)).toBe(0)
  })

  it('is 1 when there is no previous self-model to compare', () => {
    expect(personaChangeRatio('', 'a brand new self-model')).toBe(1)
  })

  it('stays small for a minor refinement and large for a rewrite', () => {
    const small = personaChangeRatio('I am concise.', 'I am concise and direct.')
    expect(small).toBeLessThan(PERSONA_MAX_CHANGE_RATIO)
    const large = personaChangeRatio('I am concise.', 'Completely unrelated wording here.')
    expect(large).toBeGreaterThan(PERSONA_MAX_CHANGE_RATIO)
  })
})

describe('parseMemoryCandidates', () => {
  it('parses a plain JSON array', () => {
    const out = parseMemoryCandidates(
      '[{"category":"user_preference","content":"user likes redis","importance":0.8}]'
    )
    expect(out).toEqual({
      ok: true,
      candidates: [
        {
          category: 'user_preference',
          kind: undefined,
          content: 'user likes redis',
          importance: 0.8
        }
      ]
    })
  })

  it('parses JSON inside ```json fences with surrounding prose', () => {
    const raw = 'Here you go:\n```json\n[{"kind":"episodic","content":"shipped v1"}]\n```\nDone.'
    const out = parseMemoryCandidates(raw)
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected parse to succeed')
    expect(out.candidates).toHaveLength(1)
    expect(out.candidates[0]).toMatchObject({ kind: 'episodic', content: 'shipped v1' })
    expect(out.candidates[0].importance).toBeUndefined()
  })

  it('preserves raw category/kind and leaves importance clamping to normalization', () => {
    const out = parseMemoryCandidates(
      '[{"category":"unknown","kind":"other","content":"x","importance":5},{"kind":"semantic","content":"y","importance":-2}]'
    )
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected parse to succeed')
    expect(out.candidates[0]).toMatchObject({
      category: 'unknown',
      kind: undefined,
      importance: 5
    })
    expect(out.candidates[1]).toMatchObject({ kind: 'semantic', importance: -2 })
  })

  it('drops entries without content', () => {
    const out = parseMemoryCandidates('[{"kind":"semantic"},{"content":"  "},{"content":"ok"}]')
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected parse to succeed')
    expect(out.candidates).toHaveLength(1)
    expect(out.candidates[0].content).toBe('ok')
  })

  it('returns parse failures for empty / non-array / garbage', () => {
    expect(parseMemoryCandidates('')).toEqual({ ok: false, reason: 'empty-response' })
    expect(parseMemoryCandidates('not json')).toEqual({ ok: false, reason: 'missing-json-array' })
    expect(parseMemoryCandidates('{"content":"x"}')).toEqual({
      ok: false,
      reason: 'missing-json-array'
    })
    expect(parseMemoryCandidates('[broken')).toEqual({ ok: false, reason: 'missing-json-array' })
  })

  it('caps at 8 candidates', () => {
    const many = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({ kind: 'semantic', content: `c${i}` }))
    )
    const out = parseMemoryCandidates(many)
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected parse to succeed')
    expect(out.candidates).toHaveLength(8)
  })

  it('keeps at most one task_outcome candidate', () => {
    const out = parseMemoryCandidates(
      JSON.stringify([
        { category: 'task_outcome', content: 'task finished', importance: 0.8 },
        { category: 'task_outcome', content: 'second outcome', importance: 0.9 },
        { category: 'project_fact', content: 'repo uses pnpm', importance: 0.7 }
      ])
    )
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected parse to succeed')
    expect(out.candidates.map((candidate) => candidate.content)).toEqual([
      'task finished',
      'repo uses pnpm'
    ])
  })
})

describe('buildExtractionPrompt', () => {
  it('embeds the span and instructs JSON-only output', () => {
    const prompt = buildExtractionPrompt('User: I prefer concise answers')
    expect(prompt).toContain('I prefer concise answers')
    expect(prompt).toContain('JSON array')
    expect(prompt).toContain('untrusted')
    expect(prompt).toContain('user_preference')
    expect(prompt).toContain('project_fact')
    expect(prompt).toContain('task_outcome')
    expect(prompt).toContain('heuristic')
    expect(prompt).toContain('anti_pattern')
    expect(prompt).toContain('raw tool results')
    expect(prompt).toContain('Return at most one task_outcome')
  })

  it('truncates very long spans to the tail', () => {
    const span = 'X'.repeat(20000) + 'TAIL_MARKER'
    const prompt = buildExtractionPrompt(span)
    expect(prompt).toContain('TAIL_MARKER')
    expect(prompt.length).toBeLessThan(20000)
  })
})

// extractAndStore end-to-end (fake LLM + fake repo): exercises the decoupled extraction chain.
describe('MemoryPresenter.extractAndStore', () => {
  it('extracts, dedupes, and writes pending memories; no-op when disabled', async () => {
    const { MemoryPresenter } = await import('@/presenter/memoryPresenter')
    const repo = makeFakeRepo()
    const generateText = vi.fn(
      async () =>
        '```json\n[{"kind":"semantic","content":"user prefers redis","importance":0.9}]\n```'
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: (id) =>
        id === 'on' ? { memoryEnabled: true } : { memoryEnabled: false },
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => ({
        upsert: async () => {},
        query: async () => [],
        deleteByMemoryIds: async () => {},
        clear: async () => {},
        close: async () => {}
      })
    })

    // disabled → no LLM call, no writes
    const none = await presenter.extractAndStore({
      agentId: 'off',
      spanText: 'User: hi',
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(none).toEqual({ ok: true, createdIds: [] })
    expect(generateText).not.toHaveBeenCalled()

    // enabled → extracts and writes
    const created = await presenter.extractAndStore({
      agentId: 'on',
      spanText: 'User: I prefer redis',
      model: { providerId: 'p', modelId: 'm' }
    })
    if (!created.ok) throw new Error('expected extraction to succeed')
    expect(created.createdIds).toHaveLength(1)
    // triage (KEEP) + extraction
    expect(generateText).toHaveBeenCalledTimes(2)
    // listByAgent hides the internal working-memory cache row a mutation rebuilds, so this counts
    // only the extracted memory (countByAgent would also include that internal row).
    expect(repo.listByAgent('on').length).toBe(1)

    // second identical extraction succeeds but dedupes → no new ids
    const again = await presenter.extractAndStore({
      agentId: 'on',
      spanText: 'User: I prefer redis',
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(again).toEqual({ ok: true, createdIds: [] })
    expect(repo.listByAgent('on').length).toBe(1)
  })

  it('applies category-derived kind and importance floor through extraction writes', async () => {
    const { MemoryPresenter } = await import('@/presenter/memoryPresenter')
    const repo = makeFakeRepo()
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      return '[{"category":"task_outcome","content":"PR-2 review fix completed","importance":0.1}]'
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => ({
        upsert: async () => {},
        query: async () => [],
        deleteByMemoryIds: async () => {},
        clear: async () => {},
        close: async () => {}
      })
    })

    const result = await presenter.extractAndStore({
      agentId: 'on',
      spanText: 'Assistant: PR-2 review fix completed.',
      model: { providerId: 'p', modelId: 'm' }
    })

    if (!result.ok) throw new Error('expected extraction to succeed')
    const row = repo.getById(result.createdIds[0])
    expect(row).toMatchObject({
      kind: 'episodic',
      category: 'task_outcome',
      importance: 0.55
    })
  })

  it('returns ok:false on extraction failure without writing (cursor caller can retry)', async () => {
    const { MemoryPresenter } = await import('@/presenter/memoryPresenter')
    const repo = makeFakeRepo()
    const generateText = vi.fn(async () => {
      throw new Error('LLM unavailable')
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => ({
        upsert: async () => {},
        query: async () => [],
        deleteByMemoryIds: async () => {},
        clear: async () => {},
        close: async () => {}
      })
    })

    const result = await presenter.extractAndStore({
      agentId: 'on',
      spanText: 'User: I prefer redis',
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(result).toEqual({ ok: false })
    // triage throws (non-fatal, falls through) + extraction throws → ok:false
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(repo.countByAgent('on')).toBe(0)
  })
})

describe('triage prompt + decision', () => {
  it('triage prompt embeds the span and asks for a KEEP/SKIP verdict on untrusted data', () => {
    const prompt = buildTriagePrompt('User: I live in Berlin')
    expect(prompt).toContain('I live in Berlin')
    expect(prompt).toContain('KEEP')
    expect(prompt).toContain('SKIP')
    expect(prompt).toContain('untrusted')
    expect(prompt).toContain('project facts')
    expect(prompt).toContain('durable task outcomes')
    expect(prompt).toContain('heuristics')
    expect(prompt).toContain('anti-patterns')
  })

  it('parseTriageDecision keeps unless SKIP is the clear, sole verdict', () => {
    expect(parseTriageDecision('KEEP')).toBe(true)
    expect(parseTriageDecision('skip')).toBe(false)
    expect(parseTriageDecision('SKIP — nothing durable here')).toBe(false)
    expect(parseTriageDecision('KEEP, then SKIP the chit-chat')).toBe(true)
    expect(parseTriageDecision('')).toBe(true)
    expect(parseTriageDecision('unsure, maybe')).toBe(true)
  })
})

describe('MemoryPresenter.extractAndStore triage gate, cheap model, lineage', () => {
  async function build(config: any, generateText: any) {
    const { MemoryPresenter } = await import('@/presenter/memoryPresenter')
    const repo = makeFakeRepo()
    const presenter = new MemoryPresenter({
      repository: repo as any,
      resolveAgentConfig: () => config,
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => ({
        upsert: async () => {},
        query: async () => [],
        deleteByMemoryIds: async () => {},
        close: async () => {},
        isUsable: () => true
      }),
      resetVectorStore: async () => {}
    } as any)
    return { presenter, repo }
  }

  it('skips the extraction call when triage returns SKIP, still ok (cursor advances)', async () => {
    const generateText = vi.fn(async () => 'SKIP')
    const { presenter, repo } = await build({ memoryEnabled: true }, generateText)
    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: lol nice weather today',
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(result).toEqual({ ok: true, createdIds: [] })
    expect(generateText).toHaveBeenCalledTimes(1) // triage only, no full extraction
    expect(repo.countByAgent('a')).toBe(0)
  })

  it('falls through to extraction when triage itself fails', async () => {
    let call = 0
    const generateText = vi.fn(async () => {
      call += 1
      if (call === 1) throw new Error('triage unavailable')
      return '[{"kind":"semantic","content":"user prefers redis"}]'
    })
    const { presenter, repo } = await build({ memoryEnabled: true }, generateText)
    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer redis',
      model: { providerId: 'p', modelId: 'm' }
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.createdIds).toHaveLength(1)
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('uses the configured memoryExtractionModel for both triage and extraction', async () => {
    const generateText = vi.fn(async () => 'KEEP\n[{"kind":"semantic","content":"x"}]')
    const { presenter } = await build(
      {
        memoryEnabled: true,
        memoryExtractionModel: { providerId: 'cheap-p', modelId: 'cheap-m' }
      },
      generateText
    )
    await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I live in Berlin',
      model: { providerId: 'main-p', modelId: 'main-m' }
    })
    expect(generateText.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const call of generateText.mock.calls) {
      expect(call[0]).toBe('cheap-p')
      expect(call[1]).toBe('cheap-m')
    }
  })

  it('falls back to the caller model when no memoryExtractionModel is configured', async () => {
    const generateText = vi.fn(async () => 'KEEP\n[{"kind":"semantic","content":"x"}]')
    const { presenter } = await build({ memoryEnabled: true }, generateText)
    await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I live in Berlin',
      model: { providerId: 'main-p', modelId: 'main-m' }
    })
    expect(generateText.mock.calls[0][0]).toBe('main-p')
    expect(generateText.mock.calls[0][1]).toBe('main-m')
  })

  it('persists sourceEntryIds lineage scoped by sourceSession', async () => {
    const generateText = vi.fn(
      async () => 'KEEP\n[{"kind":"semantic","content":"user prefers redis"}]'
    )
    const { presenter, repo } = await build({ memoryEnabled: true }, generateText)
    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer redis',
      model: { providerId: 'p', modelId: 'm' },
      sourceSession: 's1',
      sourceEntryIds: [11, 12]
    })
    if (!result.ok) throw new Error('expected ok')
    const row = repo.getById(result.createdIds[0])
    expect(row.source_session).toBe('s1')
    expect(JSON.parse(row.source_entry_ids)).toEqual([11, 12])
  })

  it('drops lineage when there is no sourceSession to scope the entry ids', async () => {
    const generateText = vi.fn(
      async () => 'KEEP\n[{"kind":"semantic","content":"user prefers vue"}]'
    )
    const { presenter, repo } = await build({ memoryEnabled: true }, generateText)
    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer vue',
      model: { providerId: 'p', modelId: 'm' },
      sourceSession: null,
      sourceEntryIds: [11, 12]
    })
    if (!result.ok) throw new Error('expected ok')
    const row = repo.getById(result.createdIds[0])
    expect(row.source_session).toBe(null)
    expect(row.source_entry_ids).toBe(null)
  })
})

describe('MemoryPresenter.maybeReflect cheap model', () => {
  // Importance sums past REFLECTION_IMPORTANCE_THRESHOLD (5.0) so the reflection actually fires.
  async function buildWithMemories(config: any, generateText: any, count = 6) {
    const { MemoryPresenter } = await import('@/presenter/memoryPresenter')
    const repo = makeFakeRepo()
    for (let i = 0; i < count; i += 1) {
      repo.insert({
        id: `m${i}`,
        agentId: 'a',
        kind: 'semantic',
        content: `fact ${i}`,
        importance: 0.9
      })
    }
    const presenter = new MemoryPresenter({
      repository: repo as any,
      resolveAgentConfig: () => config,
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => ({
        upsert: async () => {},
        query: async () => [],
        deleteByMemoryIds: async () => {},
        close: async () => {},
        isUsable: () => true
      }),
      resetVectorStore: async () => {}
    } as any)
    return { presenter, repo }
  }

  it('reflects through the configured memoryExtractionModel', async () => {
    const generateText = vi.fn(async () => '["The user prefers concise, technical answers."]')
    const { presenter, repo } = await buildWithMemories(
      {
        memoryEnabled: true,
        memoryExtractionModel: { providerId: 'cheap-p', modelId: 'cheap-m' }
      },
      generateText
    )
    const result = await presenter.maybeReflect('a', { providerId: 'main-p', modelId: 'main-m' })
    expect(result?.reflectionIds.length).toBe(1)
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(generateText.mock.calls[0][0]).toBe('cheap-p')
    expect(generateText.mock.calls[0][1]).toBe('cheap-m')
    // Reflection writes a kind=reflection row and never a persona.
    const reflection = repo.getById(result!.reflectionIds[0])
    expect(reflection.kind).toBe('reflection')
    expect(reflection.source_entry_ids).toBe(null)
    expect([...repo.rows.values()].some((r: any) => r.kind === 'persona')).toBe(false)
  })

  it('falls back to the caller model when no memoryExtractionModel is configured', async () => {
    const generateText = vi.fn(async () => '["An insight."]')
    const { presenter } = await buildWithMemories({ memoryEnabled: true }, generateText)
    await presenter.maybeReflect('a', { providerId: 'main-p', modelId: 'main-m' })
    expect(generateText.mock.calls[0][0]).toBe('main-p')
    expect(generateText.mock.calls[0][1]).toBe('main-m')
  })

  it('does not fire until accumulated importance crosses the threshold', async () => {
    const generateText = vi.fn(async () => '["should not be produced"]')
    // 3 units (importance 0.9 each, sum 2.7) clear the min-count gate but stay under 5.0.
    const { presenter } = await buildWithMemories({ memoryEnabled: true }, generateText, 3)
    const result = await presenter.maybeReflect('a', { providerId: 'main-p', modelId: 'main-m' })
    expect(result).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('does not re-run the model on the same units after an empty reflection', async () => {
    const generateText = vi.fn(async () => '[]')
    const { presenter, repo } = await buildWithMemories({ memoryEnabled: true }, generateText)
    expect(await presenter.maybeReflect('a', { providerId: 'p', modelId: 'm' })).toBeNull()
    expect(generateText).toHaveBeenCalledTimes(1)
    // No new units: the same batch must not re-trigger the model.
    expect(await presenter.maybeReflect('a', { providerId: 'p', modelId: 'm' })).toBeNull()
    expect(generateText).toHaveBeenCalledTimes(1)
    // Fresh high-importance units past the attempt watermark re-open the trigger.
    for (let i = 0; i < 6; i += 1) {
      repo.insert({
        id: `n${i}`,
        agentId: 'a',
        kind: 'semantic',
        content: `new ${i}`,
        importance: 0.9,
        createdAt: 2
      })
    }
    expect(await presenter.maybeReflect('a', { providerId: 'p', modelId: 'm' })).toBeNull()
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('does not re-run the model when every insight is a duplicate', async () => {
    const { buildMemoryProvenanceKey } = await import('@/presenter/memoryPresenter/scoring')
    const generateText = vi.fn(async () => '["already known insight"]')
    const { presenter, repo } = await buildWithMemories({ memoryEnabled: true }, generateText)
    // A reflection with this content already exists, so the model's insight dedups to nothing.
    repo.insert({
      id: 'dup',
      agentId: 'a',
      kind: 'reflection',
      content: 'already known insight',
      importance: 0.8,
      createdAt: 0,
      provenanceKey: buildMemoryProvenanceKey('a', 'reflection', 'already known insight')
    })
    expect(await presenter.maybeReflect('a', { providerId: 'p', modelId: 'm' })).toBeNull()
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(await presenter.maybeReflect('a', { providerId: 'p', modelId: 'm' })).toBeNull()
    expect(generateText).toHaveBeenCalledTimes(1)
  })
})

function makeFakeRepo() {
  const rows = new Map<string, any>()
  return {
    rows,
    insert(input: any) {
      if (input.provenanceKey) {
        for (const r of rows.values()) {
          if (r.agent_id === input.agentId && r.provenance_key === input.provenanceKey) {
            throw new Error('UNIQUE')
          }
        }
      }
      const row = {
        id: input.id,
        agent_id: input.agentId,
        kind: input.kind,
        category: input.category ?? null,
        content: input.content,
        importance: input.importance ?? 0.5,
        status: input.status ?? 'pending_embedding',
        provenance_key: input.provenanceKey ?? null,
        superseded_by: null,
        is_anchor: 0,
        created_at: input.createdAt ?? 1,
        source_session: input.sourceSession ?? null,
        embedding_id: null,
        embedding_dim: null,
        user_scope: null,
        last_accessed: null,
        access_count: 0,
        decay_score: null,
        source_entry_ids: input.sourceEntryIds?.length ? JSON.stringify(input.sourceEntryIds) : null
      }
      rows.set(row.id, row)
      return row
    },
    getById: (id: string) => rows.get(id),
    getByProvenanceKey: (agentId: string, key: string) =>
      [...rows.values()].find((r) => r.agent_id === agentId && r.provenance_key === key),
    listByAgent: (agentId: string, opts?: any) => {
      let result = [...rows.values()].filter(
        (r) => r.agent_id === agentId && (opts?.includeSuperseded || !r.superseded_by)
      )
      if (opts?.kinds?.length) result = result.filter((r) => opts.kinds.includes(r.kind))
      else result = result.filter((r) => r.kind !== 'working')
      result.sort((a, b) => b.created_at - a.created_at)
      if (opts?.limit) result = result.slice(0, opts.limit)
      return result
    },
    getActivePersona: () => undefined,
    listPersonaVersions: () => [],
    search: () => [],
    listPendingEmbedding: (limit = 50, agentId?: string) =>
      [...rows.values()]
        .filter((r) => r.status === 'pending_embedding' && (!agentId || r.agent_id === agentId))
        .slice(0, limit),
    updateStatus: (id: string, status: string) => {
      const r = rows.get(id)
      if (r) r.status = status
    },
    updateContent: (
      id: string,
      content: string,
      provenanceKey: string | null,
      at = 0,
      category?: string | null
    ) => {
      const r = rows.get(id)
      if (!r) return
      r.content = content
      r.provenance_key = provenanceKey
      r.last_accessed = at
      if (category !== undefined) r.category = category
    },
    markSuperseded: () => {},
    recordAccess: () => {},
    delete: (id: string) => rows.delete(id),
    clearByAgent: (agentId: string) => {
      let n = 0
      for (const [id, r] of rows) if (r.agent_id === agentId) (rows.delete(id), n++)
      return n
    },
    countByAgent: (agentId: string) =>
      [...rows.values()].filter((r) => r.agent_id === agentId).length
  }
}
