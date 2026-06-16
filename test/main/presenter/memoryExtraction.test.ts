import { describe, expect, it, vi } from 'vitest'

import {
  buildExtractionPrompt,
  parseMemoryCandidates
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

// extractAndStore 端到端（用假 LLM + 假仓储），验证解耦抽取链路
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
    expect(generateText).toHaveBeenCalledTimes(1)
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
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(repo.countByAgent('on')).toBe(0)
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
        decay_score: null
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
    listPendingEmbedding: (limit = 50) =>
      [...rows.values()].filter((r) => r.status === 'pending_embedding').slice(0, limit),
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
