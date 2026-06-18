import { describe, expect, it, vi } from 'vitest'

import {
  buildExtractionPrompt,
  buildTriagePrompt,
  parseMemoryCandidates,
  parseTriageDecision
} from '@/presenter/memoryPresenter/extraction'

describe('parseMemoryCandidates', () => {
  it('parses a plain JSON array', () => {
    const out = parseMemoryCandidates(
      '[{"kind":"semantic","content":"user likes redis","importance":0.8}]'
    )
    expect(out).toEqual([{ kind: 'semantic', content: 'user likes redis', importance: 0.8 }])
  })

  it('parses JSON inside ```json fences with surrounding prose', () => {
    const raw = 'Here you go:\n```json\n[{"kind":"episodic","content":"shipped v1"}]\n```\nDone.'
    const out = parseMemoryCandidates(raw)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'episodic', content: 'shipped v1' })
    expect(out[0].importance).toBe(0.5) // default
  })

  it('defaults kind to semantic and clamps importance', () => {
    const out = parseMemoryCandidates(
      '[{"content":"x","importance":5},{"content":"y","importance":-2}]'
    )
    expect(out[0]).toMatchObject({ kind: 'semantic', importance: 1 })
    expect(out[1]).toMatchObject({ kind: 'semantic', importance: 0 })
  })

  it('drops entries without content', () => {
    const out = parseMemoryCandidates('[{"kind":"semantic"},{"content":"  "},{"content":"ok"}]')
    expect(out).toHaveLength(1)
    expect(out[0].content).toBe('ok')
  })

  it('returns [] for empty / non-array / garbage', () => {
    expect(parseMemoryCandidates('')).toEqual([])
    expect(parseMemoryCandidates('not json')).toEqual([])
    expect(parseMemoryCandidates('{"content":"x"}')).toEqual([])
    expect(parseMemoryCandidates('[broken')).toEqual([])
  })

  it('caps at 8 candidates', () => {
    const many = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({ kind: 'semantic', content: `c${i}` }))
    )
    expect(parseMemoryCandidates(many)).toHaveLength(8)
  })
})

describe('buildExtractionPrompt', () => {
  it('embeds the span and instructs JSON-only output', () => {
    const prompt = buildExtractionPrompt('User: I prefer concise answers')
    expect(prompt).toContain('I prefer concise answers')
    expect(prompt).toContain('JSON array')
    expect(prompt).toContain('untrusted')
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
    expect(repo.countByAgent('on')).toBe(1)

    // second identical extraction succeeds but dedupes → no new ids
    const again = await presenter.extractAndStore({
      agentId: 'on',
      spanText: 'User: I prefer redis',
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(again).toEqual({ ok: true, createdIds: [] })
    expect(repo.countByAgent('on')).toBe(1)
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
  async function buildWithMemories(config: any, generateText: any, count = 3) {
    const { MemoryPresenter } = await import('@/presenter/memoryPresenter')
    const repo = makeFakeRepo()
    for (let i = 0; i < count; i += 1) {
      repo.insert({ id: `m${i}`, agentId: 'a', kind: 'semantic', content: `fact ${i}` })
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
    const generateText = vi.fn(async () => 'I am a concise, technical assistant.')
    const { presenter } = await buildWithMemories(
      {
        memoryEnabled: true,
        memoryExtractionModel: { providerId: 'cheap-p', modelId: 'cheap-m' }
      },
      generateText
    )
    const personaId = await presenter.maybeReflect(
      'a',
      { providerId: 'main-p', modelId: 'main-m' },
      3
    )
    expect(personaId).toBeTruthy()
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(generateText.mock.calls[0][0]).toBe('cheap-p')
    expect(generateText.mock.calls[0][1]).toBe('cheap-m')
  })

  it('falls back to the caller model when no memoryExtractionModel is configured', async () => {
    const generateText = vi.fn(async () => 'I am a concise, technical assistant.')
    const { presenter } = await buildWithMemories({ memoryEnabled: true }, generateText)
    await presenter.maybeReflect('a', { providerId: 'main-p', modelId: 'main-m' }, 3)
    expect(generateText.mock.calls[0][0]).toBe('main-p')
    expect(generateText.mock.calls[0][1]).toBe('main-m')
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
    listByAgent: (agentId: string, opts?: any) =>
      [...rows.values()].filter(
        (r) => r.agent_id === agentId && (opts?.includeSuperseded || !r.superseded_by)
      ),
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
