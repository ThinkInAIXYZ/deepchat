import { describe, expect, it, vi } from 'vitest'

import {
  MemoryPresenter,
  appendMemorySection,
  buildMemorySection,
  isSafeAgentId
} from '@/presenter/memoryPresenter'
import {
  buildMemoryProvenanceKey,
  decayScore,
  distanceToSimilarity,
  fuse,
  parseSourceEntryIds,
  recencyScore,
  resolveRetrieval,
  retrievalScore
} from '@/presenter/memoryPresenter/scoring'
import type {
  AgentMemoryInsertInput,
  AgentMemoryRow,
  IMemoryVectorStore,
  MemoryRepositoryPort,
  MemoryVectorMatch,
  MemoryVectorRecord
} from '@/presenter/memoryPresenter/types'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'

class FakeRepository implements MemoryRepositoryPort {
  rows = new Map<string, AgentMemoryRow>()

  insert(input: AgentMemoryInsertInput): AgentMemoryRow {
    if (input.provenanceKey) {
      for (const row of this.rows.values()) {
        if (row.agent_id === input.agentId && row.provenance_key === input.provenanceKey) {
          throw new Error('UNIQUE constraint failed')
        }
      }
    }
    const row: AgentMemoryRow = {
      id: input.id,
      agent_id: input.agentId,
      user_scope: input.userScope ?? null,
      kind: input.kind,
      content: input.content,
      importance: input.importance ?? 0.5,
      status: input.status ?? 'pending_embedding',
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null,
      source_session: input.sourceSession ?? null,
      provenance_key: input.provenanceKey ?? null,
      is_anchor: input.isAnchor ? 1 : 0,
      superseded_by: null,
      created_at: input.createdAt ?? 1000,
      last_accessed: null,
      access_count: 0,
      decay_score: null,
      source_entry_ids: input.sourceEntryIds?.length ? JSON.stringify(input.sourceEntryIds) : null,
      confidence: null,
      last_consolidated_at: null,
      conflict_state: null
    }
    this.rows.set(row.id, row)
    return row
  }

  getById(id: string) {
    return this.rows.get(id)
  }

  getByProvenanceKey(agentId: string, provenanceKey: string) {
    return [...this.rows.values()].find(
      (row) => row.agent_id === agentId && row.provenance_key === provenanceKey
    )
  }

  listByAgent(
    agentId: string,
    options?: {
      includeSuperseded?: boolean
      includeArchived?: boolean
      statuses?: AgentMemoryRow['status'][]
    }
  ) {
    return [...this.rows.values()].filter(
      (row) =>
        row.agent_id === agentId &&
        (options?.includeSuperseded || !row.superseded_by) &&
        (options?.includeArchived ||
          options?.statuses?.includes('archived') ||
          row.status !== 'archived') &&
        (!options?.statuses?.length || options.statuses.includes(row.status))
    )
  }

  getActivePersona(agentId: string) {
    return [...this.rows.values()]
      .filter((row) => row.agent_id === agentId && row.kind === 'persona' && !row.superseded_by)
      .sort((a, b) => b.created_at - a.created_at)[0]
  }

  listPersonaVersions(agentId: string) {
    return [...this.rows.values()]
      .filter((row) => row.agent_id === agentId && row.kind === 'persona')
      .sort((a, b) => b.created_at - a.created_at)
  }

  search(agentId: string, query: string, limit = 20) {
    const q = query.toLowerCase()
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          !row.superseded_by &&
          row.status !== 'archived' &&
          row.content.toLowerCase().includes(q)
      )
      .slice(0, limit)
  }

  listPendingEmbedding(limit = 50, agentId?: string) {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.status === 'pending_embedding' &&
          row.kind !== 'persona' &&
          (!agentId || row.agent_id === agentId)
      )
      .slice(0, limit)
  }

  updateStatus(
    id: string,
    status: AgentMemoryRow['status'],
    embedding?: {
      embeddingId?: string | null
      embeddingDim?: number | null
      embeddingModel?: string | null
    }
  ) {
    const row = this.rows.get(id)
    if (!row) return
    row.status = status
    row.embedding_id = embedding?.embeddingId ?? null
    row.embedding_dim = embedding?.embeddingDim ?? null
    row.embedding_model = embedding?.embeddingModel ?? null
  }

  requeueForEmbedding(agentId: string, statuses: AgentMemoryRow['status'][]) {
    let changed = 0
    for (const row of this.rows.values()) {
      if (row.agent_id !== agentId || row.superseded_by || row.kind === 'persona') continue
      if (!statuses.includes(row.status)) continue
      row.status = 'pending_embedding'
      row.embedding_id = null
      row.embedding_dim = null
      row.embedding_model = null
      changed += 1
    }
    return changed
  }

  markSuperseded(id: string, supersededBy: string | null) {
    const row = this.rows.get(id)
    if (row) row.superseded_by = supersededBy
  }

  recordAccess(id: string, accessedAt = 0) {
    const row = this.rows.get(id)
    if (row) {
      row.last_accessed = accessedAt
      row.access_count += 1
    }
  }

  updateDecayScore(id: string, decayScore: number | null, consolidatedAt: number | null = null) {
    const row = this.rows.get(id)
    if (row) {
      row.decay_score = decayScore
      if (consolidatedAt !== null) row.last_consolidated_at = consolidatedAt
    }
  }

  updateContent(id: string, content: string, provenanceKey: string | null, at = 0) {
    const row = this.rows.get(id)
    if (row) {
      row.content = content
      row.provenance_key = provenanceKey
      row.last_accessed = at
      row.last_consolidated_at = at
    }
  }

  setConfidence(id: string, confidence: number) {
    const row = this.rows.get(id)
    if (row)
      row.confidence = row.confidence === null ? confidence : Math.max(row.confidence, confidence)
  }

  setImportance(id: string, importance: number) {
    const row = this.rows.get(id)
    if (row) row.importance = Math.max(row.importance, importance)
  }

  markConflict(id: string, state: 'challenged' | null) {
    const row = this.rows.get(id)
    if (row) row.conflict_state = state
  }

  setLastConsolidatedAt(id: string, at = 0) {
    const row = this.rows.get(id)
    if (row) row.last_consolidated_at = at
  }

  getLastConsolidatedAt(agentId: string) {
    let max: number | null = null
    for (const row of this.rows.values()) {
      if (row.agent_id !== agentId || row.last_consolidated_at === null) continue
      if (max === null || row.last_consolidated_at > max) max = row.last_consolidated_at
    }
    return max
  }

  archive(id: string, at = 0) {
    const row = this.rows.get(id)
    if (row) {
      row.status = 'archived'
      row.last_consolidated_at = at
    }
  }

  listArchiveCandidates(agentId: string, before: number, decayBelow: number) {
    return [...this.rows.values()].filter(
      (row) =>
        row.agent_id === agentId &&
        !row.superseded_by &&
        row.status !== 'archived' &&
        row.is_anchor === 0 &&
        row.kind !== 'persona' &&
        row.created_at < before &&
        row.decay_score !== null &&
        row.decay_score < decayBelow
    )
  }

  delete(id: string) {
    this.rows.delete(id)
  }

  clearByAgent(agentId: string) {
    let removed = 0
    for (const [id, row] of this.rows) {
      if (row.agent_id === agentId) {
        this.rows.delete(id)
        removed += 1
      }
    }
    return removed
  }

  countByAgent(agentId: string) {
    return this.listByAgent(agentId, { includeSuperseded: true }).length
  }
}

class FakeVectorStore implements IMemoryVectorStore {
  vectors = new Map<string, number[]>()

  async upsert(records: MemoryVectorRecord[]) {
    for (const record of records) this.vectors.set(record.memoryId, record.embedding)
  }

  async query(embedding: number[], options: { topK: number }): Promise<MemoryVectorMatch[]> {
    return [...this.vectors.entries()]
      .map(([memoryId, vec]) => ({ memoryId, distance: 1 - cosine(embedding, vec) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, options.topK)
  }

  async deleteByMemoryIds(memoryIds: string[]) {
    for (const id of memoryIds) this.vectors.delete(id)
  }

  async close() {}

  isUsable() {
    return true
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

function makePresenter(config: DeepChatAgentConfig | null, repo = new FakeRepository()) {
  const store = new FakeVectorStore()
  const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
    texts.map((text) => textToVector(text))
  )
  // Models the on-disk reset: clearing memories deletes the agent's vector file.
  const resetVectorStore = vi.fn(async () => {
    store.vectors.clear()
  })
  const presenter = new MemoryPresenter({
    repository: repo,
    resolveAgentConfig: () => config,
    getEmbeddings,
    createVectorStore: async () => store,
    resetVectorStore
  })
  return { presenter, repo, store, getEmbeddings, resetVectorStore }
}

// Maps text to a keyword-correlated toy vector so similarity ordering is assertable.
function textToVector(text: string): number[] {
  const t = text.toLowerCase()
  return [t.includes('redis') ? 1 : 0, t.includes('vue') ? 1 : 0, t.includes('简洁') ? 1 : 0, 0.01]
}

const enabledConfig: DeepChatAgentConfig = {
  memoryEnabled: true,
  memoryEmbedding: { providerId: 'p', modelId: 'm' }
}

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
    const b = buildMemoryProvenanceKey('agent', 'semantic', 'likes redis')
    expect(a).toBe(b)
    const c = buildMemoryProvenanceKey('agent', 'episodic', 'likes redis')
    expect(c).not.toBe(a)
  })
})

function makeRow(id: string, overrides: Partial<AgentMemoryRow> = {}): AgentMemoryRow {
  return {
    id,
    agent_id: 'a',
    user_scope: null,
    kind: 'semantic',
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
      [{ kind: 'semantic', content: 'User Likes Redis' }],
      { agentId: 'a' }
    )
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
    expect(repo.countByAgent('a')).toBe(1)
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
    presenter.evolvePersona('a', 'I answer concisely')
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const payload = await presenter.buildInjection('a', 'redis')
    expect(payload?.selfModel).toBe('I answer concisely')
    expect(payload?.memories.length).toBeGreaterThan(0)
  })
})

describe('MemoryPresenter persona evolution', () => {
  it('evolve supersedes previous active persona', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    expect(presenter.listPersonaVersions('a')).toHaveLength(2)
    expect(repo.getById(v1!)?.superseded_by).toBe(v2)
    expect(presenter.getStatus('a').hasPersona).toBe(true)
  })

  it('does not supersede anchor personas', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'anchor',
      agentId: 'a',
      kind: 'persona',
      content: 'core values',
      isAnchor: true,
      createdAt: 1
    })
    presenter.evolvePersona('a', 'evolved', null)
    expect(repo.getById('anchor')?.superseded_by).toBeNull()
  })

  it('rollback restores a historical version', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    expect(presenter.rollbackPersona('a', v1!)).toBe(true)
    expect(repo.getById(v1!)?.superseded_by).toBeNull()
    expect(repo.getById(v2!)?.superseded_by).toBe(v1)
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

  it('concurrent vector-store access shares a single create (promise cache)', async () => {
    const repo = new FakeRepository()
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    // Two cold-cache recalls in flight: only one create must open the file.
    await Promise.all([presenter.recall('a', 'redis'), presenter.recall('a', 'redis')])
    expect(createVectorStore).toHaveBeenCalledTimes(1)
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

  it('marks the batch error (never embedded) when the vector store upsert fails', async () => {
    const repo = new FakeRepository()
    const failingStore: IMemoryVectorStore = {
      upsert: vi.fn(async () => {
        throw new Error('INSERT failed')
      }),
      query: async () => [],
      deleteByMemoryIds: async () => {},
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
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'delete')
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

  it('emits "persona-evolve" and "persona-rollback"', () => {
    const { presenter, onMemoryChanged } = makeWithSpy()
    const v1 = presenter.evolvePersona('a', 'v1', null)
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'persona-evolve')
    presenter.evolvePersona('a', 'v2', null)
    onMemoryChanged.mockClear()
    presenter.rollbackPersona('a', v1!)
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'persona-rollback')
  })

  it('emits "extract" when rememberMemory writes a new memory', async () => {
    const { presenter, onMemoryChanged } = makeWithSpy()
    const created = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user prefers redis' },
      { agentId: 'a' }
    )
    expect(created).toHaveLength(1)
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'extract')

    // A dedupe hit (same content) emits no event.
    onMemoryChanged.mockClear()
    const again = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user prefers redis' },
      { agentId: 'a' }
    )
    expect(again).toHaveLength(0)
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
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(result.ok).toBe(true)
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'extract')
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
    expect(() => presenter.listPersonaVersions('bad.id')).toThrow(/invalid agentId/)
    expect(() => presenter.rollbackPersona('bad id', 'v')).toThrow(/invalid agentId/)
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
      hasPersona: false
    })
    expect(await presenter.clearMemories('ghost')).toBe(0)
    expect(presenter.rollbackPersona('ghost', 'v')).toBe(false)

    // A real agent works normally.
    expect(presenter.listMemories('real')).toHaveLength(1)
    expect(repo.countByAgent('real')).toBe(1)
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
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')

    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm2' } }
    const results = await presenter.recall('a', 'redis')
    // FTS still answers while vectors rebuild; the stale row was re-queued synchronously.
    expect(results.some((item) => item.content === 'redis fact')).toBe(true)
    expect(repo.getById(id!)?.status).toBe('pending_embedding')

    await presenter.reindexEmbeddings('a')
    expect(repo.getById(id!)?.embedding_model).toBe('p:m2')
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
    expect(spy).toHaveBeenCalledWith('a')
    await spy.mock.results[0]?.value

    expect(repo.listByAgent('a')[0]?.status).toBe('embedded')
    expect(repo.listByAgent('a')[0]?.embedding_model).toBe('p:m')
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
      deleteByMemoryIds: async () => {},
      close: async () => {},
      isUsable: () => false
    }
    const usable = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => (didReset ? usable : unusable))
    const resetVectorStore = vi.fn(async () => {
      didReset = true
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
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
    expect(spy).toHaveBeenCalledWith('a', true)
    await spy.mock.results[0]?.value

    expect(resetVectorStore).toHaveBeenCalledWith('a')
    expect(repo.getById('fact1')?.status).toBe('embedded')
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
function routedLLM(opts: { extraction?: string; decision?: string; throwDecision?: boolean }) {
  return vi.fn(async (_p: string, _m: string, prompt: string) => {
    if (prompt.includes('KEEP or SKIP')) return 'KEEP'
    if (prompt.includes('JSON array')) return opts.extraction ?? '[]'
    if (prompt.includes('Choose exactly ONE decision')) {
      if (opts.throwDecision) throw new Error('decision model down')
      return opts.decision ?? '{"decision":"ADD","targetIndex":null,"mergedContent":null}'
    }
    return ''
  })
}

function makeLLMPresenter(generateText: ReturnType<typeof vi.fn>, config = embeddingConfig) {
  const repo = new FakeRepository()
  const store = new FakeVectorStore()
  const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
    texts.map((text) => textToVector(text))
  )
  const presenter = new MemoryPresenter({
    repository: repo,
    resolveAgentConfig: () => config,
    getEmbeddings,
    generateText,
    createVectorStore: async () => store,
    resetVectorStore: async () => {
      store.vectors.clear()
    }
  })
  return { presenter, repo, store, getEmbeddings, generateText }
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

const decisionCalls = (generateText: ReturnType<typeof vi.fn>) =>
  generateText.mock.calls.filter((call) => String(call[2]).includes('Choose exactly ONE decision'))
    .length

describe('MemoryPresenter decision ring (T-A1..T-A5)', () => {
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

  it('CHALLENGE: flags the neighbor as challenged without storing the candidate', async () => {
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
    expect(result.createdIds).toHaveLength(0)
    expect(repo.countByAgent('a')).toBe(1)
    expect(repo.getById(neighborId)?.conflict_state).toBe('challenged')
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

  it('explicit rememberMemory bypasses the decision ring (no decision call)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
    })
    const { presenter, repo } = makeLLMPresenter(generateText)
    await seedEmbedded(presenter, 'user likes redis')
    const created = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user prefers redis' },
      { agentId: 'a' }
    )
    expect(created).toHaveLength(1)
    expect(repo.countByAgent('a')).toBe(2)
    expect(decisionCalls(generateText)).toBe(0)
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
    const fresh = decayScore({ created_at: now, last_accessed: null }, now)
    const stale = decayScore({ created_at: now - 60 * DAY, last_accessed: null }, now)
    expect(fresh).toBeCloseTo(1)
    expect(stale).toBeCloseTo(0.25)
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

  it('archives only when all four conditions hold; exempts and partial cases survive', () => {
    const { presenter, repo } = makeArchivePresenter()
    const now = 1_000 * DAY
    const old = now - 200 * DAY
    const make = (id: string, over: Partial<AgentMemoryRow>) =>
      repo.rows.set(id, makeRow(id, { agent_id: 'a', created_at: old, ...over }))

    make('stale', { decay_score: 0.01 })
    make('accessed', { decay_score: 0.01, access_count: 2 })
    make('recent', { decay_score: 0.01, created_at: now })
    make('lively', { decay_score: 0.5 })
    make('anchored', { decay_score: 0.01, is_anchor: 1 })
    make('persona', { decay_score: 0.01, kind: 'persona' })

    const archived = presenter.archiveStale('a', now)
    expect(archived).toBe(1)
    expect(repo.getById('stale')?.status).toBe('archived')
    for (const id of ['accessed', 'recent', 'lively', 'anchored', 'persona']) {
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

  it('respects the cooldown: a second pass within the window does no LLM work (T-B5)', async () => {
    const generateText = routedLLM({
      decision: '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
    })
    const { presenter } = makeLLMPresenter(generateText)
    await seedEmbedded(presenter, 'user likes redis a')
    await seedEmbedded(presenter, 'user likes redis b')

    const now = 1_000 * DAY
    await presenter.runConsolidationPass('a', now)
    const callsAfterFirst = generateText.mock.calls.length
    await presenter.runConsolidationPass('a', now + 60 * 1000)
    expect(generateText.mock.calls.length).toBe(callsAfterFirst)
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
    expect(decisionCalls(generateText)).toBe(8)
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

  it('the cooldown survives a fresh presenter via the persisted marker (T-B5)', async () => {
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

    // Reuse the same repository to mimic a restart: in-memory cooldown is gone but the row markers
    // remain, so a pass within the window must still be skipped.
    const restarted = makeLLMPresenter(generateText, embeddingConfig)
    ;(restarted.presenter as unknown as { deps: { repository: FakeRepository } }).deps.repository =
      first.repo
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

  it('re-stating a superseded preference revives it and retires the contradicting head (AC-1.2)', async () => {
    const generateText = routedLLM({
      extraction: '[{"kind":"semantic","content":"user likes redis","importance":0.8}]'
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

  it('dispose waits for an in-flight backfill before returning (AC-3.4)', async () => {
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
    expect(disposed).toBe(false)

    resolveEmb()
    await Promise.all([backfill, disposePromise])
    expect(disposed).toBe(true)
    expect(repo.listByAgent('a')[0]?.status).toBe('embedded')
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
    const recordSpy = vi.spyOn(repo, 'recordAccess')
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

  it('a no-op consolidation pass persists the cooldown so a fresh presenter skips a too-soon pass (AC-6.1)', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const now = 1_000 * DAY
    const make = (gen: ReturnType<typeof vi.fn>) =>
      new MemoryPresenter({
        repository: repo,
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
    // Decay refresh stamped the cooldown anchor even though no merge/archive happened.
    expect(repo.getLastConsolidatedAt('a')).toBe(now)

    // Restart: a fresh presenter has an empty in-memory cooldown map and must read the persisted
    // anchor. Add a near-duplicate that a *running* pass would merge (it would call the decision LLM).
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
    ).toEqual([])
    expect(await presenter.deleteMemory('a', id)).toBe(false)
    expect(await presenter.clearMemories('a')).toBe(0)
    expect(presenter.rollbackPersona('a', id)).toBe(false)
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
    const recordSpy = vi.spyOn(repo, 'recordAccess')
    const backfillSpy = vi.spyOn(presenter, 'backfillEmbeddings')
    const reindexSpy = vi.spyOn(presenter, 'reindexEmbeddings')
    const closeSpy = vi.spyOn(store, 'close')
    const recall = presenter.recall('a', 'redis')
    await new Promise((r) => setTimeout(r, 0)) // park inside createVectorStore

    let disposed = false
    const disposePromise = presenter.dispose().then(() => {
      disposed = true
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(disposed).toBe(false) // dispose awaits the in-flight open lock

    resolveCreate()
    const [results] = await Promise.all([recall, disposePromise])
    expect(disposed).toBe(true)
    expect(results).toEqual([])
    expect(getByIdSpy).not.toHaveBeenCalled()
    expect(recordSpy).not.toHaveBeenCalled()
    expect(backfillSpy).not.toHaveBeenCalled()
    expect(reindexSpy).not.toHaveBeenCalled()
    expect(closeSpy).toHaveBeenCalledTimes(1) // the store opened during teardown is closed, not leaked
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
      deleteByMemoryIds: async () => {},
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
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined
    })
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fact' })
    repo.updateStatus('m1', 'embedded', {
      embeddingId: 'm1',
      embeddingDim: 4,
      embeddingModel: 'p:m'
    })

    blockQuery = true
    const getByIdSpy = vi.spyOn(repo, 'getById')
    const recordSpy = vi.spyOn(repo, 'recordAccess')
    const backfillSpy = vi.spyOn(presenter, 'backfillEmbeddings')
    const recall = presenter.recall('a', 'redis')
    await new Promise((r) => setTimeout(r, 0)) // park inside store.query

    await presenter.dispose() // query is not under the open lock, so dispose completes

    resolveQuery()
    const results = await recall
    expect(results).toEqual([])
    expect(getByIdSpy).not.toHaveBeenCalled() // disposed re-check after query skips the match loop
    expect(recordSpy).not.toHaveBeenCalled()
    expect(backfillSpy).not.toHaveBeenCalled()
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

    expect(result).toEqual({ ok: true, createdIds: [] })
    // Only the triage call ran; the extraction LLM is never fired after teardown begins.
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(generateText.mock.calls[0][2]).toContain('KEEP or SKIP')
    expect(insertSpy).not.toHaveBeenCalled()
  })
})
