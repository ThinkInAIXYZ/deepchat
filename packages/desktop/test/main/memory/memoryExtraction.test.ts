import { describe, expect, it, vi } from 'vitest'
import { createFakeRepository, FakeDirectiveRepository } from './support/memoryFakes'

import {
  buildExtractionPrompt,
  buildTriagePrompt,
  parseMemoryCandidates,
  parseTriageDecision,
  personaChangeRatio,
  PERSONA_MAX_CHANGE_RATIO
} from '@/memory/core/extraction'
import { AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS } from '@shared/types/agent-memory'

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
      ],
      directiveSuggestions: []
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
    expect(
      parseMemoryCandidates(
        '{"memories":"invalid","directiveSuggestions":[{"kind":"instruction","content":"Never activate"}]}'
      )
    ).toEqual({ ok: false, reason: 'non-array' })
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

  it('parses bounded directive drafts separately from memory candidates', () => {
    const out = parseMemoryCandidates(
      JSON.stringify({
        memories: [{ category: 'user_preference', content: 'User prefers concise answers.' }],
        directiveSuggestions: [
          { kind: 'instruction', content: '  Keep responses concise.  ' },
          {
            kind: 'suppress_topic',
            content: 'Do not mention Project Saffron.',
            topic: ' Project   SAFFRON '
          },
          { kind: 'instruction', content: '' },
          { kind: 'instruction', content: 'Ambiguous instruction.', topic: 'unexpected' },
          { kind: 'unknown', content: 'Ignore me.' }
        ]
      })
    )

    expect(out).toEqual({
      ok: true,
      candidates: [
        {
          category: 'user_preference',
          kind: undefined,
          content: 'User prefers concise answers.',
          importance: undefined
        }
      ],
      directiveSuggestions: [
        { kind: 'instruction', content: 'Keep responses concise.' },
        {
          kind: 'suppress_topic',
          content: 'Do not mention Project Saffron.',
          topic: 'project saffron'
        }
      ]
    })
  })

  it('caps directive suggestions and drops malformed or oversized entries', () => {
    const out = parseMemoryCandidates(
      JSON.stringify({
        memories: [],
        directiveSuggestions: [
          {
            kind: 'instruction',
            content: 'x'.repeat(AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS + 1)
          },
          ...Array.from({ length: 8 }, (_, index) => ({
            kind: 'instruction',
            content: `Directive ${index}`
          }))
        ]
      })
    )
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected parse to succeed')
    expect(out.directiveSuggestions).toEqual(
      Array.from({ length: 4 }, (_, index) => ({
        kind: 'instruction',
        content: `Directive ${index}`
      }))
    )
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
    expect(prompt).toContain('explicit user approval')
    expect(prompt).toContain('directiveSuggestions')
    expect(prompt).toContain('suppress_topic')
  })

  it('preserves very long spans because runtime owns chunking', () => {
    const span = 'X'.repeat(20000) + 'TAIL_MARKER'
    const prompt = buildExtractionPrompt(span)
    expect(prompt).toContain('X'.repeat(20000))
    expect(prompt).toContain('TAIL_MARKER')
  })
})

describe('Wave 3 extraction characterization', () => {
  it('gives triage the complete runtime-owned chunk', () => {
    const prefix = 'PREFIX_FACT_MUST_NOT_BE_CONSUMED'
    const prompt = buildTriagePrompt(`${prefix}${'x'.repeat(5000)}TAIL_MARKER`)

    expect(prompt).toContain(prefix)
    expect(prompt).toContain('TAIL_MARKER')
  })

  it('gives extraction the same complete runtime-owned chunk', () => {
    const prefix = 'PREFIX_FACT_MUST_NOT_BE_CONSUMED'
    const prompt = buildExtractionPrompt(`${prefix}${'x'.repeat(13000)}TAIL_MARKER`)

    expect(prompt).toContain(prefix)
    expect(prompt).toContain('TAIL_MARKER')
  })
})

// extractAndStore end-to-end (fake LLM + fake repo): exercises the decoupled extraction chain.
describe('MemoryService.extractAndStore', () => {
  it('extracts, dedupes, and writes pending memories; returns retryable failure when disabled', async () => {
    const { MemoryService } = await import('@/memory')
    const repo = makeFakeRepo()
    const generateText = vi.fn(
      async () =>
        '```json\n[{"kind":"semantic","content":"user prefers redis","importance":0.9}]\n```'
    )
    const presenter = new MemoryService({
      executeWithRateLimit: vi.fn(async () => undefined),
      repository: repo,
      resolveAgentConfig: (id) =>
        id === 'on' ? { memoryEnabled: true } : { memoryEnabled: false },
      getEmbeddings: async () => [],
      generateText,
      clock: {
        now: () => 1_725_192_000_123,
        timeZone: () => 'UTC'
      },
      createVectorStore: async () => ({
        upsert: async () => {},
        query: async () => [],
        queryByMemoryId: async () => [],
        deleteByMemoryIds: async () => {},
        listMemoryIds: async () => [],
        clear: async () => {},
        close: async () => {},
        isUsable: () => true
      })
    })

    // Disabled non-empty spans are retryable because they may have been queued while enabled.
    const none = await presenter.extractAndStore({
      agentId: 'off',
      spanText: 'User: hi',
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(none).toEqual({ ok: false })
    expect(generateText).not.toHaveBeenCalled()

    const empty = await presenter.extractAndStore({
      agentId: 'off',
      spanText: '   ',
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(empty).toEqual({ ok: true, createdIds: [] })
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
    expect(repo.listByAgent('on')[0].created_at).toBe(1_725_192_000_123)

    // second identical extraction succeeds but dedupes → no new ids
    const again = await presenter.extractAndStore({
      agentId: 'on',
      spanText: 'User: I prefer redis',
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(again).toEqual({ ok: true, createdIds: [] })
    expect(repo.listByAgent('on').length).toBe(1)
  })

  it('stores model-derived directives as inactive drafts', async () => {
    const { MemoryService } = await import('@/memory')
    const repo = makeFakeRepo()
    const directiveRepository = new FakeDirectiveRepository()
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      return JSON.stringify({
        memories: [],
        directiveSuggestions: [
          {
            kind: 'suppress_topic',
            content: 'Do not mention Project Saffron.',
            topic: 'Project Saffron'
          }
        ]
      })
    })
    const presenter = new MemoryService({
      executeWithRateLimit: vi.fn(async () => undefined),
      repository: repo,
      directiveRepository,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => ({
        upsert: async () => {},
        query: async () => [],
        queryByMemoryId: async () => [],
        deleteByMemoryIds: async () => {},
        listMemoryIds: async () => [],
        clear: async () => {},
        close: async () => {},
        isUsable: () => true
      })
    })

    await expect(
      presenter.extractAndStore({
        agentId: 'a',
        spanText: 'User: Never mention Project Saffron in future replies.',
        model: { providerId: 'p', modelId: 'm' }
      })
    ).resolves.toEqual({ ok: true, createdIds: [] })
    expect(presenter.listDirectives('a')).toEqual([
      expect.objectContaining({
        kind: 'suppress_topic',
        status: 'draft',
        source: 'derived_suggestion',
        normalized_topic: 'project saffron'
      })
    ])
    expect(presenter.listActiveDirectives('a')).toEqual([])
  })

  it('audits committed claims when cancellation interrupts directive suggestions', async () => {
    const { makeLLMPresenter, routedLLM } = await import('./serviceTestSupport')
    const directiveRepository = new FakeDirectiveRepository()
    let memoryEnabled = true
    const config = {
      get memoryEnabled() {
        return memoryEnabled
      },
      memoryEmbedding: { providerId: 'p', modelId: 'm' }
    }
    const { presenter, repo, auditRepo } = makeLLMPresenter(
      routedLLM({
        extraction: JSON.stringify({
          memories: [{ kind: 'semantic', content: 'user prefers concise answers' }],
          directiveSuggestions: [
            { kind: 'instruction', content: 'Keep responses concise.' },
            { kind: 'instruction', content: 'Use direct language.' }
          ]
        })
      }),
      config,
      undefined,
      undefined,
      directiveRepository
    )
    const insertDraft = directiveRepository.insertDerivedDirectiveDraft.bind(directiveRepository)
    vi.spyOn(directiveRepository, 'insertDerivedDirectiveDraft').mockImplementation((input) => {
      const result = insertDraft(input)
      memoryEnabled = false
      presenter.onAgentMemoryMaintenanceConfigChanged('a')
      return result
    })

    await expect(
      presenter.extractAndStore({
        agentId: 'a',
        spanText: 'User: Please keep answers concise and direct.',
        model: { providerId: 'p', modelId: 'm' }
      })
    ).resolves.toEqual({ ok: false })

    expect(repo.listByAgent('a')).toEqual([
      expect.objectContaining({ content: 'user prefers concise answers' })
    ])
    expect(presenter.listDirectives('a')).toHaveLength(1)
    expect(
      auditRepo.listByAgent('a').filter((event) => event.event_type === 'memory/extract')
    ).toEqual([
      expect.objectContaining({
        status: 'completed',
        input_refs_json: expect.stringContaining('"directiveSuggestionCount":2')
      })
    ])
  })

  it('applies category-derived kind and importance floor through extraction writes', async () => {
    const { MemoryService } = await import('@/memory')
    const repo = makeFakeRepo()
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return 'KEEP'
      return '[{"category":"task_outcome","content":"PR-2 review fix completed","importance":0.1}]'
    })
    const presenter = new MemoryService({
      executeWithRateLimit: vi.fn(async () => undefined),
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => ({
        upsert: async () => {},
        query: async () => [],
        queryByMemoryId: async () => [],
        deleteByMemoryIds: async () => {},
        listMemoryIds: async () => [],
        clear: async () => {},
        close: async () => {},
        isUsable: () => true
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
    const { MemoryService } = await import('@/memory')
    const repo = makeFakeRepo()
    const generateText = vi.fn(async () => {
      throw new Error('LLM unavailable')
    })
    const presenter = new MemoryService({
      executeWithRateLimit: vi.fn(async () => undefined),
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => ({
        upsert: async () => {},
        query: async () => [],
        queryByMemoryId: async () => [],
        deleteByMemoryIds: async () => {},
        listMemoryIds: async () => [],
        clear: async () => {},
        close: async () => {},
        isUsable: () => true
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

describe('MemoryService.extractAndStore triage gate, cheap model, lineage', () => {
  async function build(config: any, generateText: any) {
    const { MemoryService } = await import('@/memory')
    const repo = makeFakeRepo()
    const onMemoryChanged = vi.fn()
    const presenter = new MemoryService({
      executeWithRateLimit: vi.fn(async () => undefined),
      repository: repo as any,
      resolveAgentConfig: () => config,
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => ({
        upsert: async () => {},
        query: async () => [],
        queryByMemoryId: async () => [],
        deleteByMemoryIds: async () => {},
        listMemoryIds: async () => [],
        close: async () => {},
        isUsable: () => true
      }),
      resetVectorStore: async () => {},
      onMemoryChanged
    } as any)
    return { presenter, repo, onMemoryChanged }
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

  it('returns ok:false when memory is disabled while a non-empty span is awaiting triage', async () => {
    let memoryEnabled = true
    let resolveTriage: (value: string) => void = () => {}
    const triageGate = new Promise<string>((resolve) => {
      resolveTriage = resolve
    })
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return triageGate
      return '[{"kind":"semantic","content":"user prefers redis"}]'
    })
    const { presenter, repo } = await build(
      {
        get memoryEnabled() {
          return memoryEnabled
        }
      },
      generateText
    )

    const extraction = presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer redis',
      model: { providerId: 'p', modelId: 'm' }
    })
    await Promise.resolve()
    memoryEnabled = false
    resolveTriage('KEEP')

    await expect(extraction).resolves.toEqual({ ok: false })
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(repo.countByAgent('a')).toBe(0)
  })

  it('rejects a stale triage response across an enabled true-to-false-to-true ABA', async () => {
    let memoryEnabled = true
    let resolveTriage: (value: string) => void = () => {}
    const triageGate = new Promise<string>((resolve) => {
      resolveTriage = resolve
    })
    const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
      if (prompt.includes('KEEP or SKIP')) return triageGate
      return '[{"kind":"semantic","content":"user prefers redis"}]'
    })
    const config = {
      get memoryEnabled() {
        return memoryEnabled
      }
    }
    const { presenter, repo, onMemoryChanged } = await build(config, generateText)

    const extraction = presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I prefer redis',
      model: { providerId: 'p', modelId: 'm' }
    })
    await Promise.resolve()

    memoryEnabled = false
    presenter.onAgentMemoryMaintenanceConfigChanged('a')
    memoryEnabled = true
    presenter.onAgentMemoryMaintenanceConfigChanged('a')
    resolveTriage('KEEP')

    await expect(extraction).resolves.toEqual({ ok: false })
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(repo.countByAgent('a')).toBe(0)
    expect(onMemoryChanged).not.toHaveBeenCalled()
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
    const generateText = vi.fn(
      async (_providerId: string, _modelId: string, _prompt: string) =>
        'KEEP\n[{"kind":"semantic","content":"x"}]'
    )
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
    const generateText = vi.fn(
      async (_providerId: string, _modelId: string, _prompt: string) =>
        'KEEP\n[{"kind":"semantic","content":"x"}]'
    )
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

describe('MemoryService.maybeReflect cheap model', () => {
  // Importance sums past REFLECTION_IMPORTANCE_THRESHOLD (5.0) so the reflection actually fires.
  async function buildWithMemories(config: any, generateText: any, count = 6) {
    const { MemoryService } = await import('@/memory')
    const repo = makeFakeRepo()
    for (let i = 0; i < count; i += 1) {
      repo.insert({
        id: `m${i}`,
        agentId: 'a',
        kind: 'semantic',
        content: `fact ${i}`,
        importance: 0.9,
        createdAt: 1
      })
    }
    const presenter = new MemoryService({
      executeWithRateLimit: vi.fn(async () => undefined),
      repository: repo as any,
      resolveAgentConfig: () => config,
      getEmbeddings: async () => [],
      generateText,
      createVectorStore: async () => ({
        upsert: async () => {},
        query: async () => [],
        queryByMemoryId: async () => [],
        deleteByMemoryIds: async () => {},
        listMemoryIds: async () => [],
        close: async () => {},
        isUsable: () => true
      }),
      resetVectorStore: async () => {}
    } as any)
    return { presenter, repo }
  }

  it('reflects through the configured memoryExtractionModel', async () => {
    const generateText = vi.fn(
      async (_providerId: string, _modelId: string, _prompt: string) =>
        '["The user prefers concise, technical answers."]'
    )
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
    const derivations = repo.listDerivationsByChild('a', reflection.id)
    expect(new Set(derivations.map((edge) => edge.parent_memory_id))).toEqual(
      new Set(result!.sourceMemoryIds)
    )
    expect(
      derivations.every(
        (edge) => edge.child_memory_id === reflection.id && edge.derivation_kind === 'reflection'
      )
    ).toBe(true)
    expect([...repo.rows.values()].some((r: any) => r.kind === 'persona')).toBe(false)
  })

  it('never promotes narrow-scope claims into agent-wide reflections', async () => {
    const generateText = vi.fn(
      async (_providerId: string, _modelId: string, _prompt: string) => '["Agent-wide insight."]'
    )
    const { presenter, repo } = await buildWithMemories({ memoryEnabled: true }, generateText)
    for (const [id, content, scope] of [
      ['session-source', 'session-only reflection source', { type: 'session', id: 'session-1' }],
      ['user-source', 'user-only reflection source', { type: 'user', id: 'user-1' }],
      ['project-source', 'project-only reflection source', { type: 'project', id: 'project-1' }]
    ] as const) {
      repo.insert({
        id,
        agentId: 'a',
        kind: 'semantic',
        content,
        importance: 1,
        createdAt: 2,
        scope
      })
    }

    const result = await presenter.maybeReflect('a', { providerId: 'p', modelId: 'm' })

    expect(result?.sourceMemoryIds.sort()).toEqual(
      Array.from({ length: 6 }, (_, index) => `m${index}`)
    )
    expect(generateText.mock.calls[0][2]).not.toContain('reflection source')
    expect(repo.getById(result!.reflectionIds[0])).toMatchObject({
      scope_type: 'agent',
      scope_id: null
    })
  })

  it('falls back to the caller model when no memoryExtractionModel is configured', async () => {
    const generateText = vi.fn(
      async (_providerId: string, _modelId: string, _prompt: string) => '["An insight."]'
    )
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
    const { buildMemoryProvenanceKey } = await import('@/memory/core/scoring')
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
    expect(repo.derivations.size).toBe(0)
    expect(await presenter.maybeReflect('a', { providerId: 'p', modelId: 'm' })).toBeNull()
    expect(generateText).toHaveBeenCalledTimes(1)
  })
})

function makeFakeRepo() {
  return createFakeRepository()
}
